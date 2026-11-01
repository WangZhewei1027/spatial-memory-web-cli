import { emitKeypressEvents } from "node:readline";
import { stdinText } from "./args.js";
import { CliError } from "./errors.js";

export async function password(fromStdin: boolean): Promise<string> {
  if (fromStdin) return (await stdinText()).replace(/\r?\n$/, "");
  if (process.env.SPATIAL_MEMORY_PASSWORD) return process.env.SPATIAL_MEMORY_PASSWORD;
  if (!process.stdin.isTTY) throw new CliError("请通过 SPATIAL_MEMORY_PASSWORD 或 --password-stdin 提供密码");
  return new Promise((resolve, reject) => {
    const input = process.stdin;
    const wasRaw = input.isRaw;
    let value = "";
    emitKeypressEvents(input);
    input.setRawMode(true);
    input.resume();
    process.stderr.write("密码（隐藏输入）：");
    const finish = () => { input.off("keypress", onKey); input.setRawMode(wasRaw); input.pause(); process.stderr.write("\n"); };
    const onKey = (text: string, key: { name?: string; ctrl?: boolean }) => {
      if (key.ctrl && key.name === "c") { finish(); reject(new CliError("已取消", 130)); }
      else if (key.name === "return" || key.name === "enter") { finish(); resolve(value); }
      else if (key.name === "backspace") value = [...value].slice(0, -1).join("");
      else if (text && !key.ctrl && !text.includes("\u001b")) value += text;
    };
    input.on("keypress", onKey);
  });
}
