import test from "node:test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fixture } from "./helpers.mjs";

test("schema 6 scene create/get/save and stale-lock conflicts use the independent scene API", async (t) => {
  let requests = 0;
  let saved, lock = 0;
  const f = await fixture(t, async (req, res) => {
    requests++;
    let raw = ""; for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : undefined;
    if (req.method === "POST") {
      assert.equal(req.url, "/api/organizations/team/scenes");
      assert.equal(body.name, "scene");
      assert.ok(body.idempotencyKey); saved = body.document;
    } else {
      assert.equal(req.url, "/api/scenes/scene-id");
      if (req.method === "PATCH") {
        assert.deepEqual(Object.keys(body).sort(), ["document", "expectedLockVersion"]);
        if (body.expectedLockVersion !== lock) { res.statusCode = 409; res.end('{"error":"lock conflict"}'); return; }
        saved = body.document; lock++;
      }
    }
    res.end(JSON.stringify({ data: { id: "scene-id", lock_version: lock, document: saved } }));
  });
  const version = await f.cli(["--version"]);
  assert.equal(version.code, 0, version.stderr);
  assert.match(version.stdout, /^\d+\.\d+\.\d+\n$/);
  const init = await f.cli(["scenes", "init"]);
  assert.equal(init.code, 0, init.stderr);
  const scene = JSON.parse(init.stdout);
  assert.equal(scene.schemaVersion, 6);
  scene.content.assets = { audio: { assetId: "12345678-1234-1234-1234-123456789abc" } };
  scene.content.groups = [{ id: "group", name: "group", position: [0,0,0], rotation: [0,0,0], scale: [1,1,1] }];
  scene.content.instances = [{ id: "track", parent: "group", asset: "audio", position: [0,0,0], rotation: [0,12.56,0], scale: [1,1,1], animation: null, hidden: false,
    media: { trimStartSeconds: 0, trimEndSeconds: null, playbackRate: 1, volume: 0.8, loop: false, muted: false, spatial: { enabled: true, refDistance: 1, maxDistance: 100, rolloffFactor: 1 } },
    tracks: { volume: [{ time: 0, value: 0.2, handles: [0.5,1,0.5,0], connectedRight: true }, { time: 10, value: 1, handles: [0.5,1,0.5,0], connectedRight: true }] } }];
  const file = join(f.dir, "scene.json");
  await writeFile(file, JSON.stringify(scene));
  assert.equal((await f.cli(["scenes", "validate", file])).code, 0);
  const create = await f.cli(["scenes", "create", "--org", "team", "--name", "scene", "--scene-file", file]);
  assert.equal(create.code, 0, create.stderr);
  const get = await f.cli(["scenes", "get", "scene-id"]);
  assert.deepEqual(JSON.parse(get.stdout).data.document, scene);
  const save = await f.cli(["scenes", "save", "scene-id", "--scene-file", file, "--lock-version", "0", "--dry-run"]);
  assert.equal(save.code, 0, save.stderr);
  const plan = JSON.parse(save.stdout);
  assert.equal(plan.method, "PATCH");
  assert.equal(new URL(plan.url).pathname, "/api/scenes/scene-id");
  assert.equal(plan.body.expectedLockVersion, 0);
  assert.deepEqual(plan.body.document, scene);
  const write = ["scenes", "save", "scene-id", "--scene-file", file, "--lock-version", "0"];
  assert.equal((await f.cli(write)).code, 0);
  const conflict = await f.cli(write); assert.equal(conflict.code, 1); assert.match(conflict.stderr, /lock conflict/);
  for (const bad of ["-1", "1.5", "NaN", "9007199254740992"]) assert.equal((await f.cli([...write.slice(0,-1),bad])).code, 2);
  for (const version of [1,2,4,5,7,8]) {
    await writeFile(file, JSON.stringify({ ...scene, schemaVersion: version }));
    assert.equal((await f.cli(["scenes", "validate", file])).code, 2);
  }
  scene.schemaVersion = 99;
  await writeFile(file, JSON.stringify(scene));
  const invalid = await f.cli(["scenes", "validate", file]);
  assert.equal(invalid.code, 2); assert.match(invalid.stderr, /schemaVersion/);
  assert.equal(requests, 4);
});

test("scene validation rejects cyclic groups and invalid scalar automation before network", async (t) => {
  const f = await fixture(t, () => assert.fail("invalid document must stay offline"));
  const scene = JSON.parse((await f.cli(["scenes", "init"])).stdout);
  scene.content.groups = [{ id: "a", name: "a", parent: "b", position: [0,0,0], rotation: [0,0,0], scale: [1,1,1] }, { id: "b", name: "b", parent: "a", position: [0,0,0], rotation: [0,0,0], scale: [1,1,1] }];
  const file = join(f.dir, "invalid.json"); await writeFile(file, JSON.stringify(scene));
  assert.equal((await f.cli(["scenes", "validate", file])).code, 2);
  scene.content.groups = [];
  scene.content.instances = [{ id: "text", text: { content: "hello", color: "#ffffff", fontSize: 0.1, width: 1, align: "left" }, position: [0,0,0], rotation: [0,0,0], scale: [1,1,1], animation: null, opacity: 2 }];
  await writeFile(file, JSON.stringify(scene));
  assert.equal((await f.cli(["scenes", "validate", file])).code, 2);
});
