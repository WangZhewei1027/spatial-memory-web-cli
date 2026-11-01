import { randomUUID } from "node:crypto";
import type { AuthoringOptions, SceneDocument } from "@spatial-memory/scene-authoring";
import { join, resolve } from "node:path";
import { check, id, lockVersion, str, type Args } from "./args.js";
import { authoring, parseDocument, result } from "./authoring.js";
import { resolveResources } from "./asset-agent.js";
import { type Client } from "./client.js";
import { CliError, object } from "./errors.js";
import { atomicJson, hash, jsonInput, nonnegative, readJson } from "./local.js";
import { renderScene, type CameraView, type RenderResource } from "./render.js";
import { mutateRun, readRun, recordRunArtifact, runSummary, type RemoteScene } from "./runs.js";

const sourceFlags = ["run", "runs-dir", "scene-file", "revision"];
async function source(args: Args) {
  if (!args.options.run === !args.options["scene-file"]) throw new CliError("需要且只能指定 --run 或 --scene-file");
  if (args.options.run) {
    const state = await readRun(args);
    if (args.options.revision !== undefined && state.revision !== nonnegative(str(args.options, "revision"), "revision")) throw new CliError("草稿 revision 冲突", 1, { actual: state.revision });
    return { document: state.document, state };
  }
  return { document: parseDocument(await readJson(str(args.options, "scene-file", true)!)) };
}
function time(value: string): number {
  const n = Number(value); if (!value.trim() || !Number.isFinite(n) || n < 0) throw new CliError("采样时间需要非负有限数字"); return n;
}
async function facts(args: Args): Promise<AuthoringOptions> {
  if (!args.options.facts) return {};
  const raw = await jsonInput(str(args.options, "facts")!);
  const convert = (input: unknown): Record<string, unknown> => {
    const value = object(input);
    if (value.resourceFacts) return object(value.resourceFacts);
    const asset = value.asset && typeof value.asset === "object" ? object(value.asset) : undefined;
    const probe = value.probe && typeof value.probe === "object" ? object(value.probe) : value;
    const inspected = probe.facts && typeof probe.facts === "object" ? object(probe.facts) : undefined;
    if (asset && inspected && typeof asset.id === "string") return { [asset.id]: { ...inspected, assetId: asset.id, kind: asset.file_type, state: asset.state, name: asset.name } };
    return value;
  };
  const resources = Object.assign({}, ...((Array.isArray(raw) ? raw : [raw]).map(convert)));
  for (const [assetId, unknownFact] of Object.entries(resources)) {
    const fact = object(unknownFact);
    resources[assetId] = { ...fact, assetId: fact.assetId ?? assetId, animations: Array.isArray(fact.animations) ? fact.animations.map(value => { const clip = object(value); return { ...clip, duration: clip.duration ?? clip.duration_seconds }; }) : undefined };
  }
  return { resources } as AuthoringOptions;
}
function automaticTimes(document: SceneDocument): number[] {
  const points = new Set<number>([0]);
  const end = document.content.durationSeconds;
  const add = (value: number | null | undefined) => { if (typeof value === "number" && Number.isFinite(value) && value >= 0 && (end === null || value <= end)) points.add(value); };
  add(end);
  for (const node of [...(document.content.groups ?? []), ...document.content.instances]) {
    for (const keys of Object.values(node.tracks ?? {})) for (const key of keys ?? []) add(key.time);
    if ("timing" in node && node.timing) { add(node.timing.startSeconds); add(node.timing.endSeconds); add(node.timing.startSeconds + node.timing.fadeInSeconds); if (node.timing.endSeconds !== null) add(node.timing.endSeconds - node.timing.fadeOutSeconds); }
    if ("animation" in node && node.animation) add(node.animation.startSeconds);
  }
  const boundaries = [...points].sort((a, b) => a - b);
  for (let index = 1; index < boundaries.length; index++) points.add((boundaries[index - 1] + boundaries[index]) / 2);
  return [...points].sort((a, b) => a - b);
}
export async function sceneAgentCommand(args: Args, client: Client): Promise<unknown> {
  const action = args.words[1];
  if (action === "diff") {
    check(args, 4);
    return result(authoring.diff(await readJson(args.words[2]), await readJson(args.words[3])));
  }
  if (action === "apply") {
    check(args, 2, [...sourceFlags, "ops", "out", "facts"]);
    const operations = await jsonInput(str(args.options, "ops", true)!);
    const options = await facts(args);
    const apply = (document: unknown) => result(authoring.apply(document, operations, options));
    if (args.options.run && !args.options["dry-run"]) {
      if (args.options["scene-file"] || args.options.out) throw new CliError("--run 编排写入草稿，不接受 --scene-file 或 --out");
      let applied: Record<string, unknown> = {};
      const state = await mutateRun(args, async (current) => {
        applied = apply(current.document);
        return { document: parseDocument(applied.document), event: "apply", details: { operations, changes: applied.changes } };
      });
      return { ...applied, ...runSummary(state) };
    }
    const { document, state } = await source(args);
    const applied = apply(document);
    const out = str(args.options, "out");
    if (!args.options["dry-run"]) {
      if (!out) throw new CliError("文件编排需要 --out，或使用 --dry-run 仅检查结果");
      await atomicJson(resolve(out), applied.document);
    }
    return { ...applied, ...(state ? runSummary(state) : {}), documentHash: hash(applied.document), ...(out ? { file: resolve(out) } : {}) };
  }
  if (["inspect", "sample", "render", "validate"].includes(action)) {
    const allowed = [...sourceFlags, "facts", ...(action === "validate" ? ["remote", "org"] : []), ...(action === "sample" ? ["time"] : []), ...(action === "render" ? ["times", "cameras", "camera-file", "width", "height", "overlays", "output-dir", "resources"] : [])];
    // Retain the existing `scenes validate file.json` form.
    const positional = action === "validate" && args.words.length === 3;
    check(args, positional ? 3 : 2, allowed);
    const scoped: Args = positional ? { ...args, options: { ...args.options, "scene-file": args.words[2] } } : args;
    const { document, state } = await source(scoped), documentHash = hash(document);
    const context = state ? runSummary(state) : { documentHash };
    const options = await facts(args);
    if (action === "validate") {
      const local = { ...result(authoring.validate(document, options)), valid: true, ...context };
      if (!args.options.remote) return local;
      if (state?.remote && state.remote.baseUrl !== client.settings.baseUrl) throw new CliError("草稿关联其他服务地址，请使用原 --base-url");
      const org = str(args.options, "org") ?? state?.remote?.org;
      if (!org) throw new CliError("服务端预检需要 --org 或从远端打开的团队草稿");
      const plan = { method: "POST", path: `/api/organizations/${id(org)}/scenes/validate`, body: { document, ...(state?.remote ? { sceneId: state.remote.id, expectedLockVersion: state.remote.lockVersion } : {}) } };
      if (args.options["dry-run"]) return { ...local, remote: plan };
      await client.load(); return { ...local, remote: await client.request(plan) };
    }
    if (action === "inspect") return { ...result(authoring.inspect(document, options)), ...context };
    if (action === "sample") return { ...result(authoring.sample(document, { time: time(str(args.options, "time", true)!), ...options })), ...context };
    const auto = str(args.options, "times") === "auto";
    const times = auto ? automaticTimes(document) : (str(args.options, "times") ?? "0").split(",").map(time);
    if (args.options.cameras && args.options["camera-file"]) throw new CliError("--cameras 和 --camera-file 只能指定一个");
    const cameraSource = str(args.options, "camera-file") ?? str(args.options, "cameras") ?? "audience,top,side";
    let cameras: (string | CameraView)[];
    if (cameraSource.startsWith("@")) { const raw = await jsonInput(cameraSource); if (!Array.isArray(raw)) throw new CliError("相机文件需要 JSON 数组"); cameras = raw; }
    else cameras = cameraSource.split(",");
    const dimension = (flag: string) => { const value = str(args.options, flag); if (value === undefined) return undefined; const n = Number(value); if (!Number.isSafeInteger(n) || n <= 0) throw new CliError(`--${flag} 需要正整数`); return n; };
    const renderOptions = { documentHash, revision: state ? String(state.revision) : undefined, width: dimension("width"), height: dimension("height"), overlays: !!args.options.overlays, timeoutMs: client.settings.timeout };
    const outputDir = resolve(str(args.options, "output-dir") ?? join(".spatial-memory", "renders", randomUUID()));
    const sampling = { mode: auto ? "boundaries-and-midpoints" : "explicit", times, exhaustive: false, note: "抽样图片不证明整个连续时序都正确" };
    if (args.options["dry-run"]) return { ...context, sampling, times, cameras, options: renderOptions, outputDir, assets: document.content.assets };
    let resources: Record<string, RenderResource>;
    if (args.options.resources) resources = object(await jsonInput(str(args.options, "resources")!)) as unknown as Record<string, RenderResource>;
    else { await client.load(); resources = await resolveResources(client, document); }
    const rendered = { ...object(await renderScene({ document, resources, times, cameras, outputDir, options: renderOptions })), ...context, sampling };
    if (state) await recordRunArtifact(args, state, "render", rendered);
    return rendered;
  }
  if (action === "save" && args.options.run) {
    check(args, args.words.length === 3 ? 3 : 2, [...sourceFlags, "lock-version", "name", "org", "idempotency-key"]);
    if (args.options["scene-file"]) throw new CliError("--run 和 --scene-file 只能指定一个");
    const create = async (current: Awaited<ReturnType<typeof readRun>>, dryRun: boolean) => {
      if (current.remote && current.remote.baseUrl !== client.settings.baseUrl) throw new CliError("草稿关联其他服务地址，请使用原 --base-url");
      const targetId = args.words[2] ?? current.remote?.id;
      if (current.remote && targetId !== current.remote.id) throw new CliError("草稿已关联其他场景；复制草稿后另存");
      const expectedLockVersion = args.options["lock-version"] !== undefined ? lockVersion(args) : current.remote?.lockVersion;
      const name = str(args.options, "name");
      let plan;
      if (targetId) {
        if (expectedLockVersion === undefined) throw new CliError("首次保存到已有场景需要 --lock-version");
        plan = { method: "PATCH", path: `/api/scenes/${id(targetId)}`, body: { document: current.document, expectedLockVersion, ...(name ? { name } : {}) } };
      } else {
        const org = str(args.options, "org", true)!;
        if (!name) throw new CliError("新场景需要 --name");
        // Stable for retries of the same draft revision, including an ambiguous server response.
        const idempotencyKey = str(args.options, "idempotency-key") ?? hash({ runId: current.id, revision: current.revision, documentHash: current.documentHash });
        plan = { method: "POST", path: `/api/organizations/${id(org)}/scenes`, body: { name, document: current.document, idempotencyKey } };
      }
      if (dryRun) return { plan };
      await client.load();
      const response = await client.request(plan), data = object(object(response).data);
      if (typeof data.id !== "string" || !Number.isSafeInteger(data.lock_version)) throw new CliError("保存响应缺少场景 ID/lock_version；请查询远端后恢复", 1, { response });
      const remote: RemoteScene = { id: data.id, lockVersion: data.lock_version as number, baseUrl: client.settings.baseUrl, org: str(args.options, "org") ?? current.remote?.org };
      return { response, remote };
    };
    if (args.options["dry-run"]) return { ...runSummary((await source(args)).state!), ...await create(await readRun(args), true) };
    let response: unknown;
    const saved = await mutateRun(args, async (state) => { const result = await create(state, false); response = result.response; return { remote: result.remote, event: "save", details: { remote: result.remote } }; });
    return { ...runSummary(saved), response };
  }
  throw new CliError("不支持的本地场景命令");
}
