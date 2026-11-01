import { randomUUID } from "node:crypto";
import { check, id, jsonData, lockVersion, str, withQuery, type Args } from "./args.js";
import { CliError, object } from "./errors.js";
import { ALL_UPLOAD_TYPES } from "./contract.js";
import type { RequestPlan } from "./client.js";

export function assetListPlan(args: Args): RequestPlan {
  if (args.words[1] === "get") {
    check(args, 3, ["query"]);
    return { method: "GET", path: withQuery(`/api/assets/${id(args.words[2])}`, args.options) };
  }
  check(args, 2, ["collection", "org", "type", "query"]);
  const collection = str(args.options, "collection"), org = str(args.options, "org");
  if (!collection === !org) throw new CliError("需要且只能指定 --collection 或 --org");
  return { method: "GET", path: withQuery(collection ? `/api/collections/${id(collection)}/assets` : `/api/organizations/${id(org!)}/assets`, args.options, { file_type: str(args.options, "type") }) };
}

export async function assetBody(args: Args): Promise<Record<string, unknown>> {
  const data = str(args.options, "data");
  const body = data === undefined ? {} : await jsonData(data);
  const name = str(args.options, "name"), type = str(args.options, "type"), text = str(args.options, "text");
  if (name !== undefined) body.name = name;
  if (type !== undefined) body.fileType = type;
  if (!ALL_UPLOAD_TYPES.includes(body.fileType as typeof ALL_UPLOAD_TYPES[number])) throw new CliError(`素材需要有效的 --type 或 data.fileType：${ALL_UPLOAD_TYPES.join(", ")}`);
  if (text !== undefined && body.fileType !== "text" && body.fileType !== "anchor") throw new CliError("--text 只用于 text 或 anchor 素材");
  body.payload = { ...(body.payload === undefined ? { kind: body.fileType } : object(body.payload)), ...(text === undefined ? {} : { text }) };
  body.resources ??= [];
  body.idempotencyKey = str(args.options, "idempotency-key") ?? body.idempotencyKey ?? randomUUID();
  return body;
}

export async function assetCreatePlan(args: Args): Promise<RequestPlan> {
  check(args, 2, ["org", "data", "name", "type", "text", "idempotency-key"]);
  const org = id(str(args.options, "org", true)!);
  const body = await assetBody(args);
  if (typeof body.name !== "string" || !body.name.trim()) throw new CliError("创建素材需要 --name 或 data.name");
  return { method: "POST", path: `/api/organizations/${org}/assets`, body };
}

export function archivePlan(args: Args): RequestPlan {
  check(args, 3, ["lock-version"]);
  return { method: "DELETE", path: `/api/${args.words[0]}/${id(args.words[2])}?expectedLockVersion=${lockVersion(args)}` };
}
