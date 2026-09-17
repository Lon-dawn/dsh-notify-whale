/**
 * Text formatting helpers for dsh-task-notify.
 *
 * Pure functions only — no I/O, no clock, no environment access, so every
 * helper here is trivially unit-testable. Since v0.2 (SPEC §7.1) all canned
 * headlines are emoji-free; {@link stripEmoji} stays as a defensive tool for
 * arbitrary upstream text that may still carry emoji.
 */

/** Cap applied by {@link formatBody} when `maxLen` is missing or invalid. */
export const DEFAULT_MAX_BODY_LENGTH = 120;

// SPEC §7.1 — strings are locked verbatim, no emoji anywhere.
// 本 fork 修复（2026-09-17）：新增两个等待类标题，让「审批」与「提问」
// 在通知标题上就能一眼分清（原来两者都借用 blocked → 都显示「需要确认」）。
const TITLE_BY_EVENT = Object.freeze({
  idle: "任务完成",
  error: "任务出错",
  blocked: "需要确认",
  "goal-completed": "目标达成",
  "awaiting-approval": "待批准",
  "awaiting-answer": "待回答",
});

const FALLBACK_TITLE = "任务通知";

/**
 * 本 fork 修复（2026-09-14）：按 turn 结束原因取标题。
 *
 * 背景：本版 DSH 的 `AgentStatus` 只有 `idle | running`。任务**出错**或**被手动
 * 停止**时，agent 同样回到 `idle`，于是原实现一律报「任务完成」——这是**误导性
 * 通知**，比不通知更糟，用户无法据它判断任务到底成功没有。
 *
 * 真实原因来自日志里的 `turn/end` 事件，取值为 DSH 的 `TurnEndReasonMap`：
 * `completed` | `aborted` | `blocked` | `error` | `max-tokens` | `interrupted`。
 */
const TITLE_BY_TURN_END = Object.freeze({
  completed: "任务完成",
  error: "任务出错",
  aborted: "任务已停止",
  blocked: "需要确认",
  "max-tokens": "输出被截断",
  interrupted: "任务被中断",
});

/**
 * 按 `turn/end` 的 reason 生成通知标题（本地补丁）。
 *
 * @param {{ kind?: string, reason?: { kind?: string } }|undefined} reason
 *   `turn/end` 事件的 `data.reason`；取不到时 `undefined`。
 * @returns {string} 中文标题；无法判定时保守沿用「任务完成」（等价旧行为）。
 */
export function formatTurnTitle(reason) {
  const kind = reason && typeof reason === "object" ? reason.kind : undefined;
  // aborted 带二级原因：reason.reason.kind === 'user' 即用户主动停止。
  if (kind === "aborted") {
    const cause =
      reason?.reason && typeof reason.reason === "object" ? reason.reason.kind : undefined;
    if (cause === "user") return "已手动停止";
  }
  if (
    typeof kind === "string" &&
    Object.prototype.hasOwnProperty.call(TITLE_BY_TURN_END, kind)
  ) {
    return TITLE_BY_TURN_END[kind];
  }
  return TITLE_BY_EVENT.idle;
}

/**
 * 与 {@link formatTurnTitle} 配套的图标事件名（本地补丁）。
 *
 * 目的：这个 event 名同时驱动**图标**与 **Bark 铃声**（经 bark.sounds 映射），
 * 所以非成功结果必须各自有独立名字，否则只能共用同一个铃声。
 *
 * 本 fork 修复（2026-09-18）：把原来合并成 `notify` 的三类拆开——
 * `aborted` → `stopped`、`interrupted` → `interrupted`、`max-tokens` → `truncated`，
 * 使「手动停止」「被中断」「输出截断」可以分别配置铃声与标题。
 *
 * 图标安全性：新名字在 `EVENT_META` 里没有条目，`iconBaseName()` 会回退到
 * `notify` 图标（paths.mjs 的兜底链），不会出现"找不到图标"的破损。
 *
 * @param {{ kind?: string, reason?: { kind?: string } }|undefined} reason
 * @returns {string} 事件名，可直接交给 {@link formatTitle} / renderIconUrl / bark.sounds。
 */
export function turnEndIconEvent(reason) {
  const kind = reason && typeof reason === "object" ? reason.kind : undefined;
  if (kind === "completed") return "idle";
  if (kind === "error") return "error";
  if (kind === "blocked") return "blocked";
  if (kind === "aborted") return "stopped";
  if (kind === "interrupted") return "interrupted";
  if (kind === "max-tokens") return "truncated";
  return "idle";
}

/**
 * Per-event presentation metadata (SPEC §7.2/§7.4). `icon` is the asset base
 * name under `assets/icons/` (`<icon>.svg` / `<icon>.png`); `color` mirrors
 * the locked accent of the corresponding icon. Unknown events fall back to
 * {@link FALLBACK_ICON} ("notify") — see paths.mjs.
 */
const META_BY_EVENT = Object.freeze({
  idle: Object.freeze({ color: "#34C759", icon: "idle" }),
  error: Object.freeze({ color: "#FF3B30", icon: "error" }),
  blocked: Object.freeze({ color: "#FF9500", icon: "blocked" }),
  "goal-completed": Object.freeze({ color: "#007AFF", icon: "goal-completed" }),
});

export const EVENT_META = Object.freeze(
  Object.fromEntries(
    Object.entries(META_BY_EVENT).map(([event, meta]) => [
      event,
      Object.freeze({ title: TITLE_BY_EVENT[event], ...meta }),
    ]),
  ),
);

/** Asset base name used when an event has no dedicated icon. */
export const FALLBACK_ICON = "notify";

// Emoji-ish code points only: pictograph/supplement blocks, misc symbols and
// dingbats, enclosed alphanumerics used as emoji, the clock/hourglass corner
// of Misc Technical (⏰ ⏸ ⏹ …), variation selectors, ZWJ joiners and the
// keycap combining mark. Plain ASCII, CJK text, arrows (← ↑) and typographic
// symbols like © ® ™ ⌘ are deliberately left alone.
const EMOJI_PATTERN = new RegExp(
  "[\\u{1F000}-\\u{1FAFF}" +
    "\\u{2600}-\\u{27BF}" +
    "\\u{2B00}-\\u{2BFF}" +
    "\\u{23E9}-\\u{23FA}\\u{23F0}\\u{23F3}" +
    "\\u{2139}\\u{2934}-\\u{2935}\\u{3030}\\u{303D}\\u{3297}\\u{3299}" +
    "\\u{FE00}-\\u{FE0F}\\u{200D}\\u{20E3}]",
  "gu",
);

/**
 * Map a lifecycle event name to its notification headline.
 *
 * @param {string|undefined} event One of `idle | error | blocked |
 *   goal-completed`; anything else (including undefined) falls back to a
 *   generic headline so an unknown upstream status still notifies.
 * @returns {string} Emoji-free headline, e.g. `"任务完成"` (SPEC §7.1).
 */
export function formatTitle(event) {
  return TITLE_BY_EVENT[event] ?? FALLBACK_TITLE;
}

/**
 * Normalize free-form text into a single-line notification body.
 *
 * All whitespace runs (newlines, tabs, repeated spaces) collapse to one
 * space, then the result is truncated on code-point boundaries so a cut can
 * never split a surrogate pair, with a trailing ellipsis when truncated.
 *
 * @param {string|null|undefined} text Raw body text; nullish becomes `""`,
 *   non-strings are coerced defensively.
 * @param {number} [maxLen=DEFAULT_MAX_BODY_LENGTH] Maximum character count
 *   of the result (the ellipsis counts toward it). Values below 1 or
 *   non-finite values fall back to {@link DEFAULT_MAX_BODY_LENGTH}.
 * @returns {string}
 */
export function formatBody(text, maxLen = DEFAULT_MAX_BODY_LENGTH) {
  if (text == null) return "";
  const raw = typeof text === "string" ? text : String(text);
  const normalized = raw.replace(/\s+/g, " ").trim();

  let limit = Math.floor(Number(maxLen));
  if (!Number.isFinite(limit) || limit < 1) limit = DEFAULT_MAX_BODY_LENGTH;

  const chars = Array.from(normalized);
  if (chars.length <= limit) return normalized;
  return `${chars.slice(0, limit - 1).join("")}…`;
}

/**
 * Remove emoji from a string. Since v0.2 the canned titles are emoji-free,
 * but this stays as a defensive tool for arbitrary upstream text (session
 * titles, user input) that may still carry emoji before it is embedded in a
 * desktop notification. Also collapses the double spaces left behind by
 * removals and trims the ends, so `"✅ 任务完成"` becomes `"任务完成"`
 * rather than `" 任务完成"`.
 *
 * @param {string|null|undefined} text
 * @returns {string}
 */
export function stripEmoji(text) {
  if (text == null) return "";
  const raw = typeof text === "string" ? text : String(text);
  return raw
    .replace(EMOJI_PATTERN, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/* ------------------------------------------------------------------ */
/* v0.3 时间与组合排版（格式化时间 + 通知正文组装）                      */
/* ------------------------------------------------------------------ */

/** formatTime 支持的样式。 */
export const TIME_STYLES = Object.freeze(["hidden", "short", "full"]);

const pad2 = (n) => String(n).padStart(2, "0");

/**
 * 把 epoch 毫秒渲染成本地时间串。
 *
 * @param {number|Date|null|undefined} ts epoch 毫秒（也接受 Date）；非法值返回空串
 * @param {string} [style="short"] "hidden" 不显示；"short" 为 HH:mm；
 *   "full" 为 YYYY-MM-DD HH:mm:ss；未知样式按 short 处理
 * @returns {string}
 */
export function formatTime(ts, style = "short") {
  if (style === "hidden") return "";
  const date = ts instanceof Date ? ts : new Date(ts);
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  const hhmm = pad2(date.getHours()) + ":" + pad2(date.getMinutes());
  if (style === "full") {
    const y = date.getFullYear();
    const mo = pad2(date.getMonth() + 1);
    const d = pad2(date.getDate());
    return y + "-" + mo + "-" + d + " " + hhmm + ":" + pad2(date.getSeconds());
  }
  return hhmm;
}

/**
 * 把耗时毫秒渲染为紧凑中文时长；非正数/非有限值返回空串（调用方直接过滤）。
 *
 * @param {number|undefined} durationMs
 * @returns {string} 如 "42秒"、"3分05秒"、"1小时02分"
 */
export function formatDuration(durationMs) {
  const n = Number(durationMs);
  if (!Number.isFinite(n) || n <= 0) return "";
  const totalSec = Math.round(n / 1000);
  if (totalSec < 60) return totalSec + "秒";
  const totalMin = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (totalMin < 60) return sec > 0 ? totalMin + "分" + pad2(sec) + "秒" : totalMin + "分";
  const hour = Math.floor(totalMin / 60);
  const min = totalMin % 60;
  return min > 0 ? hour + "小时" + pad2(min) + "分" : hour + "小时";
}

/**
 * 组装最终通知正文：内容摘要在前，时间与耗时作为后缀缀在末尾。
 *
 * 后缀永远不参与截断——formatBody 先对内容截到 maxLen，时间/耗时再以
 * " · " 分隔接上，保证任何配置下时间都完整可见。全部部分为空时返回空串。
 *
 * @param {string|null|undefined} text 原始正文（会先经 formatBody 规整）
 * @param {object} [options]
 * @param {number|Date} [options.ts] epoch 毫秒，配合 timeStyle 渲染
 * @param {number} [options.durationMs] 可选耗时，showDuration 时追加 "用时 X"
 * @param {string} [options.timeStyle="short"] 传给 formatTime
 * @param {boolean} [options.showDuration=true]
 * @param {number} [options.maxLen] 内容截断上限（仅作用于内容部分）
 * @returns {string}
 */
export function composeBody(text, options = {}) {
  const {
    ts,
    durationMs,
    timeStyle = "short",
    showDuration = true,
    maxLen = DEFAULT_MAX_BODY_LENGTH,
  } = options ?? {};

  const parts = [];
  const content = formatBody(text, maxLen);
  if (content) parts.push(content);

  const time = formatTime(ts, timeStyle);
  if (time) parts.push(time);

  if (showDuration) {
    const duration = formatDuration(durationMs);
    if (duration) parts.push("用时 " + duration);
  }
  return parts.join(" · ");
}
