import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse, serializeOuter } from 'parse5';
import ts from 'typescript';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const releaseConfig = JSON.parse(await readFile(resolve(root, 'release.config.json'), 'utf8'));
const viewSources = {
  start: 'dist/src/start/index.html',
  common: 'dist/src/common/index.html',
  fish: 'dist/src/fish/index.html',
};

function textContent(node) {
  if (node.nodeName === '#text') return node.value || '';
  return node.childNodes?.map(textContent).join('') || '';
}

function collectNodes(node, output = []) {
  output.push(node);
  node.childNodes?.forEach(child => collectNodes(child, output));
  if (node.content) collectNodes(node.content, output);
  return output;
}

function stripRuntimeNodes(node) {
  if (!node.childNodes) return;
  node.childNodes = node.childNodes.filter(child => child.nodeName !== 'script' && child.nodeName !== 'style');
  node.childNodes.forEach(stripRuntimeNodes);
  if (node.content) stripRuntimeNodes(node.content);
}

function byteLength(value) {
  return Buffer.byteLength(value, 'utf8');
}

async function extractViewAsset(sourcePath) {
  const document = parse(await readFile(resolve(root, sourcePath), 'utf8'));
  const nodes = collectNodes(document);
  const html = nodes.find(node => node.nodeName === 'html');
  const body = nodes.find(node => node.nodeName === 'body');
  const title = nodes.find(node => node.nodeName === 'title');
  const scripts = nodes.filter(node => node.nodeName === 'script');
  const styles = nodes.filter(node => node.nodeName === 'style');
  if (!html || !body || scripts.length !== 1 || styles.length === 0) {
    throw new Error(`${sourcePath} must contain html/body, one inline script, and at least one style`);
  }
  if (scripts.some(node => node.attrs?.some(attribute => attribute.name === 'src'))) {
    throw new Error(`${sourcePath} must not depend on external script files`);
  }

  const script = scripts.map(textContent).join('\n;\n').replaceAll('\uFEFF', '').trim();
  const styleText = styles.map(textContent).join('\n').replaceAll('\uFEFF', '').trim();
  stripRuntimeNodes(body);
  const bodyHtml = body.childNodes?.map(serializeOuter).join('').trim() || '';
  if (!bodyHtml || !script || !styleText) throw new Error(`Unable to extract runtime asset from ${sourcePath}`);

  return {
    title: textContent(title).trim(),
    bodyHtml,
    styles: styleText,
    script,
  };
}

function safeJson(value) {
  return JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029');
}

const assets = Object.fromEntries(
  await Promise.all(Object.entries(viewSources).map(async ([name, source]) => [name, await extractViewAsset(source)])),
);
const buildInfo = {
  cardVersion: releaseConfig.cardVersion,
  views: Object.fromEntries(
    Object.entries(assets).map(([name, asset]) => [
      name,
      {
        bodyBytes: byteLength(asset.bodyHtml),
        styleBytes: byteLength(asset.styles),
        scriptBytes: byteLength(asset.script),
      },
    ]),
  ),
};

const sourcePath = resolve(root, 'src/runtime/characterRuntime.ts');
let runtimeScript = ts.transpileModule(await readFile(sourcePath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022, removeComments: true },
  fileName: sourcePath,
}).outputText;
const serializedAssets = safeJson(assets);
const serializedBuildInfo = safeJson(buildInfo);
runtimeScript = runtimeScript
  .replaceAll('__MWG_VIEW_ASSETS__', () => serializedAssets)
  .replaceAll('__MWG_BUILD_INFO__', () => serializedBuildInfo);
if (/__MWG_(?:VIEW_ASSETS|BUILD_INFO)__/.test(runtimeScript)) {
  throw new Error(
    `Unresolved Tavern runtime build placeholder: ${[
      ...runtimeScript.matchAll(/__MWG_(?:VIEW_ASSETS|BUILD_INFO)__/g),
    ].map(match => match[0]).join(', ')}`,
  );
}
if (/<\/script/i.test(runtimeScript)) throw new Error('Character runtime must not contain a literal closing script tag');

const runtimePath = resolve(root, 'dist/tavern/character-runtime.js');
const manifestPath = resolve(root, 'dist/tavern/character-runtime-manifest.json');
await mkdir(dirname(runtimePath), { recursive: true });
await Promise.all([
  writeFile(runtimePath, runtimeScript, 'utf8'),
  writeFile(
    manifestPath,
    JSON.stringify({ spec: 'mwg.tavern-runtime/v1', ...buildInfo, runtimeBytes: byteLength(runtimeScript) }, null, 2),
    'utf8',
  ),
]);

console.log(`Exported Tavern character runtime: ${runtimePath}`);
console.log(`Runtime bytes: ${byteLength(runtimeScript)}`);
