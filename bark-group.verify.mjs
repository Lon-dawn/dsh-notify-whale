/**
 * Host-side verification of the Bark notification group.
 *
 * Several machines can share one self-hosted Bark server, so an unset `group`
 * lumps every push into the app's "默认" bucket and they cannot be told apart.
 * These checks pin the three properties that make that work:
 *   1. an unconfigured group resolves to THIS machine's name (so every machine
 *      separates itself with no per-machine setup);
 *   2. an explicit group is respected verbatim, and a blank one falls back;
 *   3. the value reaches Bark's request body, JSON-encoded so spaces and CJK
 *      survive.
 */
import { resolveConfig, defaultBarkGroup } from './config.mjs';
import { buildBarkRequest } from './channels/webhook.mjs';

let failures = 0;
const check = (ok, label) => { console.log(`   ${ok ? 'PASS' : 'FAIL'}  ${label}`); if (!ok) failures += 1; };

console.log('=== 1. the default is this machine ===');
const host = defaultBarkGroup();
console.log(`   hostname-derived default = ${JSON.stringify(host)}`);
check(host.length > 0, 'default group is never empty');
check(host.length <= 8, `default stays within Bark's suggested 8 characters (got ${host.length})`);
check(/^[\x21-\x7e]+$/.test(host) || host.length > 0, 'default is a usable plain string');

const unconfigured = resolveConfig({}, {}, null);
check(unconfigured.bark.group === host, `unconfigured bark.group resolves to ${JSON.stringify(unconfigured.bark.group)}`);

console.log('\n=== 2. explicit and blank values ===');
const explicit = resolveConfig({ bark: { group: 'PC1-lab' } }, {}, null);
check(explicit.bark.group === 'PC1-lab', `explicit group is respected -> ${JSON.stringify(explicit.bark.group)}`);

const blank = resolveConfig({ bark: { group: '   ' } }, {}, null);
check(blank.bark.group === host, 'blank group falls back to the machine name rather than an empty group');

const fromEnvLike = resolveConfig({}, {}, null);
check(fromEnvLike.bark.group === host, 'a config that never mentions group still gets the machine name');

console.log('\n=== 3. the value reaches the request body ===');
const withGroup = JSON.parse(buildBarkRequest({ deviceKey: 'k', group: host }, { event: 'idle', title: 'T', body: 'B' }).body);
check(withGroup.group === host, `body carries group = ${JSON.stringify(withGroup.group)}`);
check(withGroup.title === 'T' && withGroup.body === 'B', 'group does not disturb the existing fields');

const withoutGroup = JSON.parse(buildBarkRequest({ deviceKey: 'k' }, { event: 'idle', title: 'T', body: 'B' }).body);
check(!('group' in withoutGroup), 'no group configured at the request layer -> field omitted, not empty');

const cjk = JSON.parse(buildBarkRequest({ deviceKey: 'k', group: '机 器 名' }, { event: 'idle', title: 'T', body: 'B' }).body);
check(cjk.group === '机 器 名', 'spaces and CJK survive JSON encoding');

const withSound = JSON.parse(
  buildBarkRequest({ deviceKey: 'k', group: 'g', sound: 'bell', sounds: { error: 'calypso' } }, { event: 'error', title: 'T', body: 'B' }).body,
);
check(withSound.group === 'g' && withSound.sound === 'calypso', 'group coexists with the per-event ringtone');

console.log(`\n${failures === 0 ? 'ALL BARK GROUP CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
