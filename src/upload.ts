import { openAsBlob } from "node:fs";
import { stat } from "node:fs/promises";
import { basename, extname } from "node:path";
import { check, id, str, type Args } from "./args.js";
import { Client } from "./client.js";
import { CliError, HttpError, object } from "./errors.js";
import { assetBody } from "./assets.js";

const mimeTypes: Record<string, string> = {
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif",
  ".mp4": "video/mp4", ".webm": "video/webm", ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".wav": "audio/wav",
  ".pdf": "application/pdf", ".glb": "model/gltf-binary", ".gltf": "model/gltf+json",
};

export async function uploadCommand(args: Args, client: Client) {
  check(args, 3, ["workspace", "type", "name", "mime", "data"]);
  const workspace = id(str(args.options, "workspace", true)!);
  const file = args.words[2];
  const info = await stat(file);
  if (!info.isFile() || info.size === 0 || info.size > 5 * 1024 * 1024) throw new CliError("上传文件必须为非空文件，且不超过服务端限制 5 MiB");
  const body = await assetBody(args);
  if (["text", "link", "scene"].includes(body.file_type as string)) throw new CliError("text、link、scene 请使用 assets create");
  if (body.name === undefined) body.name = basename(file);
  const mime = str(args.options, "mime") ?? mimeTypes[extname(file).toLowerCase()] ?? "application/octet-stream";
  if (args.options["dry-run"]) return { baseUrl: client.settings.baseUrl, steps: [
    { method: "POST", path: "/api/upload", file, size: info.size, mime, type: body.file_type, workspace_id: workspace },
    { method: "POST", path: `/api/workspaces/${workspace}/assets`, body: { ...body, file_url: "<upload.url>", content_hash: "<upload.contentHash>" } },
  ] };
  const form = new FormData();
  form.set("file", await openAsBlob(file, { type: mime }), basename(file));
  form.set("type", body.file_type as string);
  form.set("workspace_id", workspace);
  const upload = object(await client.request({ method: "POST", path: "/api/upload", body: form }));
  if (typeof upload.url !== "string" || typeof upload.contentHash !== "string") throw new CliError("上传返回的数据格式不正确", 1, upload);
  try {
    return await client.request({ method: "POST", path: `/api/workspaces/${workspace}/assets`, body: { ...body, file_url: upload.url, content_hash: upload.contentHash } });
  } catch (error) {
    // Only compensate a definite rejection. A timed-out/5xx insert may have committed.
    if (upload.storagePath && error instanceof HttpError && error.status >= 400 && error.status < 500 && error.status !== 408) {
      try { await client.request({ method: "DELETE", path: `/api/upload?key=${encodeURIComponent(String(upload.storagePath))}` }); }
      catch { process.stderr.write("素材创建失败，文件清理也失败；请根据错误中的 storagePath 检查存储。\n"); }
    }
    throw new CliError((error as Error).message, error instanceof CliError ? error.exitCode : 1, {
      upload, status: error instanceof HttpError ? error.status : undefined, cause: error instanceof CliError ? error.details : undefined,
      hint: "若请求超时或返回 5xx，请先查询素材是否已创建，再决定重试或清理文件。",
    });
  }
}
