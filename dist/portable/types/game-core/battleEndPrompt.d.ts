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
export interface BattleEndPromptResource {
    name: string;
    emoji?: string;
    current: number;
    max: number;
}
export interface BattleEndPromptEnemy {
    name: string;
    hp: number;
    maxHp: number;
    lust: number;
    maxLust: number;
    energy?: number;
    maxEnergy?: number;
    resources?: readonly BattleEndPromptResource[];
    block?: number;
    statuses: readonly BattleEndPromptStatus[];
    actions?: readonly BattleEndPromptAsset[];
    abilities?: readonly BattleEndPromptAsset[];
    desireEffect?: string;
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
        resources?: readonly BattleEndPromptResource[];
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
    enemy?: BattleEndPromptEnemy | null;
    /** Complete encounter party. enemy remains the compatibility fallback. */
    enemies?: readonly BattleEndPromptEnemy[];
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
