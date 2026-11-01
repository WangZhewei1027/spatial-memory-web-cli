# 服务端协议兼容性

此工具只通过公开的 HTTP API 与服务端通信。编译、运行、安装和测试均不依赖 Web 仓库。

- 会话：Better Auth Cookie，邮箱/密码登录，手机号映射为 `@phone.spatialmemory.local`。部署时直接迁移既有手机号账号的虚拟邮箱，账号 ID、密码和关联数据不变；CLI 与 Web 使用同一域名，不回退到旧域名。
- 素材类型：`src/contract.ts` 是 HTTP 字段枚举，包含场景等 10 种类型。
- 场景：`src/scene/` 内置纯 TypeScript 的 schemaVersion 1/2 校验快照，支持本地 `init` 和 `validate`。
- 场景资产的模型引用、工作区权限、当前版本冲突仍由服务端最终校验。CLI 不复制数据库或服务端授权逻辑。
- 服务器变更 API 或场景 schema 时，应更新独立工具的协议快照与测试，再发布新的版本包。通用 `api` 命令可传递尚未封装的新字段；新增 schemaVersion 需要更新本地场景校验器。

## 快照来源

来源：Spatial Memory 的 `spatial-memory` Web 仓库（快照时名称为 `sanlinlaojie`），2026-10-14 的工作区源码；Git HEAD 为 `ce8031745ebdcea2fb1d9b2434ad1dd560a71f01`。复制时仅调整本地 ESM import 的 `.js` 后缀。
以下 SHA-256 对应来源文件；保留来源用于人工比对，不用于构建时拉取或导入相邻项目。

| 来源文件 | SHA-256 |
|---|---|
| `lib/scene/protocol.ts` | `52b0d395f6ce6c5f1214bece005dc4cf73ada1ac228f9b305ccdb43bab4c12be` |
| `lib/scene/validate.ts` | `a9fdbe619dfbcaa5df1fa26170d996265186b6dfd1b176c160bb68a732912d46` |
| `lib/scene/validate-utils.ts` | `b2ca0c387007afec28e0749a27f4021c60b79fc3f854f753cb125198e4e1d426` |
| `lib/scene/validate-content.ts` | `bedc0c50cdc6a243440f96d9ca1f115c343683384dc302803d1b367795629463` |
| `lib/scene/validate-tracks.ts` | `80b28c19216abe2ecc7da874208e81d65b27b4e859f9f4a05428a85f18bd152c` |
