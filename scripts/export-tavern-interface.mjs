import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, serializeOuter } from 'parse5';
import ts from 'typescript';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const releaseConfig = JSON.parse(await readFile(resolve(root, 'release.config.json'), 'utf8'));
const viewBootstrapPath = resolve(root, 'src/runtime/viewBootstrap.ts');
const viewBootstrapSource = await readFile(viewBootstrapPath, 'utf8');

const interfaces = [
  {
    id: 'magic-girl-world-start-interface',
    scriptName: '开始模块',
    source: 'dist/src/start/index.html',
    output: 'dist/tavern/start-interface.json',
    findRegex: '(?:\\[开始游戏.*\\]|<CHARACTER_INIT_PENDING>)\\s*(?:<StatusPlaceHolderImpl\\s*\\/?>)?',
    placement: [2],
    minDepth: 0,
    maxDepth: 0,
    documentMode: 'body',
    fenced: true,
    runtimeView: 'start',
  },
  {
    id: 'magic-girl-world-update-interface',
    scriptName: '变量更新展示',
    source: 'dist/src/common/update/index.html',
    output: 'dist/tavern/update-interface.json',
    findRegex: '<UpdateVariable>[\\s\\S]*?<\\/UpdateVariable>',
    placement: [2],
    minDepth: 0,
    maxDepth: 2,
    documentMode: 'body',
    fenced: true,
    runtimeView: 'update',
  },
  {
    id: 'magic-girl-world-common-interface',
    scriptName: '通用模块',
    source: 'dist/src/common/index.html',
    output: 'dist/tavern/common-interface.json',
    findRegex:
      '(?<![\\s\\S]*<BATTLE_START>[\\s\\S]*)(?![\\s\\S]*<BATTLE_START>)(?:(?:<CONTENT_PENDING>\\s*)?<StatusPlaceHolderImpl\\s*\\/?>|<CONTENT_PENDING>)',
    placement: [2],
    minDepth: 0,
    maxDepth: 2,
    documentMode: 'body',
    fenced: true,
    runtimeView: 'common',
  },
  {
    id: 'magic-girl-world-fish-interface',
    scriptName: '战斗模块',
    source: 'dist/src/fish/index.html',
    output: 'dist/tavern/fish-interface.json',
    findRegex:
      '(?:<StatusPlaceHolderImpl\\s*\\/?>\\s*)?<BATTLE_START>\\s*(?:<StatusPlaceHolderImpl\\s*\\/?>)?',
    placement: [2],
    minDepth: 0,
    maxDepth: 0,
    documentMode: 'body',
    fenced: true,
    runtimeView: 'fish',
  },
];

function buildViewBootstrap(view) {
  let script = ts.transpileModule(viewBootstrapSource, {
    compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES5, removeComments: true },
    fileName: viewBootstrapPath,
  }).outputText;
  script = script
    .replaceAll('__MWG_VIEW_NAME__', () => JSON.stringify(view))
    .replaceAll('__MWG_CARD_VERSION__', () => JSON.stringify(releaseConfig.cardVersion));
  if (/__MWG_(?:VIEW_NAME|CARD_VERSION)__/.test(script)) {
    throw new Error(`Unresolved ${view} bootstrap placeholder`);
  }
  if (script.includes('`') || script.includes('?.') || script.includes('</script') || script.includes('<')) {
    throw new Error(`${view} bootstrap contains syntax that can be reparsed by Tavern Helper`);
  }
  return script;
}

function createRuntimeShell(view) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{width:100%;margin:0;padding:0;background:transparent}.mwg-runtime-loading{padding:10px;color:#596579;font:13px/1.5 sans-serif}</style></head><body><div class="mwg-runtime-loading" id="mwg-runtime-message" role="status">正在加载魔法少女世界界面...</div><script>${buildViewBootstrap(view)}</script></body></html>`;
}

// Replacement text passes through SillyTavern's regex engine and Tavern
// Helper's HTML renderer. Protect script-only syntax that those layers would
// otherwise interpret again. The regex shell contains no capture groups; the
// view reads the owning message through the shared Tavern Helper runtime.
function protectTavernScript(node) {
  if (node?.nodeName === 'script') {
    node.childNodes?.forEach(child => {
      if (child.nodeName === '#text') {
        child.value = child.value
          // Unicode escapes remain valid in both strings and identifiers such
          // as Webpack's generated `$1` export, while Tavern never sees a raw
          // replacement-group marker.
          .replace(/\$(?=\d|<)/g, '\\u0024')
          .replace(/&(?=(?:[a-zA-Z][a-zA-Z0-9]+|#\d+|#x[\da-fA-F]+);)/g, '\\x26');
      }
    });
  }
  node?.childNodes?.forEach(protectTavernScript);
}

async function exportInterface(definition) {
  const sourcePath = resolve(root, definition.source);
  const outputPath = resolve(root, definition.output);
  const document = parse(
    definition.runtimeView ? createRuntimeShell(definition.runtimeView) : await readFile(sourcePath, 'utf8'),
  );
  const htmlElement = document.childNodes.find(node => node.nodeName === 'html');
  const headElement = htmlElement?.childNodes?.find(node => node.nodeName === 'head');
  const bodyElement = htmlElement?.childNodes?.find(node => node.nodeName === 'body');
  if (!htmlElement || !headElement || !bodyElement) throw new Error(`Unable to parse ${sourcePath}`);

  protectTavernScript(document);
  let renderedHtml;
  if (definition.documentMode === 'body') {
    const body = bodyElement.childNodes?.map(serializeOuter).join('').trim();
    const styles = headElement.childNodes
      ?.filter(node => node.nodeName === 'style')
      .map(serializeOuter)
      .join('\n');
    if (!body || !styles) throw new Error(`Unable to extract body/styles from ${sourcePath}`);
    renderedHtml = `<body>\n${styles}\n${body}\n</body>`;
  } else {
    // Tavern Helper's HTML code-block renderer recognizes the canonical
    // lowercase doctype used by existing cards. parse5 serializes it as
    // `<!DOCTYPE html>`, which SillyTavern leaves as a literal code block.
    renderedHtml = `<!doctype html>${serializeOuter(htmlElement)}`;
    if (!renderedHtml) throw new Error(`Unable to serialize ${sourcePath}`);
  }

  const payload = {
    id: definition.id,
    scriptName: definition.scriptName,
    findRegex: definition.findRegex,
    replaceString: `${definition.replacementPrefix || ''}${definition.fenced ? `\`\`\`\n${renderedHtml}\n\`\`\`` : renderedHtml}`,
    trimStrings: [],
    placement: definition.placement,
    disabled: false,
    markdownOnly: true,
    promptOnly: false,
    runOnEdit: true,
    substituteRegex: 0,
    minDepth: definition.minDepth ?? null,
    maxDepth: definition.maxDepth ?? null,
  };

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(payload, null, 2), 'utf8');
  console.log(`Exported Tavern Helper regex: ${outputPath}`);
}

for (const definition of interfaces) await exportInterface(definition);
