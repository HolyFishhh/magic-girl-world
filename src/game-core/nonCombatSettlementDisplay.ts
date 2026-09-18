import { parseNonCombatSettlement, type NonCombatSettlementPlan } from './nonCombatSettlement';
import type { ContentRuleReference } from './contentDescription';

export interface NonCombatSettlementDisplayOptions {
  resourceNames?: Readonly<Record<string, string>>;
  /** Card definitions in the current content scope, used for deck filters. */
  cardNames?: Readonly<Record<string, string>>;
}

function displayPlan(value: unknown): NonCombatSettlementPlan | null {
  if (value && typeof value === 'object' && !Array.isArray(value)
    && Number.isInteger((value as NonCombatSettlementPlan).hpDelta)
    && Number.isInteger((value as NonCombatSettlementPlan).maxHpDelta)
    && (value as NonCombatSettlementPlan).costs) return value as NonCombatSettlementPlan;
  try { return parseNonCombatSettlement(value); } catch { return null; }
}

function signed(label: string, value: number): string {
  if (!value) return '';
  return `${value > 0 ? '获得' : '失去'}${Math.abs(value)}${label}`;
}

function nameOf(value: Record<string, unknown>): string {
  return typeof value.name === 'string' && value.name.trim() ? value.name.trim()
    : typeof value.id === 'string' ? value.id : '未命名内容';
}

function candidateList(label: string, entries: readonly Record<string, unknown>[], pick: number): string {
  if (!entries.length) return '';
  const names = entries.map(nameOf).join('、');
  return pick >= entries.length ? `获得${entries.length}${label}：${names}` : `从${entries.length}${label}中选择${pick}${label}获得：${names}`;
}

function deckActionText(plan: NonCombatSettlementPlan, options: NonCombatSettlementDisplayOptions): string[] {
  return plan.deckActions.map(action => {
    const filter = action.filter?.ids?.length
      ? `指定牌“${action.filter.ids.map(id => options.cardNames?.[id] || id).join('、')}”`
      : action.filter?.types?.length
        ? action.filter.types.map(type => ({ Attack: '攻击牌', Skill: '技能牌', Power: '能力牌', Event: '事件牌', Curse: '诅咒牌' }[type] || type)).join('、')
        : '牌组中的牌';
    const selection = action.pick === 'random' ? '随机' : '选择';
    if (action.kind === 'remove') return `${selection}${filter}${action.count}张移除`;
    if (action.kind === 'duplicate') return `${selection}${filter}${action.count}张复制`;
    const replacement = action.replacement && nameOf(action.replacement);
    return `${selection}${filter}${action.count}张变形为“${replacement || '指定卡牌'}”`;
  });
}

/** Player-facing acquisition rules. It never contains transaction receipts. */
export function describeNonCombatSettlement(value: unknown, options: NonCombatSettlementDisplayOptions = {}): string {
  const plan = displayPlan(value);
  if (!plan) return '';
  const parts = [
    signed('点生命', plan.hpDelta), signed('点生命上限', plan.maxHpDelta),
    signed('点欲望', plan.lustDelta), signed('点欲望上限', plan.maxLustDelta),
    signed('金币', plan.goldDelta),
    plan.cardRemovalDelta ? (plan.cardRemovalDelta > 0 ? `获得${plan.cardRemovalDelta}次删牌机会，领取后立即选择并永久移除；未确认的次数保留` : `失去${Math.abs(plan.cardRemovalDelta)}次删牌机会`) : '',
    ...Object.entries(plan.resourceDeltas).map(([id, amount]) => signed(options.resourceNames?.[id] || id, amount)),
    plan.costs.hp ? `支付${plan.costs.hp}点生命` : '',
    plan.costs.maxHp ? `支付${plan.costs.maxHp}点生命上限` : '',
    plan.costs.gold ? `支付${plan.costs.gold}金币` : '',
    ...Object.entries(plan.costs.resources).map(([id, amount]) => `支付${amount}${options.resourceNames?.[id] || id}`),
    candidateList('张卡牌', plan.grantedCards, plan.grantedCards.length),
    ...deckActionText(plan, options),
    plan.grant ? candidateList('张卡牌', plan.grant.cards, plan.grant.limits.cards) : '',
    plan.grant ? candidateList('个道具', plan.grant.items, plan.grant.limits.items) : '',
  ].filter(Boolean);
  return parts.join('；');
}

export function nonCombatSettlementReferences(value: unknown, describeItem: (item: Record<string, unknown>) => string): ContentRuleReference[] {
  const plan = displayPlan(value);
  if (!plan) return [];
  try {
    const entries = [...plan.grantedCards, ...(plan.grant?.cards || [])];
    for (const action of plan.deckActions) if (action.replacement) entries.push(action.replacement);
    return [
      ...entries.map(entry => ({ id: String(entry.id || nameOf(entry)), name: nameOf(entry), rules: '', card: entry })),
      ...(plan.grant?.items || []).map(entry => ({ id: String(entry.id || nameOf(entry)), name: nameOf(entry),
        rules: describeItem(entry), flavor: typeof entry.description === 'string' ? entry.description : '' })),
    ];
  } catch { return []; }
}
