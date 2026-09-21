/**
 * index.mjs — dsh-task-notify 插件入口（cordis apply 契约）。
 *
 * ═══════════════ 源码研究结论（@deepseek-ai/dsh 安装树实查） ═══════════════
 *
 * 1. `agent/status` payload 结构 = `{ agent, status }`：
 *    - dsh-agent-loop/lib/index.js:388 `this.dispatch.emit("agent/status", { status })`，
 *      dispatch 由 dsh-agent/lib/index.js 的 `agentEvents(ctx, agent)` 构造，
 *      其 fused 包装为 `(payload) => ({ ...payload, agent })` —— agent 由派发器注入。
 *    - 类型签名（dsh-tool-cordis/lib/index.js:3859）：
 *      `'agent/status'(this, payload: { agent: Agent; status: AgentStatus }): void`。
 *    - 内部消费者均按单参解构：dsh-goal-round-driver/lib/index.js:216
 *      `ctx.on("agent/status", ({ agent, status }) => ...)`。
 *    - ⚠️ 本安装版 `AgentStatus = 'idle' | 'running'`；SPEC 观测到的
 *      completed/error/blocked 实为 dsh-goal 的 goal phase 值。本插件对 status
 *      保持宽容：只要 status ∈ notifyOn 就通知，未来版本扩展状态值无需改代码。
 *
 * 2. 顶层代理判据 isRootAgent(agent)（dsh-subagent/lib/index.js）：
 *    - `delegationDepthOf()`：权威深度 = max(`session.header.delegationDepth` ?? 0,
 *      `options.subagentDepth` ?? 0)，顶层为 0；
 *    - 子代理创建时 header 额外带 `parentSession`（直接父会话 id）与
 *      `origin: "subagent"`（childSessionMeta）。
 *    - 判据：depth === 0 且无 parentSession 且 origin ≠ 'subagent' → root。
 *      全程可选链 + try/catch；判定失败保守放行为 root（漏通知比误通知更糟）。
 *
 * 3. 会话标题零依赖获取：不需要 inject sessions/sessionTitle 服务。
 *    `agent.session.events` 是可 findLast 的日志数组，官方
 *    dsh-session-title 的 foldSessionTitle 就是折叠其中的 `session/title`
 *    事件（data.title）；无标题事件则取第一条 `user/message`
 *    （data.source.kind==='user'，data.content[].type==='text' 拼接）文本；
 *    两者皆无 → 降级文案（本 fork 修复 2026-09-14：先剥 `session-`
 *    前缀，原实现 slice(0,8) 恒等于 "session-"；并优先输出 header.cwd 的项目名，
 *    形如「dsh · ccf7916e」）。
 *    另注：Agent.id 本身就是 SessionId（Agent 接口声明 + dsh-session 的
 *    SessionId() 为恒等函数），故 sessionId === agentId。
 *
 * 4. patch input 传递机制（cordis-plugin-loader/lib/index.js）：
 *    Entry._start → `ctx.registry.plugin(plugin, this.options.config, ...)`
 *    → Fiber 持有该 config → `runtime.callback(this.ctx, this.config)`
 *    即 apply(ctx, input)。input = cordis.patch.yml 中 name 匹配本包的那个
 *    entry 条目下嵌套 `config:` 键的内容；未写该键时为 undefined（→ 默认 {}）。
 *    主控写死的 cordis.patch.yml 未带 config 键，运行时配置走 settings/env 层。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 运行时纪律（SPEC 5.4）：
 *   - fire-and-forget：事件处理器同步返回，分发链路全部 .catch 兜底，
 *     绝不 await、绝不向宿主抛错；
 *   - 经 dedupe.push(sessionId, fire) 合并后分发给全部启用通道，逐通道隔离，
 *     失败仅 logger.warn；
 *   - ctx.effect 注册清理：清空 dedupe 定时器；进行中的发送 Promise 不中断，
 *     任其自然落定（各自的 catch 已兜底）。
 */

import { execFile } from 'node:child_process';
import { resolveConfig } from './config.mjs';
import { createCoalescer } from './dedupe.mjs';

export const name = 'task-notify';

/**
 * 服务注入列表。研究结论（见文件头第 3 点）：标题/最近用户输入可直接从
 * agent.session.events 折叠获得，无需任何宿主服务——保持最小 inject = []。
 */
export const inject = [];

/** 网络通道统一超时（SPEC 5.7）。 */
const HTTP_TIMEOUT_MS = 8000;
/** osascript 等子进程超时，防止挂起的桌面通知留下僵尸进程。 */
const RUN_TIMEOUT_MS = 10_000;

/* ------------------------------------------------------------------ */
/* 文案模板：优先 Worker-A 的 format.mjs，缺失/损坏时内置同规格兜底      */
/* ------------------------------------------------------------------ */

const FALLBACK_TITLES = Object.freeze({
  idle: '任务完成',
  error: '任务出错',
  blocked: '需要确认',
  'goal-completed': '目标达成',
});

/** 降级排版：与 format.mjs 的 composeBody 同签名，但不追加时间后缀。 */
function degradedComposeBody(text, options = {}) {
  const collapsed = String(text ?? '').replace(/\s+/g, ' ').trim();
  const limit = Math.max(1, Number(options?.maxLen) || 120);
  return collapsed.length <= limit ? collapsed : collapsed.slice(0, limit - 1) + '…';
}

export const fallbackFormat = Object.freeze({
  // SPEC §7.1：无 emoji 文案；未知事件回退通用标题（与 format.mjs 同规格）。
  formatTitle: (event) => FALLBACK_TITLES[event] ?? '任务通知',
  formatBody: (text, maxLen = 120) => {
    const collapsed = String(text ?? '').replace(/\s+/g, ' ').trim();
    const limit = Math.max(1, Number(maxLen) || 120);
    return collapsed.length <= limit ? collapsed : `${collapsed.slice(0, limit - 1)}…`;
  },
  // v0.3：降级模式的组合排版——无时钟依赖，保持旧纯摘要行为。
  composeBody: degradedComposeBody,
});

/** 判断一个模块对象是否符合 format 契约（formatTitle/formatBody 函数）。 */
function isFormatModule(mod) {
  return !!mod
    && typeof mod.formatTitle === 'function'
    && typeof mod.formatBody === 'function';
}

/**
 * 插件装配入口。
 * @param {object} ctx cordis 插件上下文（on/effect/logger）
 * @param {object} [input] cordis patch entry 的 config 键内容（见文件头第 4 点）
 * @param {object} [overrides] @internal 测试缝：可替换 channels/createChannels/
 *   deps/format。第三个参数对 cordis 不可见，不影响生产契约（registry.plugin 只传两参）。
 */
export function apply(ctx, input = {}, overrides = {}) {
  let config;
  try {
    // @internal 测试缝：overrides.config 直接给定已解析配置，跳过三层合并
    // （否则单测会读到开发机真实的 ~/.dsh/settings.yaml，结果随环境漂移）。
    // 生产路径 cordis 只传两参，overrides 恒为 {}。
    config = overrides.config ?? resolveConfig(input);
  } catch (error) {
    // resolveConfig 设计上不抛；此分支是最后防线：配置坏了就整体静默停用。
    console.warn('[task-notify] 配置解析异常，插件已停用:', error);
    return;
  }
  if (!config.enabled) return; // 显式停用：不注册任何监听

  const logger = makeLogger(ctx);
  const deps = makeDeps(logger, overrides);

  // 文案模块：overrides.format（测试缝）> ./format.mjs > 内置兜底。
  // format.mjs 属并行工作流可能暂不存在——异步装载、同步兜底，事件零等待。
  /** @type {{formatTitle: Function, formatBody: Function}} */
  let format = overrides.format ?? fallbackFormat;
  if (overrides.format === undefined) {
    import('./format.mjs')
      .then((mod) => {
        if (isFormatModule(mod)) format = mod;
        else logger.warn('[task-notify] format.mjs 导出不符合契约，使用内置文案模板');
      })
      .catch((error) => {
        logger.warn(`[task-notify] format.mjs 加载失败，使用内置文案模板：${describe(error)}`);
      });
  }

  /** @type {Promise<Array<{name: string, send: (p: object) => Promise<void>}>>|null} */
  let channelsReady = null;
  const getChannels = () => {
    if (channelsReady === null) channelsReady = acquireChannels(config, deps, overrides, logger);
    return channelsReady;
  };

  const coalescer = createCoalescer(
    config.coalesceWindowMs,
    Date.now,
    (error) => logger.warn(`[task-notify] 合并后的通知分发失败：${describe(error)}`),
  );

  /**
   * 把一个 payload 分发给全部启用通道（fire-and-forget）。
   * 每个 channel.send 独立隔离：同步 throw 与异步 reject 都只落到 logger.warn。
   */
  const dispatch = (payload) => {
    getChannels()
      .then((channels) => {
        if (!Array.isArray(channels)) return;
        for (const channel of channels) {
          if (!channel || typeof channel.send !== 'function') continue;
          // 先包一层已决 Promise：send 的同步 throw 也变成可捕获的 rejection。
          Promise.resolve()
            .then(() => channel.send(payload))
            .then(
              () => logger.info(`[task-notify] 通道 "${channel.name}" 发送成功`),
              (error) => logger.warn(`[task-notify] 通道 "${channel.name}" 发送失败：${describe(error)}`),
            );
        }
      })
      .catch((error) => logger.warn(`[task-notify] 通道装载失败，本次通知丢弃：${describe(error)}`));
  };

  ctx.on('agent/status', (payload) => {
    try {
      const { agent, status } = payload ?? {};
      if (!agent || typeof status !== 'string') return;
      if (!config.notifyOn.includes(status)) return;
      if (config.agents === 'root' && !isRootAgent(agent)) return;

      // 构造与入队保持同步完成：dedupe 只保留同会话最后一次的最终 payload。
      const sessionId = safeId(agent) || String(agent.id);
      const ts = deps.now();
      const rawBody = deriveBody(agent, sessionId);
      // 本 fork 修复（2026-09-14）：本版 AgentStatus 只有 idle|running，
      // 出错/被手动停止时 agent 同样回到 idle，原实现一律报「任务完成」——误导。
      // 真实结果在最后一次 turn/end 的 reason 里，据此决定标题与图标。
      const turnReason = latestTurnEndReason(agent);
      const titleEvent = typeof format.turnEndIconEvent === 'function'
        ? format.turnEndIconEvent(turnReason)
        : status;
      // v0.3：composeBody 存在时正文尾部带格式化时间（format.time 控制）；
      // 旧契约（overrides.format 注入的假 format）无此方法时保持纯摘要行为。
      const body = typeof format.composeBody === 'function'
        ? format.composeBody(rawBody, {
            ts,
            timeStyle: config.format.time,
            showDuration: config.format.showDuration,
            maxLen: config.maxBodyLength,
          })
        : format.formatBody(rawBody, config.maxBodyLength);
      const notification = {
        event: titleEvent,
        title: typeof format.formatTurnTitle === 'function'
          ? format.formatTurnTitle(turnReason)
          : format.formatTitle(status),
        body,
        sessionId,
        agentId: safeId(agent), // 研究：Agent.id 即 SessionId（恒等 brand），二者相同
        ts,
        iconUrl: renderIconUrl(config.icons, titleEvent), // SPEC §7.4：未配置/禁用为 ""
      };
      coalescer.push(sessionId, () => dispatch(notification));
    } catch (error) {
      // 双保险：宿主本身会吞监听器异常并 warn，但插件自律不外抛。
      logger.warn(`[task-notify] 处理 agent/status 事件失败：${describe(error)}`);
    }
  });

  /* ------------------------------------------------------------------ */
  /* 本 fork 修复（2026-09-17）：等待人工介入时也发通知            */
  /* ------------------------------------------------------------------ */

  /**
   * 会话卡在「需要你决策」时发通知。
   *
   * 背景：原插件只监听 `agent/status`。等待审批 / 等待回答期间 agent 既不是 idle
   * 也谈不上结束，所以手机端永远收不到——人一离开电脑就会一直干等。
   *
   * ⚠️ **不能用 `approval/request` / `user-questions/request` 的 waterfall 监听**：
   * 二者是**链式**派发（见 dsh-user-questions 的 `ask()`，带 agent 时还走
   * `scopeTarget(agent, agent)` 作用域）。前面任一监听器一旦认领请求，后面的
   * 监听器**根本不会执行**。实测 DSH 自带的 Web 桥接器
   * （`dsh-client-ui-user-questions` 经 `ctx.remote.$on` 注册）排在前面先认领，
   * 而本插件在 bundles 里排末位 → 永远轮不到，通知发不出去（**已实测确认**）。
   *
   * 改用 **`session/event`**：普通事件、与监听器顺序无关、也不会干扰审批链。
   * 两个触发源：
   *   - 会话事件 `approval/asked`    → 需要人工审批
   *   - 工具调用 `ask_user_question` → 等待用户选择/回答
   *
   * 复用既有 event 名 `blocked`（→ 标题「需要确认」+ 琥珀图标），因此**无需改配置**：
   * 用户 notifyOn 里本就有的 `blocked` 从此真正生效。
   *
   * 注意：这里**不**套 `agents: root` 过滤——子代理卡住同样会阻塞整个会话，
   * 「你被挡住了」比「别吵」更重要。
   *
   * @param {object} session 会话对象（`session/event` 的第一个参数）
   * @param {string} eventName 决定标题与图标的 event 名（awaiting-approval / awaiting-answer）
   * @param {string} note 追加到正文末尾的具体事由
   */
  const dispatchAwaiting = (session, eventName, note) => {
    try {
      if (!config.notifyOn.includes('blocked')) return;
      const sessionId = String(session?.id ?? '');
      // 拿不到会话 id 就放弃，避免不同会话的通知在同一 key 下互相覆盖
      if (sessionId === '') return;
      // deriveBody 期望 agent 形状（读 agent.session.snapshotEvents()），故包一层伪 agent
      const pseudoAgent = { id: sessionId, session };
      const ts = deps.now();
      const summary = deriveBody(pseudoAgent, sessionId);
      const rawBody = note ? `${summary} · ${note}` : summary;
      const body = typeof format.composeBody === 'function'
        ? format.composeBody(rawBody, {
            ts,
            timeStyle: config.format.time,
            showDuration: false, // 等待类事件没有「用时」语义
            maxLen: config.maxBodyLength,
          })
        : format.formatBody(rawBody, config.maxBodyLength);
      coalescer.push(sessionId, () =>
        dispatch({
          event: eventName,
          title: format.formatTitle(eventName),
          body,
          sessionId,
          agentId: sessionId,
          ts,
          iconUrl: renderIconUrl(config.icons, eventName),
        }),
      );
    } catch (error) {
      logger.warn(`[task-notify] 等待类通知构造失败：${describe(error)}`);
    }
  };

  /** 从问题列表取第一条问题文本与选项数，拼成通知正文里的事由。 */
  const describeQuestion = (questions) => {
    try {
      if (!Array.isArray(questions) || questions.length === 0) return '';
      const first = questions[0];
      const text = typeof first?.question === 'string' ? first.question.trim() : '';
      const optionCount = Array.isArray(first?.options) ? first.options.length : 0;
      const more = questions.length > 1 ? `（共 ${questions.length} 问）` : '';
      if (text === '') return more;
      const clipped = text.length > 60 ? `${text.slice(0, 60)}…` : text;
      return `待回答：${clipped}${optionCount > 0 ? `［${optionCount} 选］` : ''}${more}`;
    } catch {
      return '';
    }
  };

  /** 解析 ask_user_question 的 arguments（JSON 字符串），提取问题摘要。 */
  const describeAskUserArgs = (raw) => {
    try {
      if (typeof raw !== 'string' || raw.trim() === '') return '';
      const parsed = JSON.parse(raw);
      return describeQuestion(parsed?.questions);
    } catch {
      return ''; // 参数不是合法 JSON → 退化为无补充信息，绝不影响通知本身
    }
  };

  /**
   * 唯一的等待类入口：`session/event`（普通事件，顺序无关）。
   *
   * - `approval/asked`            会话事件：有人要审批 → 「待批准：<工具>（<原因>）」
   * - `tool/call` + 工具名 ask_user_question → 「待回答：<问题>［N 选］」
   *
   * 用 try/catch 全包：session/event 是全局热点事件，绝不能因本插件抛错而影响宿主。
   */
  ctx.on('session/event', (session, event) => {
    try {
      const type = event?.type;
      if (type === 'approval/asked') {
        const tool = typeof event.data?.toolName === 'string' ? event.data.toolName : '';
        const reason = typeof event.data?.reason === 'string' ? event.data.reason.trim() : '';
        const note = `待批准：${tool || '未知工具'}${reason ? `（${reason.slice(0, 40)}）` : ''}`;
        dispatchAwaiting(session, 'awaiting-approval', note);
        return;
      }
      if (type === 'tool/call' && event.data?.name === 'ask_user_question') {
        const note = describeAskUserArgs(event.data?.arguments) || '待回答：已向你提出问题';
        dispatchAwaiting(session, 'awaiting-answer', note);
      }
    } catch (error) {
      logger.warn(`[task-notify] session/event 通知失败：${describe(error)}`);
    }
  });

  ctx.effect(
    () => () => {
      coalescer.dispose(); // 清空 pending 定时器，此后 push 一律忽略
      channelsReady = null; // 进行中的发送不中断，任其自然落定（各自 catch 兜底）
    },
    'task-notify.dispose',
  );
}

/* ------------------------------------------------------------------ */
/* Deps 组装（SPEC 5.2 契约）                                          */
/* ------------------------------------------------------------------ */

/**
 * 组装真实 Deps：run / httpPost / logger / now。
 * overrides.deps 可逐项覆盖（测试注入假实现，不碰真实网络与子进程）。
 */
function makeDeps(fallbackLogger, overrides = {}) {
  const base = {
    /**
     * execFile 的 Promise 化：参数一律数组传参（杜绝 shell 注入面），
     * reject 时附带 stdout/stderr 便于通道层 warn 出上下文。
     */
    run: (file, args, opts = {}) =>
      new Promise((resolve, reject) => {
        execFile(
          file,
          Array.isArray(args) ? args : [String(args)],
          { timeout: RUN_TIMEOUT_MS, windowsHide: true, ...opts },
          (error, stdout, stderr) => {
            if (error) {
              error.stdout = typeof stdout === 'string' ? stdout : '';
              error.stderr = typeof stderr === 'string' ? stderr : '';
              reject(error);
            } else {
              resolve({ stdout: String(stdout ?? ''), stderr: String(stderr ?? '') });
            }
          },
        );
      }),

    /** fetch 包装：AbortController 强制 8s 超时（SPEC 5.7），返回 {status,text}。 */
    httpPost: async (url, init = {}) => {
      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(new Error(`请求超过 ${HTTP_TIMEOUT_MS}ms 超时`)),
        HTTP_TIMEOUT_MS,
      );
      try {
        const response = await fetch(url, { ...init, signal: controller.signal });
        const text = await response.text();
        return { status: response.status, text };
      } finally {
        clearTimeout(timer);
      }
    },

    logger: fallbackLogger,
    now: Date.now,
  };
  return { ...base, ...(overrides.deps ?? {}) };
}

/** ctx.logger 缺属性时逐级降级 console，保证 logger.info/warn 恒可用。 */
function makeLogger(ctx) {
  const host = ctx?.logger;
  const pick = (method, fallback) =>
    typeof host?.[method] === 'function'
      ? host[method].bind(host)
      : method === 'info'
        ? () => {}
        : (msg) => console.warn(String(msg));
  return { info: pick('info'), warn: pick('warn') };
}

/* ------------------------------------------------------------------ */
/* 通道装载                                                            */
/* ------------------------------------------------------------------ */

/**
 * 装载通道数组。契约来源 SPEC §4/§5.2：
 * channels/index.mjs 导出 createChannels(cfgs, deps) → [{ name, send }]。
 * Worker-A 的文件可能尚未落地：动态 import 失败 → warn + 空数组降级
 * （零通道、静默不发送），保证插件本体永不因缺文件拖垮宿主加载。
 */
async function acquireChannels(config, deps, overrides, logger) {
  if (typeof overrides.createChannels === 'function') {
    return await overrides.createChannels(config, deps);
  }
  if (Array.isArray(overrides.channels)) return overrides.channels;
  try {
    const module = await import('./channels/index.mjs');
    const created = module.createChannels(config, deps);
    return Array.isArray(created) ? created : [];
  } catch (error) {
    logger.warn(`[task-notify] channels/index.mjs 加载失败，通知暂不可用：${describe(error)}`);
    return [];
  }
}

/* ------------------------------------------------------------------ */
/* Payload 辅助                                                        */
/* ------------------------------------------------------------------ */

/**
 * 渲染远程图标 URL（SPEC §7.3/§7.4）。
 *
 * 规则：icons.enabled 为真且 urlTemplate 非空时，把模板中的 `{event}`
 * 占位符替换为 encodeURIComponent(event)；否则返回空串。
 * 对未归一化的 config（直接传入的测试配置）保持宽容：缺段、enabled 非真、
 * 模板非字符串一律视为未配置。
 *
 * @param {{ enabled?: unknown, urlTemplate?: unknown }|undefined} icons 配置的 icons 段
 * @param {string|undefined} event 生命周期事件名
 * @returns {string} 渲染后的 URL，未配置/禁用时为 ""
 * @since 0.2
 */
export function renderIconUrl(icons, event) {
  if (!icons || typeof icons !== 'object' || !icons.enabled) return '';
  const template = typeof icons.urlTemplate === 'string' ? icons.urlTemplate : '';
  if (template.trim() === '') return '';
  const encoded = encodeURIComponent(typeof event === 'string' ? event : String(event ?? ''));
  return template.split('{event}').join(encoded);
}

/** 从 agent 对象安全提取会话 id 字符串。 */
function safeId(agent) {
  const raw = agent?.id;
  if (typeof raw === 'string') return raw;
  if (raw === null || raw === undefined) return '';
  try { return String(raw); } catch { return ''; }
}

/**
 * body 三级降级（研究依据见文件头第 3 点）：
 *   1. 日志中最后一个 session/title 事件的 data.title（官方 foldSessionTitle 同款折叠）
 *   2. 第一条 user/message 的纯文本拼接（官方 collectSessionTitleMessages 同款提取）
 *   3. 固定文案「会话 <前 8 位>」
 */
export function deriveBody(agent, sessionId) {
  // 本 fork 修复（2026-09-14）：DSH 的 Session **没有** `events` 属性。
  // 运行时核对：`'events' in Session.prototype === false`、
  // `typeof Session.prototype.snapshotEvents === 'function'`。公开 API 是方法
  // snapshotEvents()。原实现读 agent.session.events 恒为 undefined，于是
  // `if (events && ...)` 守卫永不成立 —— 取标题、取首条用户消息这两条路径
  // **从未执行过**，每次都落到兜底文案。这里优先用 snapshotEvents()，
  // 同时保留对旧 `events` 数组的兼容；任何异常一律降级到兜底文案。
  let events;
  try {
    const session = agent?.session;
    events = Array.isArray(session?.events)
      ? session.events
      : typeof session?.snapshotEvents === 'function'
        ? session.snapshotEvents()
        : undefined;
  } catch {
    events = undefined;
  }
  if (events && typeof events.findLast === 'function') {
    try {
      const titleEvent = events.findLast((item) => item?.type === 'session/title');
      const title = titleEvent?.data?.title;
      if (typeof title === 'string' && title.trim() !== '') return title;

      for (const event of events) {
        if (event?.type !== 'user/message') continue;
        if (event?.data?.source?.kind !== 'user') continue;
        const content = event?.data?.content;
        if (!Array.isArray(content)) continue;
        const text = content
          .filter((block) => block?.type === 'text' && typeof block.text === 'string')
          .map((block) => block.text)
          .join('\n')
          .trim();
        if (text !== '') return text;
      }
    } catch {
      /* 日志形状异常 → 继续走降级文案 */
    }
  }
  // 本 fork 修复（2026-09-14）：原实现是 `sessionId.slice(0, 8)`，
  // 但 DSH 的 Agent.id/SessionId 带 `session-` 前缀（如 session-ccf7916e-…），
  // 因此 slice(0,8) 恒等于字符串 "session-"，降级文案永远是「会话 session-」，
  // 完全无法区分是哪个会话。改为：先剥掉前缀，并优先用会话 header 的 cwd
  // 项目名，输出形如「dsh · ccf7916e」。cwd 为空时回退到纯短 ID。
  const raw = typeof sessionId === 'string' ? sessionId : '';
  const short = raw.replace(/^session-/, '').slice(0, 8);
  const project = projectNameOf(agent);
  if (project !== '' && short !== '') return `${project} · ${short}`;
  if (project !== '') return project;
  return short !== '' ? `会话 ${short}` : '后台任务';
}

/**
 * 取会话最后一次 `turn/end` 的 reason（本 fork 修复 2026-09-14）。
 *
 * 用途：`AgentStatus` 只有 idle/running，任务出错或被手动停止时 agent 同样回到
 * idle，无法据此区分结果；真实结果只在 `turn/end` 的 `data.reason` 里
 * （取值见 DSH 的 `TurnEndReasonMap`）。
 *
 * 同一份日志读取逻辑与 {@link deriveBody} 共用同一套 Session API 兼容层；
 * 任何异常（含 Session 无该方法）一律返回 undefined，由调用方走保守文案。
 *
 * @param {object} [agent]
 * @returns {{ kind?: string, reason?: { kind?: string } }|undefined}
 */
export function latestTurnEndReason(agent) {
  try {
    const session = agent?.session;
    const events = Array.isArray(session?.events)
      ? session.events
      : typeof session?.snapshotEvents === 'function'
        ? session.snapshotEvents()
        : undefined;
    if (!events || typeof events.findLast !== 'function') return undefined;
    const turnEnd = events.findLast((item) => item?.type === 'turn/end');
    const reason = turnEnd?.data?.reason;
    return reason && typeof reason === 'object' ? reason : undefined;
  } catch {
    return undefined;
  }
}

/**
 * 从会话 header 的 cwd 取末段目录名作为项目标识（本地补丁新增）。
 * 同时按 `\` 与 `/` 切分，避免依赖平台相关的 path 实现；任何异常都降级为空串，
 * 绝不让取项目名这件事影响通知本身。
 *
 * @param {object} [agent]
 * @returns {string} 目录名，取不到时为空串
 */
function projectNameOf(agent) {
  try {
    const cwd = agent?.session?.header?.cwd;
    if (typeof cwd !== 'string' || cwd.trim() === '') return '';
    const parts = cwd.split(/[\\/]+/).filter((part) => part !== '');
    return parts.length > 0 ? parts[parts.length - 1] : '';
  } catch {
    return '';
  }
}

/* ------------------------------------------------------------------ */
/* 顶层代理判定                                                        */
/* ------------------------------------------------------------------ */

/**
 * 判定是否顶层代理。判据与研究出处见文件头第 2 点。
 * 判定过程抛错时保守返回 true（宁可多发一条，也不漏掉任务完成）。
 */
export function isRootAgent(agent) {
  try {
    const headerDepth = toFiniteNumber(agent?.session?.header?.delegationDepth);
    const runtimeDepth = toFiniteNumber(agent?.options?.subagentDepth);
    const depth = Math.max(headerDepth ?? 0, runtimeDepth ?? 0);
    if (depth > 0) return false;
    // 本 fork 修复（2026-09-22）：**已删除 parentSession 判据**。
    //
    // parentSession 的语义是「上下文续接来源」，不是「子代理」：DSH 在续接/派生
    // 会话时会带上它，但这类会话的 delegationDepth 仍为 0、origin 也不是
    // 'subagent' —— 它们是有真实人类交互的**活跃顶层会话**（实测某会话 129 条
    // 人类提问、104 个回合），却被这里误判为子代理 → **完成通知被静默丢弃**，
    // 而等待类通知不受此判据限制，于是表现为「只有『待回答』没有『任务完成』」。
    //
    // 实测依据（本机 118 个会话）：origin === 'subagent' 与 delegationDepth > 0
    // **完全等集（各 37 个）**；去掉 parentSession 只会放行 5 个「上下文续接」
    // 会话，其中**不含任何真子代理**，因此该判据是纯误伤，删除是安全的。
    if (agent?.session?.header?.origin === 'subagent') return false;
    return true;
  } catch {
    return true; // 启发式兜底：字段形态未知时不拦截通知（不确定性已在此注明）
  }
}

function toFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function describe(error) {
  return error instanceof Error ? error.message : String(error);
}
