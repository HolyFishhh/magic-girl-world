import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as sass from 'sass';

const source = fs.readFileSync('src/fish/index.scss', 'utf8');
const css = sass.compile('src/fish/index.scss', { logger: sass.Logger.silent }).css;
assert.doesNotMatch(source, /height:\s*max\(720px,\s*100%\)/,
  'battle board must not inherit the iframe viewport height');
assert.match(css, /\.card-game-container\s*\{[^}]*height:\s*auto;[^}]*min-height:\s*0/s,
  'battle board should grow from scene content only');
assert.match(css, /#battle-scene\s*\{\s*height:\s*auto;\s*min-height:\s*720px;/s,
  'battle scene must accommodate actual content without iframe-height feedback');

const runtime = fs.readFileSync('src/runtime/characterRuntime.ts', 'utf8');
for (const token of ['self_target', 'trigger', 'axes:']) {
  assert.match(runtime, new RegExp(token.replace(':', '\\:')));
}
assert.match(runtime, /对自身生效的效果/);
assert.match(runtime, /触发式效果/);
console.log('PASS battle board flow geometry and user-facing simulation labels');
