import type { SummonUnitDefinition } from './summonUnit';
export interface PersistentGrowthOperation {
    stat: 'max_hp' | 'max_lust' | 'damage' | 'lust';
    /** Absent means the player. Present means this player's summon template. */
    summonTemplateId?: string;
    operator: 'add' | 'subtract' | 'set';
    value: number;
}
export declare function validPersistentGrowthTarget(stat: unknown, summon: unknown): boolean;
export declare function readSummonGrowth(value: unknown): PersistentGrowthOperation[];
/** Apply the recorded template changes once when creating a fresh summon. */
export declare function growSummonDefinition(definition: SummonUnitDefinition, growth: readonly PersistentGrowthOperation[]): SummonUnitDefinition;
