import { openAsBlob } from "node:fs";
import { stat } from "node:fs/promises";
import { basename, extname } from "node:path";
import { check, id, str, type Args } from "./args.js";
import { Client } from "./client.js";
import { CliError, HttpError, object } from "./errors.js";
import { assetBody } from "./assets.js";
import { UPLOAD_SOURCE_MAX_MB } from "./contract.js";

const mimeTypes: Record<string, string> = {
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif",
  ".mp4": "video/mp4", ".webm": "video/webm", ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".wav": "audio/wav",
  ".pdf": "application/pdf", ".glb": "model/gltf-binary", ".gltf": "model/gltf+json",
};

export async function uploadCommand(args: Args, client: Client, onUploaded?: (state: { upload: Record<string, unknown>; createRequest: { path: string; body: Record<string, unknown> } }) => Promise<void>) {
  check(args, 3, ["org", "type", "name", "mime", "data", "idempotency-key"]);
  const org = id(str(args.options, "org", true)!).toLowerCase();
  const file = args.words[2];
  const info = await stat(file);
  const body = await assetBody(args);
  const limit = UPLOAD_SOURCE_MAX_MB[body.fileType as string];
  if (!limit) throw new CliError("text、link 请使用 assets create；场景使用 scenes create");
  if (!info.isFile() || info.size === 0 || info.size > limit * 1024 * 1024) throw new CliError(`上传文件必须为非空文件，${body.fileType} 原文件不能超过 ${limit} MiB`);
  if (!Array.isArray(body.resources) || body.resources.length) throw new CliError("assets upload 的 resources 由上传回执生成，不接受 data.resources");
  if (body.name === undefined) body.name = basename(file);
  if (typeof body.name !== "string" || !body.name.trim()) throw new CliError("素材名称不能为空");
  const mime = str(args.options, "mime") ?? mimeTypes[extname(file).toLowerCase()] ?? "application/octet-stream";
  const role = body.fileType === "anchor" ? "reference" : "primary";
  if (args.options["dry-run"]) return { baseUrl: client.settings.baseUrl, steps: [
    { method: "POST", path: "/api/upload", file, size: info.size, mime, type: body.fileType, organization_id: org, purpose: "asset" },
    { method: "POST", path: `/api/organizations/${org}/assets`, body: { ...body, resources: [{ role, receiptId: "<upload.data.id>" }] } },
  ] };
  const form = new FormData();
  form.set("file", await openAsBlob(file, { type: mime }), basename(file));
  form.set("type", body.fileType as string);
  form.set("organization_id", org);
  form.set("purpose", "asset");
  const upload = object(await client.request({ method: "POST", path: "/api/upload", body: form }));
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
