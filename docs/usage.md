# 命令使用说明

CLI 通过 HTTP(S) 操作 Web 管理平台。需要 Node.js 22+，无需下载或启动 Web 项目；线上服务保持运行即可。权限、业务校验和冲突检查由服务端处理。

## 开始使用

安装分享的包后，在任意目录执行：

```bash
npm install --global ./spatial-memory-web-cli-0.2.0.tgz
export SPATIAL_MEMORY_BASE_URL=https://your-web.example
spatial-memory --help
spatial-memory auth login --account you@example.com
# 手机号账号也可以：spatial-memory auth login --account 13800138000
spatial-memory auth status
spatial-memory orgs list
spatial-memory workspaces list --org <organization-id>
```

登录时终端隐藏密码输入。自动化可用 `SPATIAL_MEMORY_PASSWORD` 环境变量或 `--password-stdin` 从标准输入读取密码；没有命令行明文密码选项。CLI 仅保存会话 Cookie，文件权限为 `0600`，默认位置为 `~/.config/spatial-memory/sessions.json`，按 origin（协议、主机、端口）隔离。使用 `auth logout` 注销服务端会话并清除本地记录。

`--base-url` > `SPATIAL_MEMORY_BASE_URL` > `http://localhost:3000`；服务地址只接受 origin，不接受路径、用户名或密码。每次调用显式选择服务，登录不会改变默认地址。例如：

```bash
export SPATIAL_MEMORY_BASE_URL=https://your-web-host.example
spatial-memory auth login --account you@example.com
spatial-memory orgs list
```

`--config` > `SPATIAL_MEMORY_CLI_CONFIG` > 默认会话文件。可用不同会话文件同时调试多个账号。远程服务使用 HTTPS；CLI 不会把 Secure Cookie 发到 HTTP 服务，也不会跟随重定向。

0.2.0 使用新命令、环境变量和默认配置目录。升级既有脚本时同步更新这些名称；如需复用旧会话文件，通过 `--config` 显式指定其路径。

## 素材操作

以下示例中的 `<workspace-id>`、`<asset-id>` 等需要替换为查询到的真实 ID。

```bash
spatial-memory assets list --workspace <workspace-id>
spatial-memory assets list --org <organization-id> --type model
spatial-memory assets get <asset-id> --workspace <workspace-id>
spatial-memory assets create --workspace <workspace-id> --type text --name "CLI 测试" --text "你好"
spatial-memory assets update <asset-id> --data '{"name":"新名称","text_content":"新内容"}'
spatial-memory assets move --data '{"moves":[{"assetId":"<asset-id>","longitude":121.5,"latitude":31.2,"height":0}]}'
spatial-memory assets copy --data '{"ids":["<asset-id>"],"offsetMeters":4}'
spatial-memory assets delete <asset-id>
```

`assets list/get` 必须选择 `--workspace` 或 `--org` 中的一个；普通素材详情通过该范围的列表查找。`scenes get` 调用场景专用读取接口。

`--data` 接受 JSON 对象字符串、`@文件路径` 或 `-`（标准输入），字段与服务端 API 一致。创建时 `--type`、`--name`、`--text` 优先于 `--data` 对应字段。复杂坐标、metadata、config、tag_ids、anchor_id 等用 JSON 文件传入。定位优先用 `assets move`，它同时更新 location 与 metadata；手动创建带坐标素材时，需要同时提供 `location: "POINT(lng lat)"` 和 metadata 中的经纬度。

```bash
spatial-memory assets create --workspace <workspace-id> --data @asset.json
spatial-memory assets update <asset-id> --data @patch.json --dry-run
```

`--dry-run` 校验本地输入并打印请求计划，不发请求、不读取登录会话。删除命令执行现有服务端删除逻辑；可先用此参数检查目标。

## 文件上传

```bash
spatial-memory assets upload ./model.glb --workspace <workspace-id> --type model --name "建筑模型"
spatial-memory assets upload ./photo.jpg --workspace <workspace-id> --type image --data @metadata.json
```

上传先调用 `/api/upload`，再创建素材；沿用组织内内容 hash 去重。上传服务当前限制非空文件且不超过 **5 MiB**。CLI 发送原文件，不做浏览器侧的图片压缩、EXIF GPS 提取、音视频元数据提取或转码；这些信息可通过 `--data` 提供。常用扩展名自动设置 MIME，其余可用 `--mime` 指定。上传匹配点时需在 `--data` 中提供 metadata 经纬度。场景、文本和链接使用 `assets create`。

如果素材创建被明确拒绝（4xx，408 除外），CLI 对本次新上传文件调用现有安全清理接口；去重命中的文件不会清理。超时或 5xx 可能意味着服务端已写入，CLI 会保留文件并在 stderr 的 `details.upload` 返回 URL、hash 和 storagePath，先查询素材再决定重试或调用 `api DELETE /api/upload --query key=…`。CLI 不自动重试写操作。

## 场景 JSON 调试

`scenes init` 和 `scenes validate` 离线工作，使用安装包内置的场景协议 v1/v2 校验快照。模型是否存在、工作区归属等仍由保存 API 校验。

```bash
spatial-memory scenes init > scene.json
spatial-memory scenes validate scene.json
spatial-memory assets create --workspace <workspace-id> --name "CLI 场景" --scene-file scene.json
spatial-memory scenes get <scene-id> > scene-response.json
```

读取响应含 `data.text_content`、`data.scene_revision` 和可引用模型列表 `models`。可用 jq 提取 JSON 后编辑：

```bash
jq -r '.data.text_content' scene-response.json > scene.json
spatial-memory scenes validate scene.json
spatial-memory scenes save <scene-id> --scene-file scene.json --revision <scene_revision>
```

`--revision` 使用本次读取的版本值。如果其他编辑者先保存，服务器返回 409；CLI 不覆盖冲突，需要重新读取并合并。`assets update` 和通用 `api` 接口保留原始字段能力；编辑场景请优先使用 `scenes save`。

## 管理与通用 API

| 命令 | 用途 |
|---|---|
| `orgs list/get/create/update/delete/members` | 组织与成员列表 |
| `workspaces list/get/create/update/delete` | 工作区 |
| `users me/list/create/update/deletion-preview/delete` | 当前用户和管理员用户管理 |
| `tags list/create/update/delete` | 标签 |
| `assets matching/rebuild <id>` | 匹配特征状态/重建 |
| `logs list` | 超级管理员错误日志 |
| `api METHOD /api/path` | 其余 JSON API：成员修改、邀请、系统配置、小程序接口等 |

创建/修改管理资源使用 `--data`，ID 作为位置参数。工作区创建 body 至少包含 name 和 organization_id；工作区修改需包含 name。所有 GET 资源命令支持重复 `--query key=value`，参数按 API 原名传递。

```bash
spatial-memory workspaces create --data '{"name":"调试工作区","organization_id":"<organization-id>"}'
spatial-memory logs list --query statusClass=5xx --query limit=20 --query q=scene
spatial-memory api PATCH /api/organizations/<organization-id>/members --data '{"member_id":"<member-id>","role":"viewer"}'
spatial-memory api GET /api/admin/app-config
spatial-memory assets rebuild <anchor-id> --timeout 120000 --verbose
```

命令列表以 `--help` 为准。原 API 的权限限制保持生效，例如日志和全局用户管理需要 super_admin。通用 `api` 仅支持当前服务的 `/api/…` JSON 请求；文件上传使用 `assets upload`。浏览器内存、地图相机、iframe 消息、UI 渲染以及未暴露为 API 的 server action 不在此 CLI 的控制范围。

## 脚本、输出和验证

业务成功结果为 stdout JSON；错误为 stderr JSON；`--verbose` 的状态和耗时也写入 stderr。用 `--compact` 获取单行 JSON。命令输出可直接重定向或通过管道处理。

退出码：0 成功，1 API/网络失败，2 参数错误，3 未登录/会话过期，4 无权限，130 用户取消。超时单位为毫秒，默认 30000。

独立工具的开发验证命令：

```bash
npm ci
npm run typecheck
npm test
npm run test:package
npm pack
```

测试使用本机临时 HTTP 服务，不连接数据库、OSS 或线上服务。打包测试会将 `.tgz` 离线安装到临时目录，并从 Web 项目之外执行安装后的命令。
