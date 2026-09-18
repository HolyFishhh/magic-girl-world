export interface BattleOutcomeVitals {
    hp: number;
    lust: number;
}
/** Round health only at settlement; combat itself retains its calculation precision. */
export declare function settleBattleOutcomeVitals(player: {
    currentHp: unknown;
    currentLust: unknown;
}, core: {
    max_hp: unknown;
    max_lust: unknown;
}): BattleOutcomeVitals;
