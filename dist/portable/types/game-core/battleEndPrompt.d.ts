import { type BattleEndResult } from './battleTerminal';
export interface BattleEndPromptStatus {
    name: string;
    stacks: number;
    duration?: number;
    description?: string;
}
export interface BattleEndPromptCard {
    name: string;
    description: string;
}
export interface BattleEndPromptAsset {
    name: string;
    count?: number;
    description?: string;
}
export type BattleContinuationMode = 'ordinary' | 'run';
export interface BattleEndPromptInput {
    result: BattleEndResult;
    continuation: BattleContinuationMode;
    narrativeText?: string;
    playerContinuation?: string;
    player: {
        hp: number;
        maxHp: number;
        lust: number;
        maxLust: number;
        energy: number;
        maxEnergy?: number;
        drawPerTurn?: number;
        block?: number;
        statuses: readonly BattleEndPromptStatus[];
        handCount: number;
        drawPileCount: number;
        discardPileCount: number;
        exhaustPileCount?: number;
        cards?: readonly BattleEndPromptAsset[];
        relics?: readonly BattleEndPromptAsset[];
        abilities?: readonly BattleEndPromptAsset[];
        items?: readonly BattleEndPromptAsset[];
        desireEffect?: string;
    };
    enemy?: {
        name: string;
        hp: number;
        maxHp: number;
        lust: number;
        maxLust: number;
        energy?: number;
        maxEnergy?: number;
        block?: number;
        statuses: readonly BattleEndPromptStatus[];
        actions?: readonly BattleEndPromptAsset[];
        abilities?: readonly BattleEndPromptAsset[];
        desireEffect?: string;
    } | null;
    turns: number;
    battleLog?: string;
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
