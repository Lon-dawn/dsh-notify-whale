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

function makeCtx(snapshot) {
  return {
    effect(fn) { const dispose = fn(); return () => { if (typeof dispose === 'function') dispose(); }; },
    locale: {
      register(ns, dict) { dictionaries[ns] = dict.zh ?? dict.en; return () => {}; },
      bind(ns) { return (key) => (dictionaries[ns] ?? {})[key] ?? key; },
    },
    configForms: {
      get() {
        return {
          getSnapshot: () => snapshot,
          subscribe: () => () => {},
          mutate: async () => true,
        };
      },
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

const CASES = [
  ['loading', { status: 'loading', writable: false, value: undefined, revision: undefined }],
  ['unavailable', { status: 'unavailable', writable: false, value: undefined, revision: undefined }],
  ['ready', { status: 'ready', writable: true, revision: 3, value: READY_VALUE }],
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
  } else {
    check(!hasForm, 'not-ready state renders no form');
    check(strings.length === 1, `not-ready state shows one notice: ${JSON.stringify(strings[0])}`);
  }
}

console.log(`\n${failures === 0 ? 'ALL CLIENT CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
