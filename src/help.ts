export const HELP = `Spatial Memory Web CLI — 独立的 Web API 工具（Node.js 22+）

用法：spatial-memory <命令> [参数]
默认 JSON 输出，可直接用于脚本和管道。

auth login --account <邮箱或手机号> [--password-stdin] [--provider password]
auth login --provider google [--no-browser] [--login-timeout <ms>]
auth status | logout
orgs list | get <id> | create --data <json> | update <id> --data <json> | delete <id> | members <id>
collections list --org <id> | create --org <id> --data <json>
collections get <id> | update <id> --data <json> | archive <id> | restore <id>
assets list [--collection <id> | --org <id>] [--type <type>] | get <id>
assets search [--org <id> | --collection <id>] [--search <name>] [--type <type>] [--limit <count>]
assets inspect <asset-id|file|url> [--type <type>] [--output-dir <dir>] [--cache-dir <dir>]
assets import <file|url> --org <id> --type <type> [--source-page <url>] [--idempotency-key <key>] [--cache-dir <dir>]
assets create --org <id> --type <type> --name <名称> [--text <内容>] [--data <json>] [--idempotency-key <key>]
assets upload <file> --org <id> --type <type> [--name <名称>] [--data <json>] [--mime <mime>] [--idempotency-key <key>]
assets update <id> --data <json> | delete <id> --lock-version <lock_version>
assets duplicate <id> --data <json> | usage <id>
placements list --collection <id> | create --collection <id> --data <json>
placements get <id> | update <id> --data <json> | delete <id> --lock-version <lock_version>
placements move --data <json> | copy <id> --data <json>
assets matching <id> | rebuild <id>
scenes init | validate <file> | list --org <id> | get <id> | copy <id> --data <json>
scenes create --org <id> --name <名称> [--scene-file <file>] [--idempotency-key <key>]
scenes archive <id> --lock-version <lock_version> | restore <id> --lock-version <lock_version>
scenes save <id> --scene-file <file> --lock-version <lock_version> [--name <名称>]
scenes inspect | validate --run <id> [--runs-dir <dir>] [--remote --org <id>]
scenes apply --run <id> --revision <n> --ops <json|@file|-> [--facts @file] [--runs-dir <dir>]
scenes apply --scene-file <file> --ops <json|@file|-> --out <file>
scenes sample [--run <id> | --scene-file <file>] --time <seconds> [--facts @file]
scenes diff <before.json> <after.json>
scenes render [--run <id> | --scene-file <file>] [--times auto|0,1,2] [--cameras audience,top,side|@file] [--camera-file @file] [--resources @file] [--output-dir <dir>] [--width <px> --height <px> --overlays]
scenes save [scene-id] --run <id> --revision <n> [--lock-version <n>] [--org <id> --name <name>]
runs open [--scene <id> | --scene-file <file>] [--run <id>] [--runs-dir <dir>]
runs status <id> | history <id> [--runs-dir <dir>]
runs restore <id> <target-revision> --revision <current-revision> [--runs-dir <dir>]
users me | list | create --data <json> | update <id> --data <json> | deletion-preview <id> | delete <id>
tags list [--collection <id> | --org <id>] | create --data <json> | update <id> --data <json> | delete <id>
logs list [--query key=value ...]
api <GET|POST|PUT|PATCH|DELETE> </api/path> [--query key=value ...] [--data <json>]

全局选项：
  --base-url <origin>  默认 SPATIAL_MEMORY_BASE_URL 或 http://localhost:3000
  --config <path>      默认 SPATIAL_MEMORY_CLI_CONFIG 或 ~/.config/spatial-memory/sessions.json
  --timeout <ms>       默认 30000；慢速匹配/上传可调大
  --dry-run            仅输出请求计划，不发送请求（auth 不支持）
  --verbose            在 stderr 打印方法、路径、HTTP 状态和耗时
  --compact            单行 JSON；默认缩进 JSON
  -h, --help           查看帮助
  -v, --version        查看工具版本

--data 支持 JSON 字符串、@文件.json、-（标准输入）。
密码通过隐藏终端输入、SPATIAL_MEMORY_PASSWORD 或 --password-stdin 提供，不写入配置。
Google 登录在本机浏览器完成，默认等待 5 分钟；--no-browser 输出地址供手动打开，Ctrl+C 取消。
Google 登录需 HTTPS（本地服务可用 HTTP）；浏览器与 CLI 须在同一台电脑，服务需支持 /auth/cli。
所有 GET 资源命令支持重复 --query key=value。管理员命令沿用服务器权限。
上传发送原文件，由服务端处理媒体并签发回执；素材引用回执，场景保存 schema 6 文档。
退出码：0 成功，1 API/网络失败，2 参数错误，3 未登录，4 无权限，130 取消。
素材 import 原文件上限沿用服务端，model 为 5 MiB。场景操作字段详见 docs/agent.md。
详见 docs/usage.md。
`;
