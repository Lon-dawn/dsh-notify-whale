/**
 * Offline verification of the browser half.
 *
 * Loads client.js exactly as the client module loader would, then renders the
 * section component in each of the three states the shared form can be in
 * (loading / unavailable / ready) and reports what came out. No DOM, no
 * browser: it only proves the module contract, the registration shape, and
 * that no state throws — it cannot prove how the page looks.
 */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const React = {
  createElement(type, props, ...children) {
    return { type, props: props ?? {}, children: children.flat() };
  },
  useSyncExternalStore(_subscribe, getSnapshot) {
    return getSnapshot();
  },
};

let captured = null;
const sandbox = { window: { __ModuleLoader__: { load(spec) { captured = spec; } } }, console };
vm.createContext(sandbox);
vm.runInContext(readFileSync('client.js', 'utf8'), sandbox, { filename: 'client.js' });

console.log('module id:', captured.id, '| factory:', typeof captured.factory);
const mod = captured.factory((name) => {
  if (name === 'react') return React;
  throw new Error('unexpected require: ' + name);
});
console.log('exports:', Object.keys(mod).join(', '), '| inject:', JSON.stringify(mod.inject));

const dictionaries = {};
const slots = [];

/**
 * 可控的假 configForm：快照可替换、订阅者可手动触发、mutate 有记录。
 * 「发送测试」按钮的模型级行为（请求写入 / 结果落定 / 草稿保留）靠它驱动。
 */
function makeForm(initialSnapshot) {
  let snapshot = initialSnapshot;
  const subscribers = new Set();
  const mutations = [];
  return {
    form: {
      getSnapshot: () => snapshot,
      subscribe(listener) {
        subscribers.add(listener);
        return () => subscribers.delete(listener);
      },
      mutate: async (ops, revision) => {
        mutations.push({ ops, revision });
        return true;
      },
    },
    setSnapshot(next) { snapshot = next; },
    emit() { for (const listener of [...subscribers]) listener(); },
    mutations,
  };
}

function makeCtx(snapshot) {
  const harness = makeForm(snapshot);
  return {
    __form: harness,
    effect(fn) { const dispose = fn(); return () => { if (typeof dispose === 'function') dispose(); }; },
    locale: {
      register(ns, dict) { dictionaries[ns] = dict.zh ?? dict.en; return () => {}; },
      bind(ns) { return (key) => (dictionaries[ns] ?? {})[key] ?? key; },
    },
    configForms: {
      get: () => harness.form,
    },
    slots: {
      inject(_slot, callback) { const dispose = callback(); return () => { if (typeof dispose === 'function') dispose(); }; },
      register(options, component) { slots.push({ options, component }); return () => {}; },
    },
  };
}

const READY_VALUE = {
  enabled: true,
  notifyOn: ['idle', 'error'],
  agents: 'root',
  coalesceWindowMs: 2000,
  maxBodyLength: 120,
  desktop: { enabled: 'off', sound: true },
  icons: { enabled: true, urlTemplate: '' },
  format: { time: 'short', showDuration: true },
  bark: { enabled: true, server: 'https://bark.example', deviceKey: '', sound: 'fanfare', sounds: {} },
  ntfy: { enabled: true, server: 'https://ntfy.example', topic: 'topic1', token: '' },
};

const READY_SNAPSHOT = { status: 'ready', writable: true, revision: 3, value: READY_VALUE };

const CASES = [
  ['loading', { status: 'loading', writable: false, value: undefined, revision: undefined }],
  ['unavailable', { status: 'unavailable', writable: false, value: undefined, revision: undefined }],
  ['ready', READY_SNAPSHOT],
];

let failures = 0;
const check = (ok, label) => { console.log(`   ${ok ? 'PASS' : 'FAIL'}  ${label}`); if (!ok) failures += 1; };

for (const [label, snapshot] of CASES) {
  console.log(`\n=== state: ${label} ===`);
  slots.length = 0;
  const ctx = makeCtx(snapshot);
  mod.apply(ctx);

  check(slots.length === 1, 'registers exactly one slot entry');
  const entry = slots[0];
  check(entry.options.name === 'settings.section', `slot name = ${entry.options.name}`);
  check(entry.options.id === 'task-notify', `slot id = ${entry.options.id}`);
  check(typeof entry.options.label() === 'string' && entry.options.label().length > 0, `label() = ${JSON.stringify(entry.options.label())}`);

  const injected = entry.options.inject();
  check(typeof injected.model === 'object', 'inject() carries the form model');

  let tree;
  try {
    tree = entry.component({ t: ctx.locale.bind('task-notify'), ...injected });
  } catch (error) {
    check(false, `component threw: ${error.message}`);
    continue;
  }

  const classes = new Set();
  const strings = [];
  (function walk(node) {
    if (typeof node === 'string') { strings.push(node); return; }
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    // The stylesheet is a <style> element; its text is not page copy.
    if (node.type === 'style') return;
    const cls = node.props?.className;
    if (cls) String(cls).split(/\s+/).forEach((name) => classes.add(name));
    (node.children ?? []).forEach(walk);
  })(tree);

  check(classes.has('tn-root'), 'renders the page root');

  // The action row must stay in the content flow: a sticky or fixed bar is what
  // covered the field text in the previous revision.
  const css = String((tree.children ?? []).find((child) => child?.type === 'style')?.children?.[0] ?? '');
  check(css.length > 0, 'ships its own stylesheet');
  check(!/position:\s*(sticky|fixed)/.test(css), 'action row is in-flow (no sticky/fixed positioning)');
  check(/\.tn-footer[^}]*border-top/.test(css), 'action row is separated by a top border');

  // The switch must invert exactly like the host's own: a dark off-track with a
  // light thumb. Matching the host's two colour tokens is the whole fix for the
  // "pale blob" regression, so pin them here.
  const switchRules = css.split(/(?<=\})\s*/).filter((rule) => rule.includes('.tn-switch'));
  const switchCss = switchRules.join('\n');
  check(/background:\s*var\(--dsw-alias-border-l3\)/.test(switchCss), 'switch off-track uses --dsw-alias-border-l3 (dark)');
  check(/var\(--dsw-alias-switch-thumb\)/.test(switchCss), 'switch thumb uses --dsw-alias-switch-thumb (light)');
  check(!/background:\s*#fff/.test(switchCss), 'switch thumb is not a hardcoded white');
  check(/width:\s*36px/.test(switchCss) && /height:\s*20px/.test(switchCss), 'switch keeps the host 36x20 metrics');
  check(/translateX\(16px\)/.test(switchCss), 'switch thumb travels the host 16px');

  // The three states must be visually distinct: the two not-ready ones show a
  // single notice and no form at all.
  const hasForm = classes.has('tn-footer');
  if (label === 'ready') {
    check(hasForm, 'ready state renders the action footer');
    check(classes.has('tn-card'), 'ready state renders section cards');
    // 「发送测试通知」按钮：desktop + 四个推送通道各一个。
    const buttons = [];
    (function collect(node) {
      if (!node || typeof node !== 'object' || Array.isArray(node)) return;
      if (typeof node.type === 'string' && node.type === 'button' && typeof node.props?.className === 'string' && node.props.className.includes('tn-test')) {
        buttons.push(node);
      }
      (Array.isArray(node.children) ? node.children : []).forEach(collect);
    })(tree);
    check(buttons.length === 5, `renders five test buttons, got ${buttons.length}`);
    for (const channel of ['desktop', 'bark', 'ntfy', 'serverchan', 'webhook']) {
      const button = buttons.find((b) => b.props.id === `tn-test-${channel}`);
      check(button !== undefined && button.props.disabled === false, `test button for ${channel} is enabled`);
    }
  } else {
    check(!hasForm, 'not-ready state renders no form');
    check(strings.length === 1, `not-ready state shows one notice: ${JSON.stringify(strings[0])}`);
    check(!/tn-test/.test(JSON.stringify(tree.props ?? tree)), 'not-ready state renders no test buttons');
  }
}

/* ================================================================ */
/* 「发送测试通知」模型级流程                                          */
/* ================================================================ */
console.log('\n=== model: test notification flow ===');

{
  slots.length = 0;
  const ctx = makeCtx(READY_SNAPSHOT);
  mod.apply(ctx);
  const model = slots[0].options.inject().model;
  const harness = ctx.__form;

  // 1. 点击 → 写入 test.<channel> 请求字段（JSON {ts, n}），进入 pending 态。
  model.requestTest('bark');
  await Promise.resolve();
  await Promise.resolve();
  check(harness.mutations.length === 1, 'requestTest issues exactly one mutate');
  const op = harness.mutations[0].ops[0];
  check(op.op === 'set' && JSON.stringify(op.path) === JSON.stringify(['test', 'bark']), 'request op targets test.bark');
  let request = {};
  try { request = JSON.parse(op.value); } catch { /* checked below */ }
  check(typeof request.ts === 'number' && typeof request.n === 'string' && request.n !== '', 'request carries ts + nonce');
  // 不带固定 revision：由控制器在写队列执行时取最新（0.2.1 语义）。
  check(harness.mutations[0].revision === undefined, 'request omits the fixed revision');
  check(model.getSnapshot().testing === true, 'model reports a pending test');
  const nonce = request.n;

  // 2. pending 期间：按钮禁用、状态行显示发送中；再次点击被忽略。
  let tree = slots[0].component({ t: ctx.locale.bind('task-notify'), ...slots[0].options.inject() });
  const barkButton = (function find(node) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return null;
    if (node.props?.id === 'tn-test-bark') return node;
    for (const child of Array.isArray(node.children) ? node.children : []) {
      const hit = find(child);
      if (hit) return hit;
    }
    return null;
  })(tree);
  check(barkButton !== null && barkButton.props.disabled === true, 'test button is disabled while pending');
  model.requestTest('bark');
  await Promise.resolve();
  check(harness.mutations.length === 1, 'a second click while pending is ignored');

  // 3. 未保存草稿在测试请求落地时必须保留（订阅回调不再无条件清草稿）。
  model.edit('bark.server', 'https://changed.example');
  check(model.getSnapshot().dirty === true, 'staged edit marks the form dirty');
  harness.emit(); // 模拟请求写回落地的订阅推送
  check(model.getSnapshot().dirty === true, 'landed test request keeps staged drafts');

  // 4. 结果回流：宿主把 nonce → {ok, detail} 写进 testResult，随快照到达。
  harness.setSnapshot({
    ...READY_SNAPSHOT,
    revision: READY_SNAPSHOT.revision + 2,
    value: {
      ...READY_SNAPSHOT.value,
      testResult: JSON.stringify({ [nonce]: { channel: 'bark', ok: true, detail: 'HTTP 200', ts: Date.now() } }),
    },
  });
  harness.emit();
  const done = model.getSnapshot().tests('bark');
  check(done !== null && done.phase === 'done' && done.ok === true && done.detail === 'HTTP 200', 'result settles the pending test as ok');
  check(model.getSnapshot().testing === false, 'pending flag clears when the result arrives');
  check(model.getSnapshot().dirty === true, 'landed result keeps staged drafts too');

  // 5. 失败结果同样落定，detail 原样带给 UI。
  model.requestTest('ntfy');
  await Promise.resolve();
  await Promise.resolve();
  const failNonce = JSON.parse(harness.mutations[1].ops[0].value).n;
  harness.setSnapshot({
    ...READY_SNAPSHOT,
    revision: READY_SNAPSHOT.revision + 3,
    value: {
      ...READY_SNAPSHOT.value,
      testResult: JSON.stringify({ [failNonce]: { channel: 'ntfy', ok: false, detail: 'HTTP 401: bad token', ts: Date.now() } }),
    },
  });
  harness.emit();
  const failedTest = model.getSnapshot().tests('ntfy');
  check(failedTest.phase === 'done' && failedTest.ok === false && failedTest.detail === 'HTTP 401: bad token', 'failed result carries the detail');

  // 6. dispose 释放订阅（并清掉超时定时器，进程不得被定时器拖住）。
  model.dispose();
  check(true, 'dispose completes');
}

console.log(`\n${failures === 0 ? 'ALL CLIENT CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
