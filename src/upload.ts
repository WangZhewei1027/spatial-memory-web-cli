import { openAsBlob } from "node:fs";
import { stat } from "node:fs/promises";
import type { Stats } from "node:fs";
import { basename, extname } from "node:path";
import { check, id, str, type Args } from "./args.js";
import { Client, type RequestPlan } from "./client.js";
import { CliError, HttpError, object } from "./errors.js";
import { assetBody } from "./assets.js";
import { ALL_UPLOAD_TYPES, UPLOAD_SOURCE_MAX_MB } from "./contract.js";

const mimeTypes: Record<string, string> = {
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif",
  ".mp4": "video/mp4", ".webm": "video/webm", ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".wav": "audio/wav",
  ".pdf": "application/pdf", ".glb": "model/gltf-binary", ".gltf": "model/gltf+json",
};

const mimeFor = (args: Args, file: string) => str(args.options, "mime") ?? mimeTypes[extname(file).toLowerCase()] ?? "application/octet-stream";

function checkSource(info: Stats, type: string | undefined) {
  const limit = type === undefined ? undefined : UPLOAD_SOURCE_MAX_MB[type];
  if (type !== undefined && !limit) throw new CliError("text、link 请使用 assets create；场景使用 scenes create");
  if (!info.isFile() || info.size === 0 || (limit !== undefined && info.size > limit * 1024 * 1024)) {
    throw new CliError(limit === undefined ? "上传文件必须为非空文件" : `上传文件必须为非空文件，${type} 原文件不能超过 ${limit} MiB`);
  }
}

async function postUpload(client: Client, file: string, mime: string, fields: Record<string, string>) {
  const form = new FormData();
  form.set("file", await openAsBlob(file, { type: mime }), basename(file));
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return object(await client.request({ method: "POST", path: "/api/upload", body: form }));
}

/** POST /api/upload only: returns the receipt for `resources[].receiptId` without creating an asset. */
export async function uploadFileCommand(args: Args, client: Client) {
  check(args, 3, ["org", "collection", "type", "mime"]);
  const org = str(args.options, "org"), collection = str(args.options, "collection"), type = str(args.options, "type");
  if (!org === !collection) throw new CliError("需要且只能指定 --org 或 --collection");
  if (type !== undefined && !ALL_UPLOAD_TYPES.includes(type as typeof ALL_UPLOAD_TYPES[number])) throw new CliError(`--type 必须为 ${ALL_UPLOAD_TYPES.join(", ")}`);
  const file = args.words[2];
  const info = await stat(file);
  checkSource(info, type);
  const mime = mimeFor(args, file);
  const fields: Record<string, string> = {
    ...(type === undefined ? {} : { type }),
    ...(org ? { organization_id: id(org).toLowerCase() } : { workspace_id: id(collection!).toLowerCase() }),
    purpose: "asset",
  };
  if (args.options["dry-run"]) return { baseUrl: client.settings.baseUrl, method: "POST", path: "/api/upload", file, size: info.size, mime, ...fields };
  return postUpload(client, file, mime, fields);
}

/** DELETE /api/upload?key=: releases the caller's own unconsumed upload. */
export function uploadDeletePlan(args: Args): RequestPlan {
  check(args, 3);
  const key = args.words[2];
  if (!/^assets\/[^\\]+$/.test(key) || key.split("/").some((part) => !part || part === "." || part === "..")) throw new CliError("存储路径必须是上传回执中的 assets/… storagePath");
  return { method: "DELETE", path: `/api/upload?key=${encodeURIComponent(key)}` };
}

export async function uploadCommand(args: Args, client: Client, onUploaded?: (state: { upload: Record<string, unknown>; createRequest: { path: string; body: Record<string, unknown> } }) => Promise<void>) {
  check(args, 3, ["org", "type", "name", "mime", "data", "idempotency-key"]);
  const org = id(str(args.options, "org", true)!).toLowerCase();
  const file = args.words[2];
  const info = await stat(file);
  const body = await assetBody(args);
  checkSource(info, body.fileType as string);
  if (!Array.isArray(body.resources) || body.resources.length) throw new CliError("assets upload 的 resources 由上传回执生成，不接受 data.resources");
  if (body.name === undefined) body.name = basename(file);
  if (typeof body.name !== "string" || !body.name.trim()) throw new CliError("素材名称不能为空");
  const mime = mimeFor(args, file);
  const role = body.fileType === "anchor" ? "reference" : "primary";
  if (args.options["dry-run"]) return { baseUrl: client.settings.baseUrl, steps: [
    { method: "POST", path: "/api/upload", file, size: info.size, mime, type: body.fileType, organization_id: org, purpose: "asset" },
    { method: "POST", path: `/api/organizations/${org}/assets`, body: { ...body, resources: [{ role, receiptId: "<upload.data.id>" }] } },
  ] };
  const upload = await postUpload(client, file, mime, { type: body.fileType as string, organization_id: org, purpose: "asset" });
  const receipt = object(upload.data);
  if (typeof receipt.id !== "string" || receipt.organization_id !== org || typeof receipt.url !== "string") throw new CliError("上传回执格式或团队归属不正确", 1);
  const createBody = { ...body, resources: [{ role, receiptId: receipt.id }] };
  const createRequest = { path: `/api/organizations/${org}/assets`, body: createBody };
  await onUploaded?.({ upload, createRequest });
  try {
    return await client.request({ method: "POST", path: `/api/organizations/${org}/assets`, body: createBody });
  } catch (error) {
    // Only compensate a definite rejection. A timed-out/5xx insert may have committed.
    if (upload.storagePath && error instanceof HttpError && error.status >= 400 && error.status < 500 && error.status !== 408) {
      try { await client.request({ method: "DELETE", path: `/api/upload?key=${encodeURIComponent(String(upload.storagePath))}` }); }
      catch { process.stderr.write("素材创建失败，文件清理也失败；请根据错误中的 storagePath 检查存储。\n"); }
    }
    throw new CliError((error as Error).message, error instanceof CliError ? error.exitCode : 1, {
      upload, createRequest: { path: `/api/organizations/${org}/assets`, body: createBody }, status: error instanceof HttpError ? error.status : undefined, cause: error instanceof CliError ? error.details : undefined,
      hint: "若请求超时或返回 5xx，请先查询素材是否已创建，再决定重试或清理文件。",
    });
  }
}
