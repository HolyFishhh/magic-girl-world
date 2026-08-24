import { type BattleEndResult } from './battleTerminal';
export interface BattleEndPromptStatus {
    name: string;
    stacks: number;
}
export interface BattleEndPromptCard {
    name: string;
    description: string;
}
export type BattleContinuationMode = 'ordinary' | 'run';
export interface BattleEndPromptInput {
    result: BattleEndResult;
    continuation: BattleContinuationMode;
    narrativeText?: string;
    player: {
        hp: number;
        maxHp: number;
        lust: number;
        maxLust: number;
        energy: number;
        statuses: readonly BattleEndPromptStatus[];
        handCount: number;
        drawPileCount: number;
        discardPileCount: number;
    };
    enemy?: {
        name: string;
        hp: number;
        maxHp: number;
        lust: number;
        maxLust: number;
        statuses: readonly BattleEndPromptStatus[];
    } | null;
    turns: number;
    narrativeCards?: readonly BattleEndPromptCard[];
    rewardBudget?: string;
    buildGuidance?: string;
}
export interface BattleEndPrompt {
    resultText: string;
    battleSummary: string;
    promptedBattleSummary: string;
}
/** Format the post-battle model prompt without reading UI, MUV or Tavern globals. */
export declare function formatBattleEndPrompt(input: BattleEndPromptInput): BattleEndPrompt;
