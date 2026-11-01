import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type ServerResponse } from "node:http";
import { Client } from "./client.js";
import { cookieHeader } from "./cookies.js";
import { CliError, HttpError } from "./errors.js";
import { openBrowser } from "./browser.js";

const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const validToken = (value: string): boolean => value.length === 43 && tokenPattern.test(value);
const record = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

function reply(response: ServerResponse, status: number, text: string, done?: () => void) {
  response.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'", "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff", Connection: "close",
  });
  response.end(text, done);
}

async function listenForCode(expectedState: string, signal: AbortSignal) {
  let host = "", settled = false;
  let complete!: (code: string) => void, fail!: (error: unknown) => void;
  const code = new Promise<string>((resolve, reject) => { complete = resolve; fail = reject; });
  // Abort can arrive while the browser launcher is still starting.
  void code.catch(() => {});
  const server = createServer((request, response) => {
    if (request.method !== "GET") { reply(response, 405, "Method not allowed"); return; }
    if (request.headers.host !== host) { reply(response, 403, "Invalid callback host"); return; }
    const raw = request.url ?? "";
    if (raw.length > 2048 || !raw.startsWith("/") || raw.startsWith("//") || request.headers["transfer-encoding"] || Number(request.headers["content-length"] ?? 0) !== 0) { reply(response, 400, "Invalid callback"); return; }
    let url: URL;
    try { url = new URL(raw, `http://${host}`); } catch { reply(response, 400, "Invalid callback"); return; }
    if (url.origin !== `http://${host}` || url.pathname !== "/callback" || url.hash) { reply(response, 404, "Not found"); return; }
    const fields = [...url.searchParams.keys()];
    const state = url.searchParams.get("state") ?? "", grant = url.searchParams.get("code"), error = url.searchParams.get("error");
    if (fields.length !== 2 || new Set(fields).size !== 2 || fields.some(key => !["code", "state", "error"].includes(key)) || !validToken(state) || !timingSafeEqual(Buffer.from(state), Buffer.from(expectedState)) || (grant === null ? error !== "access_denied" : error !== null || !validToken(grant))) {
      reply(response, 400, "Invalid login response; return to the authorization page"); return;
    }
    if (settled) { reply(response, 409, "Login response already received"); return; }
    settled = true;
    if (error) reply(response, 200, "已取消 Google 登录，可以关闭此页面。", () => fail(new CliError("已取消 Google 登录", 130)));
    else reply(response, 200, "已收到授权，请返回终端查看登录结果。可以关闭此页面。", () => complete(grant!));
  });
  server.requestTimeout = 5000; server.headersTimeout = 5000; server.maxHeadersCount = 32;
  server.on("error", () => fail(new CliError("无法启动本机登录回调，请重试", 1)));
  const abort = () => fail(signal.reason);
  signal.addEventListener("abort", abort, { once: true });
  const close = async () => {
    signal.removeEventListener("abort", abort);
    server.closeAllConnections();
    if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()));
  };
  try {
    signal.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => { server.off("error", reject); resolve(); });
    });
    signal.throwIfAborted();
    const address = server.address();
    if (!address || typeof address === "string") throw new CliError("无法启动本机登录回调", 1);
    host = `127.0.0.1:${address.port}`;
    return { redirectUri: `http://${host}/callback`, code, close };
  } catch (error) { await close(); throw error; }
}

export async function googleLogin(client: Client, options: { noBrowser: boolean; timeout: number }) {
  const base = new URL(client.settings.baseUrl);
  if (base.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(base.hostname)) throw new CliError("Google 登录仅支持 HTTPS 服务或 localhost/127.0.0.1/::1 本地服务");
  const controller = new AbortController();
  const cancel = () => controller.abort(new CliError("已取消 Google 登录", 130));
  const timer = setTimeout(() => controller.abort(new CliError("Google 登录超时，请重新运行登录命令", 1)), options.timeout);
  process.once("SIGINT", cancel);
  const verifier = randomBytes(32).toString("base64url"), state = randomBytes(32).toString("base64url");
  let listener: Awaited<ReturnType<typeof listenForCode>> | undefined;
  try {
    listener = await listenForCode(state, controller.signal);
    const authorize = new URL("/auth/cli", base);
    authorize.searchParams.set("redirect_uri", listener.redirectUri);
    authorize.searchParams.set("code_challenge", createHash("sha256").update(verifier).digest("base64url"));
    authorize.searchParams.set("state", state);
    process.stderr.write(`请在此电脑的浏览器中通过 Google 登录并授权 CLI：\n${authorize.href}\n`);
    if (!options.noBrowser && !await openBrowser(authorize.href, undefined, controller.signal) && !controller.signal.aborted) process.stderr.write("无法自动打开浏览器，请手动打开上面的地址。\n");
    const code = await listener.code;
    const temporary = new Client({ ...client.settings, persistCookies: false });
    const exchanged = record(await temporary.request({ method: "POST", path: "/api/auth/cli/exchange", body: { code, codeVerifier: verifier, redirectUri: listener.redirectUri } }, controller.signal));
    const user = record(exchanged?.user);
    if (typeof user?.id !== "string" || !user.id || !cookieHeader(temporary.cookies, temporary.url("/api/users/me"))) throw new CliError("Google 登录未获得有效会话，请检查服务的 HTTPS / Cookie 配置", 1);
    const profile = record(record(await temporary.request({ method: "GET", path: "/api/users/me" }, controller.signal))?.data);
    if (profile?.user_id !== user.id || typeof profile.name !== "string" || typeof profile.email !== "string") throw new CliError("Google 登录身份验证失败，原有会话未更改", 1);
    controller.signal.throwIfAborted();
    await temporary.save();
    client.cookies = temporary.cookies;
    return { success: true, baseUrl: client.settings.baseUrl, provider: "google", user: { id: user.id, name: profile.name, email: profile.email } };
  } catch (error) {
    if (controller.signal.aborted) throw controller.signal.reason;
    // Authentication responses may contain credentials. Never echo their payload or message.
    if (error instanceof HttpError) throw new CliError(`Google 登录失败（HTTP ${error.status}），请重新授权`, error.exitCode);
    if (error instanceof CliError) throw error;
    throw new CliError("无法完成 Google 登录，请重试", 1);
  } finally {
    clearTimeout(timer); process.off("SIGINT", cancel);
    await listener?.close();
  }
}
