/**
 * Guard the CSS template literal in client.js.
 *
 * The stylesheet is a template literal, so an unescaped backtick or `${` in a
 * comment silently terminates it and breaks the whole module (this happened
 * once: a package name written with backticks in a CSS comment).
 */
import { readFileSync } from 'node:fs';

const src = readFileSync('client.js', 'utf8');
const marker = 'const CSS = `';
const start = src.indexOf(marker);
if (start === -1) throw new Error('CSS template literal not found');

// Walk to the terminating backtick, respecting escapes.
let i = start + marker.length;
let css = '';
while (i < src.length) {
  const ch = src[i];
  if (ch === '\\') { css += ch + (src[i + 1] ?? ''); i += 2; continue; }
  if (ch === '`') break;
  css += ch;
  i += 1;
}

console.log('css block length:', css.length);
const backticks = (css.match(/`/g) ?? []).length;
const interpolations = (css.match(/\$\{/g) ?? []).length;
console.log('backticks inside   :', backticks);
console.log('${ interpolations  :', interpolations);

const failures = [];
if (backticks !== 0) failures.push('unescaped backtick inside the CSS literal');
if (interpolations !== 0) failures.push('${ inside the CSS literal would interpolate');

// Every var() must reference a token, and every --dsw token referenced must
// exist in the host's own stylesheets — a typo there resolves to nothing and
// renders as "no colour" instead of failing loudly.
const referenced = new Set();
for (const m of css.matchAll(/var\((--dsw-[a-z0-9-]+)/g)) referenced.add(m[1]);
for (const m of css.matchAll(/(?<!var\()\s(--dsw-[a-z0-9-]+)\s*:/g)) referenced.add(m[1]);

const hostTokens = new Set();
const hostRoots = [
  'D:/Applications/DSH Desktop/resources/app/node_modules/@deepseek-ai/dsh-client-ui-primitives/lib',
];
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
for (const root of hostRoots) {
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.css')) {
        for (const m of readFileSync(full, 'utf8').matchAll(/--dsw-[a-z0-9-]+/g)) hostTokens.add(m[0]);
      }
    }
  };
  try { if (statSync(root).isDirectory()) walk(root); } catch { /* host layout differs */ }
}

console.log('\ntokens referenced by the page:', referenced.size);
const unknown = [...referenced].filter((token) => hostTokens.size > 0 && !hostTokens.has(token));
for (const token of unknown) failures.push(`token not present in the host stylesheets: ${token}`);
if (hostTokens.size === 0) console.log('  (host stylesheets not found; existence check skipped)');
else console.log('  all referenced tokens exist in the host stylesheets:', unknown.length === 0);

if (failures.length > 0) {
  console.error('\nFAILURES:');
  for (const failure of failures) console.error('  - ' + failure);
  process.exit(1);
}
console.log('\nCSS TEMPLATE OK');
