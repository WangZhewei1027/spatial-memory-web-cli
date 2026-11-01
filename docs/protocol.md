# 服务与共享场景协议

CLI 通过 HTTP API 与 Web 服务通信。运行、安装和离线测试均不读取相邻 Web 源码或其环境配置。

- 素材属于团队，使用 `fileType`、`payload`、`resources`、`idempotencyKey`。上传返回 `data.id` 回执，创建素材以 `receiptId` 引用。导入在本地缓存来源、探测事实、回执及创建请求，网络请求复用同一上传协议。
- 场景是独立资源：`/api/scenes/:id` 返回 schema 6 `data.document` 与 `data.lock_version`；保存提交 `document` 与 `expectedLockVersion`。播放 schema 4/5/7/8 由服务端编译，不用于编辑。
- `@spatial-memory/scene-authoring` 是校验、编排操作、检查、采样和差异计算的唯一实现。CLI 安装已构建包，不再维护 schema 6 校验副本。依赖 tarball 与锁文件固定交付版本，独立包内包含运行依赖。
- `@spatial-memory/scene-renderer` 使用当前编辑器渲染能力生成图片和素材事实。CLI 在 Node 侧读取已授权素材 URL，浏览器仅加载渲染输入，不接收服务登录 Cookie。
- 本地 run revision 与远端 lockVersion 是不同并发标识。每次本地编排、恢复和保存记录新 revision；服务端仍最终校验资源、团队授权和版本锁。只读预检使用 `POST /api/organizations/:org/scenes/validate`。
- 地图合集使用 `/api/collections`，投放使用 `/api/placements`；数据库沿用 workspace 的 API 字段保持原名。手机号身份域为 `phone.spatialmemory.local`。

旧 schema 1/2 文件先通过 Web 迁移工具转换。CLI 只编辑 schema 6，不增加历史文档兼容分支。共享包升级时重建 vendor tarball、更新 npm 锁文件，执行 CLI 行为测试和离线安装包测试。
