import { readFile } from "node:fs/promises";
import { check, id, jsonData, str, withQuery, type Args } from "./args.js";
import { CliError, object } from "./errors.js";
import { parseSceneText } from "./scene/validate.js";
import { ALL_UPLOAD_TYPES } from "./contract.js";
import type { RequestPlan } from "./client.js";

export function assetListPlan(args: Args): RequestPlan {
  check(args, args.words[1] === "get" ? 3 : 2, ["workspace", "org", "type", "require-location", "query"]);
  const workspace = str(args.options, "workspace"), org = str(args.options, "org");
  if (!workspace === !org) throw new CliError("需要且只能指定 --workspace 或 --org");
  if (args.words[1] === "get") id(args.words[2]);
  return { method: "GET", path: withQuery(workspace ? `/api/workspaces/${id(workspace)}/assets` : `/api/organizations/${id(org!)}/assets`, args.options, {
    type: str(args.options, "type"), requireLocation: args.options["require-location"] ? "true" : undefined,
  }) };
}

export async function assetBody(args: Args): Promise<Record<string, unknown>> {
  const data = str(args.options, "data");
  const body = data === undefined ? {} : await jsonData(data);
  const name = str(args.options, "name"), type = str(args.options, "type"), text = str(args.options, "text"), sceneFile = str(args.options, "scene-file");
  if (name !== undefined) body.name = name;
  if (type !== undefined) body.file_type = type;
  if (text !== undefined && sceneFile !== undefined) throw new CliError("--text 与 --scene-file 不能同时使用");
  if (text !== undefined) body.text_content = text;
  if (sceneFile !== undefined) {
    if (body.file_type !== undefined && body.file_type !== "scene") throw new CliError("--scene-file 仅用于 scene 素材");
    body.file_type = "scene";
    body.text_content = await readFile(sceneFile, "utf8");
  }
  if (!ALL_UPLOAD_TYPES.includes(body.file_type as typeof ALL_UPLOAD_TYPES[number])) throw new CliError(`素材需要有效的 --type 或 data.file_type：${ALL_UPLOAD_TYPES.join(", ")}`);
  if (body.file_type === "scene" && body.text_content !== undefined) parseSceneText(body.text_content);
  return body;
}

export async function assetCreatePlan(args: Args): Promise<RequestPlan> {
  check(args, 2, ["workspace", "data", "name", "type", "text", "scene-file"]);
  const workspace = id(str(args.options, "workspace", true)!);
  return { method: "POST", path: `/api/workspaces/${workspace}/assets`, body: await assetBody(args) };
}

export async function sceneSavePlan(args: Args): Promise<RequestPlan> {
  check(args, 3, ["scene-file", "revision", "name"]);
  const text = await readFile(str(args.options, "scene-file", true)!, "utf8");
  parseSceneText(text);
  const revision = str(args.options, "revision", true)!;
  if (!/^[a-f0-9]{32}$/.test(revision)) throw new CliError("--revision 必须是 scenes get 返回的 scene_revision");
  return { method: "PATCH", path: `/api/assets/${id(args.words[2])}`, body: {
    text_content: text, scene_revision: revision, ...(str(args.options, "name") === undefined ? {} : { name: str(args.options, "name") }),
  } };
}

export function selectAsset(response: unknown, assetId: string) {
  const rows = object(response).data;
  if (!Array.isArray(rows)) throw new CliError("服务端素材列表格式不正确", 1);
  const row = rows.find((row) => row.id === assetId);
  if (!row) throw new CliError("指定范围内没有找到素材", 1);
  return { data: row };
}
