import { readConfig, saveCookies } from "./config.js";
import { cookieHeader, mergeCookies, type Cookie } from "./cookies.js";
import { CliError, HttpError } from "./errors.js";

export interface RequestPlan { method: string; path: string; body?: unknown }
interface ClientSettings { baseUrl: string; configPath: string; timeout: number; verbose?: boolean }

export class Client {
  cookies: Cookie[] = [];
  constructor(public readonly settings: ClientSettings) {}

  async load() { this.cookies = (await readConfig(this.settings.configPath)).sessions[this.settings.baseUrl] ?? []; }
  async save() { await saveCookies(this.settings.configPath, this.settings.baseUrl, this.cookies); }

  url(path: string) {
    const url = new URL(path, this.settings.baseUrl);
    if (!path.startsWith("/api/") || path.includes("\\") || url.origin !== this.settings.baseUrl || !url.pathname.startsWith("/api/") || url.hash) {
      throw new CliError("API 路径必须是当前服务下的 /api/…，不能携带 fragment");
    }
    return url;
  }

  async request(plan: RequestPlan): Promise<unknown> {
    const url = this.url(plan.path);
    const headers = new Headers({ Accept: "application/json", Origin: this.settings.baseUrl });
    const cookie = cookieHeader(this.cookies, url);
    if (cookie) headers.set("Cookie", cookie);
    const multipart = plan.body instanceof FormData;
    if (plan.body !== undefined && !multipart) headers.set("Content-Type", "application/json");
    const started = Date.now();
    let response: Response;
    let raw: string;
    try {
      response = await fetch(url, { method: plan.method, headers, redirect: "manual", signal: AbortSignal.timeout(this.settings.timeout),
        body: plan.body === undefined ? undefined : multipart ? plan.body as FormData : JSON.stringify(plan.body) });
      raw = await response.text();
    } catch (error) {
      const timeout = (error as Error).name === "TimeoutError" || (error as Error).name === "AbortError";
      throw new CliError(timeout ? `请求超时（${this.settings.timeout}ms）` : `无法连接 ${url.origin}，请确认 Web 服务已启动`, 1);
    }
    if (this.settings.verbose) process.stderr.write(`${plan.method} ${url.pathname} → ${response.status} (${Date.now() - started}ms)\n`);
    const updated = mergeCookies(this.cookies, response.headers);
    if (JSON.stringify(updated) !== JSON.stringify(this.cookies)) { this.cookies = updated; await this.save(); }
    if (response.status >= 300 && response.status < 400) {
      const location = new URL(response.headers.get("location") ?? "/", url);
      if (location.origin === url.origin && location.pathname.startsWith("/auth/login")) throw new HttpError(401, "会话缺失或过期，请先运行 auth login");
      throw new HttpError(response.status, "服务器返回重定向，请使用最终服务地址（CLI 不自动跟随重定向）");
    }
    let payload: unknown;
    try { payload = raw ? JSON.parse(raw) : null; }
    catch { throw new HttpError(response.status, "服务器未返回 JSON，请检查服务地址和代理配置"); }
    if (!response.ok) {
      const message = payload && typeof payload === "object" ? ((payload as Record<string, unknown>).error ?? (payload as Record<string, unknown>).message) : undefined;
      throw new HttpError(response.status, response.status === 401 ? "未登录或会话过期，请运行 auth login" : typeof message === "string" ? message : `HTTP ${response.status}`, payload);
    }
    return payload;
  }
}
