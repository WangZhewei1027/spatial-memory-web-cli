import { parseArgs } from "node:util";
import { readFile } from "node:fs/promises";
import { CliError, object } from "./errors.js";

const strings = ["base-url", "config", "timeout", "account", "provider", "login-timeout", "data", "org", "collection", "type", "name", "text", "scene-file", "lock-version", "idempotency-key", "mime", "run", "runs-dir", "revision", "scene", "ops", "out", "time", "times", "cameras", "camera-file", "width", "height", "facts", "output-dir", "resources", "limit", "search", "cache-dir", "source-page", "resume"];
const flags = ["help", "version", "compact", "verbose", "dry-run", "password-stdin", "no-browser", "remote", "overlays"];
export type Options = Record<string, string | boolean | string[] | undefined>;
export interface Args { words: string[]; options: Options }

export function parse(argv: string[]): Args {
  try {
    const { positionals, values } = parseArgs({ args: argv, allowPositionals: true, strict: true, options: {
      ...Object.fromEntries(strings.map((key) => [key, { type: "string" as const }])),
      ...Object.fromEntries(flags.map((key) => [key, { type: "boolean" as const }])),
      query: { type: "string", multiple: true }, help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
    } });
    return { words: positionals, options: values };
  } catch (error) { throw new CliError((error as Error).message); }
}

export function str(options: Options, key: string, required = false): string | undefined {
  const value = options[key];
  if (required && (typeof value !== "string" || !value.trim())) throw new CliError(`缺少 --${key}`);
  return typeof value === "string" ? value : undefined;
}

export function check(args: Args, count: number, allowed: string[] = []) {
  if (args.words.length !== count) throw new CliError("命令参数数量不正确，运行 --help 查看用法");
  const common = ["base-url", "config", "timeout", "help", "compact", "verbose", "dry-run"];
  for (const key of Object.keys(args.options)) {
    if (![...common, ...allowed].includes(key)) throw new CliError(`此命令不支持 --${key}`);
  }
}

export async function stdinText(): Promise<string> {
  let text = "";
  for await (const chunk of process.stdin) text += chunk.toString();
  return text;
}

export async function jsonData(source: string): Promise<Record<string, unknown>> {
  const text = source === "-" ? await stdinText() : source.startsWith("@") ? await readFile(source.slice(1), "utf8") : source;
  try { return object(JSON.parse(text)); }
  catch { throw new CliError("--data 必须为 JSON 对象、@文件路径或 -（标准输入）"); }
}

export function withQuery(path: string, options: Options, mapped: Record<string, string | undefined> = {}) {
  const url = new URL(path, "http://cli.invalid");
  for (const [key, value] of Object.entries(mapped)) if (value !== undefined) url.searchParams.set(key, value);
  for (const pair of (options.query as string[] | undefined) ?? []) {
    const index = pair.indexOf("=");
    if (index < 1) throw new CliError("--query 使用 key=value 格式");
    url.searchParams.append(pair.slice(0, index), pair.slice(index + 1));
  }
  // Do not normalize away an unsafe origin before the HTTP client validates it.
  if (!path.startsWith("/api/") || url.origin !== "http://cli.invalid" || !url.pathname.startsWith("/api/") || path.includes("\\") || url.hash) {
    throw new CliError("API 路径必须是当前服务下的 /api/…");
  }
  return url.pathname + url.search;
}

export function id(value: string): string {
  if (!/^[a-z0-9_-]+$/i.test(value)) throw new CliError("ID 只能包含字母、数字、下划线和连字符");
  return encodeURIComponent(value);
}

export function lockVersion(args: Args): number {
  const value = str(args.options, "lock-version", true)!;
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw new CliError("--lock-version 必须是读取响应中的非负整数 lock_version");
  return Number(value);
}
