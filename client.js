/**
 * task-notify settings page — the browser half.
 *
 * 0.1.7 does NOT synthesise a settings page from a plugin's `Config`: the
 * shipped settings base only reports `autoGenerate` for clients that choose to
 * build one, and every official page (ui-settings-shell, ui-settings-agent-loop,
 * …) plus the third-party ones ship their own browser half. So this file is the
 * half that puts a first-level `settings.section` entry in the sidebar.
 *
 * Rules this file follows (from the harness' own plugin practices):
 *   - one lazy factory whose id equals the package name; React comes from the
 *     browser module table (`require('react')`), no bundled React;
 *   - no `@deepseek-ai/dsh-client-ui-*` import — a plain-JS plugin has no type
 *     check and a throwing component blanks the slot entry. Controls are drawn
 *     here and styled only with `--dsw-alias-*` theme tokens;
 *   - every visible string goes through the Client locale service;
 *   - the form subscription is owned by the slot registration, so collapsing
 *     the entry releases it.
 *
 * The chrome mirrors the host's own plugin-settings card (`ui-settings-plugins`
 * PluginCard, and the pet card that copies it): a stacked field is
 * label → hint → full-width control, and the action row is an IN-FLOW footer
 * separated by a top border. It is deliberately not sticky and carries no
 * background — a floating bar overlaps the field text above it.
 *
 * The form itself is the shared `ctx.configForms` one: `get(ENTRY_ID)` returns a
 * revision-fenced controller over the Host document, with `set`/`unset`/`mutate`
 * writes. This page stages edits locally and only writes on save, so what the
 * user sees is exactly what a save stores.
 */

/** Profile entry id of the plugin row (see the bundle's cordis.patch.yml). */
const ENTRY_ID = 'task-notify';

/** Dictionary namespace owned by this page. */
const NS = 'task-notify';

/** The events a notification can fire for (mirrors format.mjs EVENT_META). */
const EVENTS = ['idle', 'error', 'blocked', 'goal-completed', 'stopped', 'interrupted', 'truncated'];

/** Ringtone slots the channel layer maps per event (bark.sounds). */
const SOUND_SLOTS = ['awaiting-approval', 'awaiting-answer', 'error', 'stopped', 'interrupted', 'truncated', 'blocked', 'idle'];

/**
 * Events whose notification TITLE can be overridden (config.titles).
 *
 * This set matches `TITLE_EVENTS` in config.mjs — the Host drops any other key,
 * so offering a field the Host would ignore would be a silent no-op. The
 * built-in wording lives in `format.mjs` and stays as long as the field is
 * empty.
 */
const TITLE_SLOTS = [
  { name: 'idle', label: 'event_idle' },
  { name: 'error', label: 'event_error' },
  { name: 'blocked', label: 'event_blocked' },
  { name: 'goal-completed', label: 'event_goalComple' },
  { name: 'stopped', label: 'event_stopped' },
  { name: 'interrupted', label: 'event_interrupted' },
  { name: 'truncated', label: 'event_truncated' },
  { name: 'awaiting-approval', label: 'slot_awaitingApproval' },
  { name: 'awaiting-answer', label: 'slot_awaitingAnswer' },
];

const en = {
  title: 'Notifications',
  description: 'Where dsh sends a notice when a task finishes, fails, or needs your decision.',
  general: 'General',
  enabled: 'Enable notifications',
  enabledHint: 'Turn the whole plugin off without uninstalling it.',
  notifyOn: 'Notify on',
  notifyOnHint: 'Pick the events worth a notification.',
  agents: 'Which agents',
  agentsRoot: 'Only the main agent',
  agentsAll: 'Every agent, including subagents',
  bodyLength: 'Body length limit',
  coalesce: 'Merge window (ms)',
  coalesceHint: 'Notifications from one session inside this window are merged into one.',
  desktop: 'Desktop',
  desktopMode: 'Desktop toasts',
  desktopAuto: 'Automatic',
  desktopOn: 'Always',
  desktopOff: 'Never',
  desktopSound: 'Desktop sound',
  channels: 'Push channels',
  channelsHint: 'Each channel is independent; enable the ones you use.',
  server: 'Server',
  topic: 'Topic',
  token: 'Access token',
  deviceKey: 'Device key',
  group: 'Group',
  groupHint: 'Defaults to this machine\u2019s name so several machines sharing one server stay apart.',
  sendKey: 'Send key',
  url: 'Webhook URL',
  defaultSound: 'Default ringtone',
  perEventSounds: 'Ringtone per event',
  perEventSoundsHint: 'Leave a row empty to fall back to the default ringtone.',
  iconEnabled: 'Attach an icon',
  iconTemplate: 'Icon URL template',
  iconTemplateHint: 'Use {event} as the placeholder, e.g. https://example.com/{event}.png',
  formatting: 'Text',
  titles: 'Notification titles',
  titlesHint: 'Leave a field empty to keep the built-in wording.',
  timeStyle: 'Time in the body',
  timeHidden: 'Hidden',
  timeShort: 'Short',
  timeFull: 'Full',
  showDuration: 'Append how long it took',
  save: 'Save',
  saving: 'Saving…',
  discard: 'Discard',
  saved: 'Saved',
  unsaved: 'Unsaved changes',
  unavailable: 'This plugin is not loaded, so it cannot be configured right now.',
  loading: 'Loading the current settings…',
  readOnly: 'This deployment stores settings read-only.',
  saveFailed: 'The deployment did not accept these values; they were left for you to correct.',
  secretSet: 'A value is stored; type here to replace it.',
  invalidNumber: 'Enter a number, or leave blank to use the default.',
  event_idle: 'Task finished',
  event_error: 'Task failed',
  event_blocked: 'Needs your decision',
  event_goalComple: 'Goal reached',
  event_stopped: 'Stopped',
  event_interrupted: 'Interrupted',
  event_truncated: 'Truncated',
  slot_awaitingApproval: 'Waiting for approval',
  slot_awaitingAnswer: 'Waiting for an answer',
  slot_error: 'Error',
  slot_stopped: 'Stopped',
  slot_interrupted: 'Interrupted',
  slot_truncated: 'Truncated',
  slot_blocked: 'Blocked',
  slot_idle: 'Finished',
};

const zh = {
  title: '通知',
  description: '任务完成、出错或需要你决策时，dsh 把通知发到哪里。',
  general: '通用',
  enabled: '启用通知',
  enabledHint: '不卸载插件也能整个关掉。',
  notifyOn: '触发事件',
  notifyOnHint: '勾选值得打扰你的事件。',
  agents: '哪些智能体',
  agentsRoot: '只主智能体',
  agentsAll: '所有智能体（含子智能体）',
  bodyLength: '正文长度上限',
  coalesce: '合并窗口（毫秒）',
  coalesceHint: '同一会话在此窗口内的通知会合并成一条。',
  desktop: '桌面',
  desktopMode: '桌面弹窗',
  desktopAuto: '自动',
  desktopOn: '总是',
  desktopOff: '从不',
  desktopSound: '桌面提示音',
  channels: '推送通道',
  channelsHint: '各通道互相独立，启用你在用的那些。',
  server: '服务器地址',
  topic: '主题',
  token: '访问令牌',
  deviceKey: '设备密钥',
  group: '推送分组',
  groupHint: '留空则用本机名，多台机器共用一个服务器也不会混在一起。',
  sendKey: 'SendKey',
  url: 'Webhook 地址',
  defaultSound: '默认铃声',
  perEventSounds: '分事件铃声',
  perEventSoundsHint: '留空则回退到默认铃声。',
  iconEnabled: '附带图标',
  iconTemplate: '图标 URL 模板',
  iconTemplateHint: '用 {event} 作占位符，例如 https://example.com/{event}.png',
  formatting: '文案',
  titles: '通知标题',
  titlesHint: '留空则沿用内置文案。',
  timeStyle: '正文时间样式',
  timeHidden: '不显示',
  timeShort: '简短',
  timeFull: '完整',
  showDuration: '追加耗时',
  save: '保存',
  saving: '保存中…',
  discard: '放弃',
  saved: '已保存',
  unsaved: '有未保存的改动',
  unavailable: '该插件当前未加载，暂时无法配置。',
  loading: '正在读取当前设置…',
  readOnly: '本部署的设置为只读。',
  saveFailed: '本部署没有接受这些值，已保留供你修改。',
  secretSet: '已存有值；输入即可替换。',
  invalidNumber: '请填数字；留空表示使用默认值。',
  event_idle: '任务完成',
  event_error: '任务出错',
  event_blocked: '需要你决策',
  event_goalComple: '目标达成',
  event_stopped: '已停止',
  event_interrupted: '被打断',
  event_truncated: '被截断',
  slot_awaitingApproval: '等待审批',
  slot_awaitingAnswer: '等待回答',
  slot_error: '出错',
  slot_stopped: '已停止',
  slot_interrupted: '被打断',
  slot_truncated: '被截断',
  slot_blocked: '被阻塞',
  slot_idle: '完成',
};

window.__ModuleLoader__.load({
  id: 'dsh-notify-whale',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    /* ---------------------------------------------------------------- */
    /* styles                                                            */
    /*                                                                   */
    /* Tokens and metrics are copied from the host's own plugin-settings  */
    /* card: same radius, control heights, typography and footer, so this */
    /* page reads as a sibling of the built-in pages. Only `--dsw-alias-*`*/
    /* tokens are referenced, so a renamed token degrades the look but    */
    /* can never break rendering.                                         */
    /* ---------------------------------------------------------------- */
    const CSS = `
.tn-root { display: flex; flex-direction: column; gap: 16px; padding: 2px 0 20px; color: var(--dsw-alias-label-primary); }
.tn-intro { font-size: 13px; line-height: 1.6; color: var(--dsw-alias-label-secondary); }

.tn-card { border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-3); border-radius: 12px; padding: 0 16px; }
.tn-card > h3 { margin: 0; padding: 14px 0 0; font-size: 13px; font-weight: 600; line-height: 1.5; color: var(--dsw-alias-label-primary); }
.tn-card > .tn-cardHint { margin: 4px 0 0; font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-secondary); }

.tn-field { display: flex; flex-direction: column; gap: 6px; padding: 12px 0; }
.tn-field + .tn-field { border-top: 1px solid var(--dsw-alias-border-l2); }
.tn-fieldHead { display: flex; align-items: center; gap: 8px; }
.tn-label { flex: 1; min-width: 0; font-size: 13px; font-weight: 500; line-height: 1.5; color: var(--dsw-alias-label-primary); }
.tn-hint { margin: 0; font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-secondary); }
.tn-invalid { margin: 0; font-size: 12px; line-height: 1.5; color: var(--dsw-alias-state-error-primary, #b42318); }

.tn-inline { flex-direction: row; align-items: center; gap: 12px; }
.tn-inlineText { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }

.tn-input, .tn-select {
  box-sizing: border-box; width: 100%; height: 34px; font: inherit; font-size: 13px; line-height: 1.5;
  color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-3);
  border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; padding: 0 12px;
}
.tn-input:focus-visible, .tn-select:focus-visible { border-color: var(--dsw-alias-brand-primary); outline: none; }
.tn-input:disabled, .tn-select:disabled { color: var(--dsw-alias-label-tertiary); cursor: default; }
.tn-input[data-invalid="true"] { border-color: var(--dsw-alias-state-error-primary, #b42318); }

/* Switch — metrics, colours and state keying copied from the host's own
   Switch.module.css (package @deepseek-ai/dsh-client-ui-primitives). The off
   track is a DARK surface (border-l3) carrying a LIGHT thumb (switch-thumb);
   inverting those two — a light track with a white thumb — collapses into a
   single pale blob in the dark theme, which is what an earlier revision did.
   Like the host, the appearance keys off aria-checked so the visual state can
   never disagree with what assistive technology reads. */
.tn-switch { box-sizing: border-box; position: relative; flex: 0 0 auto;
  width: 36px; height: 20px; padding: 2px; border: 0; border-radius: 999px;
  background: var(--dsw-alias-border-l3); cursor: pointer; }
.tn-switch[aria-checked="true"] { background: var(--dsw-alias-brand-primary); }
.tn-switch:disabled { cursor: default; opacity: .5; }
.tn-switch:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary, var(--dsw-alias-brand-primary)); outline-offset: 2px; }
.tn-switch::after { content: ""; display: block; width: 16px; height: 16px; border-radius: 50%;
  background: var(--dsw-alias-switch-thumb); transition: transform 120ms ease; }
.tn-switch[aria-checked="true"]::after { background: var(--dsw-alias-label-primary-foreground); transform: translateX(16px); }

.tn-checks { display: flex; flex-wrap: wrap; gap: 8px 18px; padding-top: 2px; }
.tn-check { display: flex; align-items: center; gap: 6px; font-size: 13px; line-height: 1.5; cursor: pointer; }

.tn-sub { border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-2); border-radius: 10px; padding: 0 14px; margin: 2px 0 12px; }
.tn-grid { display: grid; grid-template-columns: minmax(120px, 1fr) minmax(140px, 1.1fr); gap: 8px 12px; align-items: center; padding: 4px 0 12px; }
.tn-grid > span { font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-secondary); }

/* In-flow action row: a top border and right-aligned buttons, exactly like the
   host's card footer. Never sticky and never given a background, so it cannot
   cover the fields above it. */
.tn-footer { display: flex; align-items: center; justify-content: flex-end; gap: 8px;
  border-top: 1px solid var(--dsw-alias-border-l2); padding: 12px 0 4px; }
.tn-status { flex: 1; min-width: 0; margin: 0; font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-secondary); }
.tn-statusError { flex: 1; min-width: 0; margin: 0; font-size: 12px; line-height: 1.5;
  color: var(--dsw-alias-state-error-primary, #b42318); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.tn-discard, .tn-save { appearance: none; font: inherit; font-size: 13px; line-height: 1.5; cursor: pointer;
  border: 1px solid transparent; border-radius: 8px; padding: 5px 14px; }
.tn-discard { border-color: var(--dsw-alias-border-l2); color: var(--dsw-alias-label-secondary); background: transparent; }
.tn-discard:hover:not(:disabled) { color: var(--dsw-alias-label-primary); border-color: var(--dsw-alias-label-dimmed); }
.tn-save { background: var(--dsw-alias-label-primary); color: var(--dsw-alias-bg-layer-3); }
.tn-discard:disabled, .tn-save:disabled { opacity: .4; cursor: default; }
.tn-discard:focus-visible, .tn-save:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }

.tn-note { font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-secondary); }
`;

    /* ---------------------------------------------------------------- */
    /* field specs: how a form value is shown, parsed, and defaulted      */
    /* ---------------------------------------------------------------- */
    const specs = {
      enabled: { kind: 'bool' },
      notifyOn: { kind: 'list' },
      agents: { kind: 'choice' },
      coalesceWindowMs: { kind: 'num', min: 0 },
      maxBodyLength: { kind: 'num', min: 1 },
      'desktop.enabled': { kind: 'choice' },
      'desktop.sound': { kind: 'bool' },
      'icons.enabled': { kind: 'bool' },
      'icons.urlTemplate': { kind: 'text' },
      'format.showDuration': { kind: 'bool' },
      'format.time': { kind: 'choice' },
    };
    for (const ch of ['bark', 'ntfy', 'serverchan', 'webhook']) {
      specs[`${ch}.enabled`] = { kind: 'bool' };
      specs[`${ch}.server`] = { kind: 'text' };
      specs[`${ch}.topic`] = { kind: 'text' };
      specs[`${ch}.token`] = { kind: 'text', secret: true };
      specs[`${ch}.deviceKey`] = { kind: 'text', secret: true };
      specs[`${ch}.sendKey`] = { kind: 'text', secret: true };
      specs[`${ch}.url`] = { kind: 'text' };
      specs[`${ch}.group`] = { kind: 'text' };
      specs[`${ch}.sound`] = { kind: 'text' };
      for (const slot of SOUND_SLOTS) specs[`${ch}.sounds.${slot}`] = { kind: 'text' };
    }
    for (const slot of TITLE_SLOTS) specs[`titles.${slot.name}`] = { kind: 'text' };

    /** Read a dotted path out of the form value. */
    const readPath = (value, path) =>
      path.split('.').reduce((node, key) => (node === null || node === undefined ? undefined : node[key]), value);

    /** Serialize any field value into the text a control shows. */
    function fieldText(spec, current) {
      if (spec.kind === 'bool') return current === true ? 'true' : current === false ? 'false' : '';
      if (spec.kind === 'list') return JSON.stringify(Array.isArray(current) ? current : []);
      return current === undefined || current === null ? '' : String(current);
    }

    /**
     * Parse one draft into a field operation, or undefined when invalid.
     *
     * Lists travel as a JSON array in the draft text: the settings surface has
     * no multi-select control, so the checkbox group serializes the whole array
     * and this is where it turns back into an array. Writing the text straight
     * through would store a STRING where the Host schema expects an array.
     */
    function parseDraft(spec, text) {
      const trimmed = text.trim();
      if (spec.kind === 'bool') {
        if (trimmed === '') return { kind: 'unset' };
        if (trimmed === 'true') return { kind: 'set', value: true };
        if (trimmed === 'false') return { kind: 'set', value: false };
        return undefined;
      }
      if (spec.kind === 'num') {
        if (trimmed === '') return { kind: 'unset' };
        const parsed = Number(trimmed);
        if (!Number.isFinite(parsed)) return undefined;
        if (spec.min !== undefined && parsed < spec.min) return undefined;
        return { kind: 'set', value: parsed };
      }
      if (spec.kind === 'list') {
        if (trimmed === '') return { kind: 'unset' };
        try {
          const parsed = JSON.parse(trimmed);
          if (!Array.isArray(parsed)) return undefined;
          for (const item of parsed) if (typeof item !== 'string') return undefined;
          return { kind: 'set', value: parsed };
        } catch {
          return undefined;
        }
      }
      // text, including secrets: an empty draft clears an override.
      return trimmed === '' ? { kind: 'unset' } : { kind: 'set', value: trimmed };
    }

    /**
     * The staged form model over the shared Host form.
     *
     * The snapshot handed to React is CACHED and only rebuilt when something
     * actually changed: `useSyncExternalStore` re-renders forever if
     * `getSnapshot` returns a fresh object each call.
     */
    function createModel(form) {
      const listeners = new Set();
      let snapshot = form.getSnapshot();
      let drafts = new Map();
      let saving = false;
      let failed = false;
      let savedAt = 0;
      let cache = null;

      const build = () => {
        const view = snapshot;
        return {
          status: view.status,
          writable: view.writable,
          value: view.value,
          failed,
          saving,
          dirty: drafts.size > 0,
          savedAt,
          draft: (path) => {
            const spec = specs[path] ?? { kind: 'text' };
            if (drafts.has(path)) return drafts.get(path);
            return fieldText(spec, readPath(view.value, path));
          },
          invalid: (path) => {
            if (!drafts.has(path)) return false;
            return parseDraft(specs[path] ?? { kind: 'text' }, drafts.get(path)) === undefined;
          },
          /** The value the Host currently holds, independent of any draft. */
          current: (path) => readPath(view.value, path),
        };
      };
      const emit = () => {
        cache = build();
        for (const listener of listeners) listener();
      };
      cache = build();
      const unsubscribe = form.subscribe(() => {
        snapshot = form.getSnapshot();
        // A landed write rebases the drafts; a stale one keeps them for retry.
        if (!saving) drafts = new Map();
        emit();
      });

      /** Run one write and fold its outcome back into the snapshot. */
      const runWrite = (operations) => {
        if (saving) return;
        saving = true;
        failed = false;
        emit();
        return Promise.resolve(form.mutate(operations, snapshot.revision)).then(
          (ok) => {
            saving = false;
            failed = !ok;
            if (ok) {
              drafts = new Map();
              savedAt = Date.now();
            }
            emit();
          },
          () => {
            saving = false;
            failed = true;
            emit();
          },
        );
      };

      return {
        subscribe: (listener) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        getSnapshot: () => cache,
        edit: (path, text) => {
          const spec = specs[path] ?? { kind: 'text' };
          if (text === fieldText(spec, readPath(snapshot.value, path))) drafts.delete(path);
          else drafts.set(path, text);
          emit();
        },
        resetField: (path) => runWrite([{ op: 'unset', path: path.split('.') }]),
        save: () => {
          const ops = [];
          for (const [path, text] of drafts) {
            const parsed = parseDraft(specs[path] ?? { kind: 'text' }, text);
            if (parsed === undefined) continue;
            if (parsed.kind === 'unset') ops.push({ op: 'unset', path: path.split('.') });
            else ops.push({ op: 'set', path: path.split('.'), value: parsed.value });
          }
          if (ops.length === 0) return;
          return runWrite(ops);
        },
        discard: () => {
          drafts = new Map();
          emit();
        },
        dispose: () => {
          listeners.clear();
          unsubscribe();
        },
      };
    }

    /* ---------------------------------------------------------------- */
    /* controls                                                          */
    /* ---------------------------------------------------------------- */
    function Switch({ id, checked, disabled, onToggle }) {
      return h('button', {
        type: 'button',
        className: 'tn-switch',
        id,
        role: 'switch',
        'aria-checked': checked ? 'true' : 'false',
        'aria-label': id,
        disabled,
        onClick: () => onToggle(!checked),
      });
    }

    function TextInput({ id, value, disabled, invalid, secret, onEdit }) {
      return h('input', {
        type: secret ? 'password' : 'text',
        className: 'tn-input',
        id,
        value,
        placeholder: secret ? '••••••' : '',
        disabled,
        'data-invalid': invalid ? 'true' : 'false',
        autoComplete: 'off',
        spellCheck: false,
        onChange: (event) => onEdit(event.target.value),
      });
    }

    function Select({ id, value, options, disabled, onPick }) {
      return h(
        'select',
        { className: 'tn-select', id, value, disabled, onChange: (event) => onPick(event.target.value) },
        options.map((option) => h('option', { key: option.value, value: option.value }, option.label)),
      );
    }

    /** A stacked field: label, hint, then the control across the full width. */
    function Field({ label, hint, invalid, invalidLabel, control }) {
      return h(
        'div',
        { className: 'tn-field' },
        h('div', { className: 'tn-fieldHead' }, h('label', { className: 'tn-label' }, label)),
        hint ? h('p', { className: 'tn-hint' }, hint) : null,
        control,
        invalid ? h('p', { className: 'tn-invalid' }, invalidLabel) : null,
      );
    }

    /** A field whose control shares the label's row (switches). */
    function InlineField({ label, hint, control }) {
      return h(
        'div',
        { className: 'tn-field tn-inline' },
        h(
          'div',
          { className: 'tn-inlineText' },
          h('span', { className: 'tn-label' }, label),
          hint ? h('span', { className: 'tn-hint' }, hint) : null,
        ),
        control,
      );
    }

    /* ---------------------------------------------------------------- */
    /* the page                                                          */
    /* ---------------------------------------------------------------- */
    function TaskNotifySection(props) {
      // The slot host binds `t` from the registration's `locale` key. Fall back
      // to this page's own dictionary rather than throwing: a component that
      // throws takes its whole slot entry down (`slot entry crashed`).
      const t = typeof props.t === 'function' ? props.t : (key) => zh[key] ?? en[key] ?? key;
      const model = props.model;
      const state = React.useSyncExternalStore(model.subscribe, model.getSnapshot);
      const disabled = !state.writable || state.status === 'unavailable';

      // The inline stylesheet is a React element so unmounting removes it.
      const style = h('style', { key: 'task-notify-style' }, CSS);

      if (state.status === 'unavailable') {
        return h('div', { className: 'tn-root' }, style, h('div', { className: 'tn-intro' }, t('unavailable')));
      }
      // The shared form starts in `loading` (it has not answered yet) with
      // `writable: false`. Rendering the fields then would show an empty,
      // disabled page; wait for the first describe instead.
      if (state.status === 'loading' || state.value === undefined) {
        return h('div', { className: 'tn-root' }, style, h('div', { className: 'tn-intro' }, t('loading')));
      }

      const bool = (path, label, hint) =>
        h(InlineField, {
          key: path,
          label,
          hint,
          control: h(Switch, {
            id: `tn-${path}`,
            checked: state.draft(path) === 'true',
            disabled,
            onToggle: () => model.edit(path, state.draft(path) === 'true' ? 'false' : 'true'),
          }),
        });

      const text = (path, label, hint, secret) =>
        h(Field, {
          key: path,
          label,
          hint: hint ?? (secret ? t('secretSet') : undefined),
          invalid: state.invalid(path),
          invalidLabel: t('invalidNumber'),
          control: h(TextInput, {
            id: `tn-${path}`,
            value: state.draft(path),
            disabled,
            invalid: state.invalid(path),
            secret,
            onEdit: (next) => model.edit(path, next),
          }),
        });

      const num = (path, label, hint) =>
        h(Field, {
          key: path,
          label,
          hint,
          invalid: state.invalid(path),
          invalidLabel: t('invalidNumber'),
          control: h(TextInput, {
            id: `tn-${path}`,
            value: state.draft(path),
            disabled,
            invalid: state.invalid(path),
            onEdit: (next) => model.edit(path, next),
          }),
        });

      const choice = (path, label, options, hint) =>
        h(Field, {
          key: path,
          label,
          hint,
          control: h(Select, {
            id: `tn-${path}`,
            value: state.draft(path),
            disabled,
            options,
            onPick: (next) => model.edit(path, next),
          }),
        });

      /** The event checkboxes: the whole array is staged as JSON text. */
      const notifyOn = () => {
        let active = [];
        try {
          const parsed = JSON.parse(state.draft('notifyOn'));
          if (Array.isArray(parsed)) active = parsed;
        } catch {
          active = [];
        }
        const toggle = (event) => {
          const next = new Set(active);
          if (next.has(event)) next.delete(event);
          else next.add(event);
          // Preserve a stable, documented order so the stored array is stable.
          model.edit('notifyOn', JSON.stringify(EVENTS.filter((candidate) => next.has(candidate))));
        };
        return h(Field, {
          key: 'notifyOn',
          label: t('notifyOn'),
          hint: t('notifyOnHint'),
          control: h(
            'div',
            { className: 'tn-checks' },
            EVENTS.map((event) =>
              h(
                'label',
                { className: 'tn-check', key: event },
                h('input', { type: 'checkbox', checked: active.includes(event), disabled, onChange: () => toggle(event) }),
                h('span', null, t(`event_${event === 'goal-completed' ? 'goalComple' : event}`)),
              ),
            ),
          ),
        });
      };

      const channelCard = (key, title, fields) =>
        h(
          'div',
          { className: 'tn-card', key },
          h('h3', null, title),
          bool(`${key}.enabled`, t('enabled'), null),
          state.draft(`${key}.enabled`) === 'true' && !disabled
            ? h(
                'div',
                { className: 'tn-sub' },
                fields.map((field) =>
                  text(
                    `${key}.${field.name}`,
                    t(field.label),
                    field.hintKey ? t(field.hintKey) : null,
                    field.secret,
                  ),
                ),
                key === 'bark'
                  ? h(Field, {
                      key: 'sounds',
                      label: t('perEventSounds'),
                      hint: t('perEventSoundsHint'),
                      control: h(
                        'div',
                        { className: 'tn-grid' },
                        SOUND_SLOTS.flatMap((slot) => [
                          h('span', { key: `${slot}-label` }, t(`slot_${slot.replace(/-(\w)/g, (_, c) => c.toUpperCase())}`)),
                          h(TextInput, {
                            key: `${slot}-input`,
                            id: `tn-${key}.sounds.${slot}`,
                            value: state.draft(`${key}.sounds.${slot}`),
                            disabled,
                            invalid: state.invalid(`${key}.sounds.${slot}`),
                            onEdit: (next) => model.edit(`${key}.sounds.${slot}`, next),
                          }),
                        ]),
                      ),
                    })
                  : null,
              )
            : null,
        );

      return h(
        'div',
        { className: 'tn-root' },
        style,
        h('div', { className: 'tn-intro' }, t('description')),

        h(
          'div',
          { className: 'tn-card' },
          h('h3', null, t('general')),
          bool('enabled', t('enabled'), t('enabledHint')),
          notifyOn(),
          choice('agents', t('agents'), [
            { value: 'root', label: t('agentsRoot') },
            { value: 'all', label: t('agentsAll') },
          ]),
          num('coalesceWindowMs', t('coalesce'), t('coalesceHint')),
          num('maxBodyLength', t('bodyLength'), null),
        ),

        h(
          'div',
          { className: 'tn-card' },
          h('h3', null, t('desktop')),
          choice('desktop.enabled', t('desktopMode'), [
            { value: 'auto', label: t('desktopAuto') },
            { value: 'on', label: t('desktopOn') },
            { value: 'off', label: t('desktopOff') },
          ]),
          bool('desktop.sound', t('desktopSound'), null),
        ),

        h(
          'div',
          { className: 'tn-card' },
          h('h3', null, t('channels')),
          h('p', { className: 'tn-cardHint' }, t('channelsHint')),
          channelCard('bark', 'Bark', [
            { name: 'server', label: 'server' },
            { name: 'deviceKey', label: 'deviceKey', secret: true },
            { name: 'group', label: 'group', hintKey: 'groupHint' },
            { name: 'sound', label: 'defaultSound' },
          ]),
          channelCard('ntfy', 'ntfy', [
            { name: 'server', label: 'server' },
            { name: 'topic', label: 'topic' },
            { name: 'token', label: 'token', secret: true },
          ]),
          channelCard('serverchan', 'ServerChan', [{ name: 'sendKey', label: 'sendKey', secret: true }]),
          channelCard('webhook', 'Webhook', [{ name: 'url', label: 'url' }]),
        ),

        h(
          'div',
          { className: 'tn-card' },
          h('h3', null, t('titles')),
          h('p', { className: 'tn-cardHint' }, t('titlesHint')),
          h(
            'div',
            { className: 'tn-grid' },
            TITLE_SLOTS.flatMap((slot) => [
              h('span', { key: `${slot.name}-label` }, t(slot.label)),
              h(TextInput, {
                key: `${slot.name}-input`,
                id: `tn-titles.${slot.name}`,
                value: state.draft(`titles.${slot.name}`),
                disabled,
                invalid: state.invalid(`titles.${slot.name}`),
                onEdit: (next) => model.edit(`titles.${slot.name}`, next),
              }),
            ]),
          ),
        ),

        h(
          'div',
          { className: 'tn-card' },
          h('h3', null, t('formatting')),
          choice('format.time', t('timeStyle'), [
            { value: 'hidden', label: t('timeHidden') },
            { value: 'short', label: t('timeShort') },
            { value: 'full', label: t('timeFull') },
          ]),
          bool('format.showDuration', t('showDuration'), null),
          bool('icons.enabled', t('iconEnabled'), null),
          text('icons.urlTemplate', t('iconTemplate'), t('iconTemplateHint')),
        ),

        h(
          'div',
          { className: 'tn-footer' },
          h(
            'p',
            { className: state.failed ? 'tn-statusError' : 'tn-status', role: 'status', 'aria-live': 'polite' },
            state.failed ? t('saveFailed') : state.dirty ? t('unsaved') : state.savedAt ? t('saved') : '',
          ),
          disabled ? h('span', { className: 'tn-note' }, t('readOnly')) : null,
          h(
            'button',
            {
              type: 'button',
              className: 'tn-discard',
              disabled: disabled || state.saving || !state.dirty,
              onClick: () => model.discard(),
            },
            t('discard'),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'tn-save',
              disabled: disabled || state.saving || !state.dirty,
              onClick: () => model.save(),
            },
            state.saving ? t('saving') : t('save'),
          ),
        ),
      );
    }

    /* ---------------------------------------------------------------- */
    /* plugin body                                                       */
    /* ---------------------------------------------------------------- */
    const inject = ['slots', 'locale', 'configForms'];

    function apply(ctx) {
      // Dictionaries may be unavailable in a deployment without the locale
      // service; the page must still mount.
      ctx.effect(() => {
        try {
          return ctx.locale.register(NS, { zh, en });
        } catch {
          return () => {};
        }
      }, 'task-notify: dictionaries');

      const t = ctx.locale.bind(NS);
      const form = ctx.configForms.get(ENTRY_ID);
      const model = createModel(form);

      ctx.slots.inject('settings.section', () => {
        try {
          const unregister = ctx.slots.register(
            {
              name: 'settings.section',
              id: 'task-notify',
              order: 200,
              label: () => t('title'),
              locale: NS,
              inject: () => ({ model }),
            },
            TaskNotifySection,
          );
          return () => {
            unregister();
            model.dispose();
          };
        } catch {
          return () => {};
        }
      });
    }

    return { inject, apply, TaskNotifySection };
  },
});
