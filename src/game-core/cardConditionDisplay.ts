/** Display only; event-result predicates are not current hand membership. */
export function describeCardTypeCondition(kind: 'last_card_type' | 'discarded_card_type', type: string, negated = false): string {
  const names: Record<string, string> = { Attack: '攻击牌', Skill: '技能牌', Power: '能力牌', Event: '事件牌', Curse: '诅咒牌' };
  const name = names[type] || '未知类型的牌';
  const text = kind === 'last_card_type' ? `上一张打出的牌为${name}` : `本次效果最近一次弃牌恰好弃掉一张手牌且类型为${name}`;
  return negated ? `不满足“${text}”` : text;
}
