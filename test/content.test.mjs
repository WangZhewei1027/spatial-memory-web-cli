import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./helpers.mjs";

test("team asset, collection and placement commands use current endpoints and locks", async t => {
  const requests = [];
  const f = await fixture(t, async (req, res) => {
    let raw = ""; for await (const part of req) raw += part;
    requests.push({ method: req.method, path: req.url, body: raw ? JSON.parse(raw) : undefined });
    res.end('{"data":{"id":"asset","lock_version":2}}');
  });
  const run = async args => { const out = await f.cli(args); assert.equal(out.code, 0, out.stderr); return requests.at(-1); };
  assert.deepEqual(await run(["assets","create","--org","team","--type","text","--name","hello","--text","你好","--idempotency-key","create-1"]), {
    method: "POST", path: "/api/organizations/team/assets", body: { fileType: "text", name: "hello", payload: { kind: "text", text: "你好" }, resources: [], idempotencyKey: "create-1" }
  });
  assert.equal((await run(["assets","get","asset"])).path, "/api/assets/asset");
  assert.equal((await run(["assets","list","--collection","map","--type","model"])).path, "/api/collections/map/assets?file_type=model");
  assert.equal((await run(["assets","delete","asset","--lock-version","2"])).path, "/api/assets/asset?expectedLockVersion=2");
  assert.equal((await run(["collections","list","--org","team"])).path, "/api/organizations/team/collections");
  const create = await run(["collections","create","--org","team","--data",'{"name":"map"}']);
  assert.equal(create.method,"POST"); assert.equal(create.path,"/api/organizations/team/collections");
  assert.equal((await run(["collections","update","map","--data",'{"name":"map2"}'])).method,"PATCH");
  assert.equal((await run(["collections","archive","map"])).method,"POST");
  assert.equal((await run(["collections","restore","map"])).method,"DELETE");
  assert.equal((await run(["placements","list","--collection","map"])).path,"/api/collections/map/placements");
  assert.equal((await run(["placements","delete","p","--lock-version","3"])).path,"/api/placements/p?expectedLockVersion=3");
  assert.equal((await run(["placements","copy","p","--data",'{"targetWorkspaceId":"map"}'])).path,"/api/placements/p/copy");
  const before = requests.length;
  for (const args of [["workspaces","list"],["assets","move","--data","{}"],["assets","copy","--data","{}"],["assets","create","--org","team","--type","scene","--name","old"],["assets","delete","asset"],["assets","list","--workspace","map"]]) assert.equal((await f.cli(args)).code,2);
  assert.equal(requests.length,before,"obsolete APIs must not be called");
});
