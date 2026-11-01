import { createHash, randomUUID } from "node:crypto";
import { readFile, mkdir, rename, writeFile, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { CliError } from "./errors.js";
import { stdinText } from "./args.js";

export function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
export async function readJson(path: string): Promise<unknown> {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch (error) { throw new CliError(`无法读取 JSON ${path}: ${(error as Error).message}`); }
}
export async function jsonInput(value: string): Promise<unknown> {
  try { return JSON.parse(value === "-" ? await stdinText() : value.startsWith("@") ? await readFile(value.slice(1), "utf8") : value); }
  catch (error) { throw new CliError(`JSON 输入无效: ${(error as Error).message}`); }
}
export async function atomicJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  try { await writeFile(temp, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 }); await rename(temp, path); }
  finally { await rm(temp, { force: true }); }
}
export function localPath(path: string): string { return resolve(path); }
export function nonnegative(value: string | undefined, flag: string): number {
  if (value === undefined || !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw new CliError(`--${flag} 需要非负整数`);
  return Number(value);
}

export async function acquireLock(path: string): Promise<() => Promise<void>> {
  try {
    await mkdir(path);
    await writeFile(`${path}/owner.json`, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }), { mode: 0o600 });
    return () => rm(path, { recursive: true, force: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    let owner: { pid?: unknown };
    try { owner = JSON.parse(await readFile(`${path}/owner.json`, "utf8")); } catch { throw new CliError(`锁尚未初始化或需要检查：${path}`, 1); }
    let processExists = true;
    if (Number.isSafeInteger(owner.pid) && Number(owner.pid) > 0) {
      try { process.kill(Number(owner.pid), 0); } catch (probe) { if ((probe as NodeJS.ErrnoException).code === "ESRCH") processExists = false; }
    }
    throw new CliError(processExists ? `操作正在执行：${path}` : `上次进程已结束；确认后清理残留锁目录：${path}`, 1, { ...owner, processExists, lockPath: path });
  }
}
