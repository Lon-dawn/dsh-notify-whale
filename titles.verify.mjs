/**
 * Host-side verification of the notification-title override.
 *
 * Proves three things end to end, none of which is a guess:
 *   1. the Config schema still builds (a bad volatile mark throws at build time);
 *   2. config.mjs keeps a `titles` section and drops unknown event names;
 *   3. the titles actually reach the payload — a configured title replaces the
 *      built-in one, an empty/unset one leaves it untouched.
 */
import { Config } from './config-schema.mjs';
import { resolveConfig, TITLE_EVENTS } from './config.mjs';
import { applyTitleOverride, fallbackFormat } from './index.mjs';

let failures = 0;
const check = (ok, label) => { console.log(`   ${ok ? 'PASS' : 'FAIL'}  ${label}`); if (!ok) failures += 1; };

console.log('=== 1. Config schema ===');
check(Config.type === 'object', 'schema builds and is an object');
check(typeof Config.simplify === 'function', 'schema exposes simplify()');
check(Array.isArray([...TITLE_EVENTS]) && TITLE_EVENTS.includes('blocked'), `TITLE_EVENTS = ${TITLE_EVENTS.length} events`);

// Every title field must be volatile, or the settings form cannot edit it.
const titleFields = Object.keys(Config.dict.titles.dict);
check(titleFields.length === TITLE_EVENTS.length, `schema declares ${titleFields.length} title fields for ${TITLE_EVENTS.length} events`);
for (const event of TITLE_EVENTS) {
  check(titleFields.includes(event), `schema has a field for "${event}"`);
}

console.log('\n=== 2. config.mjs keeps the section ===');
const withTitles = resolveConfig({ titles: { blocked: '待我拍板', bogus: 'ignored', idle: '  完成啦  ' } }, {}, null);
check(withTitles.titles.blocked === '待我拍板', `titles.blocked = ${JSON.stringify(withTitles.titles.blocked)}`);
check(!('bogus' in withTitles.titles), 'unknown event name is dropped');
check(withTitles.titles.idle === '完成啦', `surrounding whitespace is trimmed -> ${JSON.stringify(withTitles.titles.idle)}`);

const empty = resolveConfig({ titles: { blocked: '' } }, {}, null);
check(!('blocked' in empty.titles), 'an empty title means "keep the built-in", not an empty notification');

const absent = resolveConfig({}, {}, null);
check(typeof absent.titles === 'object' && Object.keys(absent.titles).length === 0, 'no titles configured -> empty map');

console.log('\n=== 3. the override reaches the title ===');
const BUILT_IN = fallbackFormat.formatTitle('blocked');
check(applyTitleOverride(undefined, 'blocked', BUILT_IN) === BUILT_IN, 'no config -> built-in title unchanged');
check(applyTitleOverride({}, 'blocked', BUILT_IN) === BUILT_IN, 'empty map -> built-in title unchanged');
check(applyTitleOverride({ blocked: '' }, 'blocked', BUILT_IN) === BUILT_IN, 'blank value -> built-in title unchanged');
check(applyTitleOverride({ blocked: '待我拍板' }, 'blocked', BUILT_IN) === '待我拍板', 'configured value wins');
check(applyTitleOverride({ blocked: '  待我拍板  ' }, 'blocked', BUILT_IN) === '待我拍板', 'configured value is trimmed');
check(applyTitleOverride({ blocked: 'X' }, 'error', BUILT_IN) === BUILT_IN, 'other events keep their own built-in title');

console.log(`\n${failures === 0 ? 'ALL TITLE CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
