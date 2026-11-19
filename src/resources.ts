import { check, id, jsonData, str, withQuery, type Args } from "./args.js";
import { CliError } from "./errors.js";
import type { RequestPlan } from "./client.js";

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
interface Route {
  method: Method;
  /** `:id` takes the positional argument; `:org`, `:collection` and `:activity` take the same-named options.
   *  A keyed map lists alternative paths, selected by exactly one of its option names. */
  path: string | Record<string, string>;
  data?: "required" | "optional";
  /** One positional argument: `true` when it fills `:id` or the body, otherwise the query parameter it fills. */
  arg?: true | string;
  /** One or more positional IDs joined with commas into this query parameter (`optional` allows none). */
  list?: { param: string; optional?: true };
  /** CLI option → query parameter. */
  params?: Record<string, string>;
  need?: string[];
  oneOf?: string[];
  /** Extra options read by `body`. */
  options?: string[];
  body?: (args: Args, arg: string | undefined) => Record<string, unknown>;
}

const placeholders = ["org", "collection", "activity"];
const scope = { org: "organization_id", collection: "workspace_id" };
const pin = (pinned: boolean) => (_: Args, arg: string | undefined) => ({ organizationId: arg, pinned });

// This catalog mirrors existing routes; authorization stays on the server.
const routes: Record<string, Route> = {
  "orgs list": { method: "GET", path: "/api/organizations" },
  "orgs get": { method: "GET", path: "/api/organizations/:id" },
  "orgs create": { method: "POST", path: "/api/organizations", data: "required" },
  "orgs update": { method: "PUT", path: "/api/organizations/:id", data: "required" },
  "orgs delete": { method: "DELETE", path: "/api/organizations/:id" },
  "orgs members": { method: "GET", path: "/api/organizations/:id/members" },
  "orgs placements": { method: "GET", path: "/api/organizations/:id/placements" },
  "orgs map-scan-model": { method: "GET", path: "/api/organizations/:id/map-scan-model" },
  "orgs pin": { method: "POST", path: "/api/organizations/pin", arg: true, body: pin(true) },
  "orgs unpin": { method: "POST", path: "/api/organizations/pin", arg: true, body: pin(false) },
  "members list": { method: "GET", path: "/api/organizations/:org/members" },
  "members add": { method: "POST", path: "/api/organizations/:org/members", data: "required" },
  "members update": { method: "PATCH", path: "/api/organizations/:org/members", data: "required" },
  "members remove": { method: "DELETE", path: "/api/organizations/:org/members", arg: "member_id" },
  "invitations list": { method: "GET", path: "/api/organizations/:org/invitations" },
  "invitations create": { method: "POST", path: "/api/organizations/:org/invitations", data: "optional" },
  "invitations revoke": { method: "DELETE", path: "/api/organizations/:org/invitations", arg: "invitation_id" },
  "invitations get": { method: "GET", path: "/api/invitations/:id" },
  "invitations accept": { method: "POST", path: "/api/invitations/:id" },
  "collections list": { method: "GET", path: "/api/organizations/:org/collections" },
  "collections create": { method: "POST", path: "/api/organizations/:org/collections", data: "required" },
  "collections get": { method: "GET", path: "/api/collections/:id" },
  "collections update": { method: "PATCH", path: "/api/collections/:id", data: "required" },
  "collections archive": { method: "POST", path: "/api/collections/:id/archive" },
  "collections restore": { method: "DELETE", path: "/api/collections/:id/archive" },
  "assets update": { method: "PATCH", path: "/api/assets/:id", data: "required" },
  "assets duplicate": { method: "POST", path: "/api/assets/:id/duplicate", data: "required" },
  "assets usage": { method: "GET", path: "/api/assets/:id/usage" },
  "assets matching": { method: "GET", path: "/api/assets/:id/matching" },
  "assets rebuild": { method: "POST", path: "/api/assets/:id/matching" },
  "assets by-hash": { method: "GET", path: "/api/assets/by-hash", arg: "hash", params: scope, oneOf: ["org", "collection"] },
  "content duplicate": { method: "POST", path: "/api/content/duplicate", data: "required" },
  "placements list": { method: "GET", path: "/api/collections/:collection/placements" },
  "placements create": { method: "POST", path: "/api/collections/:collection/placements", data: "required" },
  "placements get": { method: "GET", path: "/api/placements/:id" },
  "placements content": { method: "GET", path: "/api/placements/:id/content", params: { collection: "workspace_id" } },
  "placements update": { method: "PATCH", path: "/api/placements/:id", data: "required" },
  "placements move": { method: "POST", path: "/api/placements/move", data: "required" },
  "placements copy": { method: "POST", path: "/api/placements/:id/copy", data: "required" },
  "activities list": { method: "GET", path: "/api/organizations/:org/activities" },
  "activities create": { method: "POST", path: "/api/organizations/:org/activities", data: "required" },
  "activities get": { method: "GET", path: "/api/activities/:id" },
  "activities update": { method: "PATCH", path: "/api/activities/:id", data: "required" },
  "activity-placements list": { method: "GET", path: { activity: "/api/activities/:activity/placements", collection: "/api/collections/:collection/activity-placements" } },
  "activity-placements create": { method: "POST", path: "/api/activities/:activity/placements", data: "required" },
  "activity-placements get": { method: "GET", path: "/api/activity-placements/:id" },
  "activity-placements update": { method: "PATCH", path: "/api/activity-placements/:id", data: "required" },
  "activity-records list": { method: "GET", path: "/api/activities/:activity/records" },
  "activity-records update": { method: "PATCH", path: "/api/activity-records/:id", data: "required" },
  "scenes get": { method: "GET", path: "/api/scenes/:id" },
  "scenes list": { method: "GET", path: "/api/organizations/:org/scenes" },
  "scenes copy": { method: "POST", path: "/api/scenes/:id/copy", data: "required" },
  "users me": { method: "GET", path: "/api/users/me" },
  "users update-me": { method: "PATCH", path: "/api/users/me", options: ["name"], body: (args) => ({ name: str(args.options, "name", true) }) },
  "users role": { method: "GET", path: "/api/auth/role" },
  "users list": { method: "GET", path: "/api/users" },
  "users search": { method: "GET", path: "/api/users/search", params: { org: "organization_id", search: "q" }, need: ["org", "search"] },
  "users by-ids": { method: "GET", path: "/api/users/by-ids", list: { param: "ids" } },
  "users update": { method: "PUT", path: "/api/users/:id", data: "required" },
  "users create": { method: "POST", path: "/api/users", data: "required" },
  "users delete": { method: "DELETE", path: "/api/users/:id" },
  "users deletion-preview": { method: "GET", path: "/api/users/:id/deletion-preview" },
  "tags list": { method: "GET", path: "/api/tags", params: scope, oneOf: ["org", "collection"] },
  "tags create": { method: "POST", path: "/api/tags", data: "required" },
  "tags update": { method: "PATCH", path: "/api/tags/:id", data: "required" },
  "tags delete": { method: "DELETE", path: "/api/tags/:id" },
  "logs list": { method: "GET", path: "/api/errors/logs" },
  "logs report": { method: "POST", path: "/api/errors", data: "required" },
  "admin orgs": { method: "GET", path: "/api/admin/organizations" },
  "admin app-config": { method: "GET", path: "/api/admin/app-config" },
  "admin update-app-config": { method: "PUT", path: "/api/admin/app-config", data: "required" },
  "admin map-scan-model": { method: "GET", path: "/api/admin/map-scan-model" },
  "admin update-map-scan-model": { method: "PUT", path: "/api/admin/map-scan-model", data: "required" },
  "admin clean": { method: "POST", path: "/api/admin/clean", data: "required" },
  // Public mini-program runtime endpoints; they need no session.
  "miniapp orgs": { method: "GET", path: "/api/miniapp/organizations", list: { param: "ids" } },
  "miniapp collections": { method: "GET", path: "/api/miniapp/workspaces", list: { param: "ids", optional: true }, params: { org: "organization_id" } },
  "miniapp scenes": { method: "GET", path: "/api/miniapp/scenes", list: { param: "ids" }, params: { org: "organization_id" }, need: ["org"] },
  "miniapp activities": { method: "GET", path: "/api/miniapp/activities", params: scope },
  "miniapp activity-progress": { method: "GET", path: "/api/miniapp/activity-progress" },
  "miniapp activity-records": { method: "GET", path: "/api/miniapp/activity-records" },
  "miniapp submit-record": { method: "POST", path: "/api/miniapp/activity-records", data: "required" },
  "miniapp nearby": { method: "POST", path: "/api/miniapp/assets/nearby", data: "required" },
  "miniapp huge": { method: "POST", path: "/api/miniapp/assets/huge", data: "required" },
  "miniapp scene-manifest": { method: "POST", path: "/api/miniapp/assets/scene", data: "required" },
  "miniapp scene-preview": { method: "POST", path: "/api/miniapp/scenes/preview", data: "required" },
  "miniapp anchor-candidates": { method: "POST", path: "/api/miniapp/anchors/candidates", data: "required" },
  "miniapp anchor-content": { method: "POST", path: "/api/miniapp/anchors/content", data: "required" },
};

const either = (options: string[]) => options.map((option) => `--${option}`).join(" 或 ");

export async function resourcePlan(args: Args): Promise<RequestPlan | undefined> {
  const route = routes[args.words.slice(0, 2).join(" ")];
  if (!route) return undefined;
  const alternatives = typeof route.path === "string" ? undefined : route.path;
  const pathOptions = alternatives ? Object.keys(alternatives) : placeholders.filter((option) => (route.path as string).includes(`:${option}`));
  const allowed = [...pathOptions, ...Object.keys(route.params ?? {}), ...(route.options ?? [])];
  if (route.data) allowed.push("data");
  if (route.method === "GET") allowed.push("query");
  const single = route.arg !== undefined || (!alternatives && (route.path as string).includes(":id"));
  const listed = args.words.length - 2;
  check(args, route.list ? Math.max(args.words.length, route.list.optional ? 2 : 3) : single ? 3 : 2, allowed);

  const choose = alternatives ?? (route.oneOf ? Object.fromEntries(route.oneOf.map((option) => [option, ""])) : undefined);
  const given = choose ? Object.keys(choose).filter((option) => args.options[option] !== undefined) : [];
  if (choose && given.length !== 1) throw new CliError(`需要且只能指定 ${either(Object.keys(choose))}`);
  const template = alternatives ? alternatives[given[0]] : route.path as string;
  const arg = single ? id(args.words[2]) : undefined;
  let path = arg !== undefined && template.includes(":id") ? template.replace(":id", arg) : template;
  for (const option of placeholders) if (path.includes(`:${option}`)) path = path.replace(`:${option}`, id(str(args.options, option, true)!));

  const mapped: Record<string, string | undefined> = {};
  for (const [option, param] of Object.entries(route.params ?? {})) {
    const value = str(args.options, option, route.need?.includes(option));
    mapped[param] = value !== undefined && param.endsWith("_id") ? id(value) : value;
  }
  if (typeof route.arg === "string") mapped[route.arg] = arg;
  if (route.list && listed > 0) mapped[route.list.param] = args.words.slice(2).map(id).join(",");

  const data = str(args.options, "data", route.data === "required");
  const body = route.body ? route.body(args, arg) : data !== undefined ? await jsonData(data) : route.data === "optional" ? {} : undefined;
  return { method: route.method, path: withQuery(path, args.options, mapped), body };
}

export async function rawPlan(args: Args): Promise<RequestPlan> {
  check(args, 3, ["data", "query"]);
  const method = args.words[1].toUpperCase();
  if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method)) throw new CliError("api 支持 GET、POST、PUT、PATCH、DELETE");
  const data = str(args.options, "data");
  if (method === "GET" && data !== undefined) throw new CliError("GET 请使用 --query，不接受 --data");
  return { method, path: withQuery(args.words[2], args.options), body: data === undefined ? undefined : await jsonData(data) };
}
