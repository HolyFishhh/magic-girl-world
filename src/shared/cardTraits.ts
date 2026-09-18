import { describeCardTraits, type LifecycleCard } from '../game-core/cardLifecycle';
import { escapeHtml } from '../fish/shared/html';
import { resolveCardAttachmentPlayAccess, type CardAttachment } from '../game-core/cardAttachment';
export interface CardDisplayMetadata extends LifecycleCard {
  origin?: string; parentCombatInstanceId?: string;
  attachments?: CardAttachment[];
  effectProgram?: unknown; effects?: unknown;
  discardEffectProgram?: unknown; discard_effects?: unknown;
}
export interface CardTraitContext { playAccess?: 'allowed' | 'denied'; temporary?: boolean; compact?: boolean }
export function describeDisplayCardTraits(card: CardDisplayMetadata, context: CardTraitContext = {}) {
  const traits = describeCardTraits(card);
  const access = resolveCardAttachmentPlayAccess(card);
  const denied = context.playAccess === 'denied' || (context.playAccess !== 'allowed' && !access.explicitlyAllowed && (access.denied || card.type === 'Curse'));
  if (denied) traits.unshift({id:'unplayable',name:'不可打出',detail:'不能主动打出；明确允许打出的效果可以解除这项限制。抽牌、弃置等触发效果仍按各自规则执行。',tone:'normal'});
  if (context.temporary === true || (context.temporary === undefined && card.origin === 'copied' && !!card.parentCombatInstanceId))
    traits.push({id:'temporary',name:'临时·战后消失',detail:'这张战斗实例不会加入持有牌库；战后消失不等于打出后消耗，打出去向仍由其他特性决定。',tone:'normal'});
  const meaningful = (value: unknown): boolean => !!value && typeof value === 'object' && ('steps' in value ? Array.isArray(value.steps) && value.steps.length > 0 : Object.keys(value).length > 0);
  if (card.type === 'Curse' && (meaningful(card.effectProgram) || meaningful(card.effects))) traits.push({id:'curse-turn-end',name:'回合结束时',detail:'仍在手牌中的诅咒在回合结束时执行其效果，之后再按保留、空灵等特性处理去向。具体效果见卡牌详情。',tone:'normal'});
  if (meaningful(card.discardEffectProgram) || meaningful(card.discard_effects))
    traits.push({id:'discard-trigger',name:'弃置时',detail:'此牌从手牌被主动或效果弃置时执行弃置效果；正常打出和回合清理不触发。具体效果见卡牌详情。',tone:'normal'});
  const timings = new Set((card.attachments || []).flatMap(a => a.changes.filter(c => c.kind === 'dynamic_cost').map(c => c.timing)));
  for (const [timing,name] of [['on_draw','抽到时'],['while_in_hand','手牌中'],['on_play','打出时']] as const)
    if (timings.has(timing)) traits.push({id:`timing-${timing}`,name,detail:`${name}计算附着的动态费用规则；具体数值与条件见卡牌附着详情。`,tone:'normal'});
  return traits;
}
export function renderCardTraits(card: CardDisplayMetadata, context: CardTraitContext = {}): string {
  const traits = describeDisplayCardTraits(card, context);
  const visible = context.compact && traits.length > 3
    ? [...traits.slice(0, 2), {id:'more',name:`特性 +${traits.length - 2}`,tone:'normal',detail:traits.slice(2).map(t => `${t.name}：${t.detail}`).join('\n')}]
    : traits;
  return visible.map(trait => `<span class="card-trait trait-${trait.tone} mwg-status-reference" role="button" tabindex="0" aria-label="查看特性：${escapeHtml(trait.name)}" data-status-name="${escapeHtml(trait.name)}" data-status-rules="${escapeHtml(trait.detail)}">${escapeHtml(trait.name)}</span>`).join('');
}
