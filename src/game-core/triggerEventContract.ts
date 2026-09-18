import type { BattleEventKind, BattleEventPhase, EventCounterFilter } from './battleEventJournal';

/** Shared public condition semantics, independent of status definition placement. */
export function triggerOwnershipContract(): string {
  return '先确定监听内容的持有者，再选择 on 和收益目标；召唤的 take_damage 监听召唤自己受伤，不是主人受伤，scope:"team" 不会扩大事件分发范围。召唤自己的行动、能力及所持状态中，普通 apply_status/remove_status 的 to:"self" 绑定该召唤本身，不是主人或同类召唤群。其他来源要选择召唤时使用 apply_summon_status/remove_summon_status 与 selector；召唤给具体主人效果使用 summoner_effects。';
}

export function statusEventConditionContract(): string {
return '指定状态的获得、叠层或移除：在对应状态事件的效果 when 中写 event_status_is("状态ID")，只匹配当前 status_applied/status_removed 事件影响的状态。参数必须是一个已注册的稳定状态ID字符串；source_id 表示事件来源，不是被改变的状态。该函数只用于布尔条件，不用于 hold 数值修饰；没有当前状态事件时为 false，后续卡牌和延迟效果不继承旧事件。判断状态当前是否存在则用 self.status.<id>.stacks > 0，不能把“当前存在”当成“本次获得”，也不自造裸 event/source_id/status_id 变量。';
}

/** Technical facts implied by `on`, shared by authoring and execution. */
export const EVENT_KIND_BY_TRIGGER: Readonly<Record<string, BattleEventKind>> = {
  kill: 'entity_defeated',
  turn_start: 'turn_started', turn_end: 'turn_ended',
  card_played: 'card_played', attack_played: 'card_played',
  skill_played: 'card_played', power_played: 'card_played',
  on_discard: 'card_moved', on_exhaust: 'card_moved',
  on_draw: 'card_drawn', on_shuffle: 'draw_pile_shuffled',
  take_damage: 'damage_resolved', deal_damage: 'damage_resolved',
  take_heal: 'heal_resolved', deal_heal: 'heal_resolved',
  lust_increase: 'lust_increased', deal_lust_increase: 'lust_increased',
  lust_decrease: 'lust_decreased', deal_lust_decrease: 'lust_decreased',
  gain_block: 'block_gained', lose_block: 'block_lost',
  gain_buff: 'status_applied', gain_debuff: 'status_applied',
  enemy_gain_buff: 'status_applied', enemy_gain_debuff: 'status_applied',
  lose_buff: 'status_removed', lose_debuff: 'status_removed',
  enemy_lose_buff: 'status_removed', enemy_lose_debuff: 'status_removed',
};

export const CARD_TYPE_BY_TRIGGER: Readonly<Record<string, string>> = {
  attack_played: 'Attack', skill_played: 'Skill', power_played: 'Power',
};

const AFTER_TRIGGERS = new Set(['kill', 'card_played', 'attack_played', 'skill_played', 'power_played', 'on_draw', 'on_discard', 'on_exhaust']);
/** The public trigger fires at one phase, even when the journal records both before/after. */
export const EVENT_PHASE_BY_TRIGGER: Readonly<Record<string, BattleEventPhase>> = Object.fromEntries(
  Object.keys(EVENT_KIND_BY_TRIGGER).map(trigger => [trigger, AFTER_TRIGGERS.has(trigger) ? 'after' : 'resolve']),
);

export function impliedTriggerEventFilter(trigger: unknown): EventCounterFilter {
  if (typeof trigger !== 'string') return {};
  return {
    ...(EVENT_KIND_BY_TRIGGER[trigger] ? { kind: EVENT_KIND_BY_TRIGGER[trigger] } : {}),
    ...(EVENT_PHASE_BY_TRIGGER[trigger] ? { phase: EVENT_PHASE_BY_TRIGGER[trigger] } : {}),
    ...(CARD_TYPE_BY_TRIGGER[trigger] ? { cardType: CARD_TYPE_BY_TRIGGER[trigger] } : {}),
  };
}

/** Contradictory authored filters must fail, never be silently overwritten. */
export function triggerEventFilterConflicts(trigger: unknown, filter: EventCounterFilter = {}): boolean {
  const implied = impliedTriggerEventFilter(trigger);
  return Boolean(
    (implied.kind && filter.kind !== undefined && filter.kind !== implied.kind) ||
    (implied.phase && filter.phase !== undefined && filter.phase !== implied.phase) ||
    (implied.cardType && filter.cardType !== undefined && filter.cardType !== implied.cardType),
  );
}

/** Group identical facts once; the portable artifact is checked against these facts. */
export function triggerEventSchemaConstraints(): Record<string, unknown>[] {
  const groups = new Map<string, { on: string[]; properties: Record<string, unknown> }>();
  for (const on of Object.keys(EVENT_KIND_BY_TRIGGER)) {
    const implied = impliedTriggerEventFilter(on);
    const properties = {
      event: { const: implied.kind }, phase: { const: implied.phase },
      ...(implied.cardType ? { card_type: { const: implied.cardType } } : {}),
    };
    const key = JSON.stringify(properties);
    const group: { on: string[]; properties: Record<string, unknown> } = groups.get(key) || { on: [], properties };
    group.on.push(on);
    groups.set(key, group);
  }
  return [...groups.values()].map(group => ({
    if: { properties: { on: { enum: group.on } }, required: ['on'] },
    then: { properties: group.properties },
  }));
}
