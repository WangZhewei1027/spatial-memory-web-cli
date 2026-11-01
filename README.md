# Spatial Memory Web CLI

独立操作 Spatial Memory Web 服务的命令行工具。对应 Web 仓库为 `spatial-memory`，本 CLI 的独立包名为 `spatial-memory-web-cli`。只需 **Node.js 22+** 和一个可访问的 Web 服务地址，无需下载 Web 项目、运行本地服务器或配置数据库。安装包没有运行时依赖。

## 安装和连接线上服务

收到 `spatial-memory-web-cli-0.2.0.tgz` 后，在任意目录安装：

```bash
npm install --global ./spatial-memory-web-cli-0.2.0.tgz
spatial-memory --version
spatial-memory --help

export SPATIAL_MEMORY_BASE_URL=https://your-web.example
spatial-memory auth login --account you@example.com
spatial-memory auth status
spatial-memory orgs list
spatial-memory workspaces list --org ORGANIZATION_ID
spatial-memory assets list --workspace WORKSPACE_ID
```

PowerShell 设置服务地址使用 `$env:SPATIAL_MEMORY_BASE_URL = "https://your-web.example"`。也可为每次调用添加 `--base-url https://your-web.example`。邮箱和手机号账号都支持，登录时隐藏密码输入，沿用线上账号的权限。

当前交付方式为 `.tgz` 文件，尚未发布到 npm。分享这个安装包即可；安装包自身不包含账号、会话、环境变量文件或 Web 项目源码。

## 常用操作

```bash
spatial-memory assets create --workspace WORKSPACE_ID --type text --name "调试素材" --text "你好"
spatial-memory assets upload ./model.glb --workspace WORKSPACE_ID --type model
spatial-memory assets update ASSET_ID --data @patch.json --dry-run
spatial-memory scenes init > scene.json
spatial-memory scenes validate scene.json
spatial-memory logs list --query statusClass=5xx --query limit=20
spatial-memory api GET /api/admin/app-config
spatial-memory auth logout
```

覆盖组织、工作区、素材、文件上传、场景、用户、标签、匹配特征和日志。通用 `api` 命令调用其余 JSON API。成功输出为 JSON，可直接重定向或管道传给 jq；错误及 `--verbose` 诊断写入 stderr。

`--dry-run` 仅预览请求。上传保留原文件，当前服务端限制 5 MiB；场景保存支持版本冲突检测。完整参数、场景编辑、脚本使用和退出码见 [使用文档](docs/usage.md)。

会话默认保存在 `~/.config/spatial-memory/sessions.json`，权限 `0600`，按服务地址隔离；密码不保存。`SPATIAL_MEMORY_CLI_CONFIG` 或 `--config` 可选择不同的会话文件。CLI 不读取项目 `.env` 文件。

从旧版升级时，更新脚本中的命令和环境变量名称。需要复用原有会话时，可用 `--config` 显式指定原会话文件；默认配置路径不会自动迁移。

## 独立开发与打包

此目录是完整的独立 Node.js 包，可单独存入 Git 仓库。不使用 monorepo workspace、相邻目录或 Web 项目的 node_modules。

```bash
npm ci
npm test
npm run test:package
npm pack
```

`npm pack` 自动编译 TypeScript，输出可分享的 `.tgz`。接收者无需 TypeScript 或开发依赖。`npm run test:package` 在临时目录离线安装包，通过 npm 生成的 `spatial-memory` 命令和完整 HTTP 模拟测试验证安装产物，不访问线上数据。

源码位于 `src/`；场景协议快照的兼容性和维护说明见 [协议文档](docs/protocol.md)。当前包的许可证标识为 `UNLICENSED`，未声明开源许可证。
