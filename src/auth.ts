import { check, str, type Args } from "./args.js";
import { Client } from "./client.js";
import { CliError, object } from "./errors.js";
import { cookieHeader } from "./cookies.js";
import { password } from "./password.js";
import { PHONE_EMAIL_DOMAIN } from "./contract.js";
import { googleLogin } from "./google-auth.js";

export async function authCommand(args: Args, client: Client) {
  const action = args.words[1];
  if (!["login", "logout", "status"].includes(action)) throw new CliError("auth 支持 login、logout、status");
  check(args, 2, action === "login" ? ["account", "password-stdin", "provider", "no-browser", "login-timeout"] : []);
  if (args.options["dry-run"]) throw new CliError("auth 命令不支持 --dry-run");
  if (action === "status") return client.request({ method: "GET", path: "/api/users/me" });
  if (action === "logout") {
    await client.request({ method: "POST", path: "/api/auth/sign-out", body: {} });
    client.cookies = [];
    await client.save();
    return { success: true, baseUrl: client.settings.baseUrl };
  }
  const provider = str(args.options, "provider") ?? "password";
  if (provider !== "google" && provider !== "password") throw new CliError("--provider 仅支持 google 或 password");
  if (provider === "google") {
    if (args.options.account !== undefined || args.options["password-stdin"] !== undefined) throw new CliError("Google 登录不能同时使用 --account 或 --password-stdin");
    const timeout = Number(str(args.options, "login-timeout") ?? 300000);
    if (!Number.isInteger(timeout) || timeout < 1 || timeout > 2147483647) throw new CliError("--login-timeout 必须为 1..2147483647 毫秒");
    return googleLogin(client, { noBrowser: !!args.options["no-browser"], timeout });
  }
  if (args.options["no-browser"] !== undefined || args.options["login-timeout"] !== undefined) throw new CliError("--no-browser 和 --login-timeout 仅用于 --provider google");
  const account = str(args.options, "account", true)!.trim();
  const secret = await password(!!args.options["password-stdin"]);
  if (!secret) throw new CliError("密码不能为空");
  client.cookies = [];
  const response = object(await client.request({ method: "POST", path: "/api/auth/sign-in/email", body: {
    email: /^1\d{10}$/.test(account) ? `${account}@${PHONE_EMAIL_DOMAIN}` : account, password: secret,
  } }));
  if (!cookieHeader(client.cookies, client.url("/api/users/me"))) throw new CliError("登录未获得可用会话，请检查服务的 HTTPS / Cookie 配置", 1);
  const user = object(response.user);
  return { success: true, baseUrl: client.settings.baseUrl, user: { id: user.id, name: user.name, account } };
}
