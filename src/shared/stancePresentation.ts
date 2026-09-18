import { compileCompactEffectList } from '../game-core/compactEffectDsl';
import {
  effectProgramToDisplayTags,
  triggeredEffectProgramToDisplayTags,
  type EffectDisplayContext,
  type EffectDisplayTag,
} from '../game-core/effectDisplay';
import type { EffectNode, EffectStanceDefinition } from '../game-core/effectDsl';
import { escapeHtml } from '../fish/shared/html';
import { renderRulePills } from './rulePills';
import { describeCompactStatus } from '../game-core/contentDescription';
import type { StatusReference } from './statusReference';

function compiledStance(value: unknown, context: EffectDisplayContext): EffectStanceDefinition | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const stance = value as Record<string, unknown>;
  if (typeof stance.id !== 'string' || typeof stance.name !== 'string') return null;
  if ('enterEffects' in stance || 'passiveEffects' in stance || 'exitEffects' in stance) {
    return stance as unknown as EffectStanceDefinition;
  }
  const compiled = compileCompactEffectList({ stance }, {
    creates: context.cardDefinitions ? Object.values(context.cardDefinitions) : undefined,
  });
  if (!compiled.ok) return null;
  const node = compiled.value.steps.find((step): step is Extract<EffectNode, { op: 'set_stance' }> => step.op === 'set_stance');
  return node?.stance || null;
}

function refs(tags: readonly EffectDisplayTag[]) {
  return tags.flatMap(tag => [...(tag.references || []), ...(tag.reference ? [tag.reference] : [])]);
}

function scopedStatusReferences(context: EffectDisplayContext): StatusReference[] {
  return Object.entries(context.statusDefinitions || {}).flatMap(([id, value]) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const definition = value as Record<string, unknown>;
    const name = typeof definition.name === 'string' && definition.name.trim()
      ? definition.name.trim() : context.statusNames?.[id];
    if (!name) return [];
    return [{ id, name, rules: describeCompactStatus(definition, {
      inlineStatusDetails: false, statusNames: context.statusNames,
      resourceNames: context.resourceNames, resourceEmojis: context.resourceEmojis,
      summonerResourceNames: context.summonerResourceNames, summonerResourceEmojis: context.summonerResourceEmojis,
      cardNames: context.cardNames, cardDefinitions: context.cardDefinitions,
      summonNames: context.summonNames, stanceNames: context.stanceNames,
      stanceDefinitions: context.stanceDefinitions, enemyActionNames: context.enemyActionNames,
    }), flavor: typeof definition.description === 'string' ? definition.description : '' }];
  });
}

function group(label: string, tags: EffectDisplayTag[], references: readonly StatusReference[]): string {
  if (!tags.length) return '';
  return `<section class="special-details-group"><strong>${escapeHtml(label)}</strong>${renderRulePills(tags.map(tag => tag.text), [...refs(tags), ...references])}</section>`;
}

/** Shared authored/compiled stance detail used by card links and the live stance panel. */
export function renderStancePanel(value: unknown, context: EffectDisplayContext = {}): string {
  const stance = compiledStance(value, context);
  if (!stance) return '';
  const display = (effects: EffectNode[] | undefined) => effectProgramToDisplayTags(
    { spec: 'mwg.effect/v1', steps: effects || [] }, context,
  );
  const events = (stance.events || []).flatMap(event => triggeredEffectProgramToDisplayTags(
    event.trigger, { spec: 'mwg.effect/v1', steps: event.effects }, context, event.eventQuery,
  ));
  const references = scopedStatusReferences(context);
  const groups = [
    group('进入时', display(stance.enterEffects), references),
    group('持续生效', display(stance.passiveEffects), references),
    group('退出时', display(stance.exitEffects), references),
    group('仅此姿态生效期间', events, references),
  ].filter(Boolean).join('');
  return `<div class="mwg-stance-panel">
    <header class="support-details-heading"><span>${escapeHtml(stance.emoji || '◈')}</span><strong>${escapeHtml(stance.name)}</strong><small>姿态能力</small></header>
    ${stance.description ? `<div class="support-details-description">${escapeHtml(stance.description)}</div>` : ''}
    <div class="support-details-effects">${groups || '<div class="status-no-effect">没有额外效果。</div>'}</div>
    <section class="special-details-group"><strong>重复进入</strong><p>重复进入同一姿态不触发进入或退出效果。</p></section>
  </div>`;
}
