/**
 * HTTP push channels: Bark (iOS), ntfy (Android/iOS), ServerChan (微信) and a
 * generic JSON webhook. All four presets share one send path — build a
 * request, hand it to `deps.httpPost`, and treat anything outside 2xx (or any
 * thrown transport error) as a warn-and-swallow failure. The 8s timeout lives
 * in the real httpPost implementation assembled by index.mjs
 * (AbortController); this module only constructs url/headers/body.
 *
 * Icon wiring since v0.2 (SPEC §7.4): bark appends an `icon` query parameter,
 * ntfy sets the `X-Icon` header, and generic inlines `icon`/`iconSvg` into
 * its JSON body; serverchan has no icon support and is untouched.
 */

import { readFile } from "node:fs/promises";

import { resolveIconSvgPath } from "../paths.mjs";

/** ServerChan has no configurable server, only a send key. */
const SERVERCHAN_ENDPOINT = "https://sctapi.ftqq.com";

const BARK_DEFAULT_SERVER = "https://api.day.app";
const NTFY_DEFAULT_SERVER = "https://ntfy.sh";

const PRESET_KINDS = Object.freeze(["bark", "ntfy", "serverchan", "generic"]);
const CONFIG_KEY_BY_KIND = Object.freeze({
  bark: "bark",
  ntfy: "ntfy",
  serverchan: "serverchan",
  generic: "webhook",
});

/** @param {unknown} value @returns {string} Without trailing slashes. */
function stripTrailingSlash(value) {
  return String(value ?? "").replace(/\/+$/, "");
}

/** @returns {string} Trimmed non-empty string or `""`. */
function nonEmptyString(value) {
  const raw = typeof value === "string" ? value : String(value ?? "");
  return raw.trim();
}

/**
 * @param {string} key Config field name, for the error message.
 * @param {string} value Candidate value.
 * @param {string} kind Channel preset name, for the error message.
 * @returns {string} The value.
 * @throws {TypeError} When the value is empty — createChannel surfaces this
 *   so the registry can warn once at startup instead of on every event.
 */
function requireField(key, value, kind) {
  if (!value) {
    throw new TypeError(`task-notify: channel '${kind}' requires config.${CONFIG_KEY_BY_KIND}.${key}`);
  }
  return value;
}

/**
 * 本 fork 修复（2026-09-17）：按事件挑铃声。
 *
 * `cfg.sounds` 是「事件名 → 铃声名」映射（config.mjs 的 normalizeSounds 产出）。
 * 命中则用映射值，否则回退 `cfg.sound`（全局默认），都没有就不带 sound 字段。
 * 铃声名非法时 Bark 会忽略并退回系统默认音，不会报错，故此处不做白名单校验。
 *
 * @param {{ sound?: string, sounds?: Record<string, string> }} cfg
 * @param {unknown} event 通知事件名（如 idle / awaiting-answer）
 * @returns {string} 铃声名，没有则为空串
 */
function pickBarkSound(cfg, event) {
  const table = cfg && typeof cfg.sounds === "object" && cfg.sounds !== null ? cfg.sounds : null;
  if (table !== null) {
    const byEvent = nonEmptyString(table[String(event)]);
    if (byEvent) return byEvent;
  }
  return nonEmptyString(cfg.sound);
}

/**
 * Bark: JSON `{title, body, sound?}` against `https://<server>/<deviceKey>`.
 * A non-empty `payload.iconUrl` is appended as an `icon` query parameter
 * (SPEC §7.4) — Bark reads query params alongside the JSON body.
 *
 * @param {{ server?: string, deviceKey?: string, sound?: string, sounds?: Record<string, string> }} cfg
 * @param {{ event?: string, title: string, body: string, iconUrl?: string }} payload
 * @returns {{ url: string, headers: object, body: string }}
 */
export function buildBarkRequest(cfg, payload) {
  const deviceKey = requireField("deviceKey", nonEmptyString(cfg.deviceKey), "bark");
  const server = stripTrailingSlash(cfg.server) || BARK_DEFAULT_SERVER;
  const body = { title: payload.title, body: payload.body };
  const sound = pickBarkSound(cfg, payload.event);
  if (sound) body.sound = sound;
  let url = `${server}/${deviceKey}`;
  if (payload.iconUrl) {
    // encodeURIComponent keeps & = + safe inside the query value.
    url += `?icon=${encodeURIComponent(payload.iconUrl)}`;
  }
  return {
    url,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

/**
 * ntfy: JSON publish against the server root URL (`POST <server>` with
 * `{topic, message, title?, icon?}`); the title travels inside the UTF-8 JSON
 * body rather than an HTTP header, because Node's fetch/undici rejects
 * non-Latin-1 header values (see buildNtfyRequest). A non-empty
 * `payload.iconUrl` becomes the `icon` JSON field (SPEC §7.4).
 *
 * @param {{ server?: string, topic?: string, token?: string }} cfg
 * @param {{ title: string, body: string, iconUrl?: string }} payload
 * @returns {{ url: string, headers: object, body: string }}
 */
export function buildNtfyRequest(cfg, payload) {
  const topic = requireField("topic", nonEmptyString(cfg.topic), "ntfy");
  const server = stripTrailingSlash(cfg.server) || NTFY_DEFAULT_SERVER;
  // 本 fork 修复（2026-09-14）：改用 ntfy 官方 JSON 发布，POST 到根 URL，
  // 标题/图标放进 body。原因：原实现把标题放 `X-Title` 头，而 Node 的 fetch/undici
  // 强制 header 值为 ByteString(Latin-1)，中文标题（如「任务完成」U+4EFB）会抛
  // TypeError: Cannot convert argument to a ByteString。JSON body 是 UTF-8，安全。
  // 见 https://docs.ntfy.sh/publish/ ——「To publish as JSON, you must PUT/POST to
  // the ntfy root URL, not to the topic URL.」
  const headers = { "content-type": "application/json" };
  const token = nonEmptyString(cfg.token);
  if (token) headers.Authorization = `Bearer ${token}`;
  const body = { topic, message: payload.body };
  if (payload.title) body.title = payload.title;
  if (payload.iconUrl) body.icon = payload.iconUrl;
  return { url: server, headers, body: JSON.stringify(body) };
}

/**
 * ServerChan: form-encoded `title`/`desp` against the fixed SCT API endpoint.
 *
 * @param {{ sendKey?: string }} cfg
 * @param {{ title: string, body: string }} payload
 * @returns {{ url: string, headers: object, body: string }}
 */
export function buildServerChanRequest(cfg, payload) {
  const sendKey = requireField("sendKey", nonEmptyString(cfg.sendKey), "serverchan");
  return {
    url: `${SERVERCHAN_ENDPOINT}/${sendKey}.send`,
    headers: { "content-type": "application/x-www-form-urlencoded" },
    // encodeURIComponent keeps & = + safe inside both fields.
    body: `title=${encodeURIComponent(payload.title)}&desp=${encodeURIComponent(payload.body)}`,
  };
}

/**
 * Generic webhook: JSON `{event, title, body, sessionId, ts, icon?, iconSvg?}`
 * plus whatever extra headers the user configured (auth tokens etc).
 * Undefined optional fields are dropped by JSON.stringify automatically.
 * `icon` carries the payload's rendered iconUrl verbatim; `iconSvg` is
 * attached separately by {@link attachIconSvg} because it requires async file
 * I/O and the request builders stay synchronous.
 *
 * @param {{ url?: string, headers?: object }} cfg
 * @param {{ event: string, title: string, body: string, sessionId?: string,
 *   ts: number, iconUrl?: string }} payload
 * @returns {{ url: string, headers: object, body: string }}
 */
export function buildGenericRequest(cfg, payload) {
  // The user-provided URL is used verbatim (only trimmed) — a trailing slash
  // can be significant for arbitrary endpoints, unlike our own presets.
  const url = requireField("url", nonEmptyString(cfg.url), "webhook");
  return {
    url,
    headers: {
      "content-type": "application/json",
      ...(typeof cfg.headers === "object" && cfg.headers !== null ? cfg.headers : {}),
    },
    body: JSON.stringify({
      event: payload.event,
      title: payload.title,
      body: payload.body,
      sessionId: payload.sessionId,
      ts: payload.ts,
      icon: payload.iconUrl || undefined,
    }),
  };
}

/**
 * Inline the per-event SVG markup into a generic-webhook JSON body as
 * `iconSvg` (SPEC §7.4). Every failure mode — asset missing, read error,
 * malformed intermediate JSON — degrades to returning the request untouched;
 * an icon must never break the notification itself.
 *
 * @param {{ url: string, headers: object, body: string }} request Built request.
 * @param {string} event Lifecycle event name used to locate the SVG.
 * @param {string} [rootDir] Icon directory override — test seam only, see
 *   {@link resolveIconSvgPath}.
 * @returns {Promise<{ url: string, headers: object, body: string }>}
 */
export async function attachIconSvg(request, event, rootDir) {
  try {
    const svgPath = resolveIconSvgPath(event, rootDir);
    if (!svgPath) return request; // 资产缺失：直接省略字段（含回退 notify.svg 也缺失的情况）
    const svg = await readFile(svgPath, "utf8");
    const parsed = JSON.parse(request.body);
    if (!parsed || typeof parsed !== "object") return request;
    return { ...request, body: JSON.stringify({ ...parsed, iconSvg: svg }) };
  } catch {
    return request; // 读文件失败 → 省略 iconSvg 字段，不影响主链路
  }
}

const REQUEST_BUILDERS = Object.freeze({
  bark: buildBarkRequest,
  ntfy: buildNtfyRequest,
  serverchan: buildServerChanRequest,
  generic: buildGenericRequest,
});

/**
 * Resolve which preset a config section selects. An explicit `config.kind`
 * wins (validated); otherwise the preset is inferred from whichever
 * credential field is present, so raw config sections — which carry no
 * `kind` of their own — can be passed straight from config.mjs or
 * self-test.mjs: sendKey→serverchan, deviceKey→bark, topic→ntfy.
 *
 * @param {object} config Channel config section.
 * @returns {string} One of {@link PRESET_KINDS}.
 * @throws {TypeError} When an explicit kind is unknown.
 */
function resolveKind(config) {
  const explicit = typeof config.kind === "string" ? config.kind.trim() : "";
  if (explicit) {
    if (!REQUEST_BUILDERS[explicit]) {
      throw new TypeError(
        `task-notify: unknown webhook kind '${explicit}' (expected one of ${PRESET_KINDS.join(", ")})`,
      );
    }
    return explicit;
  }
  if (nonEmptyString(config.sendKey)) return "serverchan";
  if (nonEmptyString(config.deviceKey)) return "bark";
  if (nonEmptyString(config.topic)) return "ntfy";
  return "generic";
}

/**
 * Create one HTTP push channel.
 *
 * @param {{ kind?: string, enabled?: boolean }} config Resolved section of
 *   the plugin config (`bark` / `ntfy` / `serverchan` / `webhook`); when
 *   `kind` is absent it is inferred from the credential fields present.
 * @param {import("./index.mjs").Deps} deps Injected runtime dependencies.
 * @returns {{ name: string, send(payload: object): Promise<void> }}
 *   `name` matches the config section key so self-test can target it.
 * @throws {TypeError} Unknown `config.kind`, missing required credential
 *   fields, or missing deps — the registry catches and skips.
 */
export function createChannel(config = {}, deps) {
  const kind = resolveKind(config);
  // Channel name follows the config section (and self-test flag): the generic
  // preset is selected via the `webhook` section.
  const name = CONFIG_KEY_BY_KIND[kind];

  const httpPost = deps?.httpPost;
  const logger = deps?.logger;
  if (typeof httpPost !== "function") {
    throw new TypeError(`${name} channel requires deps.httpPost(url, init)`);
  }
  if (!logger || typeof logger.warn !== "function") {
    throw new TypeError(`${name} channel requires deps.logger.warn(msg)`);
  }

  // Fail fast on missing credentials, at startup rather than per event.
  REQUEST_BUILDERS[kind](config, { title: "", body: "" });

  /**
   * Deliver one payload over HTTP. Any 2xx counts as success and stays
   * silent; non-2xx responses and transport errors are warned with the
   * status code plus the first 200 chars of the response, never rethrown.
   *
   * @param {{ event?: string, title?: string, body?: string,
   *   sessionId?: string, ts?: number, iconUrl?: string }} [payload]
   * @returns {Promise<void>}
   */
  async function send(payload = {}) {
    if (config.enabled === false) return;

    const normalized = {
      event: typeof payload.event === "string" ? payload.event : "",
      title: typeof payload.title === "string" ? payload.title : "",
      body: typeof payload.body === "string" ? payload.body : "",
      sessionId: payload.sessionId,
      ts: Number.isFinite(payload.ts) ? payload.ts : 0,
      iconUrl: typeof payload.iconUrl === "string" ? payload.iconUrl : "",
    };
    let request = REQUEST_BUILDERS[kind](config, normalized);
    // SPEC §7.4：仅 generic 需要 iconSvg（异步读 SVG 文件内联）。
    if (kind === "generic") request = await attachIconSvg(request, normalized.event);
    try {
      // 本 fork 修复（2026-09-14）：原实现只传 headers/body，而
      // index.mjs 的 httpPost 直接 fetch(url, {...init})，缺 method → 变成
      // 「带 body 的 GET」，undici 抛 "Request with GET/HEAD method cannot have
      // body."。这里显式指定 POST，修复全部 HTTP 通道（bark/ntfy/serverchan/generic）。
      const response = await httpPost(request.url, {
        method: "POST",
        headers: request.headers,
        body: request.body,
      });
      const status = Number(response?.status);
      if (!(status >= 200 && status < 300)) {
        const snippet = String(response?.text ?? "").slice(0, 200);
        logger.warn(
          `[task-notify] ${name} webhook responded ${status}: ${snippet || "(empty body)"}`,
        );
      }
    } catch (error) {
      const cause = error instanceof Error ? error.message : String(error);
      logger.warn(`[task-notify] ${name} webhook request failed: ${cause}`);
    }
  }

  return { name, send };
}
