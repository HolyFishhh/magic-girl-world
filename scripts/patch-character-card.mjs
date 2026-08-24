import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Buffer } from 'node:buffer';
import PNGtext from 'png-chunk-text';
import encode from 'png-chunks-encode';
import extract from 'png-chunks-extract';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const inputPath = resolve(process.argv[2] || resolve(root, '魔法少女世界.png'));
const outputPath = resolve(process.argv[3] || inputPath);
const legacyOutputPath = resolve(root, 'dist/tavern/魔法少女世界-酒馆兼容版.png');
const interfacePaths = [
  resolve(root, 'dist/tavern/start-interface.json'),
  resolve(root, 'dist/tavern/common-interface.json'),
  resolve(root, 'dist/tavern/fish-interface.json'),
];
const worldbookRoot = resolve(root, 'worldbook_new');
const worldbookManifestPath = resolve(worldbookRoot, 'manifest.json');
const worldbookEntryConfigPath = resolve(worldbookRoot, 'entry-config.json');
const releaseConfigPath = resolve(root, 'release.config.json');
const characterRuntimePath = resolve(root, 'dist/tavern/character-runtime.js');
const CHARACTER_RUNTIME_ID = 'magic-girl-world-runtime';
const RETRYABLE_WRITE_CODES = new Set(['UNKNOWN', 'EBUSY', 'EPERM']);

async function writeFileWithRetry(path, data, attempts = 8, delayMs = 250) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await writeFile(path, data);
      return;
    } catch (error) {
      if (attempt === attempts || !RETRYABLE_WRITE_CODES.has(error?.code)) throw error;
      await new Promise(resolveDelay => setTimeout(resolveDelay, delayMs));
    }
  }
}

function decodeCard(chunks) {
  const textChunks = chunks
    .filter(chunk => chunk.name === 'tEXt')
    .map(chunk => PNGtext.decode(chunk.data));
  const metadata =
    textChunks.find(chunk => chunk.keyword.toLowerCase() === 'ccv3') ||
    textChunks.find(chunk => chunk.keyword.toLowerCase() === 'chara');
  if (!metadata) throw new Error(`No chara/ccv3 metadata found in ${inputPath}`);
  return JSON.parse(Buffer.from(metadata.text, 'base64').toString('utf8'));
}

function replaceCardMetadata(chunks, card) {
  const next = chunks.filter(chunk => {
    if (chunk.name !== 'tEXt') return true;
    const { keyword } = PNGtext.decode(chunk.data);
    return !['chara', 'ccv3'].includes(keyword.toLowerCase());
  });
  const json = JSON.stringify(card);
  const encoded = Buffer.from(json, 'utf8').toString('base64');
  next.splice(-1, 0, PNGtext.encode('chara', encoded));
  next.splice(-1, 0, PNGtext.encode('ccv3', encoded));
  return Buffer.from(encode(next));
}

const [image, interfaceTexts, worldbookManifestText, worldbookEntryConfigText, releaseConfigText, characterRuntime] = await Promise.all([
  readFile(inputPath),
  Promise.all(interfacePaths.map(path => readFile(path, 'utf8'))),
  readFile(worldbookManifestPath, 'utf8'),
  readFile(worldbookEntryConfigPath, 'utf8'),
  readFile(releaseConfigPath, 'utf8'),
  readFile(characterRuntimePath, 'utf8'),
]);
const releaseConfig = JSON.parse(releaseConfigText);
const CARD_VERSION = releaseConfig.cardVersion;
const CHARACTER_NAME = releaseConfig.characterName || `${releaseConfig.worldbookPrefix} ${CARD_VERSION}`;
const WORLDBOOK_NAME = `${releaseConfig.worldbookPrefix}${CARD_VERSION}`;
const MVU_URL = `https://testingcf.jsdelivr.net/gh/MagicalAstrogy/MagVarUpdate@${releaseConfig.mvuVersion}/artifact/bundle.js`;
const MVU_IMPORT = `(async()=>{const n=${JSON.stringify(WORLDBOOK_NAME)},u=${JSON.stringify(MVU_URL)},k='__MAGIC_GIRL_WORLD_MVU_LOADER__';if(globalThis[k]?.promise)return globalThis[k].promise;const s={status:'waiting',worldbook:n,lastError:''};const p=(async()=>{for(;;){try{if(typeof getLorebookEntries!=='function'){s.status='waiting';}else{await getLorebookEntries(n);s.status='loading';await import(u);s.status='ready';return true}}catch(e){s.status='waiting';s.lastError=String(e?.message||e)}await new Promise(r=>setTimeout(r,250))}})();globalThis[k]={promise:p,state:s};return p})()`;
const chunks = extract(new Uint8Array(image));
const card = decodeCard(chunks);
const interfacePayloads = interfaceTexts.map(JSON.parse);
const extensions = card.data?.extensions;
if (!extensions) throw new Error('Character card has no data.extensions object');

const worldbookEntries = card.data?.character_book?.entries;
if (!Array.isArray(worldbookEntries)) throw new Error('Character card has no embedded character-book entries');
card.data.character_book.name = WORLDBOOK_NAME;
// SillyTavern uses extensions.world for the character's linked world-book.
// Keep it synchronized with the embedded book name or a new card can reopen an old schema.
extensions.world = WORLDBOOK_NAME;
const worldbookManifest = JSON.parse(worldbookManifestText);
const worldbookEntryConfig = JSON.parse(worldbookEntryConfigText);
const nextWorldbookEntryId = () =>
  worldbookEntries.reduce((maximum, entry) => Math.max(maximum, Number(entry.id) || 0), -1) + 1;
const canonicalWorldbookComment = value =>
  String(value || '').replace(/\[mvu_(?:plot|update)\]/gi, '').trim();
const createWorldbookEntry = entryName => {
  const template = worldbookEntries.find(entry => (entry.name || entry.comment) === '战斗场景生成') || worldbookEntries[0];
  const entry = structuredClone(template || {});
  entry.id = nextWorldbookEntryId();
  delete entry.name;
  entry.comment = entryName;
  entry.content = '';
  entry.keys = [];
  entry.secondary_keys = [];
  entry.constant = false;
  entry.selective = true;
  entry.enabled = true;
  entry.position = entry.position || 'after_char';
  entry.use_regex = false;
  entry.extensions ||= {};
  entry.extensions.display_index = entry.id;
  return entry;
};
for (const [entryName, sourceName] of Object.entries(worldbookManifest)) {
  const config = worldbookEntryConfig[entryName] || {};
  const expectedComment = typeof config.comment === 'string' ? config.comment : entryName;
  let matches = worldbookEntries.filter(entry => {
    const comment = entry.name || entry.comment;
    return comment === expectedComment || canonicalWorldbookComment(comment) === canonicalWorldbookComment(entryName);
  });
  if (matches.length === 0 && config.create === true) {
    const entry = createWorldbookEntry(entryName);
    worldbookEntries.push(entry);
    matches = [entry];
  }
  if (matches.length !== 1) {
    throw new Error(`Expected one world-book entry named ${entryName}, found ${matches.length}`);
  }
  const entry = matches[0];
  entry.comment = expectedComment;
  delete entry.name;
  entry.content = await readFile(resolve(worldbookRoot, sourceName), 'utf8');
  for (const field of ['constant', 'keys', 'secondary_keys', 'enabled', 'selective', 'use_regex']) {
    if (Object.hasOwn(config, field)) entry[field] = structuredClone(config[field]);
  }
}

for (const payload of interfacePayloads) {
  const matches = (extensions.regex_scripts || []).filter(script => script.scriptName === payload.scriptName);
  if (matches.length !== 1) {
    throw new Error(`Expected one embedded ${payload.scriptName} regex, found ${matches.length}`);
  }
  const existingId = matches[0].id;
  Object.assign(matches[0], payload);
  if (existingId) matches[0].id = existingId;
}

function convertLegacyScript(entry) {
  const value = entry?.value || {};
  return {
    type: entry?.type || 'script',
    enabled: value.enabled !== false,
    name: value.name || '',
    id: value.id,
    content: value.content || '',
    info: value.info || '',
    button: {
      enabled: Array.isArray(value.buttons) && value.buttons.length > 0,
      buttons: Array.isArray(value.buttons) ? value.buttons : [],
    },
    data: value.data || {},
    export_with: { data: true, button: true },
  };
}

if (!extensions.tavern_helper) {
  extensions.tavern_helper = {
    scripts: (extensions.TavernHelper_scripts || []).map(convertLegacyScript),
    variables: { ...(extensions.TavernHelper_characterScriptVariables || {}) },
  };
}
delete extensions.TavernHelper_scripts;
delete extensions.TavernHelper_characterScriptVariables;

extensions.tavern_helper.scripts ||= [];
extensions.tavern_helper.variables ||= {};

const characterRuntimeMatches = extensions.tavern_helper.scripts.filter(
  entry => entry?.type === 'script' && (entry.id === CHARACTER_RUNTIME_ID || entry.name === '魔法少女世界运行时'),
);
if (characterRuntimeMatches.length > 1) {
  throw new Error(`Expected at most one embedded Magic Girl World runtime, found ${characterRuntimeMatches.length}`);
}
const characterRuntimeEntry = characterRuntimeMatches[0] || {
  type: 'script',
  id: CHARACTER_RUNTIME_ID,
  name: '魔法少女世界运行时',
};
Object.assign(characterRuntimeEntry, {
  type: 'script',
  id: CHARACTER_RUNTIME_ID,
  name: '魔法少女世界运行时',
  enabled: true,
  content: characterRuntime,
  info: '为状态栏与战斗楼层提供版本化界面资源；由角色卡自动维护。',
  button: { enabled: false, buttons: [] },
  data: {
    ...(characterRuntimeEntry.data || {}),
    构建信息: `Magic Girl World ${CARD_VERSION}`,
  },
  export_with: { data: true, button: true },
});
if (!characterRuntimeMatches[0]) extensions.tavern_helper.scripts.push(characterRuntimeEntry);

const mvuScripts = extensions.tavern_helper.scripts.filter(
  entry => entry?.type === 'script' && entry.content?.includes('MagicalAstrogy/MagVarUpdate'),
);
if (mvuScripts.length !== 1) {
  throw new Error(`Expected one embedded MagVarUpdate script, found ${mvuScripts.length}`);
}
mvuScripts[0].name = 'MVU变量框架';
mvuScripts[0].content = MVU_IMPORT;
mvuScripts[0].enabled = true;
mvuScripts[0].data = {
  ...(mvuScripts[0].data || {}),
  构建信息: `MagVarUpdate ${releaseConfig.mvuVersion} (pinned)`,
};
delete extensions.tavern_helper.variables.battle_result;
card.data.character_version = CARD_VERSION;
card.name = CHARACTER_NAME;
card.data.name = CHARACTER_NAME;
card.spec = 'chara_card_v3';
card.spec_version = '3.0';

await mkdir(dirname(outputPath), { recursive: true });
await writeFileWithRetry(outputPath, replaceCardMetadata(chunks, card));
if (legacyOutputPath !== outputPath) {
  await unlink(legacyOutputPath).catch(error => {
    if (error?.code !== 'ENOENT') throw error;
  });
}
console.log(`Patched character card: ${outputPath}`);
