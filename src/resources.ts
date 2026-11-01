import { check, id, jsonData, str, withQuery, type Args } from "./args.js";
import { CliError } from "./errors.js";
import type { RequestPlan } from "./client.js";

// This catalog mirrors existing routes; authorization stays on the server.
const routes: Record<string, [string, string, "required"?]> = {
  "orgs list": ["GET", "/api/organizations"],
  "orgs get": ["GET", "/api/organizations/:id"],
  "orgs create": ["POST", "/api/organizations", "required"],
  "orgs update": ["PUT", "/api/organizations/:id", "required"],
  "orgs delete": ["DELETE", "/api/organizations/:id"],
  "orgs members": ["GET", "/api/organizations/:id/members"],
  "collections list": ["GET", "/api/organizations/:org/collections"],
  "collections create": ["POST", "/api/organizations/:org/collections", "required"],
  "collections get": ["GET", "/api/collections/:id"],
  "collections update": ["PATCH", "/api/collections/:id", "required"],
  "collections archive": ["POST", "/api/collections/:id/archive"],
  "collections restore": ["DELETE", "/api/collections/:id/archive"],
  "assets update": ["PATCH", "/api/assets/:id", "required"],
  "assets duplicate": ["POST", "/api/assets/:id/duplicate", "required"],
  "assets usage": ["GET", "/api/assets/:id/usage"],
  "placements list": ["GET", "/api/collections/:collection/placements"],
  "placements create": ["POST", "/api/collections/:collection/placements", "required"],
  "placements get": ["GET", "/api/placements/:id"],
  "placements update": ["PATCH", "/api/placements/:id", "required"],
  "placements move": ["POST", "/api/placements/move", "required"],
  "placements copy": ["POST", "/api/placements/:id/copy", "required"],
  "assets matching": ["GET", "/api/assets/:id/matching"],
  "assets rebuild": ["POST", "/api/assets/:id/matching"],
  "scenes get": ["GET", "/api/scenes/:id"],
  "scenes list": ["GET", "/api/organizations/:org/scenes"],
  "scenes copy": ["POST", "/api/scenes/:id/copy", "required"],
  "users me": ["GET", "/api/users/me"],
  "users list": ["GET", "/api/users"],
  "users update": ["PUT", "/api/users/:id", "required"],
  "users create": ["POST", "/api/users", "required"],
  "users delete": ["DELETE", "/api/users/:id"],
  "users deletion-preview": ["GET", "/api/users/:id/deletion-preview"],
  "tags list": ["GET", "/api/tags"],
  "tags create": ["POST", "/api/tags", "required"],
  "tags update": ["PATCH", "/api/tags/:id", "required"],
  "tags delete": ["DELETE", "/api/tags/:id"],
  "logs list": ["GET", "/api/errors/logs"],
};

export async function resourcePlan(args: Args): Promise<RequestPlan | undefined> {
  const key = args.words.slice(0, 2).join(" ");
  const route = routes[key];
  if (!route) return undefined;
  const [method, template, data] = route;
  const hasId = template.includes(":id");
  const allowed = data ? ["data"] : [];
  if (method === "GET") allowed.push("query");
  if (template.includes(":org") || key === "tags list") allowed.push("org");
  if (template.includes(":collection") || key === "tags list") allowed.push("collection");
  check(args, hasId ? 3 : 2, allowed);
  let path = hasId ? template.replace(":id", id(args.words[2])) : template;
  const org = str(args.options, "org", template.includes(":org")), collection = str(args.options, "collection", template.includes(":collection"));
  if (org && template.includes(":org")) path = path.replace(":org", id(org));
  if (collection && template.includes(":collection")) path = path.replace(":collection", id(collection));
  if (key === "tags list" && (!org === !collection)) throw new CliError("tags list 需要且只能指定 --org 或 --collection");
  return { method, path: withQuery(path, args.options, key === "tags list" ? { organization_id: org, workspace_id: collection } : {}),
    body: data ? await jsonData(str(args.options, "data", true)!) : undefined };
}

export async function rawPlan(args: Args): Promise<RequestPlan> {
  check(args, 3, ["data", "query"]);
  const method = args.words[1].toUpperCase();
  if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method)) throw new CliError("api 支持 GET、POST、PUT、PATCH、DELETE");
  const data = str(args.options, "data");
  if (method === "GET" && data !== undefined) throw new CliError("GET 请使用 --query，不接受 --data");
  return { method, path: withQuery(args.words[2], args.options), body: data === undefined ? undefined : await jsonData(data) };
}
