import { spawn } from "node:child_process";

/** Pass the URL as one argument; never interpret it through a command shell. */
export function browserCommand(url: string, platform: NodeJS.Platform = process.platform): { command: string; args: string[] } | null {
  const target = new URL(url);
  if (!["https:", "http:"].includes(target.protocol) || target.username || target.password) throw new Error("Invalid browser login URL");
  if (platform === "darwin") return { command: "open", args: [target.href] };
  if (platform === "win32") return { command: "rundll32.exe", args: ["url.dll,FileProtocolHandler", target.href] };
  if (platform === "linux") return { command: "xdg-open", args: [target.href] };
  return null;
}

export async function openBrowser(url: string, launch: typeof spawn = spawn, signal?: AbortSignal): Promise<boolean> {
  const plan = browserCommand(url);
  if (!plan || signal?.aborted) return false;
  return new Promise(resolve => {
    const child = launch(plan.command, plan.args, { stdio: "ignore", shell: false, detached: true, windowsHide: true });
    let settled = false, timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (opened: boolean) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      child.off("spawn", spawned); child.off("exit", exited); signal?.removeEventListener("abort", abort);
      resolve(opened);
    };
    const abort = () => finish(false);
    const exited = (code: number | null) => finish(code === 0);
    const spawned = () => {
      child.unref();
      // Most launchers exit immediately. Some stay with the browser; do not await that lifetime.
      timer = setTimeout(() => finish(true), 1000);
    };
    child.once("error", () => finish(false));
    child.once("exit", exited); child.once("spawn", spawned);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}
