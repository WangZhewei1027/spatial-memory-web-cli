import test from "node:test";
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { fixture } from "./helpers.mjs";
import { cookieHeader, mergeCookies } from "../dist/cookies.js";
test("login, cookie rotation, origin isolation and logout through real CLI processes", async (t) => {
    let loginBody = "", seenCookie = "", expectedOrigin = "";
    const f = await fixture(t, async (req, res) => {
        assert.equal(req.headers.origin, expectedOrigin);
        res.setHeader("Content-Type", "application/json");
        if (req.url === "/api/auth/sign-in/email") {
            for await (const part of req)
                loginBody += part;
            res.setHeader("Set-Cookie", ["better-auth.session_token=first; Path=/; HttpOnly; Max-Age=60", "better-auth.session_data=cache; Path=/"]);
            res.end(JSON.stringify({ token: "must-not-print", user: { id: "user", name: "test" } }));
        }
        else if (req.url === "/api/auth/sign-out") {
            res.setHeader("Set-Cookie", "better-auth.session_token=; Path=/; Max-Age=0");
            res.end('{"success":true}');
        }
        else {
            seenCookie = req.headers.cookie ?? "";
            res.setHeader("Set-Cookie", "better-auth.session_token=rotated; Path=/; Max-Age=60");
            res.end('{"data":{"id":"user"}}');
        }
    });
    expectedOrigin = f.origin;
    const login = await f.cli(["auth", "login", "--account", "13800138000", "--password-stdin"], "secret\n");
    assert.equal(login.code, 0, login.stderr);
    assert.deepEqual(JSON.parse(loginBody), { email: "13800138000@phone.spatialmemory.local", password: "secret" });
    assert.doesNotMatch(login.stdout + login.stderr, /must-not-print|secret|session_token/);
    assert.equal((await stat(f.config)).mode & 0o777, 0o600);
    assert.doesNotMatch(await readFile(f.config, "utf8"), /secret/);
    const me = await f.cli(["auth", "status", "--verbose"]);
    assert.equal(me.code, 0, me.stderr);
    assert.match(seenCookie, /session_token=first/);
    assert.match(me.stderr, /GET \/api\/users\/me → 200/);
    assert.doesNotMatch(me.stderr, /first|rotated/);
    assert.match(await readFile(f.config, "utf8"), /rotated/);
    const other = await fixture(t, (req, res) => { assert.equal(req.headers.cookie, undefined); res.end('{}'); });
    assert.equal((await other.cli(["users", "me", "--config", f.config])).code, 0);
    assert.equal((await f.cli(["auth", "logout"])).code, 0);
    assert.deepEqual(JSON.parse(await readFile(f.config, "utf8")).sessions, {});
});
test("cookie expiry, path boundaries, secure flag and deletion", () => {
    const headers = new Headers();
    headers.append("Set-Cookie", "a=one; Path=/api; Secure; Max-Age=60");
    headers.append("Set-Cookie", "b=two; Path=/; Expires=Wed, 21 Oct 2099 07:28:00 GMT");
    let jar = mergeCookies([], headers);
    assert.equal(cookieHeader(jar, new URL("http://test/api/me")), "b=two");
    assert.equal(cookieHeader(jar, new URL("https://test/apix")), "b=two");
    assert.equal(cookieHeader(jar, new URL("https://test/api/me")), "a=one; b=two");
    jar = mergeCookies(jar, new Headers({ "Set-Cookie": "b=gone; Path=/; Max-Age=0; Expires=Wed, 21 Oct 2099 07:28:00 GMT" }));
    assert.equal(jar.length, 1);
});
