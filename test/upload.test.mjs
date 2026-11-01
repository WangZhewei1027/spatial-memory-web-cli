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
            assert.match(body, /name="organization_id"\r\n\r\nteam/);
            res.end(JSON.stringify({ url: "https://media.test/file", contentHash: "hash", storagePath: dedup ? null : "assets/test/file", data: { id: "receipt", organization_id: "team", url: "https://media.test/file" } }));
        }
        else {
            assert.equal(req.url, "/api/organizations/team/assets");
            assert.deepEqual(JSON.parse(body), { fileType: "model", name: "model.glb", payload: { kind: "model" }, resources: [{ role: "primary", receiptId: "receipt" }], idempotencyKey: "upload-test" });
            res.statusCode = status;
            res.end(status === 201 ? '{"data":{"id":"asset"}}' : '{"error":"create rejected"}');
        }
    });
    const file = join(f.dir, "model.glb");
    await writeFile(file, "model bytes");
    const args = ["assets", "upload", file, "--org", "team", "--type", "model", "--idempotency-key", "upload-test"];
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

test("upload normalizes uppercase team UUIDs while still rejecting another team's receipt", async t => {
    const org = "ABCDEFAB-1234-4567-89AB-ABCDEFABCDEF";
    let foreignReceipt = false, created = 0;
    const f = await fixture(t, async (req, res) => {
        let raw = ""; for await (const chunk of req) raw += chunk;
        if (req.url === "/api/upload") {
            assert.ok(raw.includes(`name="organization_id"\r\n\r\n${org.toLowerCase()}`));
            res.end(JSON.stringify({ data: { id: "receipt", organization_id: foreignReceipt ? "11111111-1234-4567-89ab-abcdefabcdef" : org.toLowerCase(), url: "https://media.test/image.jpg" } }));
            return;
        }
        assert.equal(req.url, `/api/organizations/${org.toLowerCase()}/assets`);
        assert.deepEqual(JSON.parse(raw).resources, [{ role: "primary", receiptId: "receipt" }]);
        created++;
        res.statusCode = 201; res.end('{"data":{"asset":{"id":"image"}}}');
    });
    const file = join(f.dir, "image.jpg"); await writeFile(file, "image fixture");
    const args = ["assets", "upload", file, "--org", org, "--type", "image"];
    const accepted = await f.cli(args);
    assert.equal(accepted.code, 0, accepted.stderr);
    assert.equal(created, 1);
    foreignReceipt = true;
    const rejected = await f.cli(args);
    assert.equal(rejected.code, 1); assert.match(rejected.stderr, /团队归属/);
    assert.equal(created, 1, "a receipt for a different team must not create an asset");
});

test("anchor upload supplies a reference receipt in both preview and actual creation", async t => {
    let uploads = 0, created = 0, deletes = 0;
    const f = await fixture(t, async (req, res) => {
        if (req.method === "DELETE") { deletes++; res.end('{"removed":true}'); return; }
        let raw = ""; for await (const chunk of req) raw += chunk;
        if (req.url === "/api/upload") {
            uploads++;
            assert.match(raw, /name="type"\r\n\r\nanchor/);
            assert.match(raw, /name="organization_id"\r\n\r\nteam/);
            res.end(JSON.stringify({ storagePath: "assets/test/anchor", data: { id: "anchor-receipt", organization_id: "team", url: "https://media.test/anchor.jpg" } }));
            return;
        }
        assert.equal(req.url, "/api/organizations/team/assets");
        const body = JSON.parse(raw);
        assert.equal(body.fileType, "anchor");
        assert.equal(body.payload.kind, "anchor");
        if (body.resources[0]?.role !== "reference") { res.statusCode = 400; res.end('{"error":"anchor requires reference"}'); return; }
        assert.deepEqual(body.resources, [{ role: "reference", receiptId: "anchor-receipt" }]);
        created++;
        res.statusCode = 201; res.end('{"data":{"asset":{"id":"anchor"}}}');
    });
    const file = join(f.dir, "anchor.jpg"); await writeFile(file, "image fixture");
    const args = ["assets", "upload", file, "--org", "team", "--type", "anchor"];
    const dry = await f.cli([...args, "--dry-run"]);
    assert.equal(dry.code, 0, dry.stderr);
    assert.deepEqual(JSON.parse(dry.stdout).steps[1].body.resources, [{ role: "reference", receiptId: "<upload.data.id>" }]);
    assert.equal(uploads, 0);
    const result = await f.cli(args);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).data.asset.id, "anchor");
    assert.equal(uploads, 1); assert.equal(created, 1); assert.equal(deletes, 0);
});
