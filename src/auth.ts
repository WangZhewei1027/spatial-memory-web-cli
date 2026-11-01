import { check, str, type Args } from "./args.js";
import { Client } from "./client.js";
import { CliError, object } from "./errors.js";
import { cookieHeader } from "./cookies.js";
import { password } from "./password.js";
import { PHONE_EMAIL_DOMAIN } from "./contract.js";

export async function authCommand(args: Args, client: Client) {
  const action = args.words[1];
  if (!["login", "logout", "status"].includes(action)) throw new CliError("auth 支持 login、logout、status");
  check(args, 2, action === "login" ? ["account", "password-stdin"] : []);
  if (args.options["dry-run"]) throw new CliError("auth 命令不支持 --dry-run");
  if (action === "status") return client.request({ method: "GET", path: "/api/users/me" });
  if (action === "logout") {
    await client.request({ method: "POST", path: "/api/auth/sign-out", body: {} });
    client.cookies = [];
    await client.save();
    return { success: true, baseUrl: client.settings.baseUrl };
  }
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
