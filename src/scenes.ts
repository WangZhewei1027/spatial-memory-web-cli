import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { check, id, lockVersion, str, type Args } from "./args.js";
import { parseSceneText } from "./scene/validate.js";
import type { RequestPlan } from "./client.js";

export async function sceneWritePlan(args: Args): Promise<RequestPlan> {
  const action = args.words[1];
  if (action === "archive" || action === "restore") {
    check(args, 3, ["lock-version"]);
    return { method: "PATCH", path: `/api/scenes/${id(args.words[2])}`, body: { expectedLockVersion: lockVersion(args), state: action === "archive" ? "archived" : "active" } };
  }
  check(args, action === "create" ? 2 : 3, action === "create" ? ["org", "name", "scene-file", "idempotency-key"] : ["scene-file", "lock-version", "name"]);
  const file = str(args.options, "scene-file", action === "save");
  const document = file ? parseSceneText(await readFile(file, "utf8")) : undefined;
  const name = str(args.options, "name", action === "create");
  return action === "create"
    ? { method: "POST", path: `/api/organizations/${id(str(args.options, "org", true)!)}/scenes`, body: { name, ...(document ? { document } : {}), idempotencyKey: str(args.options, "idempotency-key") ?? randomUUID() } }
    : { method: "PATCH", path: `/api/scenes/${id(args.words[2])}`, body: { document, expectedLockVersion: lockVersion(args), ...(name === undefined ? {} : { name }) } };
}
