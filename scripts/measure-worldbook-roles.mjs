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

const total = role => rows.filter(row => row.role === role).reduce((sum, row) => sum + row.tokens, 0);
const updateBase = rows
  .filter(row => row.role === 'update' && entryConfig[row.name]?.constant === true)
  .reduce((sum, row) => sum + row.tokens, 0);
const byName = new Map(rows.map(row => [row.name, row.tokens]));

console.table(rows);
console.table([
  { scenario: 'plot_all', tokens: total('plot') },
  { scenario: 'update_base', tokens: updateBase },
  {
    scenario: 'update_first_turn',
    tokens:
      updateBase +
      (byName.get('首条消息变量更新') || 0) +
      (byName.get('战斗内容生成要求') || 0) +
      (byName.get('变量数据结构') || 0),
  },
  {
    scenario: 'update_battle_registration',
    tokens:
      updateBase +
      (byName.get('战斗内容生成要求') || 0) +
      (byName.get('战斗场景生成') || 0) +
      (byName.get('变量数据结构') || 0),
  },
  {
    scenario: 'update_battle_settlement',
    tokens:
      updateBase +
      (byName.get('战斗内容生成要求') || 0) +
      (byName.get('变量数据结构') || 0) +
      (byName.get('战斗结算生成') || 0),
  },
  {
    scenario: 'update_content_growth',
    tokens:
      updateBase +
      (byName.get('战斗内容生成要求') || 0) +
      (byName.get('变量数据结构') || 0),
  },
  {
    scenario: 'update_battle_scene_repair',
    tokens:
      updateBase +
      (byName.get('战斗内容生成要求') || 0) +
      (byName.get('战斗场景生成') || 0) +
      (byName.get('变量数据结构') || 0) +
      (byName.get('战斗场景修复') || 0),
  },
]);
