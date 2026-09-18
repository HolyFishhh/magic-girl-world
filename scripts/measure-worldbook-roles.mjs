import { estimateWorldbookScenario } from './lib/worldbook-measurement.mjs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { encode } from 'gpt-tokenizer/encoding/o200k_base';

const root = resolve('worldbook_new');
const manifest = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8'));
const entryConfig = JSON.parse(await readFile(resolve(root, 'entry-config.json'), 'utf8'));
const rows = [];

for (const [name, file] of Object.entries(manifest)) {
  if (name === '[config_override]' || name.includes('initvar')) continue;
  const content = await readFile(resolve(root, file), 'utf8');
  const comment = String(entryConfig[name]?.comment || '');
  const role = comment.includes('[mvu_update]') ? 'update' : comment.includes('[mvu_plot]') ? 'plot' : 'other';
  rows.push({ name, role, tokens: encode(content).length, characters: content.length });
}


const scenarios = {
  update_base: [],
  update_first_turn: ['首条消息变量更新', '战斗内容生成要求', '变量数据结构', '流派体系与设计方法'],
  update_battle_registration: ['战斗内容生成要求', '战斗场景生成', '变量数据结构', '流派体系与设计方法'],
  update_battle_settlement: ['战斗内容生成要求', '变量数据结构', '战斗结算生成', '流派体系与设计方法'],
  update_content_growth: ['战斗内容生成要求', '变量数据结构', '流派体系与设计方法'],
  update_battle_scene_repair: ['战斗内容生成要求', '战斗场景生成', '变量数据结构', '战斗场景修复', '流派体系与设计方法'],
};
console.log('Source estimates using o200k_base, NOT selected-provider token counts or live Tavern activation. Macros are unexpanded; entry names are deduplicated.');
console.table(rows);
console.table(Object.entries(scenarios).map(([scenario,names]) => {
  const selected=estimateWorldbookScenario(rows,entryConfig,names);
  return {scenario,tokens:selected.reduce((sum,row)=>sum+row.tokens,0),entries:selected.length};
}));
