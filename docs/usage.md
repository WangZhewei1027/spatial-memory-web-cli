# 命令使用说明

需要 Node.js 22+ 和可访问的 Web 服务。账号、团队权限和冲突校验由服务端执行；共享编排与渲染依赖随安装包交付，图片渲染另需本机 Chrome/Chromium。

## 登录与服务地址

```bash
npm install --global ./spatial-memory-web-cli-0.3.0.tgz
export SPATIAL_MEMORY_BASE_URL=https://www.spatialmemory.online
spatial-memory auth login --provider google
# 或使用邮箱/手机号和密码
spatial-memory auth login --account you@example.com
spatial-memory auth status
spatial-memory orgs list
```

手机号同样用于 `--account`。密码从隐藏终端、`SPATIAL_MEMORY_PASSWORD` 或 `--password-stdin` 读取；没有明文密码参数。会话按 origin 隔离，默认保存到 `~/.config/spatial-memory/sessions.json`（0600），不保存密码。`--config` 或 `SPATIAL_MEMORY_CLI_CONFIG` 可指定另一会话文件。CLI 不读取项目 `.env`。

Google 登录会打开系统浏览器，在 Web 登录并确认授权后自动返回 CLI。浏览器与 CLI 须在同一台电脑；CLI 使用只监听 `127.0.0.1` 的临时回调端口，完成或取消时自动关闭。`--no-browser` 仅输出授权地址，供手动在同机浏览器打开。默认等待 5 分钟，`--login-timeout <毫秒>` 调整整个登录期限，`--timeout` 单独控制每次 HTTP 请求。Ctrl+C 取消登录。不要把授权链接发送给他人。

CLI 通过一次性授权码和 PKCE 交换本站会话，校验当前用户后才保存；Google token、授权码和 PKCE verifier 不写入会话文件或命令输出。失败、拒绝和超时保留原有会话。Google 登录不能同时使用 `--account` 或 `--password-stdin`；原密码登录也可显式指定 `--provider password`。远端服务必须使用 HTTPS，本地 `localhost`、`127.0.0.1` 和 `::1` 服务可使用 HTTP。此功能需要配套部署 Web `/auth/cli` 授权页面与 `/api/auth/cli/exchange` 接口，未升级服务器不能完成浏览器登录。

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
spatial-memory assets duplicate ASSET_ID --data '{"name":"副本","idempotencyKey":"copy-0001"}'
spatial-memory assets delete ASSET_ID --lock-version 1
```

`assets delete` 表示归档，已引用内容由服务端保留；恢复使用 `assets update` 的 `state: "active"` 与当前 `expectedLockVersion`。`assets get` 直接读取详情，无需扫描目录。

创建字段为 `name`、`fileType`、`payload`、`resources`、`idempotencyKey`；`--data` 接受 JSON、`@文件.json` 或 `-`（stdin）。简单字段可由 `--name`、`--type`、`--text` 覆盖。`payload.kind` 必须匹配类型；复杂内容用 JSON 文件。未给幂等键时创建命令生成一个；需要手动重试同一次操作时显式保留 `--idempotency-key`。

## 上传文件

```bash
spatial-memory assets upload ./model.glb --org TEAM_ID --type model --name "建筑" --idempotency-key building-1
spatial-memory assets upload ./photo.jpg --org TEAM_ID --type image --data @attributes.json --timeout 120000
```

上传先 `POST /api/upload`（`organization_id`、`purpose=asset`），再向团队创建素材，`resources` 引用返回的 `data.id` 回执。识别图（anchor）使用 `reference` 角色，其他文件使用 `primary`。不能用客户端提供的 `file_url` 代替回执。原文件限制与服务端一致：模型 5 MiB、文档 5 MiB、图片/音频/识别图 32 MiB、视频 512 MiB。视频还有服务端时长限制。服务端处理图片、音视频，返回的是处理后对象的 URL/hash；CLI 上传原文件，独立探测不会改写源文件。

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

`init` 和 `validate` 离线处理 schema 6 编辑文档。支持欧拉角、嵌套分组、媒体、空间文字、透明度/音量关键帧、空间音频与 `viewerPosition` 观看位置。读取 `data.lock_version` 后将同一值传给 `--lock-version`；其他编辑者先保存会返回 409，必须重读并合并，CLI 不覆盖。服务端另外校验素材存在、团队归属与当前资源。场景不通过 `assets create` 创建。

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

放置点创建、移动和修改 JSON 使用服务端公开契约，含当前位置、目标资源和版本锁；`targetWorkspaceId` 是 API 对合集 ID 的字段名。`placements content` 读取放置点当前可播放内容，`--collection` 对应查看者合集 `workspace_id`。旧 `workspaces`、`assets move/copy` 命令已移除。`orgs`、`users`、`tags` 和日志保持服务端权限；所有可用命令见 `--help`。未封装 API 用 `api METHOD /api/path`，仅允许同一服务 `/api/` 下的 JSON 请求。

## 团队成员与邀请

```bash
spatial-memory members list --org TEAM_ID
spatial-memory users search --org TEAM_ID --search you@example.com
spatial-memory members add --org TEAM_ID --data '{"user_id":"USER_ID","role":"member"}'
spatial-memory members update --org TEAM_ID --data '{"member_id":"MEMBER_ID","role":"admin"}'
spatial-memory members remove MEMBER_ID --org TEAM_ID
spatial-memory invitations create --org TEAM_ID --data '{"role":"member","workspace_id":"COLLECTION_ID"}'
spatial-memory invitations list --org TEAM_ID
spatial-memory invitations revoke INVITATION_ID --org TEAM_ID
spatial-memory invitations get TOKEN
spatial-memory invitations accept TOKEN
spatial-memory orgs pin TEAM_ID
spatial-memory orgs unpin TEAM_ID
```

`members remove` 使用成员记录 ID（`member_id`），不是用户 ID。邀请链接不能授予 owner；`workspace_id` 只作为加入后的跳转目标。`users search` 按完整邮箱、11 位手机号，或至少 3 个字符的名称/邮箱前缀查询，需要团队添加成员权限。`users by-ids USER_ID ...` 批量读取用户名称，`users update-me --name` 修改自己的显示名称，`users role` 返回全局角色。

## 活动

```bash
spatial-memory activities list --org TEAM_ID
spatial-memory activities create --org TEAM_ID --data @activity.json
spatial-memory activities get ACTIVITY_ID
spatial-memory activities update ACTIVITY_ID --data @activity-patch.json
spatial-memory activity-placements list --activity ACTIVITY_ID
spatial-memory activity-placements list --collection COLLECTION_ID
spatial-memory activity-placements create --activity ACTIVITY_ID --data '{"workspaceId":"COLLECTION_ID","idempotencyKey":"link-1"}'
spatial-memory activity-placements update ACTIVITY_PLACEMENT_ID --data '{"status":"active","expectedLockVersion":0}'
spatial-memory activity-records list --activity ACTIVITY_ID --query placementId=ACTIVITY_PLACEMENT_ID --query limit=50
spatial-memory activity-records update RECORD_ID --data '{"status":"hidden","expectedLockVersion":0}'
```

活动属于团队；每个活动最多关联一个未归档地图，新关联默认暂停。活动、关联和记录的写入使用 `expectedLockVersion`，创建接受 `idempotencyKey`。字段沿用服务端活动契约。

## 文件、复制与去重

```bash
spatial-memory uploads create ./photo.jpg --org TEAM_ID --type image
spatial-memory uploads delete assets/USER_ID/FILE
spatial-memory assets by-hash SHA256 --org TEAM_ID
spatial-memory content duplicate --data '{"sourceType":"scene","sourceId":"SCENE_ID","targetOrganizationId":"TEAM_ID","idempotencyKey":"copy-1"}'
```

`uploads create` 只调用 `POST /api/upload` 并返回回执，不创建素材；回执 `data.id` 可写入 `assets create --data` 的 `resources[].receiptId`，用于多资源素材。`--type` 可省略，由服务端按文件推断；指定时沿用 `assets upload` 的原文件上限。`uploads delete` 结束自己尚未使用的上传租约并交给服务端保留流程，存储路径取自回执 `storagePath`。`assets by-hash` 查询团队已有文件，命中时登记上传租约。`content duplicate` 跨团队复制素材、场景、活动、合集或放置点，仅限 super_admin。

## 管理员与公开接口

```bash
spatial-memory admin orgs
spatial-memory admin app-config
spatial-memory admin update-app-config --data '{"key":"default_allowed_file_types","value":["image","model"]}'
spatial-memory admin map-scan-model
spatial-memory admin update-map-scan-model --data @setting.json
spatial-memory admin clean --data '{"action":"clean-rows","workspaceId":"COLLECTION_ID"}'
spatial-memory orgs map-scan-model TEAM_ID
spatial-memory logs report --data '{"message":"CLI 测试"}'

spatial-memory miniapp collections --org TEAM_ID
spatial-memory miniapp orgs TEAM_ID
spatial-memory miniapp scenes SCENE_ID --org TEAM_ID
spatial-memory miniapp activities --collection COLLECTION_ID
spatial-memory miniapp nearby --data '{"user_lat":31.2,"user_lng":121.5,"max_distance_meters":500,"p_workspace_id":"COLLECTION_ID"}'
spatial-memory miniapp scene-preview --data '{"scene_id":"SCENE_ID","organization_id":"TEAM_ID"}'
```

`admin` 命令仅 super_admin 可用。`admin clean` 的 `action` 为 `clean-rows`（需要 `workspaceId`）、`clean-files` 或 `both`；服务端开启对象删除时 `clean-files` 会实际回收文件，请先在测试环境确认。`miniapp` 命令调用小程序公开接口，无需登录：`activity-progress`、`activity-records` 使用 `--query`，`submit-record`、`nearby`、`huge`、`scene-manifest`、`scene-preview`、`anchor-candidates`、`anchor-content` 使用 `--data`，字段与 Web 仓库 `docs/miniapp-api.md` 一致。已停用的 `/api/miniapp/anchors/recognize` 不提供命令。Better Auth 的其他 `/api/auth/*` 端点通过 `auth` 命令或 `api` 调用。

## 输出与验证

成功为 stdout JSON，错误和 `--verbose` 为 stderr；`--compact` 输出单行。`--dry-run` 不发送远端请求（auth 不支持）。HTTP 命令输出请求计划；本地 `scenes apply` 仍执行同一套编排与校验，但不写回草稿，`render` 只输出采样与渲染计划。`--data` 字段严格沿用当前 API，CLI 不改写旧请求。退出码：0 成功、1 API/网络失败、2 输入错误、3 未登录、4 无权限、130 取消。

```bash
npm ci
npm test
npm run test:package
npm pack
```

测试使用临时 HTTP 服务，不碰线上或数据库。安装包测试在独立临时目录离线安装并执行全部 HTTP 工作流。
