import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./helpers.mjs";
test("HTTP failures, login redirect, non-JSON and timeout have useful exit codes", async (t) => {
    let followCount = 0;
    const f = await fixture(t, (req, res) => {
        if (req.url === "/api/slow") {
            setTimeout(() => res.end('{}'), 300);
            return;
        }
        if (req.url === "/auth/login") {
            followCount++;
            res.end("login HTML");
            return;
        }
        if (req.url === "/api/redirect") {
            res.writeHead(307, { Location: "/auth/login" });
            res.end();
            return;
        }
        if (req.url === "/api/external") {
            res.writeHead(302, { Location: "https://example.test/api/steal" });
            res.end();
            return;
        }
        if (req.url === "/api/html") {
            res.end("<html>proxy</html>");
            return;
        }
        res.statusCode = Number(req.url?.split("/").pop());
        res.end('{"error":"server rejection"}');
    });
    for (const [path, code, pattern] of [
        ["401", 3, /未登录/], ["403", 4, /server rejection/], ["409", 1, /server rejection/],
        ["500", 1, /server rejection/], ["redirect", 3, /会话/], ["external", 1, /重定向/], ["html", 1, /JSON/],
    ]) {
        const r = await f.cli(["api", "GET", `/api/${path}`]);
        assert.equal(r.code, code, r.stderr);
        assert.equal(r.stdout, "");
        assert.match(r.stderr, pattern);
    }
    const timeout = await f.cli(["api", "GET", "/api/slow", "--timeout", "40"]);
    assert.equal(timeout.code, 1);
    assert.match(timeout.stderr, /超时/);
    assert.equal(followCount, 0);
});
test("invalid flags, paths and malformed bodies never send requests; dry-run is offline", async (t) => {
    let requests = 0;
    const f = await fixture(t, (_req, res) => { requests++; res.end('{}'); });
    for (const args of [
        ["assets", "list"], ["assets", "list", "--org", "o", "--workspace", "w"],
        ["orgs", "list", "--typo"], ["orgs", "list", "--data", "{}"], ["orgs", "list", "extra"],
        ["api", "POST", "/api/users", "--data", "[]"], ["api", "GET", "/api/users", "--data", "{}"],
        ...["https://example.test/api/users", "//example.test/api/users", "/api/../users", "/api/../../api/../x", "/api/x#fragment"].map((path) => ["api", "GET", path]),
    ]) {
        const r = await f.cli(args);
        assert.equal(r.code, 2, JSON.stringify(args) + r.stderr);
    }
    const dry = await f.cli(["assets", "create", "--workspace", "w", "--type", "text", "--text", "测试", "--dry-run"]);
    assert.equal(dry.code, 0, dry.stderr);
    assert.equal(JSON.parse(dry.stdout).body.text_content, "测试");
    const query = await f.cli(["logs", "list", "--query", "q=one & two=three", "--dry-run"]);
    assert.equal(new URL(JSON.parse(query.stdout).url).searchParams.get("q"), "one & two=three");
    assert.equal(requests, 0);
});
