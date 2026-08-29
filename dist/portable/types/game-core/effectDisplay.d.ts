import type { EffectProgram } from './effectDsl';
import { type CardAttachment } from './cardAttachment';
export type EffectIntentType = 'attack' | 'lust_attack' | 'defend' | 'heal' | 'buff' | 'debuff' | 'special';
export interface EffectProgramSummary {
    type: EffectIntentType;
    damage?: number;
    lustDamage?: number;
    block?: number;
}
export interface EffectDisplayTag {
    text: string;
    icon: string;
    color: string;
    category: 'beneficial' | 'harmful' | 'neutral' | 'utility' | 'special';
}
export interface EffectDisplayContext {
    statusNames?: Readonly<Record<string, string>>;
    resourceNames?: Readonly<Record<string, string>>;
    resolveStatusName?: (statusId: string) => string | undefined;
    selfLabel?: string;
    opponentLabel?: string;
}
/** Shared card-attachment wording for hand, pile, selection and detail surfaces. */
export declare function cardAttachmentsToDisplayTags(attachments: readonly CardAttachment[] | undefined): EffectDisplayTag[];
export declare function effectProgramToDisplayTags(program?: EffectProgram | null, context?: EffectDisplayContext): EffectDisplayTag[];
export declare function triggeredEffectProgramToDisplayTags(trigger: string, program?: EffectProgram | null, context?: EffectDisplayContext): EffectDisplayTag[];
export declare function compactContentToDisplayTags(value: unknown, context?: EffectDisplayContext): EffectDisplayTag[];
export declare function summarizeEffectProgram(program: EffectProgram): EffectProgramSummary;
