import { MAX_SCENE_BYTES, SCENE_DOCUMENT_VERSION, type SceneDocument, type ValidationResult } from "./protocol.js";
import { IssueList, rejectUnknownKeys, requireObject } from "./validate-utils.js";
import { validateCompositionContent } from "./validate-content.js";

export class SceneAssetError extends Error {
  constructor(message: string, public readonly status = 400) { super(message); }
}

export function validateSceneDocument(def: unknown): ValidationResult {
  const issues = new IssueList();
  const root = requireObject(issues, "$", def);
  if (root) {
    rejectUnknownKeys(issues, "$", root, ["schemaVersion", "content"]);
    if (root.schemaVersion !== SCENE_DOCUMENT_VERSION) issues.error("schemaVersion", "场景文档必须是 schemaVersion 6");
    const content = requireObject(issues, "content", root.content);
    if (content?.kind === "composition") validateCompositionContent(issues, content);
    else if (content) issues.error("content.kind", "场景仅支持 composition");
  }
  if (!issues.hasErrors && new TextEncoder().encode(JSON.stringify(def)).length > MAX_SCENE_BYTES) issues.error("$", "场景 JSON 不能超过 1 MiB");
  return { ok: !issues.hasErrors, issues: issues.issues };
}

export function parseSceneText(text: unknown): SceneDocument {
  if (typeof text !== "string" || text.length > MAX_SCENE_BYTES || new TextEncoder().encode(text).length > MAX_SCENE_BYTES) throw new SceneAssetError("场景 JSON 必须是文本且不超过 1 MiB");
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new SceneAssetError("场景 JSON 格式错误"); }
  const result = validateSceneDocument(value);
  if (!result.ok) throw new SceneAssetError(result.issues.filter(issue => issue.severity === "error").slice(0, 3).map(issue => `${issue.path}: ${issue.message}`).join("；"));
  return value as SceneDocument;
}
