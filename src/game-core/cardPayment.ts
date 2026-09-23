import { describeCardCost, normalizeCardCost, resolveCardResourcePayment, validateCardCost, type CardCost, type CardResourcePayment, type CardResourceWaiver } from './combatResource';

export interface ExtraCardCost {
  hp?: number;
  discard?: { count: number; card_type?: string; tag?: string };
  sacrifice?: { count: number; template_id?: string };
}
export interface CardPaymentSpec {
  additional?: ExtraCardCost;
  alternatives?: (ExtraCardCost & { id: string; name: string; cost: CardCost })[];
}
export interface PaymentCard { id: string; name?: string; type?: string; tags?: string[]; cost?: CardCost; payment?: CardPaymentSpec; xValueBonus?: number }
export interface PaymentSummon { instanceId: string; templateId: string; name?: string; currentHp: number; hasHp?: boolean }
export interface PaymentState { hp?: number; hand: readonly PaymentCard[]; summons?: readonly PaymentSummon[]; resources: Readonly<Record<string, number>> }
export interface CardPaymentPlan {
  id: string; name: string; extra: ExtraCardCost; payment: CardResourcePayment; affordable: boolean;
  discardCandidates: PaymentCard[]; sacrificeCandidates: PaymentSummon[];
}
export interface CardPaymentSelection { optionId: string; discardIds: string[]; sacrificeIds: string[] }
/** Validation coverage only: the selected option still pays exactly its own cost. */
export function paymentCostComponents(card: { cost?: CardCost; payment?: CardPaymentSpec }): Record<string, number | 'all'> {
  const result: Record<string, number | 'all'> = {};
  for (const cost of [card.cost, ...(card.payment?.alternatives || []).map(p => p.cost)]) {
    for (const [id, value] of Object.entries(normalizeCardCost(cost))) result[id] = result[id] === 'all' || value === 'all' ? 'all' : value;
  }
  return result;
}
const record = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const positive = (v: unknown) => Number.isInteger(v) && Number(v) > 0 && Number(v) <= 999;
export function validateCardPayment(value: unknown): string | null {
  if (value === undefined) return null;
  if (!record(value) || Object.keys(value).some(k => !['additional', 'alternatives'].includes(k)) || !Object.keys(value).length) return 'payment 仅支持 additional / alternatives';
  const extra = (v: unknown, alternative = false): boolean => {
    if (!record(v) || Object.keys(v).some(k => !['hp', 'discard', 'sacrifice', ...(alternative ? ['id', 'name', 'cost'] : [])].includes(k))) return false;
    if (v.hp !== undefined && !positive(v.hp)) return false;
    if (v.discard !== undefined && (!record(v.discard) || !positive(v.discard.count) || Object.keys(v.discard).some(k => !['count', 'card_type', 'tag'].includes(k)) || (v.discard.card_type !== undefined && !['Attack', 'Skill', 'Power', 'Curse', 'Status'].includes(v.discard.card_type)) || (v.discard.tag !== undefined && (typeof v.discard.tag !== 'string' || !v.discard.tag.trim())))) return false;
    if (v.sacrifice !== undefined && (!record(v.sacrifice) || !positive(v.sacrifice.count) || Object.keys(v.sacrifice).some(k => !['count', 'template_id'].includes(k)) || (v.sacrifice.template_id !== undefined && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(v.sacrifice.template_id)))) return false;
    return !alternative || (typeof v.id === 'string' && v.id !== 'normal' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(v.id) && typeof v.name === 'string' && !!v.name.trim() && v.cost !== undefined && !validateCardCost(v.cost));
  };
  if (value.additional !== undefined && !extra(value.additional)) return 'additional 额外费用无效';
  if (value.alternatives !== undefined) {
    if (!Array.isArray(value.alternatives) || !value.alternatives.length || value.alternatives.length > 8)
      return 'alternatives 需要 1..8 个独立命名的有效付款方案';
    for (const [index, option] of value.alternatives.entries()) {
      if (record(option) && Object.prototype.hasOwnProperty.call(option, 'additional'))
        return `alternatives[${index}].additional 不合法：替代方案的 hp/discard/sacrifice 必须与 id/name/cost 同层填写，例如 {id:"blood",name:"以血施法",cost:1,hp:6}`;
      if (!extra(option, true)) return `alternatives[${index}] 需要有效的 id/name/cost；额外费用 hp/discard/sacrifice 直接写在方案同层`;
    }
    if (new Set(value.alternatives.map(option => option.id)).size !== value.alternatives.length)
      return 'alternatives 的方案 id 不能重复';
  }
  return null;
}
export function cardPaymentPlans(card: PaymentCard, state: PaymentState, waiver?: CardResourceWaiver): CardPaymentPlan[] {
  const options = [{ id: 'normal', name: '通常费用', cost: card.cost ?? 0, ...card.payment?.additional }, ...(card.payment?.alternatives || [])];
  return options.map(option => {
    const discardCandidates = state.hand.filter(c => c.id !== card.id && (!option.discard?.card_type || c.type === option.discard.card_type) && (!option.discard?.tag || c.tags?.includes(option.discard.tag)));
    const sacrificeCandidates = (state.summons || []).filter(s => (s.hasHp === false || s.currentHp > 0) && (!option.sacrifice?.template_id || s.templateId === option.sacrifice.template_id));
    const payment = resolveCardResourcePayment(option.cost, state.resources, waiver, card.xValueBonus);
    return { id: option.id, name: option.name, extra: option, payment, discardCandidates, sacrificeCandidates,
      affordable: payment.affordable && (!option.hp || (state.hp ?? 0) > option.hp) && discardCandidates.length >= (option.discard?.count || 0) && sacrificeCandidates.length >= (option.sacrifice?.count || 0) };
  });
}
export function defaultPaymentSelection(plan: CardPaymentPlan): CardPaymentSelection {
  return { optionId: plan.id, discardIds: plan.discardCandidates.slice(0, plan.extra.discard?.count || 0).map(c => c.id), sacrificeIds: plan.sacrificeCandidates.slice(0, plan.extra.sacrifice?.count || 0).map(s => s.instanceId) };
}
export function validPaymentSelection(plan: CardPaymentPlan, selected: unknown): selected is CardPaymentSelection {
  if (!selected || typeof selected !== 'object') return false;
  const candidate = selected as Partial<CardPaymentSelection>;
  if (typeof candidate.optionId !== 'string' || !Array.isArray(candidate.discardIds) || !Array.isArray(candidate.sacrificeIds)) return false;
  const valid = (ids: unknown[], count: number, candidates: string[]) =>
    ids.length === count && new Set(ids).size === count && ids.every(id => typeof id === 'string' && candidates.includes(id));
  return plan.affordable && plan.id === candidate.optionId && valid(candidate.discardIds, plan.extra.discard?.count || 0, plan.discardCandidates.map(c => c.id)) && valid(candidate.sacrificeIds, plan.extra.sacrifice?.count || 0, plan.sacrificeCandidates.map(s => s.instanceId));
}
export function describeExtraCardCost(extra: ExtraCardCost, summonNames?: Record<string, string>): string {
  return [extra.hp ? `支付${extra.hp}点生命（至少保留1点）` : '', extra.discard ? `弃置${extra.discard.count}张其他手牌${extra.discard.card_type ? `（${({ Attack: '攻击', Skill: '技能', Power: '能力', Curse: '诅咒', Status: '状态' } as Record<string, string>)[extra.discard.card_type]}牌）` : ''}${extra.discard.tag ? `（标签：${extra.discard.tag}）` : ''}` : '', extra.sacrifice ? `献祭${extra.sacrifice.count}个己方存活召唤物${extra.sacrifice.template_id ? `「${summonNames?.[extra.sacrifice.template_id] || extra.sacrifice.template_id}」` : ''}` : ''].filter(Boolean).join('，');
}
export function describeCardPayment(value: unknown, resourceNames?: Readonly<Record<string, string>>, summonNames?: Record<string, string>, resourceEmojis?: Readonly<Record<string, string>>): string[] {
  if (!value || validateCardPayment(value)) return [];
  const spec = value as CardPaymentSpec;
  const resources = Object.fromEntries(Object.entries(resourceNames || {}).map(([id, name]) => [id, { name, emoji: resourceEmojis?.[id] || '' }]));
  return [spec.additional ? `通常费用额外要求：${describeExtraCardCost(spec.additional, summonNames)}` : '', ...(spec.alternatives || []).map(p => `可选替代：${p.name}，${[describeCardCost(p.cost, resources), describeExtraCardCost(p, summonNames)].filter(Boolean).join('，')}`)].filter(Boolean);
}
export const CARD_PAYMENT_CONTRACT = '卡牌和卡牌模板根部 payment 支持 additional:{hp:正整数,discard:{count:正整数,card_type?:Attack/Skill/Power/Curse/Status,tag?:标签},sacrifice:{count:正整数,template_id?:召唤模板ID}}，以及 alternatives:[{id:唯一ID(不能normal),name:剧情名称,cost:标准费用,...额外费用字段}]。additional 加在通常动态 cost 上；每个 alternatives 完整替换通常资源和额外费用，不继承 additional。替代方案内部的生命、弃牌与献祭费用必须直接与id/name/cost同层写hp/discard/sacrifice，不能嵌套additional；例如 payment:{"alternatives":[{"id":"magic","name":"消耗能量","cost":2},{"id":"blood","name":"以血施法","cost":1,"hp":6}]}。玩家从可支付方案中选择，再选精确弃牌/献祭实例；取消整次出牌无消耗。HP直接扣除且至少保留1点，不是伤害；弃牌不能选正打出的牌，触发正常弃牌含灵巧/遗弃/遗忘；献祭执行离场/被击败触发，不留尸体。全部费用先同时扣除再触发收益，不得用费用触发收益支付本次费用。免费只豁免资源费用，自动打出选择首个可支付方案及符合条件的首批实例；重放仅首次付费。实际能量/资源统计不混入生命或实例数量。';
