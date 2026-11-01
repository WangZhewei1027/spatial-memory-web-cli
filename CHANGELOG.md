# Changelog

## 0.2.1 — 2026-11-01

- 对齐当前团队内容 API：Scene 独立读写 schema 6 document，以 expectedLockVersion 防止覆盖冲突；支持分组、媒体、空间文字、参数动画和空间音频。
- 素材按团队创建，上传结果通过 receiptId 引用；查询、归档、复制使用当前路由。地图合集与放置点改用 collections 和 placements 命令。
- anchor 上传以 reference 角色引用识别图回执，预览与实际请求保持一致。
- 移除已删除的 workspaces、assets move/copy 路由和旧场景 schema 1/2、text_content、scene_revision 命令路径。
- 更新离线 HTTP 契约测试和独立安装包验证，保留手机号新域登录及会话隔离。

## 0.2.0 — 2026-11-01

- 品牌改为 Spatial Memory，独立安装包为 `spatial-memory-web-cli`，命令为 `spatial-memory`。
- 环境变量统一使用 `SPATIAL_MEMORY_*`，默认会话目录改为 `~/.config/spatial-memory`。
- 更新帮助、使用说明、安装验证和离线 HTTP 测试，按新名称生成安装包。
- 手机号虚拟邮箱统一为 `phone.spatialmemory.local`，与服务端账号迁移同步发布。
- 保留既有 HTTP 和场景协议；本次不升级场景编排能力。

## 0.1.0 — 2026-10-14

- 从 Web 项目分离为可独立安装的命令（当时名为 `sanlin`），无运行时依赖。
- 支持邮箱/手机号登录、按服务隔离会话、JSON 输出和请求预览。
- 提供组织、工作区、素材、上传、场景、用户、标签、日志和通用 API 命令。
- 内置场景协议 v1/v2 校验，场景保存带版本检查。
- 安装包仅包含编译后的 CLI、协议校验和文档；包含离线安装与 HTTP 工作流测试。
