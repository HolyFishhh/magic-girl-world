import { createTavernApi, getCharacter, getChat, getSettings } from './lib/tavern-api.mjs';

const watch = process.argv.includes('--watch');
const intervalArgument = process.argv.find(value => value.startsWith('--interval='));
const avatarArgument = process.argv.find(value => value.startsWith('--avatar='));
const chatArgument = process.argv.find(value => value.startsWith('--chat='));
// The Tavern chat endpoint is comparatively expensive. Fast polling can starve
// the same save queue that persists the running battle, so keep watch mode at a
// human-facing cadence and resolve the active chat only once per invocation.
const interval = Math.max(1500, Number(intervalArgument?.split('=')[1] || 2000));
const requestedAvatar = avatarArgument?.slice('--avatar='.length) || '';
const requestedChat = chatArgument?.slice('--chat='.length) || '';
const api = await createTavernApi(process.env.TAVERN_URL || 'http://127.0.0.1:8012/');
let lastSignature = '';
let identity = null;

function readVariables(message) {
  if (!message) return null;
  if (!Array.isArray(message.variables)) return message.variables || null;
  return message.variables[message.swipe_id || 0] || message.variables.at(-1) || null;
}

function summarizeProgram(program) {
  return (program?.steps || []).map(step => ({
    op: step.op,
    ...(step.amount !== undefined ? { amount: step.amount } : {}),
    ...(step.value !== undefined ? { value: step.value } : {}),
    ...(step.stat !== undefined ? { stat: step.stat } : {}),
    ...(step.operator !== undefined ? { operator: step.operator } : {}),
  }));
}

function summarizeActor(actor) {
  return {
    id: actor.id,
    name: actor.name,
    hp: actor.currentHp,
    maxHp: actor.maxHp,
    lust: actor.currentLust,
    maxLust: actor.maxLust,
    block: actor.block || 0,
    energy: actor.energy,
    statuses: (actor.statusEffects || []).map(status => `${status.name || status.id}:${status.stacks || 0}`),
  };
}

function summarizeSummon(unit) {
  return {
    id: unit.instanceId || unit.id,
    name: unit.name,
    hasHp: unit.hasHp !== false,
    hp: unit.currentHp,
    maxHp: unit.maxHp,
    block: unit.block || 0,
    statuses: (unit.statusEffects || []).map(status => `${status.name || status.id}:${status.stacks || 0}`),
    resources: Object.fromEntries(
      Object.entries(unit.resources || {}).map(([id, resource]) => [id, `${resource.current}/${resource.max}`]),
    ),
    actions: (unit.actions || []).map(action => ({
      name: action.name,
      fixed: action.fixed === true,
      effects: summarizeProgram(action.effectProgram),
    })),
    abilities: (unit.abilities || []).map(ability => ({
      name: ability.name,
      trigger: ability.trigger,
      effects: summarizeProgram(ability.effectProgram),
    })),
  };
}

function summarizeEvent(event) {
  return {
    sequence: event.sequence,
    type: event.type,
    phase: event.phase,
    actorId: event.actorId,
    targetIds: event.targetIds,
    source: event.source?.name || event.source?.id,
    payload: event.payload,
  };
}

async function readSnapshot() {
  if (!identity) {
    const settings = requestedAvatar ? null : await getSettings(api);
    const avatar = requestedAvatar || settings.active_character;
    const character = requestedChat ? null : await getCharacter(api, avatar);
    const chatFile = requestedChat || character.chat || character.data?.chat;
    identity = { avatar, chatFile };
  }
  const { avatar, chatFile } = identity;
  const chat = await getChat(api, avatar, chatFile);
  const message = chat.at(-1);
  const variables = readVariables(message);
  const session = variables?.__magic_girl_world?.battle_session;
  const state = session?.state;
  if (!session || !state) {
    return { avatar, chatFile, available: false, messageCount: chat.length };
  }

  return {
    avatar,
    chatFile,
    available: true,
    savedAt: session.savedAt,
    phase: state.phase,
    turn: state.currentTurn,
    result: state.battleResult || null,
    player: {
      ...summarizeActor(state.player),
      hand: (state.player.hand || []).map(card => ({ id: card.id, name: card.name })),
      draw: state.player.drawPile?.length || 0,
      discard: state.player.discardPile?.length || 0,
      exhaust: state.player.exhaustPile?.length || 0,
    },
    activeEnemyId: state.activeEnemyId,
    enemies: (state.enemies || []).map(summarizeActor),
    defeatedEnemies: (state.defeatedEnemies || []).map(summarizeActor),
    summons: {
      living: (state.summons?.living || []).map(summarizeSummon),
      defeated: (state.summons?.defeated || []).map(summarizeSummon),
      nextSequence: state.summons?.nextSequence,
    },
    scheduledEffects: state.effectScheduler?.queue?.length || 0,
    eventTail: (state.eventJournal?.events || []).slice(-12).map(summarizeEvent),
  };
}

async function printIfChanged() {
  const snapshot = await readSnapshot();
  const signature = JSON.stringify(snapshot);
  if (signature === lastSignature) return;
  lastSignature = signature;
  console.log(JSON.stringify(snapshot));
}

await printIfChanged();
if (watch) {
  const timer = setInterval(() => {
    void printIfChanged().catch(error => console.error(JSON.stringify({ error: error.message })));
  }, interval);
  process.once('SIGINT', () => {
    clearInterval(timer);
    process.exit(0);
  });
  process.once('SIGTERM', () => {
    clearInterval(timer);
    process.exit(0);
  });
}
