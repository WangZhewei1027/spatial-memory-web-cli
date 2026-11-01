# 服务端协议

此工具只通过 HTTP API 与服务端通信。编译、运行、安装和测试均不依赖 Web 仓库。

- 手机号使用 `@phone.spatialmemory.local`，与服务端数据迁移保持一致，无旧域回退。
- 素材属于团队，使用 `fileType`、`payload`、`resources` 和 `idempotencyKey`。上传返回 `data.id` 回执，创建素材以 `receiptId` 引用。
- 场景是独立资源：`/api/scenes/:id` 返回 `data.document`（schema 6）和 `data.lock_version`；保存提交 `document` 与 `expectedLockVersion`。播放 schema 4/5/7/8 由服务端编译，不用于编辑。
- 地图合集使用 `/api/collections`；地图中的内容实例使用 `/api/placements`。数据库仍以 workspace 命名的字段保留 API 原名，例如 `targetWorkspaceId`，CLI 选择合集使用 `--collection`。
- API 权限、资源团队归属和冲突处理由服务端最终校验。CLI 不复制数据库或授权逻辑。
- 0.2.1 不支持旧 workspaces 命令、场景素材类型、`--revision` 或 schema 1/2 文档。旧文档须先在具备迁移工具的 Web 环境转换；CLI 不加入运行时兼容分支。

## 校验快照

2026-11-01 从 Spatial Memory Web 当前源码同步纯结构校验。来源提交：`6a63f7cad3c88a094de06ec604b9a61f4b4b6ce9`。安装包内保留副本，不在构建或运行时读取相邻仓库。

`validate-content.ts`、`validate-presentation.ts`、`validate-utils.ts` 仅调整 ESM import 后缀；`protocol.ts` 仅保留编辑文档类型；`validate.ts` 只接受 schema 6。内容校验保留服务端的分组、欧拉角、关键帧、媒体、文字和可见性限制。

| 来源文件 | SHA-256 |
|---|---|
| `lib/scene/protocol.ts` | `ffd734762aa90b698d2963a5cb605d3b67a56adac7e110b33cf936968f4387e3` |
| `lib/scene/validate.ts` | `f5d5849908379a5c7fda528d6e96f8c82b3ab2e42ab5418a94217f81e7e75d7e` |
| `lib/scene/validate-utils.ts` | `b2ca0c387007afec28e0749a27f4021c60b79fc3f854f753cb125198e4e1d426` |
| `lib/scene/validate-content.ts` | `30a320f00a8af13ec68f2a6e66cbea088e03d6360cd2c1fc277c262f425f1537` |
| `lib/scene/validate-presentation.ts` | `3cd184a577831b4bc04617108b95c8217907b4e62b4f332a2cd38c0bd158e1d8` |
