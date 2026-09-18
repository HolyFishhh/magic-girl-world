import { escapeHtml } from '../fish/shared/html';
import { compileCompactEffectList } from '../game-core/compactEffectDsl';
import { describeCompactEffectList } from '../game-core/contentDescription';
import { effectProgramToDisplayTags, triggeredEffectProgramToDisplayTags } from '../game-core/effectDisplay';
import { describeSummonSlotLifecycle } from '../game-core/summonLifecycleDescription';
import { describeTriggerEventQuery } from '../game-core/triggerDescription';
import { resolveTriggerInput } from '../game-core/triggerInput';

const TRIGGER_NAMES: Readonly<Record<string, string>> = {
  passive: '持续生效', battle_start: '战斗开始', turn_start: '回合开始', turn_end: '回合结束',
  card_played: '打出卡牌', take_damage: '受到伤害', deal_damage: '造成伤害',
  kill: '击败敌人', defeated: '被击败', gain_buff: '被赋予增益', gain_debuff: '被赋予减益',
};

const MODIFIER_NAMES: Readonly<Record<string, string>> = {
  damage_modifier: '造成伤害', damage_taken_modifier: '受到伤害',
  lust_damage_modifier: '造成欲望伤害', lust_damage_taken_modifier: '受到欲望伤害',
  heal_modifier: '治疗量', block_modifier: '格挡获取量',
};

function records(value: unknown): Record<string, any>[] {
  if (Array.isArray(value)) return value.filter(item => item && typeof item === 'object' && !Array.isArray(item));
  if (value && typeof value === 'object') return Object.values(value).filter(item => item && typeof item === 'object' && !Array.isArray(item)) as Record<string, any>[];
  return [];
}

function valueText(value: unknown, fallback = '—'): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : fallback;
}

function programRules(entry: Record<string, any>, ability: boolean, resourceNames: Record<string, string> = {}, summonerResourceNames: Record<string, string> = resourceNames, resourceEmojis: Record<string, string> = {}, summonerResourceEmojis: Record<string, string> = resourceEmojis): string {
  const resolved = resolveTriggerInput(entry);
  const compiled = entry.effectProgram ? null : compileCompactEffectList(entry.effects ?? entry.triggered_effects ?? resolved.triggeredEffects ?? entry.action ?? [], { creates: entry.creates });
  const effectProgram = entry.effectProgram || (compiled?.ok ? compiled.value : null);
  if (effectProgram && typeof effectProgram === 'object' && Array.isArray(effectProgram.steps)) {
    const tags = ability
      ? triggeredEffectProgramToDisplayTags(String(resolved.trigger || entry.trigger || ''), effectProgram, { collapseSummons: true, resourceNames, summonerResourceNames, resourceEmojis, summonerResourceEmojis }, resolved.eventQuery ?? entry.eventQuery)
      : effectProgramToDisplayTags(effectProgram, { collapseSummons: true, resourceNames, summonerResourceNames, resourceEmojis, summonerResourceEmojis });
    if (tags.length) return tags.map(tag => `${tag.icon} ${tag.text}`).join('\n');
  }
  const compact = describeCompactEffectList(entry.effects ?? entry.triggered_effects ?? resolved.triggeredEffects ?? entry.action ?? [], entry.creates, { resourceNames });
  if (!compact) return '没有可执行效果';
  if (!ability) return compact;
  const trigger = String(resolved.trigger || entry.trigger || '未知时机');
  return `${TRIGGER_NAMES[trigger] || trigger}${describeTriggerEventQuery(resolved.eventQuery ?? entry.eventQuery)}时，${compact}`;
}

function renderProgram(unit: Record<string, any>, entry: Record<string, any>, ability: boolean): string {
  const e = (value: unknown) => escapeHtml(valueText(value, ''));
  const title = valueText(entry.name || entry.id, ability ? '触发能力' : '自动行动');
  const resolved = resolveTriggerInput(entry);
  const trigger = String(resolved.trigger || '');
  const flags = [
    entry.fixed ? '<small>固定效果</small>' : '',
    typeof entry.weight === 'number' ? `<small>权重 ${e(entry.weight)}</small>` : '',
    ability && trigger ? `<small>${e(TRIGGER_NAMES[trigger] || trigger)}${e(describeTriggerEventQuery(resolved.eventQuery ?? entry.eventQuery))}</small>` : '',
  ].filter(Boolean).join('');
  return `<section class="summon-detail-program${ability ? ' summon-detail-ability' : ''}"><div class="summon-detail-program-title"><span>${e(entry.emoji || (ability ? '⚡' : unit.emoji) || '◆')}</span><strong>${e(title)}</strong>${flags}</div>${entry.description ? `<p class="content-flavor">${e(entry.description)}</p>` : ''}<div class="summon-program-rules">${programRules(entry, ability, unit.displayResourceNames, unit.displaySummonerResourceNames, unit.displayResourceEmojis, unit.displaySummonerResourceEmojis).split('\n').map(rule => `<div>${e(rule)}</div>`).join('')}</div></section>`;
}

/** Shared by compact summon templates in cards and living summons in the battle stage. */
export function renderSummonPanel(unit: Record<string, any>): string {
  const summonerNames = unit.displaySummonerResourceNames || unit.displayResourceNames || {};
  const summonerEmojis = unit.displaySummonerResourceEmojis || unit.displayResourceEmojis || {};
  const localEmojis = Object.fromEntries(Object.entries(unit.resources || {}).map(([key, resource]: [string, any]) => [resource.id || key, resource.emoji || '◆']));
  const localNames = Object.fromEntries(Object.entries(unit.resources || {}).map(([key, resource]: [string, any]) => [resource.id || key, resource.name || resource.id || key]));
  unit = { ...unit, displaySummonerResourceEmojis: summonerEmojis, displayResourceEmojis: { ...summonerEmojis, ...unit.displayResourceEmojis, ...localEmojis }, displaySummonerResourceNames: summonerNames, displayResourceNames: { ...summonerNames, ...unit.displayResourceNames, ...localNames } };
  const e = (value: unknown) => escapeHtml(valueText(value, ''));
  const hasHp = unit.hasHp ?? unit.has_hp;
  const living = hasHp !== false;
  const maxHp = unit.maxHp ?? unit.max_hp;
  const currentHp = unit.currentHp ?? unit.current_hp ?? maxHp;
  const stats = [
    unit.slot ? '唯一召唤物 · 同一召唤者限一只' : '非唯一召唤物 · 可同时存在多只',
    living ? `生命 ${valueText(currentHp)}/${valueText(maxHp)}` : '无生命单位',
    unit.block ? `格挡 ${valueText(unit.block)}` : '',
    `每次激活行动 ${valueText(unit.actionsPerActivation ?? unit.actions_per_activation ?? 1)} 次`,
    unit.speed !== undefined ? `速度 ${valueText(unit.speed)}` : '',
    unit.actionPriority ?? unit.action_priority ? `行动优先级 ${valueText(unit.actionPriority ?? unit.action_priority)}` : '',
  ].filter(Boolean);
  const capabilities = [
    unit.intercept ? `援护未格挡攻击${unit.intercept.maxPerTurn ? `（每回合至多${valueText(unit.intercept.maxPerTurn)}次）` : ''}` : '',
    unit.capabilities?.selectable === false ? '不可被选择' : '',
    unit.capabilities?.acceptsStatus === false ? '不接受状态' : '',
    unit.capabilities?.acts === false ? '不会自主行动' : '',
    unit.capabilities?.intercepts === false || !living ? '不能援护' : '',
  ].filter(Boolean);
  const actionProgram = unit.actionProgram || unit.action_program;
  const actions = records(unit.actions);
  if (!actions.length && actionProgram) actions.push({ id: 'default_action', name: '自动行动', effectProgram: actionProgram });
  if (!actions.length && unit.action) actions.push({ id: 'default_action', name: '自动行动', effects: unit.action });
  const abilities = records(unit.abilities);
  const resources = records(unit.resources);
  const statuses = records(unit.statusEffects ?? unit.statuses);
  const modifiers = Object.entries(unit.modifiers || {}).filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1]));
  const lifecycle = unit.slot ? describeSummonSlotLifecycle({
    slot: String(unit.slot), hasHp: living, maxHp: typeof maxHp === 'number' ? maxHp : undefined,
    onExisting: unit.onExisting ?? unit.on_existing, onDefeated: unit.onDefeated ?? unit.on_defeated,
    customRepeat: !!(unit.onExistingProgram || unit.on_existing_effects),
  }) : '';
  return `<div class="mwg-summon-panel"><header class="support-details-heading"><span>${e(unit.emoji || '◆')}</span><strong>${e(unit.name || unit.id || '召唤物')}</strong><small>${unit.instanceId ? '场上召唤物' : '召唤物模板'}</small></header>
    <div class="summon-detail-stats">${stats.map(stat => `<span>${e(stat)}</span>`).join('')}</div>
    ${unit.description ? `<p class="content-flavor">${e(unit.description)}</p>` : ''}
    ${capabilities.length ? `<section class="summon-detail-section"><h4>能力与限制</h4><div class="summon-detail-chips">${capabilities.map(item => `<span>${e(item)}</span>`).join('')}</div></section>` : ''}
    ${lifecycle ? `<section class="summon-detail-section"><h4>重复召唤与倒下后的处理</h4><p>${e(lifecycle)}</p></section>` : ''}
    ${unit.onExistingProgram || unit.on_existing_effects ? `<section class="summon-detail-section"><h4>已在场时再次召唤</h4>${renderProgram(unit, { name: '重复召唤效果', effectProgram: unit.onExistingProgram, effects: unit.on_existing_effects }, false)}</section>` : ''}
    ${resources.length ? `<section class="summon-detail-section"><h4>专属资源</h4><div class="summon-detail-chips">${resources.map(resource => `<span>${e(resource.emoji || '◆')} ${e(resource.name || resource.id || '资源')} ${e(resource.current ?? 0)}/${e(resource.max ?? '—')}${resource.refresh === 'retain' ? '（保留）' : resource.refresh ? '（回合开始补满）' : ''}</span>`).join('')}</div></section>` : ''}
    ${statuses.length ? `<section class="summon-detail-section"><h4>当前状态</h4><div class="summon-detail-chips">${statuses.map(status => `<span>${e(status.emoji || '◆')} ${e(status.name || status.id || '状态')} ×${e(status.stacks ?? 1)}${status.duration !== undefined ? `（${e(status.duration)}回合）` : ''}</span>`).join('')}</div></section>` : ''}
    ${modifiers.length ? `<section class="summon-detail-section"><h4>数值修正</h4><div class="summon-detail-chips">${modifiers.map(([key, value]) => `<span>${e(MODIFIER_NAMES[key] || key)}${value >= 0 ? '+' : ''}${e(value)}</span>`).join('')}</div></section>` : ''}
    <section class="summon-detail-section summon-detail-actions"><h4>自动行动</h4>${actions.length ? actions.map(action => renderProgram(unit, action, false)).join('') : '<p class="summon-detail-empty">没有自动行动</p>'}</section>
    ${abilities.length ? `<section class="summon-detail-section summon-detail-abilities"><h4>触发能力</h4>${abilities.map(ability => renderProgram(unit, ability, true)).join('')}</section>` : ''}
  </div>`;
}
