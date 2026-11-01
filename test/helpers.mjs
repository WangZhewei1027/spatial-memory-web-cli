import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const cliPath = process.env.SPATIAL_MEMORY_TEST_CLI ?? fileURLToPath(new URL("../dist/cli.js", import.meta.url));
export async function fixture(t, handler) {
    const dir = await mkdtemp(join(tmpdir(), "spatial-memory-cli-test-"));
    const server = createServer(handler);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    t.after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(() => resolve())); await rm(dir, { recursive: true, force: true }); });
    const origin = `http://127.0.0.1:${address.port}`;
    const config = join(dir, "sessions.json");
    return { dir, origin, config, cli: (args, input = "", extra = {}) => invoke(args, { SPATIAL_MEMORY_BASE_URL: origin, SPATIAL_MEMORY_CLI_CONFIG: config, ...extra }, input) };
}
export function invoke(args, env, input = "") {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [cliPath, ...args], {
            cwd: process.env.SPATIAL_MEMORY_TEST_CWD ?? tmpdir(), env: { ...process.env, SPATIAL_MEMORY_PASSWORD: "", ...env }, stdio: ["pipe", "pipe", "pipe"],
        });
        let stdout = "", stderr = "";
        child.stdout.on("data", (data) => { stdout += data; });
        child.stderr.on("data", (data) => { stderr += data; });
        child.on("error", reject);
        child.on("close", (code) => resolve({ code, stdout, stderr }));
        child.stdin.on("error", () => { });
        child.stdin.end(input);
    });
}
