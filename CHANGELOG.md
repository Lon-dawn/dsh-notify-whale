# Changelog

## 0.5.0 — 原生设置页

**新增：侧边栏一级菜单「通知」**（DSH 0.1.7+），全部配置可在界面里改，**保存立即生效、无需重启**。

- **新增（Host）**：导出 `Config` schema（`@deepseek-ai/schemastery`，字段标 `.volatile()`），使本行成为 0.1.7 认可的「可配置 entry」；监听 `loader/volatile-update` 重建通道，实现热更新。
- **新增（Client）**：`client.js` 浏览器半区，注册 `settings.section` 一级设置页。
  > ⚠️ 0.1.7 **不会**按 `Config` 自动生成设置页——上游 `dsh-settings` 只上报 `autoGenerate` 标记，且明言「目前没有已发布的客户端这样做」。设置页必须由插件自带浏览器半区。
- **修（0.1.7 破坏性变更）**：0.1.7 删除了 `$DSH_HOME/settings.yaml`（启动时改名 `settings.yaml.imported`）并**一次性导入**各 section 到同名 entry。本插件的 section 名为 `task-notify`，而当时插件行 id 是 `task-notify-runtime`、且未导出 `Config`，于是导入报 `No configurable plugin entry` 并**静默丢弃整个 section** → 用户配置全部回退内置默认（表现为 Bark/ntfy 推送失效、桌面通知反而被打开）。
  现已把插件行 id 对齐为 `task-notify`（分组壳让位为 `task-notify-group`），section 名与 entry id 一致。
- **新增：Bark 推送分组**（`bark.group`）。多台机器共用一个自建服务器时，不指定分组会让所有推送挤进 App 的「默认」分组、历史记录里分不出机器。默认值取**本机主机名**（截断到 Bark 建议的 8 字符），各机开箱即分开、零配置；填非空值即覆盖。走 JSON body 而非 URL 查询串，空格与中文不会被转义坏。
- **新增：通知标题可改**（`titles.<event>`，9 个事件）。留空＝沿用内置文案，因此不配置与历史行为逐字一致。覆盖作用于**所有通道**，不只是 Bark。
- **新增 4 项守卫脚本**（`npm run test:client`）：设置页三态渲染、CSS 模板完整性 + 主题令牌存在性、标题覆盖语义、分组默认与请求体。这几处改坏了不会报错，只能靠断言拦。
- 全量测试 153/153 通过。

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
