import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { type Cookie } from "./cookies.js";
import { CliError } from "./errors.js";
import { type Options, str } from "./args.js";

interface Config { version: 1; sessions: Record<string, Cookie[]> }

export function settings(options: Options) {
  const input = str(options, "base-url") ?? process.env.SPATIAL_MEMORY_BASE_URL ?? "http://localhost:3000";
  let url: URL;
  try { url = new URL(input); } catch { throw new CliError("--base-url 必须是有效的 HTTP(S) 服务地址"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new CliError("--base-url 只接受 HTTP(S) origin，例如 http://localhost:3000");
  }
  const timeout = Number(str(options, "timeout") ?? 30000);
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 2147483647) throw new CliError("--timeout 必须为 1..2147483647 毫秒");
  return { baseUrl: url.origin, timeout, configPath: str(options, "config") ?? process.env.SPATIAL_MEMORY_CLI_CONFIG ?? join(homedir(), ".config", "spatial-memory", "sessions.json") };
}

export async function readConfig(path: string): Promise<Config> {
  try {
    const value = JSON.parse(await readFile(path, "utf8"));
    if (value.version !== 1 || !value.sessions || typeof value.sessions !== "object" || Array.isArray(value.sessions)) throw new Error();
    for (const cookies of Object.values(value.sessions)) {
      if (!Array.isArray(cookies) || cookies.some((c) => !c || typeof c.name !== "string" || typeof c.value !== "string" || typeof c.path !== "string" || typeof c.secure !== "boolean" || (c.expires !== undefined && !Number.isFinite(c.expires)))) throw new Error();
    }
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, sessions: {} };
    throw new CliError(`无法读取会话文件 ${path}，请检查权限或 JSON 格式`);
  }
}

export async function saveCookies(path: string, origin: string, cookies: Cookie[]) {
  const config = await readConfig(path);
  if (cookies.length) config.sessions[origin] = cookies;
  else delete config.sessions[origin];
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, JSON.stringify(config, null, 2) + "\n", { mode: 0o600, flag: "wx" });
    await chmod(temp, 0o600);
    await rename(temp, path);
  } finally { await rm(temp, { force: true }); }
}
