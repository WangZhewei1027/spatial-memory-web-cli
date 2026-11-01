# 命令使用说明

需要 Node.js 22+ 和可访问的 Web 服务。账号、团队权限和冲突校验由服务端执行；CLI 没有运行时依赖。

## 登录与服务地址

```bash
npm install --global ./spatial-memory-web-cli-0.2.1.tgz
export SPATIAL_MEMORY_BASE_URL=https://www.spatialmemory.online
spatial-memory auth login --account you@example.com
spatial-memory auth status
spatial-memory orgs list
```

手机号同样用于 `--account`。密码从隐藏终端、`SPATIAL_MEMORY_PASSWORD` 或 `--password-stdin` 读取；没有明文密码参数。会话按 origin 隔离，默认保存到 `~/.config/spatial-memory/sessions.json`（0600），不保存密码。`--config` 或 `SPATIAL_MEMORY_CLI_CONFIG` 可指定另一会话文件。CLI 不读取项目 `.env`。

服务地址优先级是 `--base-url`、`SPATIAL_MEMORY_BASE_URL`、`http://localhost:3000`。只接受 origin，无路径、账号或密码。Secure Cookie 不会发到 HTTP，也不自动跟随重定向。`auth logout` 注销会话。

## 团队素材与地图合集

以下大写 ID 必须替换成真实响应中的 ID。素材属于团队，合集中的放置点引用素材或场景。

```bash
spatial-memory collections list --org TEAM_ID
spatial-memory collections create --org TEAM_ID --data '{"name":"地图"}'
spatial-memory collections update COLLECTION_ID --data '{"name":"新地图名"}'
spatial-memory collections archive COLLECTION_ID
spatial-memory collections restore COLLECTION_ID

spatial-memory assets list --org TEAM_ID --type model
spatial-memory assets list --collection COLLECTION_ID
spatial-memory assets get ASSET_ID
spatial-memory assets create --org TEAM_ID --type text --name "文字" --text "你好" --idempotency-key my-text-1
spatial-memory assets update ASSET_ID --data '{"name":"新名称","expectedLockVersion":0}'
spatial-memory assets usage ASSET_ID
spatial-memory assets duplicate ASSET_ID --data '{"name":"副本","idempotencyKey":"copy-1"}'
spatial-memory assets delete ASSET_ID --lock-version 1
```

`assets delete` 表示归档，已引用内容由服务端保留；恢复使用 `assets update` 的 `state: "active"` 与当前 `expectedLockVersion`。`assets get` 直接读取详情，无需扫描目录。

创建字段为 `name`、`fileType`、`payload`、`resources`、`idempotencyKey`；`--data` 接受 JSON、`@文件.json` 或 `-`（stdin）。简单字段可由 `--name`、`--type`、`--text` 覆盖。`payload.kind` 必须匹配类型；复杂内容用 JSON 文件。未给幂等键时创建命令生成一个；需要手动重试同一次操作时显式保留 `--idempotency-key`。

## 上传文件

```bash
spatial-memory assets upload ./model.glb --org TEAM_ID --type model --name "建筑" --idempotency-key building-1
spatial-memory assets upload ./photo.jpg --org TEAM_ID --type image --data @attributes.json --timeout 120000
```

上传先 `POST /api/upload`（`organization_id`、`purpose=asset`），再向团队创建素材，`resources` 引用返回的 `data.id` 回执。不能用客户端提供的 `file_url` 代替回执。原文件限制与服务端一致：模型 3 MiB、文档 5 MiB、图片/音频/识别图 32 MiB、视频 512 MiB。视频还有服务端时长限制。服务端处理图片、音视频，返回的是处理后对象的 URL/hash；CLI 不做 EXIF 或浏览器处理。

明确创建拒绝（4xx，408 除外）时，仅对新上传文件调用安全清理；去重文件不清理。超时/5xx 可能已提交，不自动重试或删除。错误的 `details.createRequest` 保存原幂等键与回执，可查询后重试该精确请求。`details.upload` 包含对象路径供人工排查。

## 独立场景文档

```bash
spatial-memory scenes init > scene.json
spatial-memory scenes validate scene.json
spatial-memory scenes create --org TEAM_ID --name "场景" --scene-file scene.json
spatial-memory scenes list --org TEAM_ID
spatial-memory scenes get SCENE_ID > scene-response.json
jq '.data.document' scene-response.json > scene.json
spatial-memory scenes save SCENE_ID --scene-file scene.json --lock-version 0
spatial-memory scenes archive SCENE_ID --lock-version 1
spatial-memory scenes restore SCENE_ID --lock-version 2
```

`init` 和 `validate` 离线处理 schema 6 编辑文档。支持欧拉角、嵌套分组、媒体、空间文字、透明度/音量关键帧与空间音频。读取 `data.lock_version` 后将同一值传给 `--lock-version`；其他编辑者先保存会返回 409，必须重读并合并，CLI 不覆盖。服务端另外校验素材存在、团队归属与当前资源。场景不通过 `assets create` 创建。

## 放置点与管理接口

```bash
spatial-memory placements list --collection COLLECTION_ID
spatial-memory placements create --collection COLLECTION_ID --data @placement.json
spatial-memory placements get PLACEMENT_ID
spatial-memory placements update PLACEMENT_ID --data @patch.json
spatial-memory placements copy PLACEMENT_ID --data '{"targetWorkspaceId":"COLLECTION_ID"}'
spatial-memory placements delete PLACEMENT_ID --lock-version 0
spatial-memory placements move --data @moves.json
spatial-memory tags list --collection COLLECTION_ID
spatial-memory logs list --query statusClass=5xx --query limit=20
spatial-memory api GET /api/admin/app-config
```

放置点创建、移动和修改 JSON 使用服务端公开契约，含当前位置、目标资源和版本锁；`targetWorkspaceId` 是 API 对合集 ID 的字段名。旧 `workspaces`、`assets move/copy` 命令已移除。`orgs`、`users`、`tags` 和日志保持服务端权限；所有可用命令见 `--help`。未封装 API 用 `api METHOD /api/path`，仅允许同一服务 `/api/` 下的 JSON 请求。

## 输出与验证

成功为 stdout JSON，错误和 `--verbose` 为 stderr；`--compact` 输出单行。`--dry-run` 只显示请求计划，不读取会话、不发网络（auth 不支持）。`--data` 字段严格沿用当前 API，CLI 不改写旧请求。退出码：0 成功、1 API/网络失败、2 输入错误、3 未登录、4 无权限、130 取消。

```bash
npm ci
npm test
npm run test:package
npm pack
```

测试使用临时 HTTP 服务，不碰线上或数据库。安装包测试在独立临时目录离线安装并执行全部 HTTP 工作流。
