import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const temp = await mkdtemp(join(tmpdir(), "spatial-memory-package-test-"));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const exec = (command, args, cwd = temp, env = process.env) => execFileSync(command, args, {
  cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32" && command.endsWith(".cmd"),
});

try {
  const [packed] = JSON.parse(exec(npm, ["pack", "--ignore-scripts", "--json", "--pack-destination", temp], root));
  for (const entry of packed.files) {
    assert.ok(/^(dist\/|docs\/|package\.json$|README\.md$|CHANGELOG\.md$)/.test(entry.path), `Unexpected package file: ${entry.path}`);
    assert.doesNotMatch(entry.path, /(^|\/)(node_modules|\.env[^/]*|sessions\.json)(\/|$)/);
  }
  const install = join(temp, "install");
  await mkdir(install);
  exec(npm, ["install", "--prefix", install, "--offline", "--ignore-scripts", "--omit=dev", "--no-audit", "--no-fund", join(temp, packed.filename)]);
  const installed = join(install, "node_modules", "spatial-memory-web-cli");
  const pkg = JSON.parse(await readFile(join(installed, "package.json"), "utf8"));
  assert.equal(Object.keys(pkg.dependencies ?? {}).length, 0);
  assert.deepEqual((await readdir(join(install, "node_modules"))).filter((name) => !name.startsWith(".")), ["spatial-memory-web-cli"]);
  const userDir = join(temp, "user");
  await mkdir(userDir);
  // Exercise the executable created by npm with an empty home and no project environment.
  const cleanEnv = { PATH: process.env.PATH, HOME: userDir, USERPROFILE: userDir, SystemRoot: process.env.SystemRoot };
  const binary = join(install, "node_modules", ".bin", process.platform === "win32" ? "spatial-memory.cmd" : "spatial-memory");
  assert.equal(exec(binary, ["--version"], userDir, cleanEnv).trim(), pkg.version);
  assert.match(exec(binary, ["--help"], userDir, cleanEnv), /Spatial Memory Web CLI/);
  const tests = (await readdir(join(root, "test"))).filter((name) => name.endsWith(".test.mjs")).map((name) => join(root, "test", name));
  const output = exec(process.execPath, ["--test", ...tests], userDir, {
    ...process.env, SPATIAL_MEMORY_TEST_CLI: join(installed, pkg.bin["spatial-memory"]), SPATIAL_MEMORY_TEST_CWD: userDir,
  });
  process.stdout.write(output);
  console.log(`PASS offline package install, spatial-memory executable and HTTP workflows (${packed.size} bytes; zero runtime dependencies)`);
} catch (error) {
  if (error.stdout) process.stderr.write(error.stdout);
  if (error.stderr) process.stderr.write(error.stderr);
  throw error;
} finally {
  await rm(temp, { recursive: true, force: true });
}
