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
} from '../../game-core';
import { DynamicStatusManager } from '../combat/dynamicStatusManager';
import { GameStateManager } from '../core/gameStateManager';
import { escapeHtml } from '../shared/html';

export type IntentType = EffectIntentType;
export type { EffectDisplayTag, EffectProgramSummary };

function resolveStatusName(statusId: string): string | undefined {
  return DynamicStatusManager.getInstance().getStatusDefinition(statusId)?.name?.trim();
}

function resolveResourceNames(): Record<string, string> {
  const state = GameStateManager.getInstance().getGameState();
  const entities = [state.player, ...(state.enemies || []), ...(state.enemy ? [state.enemy] : [])];
  const names: Record<string, string> = {};
  for (const entity of entities) {
    for (const [id, resource] of Object.entries(entity?.resources || {})) names[id] ||= resource.name;
  }
  return names;
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
    context: Pick<EffectDisplayContext, 'selfLabel' | 'opponentLabel' | 'resourceNames'> = {},
  ): EffectDisplayTag[] {
    return effectProgramToDisplayTags(program, { resolveStatusName, resourceNames: resolveResourceNames(), ...context });
  }

  public triggeredProgramToTags(
    trigger: string,
    program?: EffectProgram | null,
    context: Pick<EffectDisplayContext, 'selfLabel' | 'opponentLabel' | 'resourceNames'> = {},
  ): EffectDisplayTag[] {
    return triggeredEffectProgramToDisplayTags(trigger, program, { resolveStatusName, resourceNames: resolveResourceNames(), ...context });
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
    if (tags.length === 0) return '';
    const className = variant ? ` ${variant}` : '';
    return `<div class="effect-tags-container${className}">${tags
      .map(
        entry =>
          `<span class="effect-tag${className} effect-${entry.category}" style="background:${escapeHtml(entry.color)}18;border:1px solid ${escapeHtml(entry.color)}99;color:${escapeHtml(entry.color)}">${escapeHtml(entry.icon)} ${escapeHtml(entry.text)}</span>`,
      )
      .join('')}</div>`;
  }
}
