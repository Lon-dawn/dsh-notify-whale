# Changelog

## 0.4.3

- **修（编码损坏）**：0.4.2 用 PowerShell 的 `Get-Content -Raw` + `-replace` + `WriteAllText` 改写 `package.json`，而 PowerShell 默认按 **ANSI** 解码，导致 `description` 里的中文（鲸吟）在读取那一刻就被损坏、再写回固化为乱码。
  **注意这类损坏不会报错**——乱码仍是合法 JSON 字符串，`JSON.parse` 照常成功，所以只有逐字段核对才能发现。
  已改用 Node 以 UTF-8 读写重写该文件。
- 记录一处方法论教训：**改含非 ASCII 的文件不要用 PowerShell 的文本 cmdlet**，用 Node / `edit` 工具 / 显式指定 UTF-8。
- 不涉及功能与行为变更。

## 0.4.2

- **修（源码卫生）**：0.4.1 的代码同步误用「整文件覆盖」，把发布版已完成的一轮**去标识化**回退掉了，内部工具名重新出现在注释中（6 处）。本版已重新清理，并改为**双向核对**（发布版与开发版代码文件 SHA256 逐一比对），避免同类回退。
- 不涉及功能与行为变更；代码逻辑与 0.4.1 完全一致。

## 0.4.1 — 鲸吟

- **修（真 bug）**：`isRootAgent()` 误用 `session.header.parentSession` 当"子代理"标志。它是**上下文续接来源**，不是子代理标记——续接而来的会话 `delegationDepth` 仍为 0、`origin` 也不是 `subagent`，因而被误判 → **完成通知被静默丢弃**，症状是"只有『待回答』、从无『任务完成』"。已删除该判据（实测：118 个会话中 `origin === 'subagent'` 与 `delegationDepth > 0` 完全等集，删除后不放行任何真子代理）。
- 项目中文名定为 **鲸吟**（包名不变，仍为 `dsh-notify-whale`）。
- README 增加「本项目由 AI 主导修改」披露。

## 0.4.0

加固 fork 首个版本。修复上游在 Node 22 / 24 上的 4 个必现 bug，新增 2 项能力：

- **修**：ntfy 中文标题抛 `ByteString`（`X-Title` 头只允许 Latin-1）→ 改用官方 JSON 发布。
- **修**：所有 HTTP 通道静默失败（`fetch` 缺 `method`，退化为带 body 的 GET）→ 显式 POST。
- **修**：正文永远取不到会话标题（读了不存在的 `Session.events`）→ 改用 `snapshotEvents()`。
- **修**：出错 / 手动停止都报「任务完成」（`AgentStatus` 只有 `idle|running`）→ 读 `turn/end` 的 reason 决定标题。
- **新增**：等待人工介入也通知（`approval/asked` / `ask_user_question`），走 `session/event` 而非 waterfall（后者会被上游抢先认领，第三方插件收不到）。
- **新增**：事件级 Bark 铃声（`bark.sounds` 映射）。
- **修（测试）**：上游 `paths.test.mjs` 的 `PACKAGE_DIR.endsWith('/')` 在 Windows 上必失败 → 改为跟随平台分隔符。
- 全套测试 154 / 154 通过。

## 0.3.0

- 通知排版：正文尾部追加本地时间和耗时后缀（format.time 取 hidden | short | full，format.showDuration 控制是否展示用时）。composeBody 保证时间后缀不被正文截断。
- 菜单控制：npm run menu 交互式编辑 ~/.dsh/settings.yaml 的 task-notify 段，覆盖总开关、事件、agents、桌面/远端五通道；启用通道后可当场发送测试通知。保存自动备份 settings.yaml.bak-<时间戳>，YAML 注释会丢失（已提示）。
- 配置新增 format 段，沿用三层合并（patch > settings > env > 默认），环境变量 DSH_TASK_NOTIFY_FORMAT_TIME / _SHOW_DURATION。
- 12 个新单测（排版）+ 8 个菜单核心单测，全量 153/153 绿。

## 0.2.0

- 多通道：macOS Notification Center、 Windows Toast、 Bark、 ntfy、 Server酱、 通用 Webhook。
- 图形图标：内置 SVG/PNG 资产、Windows Toast 嵌入 appLogoOverride、Bark/ntfy 走 urlTemplate 模板、Webhook JSON 携带 icon 与内联 iconSvg。
- paths.mjs 提取图标路径解析，包发布完整修复（之前打包后首次通知会因缺文件静默失效）。
- 单元测试覆盖通道、配置、合并去重、图标路径。

## 0.1.0

- 初版：基于 agent/status 事件触发 idle / error / blocked 通知；合并窗口内同会话只发最后一次。
