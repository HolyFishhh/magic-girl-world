import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { createTavernApi, getCharacter } from './lib/tavern-api.mjs';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');

const {
  DesignAssistantController,
} = require(resolve('src/sillytavern-extension/controller.ts'));
const {
  TOWER_INITIAL_COMMIT_KEY,
  TOWER_INITIAL_PUBLICATION_KEY,
  canRestoreInitialPresentation,
  hasInitialPublication,
  readTowerInitialCommitReceipt,
  initialPublicationFor,
} = require(resolve('src/sillytavern-extension/towerInitialCommit.ts'));
const { validateRunState } = require(resolve('src/game-core/runState.ts'));
const { DESIGN_ASSISTANT_CARD_SCOPE, DESIGN_ASSISTANT_EXTENSION_ID } = require(resolve('src/sillytavern-extension/types.ts'));

function arg(name) {
  const prefix = `--${name}=`;
  const item = process.argv.slice(2).find(value => value.startsWith(prefix));
  return item ? item.slice(prefix.length) : undefined;
}

function jsonValue(value) {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return null; }
}

function withoutExtension(value) {
  return String(value).replace(/\.jsonl$/i, '');
}

function readMessageZero(file) {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/).filter(value => value.trim());
  if (lines.length < 2) throw new Error('chat metadata or message0 missing');
  const metadataLine = JSON.parse(lines[0]);
  const message = JSON.parse(lines[1]);
  const variables = message.variables ?? message.extra?.variables ?? message.data?.variables;
  const root = jsonValue(variables?.['2']);
  if (!root || typeof root !== 'object') throw new Error('variables[2] missing');
  const metadata = metadataLine.chat_metadata ?? metadataLine.chatMetadata
    ?? message.chat_metadata ?? message.chatMetadata ?? message.extra?.chat_metadata ?? {};
  return { message, root, metadata };
}

function characterChatNames(character) {
  const values = [character?.chat, character?.data?.chat, character?.data?.extensions?.chat, character?.extensions?.chat];
  return values.filter(value => typeof value === 'string').map(value => withoutExtension(value));
}

function safeBoolean(value) { return value === true; }

const snapshotPath = arg('snapshot') || resolve('tmp/v475-blocked-root-private.json');
const chatJsonl = arg('chat-jsonl') || process.env.TAVERN_CHAT_JSONL;
const baseUrl = arg('base-url') || process.env.TAVERN_BASE_URL || 'http://127.0.0.1:8012/';
const avatarUrl = arg('avatar-url') || process.env.TAVERN_AVATAR_URL;
if (!chatJsonl || !avatarUrl) throw new Error('set --chat-jsonl and --avatar-url (or TAVERN_CHAT_JSONL/TAVERN_AVATAR_URL)');

const { message, root: messageRoot, metadata: messageMetadata } = readMessageZero(resolve(chatJsonl));
const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'));
const receipt = snapshot[TOWER_INITIAL_COMMIT_KEY];
const expectedMessageId = receipt?.messageId;
assert.equal(expectedMessageId, 0, 'live receipt must bind message0');
assert.deepEqual(Object.keys(messageRoot).sort(), Object.keys(snapshot).sort(), 'message0 root shape must match supplied snapshot');

const api = await createTavernApi(baseUrl);
const character = await getCharacter(api, avatarUrl);
const selectedChatNames = characterChatNames(character);
const selectedChat = selectedChatNames.find(value => value === withoutExtension(basename(resolve(chatJsonl))));
const selectedChatConfirmed = Boolean(selectedChat);
assert.equal(selectedChatConfirmed, true, 'getCharacter chat does not match specified JSONL');

const root = structuredClone(messageRoot);
const run = root.stat_data?.run;
assert.ok(run && typeof run === 'object', 'live root run missing');
const revision = Number(run.stateRevision);
const act = Number(run.act);
assert.ok(Number.isInteger(revision) && revision >= 0, 'live revision invalid');
assert.ok(Number.isInteger(act) && act >= 1, 'live act invalid');
assert.equal(validateRunState(run).ok, true, 'live run state invalid');

const swipeId = Number(message.swipe_id ?? message.swipeId ?? 0);
const metadata = structuredClone(messageMetadata && typeof messageMetadata === 'object' ? messageMetadata : {});
// Some chat exports keep metadata on the surrounding envelope rather than message0.
if (!Object.keys(metadata).length && root[TOWER_INITIAL_PUBLICATION_KEY]) {
  metadata[TOWER_INITIAL_PUBLICATION_KEY] = structuredClone(root[TOWER_INITIAL_PUBLICATION_KEY]);
}
const context = {
  chatId: selectedChat,
  chat: [message],
  chatMetadata: metadata,
  characterId: 0,
  characters: [{ data: { extensions: { magic_girl_world: { design_assistant_scope: DESIGN_ASSISTANT_CARD_SCOPE } } } }],
  extensionSettings: { [DESIGN_ASSISTANT_EXTENSION_ID]: { enabled: false } },
  saveSettingsDebounced() {},
  saveMetadataDebounced() {},
  eventSource: { on() {}, removeListener() {} },
  eventTypes: { CHAT_CHANGED: 'chat_id_changed', MESSAGE_UPDATED: 'message_updated', GENERATE_AFTER_DATA: 'generate_after_data' },
  updateMessageBlock() { throw new Error('unexpected story replay'); },
  async saveChat() { throw new Error('unexpected chat save'); },
};
let writes = 0;
let generations = 0;
const mvu = {
  getMvuData() { return structuredClone(root); },
  async replaceMvuData() { writes++; throw new Error('unexpected MVU write'); },
};
const controller = new DesignAssistantController({
  context: () => context,
  mvu: () => mvu,
  now: () => 202609180000,
  notify() {},
}, undefined, {
  currentChatId: () => context.chatId,
  generate: async () => { generations++; throw new Error('unexpected generation'); },
  generateNarrative: async () => { generations++; throw new Error('unexpected narrative generation'); },
  createChatMessages: async () => { throw new Error('unexpected message creation'); },
  observeStructuredDelivery() { return undefined; },
  emitInternalEvent: async () => {},
  stopGenerationById() { return true; },
}, { towerCoordinator: false });

controller.activate();
let status;
try {
  assert.equal(controller.isTowerLockedScope(selectedChat, 0), true, 'controller must execute real scope');
  status = controller.getTowerInitialPublicationStatus();
} finally {
  controller.deactivate();
}

const liveReceipt = (() => {
  try {
    return readTowerInitialCommitReceipt(root, selectedChat, receipt.messageId);
  } catch { return null; }
})();
const readReceiptOk = (() => {
  try {
    const read = liveReceipt;
    return Boolean(read && read.spec === receipt.spec);
  } catch { return false; }
})();
const canRestore = (() => {
  try {
    const read = liveReceipt;
    return canRestoreInitialPresentation(root, read);
  } catch { return false; }
})();
const oldV473WouldReject = root.stat_data.run.opening.requestId !== receipt.openingRequestId;
assert.equal(readReceiptOk, true, 'actual selected chat receipt passes');
assert.equal(status.ready, true, 'actual controller publication gate releases later act');
assert.equal(canRestore, false, 'never restore first-act presentation over later progress');
assert.equal(oldV473WouldReject, true, 'original mismatch predicate reproduces live failure');
assert.equal(writes, 0);
assert.equal(generations, 0);
console.log(JSON.stringify({selectedChatConfirmed,readReceiptOk,publicationReady:status.ready,canRestore,oldV473WouldReject,writes,generations,act,revision,browserMemoryVersionConfirmed:false}));
