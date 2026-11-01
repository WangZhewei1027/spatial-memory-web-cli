import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { cliModule } from "./helpers.mjs";

const { browserCommand, openBrowser } = await cliModule("browser.js");

test("browser launch keeps authorization URLs in one shell-free argument on each platform", async () => {
  const url = "https://app.example/auth/cli?state=abc&value=%24%28touch%20bad%29";
  for (const platform of ["darwin", "linux", "win32"]) {
    const command = browserCommand(url, platform);
    assert.equal(command.args.at(-1), url);
    assert.ok(!["sh", "bash", "cmd", "cmd.exe"].includes(command.command));
  }
  for (const unsafe of ["file:///tmp/command", "javascript:alert(1)", "https://user:secret@app.example/"]) assert.throws(() => browserCommand(unsafe));
  let called = false, unref = false;
  const result = await openBrowser(url, (command, args, options) => {
    called = true;
    assert.equal(args.at(-1), url);
    assert.equal(options.shell, false);
    assert.equal(options.stdio, "ignore");
    const child = new EventEmitter();
    child.unref = () => { unref = true; };
    queueMicrotask(() => { child.emit("spawn"); child.emit("exit", 0); });
    return child;
  });
  assert.equal(result, true);
  assert.equal(called, true);
  assert.equal(unref, true);
});

test("missing system browser opener leaves the manual authorization flow available", async () => {
  assert.equal(await openBrowser("http://localhost/auth/cli", () => {
    const child = new EventEmitter();
    queueMicrotask(() => child.emit("error", new Error("ENOENT")));
    return child;
  }), false);
});

test("a launcher that starts but fails reports manual fallback; cancellation stops waiting", async () => {
  assert.equal(await openBrowser("http://localhost/auth/cli", () => {
    const child = new EventEmitter(); child.unref = () => {};
    queueMicrotask(() => { child.emit("spawn"); child.emit("exit", 1); });
    return child;
  }), false);
  const controller = new AbortController();
  assert.equal(await openBrowser("http://localhost/auth/cli", () => {
    const child = new EventEmitter(); child.unref = () => {};
    queueMicrotask(() => { child.emit("spawn"); controller.abort(); });
    return child;
  }, controller.signal), false);
});
