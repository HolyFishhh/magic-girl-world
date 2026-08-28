import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import ts from 'typescript';

const sourcePath = 'src/runtime/mvuUpdateDisplay.ts';
const source = await readFile(sourcePath, 'utf8');
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: sourcePath,
}).outputText;
const display = await import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);

const update = `<UpdateVariable>
<Analysis>Update.</Analysis>
_.set('status.time', '2027年02月21日 09:30');
_.set('status.location', '起始之镇冒险者公会');
_.set('status.profession', {"name":"资源亲和者","ability":"汲取与储存环境中的资源。"});
_.set('status.outfit', {"upper_body":"白色制服上衣","lower_body":"深蓝色百褶短裙"});
_.set('status.inventory', ["古旧羊皮纸卷轴"]);
_.set('battle.core', {"emoji":"✨","hp":100,"max_hp":100,"lust":0,"max_lust":100,"card_removal_count":1});
_.set('battle.cards', [{"id":"resource_draw","name":"资源汲取","type":"Skill","rarity":"Common","cost":0,"quantity":3,"description":"允许括号与分号 ); 留在描述中。","effects":{"energy":1}},{"id":"energy_blast","name":"能量冲击","type":"Attack","rarity":"Common","cost":1,"quantity":3,"effects":{"damage":7}}]);
_.set('battle.artifacts', [{"id":"resource_sigil","name":"资源亲和徽记","trigger":{"on":"battle_start","effects":{"energy":1}}}]);
_.set('battle.items', [{"id":"recovery_potion","name":"基础恢复药剂","count":2,"effects":{"heal":8}}]);
_.set('battle.player_lust_effect', {"name":"欲望汲取","effects":{"energy":1,"heal":4}});
_.set('reward.request', {"kind":"internal"});
</UpdateVariable>`;

const commands = display.parseMvuUpdateCommands(update);
assert.equal(commands.length, 10, 'every player-visible update command must survive parsing');
assert.deepEqual(
  commands.map(command => command.label),
  ['当前时间', '当前地点', '职业', '服装', '剧情物品', '玩家核心', '卡牌', '遗物', '战斗道具', '玩家欲望效果'],
);
assert.equal(
  commands.find(command => command.path === 'battle.cards').value[0].description,
  '允许括号与分号 ); 留在描述中。',
);
assert.equal(
  commands.some(command => command.path === 'reward.request'),
  false,
  'internal settlement requests stay hidden',
);

const sections = display.groupMvuUpdateCommands(commands);
assert.deepEqual(
  sections.map(section => [section.id, section.commands.length]),
  [
    ['character', 5],
    ['battle-core', 1],
    ['cards', 1],
    ['artifacts', 1],
    ['items', 1],
    ['combat', 1],
  ],
);

const incremental = display.parseMvuUpdateCommands(`<UpdateVariable>
_.set('battle.exp', 5, 0);
_.assign('npcs', 'melia', {"id":"melia","name":"梅莉亚"});
_.remove('status.inventory', '旧钥匙');
</UpdateVariable>`);
assert.equal(incremental[0].oldValue, 5);
assert.equal(incremental[0].value, 0);
assert.equal(incremental[1].itemKey, 'melia');
assert.equal(incremental[1].value.name, '梅莉亚');
assert.equal(incremental[2].operation, 'remove');

const updateHtml = await readFile('src/common/update/index.html', 'utf8');
assert.match(updateHtml, /<details class="update-sheet"/);
assert.doesNotMatch(
  updateHtml,
  /<details class="update-sheet"[^>]*\sopen(?:\s|>)/,
  'update details stay collapsed by default',
);
assert.match(updateHtml, /<summary class="update-header">/);

console.log('UpdateVariable commands are rendered as complete grouped player-facing data.');
