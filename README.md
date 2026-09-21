# 鲸吟 · dsh-notify-whale

**DSH（DeepSeek Harness）通知插件**：会话结束时推手机，**卡在审批或提问等你操作时也推**。

> 中文名 **鲸吟**；项目代号与 npm 包名均为 `dsh-notify-whale`。

- macOS：系统通知中心（osascript，零依赖）
- Windows：Toast 通知（PowerShell + WinRT，含 PNG 图标）
- 手机：[Bark](https://apps.apple.com/app/bark-customed-notifications/id1403753865)（iOS）/ [ntfy](https://ntfy.sh)（Android·iOS）/ Server酱 / 任意 Webhook

纯 ESM `.mjs`、无构建步骤，基于 DSH 内置的 Cordis 插件体系。

> ### 这是一个加固 fork
>
> 上游：[`DeepseekHarnessPlugins/Notification`](https://github.com/DeepseekHarnessPlugins/Notification)（包名 `dsh-task-notify`，MIT）。
>
> 上游原版在 **Node 22 / 24** 上 **HTTP 通道完全无法投递**——不是配置问题，是代码问题（见下面「修了什么」第 1、2 条）。本 fork 修复后**在真实 DSH 上跑通并验证**：安卓（ntfy）+ iPhone（Bark）双端实测可收。
>
> 按 MIT 许可发布，**保留原作者版权声明**（见 [LICENSE](./LICENSE)）。

> ### ⚙️ 本项目由 AI 主导修改
>
> 本仓库的**代码改动、测试与文档由 AI 编程代理完成**（跑在 DSH 上），人类负责决策、验收与发布。改动方向与取舍记录在提交信息与本文件中。
>
> 具体来说：上游只提供基础骨架——下面「修了什么」里的 **5 个 bug** 的定位与修复、**2 项新能力**的设计与实现、以及 **154 项测试**的补齐，都是 AI 在真实 DSH 上复现问题后改的。每一处修改都附**根因说明与实测证据**；拿不出证据的结论不会写进来（例如「上游在 Node 22/24 上 HTTP 通道完全发不出去」是实测复现的，不是读代码推测的）。
>
> 在上游与本 fork 之间选择时：本 fork 的价值在于**它是"真跑过"的版本**，而不是"功能更多"。

---

## 与上游的差异

### 修掉的 5 个必现 bug

| # | 现象 | 根因与修法 |
|---|---|---|
| 1 | ntfy 通道报 `Cannot convert argument to a ByteString` | 标题被放进 `X-Title` 头，而 Node 的 fetch/undici **强制 header 值为 Latin-1**，中文标题必然抛错。→ 改用 ntfy 官方 **JSON 发布**（POST 到服务端**根 URL**，`{topic,message,title,icon}` 放 body，UTF-8 安全） |
| 2 | **所有** HTTP 通道（bark / ntfy / serverchan / webhook）静默发不出去 | `send()` 只把 `headers` / `body` 传给 `httpPost`，而后者是 `fetch(url, {...init})` —— **没有 method** → 变成「带 body 的 GET」→ undici 直接拒绝。→ 显式传 `method: "POST"` |
| 3 | 正文永远取不到会话标题，只会显示兜底文案 | 插件读 `agent.session.events`，但 **DSH 的 `Session` 没有 `events` 属性**（运行时核对：`'events' in Session.prototype === false`）。公开 API 是**方法** `snapshotEvents()` → 守卫永不成立，取标题 / 取用户消息两条路径**从未执行过**。→ 改调 `snapshotEvents()`；兜底同时剥掉 `session-` 前缀并优先输出 `header.cwd` 的项目名 |
| 4 | **任务出错、被手动停止也报「任务完成」** | 本版 DSH 的 `AgentStatus` 只有 `idle` / `running`——出错和手动停止时 agent 同样回到 `idle`，标题因此恒为「任务完成」。这是**误导性通知**，比不通知更糟。→ 新增 `latestTurnEndReason()` 读取最后一条 `turn/end` 的 reason，据此决定标题（时序已核对：`turn/end` 在 turn 的 `finally` 里 append，**早于** `agent/status: idle` 派发） |
| 5 | 🐛 **某些活跃会话的「完成」通知被静默丢弃**（症状：只有「待回答」，从无「任务完成」） | `isRootAgent()` 拿 `session.header.parentSession` 当"子代理"标志。但它的真实语义是**上下文续接来源**——DSH 续接/派生上下文时会带上它，而这类会话 `delegationDepth` 仍为 0、`origin` 也不是 `subagent`，是**有真实人类交互的顶层会话**（实测对象：129 条人类提问、104 个回合，完成通知 0 条）。→ **删除该判据**。<br>安全性实测：本机 118 个会话中，`origin === 'subagent'` 与 `delegationDepth > 0` **完全等集（各 37 个）**，二者已是完整判据；删除后只放行 5 个「上下文续接」会话，**不含任何真子代理**，即该判据纯属误伤 |

> 另修一处**仅影响测试**的上游问题：`paths.test.mjs` 写死了 `PACKAGE_DIR.endsWith('/')`，在 Windows 上必失败（`fileURLToPath` 在 Windows 返回以 `\` 结尾）。实现本身是对的，断言已改为跟随平台分隔符。上游全套测试在本 fork 中 **154 / 154 通过**（含上述断言改造后的 ntfy 传输测试）。

### 新增的 2 个能力

**5. 等待人工介入时也通知**

上游只监听 `agent/status`。等待审批 / 等待回答期间 agent 既不是 `idle` 也谈不上结束，所以手机端**永远收不到**——人一离开电脑就一直干等。

本 fork 改为监听 **`session/event`**：

- 会话事件 `approval/asked` → 「**待批准**：<工具>（<原因>）」
- 工具调用 `ask_user_question` → 「**待回答**：<问题>［N 选］」

> ⚠️ **为什么不用 `approval/request` / `user-questions/request`**：这两个是 **waterfall（链式）** 事件——前面任一监听器一旦认领请求，**后面的监听器根本不会执行**。DSH 自带的 Web 桥接器排在前面先认领，第三方插件（在 profile `bundles` 里排末位）**永远轮不到**。这是实测结论，不是推测。改用 `session/event`（普通事件，与监听器顺序无关，也不会干扰审批链）。

**6. 事件级铃声**（仅 Bark 支持自定义铃声；`sound` 为全局默认，`sounds` 按事件覆盖）

---

## 通知对照表

| 结果 | 标题 | event | Bark 铃声 | 图标 |
|---|---|---|---|---|
| 正常完成 | 任务完成 | `idle` | fanfare | 绿勾 |
| 出错 | 任务出错 | `error` | calypso | 红叉 |
| 手动停止 | 已手动停止 | `stopped` | bell | 灰点 |
| 被父会话中断 | 任务已停止 | `stopped` | bell | 灰点 |
| 被中断 | 任务被中断 | `interrupted` | bloom | 灰点 |
| 输出被截断 | 输出被截断 | `truncated` | fanfare | 灰点 |
| 等待审批 | 待批准 | `awaiting-approval` | horn | 灰点 |
| 等待选择 / 回答 | 待回答 | `awaiting-answer` | horn | 灰点 |
| 未知 / 取不到 | 任务完成 | `idle` | fanfare | 绿勾 |

正文格式：`<会话标题或项目名> · <具体事由> · HH:mm`。

---

## 安装

```bash
dsh plugin --profile web add dsh-notify-whale
```

装完 **重启 DSH**（插件在 boot 时读一次配置，**改配置后同样必须重启**）。

从本地目录安装：`dsh plugin --profile web add /path/to/dsh-notify-whale`。此时 pnpm 以 `link:` 方式接入、**不会**给被链接目录装依赖，需在插件目录里单独执行一次 `npm install --omit=dev`（否则报 `ERR_MODULE_NOT_FOUND: js-yaml`）。用 npm 安装没有这个问题。

> 若 pnpm 报 `minimumReleaseAge` 供应链策略拦截（v11 内置默认），命令末尾追加 `--config.minimum-release-age=0` 按次放行。

---

## 配置

写入 `$DSH_HOME/settings.yaml` 的 `task-notify:` 段：

```yaml
task-notify:
  enabled: true
  notifyOn: [idle, error, blocked]   # blocked 供等待类通知复用
  agents: root                       # root=只通知顶层会话 | all；等待类通知不受此项限制
  coalesceWindowMs: 2000             # 同会话窗口内合并重复通知
  desktop:
    enabled: off                     # auto | on | off（注意：写 false 会警告并回退为 auto）
    sound: true
  format:
    time: short                      # hidden | short | full —— 正文尾部时间样式
    showDuration: true               # 负载携带 durationMs 时追加「用时 X」
  icons:
    enabled: true                    # 图形图标总开关
    urlTemplate: ""                  # 远程图标 URL 模板；含 {event} 则按事件取图，如 https://host/icons/{event}.png
  ntfy:
    enabled: true
    server: https://ntfy.sh
    topic: "你的随机主题名"           # 公共服务器上 topic 就是密码，别用可猜的名字
    token: ""                        # 自建实例需要鉴权时填
  bark:
    enabled: true
    server: https://api.day.app
    deviceKey: "你的BarkKey"
    sound: "fanfare"
    sounds:
      error: calypso
      stopped: bell
      interrupted: bloom
      awaiting-approval: horn
      awaiting-answer: horn
  serverchan:
    enabled: false
    sendKey: ""
  webhook:
    enabled: false
    url: ""
    headers: {}
```

配置优先级：cordis patch 显式传参 > `settings.yaml` > 环境变量（`DSH_TASK_NOTIFY_*`）> 内置默认。

架构与事件契约详见 [SPEC.md](./SPEC.md)。

---

## 验证

```bash
node self-test.mjs                     # 向全部启用通道发一条样例通知
node self-test.mjs --channel ntfy      # 只测单个通道
```

成功时**静默**（只有非 2xx 才 warn）。想确认服务端真的收到，从服务端反查：

```bash
curl -s "https://<你的ntfy>/<topic>/json?poll=1"
```

另有交互式菜单可直接编辑配置并当场发测试通知：

```bash
npm run menu
```

---

## 已知边界

- **本版 DSH 的 `AgentStatus` 只有 `idle` / `running`**，所以 `notifyOn` 里的 `error` / `blocked` 不会由 `agent/status` 触发；成败判断走 `turn/end`，`blocked` 走等待类路径。
- **自建 ntfy 若开了 `deny-all`**，手机端（ntfy App）必须配置访问凭据，否则订阅被 403 拒掉、表现为一直「Reconnecting」。
- 自建服务端请用**域名**而非 IP：家用宽带 IPv6 前缀会变。
- Bark 自定义铃声**仅 iOS**；ntfy 的铃声只能在手机 App 侧设置（其发布协议没有 sound 参数）。
- `self-test.mjs` 是**独立进程**、读磁盘最新配置。它通过**不**代表运行中的 DSH 宿主进程已加载新配置——改完配置必须重启，并用一次真实事件验证。

---

## License

MIT。本 fork 保留上游版权：

```
Copyright (c) 2026 DeepseekHarnessPlugins
Copyright (c) 2026 Lon-dawn (dsh-notify-whale fork)
```
