export const HELP = `Spatial Memory Web CLI — 独立的 Web API 工具（Node.js 22+）

用法：spatial-memory <命令> [参数]
默认 JSON 输出，可直接用于脚本和管道。

auth login --account <邮箱或手机号> [--password-stdin]
auth status | logout
orgs list | get <id> | create --data <json> | update <id> --data <json> | delete <id> | members <id>
collections list --org <id> | create --org <id> --data <json>
collections get <id> | update <id> --data <json> | archive <id> | restore <id>
assets list [--collection <id> | --org <id>] [--type <type>] | get <id>
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
所有 GET 资源命令支持重复 --query key=value。管理员命令沿用服务器权限。
上传发送原文件，由服务端处理媒体并签发回执；素材引用回执，场景保存 schema 6 文档。
退出码：0 成功，1 API/网络失败，2 参数错误，3 未登录，4 无权限，130 取消。
详见 docs/usage.md。
`;
