import { randomUUID } from "node:crypto";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { check, id, str, type Args } from "./args.js";
import { authoring, parseDocument } from "./authoring.js";
import { type Client } from "./client.js";
import { CliError, object } from "./errors.js";
import { acquireLock, atomicJson, hash, nonnegative, readJson } from "./local.js";

export interface RemoteScene { id: string; lockVersion: number; baseUrl: string; org?: string }
export interface RunState {
  version: 1; id: string; revision: number; document: ReturnType<typeof authoring.createDocument>;
  documentHash: string; createdAt: string; event: string; previous?: string; file: string;
  remote?: RemoteScene; details?: unknown;
}
export function runsDir(args: Args) { return resolve(str(args.options, "runs-dir") ?? ".spatial-memory/runs"); }
function runDir(args: Args, name: string) { id(name); if (name === "." || name === "..") throw new CliError("run ID 无效"); return join(runsDir(args), name); }
export function runId(args: Args): string { return str(args.options, "run", true)!; }
export async function readRun(args: Args, name = runId(args)): Promise<RunState> {
  const state = object(await readJson(join(runDir(args, name), "head.json")));
  if (state.version !== 1 || state.id !== name || !Number.isSafeInteger(state.revision) || typeof state.file !== "string") throw new CliError("草稿记录无效");
  return { ...state, document: parseDocument(state.document) } as unknown as RunState;
}
export function runSummary(state: RunState) { return { runId: state.id, revision: state.revision, documentHash: state.documentHash, event: state.event, createdAt: state.createdAt, remote: state.remote }; }
export async function recordRunArtifact(args: Args, state: RunState, kind: string, artifact: unknown): Promise<void> {
  await atomicJson(join(runDir(args, state.id), "artifacts", `${Date.now()}-${randomUUID()}.json`), { ...runSummary(state), kind, artifact, recordedAt: new Date().toISOString() });
}
async function runArtifacts(args: Args, state: RunState): Promise<unknown[]> {
  const dir = join(runDir(args, state.id), "artifacts");
  let files: string[];
  try { files = await readdir(dir); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  return Promise.all(files.filter(file => file.endsWith(".json")).sort().map(file => readJson(join(dir, file))));
}
async function commit(args: Args, previous: RunState | undefined, state: Omit<RunState, "revision" | "documentHash" | "file" | "previous" | "createdAt" | "version">): Promise<RunState> {
  const revision = previous ? previous.revision + 1 : 0;
  const file = `${String(revision).padStart(8, "0")}-${randomUUID()}.json`;
  const next: RunState = { ...state, version: 1, revision, file, documentHash: hash(state.document), previous: previous?.file, createdAt: new Date().toISOString() };
  const dir = runDir(args, state.id);
  await mkdir(join(dir, "revisions"), { recursive: true });
  // An interrupted head replacement leaves an unreachable immutable revision, never a partial draft.
  await writeFile(join(dir, "revisions", file), JSON.stringify(next, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  await atomicJson(join(dir, "head.json"), next);
  return next;
}
export async function mutateRun(args: Args, operation: (state: RunState) => Promise<{ document?: RunState["document"]; remote?: RemoteScene; event: string; details?: unknown }>): Promise<RunState> {
  const name = runId(args), dir = runDir(args, name), expected = nonnegative(str(args.options, "revision"), "revision");
  const lock = join(dir, ".lock");
  const release = await acquireLock(lock);
  try {
    const current = await readRun(args);
    if (current.revision !== expected) throw new CliError("草稿 revision 冲突；先读取 runs status", 1, { expected, actual: current.revision });
    const change = await operation(current);
    return await commit(args, current, { id: name, document: parseDocument(change.document ?? current.document), remote: change.remote ?? current.remote, event: change.event, details: change.details });
  } finally { await release(); }
}
async function history(args: Args, state: RunState): Promise<RunState[]> {
  const entries = [state];
  const seen = new Set<string>();
  while (entries.at(-1)?.previous) {
    const file = entries.at(-1)!.previous!;
    if (!/^[0-9]+-[a-f0-9-]+\.json$/.test(file) || seen.has(file)) throw new CliError("草稿历史链无效");
    seen.add(file);
    entries.push(object(await readJson(join(runDir(args, state.id), "revisions", file))) as unknown as RunState);
  }
  return entries;
}
export async function runCommand(args: Args, client: Client): Promise<unknown> {
  const action = args.words[1];
  if (action === "open") {
    check(args, 2, ["run", "runs-dir", "scene", "scene-file"]);
    if (args.options.scene && args.options["scene-file"]) throw new CliError("--scene 和 --scene-file 只能指定一个");
    const name = str(args.options, "run") ?? randomUUID();
    if (args.options["dry-run"] && args.options.scene) return { runId: name, method: "GET", path: `/api/scenes/${id(str(args.options, "scene")!)}` };
    let document = authoring.createDocument(), remote: RemoteScene | undefined;
    if (args.options["scene-file"]) document = parseDocument(await readJson(str(args.options, "scene-file")!));
    if (args.options.scene) {
      await client.load();
      const data = object(object(await client.request({ method: "GET", path: `/api/scenes/${id(str(args.options, "scene")!)}` })).data);
      document = parseDocument(data.document);
      if (!Number.isSafeInteger(data.lock_version)) throw new CliError("场景响应缺少 lock_version", 1);
      remote = { id: str(args.options, "scene")!, lockVersion: data.lock_version as number, baseUrl: client.settings.baseUrl, org: typeof data.organization_id === "string" ? data.organization_id : undefined };
    }
    if (args.options["dry-run"]) return { runId: name, document, remote };
    await mkdir(runsDir(args), { recursive: true });
    try { await mkdir(runDir(args, name)); } catch { throw new CliError(`草稿 ${name} 已存在，选择其他 --run`); }
    return { ...runSummary(await commit(args, undefined, { id: name, document, remote, event: "open" })), document };
  }
  if (action === "status" || action === "history") {
    check(args, 3, ["runs-dir"]);
    const state = await readRun(args, args.words[2]);
    return action === "status" ? { ...runSummary(state), document: state.document } : { runId: state.id, history: (await history(args, state)).map(entry => ({ ...runSummary(entry), details: entry.details })), artifacts: await runArtifacts(args, state) };
  }
  if (action === "restore") {
    check(args, 4, ["runs-dir", "revision"]);
    const target = nonnegative(args.words[3], "restore target");
    const scoped = { ...args, options: { ...args.options, run: args.words[2] } };
    if (args.options["dry-run"]) {
      const state = await readRun(scoped), found = (await history(args, state)).find((entry) => entry.revision === target);
      if (!found) throw new CliError("找不到目标 revision");
      return { ...runSummary(state), restoreRevision: target, document: found.document };
    }
    const restored = await mutateRun(scoped, async (current) => {
      const found = (await history(args, current)).find((entry) => entry.revision === target);
      if (!found) throw new CliError("找不到目标 revision");
      // Keep the latest remote lock; restoring a document must not roll back concurrency metadata.
      return { document: found.document, event: "restore", details: { restoredRevision: target } };
    });
    return { ...runSummary(restored), document: restored.document };
  }
  throw new CliError("runs 支持 open/status/history/restore");
}
