import { parse, check, type Args } from "./args.js";
import { settings } from "./config.js";
import { Client, type RequestPlan } from "./client.js";
import { CliError } from "./errors.js";
import { authCommand } from "./auth.js";
import { resourcePlan, rawPlan } from "./resources.js";
import { assetCreatePlan, assetListPlan, archivePlan } from "./assets.js";
import { sceneWritePlan } from "./scenes.js";
import { uploadCommand } from "./upload.js";
import { HELP } from "./help.js";
import { VERSION } from "./version.js";
import { authoring } from "./authoring.js";
import { sceneAgentCommand } from "./scene-agent.js";
import { runCommand } from "./runs.js";
import { importAsset, inspectAsset, searchAssets } from "./asset-agent.js";

async function plan(args: Args): Promise<RequestPlan> {
  const key = args.words.slice(0, 2).join(" ");
  if (args.words[0] === "api") return rawPlan(args);
  if (key === "assets list" || key === "assets get") return assetListPlan(args);
  if (key === "assets create") return assetCreatePlan(args);
  if (["scenes create", "scenes save", "scenes archive", "scenes restore"].includes(key)) return sceneWritePlan(args);
  if (["assets delete", "placements delete"].includes(key)) return archivePlan(args);
  const resource = await resourcePlan(args);
  if (!resource) throw new CliError("未知命令，运行 spatial-memory --help 查看用法");
  return resource;
}

export async function run(argv: string[]): Promise<void> {
  const args = parse(argv);
  if (args.options.version) { process.stdout.write(VERSION + "\n"); return; }
  if (args.options.help || !args.words.length) { process.stdout.write(HELP); return; }
  const print = (value: unknown) => process.stdout.write(JSON.stringify(value, null, args.options.compact ? undefined : 2) + "\n");
  const key = args.words.slice(0, 2).join(" ");
  if (key === "scenes init") { check(args, 2); print(authoring.createDocument()); return; }
  const client = new Client({ ...settings(args.options), verbose: !!args.options.verbose });
  if (args.words[0] === "runs") { print(await runCommand(args, client)); return; }
  if (["scenes apply", "scenes inspect", "scenes sample", "scenes diff", "scenes render", "scenes validate"].includes(key) || (key === "scenes save" && args.options.run)) { print(await sceneAgentCommand(args, client)); return; }
  if (["assets search", "assets inspect", "assets import"].includes(key)) {
    if (!args.options["dry-run"]) await client.load();
    print(await (key === "assets search" ? searchAssets(args, client) : key === "assets inspect" ? inspectAsset(args, client) : importAsset(args, client))); return;
  }
  if (args.words[0] === "auth") { await client.load(); print(await authCommand(args, client)); return; }
  if (key === "assets upload") {
    if (!args.options["dry-run"]) await client.load();
    print(await uploadCommand(args, client)); return;
  }
  const request = await plan(args);
  const url = client.url(request.path);
  if (args.options["dry-run"]) { print({ method: request.method, url: url.href, body: request.body }); return; }
  await client.load();
  const result = await client.request(request);
  print(result);
}
