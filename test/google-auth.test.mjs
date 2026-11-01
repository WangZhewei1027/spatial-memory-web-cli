import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { request as httpRequest } from "node:http";
import { readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { fixture } from "./helpers.mjs";

const cliPath = process.env.SPATIAL_MEMORY_TEST_CLI ?? fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const grantCode = "G".repeat(43);
const user = { id: "google-user", name: "Google User", email: "google@example.test" };
const profile = { user_id: user.id, name: user.name, email: user.email, role: "user" };
const oldCookie = { name: "better-auth.session_token", value: "previous-session", path: "/", secure: false };

async function existingSession(f) {
  const data = JSON.stringify({ version: 1, sessions: { [f.origin]: [oldCookie], "https://other.example": [{ ...oldCookie, value: "other-origin-session" }] } }, null, 2) + "\n";
  await writeFile(f.config, data, { mode: 0o600 });
  return data;
}

function startLogin(t, f, args = []) {
  const child = spawn(process.execPath, [cliPath, "auth", "login", "--provider", "google", "--no-browser", ...args], {
    cwd: process.env.SPATIAL_MEMORY_TEST_CWD ?? tmpdir(),
    env: { ...process.env, SPATIAL_MEMORY_PASSWORD: "", SPATIAL_MEMORY_BASE_URL: f.origin, SPATIAL_MEMORY_CLI_CONFIG: f.config },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "", stderr = "", observedURL = false;
  let resolveURL, rejectURL;
  const authorization = new Promise((resolve, reject) => { resolveURL = resolve; rejectURL = reject; });
  // Some failure tests only await process completion.
  authorization.catch(() => {});
  const timer = setTimeout(() => { child.kill("SIGKILL"); rejectURL(new Error(`Google login test timed out: ${stderr}`)); }, 15000);
  const finished = new Promise((resolve, reject) => {
    child.stdout.on("data", (part) => { stdout += part; });
    child.stderr.on("data", (part) => {
      stderr += part;
      if (observedURL) return;
      for (const candidate of stderr.match(/https?:\/\/[^\s"<>]+/g) ?? []) {
        try {
          const url = new URL(candidate);
          if (url.pathname !== "/auth/cli") continue;
          observedURL = true;
          resolveURL(url);
          break;
        } catch { /* Other messages may contain an incomplete URL while streaming. */ }
      }
    });
    child.on("error", (error) => { clearTimeout(timer); rejectURL(error); reject(error); });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (!observedURL) rejectURL(new Error(`No browser authorization URL: ${stderr}`));
      resolve({ code, signal, stdout, stderr });
    });
  });
  child.stdin.on("error", () => {});
  child.stdin.end();
  t.after(async () => {
    clearTimeout(timer);
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await finished;
  });
  return { child, authorization, finished };
}

function callbackURL(authorization, values = {}) {
  const url = new URL(authorization.searchParams.get("redirect_uri"));
  url.searchParams.set("state", authorization.searchParams.get("state"));
  for (const [key, value] of Object.entries(values)) url.searchParams.set(key, value);
  return url;
}

function callback(url, { method = "GET", host, path } = {}) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(url, { method, ...(path ? { path } : {}), headers: host ? { Host: host } : {} }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (part) => { body += part; });
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on("error", reject);
    req.setTimeout(3000, () => req.destroy(new Error("Loopback callback timed out")));
    req.end();
  });
}

async function closedListener(authorization) {
  await assert.rejects(callback(callbackURL(authorization, { code: grantCode })), (error) => error.code === "ECONNREFUSED" || error.code === "ECONNRESET");
}

async function body(req) {
  let text = "";
  for await (const part of req) text += part;
  return JSON.parse(text);
}

test("Google browser login uses PKCE, validates its new session, and preserves origin isolation", async (t) => {
  const calls = [], configurations = [];
  const f = await fixture(t, (req, res) => {
    void (async () => {
      configurations.push(await readFile(f.config, "utf8"));
      calls.push({ path: req.url, method: req.method, origin: req.headers.origin, cookie: req.headers.cookie, body: req.method === "POST" ? await body(req) : null });
      res.setHeader("Content-Type", "application/json");
      if (req.url === "/api/auth/cli/exchange") {
        res.setHeader("Set-Cookie", "better-auth.session_token=new-private-session; Path=/; HttpOnly; Max-Age=60");
        res.end(JSON.stringify({ user, token: "must-never-print-google-token" }));
      } else if (req.url === "/api/users/me") {
        res.setHeader("Set-Cookie", "better-auth.session_token=verified-private-session; Path=/; HttpOnly; Max-Age=60");
        res.end(JSON.stringify({ data: profile }));
      } else { res.statusCode = 404; res.end('{}'); }
    })().catch((error) => { res.statusCode = 500; res.end(JSON.stringify({ error: error.message })); });
  });
  const previous = await existingSession(f);
  const running = startLogin(t, f, ["--verbose"]);
  const authorization = await running.authorization;
  assert.equal(authorization.origin, f.origin);
  assert.deepEqual([...authorization.searchParams.keys()].sort(), ["code_challenge", "redirect_uri", "state"]);
  assert.match(authorization.searchParams.get("state"), /^[A-Za-z0-9_-]{43}$/);
  assert.match(authorization.searchParams.get("code_challenge"), /^[A-Za-z0-9_-]{43}$/);
  const redirect = new URL(authorization.searchParams.get("redirect_uri"));
  assert.equal(redirect.protocol, "http:");
  assert.equal(redirect.hostname, "127.0.0.1");
  assert.equal(redirect.pathname, "/callback");
  assert.ok(Number(redirect.port) > 0);
  const accepted = await callback(callbackURL(authorization, { code: grantCode }));
  assert.ok(accepted.status >= 200 && accepted.status < 300);
  assert.ok(!accepted.body.includes(grantCode), "callback response must not echo the grant code");
  const result = await running.finished;
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { success: true, baseUrl: f.origin, provider: "google", user });
  assert.deepEqual(calls.map((call) => call.path), ["/api/auth/cli/exchange", "/api/users/me"]);
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].origin, f.origin);
  assert.equal(calls[0].cookie, undefined, "exchange must not inherit the previous CLI identity");
  assert.deepEqual(Object.keys(calls[0].body).sort(), ["code", "codeVerifier", "redirectUri"]);
  assert.equal(calls[0].body.code, grantCode);
  assert.equal(calls[0].body.redirectUri, redirect.href);
  assert.match(calls[0].body.codeVerifier, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(createHash("sha256").update(calls[0].body.codeVerifier).digest("base64url"), authorization.searchParams.get("code_challenge"));
  assert.equal(calls[1].cookie, "better-auth.session_token=new-private-session");
  assert.deepEqual(configurations, [previous, previous], "cookies must not be persisted before identity verification succeeds");
  const saved = JSON.parse(await readFile(f.config, "utf8"));
  assert.equal(saved.sessions[f.origin][0].value, "verified-private-session");
  assert.equal(saved.sessions["https://other.example"][0].value, "other-origin-session");
  assert.equal((await stat(f.config)).mode & 0o777, 0o600);
  for (const secret of [grantCode, calls[0].body.codeVerifier, "new-private-session", "verified-private-session", "must-never-print-google-token"]) {
    assert.ok(!(result.stdout + result.stderr).includes(secret), `Output leaked ${secret}`);
  }
  await closedListener(authorization);
});

test("invalid loopback requests do not consume a pending Google authorization", async (t) => {
  let exchangeCalls = 0;
  const f = await fixture(t, (req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/api/auth/cli/exchange") { exchangeCalls++; res.setHeader("Set-Cookie", "session=valid-session; Path=/"); res.end(JSON.stringify({ user })); }
    else res.end(JSON.stringify({ data: profile }));
  });
  const running = startLogin(t, f);
  const authorization = await running.authorization;
  const valid = callbackURL(authorization, { code: grantCode });
  const wrongState = new URL(valid); wrongState.searchParams.set("state", "X".repeat(43));
  const duplicateState = new URL(valid); duplicateState.searchParams.append("state", "Y".repeat(43));
  const wrongCode = new URL(valid); wrongCode.searchParams.set("code", "invalid-code");
  const newlineState = new URL(valid); newlineState.searchParams.set("state", valid.searchParams.get("state") + "\n");
  const newlineCode = new URL(valid); newlineCode.searchParams.set("code", grantCode + "\n");
  const oversized = new URL(valid); oversized.searchParams.set("padding", "x".repeat(9000));
  const both = new URL(valid); both.searchParams.set("error", "access_denied");
  for (const [url, options, expectedStatus] of [[wrongState, {}], [duplicateState, {}], [wrongCode, {}], [newlineState, {}, 400], [newlineCode, {}, 400], [oversized, {}], [both, {}], [valid, { method: "POST" }], [valid, { host: "evil.example" }], [valid, { path: "/wrong-path" }]]) {
    const response = await callback(url, options);
    assert.ok(response.status >= 400, `Accepted invalid request: ${url.href.slice(0, 200)} ${JSON.stringify(options)}`);
    if (expectedStatus !== undefined) assert.equal(response.status, expectedStatus);
  }
  assert.equal(exchangeCalls, 0);
  await callback(valid);
  const result = await running.finished;
  assert.equal(result.code, 0, result.stderr);
  assert.equal(exchangeCalls, 1);
  await closedListener(authorization);
});

test("Google denial, timeout, and interruption retain the existing session and close the listener", async (t) => {
  for (const scenario of ["denied", "timeout", "interrupt"]) await t.test(scenario, async (t) => {
    let requests = 0;
    const f = await fixture(t, (_req, res) => { requests++; res.end('{}'); });
    const previous = await existingSession(f);
    const running = startLogin(t, f, scenario === "timeout" ? ["--login-timeout", "300"] : []);
    const authorization = await running.authorization;
    if (scenario === "denied") await callback(callbackURL(authorization, { error: "access_denied" }));
    if (scenario === "interrupt") running.child.kill("SIGINT");
    const result = await running.finished;
    assert.notEqual(result.code, 0);
    if (scenario === "interrupt") assert.equal(result.code, 130, result.stderr);
    assert.equal(result.stdout, "");
    assert.equal(requests, 0);
    assert.equal(await readFile(f.config, "utf8"), previous);
    await closedListener(authorization);
  });
});

test("exchange failures and unverified sessions never replace an existing Google CLI session", async (t) => {
  for (const scenario of ["exchange-error", "missing-cookie", "identity-error", "wrong-identity", "exchange-timeout", "login-timeout-exchange", "interrupt-exchange"]) await t.test(scenario, async (t) => {
    let exchangeStarted;
    const exchange = new Promise((resolve) => { exchangeStarted = resolve; });
    const f = await fixture(t, (req, res) => {
      res.setHeader("Content-Type", "application/json");
      if (req.url === "/api/auth/cli/exchange") {
        exchangeStarted();
        if (["exchange-timeout", "login-timeout-exchange", "interrupt-exchange"].includes(scenario)) return;
        if (scenario === "exchange-error") { res.statusCode = 503; res.end(JSON.stringify({ error: "Google unavailable", token: "private-error-token" })); return; }
        if (scenario !== "missing-cookie") res.setHeader("Set-Cookie", "session=unverified-session; Path=/");
        res.end(JSON.stringify({ user }));
      } else {
        if (scenario === "identity-error") { res.statusCode = 401; res.end(JSON.stringify({ error: "identity rejected", token: "private-error-token" })); }
        else res.end(JSON.stringify({ data: { ...profile, user_id: scenario === "wrong-identity" ? "different-user" : user.id } }));
      }
    });
    const previous = await existingSession(f);
    const running = startLogin(t, f, scenario === "exchange-timeout" ? ["--timeout", "60"] : scenario === "login-timeout-exchange" ? ["--login-timeout", "300"] : []);
    const authorization = await running.authorization;
    await callback(callbackURL(authorization, { code: grantCode }));
    if (scenario === "interrupt-exchange") { await exchange; running.child.kill("SIGINT"); }
    const result = await running.finished;
    assert.notEqual(result.code, 0, `Unexpected success: ${scenario}`);
    if (scenario === "interrupt-exchange") assert.equal(result.code, 130, result.stderr);
    assert.equal(result.stdout, "");
    assert.doesNotMatch(result.stderr, /private-error-token|unverified-session/);
    assert.equal(await readFile(f.config, "utf8"), previous);
    await closedListener(authorization);
  });
});

test("Google-specific options reject invalid combinations before contacting the service", async (t) => {
  let requests = 0;
  const f = await fixture(t, (_req, res) => { requests++; res.end('{}'); });
  const cases = [
    ["--provider", "google", "--account", "you@example.test"],
    ["--provider", "google", "--password-stdin"],
    ["--provider", "unknown"],
    ["--provider", "google", "--login-timeout", "0"],
    ["--provider", "google", "--login-timeout", "NaN"],
    ["--provider", "google", "--base-url", "http://remote.example"],
    ["--provider", "password", "--account", "you@example.test", "--no-browser"],
    ["--provider", "password", "--account", "you@example.test", "--login-timeout", "100"],
  ];
  for (const options of cases) {
    const result = await f.cli(["auth", "login", ...options]);
    assert.equal(result.code, 2, `${options.join(" ")}: ${result.stderr}`);
    assert.equal(result.stdout, "");
  }
  assert.equal(requests, 0);
});
