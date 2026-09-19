import { readGameMode } from '../game-core/towerMode';
import { flattenMvuArray } from '../runtime/mvuArrays';
import { escapeHtml } from '../fish/shared/html';

/** Read-only story facts, separate from executable battle items/statuses. */
export function renderStoryCharacterStatus(stat: Record<string, any>): string {
  if (readGameMode(stat) !== 'story') return '';
  const status = stat.status || {};
  const text = (value: any): string => typeof value === 'string' || typeof value === 'number'
    ? String(value) : value && typeof value === 'object'
      ? [value.name, value.description].filter(Boolean).join('：') : '';
  const row = (label: string, value: any) => `<p><strong>${escapeHtml(label)}</strong> ${escapeHtml(text(value) || '暂无')}</p>`;
  const values = (value: unknown) => flattenMvuArray(value).map(text).filter(Boolean).join('；');
  const clothing = { head: '头部', neck: '颈部', hands: '手部', upper_body: '上衣', lower_body: '下装', underwear: '内衣', legs: '腿部', feet: '足部' };
  const npcs = Object.entries(stat.npcs || {}).filter(([id, npc]) => id !== '$meta' && npc && typeof npc === 'object' && !Array.isArray(npc));
  return `<section class="character-story-facts" aria-label="剧情状态"><h3>剧情状态</h3>
    ${row('时间', status.time)}${row('地点', status.location)}${row('职业能力', status.profession?.ability)}
    ${row('等级', stat.battle?.level)}${row('经验', stat.battle?.exp)}
    <h4>衣物</h4><div class="character-story-grid">${Object.entries(clothing).map(([key, label]) => row(label, status.clothing?.[key])).join('')}</div>
    <h4>剧情背包</h4>${row('携带物品', values(status.inventory))}
    ${row('永久状态', values(status.permanent_status))}${row('临时状态', values(status.temporary_status))}
    <h4>势力与关系</h4>${row('立场', stat.factions?.player_alignment)}${row('入侵', stat.factions?.invasion)}${flattenMvuArray<any>(stat.factions?.relations, { objectsOnly: true }).map(faction => row(faction.name || '势力', `声望 ${faction.reputation ?? 0} · ${faction.status || '未知'} · ${faction.note || ''}`)).join('')}
    <h4>NPC 好感与人物记录</h4>${npcs.map(([id, value]) => {
      const npc = value as Record<string, any>;
      return `<details data-detail-key="story-npc:${escapeHtml(id)}"><summary>${escapeHtml(npc.name || id)} · 好感 ${escapeHtml(npc.affection ?? 0)} ${escapeHtml(npc.affection_level || '')}</summary>
        ${row('追踪状态', npc.tracking ? '追踪中' : '未追踪')}${row('当前行动', npc.current_action)}${row('阵营', npc.alignment)}${row('关系', npc.relationship)}${row('其他人物关系', npc.other_npc_relations)}${row('等级', npc.level)}${row('外貌', npc.appearance)}${row('能力', npc.abilities)}${row('战斗风格', npc.battle_style)}</details>`;
    }).join('') || '<p>暂无人物记录</p>'}</section>`;
}
