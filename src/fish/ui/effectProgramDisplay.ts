import { compactContentToDisplayTags, cardRequirementDisplayTags } from '../../game-core/effectDisplay';
import { collectCardDisplayNames } from '../../game-core/cardDisplayNames';
import {
  effectProgramToDisplayTags,
  cardAttachmentsToDisplayTags,
  summarizeEffectProgram as summarizeCoreEffectProgram,
  triggeredEffectProgramToDisplayTags,
  type EffectDisplayTag,
  type EffectIntentType,
  type EffectProgram,
  type EffectProgramSummary,
  type EffectDisplayContext,
  type CardAttachment,
  type EventTriggerQuery,
} from '../../game-core';
import { DynamicStatusManager } from '../combat/dynamicStatusManager';
import { GameStateManager } from '../core/gameStateManager';
import { escapeHtml } from '../shared/html';
import { renderStatusReferences, bindStatusReferenceDetails } from '../../shared/statusReference';
import { collectStanceDefinitions, collectStanceNames } from '../../game-core/stanceIdentityDisplay';
import { collectSummonDisplayNames } from '../../game-core/summonDisplayNames';

export type IntentType = EffectIntentType;
export type { EffectDisplayTag, EffectProgramSummary };

function resolveStatusName(statusId: string): string | undefined {
  return DynamicStatusManager.getInstance().getStatusDefinition(statusId)?.name?.trim();
}

function resolveStatusDefinitions(): Readonly<Record<string, unknown>> {
  return Object.fromEntries(DynamicStatusManager.getInstance().getStatusDefinitions()
    .filter(status => status.id).map(status => [status.id, status]));
}

function resolveResourceContext(context: EffectDisplayContext & { sourceSide?: string; sourceEnemyId?: string }): EffectDisplayContext {
  const state = GameStateManager.getInstance().getGameState();
  const enemySource = context.sourceSide === 'enemy' || context.selfLabel === '敌方';
  const own = enemySource ? (state.enemies?.find(e => e.id === context.sourceEnemyId) || state.enemy) : state.player;
  const opponent = enemySource ? state.player : state.enemy;
  const map = (entity: typeof own, field: 'name' | 'emoji' | 'description') => Object.fromEntries(
    Object.entries(entity?.resources || {}).map(([id, resource]) => [id, resource[field] || (field === 'emoji' ? '◆' : field === 'description' ? '战斗资源，可通过对应卡牌或能力获得和消耗。' : id)]),
  );
  return { enemyActionNames: Object.fromEntries((state.enemy?.actions || []).filter(action => action.id).map(action => [action.id!, action.name])), resourceDescriptions: map(own, 'description'), opponentResourceDescriptions: map(opponent, 'description'), resourceNames: map(own, 'name'), resourceEmojis: map(own, 'emoji'),
    opponentResourceNames: map(opponent, 'name'), opponentResourceEmojis: map(opponent, 'emoji') };
}

export function summarizeEffectProgram(program: EffectProgram): EffectProgramSummary {
  return summarizeCoreEffectProgram(program);
}

/**
 * Tavern-only HTML adapter. Formula-to-Chinese translation lives in game-core,
 * so the battle page and the common/reward page cannot drift apart again.
 */
export class EffectProgramDisplay {
  private static instance: EffectProgramDisplay;

  public static getInstance(): EffectProgramDisplay {
    if (!EffectProgramDisplay.instance) EffectProgramDisplay.instance = new EffectProgramDisplay();
    return EffectProgramDisplay.instance;
  }

  public programToTags(
    program?: EffectProgram | null,
    context: Pick<EffectDisplayContext, 'damageAmountText' | 'selfLabel' | 'opponentLabel' | 'resourceNames' | 'resourceEmojis' | 'opponentResourceNames' | 'opponentResourceEmojis' | 'summonerResourceNames' | 'summonerResourceEmojis' | 'stanceNames' | 'stanceDefinitions' | 'enemyActionNames'> & { sourceSide?: string; sourceEnemyId?: string } = {},
  ): EffectDisplayTag[] {
    return effectProgramToDisplayTags(program, { collapseSummons: true, resolveStatusName, statusDefinitions: resolveStatusDefinitions(), ...resolveResourceContext(context), cardNames: collectCardDisplayNames(GameStateManager.getInstance().getGameState()),
      summonNames: collectSummonDisplayNames(GameStateManager.getInstance().getGameState(), program), stanceNames: collectStanceNames(GameStateManager.getInstance().getGameState(), program), stanceDefinitions: collectStanceDefinitions(GameStateManager.getInstance().getGameState(), program), ...context });
  }

  public triggeredProgramToTags(
    trigger: string,
    program?: EffectProgram | null,
    context: Pick<EffectDisplayContext, 'selfLabel' | 'opponentLabel' | 'resourceNames' | 'resourceEmojis' | 'opponentResourceNames' | 'opponentResourceEmojis' | 'summonerResourceNames' | 'summonerResourceEmojis' | 'stanceNames' | 'stanceDefinitions' | 'enemyActionNames'> & { sourceSide?: string; sourceEnemyId?: string } = {},
    eventQuery?: EventTriggerQuery,
  ): EffectDisplayTag[] {
    return triggeredEffectProgramToDisplayTags(trigger, program, { collapseSummons: true, resolveStatusName, statusDefinitions: resolveStatusDefinitions(), ...resolveResourceContext(context), cardNames: collectCardDisplayNames(GameStateManager.getInstance().getGameState()),
      summonNames: collectSummonDisplayNames(GameStateManager.getInstance().getGameState(), program), stanceNames: collectStanceNames(GameStateManager.getInstance().getGameState(), program), stanceDefinitions: collectStanceDefinitions(GameStateManager.getInstance().getGameState(), program), ...context }, eventQuery);
  }

  public protectionToTags(value: unknown): EffectDisplayTag[] {
    const enemyNames = Object.fromEntries(GameStateManager.getInstance().getEnemies().map(enemy => [enemy.id, enemy.name]));
    return compactContentToDisplayTags({
      protection: (value as { protection?: unknown })?.protection,
      defense: (value as { defense?: unknown })?.defense,
    }, { enemyNames });
  }

  public cardToTags(card: { effectProgram?: EffectProgram; program?: EffectProgram; requiresSummonTemplateId?: string }, context: Pick<EffectDisplayContext, 'damageAmountText'> = {}): EffectDisplayTag[] {
    const state = GameStateManager.getInstance().getGameState();
    return [...cardRequirementDisplayTags(card.requiresSummonTemplateId, {summonNames: collectSummonDisplayNames(state, card)}), ...this.programToTags(card.effectProgram || card.program, context)];
  }

  public attachmentToTags(attachments?: readonly CardAttachment[]): EffectDisplayTag[] {
    return cardAttachmentsToDisplayTags(attachments);
  }

  public createEffectTagsHTML(tags: EffectDisplayTag[]): string {
    return this.createTagsHTML(tags, '');
  }

  public createCompactEffectTagsHTML(tags: EffectDisplayTag[]): string {
    return this.createTagsHTML(tags, 'compact');
  }

  public createWrappedEffectTagsHTML(tags: EffectDisplayTag[]): string {
    return this.createTagsHTML(tags, 'wrapped');
  }

  private createTagsHTML(tags: EffectDisplayTag[], variant: '' | 'compact' | 'wrapped'): string {
    if (typeof document !== 'undefined') bindStatusReferenceDetails(document);
    const statuses = DynamicStatusManager.getInstance().getStatusDefinitions().map(status => ({
      id: status.id, name: status.name, rules: status.description, flavor: status.flavorText,
    }));
    if (tags.length === 0) return '';
    const className = variant ? ` ${variant}` : '';
    const html = `<div class="effect-tags-container${className}">${tags
      .map(
        entry =>
          `<span class="effect-tag${className} effect-${entry.category}" style="--effect-color:${escapeHtml(entry.color)}">${escapeHtml(entry.icon)} ${renderStatusReferences(entry.text, [...statuses, ...(entry.references || []), ...(entry.reference ? [entry.reference] : [])])}</span>`,
      )
      .join('')}</div>`;
    // Only decorate text nodes. Reference data/title attributes may themselves
    // contain numbers and arrows and must remain intact.
    return html.replace(/>([^<]+)</g, (_match, text: string) => `>${text.replace(/(\d+(?:\.\d+)?)([↑↓])/g, '<strong class="card-live-damage" title="按当前目标估算，格挡与触发效果另行结算">$1<small>$2</small></strong>')}<`);
  }
}
