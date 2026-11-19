import test from "node:test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fixture } from "./helpers.mjs";

const HASH = "a".repeat(64);

test("every server API route has a command with the current method, path and body", async t => {
  const requests = [];
  const f = await fixture(t, async (req, res) => {
    let raw = ""; for await (const part of req) raw += part;
    requests.push({ method: req.method, path: req.url, body: raw ? JSON.parse(raw) : undefined });
    res.end('{"data":{}}');
  });
  const run = async args => {
    const before = requests.length;
    const out = await f.cli(args);
    assert.equal(out.code, 0, JSON.stringify(args) + out.stderr);
    assert.equal(requests.length, before + 1, JSON.stringify(args));
    const { method, path, body } = requests.at(-1);
    return body === undefined ? [method, path] : [method, path, body];
  };
  const cases = [
    [["orgs", "placements", "team", "--query", "status=active"], ["GET", "/api/organizations/team/placements?status=active"]],
    [["orgs", "map-scan-model", "team"], ["GET", "/api/organizations/team/map-scan-model"]],
    [["orgs", "pin", "team"], ["POST", "/api/organizations/pin", { organizationId: "team", pinned: true }]],
    [["orgs", "unpin", "team"], ["POST", "/api/organizations/pin", { organizationId: "team", pinned: false }]],
    [["members", "list", "--org", "team"], ["GET", "/api/organizations/team/members"]],
    [["members", "add", "--org", "team", "--data", '{"user_id":"u","role":"member"}'], ["POST", "/api/organizations/team/members", { user_id: "u", role: "member" }]],
    [["members", "update", "--org", "team", "--data", '{"member_id":"m","role":"admin"}'], ["PATCH", "/api/organizations/team/members", { member_id: "m", role: "admin" }]],
    [["members", "remove", "m", "--org", "team"], ["DELETE", "/api/organizations/team/members?member_id=m"]],
    [["invitations", "list", "--org", "team"], ["GET", "/api/organizations/team/invitations"]],
    [["invitations", "create", "--org", "team"], ["POST", "/api/organizations/team/invitations", {}]],
    [["invitations", "create", "--org", "team", "--data", '{"role":"viewer"}'], ["POST", "/api/organizations/team/invitations", { role: "viewer" }]],
    [["invitations", "revoke", "inv", "--org", "team"], ["DELETE", "/api/organizations/team/invitations?invitation_id=inv"]],
    [["invitations", "get", "token-1"], ["GET", "/api/invitations/token-1"]],
    [["invitations", "accept", "token-1"], ["POST", "/api/invitations/token-1"]],
    [["assets", "by-hash", HASH, "--org", "team"], ["GET", `/api/assets/by-hash?organization_id=team&hash=${HASH}`]],
    [["assets", "by-hash", HASH, "--collection", "map"], ["GET", `/api/assets/by-hash?workspace_id=map&hash=${HASH}`]],
    [["content", "duplicate", "--data", '{"sourceType":"asset","sourceId":"a"}'], ["POST", "/api/content/duplicate", { sourceType: "asset", sourceId: "a" }]],
    [["placements", "content", "p"], ["GET", "/api/placements/p/content"]],
    [["placements", "content", "p", "--collection", "map"], ["GET", "/api/placements/p/content?workspace_id=map"]],
    [["activities", "list", "--org", "team", "--query", "limit=10"], ["GET", "/api/organizations/team/activities?limit=10"]],
    [["activities", "create", "--org", "team", "--data", '{"name":"a"}'], ["POST", "/api/organizations/team/activities", { name: "a" }]],
    [["activities", "get", "act"], ["GET", "/api/activities/act"]],
    [["activities", "update", "act", "--data", '{"expectedLockVersion":1}'], ["PATCH", "/api/activities/act", { expectedLockVersion: 1 }]],
    [["activity-placements", "list", "--activity", "act"], ["GET", "/api/activities/act/placements"]],
    [["activity-placements", "list", "--collection", "map"], ["GET", "/api/collections/map/activity-placements"]],
    [["activity-placements", "create", "--activity", "act", "--data", '{"workspaceId":"map"}'], ["POST", "/api/activities/act/placements", { workspaceId: "map" }]],
    [["activity-placements", "get", "ap"], ["GET", "/api/activity-placements/ap"]],
    [["activity-placements", "update", "ap", "--data", '{"status":"active"}'], ["PATCH", "/api/activity-placements/ap", { status: "active" }]],
    [["activity-records", "list", "--activity", "act", "--query", "placementId=ap"], ["GET", "/api/activities/act/records?placementId=ap"]],
    [["activity-records", "update", "rec", "--data", '{"status":"hidden"}'], ["PATCH", "/api/activity-records/rec", { status: "hidden" }]],
    [["users", "update-me", "--name", "新名字"], ["PATCH", "/api/users/me", { name: "新名字" }]],
    [["users", "role"], ["GET", "/api/auth/role"]],
    [["users", "search", "--org", "team", "--search", "a@b.test"], ["GET", "/api/users/search?organization_id=team&q=a%40b.test"]],
    [["users", "by-ids", "u1", "u2"], ["GET", "/api/users/by-ids?ids=u1%2Cu2"]],
    [["logs", "report", "--data", '{"message":"x"}'], ["POST", "/api/errors", { message: "x" }]],
    [["admin", "orgs"], ["GET", "/api/admin/organizations"]],
    [["admin", "app-config"], ["GET", "/api/admin/app-config"]],
    [["admin", "update-app-config", "--data", '{"key":"default_allowed_file_types","value":["image"]}'], ["PUT", "/api/admin/app-config", { key: "default_allowed_file_types", value: ["image"] }]],
    [["admin", "map-scan-model"], ["GET", "/api/admin/map-scan-model"]],
    [["admin", "update-map-scan-model", "--data", '{"organizationId":"team"}'], ["PUT", "/api/admin/map-scan-model", { organizationId: "team" }]],
    [["admin", "clean", "--data", '{"action":"clean-files"}'], ["POST", "/api/admin/clean", { action: "clean-files" }]],
    [["miniapp", "orgs", "o1", "o2"], ["GET", "/api/miniapp/organizations?ids=o1%2Co2"]],
    [["miniapp", "collections", "--org", "team"], ["GET", "/api/miniapp/workspaces?organization_id=team"]],
    [["miniapp", "collections", "w1"], ["GET", "/api/miniapp/workspaces?ids=w1"]],
    [["miniapp", "scenes", "s1", "--org", "team"], ["GET", "/api/miniapp/scenes?organization_id=team&ids=s1"]],
    [["miniapp", "activities", "--collection", "map"], ["GET", "/api/miniapp/activities?workspace_id=map"]],
    [["miniapp", "activity-progress", "--query", "placement_id=p", "--query", "participant_id=device-0000000001"], ["GET", "/api/miniapp/activity-progress?placement_id=p&participant_id=device-0000000001"]],
    [["miniapp", "activity-records", "--query", "placement_id=p"], ["GET", "/api/miniapp/activity-records?placement_id=p"]],
    [["miniapp", "submit-record", "--data", '{"kind":"danmaku"}'], ["POST", "/api/miniapp/activity-records", { kind: "danmaku" }]],
    [["miniapp", "nearby", "--data", '{"user_lat":1}'], ["POST", "/api/miniapp/assets/nearby", { user_lat: 1 }]],
    [["miniapp", "huge", "--data", '{"p_organization_id":"team"}'], ["POST", "/api/miniapp/assets/huge", { p_organization_id: "team" }]],
    [["miniapp", "scene-manifest", "--data", '{"asset_id":"a"}'], ["POST", "/api/miniapp/assets/scene", { asset_id: "a" }]],
    [["miniapp", "scene-preview", "--data", '{"scene_id":"s"}'], ["POST", "/api/miniapp/scenes/preview", { scene_id: "s" }]],
    [["miniapp", "anchor-candidates", "--data", '{"workspace_id":"map"}'], ["POST", "/api/miniapp/anchors/candidates", { workspace_id: "map" }]],
    [["miniapp", "anchor-content", "--data", '{"workspace_id":"map"}'], ["POST", "/api/miniapp/anchors/content", { workspace_id: "map" }]],
    [["uploads", "delete", "assets/user/file name.glb"], ["DELETE", "/api/upload?key=assets%2Fuser%2Ffile%20name.glb"]],
    // Existing commands keep their routes after the catalog rewrite.
    [["orgs", "members", "team"], ["GET", "/api/organizations/team/members"]],
    [["orgs", "update", "team", "--data", '{"name":"n"}'], ["PUT", "/api/organizations/team", { name: "n" }]],
    [["tags", "list", "--org", "team"], ["GET", "/api/tags?organization_id=team"]],
    [["tags", "list", "--collection", "map"], ["GET", "/api/tags?workspace_id=map"]],
    [["scenes", "list", "--org", "team", "--query", "q=hall"], ["GET", "/api/organizations/team/scenes?q=hall"]],
    [["users", "deletion-preview", "u"], ["GET", "/api/users/u/deletion-preview"]],
  ];
  for (const [args, expected] of cases) assert.deepEqual(await run(args), expected, JSON.stringify(args));
});

test("new commands reject ambiguous or incomplete input before sending a request", async t => {
  let requests = 0;
  const f = await fixture(t, (_req, res) => { requests++; res.end("{}"); });
  for (const args of [
    ["members", "remove", "m"], ["members", "remove", "--org", "team"], ["members", "add", "--org", "team"],
    ["invitations", "revoke", "inv"], ["invitations", "accept"],
    ["activity-placements", "list"], ["activity-placements", "list", "--activity", "a", "--collection", "c"],
    ["activity-records", "list"], ["activities", "create", "--org", "team"],
    ["assets", "by-hash", HASH], ["assets", "by-hash", HASH, "--org", "o", "--collection", "c"], ["assets", "by-hash", "--org", "o"],
    ["users", "by-ids"], ["users", "search", "--org", "team"], ["users", "update-me"], ["users", "role", "--data", "{}"],
    ["miniapp", "orgs"], ["miniapp", "scenes", "s1"], ["miniapp", "nearby"], ["miniapp", "orgs", "bad/id"],
    ["orgs", "pin"], ["orgs", "pin", "a", "b"], ["tags", "list"], ["tags", "list", "--org", "o", "--collection", "c"],
    ["uploads", "delete", "../etc/passwd"], ["uploads", "delete", "assets/../x"], ["uploads", "delete", "other/x"],
    ["uploads", "create", "file", "--org", "o", "--collection", "c"], ["uploads", "create", "file"],
    ["admin", "clean"], ["admin", "orgs", "extra"],
  ]) {
    const r = await f.cli(args);
    assert.equal(r.code, 2, JSON.stringify(args) + r.stderr);
  }
  const dry = await f.cli(["members", "remove", "m", "--org", "team", "--dry-run"]);
  assert.equal(dry.code, 0, dry.stderr);
  assert.deepEqual(JSON.parse(dry.stdout), { method: "DELETE", url: `${f.origin}/api/organizations/team/members?member_id=m` });
  assert.equal(requests, 0);
});

test("uploads create posts only the file and returns the receipt", async t => {
  const uploads = [];
  const f = await fixture(t, async (req, res) => {
    let body = ""; for await (const chunk of req) body += chunk;
    assert.equal(req.method, "POST");
    assert.equal(req.url, "/api/upload");
    uploads.push(body);
    res.end(JSON.stringify({ url: "https://media.test/f", storagePath: "assets/u/f", data: { id: "receipt" } }));
  });
  const file = join(f.dir, "photo.png");
  await writeFile(file, "png bytes");
  const dry = await f.cli(["uploads", "create", file, "--collection", "MAP", "--dry-run"]);
  assert.equal(dry.code, 0, dry.stderr);
  assert.deepEqual(JSON.parse(dry.stdout), { baseUrl: f.origin, method: "POST", path: "/api/upload", file, size: 9, mime: "image/png", workspace_id: "map", purpose: "asset" });
  assert.equal(uploads.length, 0);
  const out = await f.cli(["uploads", "create", file, "--org", "team", "--type", "image"]);
  assert.equal(out.code, 0, out.stderr);
  assert.equal(JSON.parse(out.stdout).data.id, "receipt");
  assert.match(uploads[0], /name="file"; filename="photo.png"\r\nContent-Type: image\/png/);
  assert.match(uploads[0], /name="type"\r\n\r\nimage/);
  assert.match(uploads[0], /name="organization_id"\r\n\r\nteam/);
  assert.match(uploads[0], /name="purpose"\r\n\r\nasset/);
  assert.equal((await f.cli(["uploads", "create", file, "--org", "team", "--type", "text"])).code, 2);
  assert.equal(uploads.length, 1);
});
