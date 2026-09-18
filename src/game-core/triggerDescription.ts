import type { EventTriggerQuery } from './battleEventJournal';

/** Plain text; hosts must HTML-escape it. Shared by full rules and compact tags. */
export function describeTriggerEventQuery(query: EventTriggerQuery | undefined): string {
  if (!query) return '';
  const parts: string[] = [];
  const scopes: Record<string, string> = {
    turn: '本回合', combat: '本场战斗', run: '本局游戏', card_instance: '当前卡牌实例', team: '当前阵营',
  };
  // Event scope selects the counter window, not the lifetime of its listener.
  // A turn-scoped Power remains active and counts again on subsequent turns.
  const ordinals = { first: '首次', first_n: `前${query.n || 1}次`, nth: `第${query.n || 1}次`, every_n: `每${query.n || 1}次` };
  if (query.ordinal) {
    const scope = query.scope === 'turn' ? '每回合' : scopes[query.scope || 'combat'] || query.scope;
    parts.push(`${scope}${ordinals[query.ordinal]}`);
  }
  if (query.turn !== undefined) parts.push(`第${query.turn}回合`);
  if (query.cardInstanceId) parts.push(`卡牌实例 ${query.cardInstanceId}`);
  if (query.teamActorIds?.length) parts.push(`阵营成员 ${query.teamActorIds.join('、')}`);
  const filter = query.filter;
  if (filter) {
    const kinds: Record<string, string> = {
      turn_started: '回合开始', turn_ended: '回合结束', card_played: '打出卡牌', card_moved: '卡牌移动',
      card_drawn: '抽牌', draw_pile_shuffled: '洗牌', damage_resolved: '伤害结算', heal_resolved: '治疗结算',
      lust_increased: '欲望增加', lust_decreased: '欲望减少', block_gained: '获得格挡', block_lost: '失去格挡',
      status_applied: '获得状态', status_removed: '失去状态', entity_defeated: '单位被击败',
    };
    // Public trigger timing determines kind/phase uniquely. Repeating these
    // implementation labels obscures the useful rule (for example first N).
    // Non-public before filters still need their distinguishing timing shown.
    if (filter.phase === 'before') parts.push(`${filter.kind ? kinds[filter.kind] || filter.kind : ''}前`);
    if (filter.reason) parts.push(`原因 ${filter.reason}`);
    if (filter.sourceKind) parts.push(`来源 ${filter.sourceKind}`);
    if (filter.sourceId) parts.push(`来源ID ${filter.sourceId}`);
    if (filter.damageKind) parts.push(`伤害类型 ${filter.damageKind}`);
    if (filter.cardType) parts.push(`${({ Attack: '攻击', Skill: '技能', Power: '能力', Event: '事件', Curse: '诅咒' } as Record<string, string>)[filter.cardType] || filter.cardType}牌`);
    if (filter.templateId) parts.push(`模板 ${filter.templateId}`);
    if (filter.cardInstanceId) parts.push(`卡牌实例 ${filter.cardInstanceId}`);
    if (filter.actorId) parts.push(`行动者 ${filter.actorId}`);
    if (filter.targetId) parts.push(`目标 ${filter.targetId}`);
  }
  return parts.length ? `（${parts.join('、')}）` : '';
}
