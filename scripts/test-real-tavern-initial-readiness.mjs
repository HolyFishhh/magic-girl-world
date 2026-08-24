import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createInitializedMvuLayer,
  createTavernApi,
  getCharacter,
  saveAndActivateCharacterChat,
} from './lib/tavern-api.mjs';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const core = require(resolve(root, 'src/game-core/index.ts'));
const { createContentPackFromMvuBattle } = require(resolve(root, 'src/runtime/contentPackAdapter.ts'));
const releaseConfig = JSON.parse(await readFile(resolve(root, 'release.config.json'), 'utf8'));
const [scenario = 'invalid', avatarUrl = '魔法少女世界155.png'] = process.argv.slice(2);
const tavernUrl = new URL(process.env.TAVERN_URL || releaseConfig.defaultTavernUrl);

if (!['invalid', 'valid'].includes(scenario)) {
  throw new Error('Scenario must be invalid or valid');
}
if (!avatarUrl.endsWith('.png')) {
  throw new Error('Usage: node scripts/test-real-tavern-initial-readiness.mjs <invalid|valid> <avatar.png>');
}

function baseBattle() {
  return {
    core: { hp: 80, max_hp: 80, lust: 0, max_lust: 100, card_removal_count: 1 },
    cards: [],
    artifacts: [],
    items: [],
    statuses: [],
    player_abilities: [],
    player_status_effects: [],
    level: 1,
    exp: 0,
    enemy: {
      name: '',
      emoji: '',
      max_hp: 0,
      hp: 0,
      max_lust: 100,
      lust: 0,
      description: '',
      actions: [],
      abilities: [],
      status_effects: [],
      lust_effect: { name: '', description: '' },
      action_mode: '',
      action_config: {},
    },
    player_lust_effect: { name: '', description: '' },
  };
}

function createBattle(scenarioName) {
  const battle = baseBattle();
  if (scenarioName === 'invalid') {
    battle.cards = [
      { id: 'same', name: '昂贵攻击', type: 'Attack', rarity: 'Common', cost: 4, quantity: 2, effects: { damage: 7 } },
      {
        id: 'same',
        name: '错误关键词',
        type: 'Skill',
        rarity: 'Common',
        cost: 4,
        quantity: 1,
        effects: { draw: 1 },
        innate: 'true',
      },
    ];
    battle.artifacts = [{ id: 'root', name: '生命之根', rarity: 'Common', effects: { block: 2 } }];
    return battle;
  }

  battle.cards = [
    { id: 'strike', name: '星辉斩击', type: 'Attack', rarity: 'Common', cost: 1, quantity: 5, effects: { damage: 7 } },
    { id: 'guard', name: '月幕防御', type: 'Skill', rarity: 'Common', cost: 1, quantity: 5, effects: { block: 6 } },
  ];
  battle.artifacts = [
    { id: 'life_stone', name: '生命之石', rarity: 'Common', trigger: 'battle_start', effects: { block: 2 } },
  ];
  battle.items = [{ id: 'starlight_tonic', name: '星光药剂', count: 1, effects: { heal: 8 } }];
  battle.player_lust_effect = { name: '星蚀满溢', description: '释放积蓄的魔力。', effects: { damage: 6 } };
  return battle;
}

function createStatData(battle) {
  return {
    status: {
      time: '回归测试',
      location: '隔离测试场',
      profession: { name: '契约测试员', ability: '验证初始战斗内容' },
      permanent_status: [],
      temporary_status: [],
      clothing: { head: '', neck: '', hands: '', upper_body: '', lower_body: '', underwear: '', legs: '', feet: '' },
      inventory: [],
    },
    battle,
    factions: { player_alignment: '绝对中立', invasion: 0, relations: [] },
    npcs: {},
    reward: { card: [], artifact: [], item: [], limits: {} },
    run: null,
    run_result: null,
    run_upgrade: null,
  };
}

function readinessFor(battle) {
  return core.assessInitialPlayerContent(createContentPackFromMvuBattle(battle), {
    hp: battle.core.hp,
    maxHp: battle.core.max_hp,
    lust: battle.core.lust,
    maxLust: battle.core.max_lust,
    level: battle.level,
    exp: battle.exp,
  });
}

const battle = createBattle(scenario);
const readiness = readinessFor(battle);
if ((scenario === 'valid') !== readiness.ok) {
  throw new Error(`Readiness fixture drifted: ${core.formatPlayerContentReadiness(readiness)}`);
}

const api = await createTavernApi(tavernUrl);
const character = await getCharacter(api, avatarUrl);
const characterName = character?.name || character?.data?.name;
if (!characterName) throw new Error(`Character ${avatarUrl} has no name`);

const now = new Date();
const timestamp = now
  .toISOString()
  .replaceAll(':', '-')
  .replace(/\.\d{3}Z$/, 'Z');
const chatFile = `readiness-${scenario}-${timestamp}`;
const statData = createStatData(battle);
const worldbookName = `${releaseConfig.worldbookPrefix}${releaseConfig.cardVersion}`;
const variables = createInitializedMvuLayer(statData, worldbookName);
const message = {
  name: characterName,
  is_user: false,
  is_system: false,
  send_date: now.toISOString(),
  mes: `真实酒馆初始内容回归：${scenario === 'valid' ? '合法快照' : '无效快照'}。\n<StatusPlaceHolderImpl/>`,
  extra: {},
  variables: [variables],
};
const chat = [
  {
    chat_metadata: { integrity: randomUUID(), variables: {}, tainted: true },
    user_name: 'unused',
    character_name: 'unused',
  },
  message,
];

await saveAndActivateCharacterChat(api, {
  characterName,
  avatarUrl,
  chatFile,
  chat,
});

console.log(
  JSON.stringify(
    {
      scenario,
      avatarUrl,
      chatFile,
      readiness: {
        ok: readiness.ok,
        summary: core.formatPlayerContentReadiness(readiness),
        repairPrompt: core.formatPlayerContentRepairPrompt(readiness),
      },
      expectedUi:
        scenario === 'valid'
          ? {
              routeVisibleBeforeOptIn: false,
              startRunButtons: 0,
              repairButtons: 0,
              customActionVisible: true,
            }
          : { routeVisibleBeforeOptIn: false, startRunButtons: 0, repairButtons: 1 },
    },
    null,
    2,
  ),
);
