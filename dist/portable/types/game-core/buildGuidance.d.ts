import type { BuildBudget, ContentPack } from './contentPack';
export type BuildNeed = '输出' | '防御' | '恢复' | '抽牌' | '能量' | '牌序';
export interface BuildGuidance {
    need: BuildNeed;
    synergy: string | null;
    roles: [string, string, string];
}
/** Give the generator one short, program-computed deck direction instead of another analysis task. */
export declare function recommendBuildGuidance(pack: ContentPack, budget: BuildBudget): BuildGuidance;
export declare function formatBuildGuidance(guidance: BuildGuidance): string;
