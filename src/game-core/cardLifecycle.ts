/** Authored overrides are independent: playing is not discarding, cleanup is not a gameplay discard. */
export interface CardLifecycle {
  /** These permissions are independent of temporary battle-zone movement. */
  removable?: boolean;
  transformable?: boolean;
  on_play?: 'discard' | 'exhaust' | 'purge';
  on_discard?: 'discard' | 'exhaust' | 'remove' | 'purge';
  turn_end?: 'discard' | 'retain' | 'exhaust';
}
export interface LifecycleCard {
  id?: string;
  unique?: boolean; type?: string; retain?: boolean; exhaust?: boolean; ethereal?: boolean; innate?: boolean; sly?: boolean;
  lifecycle?: CardLifecycle;
}
export function validateCardLifecycle(value: unknown): string | null {
  if (value === undefined) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'lifecycle 必须是对象';
  const allowed: Record<string,string[]> = {on_play:['discard','exhaust','purge'],on_discard:['discard','exhaust','remove','purge'],turn_end:['discard','retain','exhaust']};
  for (const [key, entry] of Object.entries(value)) {
    if (key === 'removable' || key === 'transformable') {
      if (typeof entry !== 'boolean') return `lifecycle.${key} 必须是布尔值`;
    } else if (!allowed[key]?.includes(String(entry))) return `lifecycle.${key} 无效`;
  }
  return null;
}
export function canPermanentlyRemoveCard(card: LifecycleCard): boolean {
  return card.lifecycle?.removable !== false;
}
export function canTransformCard(card: LifecycleCard): boolean {
  return card.lifecycle?.transformable !== false;
}
export function resolveCardLifecycle(card: LifecycleCard): Required<Pick<CardLifecycle, 'on_play' | 'on_discard' | 'turn_end'>> {
  return {
    on_play: card.lifecycle?.on_play ?? (card.type === 'Power' || card.exhaust ? 'exhaust' : 'discard'),
    on_discard: card.lifecycle?.on_discard ?? 'discard',
    turn_end: card.lifecycle?.turn_end ?? (card.ethereal ? 'exhaust' : card.retain || card.type === 'Curse' ? 'retain' : 'discard'),
  };
}
export interface CardTrait { id:string; name:string; detail:string; tone:'fire'|'break'|'keep'|'normal' }
export function describeCardTraits(card: LifecycleCard): CardTrait[] {
  const rule={...resolveCardLifecycle(card),removable:canPermanentlyRemoveCard(card),transformable:canTransformCard(card)}, result:CardTrait[]=[];
  if (!rule.removable) result.push({id:'bound',name:'不可移除',detail:'不能从持有牌组永久移除；商店、营火、事件与删卡次数均不能删除。遗忘或销毁仍会移出本场，战后保留原卡；不限制消耗、遗弃或复制。',tone:'keep'});
  if (!rule.transformable) result.push({id:'untransformable',name:'不可变形',detail:'不能在战斗或战外变为另一张牌；仍可升级或修改数值。与不可永久移除独立。',tone:'keep'});
  if(card.unique) result.push({id:'unique',name:'唯一',detail:'同一 ID 只能持有一张，不能生成或复制额外副本。',tone:'normal'});
  if(card.innate) result.push({id:'innate',name:'固有',detail:'优先进入起始手牌；超过手牌上限的固有牌留在抽牌堆顶。',tone:'normal'});
  if(card.sly) result.push({id:'sly',name:'灵巧',detail:'在回合结束清理前从手牌被主动或效果弃置时，免费打出并完整结算这张牌；回合末自动弃牌不触发。',tone:'keep'});
  if(rule.on_play==='purge') result.push({id:'purge',name:rule.removable?'销毁·永久':'销毁·本场',detail:rule.removable?'成功打出并结算后，永久移除这张持有卡；临时复制牌不会销毁原卡。':'成功打出并结算后移出本场；不可移除限制使原持有卡在战后保留。',tone:'break'});
  else if(rule.on_play==='exhaust') result.push({id:'exhaust',name:'消耗·本场',detail:'打出后进入消耗区，不参与正常洗牌；已有回收效果仍可取回。战后持有卡恢复。',tone:'fire'});
  if(rule.turn_end==='retain') result.push({id:'retain',name:'保留',detail:'回合结束留在手中，不随弃牌堆洗回；仍可被指定弃置或移除。',tone:'keep'});
  if(rule.turn_end==='exhaust') result.push({id:'ethereal',name:'虚无',detail:'回合结束仍在手中时消耗；正常打出是否消耗由打出特性决定。',tone:'fire'});
  if(rule.on_discard==='remove') result.push({id:'discard-remove',name:'遗弃',detail:'每当这张牌被弃置（包括回合清理），便移出本场战斗且不能从消耗堆取回；战后原持有卡恢复。正常打出不触发。',tone:'fire'});
  else if(rule.on_discard==='purge') result.push({id:'discard-purge',name:rule.removable?'遗忘':'遗忘·本场',detail:rule.removable?'每当这张牌被弃置（包括回合清理），便永久移除这张精确持有卡实例；临时副本不影响原卡。正常打出不触发。':'每当这张牌被弃置（包括回合清理）便移出本场；不可移除限制使原持有卡在战后保留。正常打出不触发。',tone:'break'});
  else if(rule.on_discard==='exhaust') result.push({id:'discard-exhaust',name:'弃置消耗',detail:'每当这张牌被弃置（包括回合清理），便进入本场消耗区；已有回收效果仍可取回，战后持有卡恢复。正常打出不触发。',tone:'fire'});
  return result;
}
