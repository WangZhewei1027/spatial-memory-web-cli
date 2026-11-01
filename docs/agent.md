# 本地 agent 编排闭环

当任务需要搜集素材、空间与时间编排、看图修正或恢复草稿时，按本流程操作。命令参数以 `spatial-memory --help` 为准；认证、上传和远端版本锁细节见 [usage.md](usage.md)。

## 工作流程

1. **确定工作区。** 在任务输出目录执行命令，或固定 `--runs-dir`、`--cache-dir`、`--output-dir`。使用现有服务地址与团队 ID；用 `orgs list` 确认团队。完成条件是后续命令指向同一服务和团队。
2. **找素材。** 用 `assets search --org TEAM --search 关键词 --type model` 搜库内名称；结果自动翻页，`--limit` 可限制本次返回量。联网搜索交给 agent 自己的搜索工具，取得媒体下载 URL 和来源页面。完成条件是已选素材有明确 assetId，或有可下载的原文件。
3. **导入并检查。** 对新文件使用 `assets import URL_OR_FILE --org TEAM --type model --idempotency-key TASK_ASSET_KEY --source-page PAGE_URL`。保存输出中的 assetId、import.statePath、幂等键；对既有素材使用 `assets inspect ASSET_ID`，查看返回的 probe、事实和预览图。import.sourceProbe 描述原文件，import.finalProbe 与 resourceFacts 描述 OSS 实际文件并绑定 contentHash；编排使用最终事实。完成条件是素材实际加载成功，尺寸、动画、媒体时长等已知事实足以编排；未知尺寸/单位保持未知，通过预览调整。
4. **打开草稿。** 新演出用 `runs open --run SHOW`；已有演出用 `runs open --scene SCENE_ID --run SHOW`。保存返回的 revision。完成条件是本地草稿已存在，远端草稿同时记录 lockVersion。
5. **编排。** 将一批操作写入 ops.json，调用 `scenes apply --run SHOW --revision N --ops @ops.json`。返回的 revision 替代旧值；整批校验失败时草稿不变。用 `scenes inspect` 查看完整结构，用 `scenes sample --time T` 检查采样状态。完成条件是操作全部通过，时间、空间与素材引用符合任务。
6. **验证并看图。** `scenes validate --run SHOW --remote --org TEAM` 检查服务器资源归属与动画，服务器尚未升级时先保留离线校验并在最终保存时处理服务器结果。`scenes render --run SHOW --times 0,3,8 --cameras audience,top,side --output-dir ./frames` 生成图片及 manifest。用 agent 的图像查看工具读取实际图片；检查加载错误、遮挡、大小、朝向、关键时刻与镜头覆盖。修正后重新 apply/render，保存图片及报告。完成条件是所有关键时刻已查看，失败和未验证项明确记录；图片存在本身不算视觉通过。
7. **保存。** 已关联远端的草稿用 `scenes save --run SHOW --revision N`；新草稿再加 `--org TEAM --name 演出名称`。完成条件是服务器返回 scene ID 与新 lockVersion，且 run 记录保存事件。向用户报告场景 ID、预览文件及尚未解决的问题。

## 操作文件

`--ops` 接收 JSON 数组、`@文件` 或 `-` 标准输入。位置单位为米，欧拉 XYZ 旋转为弧度，时间为秒。操作由共享 `@spatial-memory/scene-authoring` 包校验和执行；其 README 是完整操作契约。

音视频固定原速播放，`media.playbackRate` 只能为 `1`。`time.stretch` 只拉伸编排时间和关键帧，不改变媒体速度；不再接受 `retimeMedia` 选项。

```json
[
  { "type": "scene.update", "patch": { "durationSeconds": 30, "loop": false } },
  { "type": "asset.set", "alias": "performer", "assetId": "00000000-0000-4000-8000-000000000001" },
  { "type": "node.add", "kind": "instance", "node": {
    "id": "actor", "asset": "performer", "position": [0,0,0],
    "rotation": [0,0,0], "scale": [1,1,1], "animation": null
  } },
  { "type": "transform.set", "id": "actor", "space": "local", "value": { "position": [2,0,1] } }
]
```

可操作文档、素材别名、实例、分组、空间变换、轨道、关键帧、布局和时间排列。`node.update` 递归合并对象、替换数组；`unset` 使用相对 JSON Pointer。`document.replace` 可整体替换合法 schema 6 文档。字段覆盖媒体播放、空间音频、文字、显隐、透明度及全部已支持参数；数值须符合类型与数学语义。

`apply/inspect/sample/validate --facts @inspection.json` 可读取 `assets inspect ASSET_ID` 的完整输出，或使用按 assetId 索引的资源事实对象；多个检查结果可放在 JSON 数组中。动画片段和媒体时长由这些事实提供，服务端预检负责实际权限。

`render --times auto` 取场景起止、入出场、淡入淡出边界、动画起点、关键帧及相邻时刻中点，去重排序；这是抽样，不证明全时序无问题。`--cameras @cameras.json` 或 `--camera-file @cameras.json` 接收相机数组，例如 `[{"name":"front","position":[0,2,8],"target":[0,1,0],"fov":45}]`。`--width`、`--height`、`--overlays` 控制截图，`--timeout` 同时传给渲染器。

## 冲突与失败恢复

- 本地 revision 冲突：先 `runs status SHOW`，基于当前文档重算操作。`runs history SHOW` 读取历史；`runs restore SHOW OLD --revision CURRENT` 将旧文档作为新 revision，保留最新远端锁。
- 远端 409：重新读取远端文档和 lockVersion，比较本地改动后合并；不要只替换锁版本盲目覆盖。
- import 超时或 5xx：保留返回的 statePath，用相同源、参数和幂等键重试。`uploaded` 状态复用回执及创建请求，`created` 仅重试最终资源探测，`complete` 返回已创建结果，避免重复上传和创建。需要显式重放缓存创建请求时，使用同一组参数并添加 `--resume KEY`。
- 模型缺外部依赖：`MISSING_DEPENDENCIES` 列出 glTF/GLB 引用的文件。先收集这些文件并转换为自包含 GLB，再使用新的幂等键导入；缺依赖模型在上传前被拒绝。
- 进程意外中止：draft head 与历史文件使用原子写入。锁错误会显示本地 owner；只有确认进程已结束后才清理残留锁。下载临时文件和缓存只属于本次任务工作区。
- 导入器执行原文件上传，服务端负责压缩/转码。模型上限为 5 MiB；更大模型先由 agent 使用自己的压缩工具处理，再导入。其他上传限额保持现有策略。

stdout 只输出 JSON；错误和诊断写入 stderr。检查退出码和 JSON 错误后再继续依赖步骤。素材下载使用独立客户端，不携带服务会话。缓存含来源和工作素材，分享结果前只选择所需报告与图片。
