import test from "node:test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fixture } from "./helpers.mjs";
test("multipart upload creates asset; rejects clean up only new, unambiguously failed uploads", async (t) => {
    let status = 201, dedup = false, deletes = 0, uploads = 0;
    const f = await fixture(t, async (req, res) => {
        if (req.method === "DELETE") {
            deletes++;
            assert.match(req.url, /key=assets%2Ftest%2Ffile/);
            res.end('{"removed":true}');
            return;
        }
        const chunks = [];
        for await (const chunk of req)
            chunks.push(chunk);
        const body = Buffer.concat(chunks).toString();
        if (req.url === "/api/upload") {
            uploads++;
            assert.match(req.headers["content-type"], /multipart\/form-data; boundary=/);
            assert.match(body, /name="file"; filename="model.glb"/);
            assert.match(body, /Content-Type: model\/gltf-binary/);
            assert.match(body, /name="workspace_id"\r\n\r\nworkspace/);
            res.end(JSON.stringify({ url: "https://media.test/file", contentHash: "hash", storagePath: dedup ? null : "assets/test/file" }));
        }
        else {
            assert.equal(req.url, "/api/workspaces/workspace/assets");
            assert.deepEqual(JSON.parse(body), { file_type: "model", name: "model.glb", file_url: "https://media.test/file", content_hash: "hash" });
            res.statusCode = status;
            res.end(status === 201 ? '{"data":{"id":"asset"}}' : '{"error":"create rejected"}');
        }
    });
    const file = join(f.dir, "model.glb");
    await writeFile(file, "model bytes");
    const args = ["assets", "upload", file, "--workspace", "workspace", "--type", "model"];
    assert.equal((await f.cli([...args, "--dry-run"])).code, 0);
    assert.equal(uploads, 0);
    const success = await f.cli(args);
    assert.equal(success.code, 0, success.stderr);
    assert.equal(JSON.parse(success.stdout).data.id, "asset");
    status = 403;
    assert.equal((await f.cli(args)).code, 4);
    assert.equal(deletes, 1);
    dedup = true;
    assert.equal((await f.cli(args)).code, 4);
    assert.equal(deletes, 1);
    dedup = false;
    status = 500;
    const ambiguous = await f.cli(args);
    assert.equal(ambiguous.code, 1);
    assert.equal(deletes, 1);
    assert.match(ambiguous.stderr, /storagePath/);
});
