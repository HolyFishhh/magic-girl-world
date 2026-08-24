export interface BattleOutcomeVitals {
    hp: number;
    lust: number;
}
/** Return the exact post-battle persistent vitals, clamped to canonical MUV limits. */
export declare function settleBattleOutcomeVitals(player: {
    currentHp: unknown;
    currentLust: unknown;
}, core: {
    max_hp: unknown;
    max_lust: unknown;
}): BattleOutcomeVitals;
