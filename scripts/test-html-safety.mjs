import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import ts from 'typescript';

const helperSource = await readFile(resolve('src/fish/shared/html.ts'), 'utf8');
const helperOutput = ts.transpileModule(helperSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { escapeHtml, escapeHtmlAttribute } = await import(
  `data:text/javascript;base64,${Buffer.from(helperOutput).toString('base64')}`
);

const hostile = `<img src=x onerror="window.__mwgInjected=1"> Tom & 'Jerry'`;
const escaped = '&lt;img src=x onerror=&quot;window.__mwgInjected=1&quot;&gt; Tom &amp; &#39;Jerry&#39;';
assert.equal(escapeHtml(hostile), escaped);
assert.equal(escapeHtmlAttribute(hostile), escaped);
assert.equal(escapeHtml(null), '');
assert.equal(escapeHtml(0), '0');

const contracts = [
  [
    'src/common/index.ts',
    /escapeHtml\(item\)/,
    /escapeHtml\(description\)/,
    /escapeHtml\(status\.name \|\| '未知状态'\)/,
  ],
  ['src/fish/ui/battleShellPresenter.ts', /escapeHtml\(item\.name\)/, /escapeHtmlAttribute\(item\.id\)/],
  [
    'src/fish/ui/battleUI.ts',
    /escapeHtml\(cardData\.name\)/,
    /data-relic-description="\$\{escapeHtmlAttribute\(relic\.description/,
    /effectDisplay\.triggeredProgramToTags\(relic\?\.trigger \|\| '', relic\?\.effectProgram\)/,
    /data-ability-description="\$\{escapeHtmlAttribute\(description\)\}"/,
  ],
  ['src/fish/ui/pileViewer.ts', /escapeHtml\(card\.description\)/, /escapeHtmlAttribute\(card\.id\)/],
  ['src/fish/ui/cardInteractionPresenter.ts', /escapeHtml\(card\.description/, /escapeHtmlAttribute\(card\.id\)/],
  ['src/fish/ui/effectProgramDisplay.ts', /escapeHtml\(entry\.text\)/, /escapeHtml\(entry\.icon\)/],
  ['src/fish/ui/enemyIntentPresenter.ts', /escapeHtml\(model\.description\)/],
  ['src/fish/modules/battleLog.ts', /escapeHtml\(message\)/, /escapeHtmlAttribute\(source\.details\)/],
];

for (const [file, ...patterns] of contracts) {
  const source = await readFile(resolve(file), 'utf8');
  for (const pattern of patterns) assert.match(source, pattern, `${file} must escape AI/MUV HTML content`);
}

console.log('AI/MUV battle content is escaped at shared high-risk HTML renderers.');
