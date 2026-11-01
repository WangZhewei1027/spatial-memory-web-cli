import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import { check, id, jsonData, str, withQuery, type Args } from "./args.js";
import { Client } from "./client.js";
import { UPLOAD_SOURCE_MAX_MB } from "./contract.js";
import { CliError, HttpError, object } from "./errors.js";
import { acquireLock, atomicJson, hash } from "./local.js";
import { probeAsset, type RenderResource } from "./render.js";
import { uploadCommand } from "./upload.js";

function cacheDir(args: Args) { return resolve(str(args.options, "cache-dir") ?? ".spatial-memory/cache"); }
function unwrap(value: unknown) { return object(object(value).data); }
function primary(asset: Record<string, unknown>): Record<string, unknown> | undefined {
  return Array.isArray(asset.resources) ? asset.resources.map(object).find((resource) => resource.role === "primary" && resource.ordinal === 0) : undefined;
}
export async function getAsset(client: Client, assetId: string): Promise<Record<string, unknown>> {
  return unwrap(await client.request({ method: "GET", path: `/api/assets/${id(assetId)}` }));
}
export async function resolveResources(client: Client, document: { content: { assets: Record<string, { assetId: string }> } }): Promise<Record<string, RenderResource>> {
  const resources: Record<string, RenderResource> = {};
  // Sequential requests keep resource discovery within ordinary API load.
  for (const [alias, ref] of Object.entries(document.content.assets)) {
    const asset = await getAsset(client, ref.assetId), resource = primary(asset);
    if (!resource || typeof resource.url !== "string" || !["model", "image", "video", "audio"].includes(String(asset.file_type))) throw new CliError(`素材 ${ref.assetId} 没有可渲染的 primary 资源`, 1);
    const payload = object(asset.payload);
    resources[alias] = { assetId: ref.assetId, url: resource.url, kind: asset.file_type as RenderResource["kind"], animations: Array.isArray(payload.animations) ? payload.animations : undefined, contentHash: typeof resource.content_hash === "string" ? resource.content_hash : undefined, name: typeof asset.name === "string" ? asset.name : null };
  }
  return resources;
}
export async function searchAssets(args: Args, client: Client): Promise<unknown> {
  check(args, 2, ["org", "collection", "type", "search", "query", "limit"]);
  const org = str(args.options, "org"), collection = str(args.options, "collection");
  if (!org === !collection) throw new CliError("需要且只能指定 --org 或 --collection");
  const requested = str(args.options, "limit");
  const limit = requested === undefined ? Infinity : Number(requested);
  if (!(limit > 0) || (!Number.isSafeInteger(limit) && limit !== Infinity)) throw new CliError("--limit 需要正整数");
  const base = withQuery(collection ? `/api/collections/${id(collection)}/assets` : `/api/organizations/${id(org!)}/assets`, args.options, { q: str(args.options, "search"), file_type: str(args.options, "type") });
  if (args.options["dry-run"]) return { method: "GET", path: base, pagination: { pageSize: 200, resultLimit: limit === Infinity ? null : limit } };
  const assets: unknown[] = [], seen = new Set<string>();
  let offset = 0, total = 0;
  do {
    const url = new URL(base, "http://cli.invalid");
    url.searchParams.set("offset", String(offset)); url.searchParams.set("limit", String(Math.min(200, limit - assets.length)));
    const page = object(await client.request({ method: "GET", path: url.pathname + url.search }));
    if (!Array.isArray(page.data)) throw new CliError("素材列表响应格式无效", 1);
    const pagination = object(page.page); total = Number(pagination.total);
    if (!Number.isFinite(total) || total < 0) throw new CliError("素材分页 total 无效", 1);
    if (!page.data.length) break;
    let added = 0;
    for (const value of page.data) {
      const asset = object(value), assetId = String(asset.id);
      if (seen.has(assetId)) continue;
      seen.add(assetId); added++;
      assets.push({ id: asset.id, name: asset.name, kind: asset.file_type, state: asset.state, lockVersion: asset.lock_version, payload: asset.payload, resources: asset.resources, capabilities: asset.capabilities });
    }
    offset += page.data.length;
    if (added === 0) throw new CliError("素材分页未前进，请重试", 1);
  } while (offset < total && assets.length < limit);
  return { data: assets, count: assets.length, total, complete: offset >= total, search: "name-substring" };
}
async function fileHash(path: string): Promise<string> {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest("hex");
}
export async function inspectAsset(args: Args, client: Client): Promise<unknown> {
  check(args, 3, ["type", "output-dir", "cache-dir"]);
  const source = args.words[2];
  if (args.options["dry-run"]) return { source, outputDir: str(args.options, "output-dir"), steps: ["resolve-file-or-asset", "probe", "cache-metadata"] };
  let path: string | undefined, url: string | undefined, asset: Record<string, unknown> | undefined, fingerprint: string;
  try { if ((await stat(source)).isFile()) path = resolve(source); } catch { /* An absent local path may be an asset ID. */ }
  if (path) fingerprint = await fileHash(path);
  else if (/^https?:\/\//i.test(source)) { url = source; fingerprint = hash({ url }); }
  else { asset = await getAsset(client, source); const resource = primary(asset); if (typeof resource?.url !== "string") throw new CliError("素材缺少 primary 文件", 1); url = resource.url; fingerprint = hash({ baseUrl: client.settings.baseUrl, id: asset.id, lockVersion: asset.lock_version, contentHash: resource.content_hash }); }
  const outputDir = resolve(str(args.options, "output-dir") ?? join(cacheDir(args), "probes", fingerprint));
  if (args.options["dry-run"]) return { source, path, url, outputDir, fingerprint };
  const probe = await probeAsset({ path, url, outputDir, kind: str(args.options, "type") ?? (asset ? String(asset.file_type) : undefined) });
  const report = object(probe), facts = object(report.facts);
  const resource = asset ? primary(asset) : undefined;
  const resourceFacts = asset && typeof asset.id === "string" ? { [asset.id]: { ...facts, assetId: asset.id, kind: asset.file_type, name: asset.name, state: asset.state } } : undefined;
  const inspected = { source, fingerprint, inspectedAt: new Date().toISOString(), asset, probe, resourceFacts };
  await atomicJson(join(outputDir, "inspection.json"), inspected);
  if (typeof resource?.content_hash === "string" && facts.sha256 !== resource.content_hash) throw new CliError("素材内容 hash 与记录不符", 1, { inspection: join(outputDir, "inspection.json"), expected: resource.content_hash, actual: facts.sha256 });
  if (Array.isArray(report.errors) && report.errors.length) throw new CliError("素材探测失败", 1, { inspection: join(outputDir, "inspection.json"), errors: report.errors });
  return inspected;
}
interface ImportState {
  version: 1; idempotencyKey: string; source: string; sourcePage?: string; inputHash: string; phase: "prepared" | "uploaded" | "created" | "complete" | "failed";
  path?: string; sourceProbe?: unknown; finalProbe?: unknown; resourceFacts?: unknown; result?: unknown; upload?: Record<string, unknown>;
  createRequest?: { path: string; body: Record<string, unknown> }; error?: unknown;
}
async function download(source: string, path: string, maxBytes: number, timeout: number): Promise<void> {
  let url = new URL(source);
  if (url.username || url.password) throw new CliError("素材 URL 不接受内嵌凭据");
  const controller = AbortSignal.timeout(timeout);
  let response: Response | undefined;
  for (let redirects = 0; redirects <= 5; redirects++) {
    if (!["http:", "https:"].includes(url.protocol)) throw new CliError("素材 URL 仅支持 HTTP(S)");
    // This request intentionally has no service cookies, origin, or authorization headers.
    response = await fetch(url, { redirect: "manual", signal: controller });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location"); await response.body?.cancel();
      if (!location || redirects === 5) throw new CliError("素材下载重定向过多或缺少 location", 1);
      url = new URL(location, url); if (url.username || url.password) throw new CliError("素材重定向不接受内嵌凭据"); continue;
    }
    break;
  }
  if (!response?.ok || !response.body) throw new CliError(`素材下载失败：HTTP ${response?.status}`, 1);
  const length = Number(response.headers.get("content-length"));
  if (length > maxBytes) { await response.body.cancel(); throw new CliError("下载文件超过当前素材上传上限"); }
  await mkdir(join(path, ".."), { recursive: true });
  const temp = `${path}.${randomUUID()}.part`, file = await open(temp, "wx", 0o600);
  let size = 0;
  try {
    for await (const chunk of response.body) { size += chunk.byteLength; if (size > maxBytes) throw new CliError("下载文件超过当前素材上传上限"); await file.writeFile(chunk); }
    if (size === 0) throw new CliError("下载文件为空");
    await file.close(); await rename(temp, path);
  } catch (error) { await file.close(); await rm(temp, { force: true }); throw error; }
}
async function checkModelDependencies(path: string) {
  const bytes = await readFile(path);
  if (bytes.subarray(0, 4).toString() === "glTF") return;
  let gltf: Record<string, unknown>;
  try { gltf = object(JSON.parse(bytes.toString("utf8"))); }
  catch { throw new CliError("glTF JSON 无效", 2, { code: "INVALID_MODEL" }); }
  const dependencies = [gltf.buffers, gltf.images].flatMap(value => Array.isArray(value) ? value : []).flatMap(value => {
    const uri = value && typeof value === "object" ? (value as Record<string, unknown>).uri : undefined;
    return typeof uri === "string" && !uri.startsWith("data:") ? [uri] : [];
  });
  if (dependencies.length) throw new CliError("glTF 包含外部文件，请收集依赖并转换成自包含 GLB 后导入", 2, { code: "MISSING_DEPENDENCIES", dependencies });
}
export async function importAsset(args: Args, client: Client, probe: typeof probeAsset = probeAsset): Promise<unknown> {
  check(args, 3, ["org", "type", "name", "mime", "data", "idempotency-key", "cache-dir", "source-page", "resume"]);
  const source = args.words[2], org = str(args.options, "org", true)!, kind = str(args.options, "type", true)!;
  const maxBytes = UPLOAD_SOURCE_MAX_MB[kind] * 1024 * 1024;
  if (!maxBytes) throw new CliError("import 支持 model/image/video/audio/document/anchor；text/link 使用 create");
  const key = str(args.options, "resume") ?? str(args.options, "idempotency-key") ?? randomUUID();
  const data = args.options.data ? await jsonData(str(args.options, "data")!) : {};
  const inputHash = hash({ baseUrl: client.settings.baseUrl, org: org.toLowerCase(), source, kind, name: str(args.options, "name"), mime: str(args.options, "mime"), data, sourcePage: str(args.options, "source-page") });
  const directory = join(cacheDir(args), "imports", hash({ baseUrl: client.settings.baseUrl, org: org.toLowerCase(), key }));
  const statePath = join(directory, "import.json");
  if (args.options["dry-run"]) return { source, organizationId: org, kind, idempotencyKey: key, statePath, steps: ["acquire", "probe", "upload-receipt", "create-asset"] };
  await mkdir(directory, { recursive: true });
  const lock = join(directory, ".lock");
  const release = await acquireLock(lock);
  let state: ImportState = { version: 1, idempotencyKey: key, source, sourcePage: str(args.options, "source-page"), inputHash, phase: "prepared" };
  const finish = async (extra: Record<string, unknown> = {}) => {
    if (["model", "image", "audio", "video"].includes(kind) && state.finalProbe === undefined) {
      state.phase = "created"; await atomicJson(statePath, state);
      const created = unwrap(state.result), returnedAsset = created.asset === undefined ? created : object(created.asset);
      if (typeof returnedAsset.id !== "string") throw new CliError("素材已提交，但响应缺少 assetId；请查询素材后恢复", 1);
      const asset = await getAsset(client, returnedAsset.id), resource = primary(asset);
      if (typeof resource?.url !== "string") throw new CliError("素材已创建，但缺少可探测的最终资源", 1, { assetId: returnedAsset.id });
      const final = object(await probe({ url: resource.url, kind, outputDir: join(directory, "final-probe") }));
      const finalFacts = object(final.facts);
      if (Array.isArray(final.errors) && final.errors.length) throw new CliError("素材已创建，但最终资源探测失败", 1, { assetId: returnedAsset.id, probe: final });
      if (typeof resource.content_hash === "string" && finalFacts.sha256 !== resource.content_hash) throw new CliError("最终资源内容 hash 与素材记录不符", 1, { assetId: returnedAsset.id, expected: resource.content_hash, actual: finalFacts.sha256 });
      state.finalProbe = { ...final, assetId: returnedAsset.id, assetLockVersion: asset.lock_version, contentHash: resource.content_hash };
      state.resourceFacts = { [returnedAsset.id]: { ...finalFacts, assetId: returnedAsset.id, kind: asset.file_type, state: asset.state, name: asset.name } };
    }
    state.phase = "complete"; delete state.error; await atomicJson(statePath, state);
    return { ...object(state.result), resourceFacts: state.resourceFacts, import: { idempotencyKey: key, statePath, sourceProbe: state.sourceProbe, finalProbe: state.finalProbe, ...extra } };
  };
  try {
    try { state = JSON.parse(await readFile(statePath, "utf8")) as ImportState; } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (state.inputHash !== inputHash) throw new CliError("同一幂等键的导入输入已改变，请恢复原参数或使用新键");
    if (state.phase === "complete" || state.phase === "created") return await finish({ reused: true });
    if (args.options.resume && state.createRequest) state.phase = "uploaded";
    if (state.phase === "uploaded" && state.createRequest) {
      state.result = await client.request({ method: "POST", ...state.createRequest }); state.phase = "created";
      await atomicJson(statePath, state); return await finish({ resumed: true });
    }
    const remote = /^https?:\/\//i.test(source);
    const file = remote ? join(directory, `source${extname(new URL(source).pathname) || ".bin"}`) : resolve(source);
    state.path = file; await atomicJson(statePath, state);
    if (remote) await download(source, file, maxBytes, client.settings.timeout);
    const info = await stat(file); if (!info.isFile() || info.size === 0 || info.size > maxBytes) throw new CliError("导入源不是非空文件或超过当前上传上限");
    if (kind === "model") await checkModelDependencies(file);
    try {
      state.sourceProbe = await probe({ path: file, kind, outputDir: join(directory, "source-probe") });
      const report = object(state.sourceProbe);
      if (["model", "image", "audio", "video"].includes(kind) && Array.isArray(report.errors) && report.errors.length) throw new CliError("素材探测失败，尚未上传", 2, report);
    } catch (error) {
      state.sourceProbe = { errors: [{ message: (error as Error).message }] };
      if (["model", "image", "audio", "video"].includes(kind)) throw error;
    }
    await atomicJson(statePath, state);
    const payload = data.payload === undefined ? { kind } : object(data.payload);
    const attributes = payload.attributes === undefined ? {} : object(payload.attributes);
    const sourceReport = state.sourceProbe && typeof state.sourceProbe === "object" ? state.sourceProbe as Record<string, unknown> : {};
    const facts = sourceReport.facts && typeof sourceReport.facts === "object" ? sourceReport.facts as Record<string, unknown> : {};
    const body = { ...data, payload: { ...payload, attributes: { ...attributes, ...(remote ? { source_url: source } : {}), ...(args.options["source-page"] ? { source_page_url: str(args.options, "source-page") } : {}) }, ...(kind === "model" && Array.isArray(facts.animations) ? { animations: facts.animations } : {}) } };
    const uploadArgs: Args = { words: ["assets", "upload", file], options: { org, type: kind, data: JSON.stringify(body), "idempotency-key": key, ...(args.options.name ? { name: args.options.name } : { name: remote ? basename(new URL(source).pathname) || kind : basename(file) }), ...(args.options.mime ? { mime: args.options.mime } : {}) } };
    const created = await uploadCommand(uploadArgs, client, async (uploaded) => { state = { ...state, ...uploaded, phase: "uploaded" }; await atomicJson(statePath, state); });
    state.result = created;
    state.phase = "created"; await atomicJson(statePath, state);
    return await finish();
  } catch (error) {
    const details = error instanceof CliError && error.details && typeof error.details === "object" ? error.details as Record<string, unknown> : {};
    const status = error instanceof HttpError ? error.status : typeof details.status === "number" ? details.status : undefined;
    if (!["uploaded", "created", "complete"].includes(state.phase) || (state.phase === "uploaded" && status && status >= 400 && status < 500 && status !== 408)) state.phase = "failed";
    state.error = { message: (error as Error).message, details }; await atomicJson(statePath, state);
    throw new CliError((error as Error).message, error instanceof CliError ? error.exitCode : 1, { ...details, idempotencyKey: key, statePath, phase: state.phase, hint: "用相同源、参数和 --idempotency-key 重试；uploaded 复用创建请求，created 仅重试最终资源探测；--resume KEY 显式重放已有创建请求" });
  } finally { await release(); }
}
