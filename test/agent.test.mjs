import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { cliModule, fixture } from "./helpers.mjs";

test("local draft apply is atomic, conflicts preserve state, and restore creates a new revision", async t => {
  const f = await fixture(t, () => assert.fail("local commands must stay offline"));
  const base = ["--runs-dir", join(f.dir, "runs")];
  const opened = await f.cli(["runs", "open", "--run", "show", ...base]);
  assert.equal(opened.code, 0, opened.stderr);
  const change = ["scenes", "apply", "--run", "show", "--revision", "0", "--ops", JSON.stringify([{ type: "scene.update", patch: { durationSeconds: 1200 } }]), ...base];
  const results = await Promise.all([f.cli(change), f.cli(change)]);
  assert.equal(results.filter(r => r.code === 0).length, 1, JSON.stringify(results));
  const state = JSON.parse((await f.cli(["runs", "status", "show", ...base])).stdout);
  assert.equal(state.revision, 1); assert.equal(state.document.content.durationSeconds, 1200);
  const invalid = await f.cli(["scenes", "apply", "--run", "show", "--revision", "1", "--ops", JSON.stringify([{ type: "scene.update", patch: { durationSeconds: -1 } }]), ...base]);
  assert.equal(invalid.code, 2, invalid.stderr);
  assert.equal(JSON.parse((await f.cli(["runs", "status", "show", ...base])).stdout).revision, 1);
  const sample = await f.cli(["scenes", "sample", "--run", "show", "--time", "700", ...base]);
  assert.equal(sample.code, 0, sample.stderr);
  const restored = await f.cli(["runs", "restore", "show", "0", "--revision", "1", ...base]);
  assert.equal(restored.code, 0, restored.stderr);
  assert.equal(JSON.parse(restored.stdout).revision, 2);
  assert.equal(JSON.parse(restored.stdout).document.content.durationSeconds, 10);
  const history = JSON.parse((await f.cli(["runs", "history", "show", ...base])).stdout);
  assert.deepEqual(history.history.map(x => x.event), ["restore", "apply", "open"]);
});

test("asset search follows server pagination and returns a complete summary", async t => {
  let pages = 0;
  const f = await fixture(t, (req, res) => {
    const url = new URL(req.url, "http://test");
    assert.equal(url.pathname, "/api/organizations/team/assets");
    assert.equal(url.searchParams.get("q"), "舞台");
    const offset = Number(url.searchParams.get("offset")); pages++;
    const data = Array.from({ length: Math.min(2, 5 - offset) }, (_, i) => ({ id: `a${offset+i}`, name: "舞台", file_type: "model", payload: { kind: "model" }, resources: [] }));
    res.end(JSON.stringify({ data, page: { offset, limit: 2, total: 5 } }));
  });
  const result = await f.cli(["assets", "search", "--org", "team", "--search", "舞台"]);
  assert.equal(result.code, 0, result.stderr);
  const found = JSON.parse(result.stdout);
  assert.equal(pages, 3); assert.equal(found.count, 5); assert.equal(found.complete, true);
});

test("URL import keeps service cookies off download and resumes an ambiguous asset creation", async t => {
  let downloads = 0, uploads = 0, creates = 0;
  const f = await fixture(t, async (req, res) => {
    if (req.url === "/download/source.pdf") {
      downloads++; assert.equal(req.headers.cookie, undefined); assert.equal(req.headers.authorization, undefined);
      res.setHeader("content-type", "application/pdf"); res.end("document fixture"); return;
    }
    let raw = ""; for await (const chunk of req) raw += chunk;
    if (req.url === "/api/upload") {
      uploads++; assert.equal(req.headers.cookie, "session=private");
      res.end(JSON.stringify({ storagePath: "assets/fake", data: { id: "receipt", organization_id: "team", url: "https://media.invalid/source.pdf" } })); return;
    }
    assert.equal(req.url, "/api/organizations/team/assets"); creates++;
    const body = JSON.parse(raw); assert.equal(body.idempotencyKey, "recover-import");
    assert.equal(body.payload.attributes.source_url, `${f.origin}/download/source.pdf`);
    assert.deepEqual(body.resources, [{ role: "primary", receiptId: "receipt" }]);
    if (creates === 1) { res.statusCode = 503; res.end('{"error":"ambiguous create"}'); }
    else res.end('{"data":{"asset":{"id":"created-model"}}}');
  });
  await writeFile(f.config, JSON.stringify({ version: 1, sessions: { [f.origin]: [{ name: "session", value: "private", domain: "127.0.0.1", path: "/", hostOnly: true, secure: false }] } }));
  const args = ["assets", "import", `${f.origin}/download/source.pdf`, "--org", "team", "--type", "document", "--idempotency-key", "recover-import", "--cache-dir", join(f.dir, "cache")];
  const failed = await f.cli(args); assert.equal(failed.code, 1, failed.stderr);
  const failure = JSON.parse(failed.stderr); assert.equal(failure.details.phase, "uploaded");
  assert.equal(JSON.parse(await readFile(failure.details.statePath, "utf8")).phase, "uploaded");
  const resumed = await f.cli(args); assert.equal(resumed.code, 0, resumed.stderr); assert.equal(JSON.parse(resumed.stdout).import.resumed, true);
  const duplicate = await f.cli(args); assert.equal(duplicate.code, 0, duplicate.stderr); assert.equal(JSON.parse(duplicate.stdout).import.reused, true);
  assert.equal(downloads, 1); assert.equal(uploads, 1); assert.equal(creates, 2);
});

test("external glTF dependencies are reported before upload", async t => {
  const f = await fixture(t, () => assert.fail("incomplete model must stay offline"));
  const path = join(f.dir, "model.gltf");
  await writeFile(path, JSON.stringify({ asset: { version: "2.0" }, buffers: [{ uri: "mesh.bin", byteLength: 20 }], images: [{ uri: "texture.png" }] }));
  const result = await f.cli(["assets", "import", path, "--org", "team", "--type", "model", "--cache-dir", join(f.dir, "cache")]);
  assert.equal(result.code, 2, result.stderr);
  const error = JSON.parse(result.stderr);
  assert.equal(error.details.code, "MISSING_DEPENDENCIES");
  assert.deepEqual(error.details.dependencies, ["mesh.bin", "texture.png"]);
});

test("successful first import persists its result after receipt checkpoint and replays from cache", async t => {
  let calls = 0;
  const f = await fixture(t, async (req, res) => {
    calls++; for await (const _chunk of req) { /* consume multipart or JSON */ }
    res.end(req.url === "/api/upload" ? JSON.stringify({ data: { id: "receipt", organization_id: "team", url: "https://media.invalid/file.pdf" } }) : '{"data":{"asset":{"id":"first-success"}}}');
  });
  const path = join(f.dir, "source.pdf"); await writeFile(path, "document fixture");
  const args = ["assets", "import", path, "--org", "team", "--type", "document", "--cache-dir", join(f.dir, "cache"), "--idempotency-key", "first-success-key"];
  const first = await f.cli(args); assert.equal(first.code, 0, first.stderr);
  const output = JSON.parse(first.stdout); assert.equal(output.data.asset.id, "first-success");
  const state = JSON.parse(await readFile(output.import.statePath, "utf8"));
  assert.equal(state.phase, "complete"); assert.equal(state.result.data.asset.id, "first-success");
  const second = await f.cli(args); assert.equal(second.code, 0, second.stderr); assert.equal(JSON.parse(second.stdout).import.reused, true); assert.equal(calls, 2);
});

test("remote draft preflight and save preserve version locking; stale saves leave local revision intact", async t => {
  let document, locks = 3;
  const f = await fixture(t, async (req, res) => {
    let raw = ""; for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : undefined;
    if (req.url === "/api/organizations/team/scenes/validate") {
      assert.equal(body.sceneId, "scene"); assert.equal(body.expectedLockVersion, 3);
      res.end('{"data":{"valid":true,"referenced_resources":[],"lock_version":3}}'); return;
    }
    assert.equal(req.url, "/api/scenes/scene");
    if (req.method === "PATCH") {
      if (body.expectedLockVersion !== locks) { res.statusCode = 409; res.end('{"error":"lock conflict"}'); return; }
      locks++; document = body.document;
    }
    res.end(JSON.stringify({ data: { id: "scene", organization_id: "team", lock_version: locks, document } }));
  });
  document = JSON.parse((await f.cli(["scenes", "init"])).stdout);
  const base = ["--runs-dir", join(f.dir, "runs")];
  assert.equal((await f.cli(["runs", "open", "--scene", "scene", "--run", "remote", ...base])).code, 0);
  const check = await f.cli(["scenes", "validate", "--run", "remote", "--remote", ...base]); assert.equal(check.code, 0, check.stderr);
  const saved = await f.cli(["scenes", "save", "--run", "remote", "--revision", "0", ...base]); assert.equal(saved.code, 0, saved.stderr);
  locks++;
  const stale = await f.cli(["scenes", "save", "--run", "remote", "--revision", "1", ...base]); assert.equal(stale.code, 1, stale.stderr);
  assert.equal(JSON.parse((await f.cli(["runs", "status", "remote", ...base])).stdout).revision, 1);
});

test("render planning accepts custom cameras and samples transitions without claiming exhaustive coverage", async t => {
  const f = await fixture(t, () => assert.fail("render dry run stays offline"));
  const document = JSON.parse((await f.cli(["scenes", "init"])).stdout);
  document.content.instances = [{ id: "title", text: { content: "Show", color: "#ffffff", fontSize: 1, width: 5, align: "center" }, position: [0,0,0], rotation: [0,0,0], scale: [1,1,1], animation: null, timing: { startSeconds: 2, endSeconds: 8, fadeInSeconds: 1, fadeOutSeconds: 1 }, tracks: { "position.x": [{ time: 5, value: 3, handles: [0.5,1,0.5,0], connectedRight: true }] } }];
  const path = join(f.dir, "scene.json"), cameras = join(f.dir, "cameras.json");
  await writeFile(path, JSON.stringify(document));
  await writeFile(cameras, JSON.stringify([{ name: "custom", position: [0,3,10], target: [0,1,0], fov: 40 }]));
  const output = await f.cli(["scenes", "render", "--scene-file", path, "--times", "auto", "--camera-file", `@${cameras}`, "--width", "800", "--height", "600", "--overlays", "--dry-run"]);
  assert.equal(output.code, 0, output.stderr);
  const plan = JSON.parse(output.stdout);
  for (const at of [0,2,3,4,5,7,8,10]) assert.ok(plan.times.includes(at), `missing ${at}`);
  assert.equal(plan.sampling.exhaustive, false); assert.equal(plan.cameras[0].name, "custom");
  assert.equal(plan.options.width, 800); assert.equal(plan.options.height, 600); assert.equal(plan.options.overlays, true);
});

test("import probes final managed bytes and resumes final-probe failure without another upload or create", async t => {
  const f = await fixture(t, () => assert.fail("adapter fixture owns network"));
  const { importAsset } = await cliModule("asset-agent.js");
  const source = join(f.dir, "image.png"); await writeFile(source, "image fixture");
  let uploads = 0, creates = 0, sourceProbes = 0, finalProbes = 0;
  const client = { settings: { baseUrl: f.origin, timeout: 30000 }, request: async plan => {
    if (plan.path === "/api/upload") { uploads++; return { data: { id: "receipt", organization_id: "team", url: "https://media.invalid/final.jpg" } }; }
    if (plan.method === "POST") { creates++; return { data: { asset: { id: "image" } } }; }
    return { data: { id: "image", file_type: "image", lock_version: 2, state: "active", resources: [{ role: "primary", ordinal: 0, url: "https://media.invalid/final.jpg", content_hash: "processed-hash" }] } };
  } };
  const probe = async request => {
    if (request.path) { sourceProbes++; return { facts: { width: 4000, sha256: "original-hash" }, errors: [] }; }
    finalProbes++;
    if (finalProbes === 1) throw new Error("temporary media fetch failure");
    return { facts: { width: 1024, sha256: "processed-hash" }, previews: [], errors: [] };
  };
  const args = { words: ["assets", "import", source], options: { org: "team", type: "image", "cache-dir": join(f.dir, "cache"), "idempotency-key": "final-probe-retry" } };
  await assert.rejects(importAsset(args, client, probe), error => error.details?.phase === "created");
  const retried = await importAsset(args, client, probe);
  assert.equal(retried.import.sourceProbe.facts.width, 4000);
  assert.equal(retried.import.finalProbe.facts.width, 1024);
  assert.equal(retried.resourceFacts.image.sha256, "processed-hash");
  assert.equal(uploads, 1); assert.equal(creates, 1); assert.equal(sourceProbes, 1); assert.equal(finalProbes, 2);
});
