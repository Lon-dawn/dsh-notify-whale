# Changelog

## 0.6.2

- 插件列表/详情里的显示文案改为「鲸吟通知」+ 一句话功能描述。此前 DSH 直接显示 `package.json` 的 `description`，写的是「修复了哪 5 个必现 bug」「AI 主导修改」这类实现细节——在插件列表里看不出这个插件到底干什么。现在改由 `locale/zh.json`、`locale/en.json` 的 `meta.title` / `meta.description` 提供（DSH 的 `readPluginMeta` 读 `<包名>/locale/*.json`，文件名即语言 id），`package.json` 的 `description` 只留给 GitHub、包管理器等外部界面。
- `package.json` 的 `exports` 增加 `"./locale/*.json"`。DSH 用 Node 解析器读这个资源，没声明导出会得到 `ERR_PACKAGE_PATH_NOT_EXPORTED`，而 `optionalResourcePath` 把它当作「没有元数据」静默回退到包名——不报错，只是文案不生效，很难发现。
- README 安装命令改为可用的 `github:Lon-dawn/dsh-notify-whale`（裸包名在 npm 上不存在，会 404），并新增「升级」一节：DSH 没有原地升级，需卸载重装；配置存在 profile 的 `cordis.patch.yml` 用户层，卸载不碰它，重装后自动接回。

## 0.6.1

- 修「发送测试通知」在手机上已收到、设置页却报「未收到发送结果——请确认插件已加载、配置可写。」（20s 超时）。根因是 HMR 事务嵌套：客户端点按钮 → 宿主 `SettingsForms.mutate` → `configEditor.edit` → `hmr.runExclusive` → `entry.update` → Loader `_commitVolatile` 在**事务内部同步**广播 `loader/volatile-update`；插件在该回调里写回 `testResult` 又要走 `hmr.runExclusive`，撞上 `HMR transactions cannot be nested`（`dsh-hmr/lib/index.js:749`）被拒，于是请求字段 `test.<channel>` 永久残留、`testResult` 永不出现。修法：用 `AsyncResource.bind` 在 `apply()`（事务外）创建调度器，把消费测试请求的动作排到事务之外执行（`Promise.then` / `setImmediate` / `setTimeout` 都会继承 AsyncLocalStorage 上下文，实测无效）。另加瞬时错误（嵌套 / 写锁超时）有限重试，避免并发写 patch 时偶发丢结果。
- 新增 5 个回归测试：真实模拟 `AsyncLocalStorage` 事务守卫与 cordis 的属性代理，验证「事务内触发 volatile-update 仍能写回」「瞬时错误会重试」「配置类错误不重试」「晚就绪的 settings 服务仍能用」「服务始终缺失时有界放弃」。两条关键用例均已反向验证：把修复退回旧写法，对应用例立即失败。
- 顺带加固：`settings` 服务改为**每次用时再取**，不再在 `ctx.inject` 回调里缓存引用。cordis 属性代理在服务所属 fiber 尚未 active 时返回 `undefined`（`cordis/lib/index.js:763-771`），而 inject 回调的触发时机不保证服务已就绪——早触发一次就会永久拿到 `null`，症状与本次真正的 bug 完全一样（手机收到了、设置页 20s 超时）。延迟读取让服务一旦就绪就自愈。

## 0.6.0

- 设置页「发送测试通知」按钮：桌面 / Bark / ntfy / ServerChan / Webhook 每张卡片一个，点击后宿主只向该通道发一条样例通知，按钮旁显示真实结果（✓ 已发送 / ✗ HTTP 状态与错误详情）。测试强制启用目标通道，可在打开开关前先验证端点；测试读已保存配置，有未保存编辑时页面会提示先保存。实现：客户端把请求写入 volatile 字段 test.<channel>，宿主在 loader/volatile-update 里消费，结果经 settings 服务写回 testResult 随设置文档回流（DSH 不向第三方插件开放客户端→宿主 RPC；依赖的宿主机制已对照 0.2.1-rc.2 安装树实核）；nonce 去重 + 60s 过期防重发。
- 通道层 send() 改为返回 {ok, detail} 结果对象（常规派发路径忽略之，行为不变）：self-test.mjs 与 npm run menu 的通道测试随之修复了「bark 404 也报成功」的误报。
- 配置新增内部字段 test / testResult（volatile 标量，仅设置文档层使用），三层合并与未知键告警行为不变。

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
