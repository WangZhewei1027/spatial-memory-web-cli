import { MAX_SCENE_BYTES, SCENE_SCHEMA_VERSION, type SceneDefinition, type ValidationResult } from "./protocol.js";
import { IssueList, rejectUnknownKeys, requireObject } from "./validate-utils.js";
import { validateCompositionContent } from "./validate-content.js";

export class SceneAssetError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
  }
}

export function validateSceneDefinition(def: unknown): ValidationResult {
  const issues = new IssueList();
  const root = requireObject(issues, "$", def);
  if (root) {
    rejectUnknownKeys(issues, "$", root, ["schemaVersion", "content"]);
    if (root.schemaVersion !== 1 && root.schemaVersion !== SCENE_SCHEMA_VERSION) issues.error("schemaVersion", "仅支持 schemaVersion 1 或 2");
    const content = requireObject(issues, "content", root.content);
    if (content?.kind === "composition") validateCompositionContent(issues, content, root.schemaVersion === 2);
    else if (content) issues.error("content.kind", "场景素材仅支持 composition");
  }
  return { ok: !issues.hasErrors, issues: issues.issues };
}

export function parseSceneText(text: unknown): SceneDefinition {
  if (typeof text !== "string" || text.length > MAX_SCENE_BYTES || new TextEncoder().encode(text).length > MAX_SCENE_BYTES)
    throw new SceneAssetError("场景 JSON 必须是文本且不超过 256 KiB");
  let value: unknown;
  try { value = JSON.parse(text); }
  catch { throw new SceneAssetError("场景 JSON 格式错误"); }
  const result = validateSceneDefinition(value);
  if (!result.ok) throw new SceneAssetError(result.issues.filter((i) => i.severity === "error").slice(0, 3).map((i) => `${i.path}: ${i.message}`).join("；"));
  return value as SceneDefinition;
}
