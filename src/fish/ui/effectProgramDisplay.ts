import {
  effectProgramToDisplayTags,
  summarizeEffectProgram as summarizeCoreEffectProgram,
  triggeredEffectProgramToDisplayTags,
  type EffectDisplayTag,
  type EffectIntentType,
  type EffectProgram,
  type EffectProgramSummary,
  type EffectDisplayContext,
} from '../../game-core';
import { DynamicStatusManager } from '../combat/dynamicStatusManager';
import { escapeHtml } from '../shared/html';

export type IntentType = EffectIntentType;
export type { EffectDisplayTag, EffectProgramSummary };

function resolveStatusName(statusId: string): string | undefined {
  return DynamicStatusManager.getInstance().getStatusDefinition(statusId)?.name?.trim();
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
    context: Pick<EffectDisplayContext, 'selfLabel' | 'opponentLabel'> = {},
  ): EffectDisplayTag[] {
    return effectProgramToDisplayTags(program, { resolveStatusName, ...context });
  }

  public triggeredProgramToTags(
    trigger: string,
    program?: EffectProgram | null,
    context: Pick<EffectDisplayContext, 'selfLabel' | 'opponentLabel'> = {},
  ): EffectDisplayTag[] {
    return triggeredEffectProgramToDisplayTags(trigger, program, { resolveStatusName, ...context });
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
