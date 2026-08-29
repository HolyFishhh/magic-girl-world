export declare const BATTLE_TURN_FLOW_STEPS: readonly ["player_cards_end", "player_relics_end", "player_abilities_end", "player_summons_action", "player_orbs_end", "player_statuses_end", "player_threshold_execute", "scheduled_turn_end", "advance_turn", "enemy_block_reset", "enemy_resources_reset", "enemy_summons_reset", "enemy_abilities_start", "enemy_action", "enemy_summons_action", "enemy_next_intent", "enemy_abilities_end", "enemy_orbs_end", "enemy_statuses_end", "enemy_threshold_execute", "temporary_modifiers_clear", "player_begin", "player_summons_reset", "scheduled_turn_start", "player_block_reset", "player_energy_reset", "scheduled_before_draw", "player_draw", "scheduled_after_draw", "player_abilities_start", "player_relics_start"];
export type BattleTurnFlowStep = (typeof BATTLE_TURN_FLOW_STEPS)[number];
export declare const BATTLE_START_FLOW_STEPS: readonly ["player_stance_battle_start", "enemy_stance_battle_start", "player_abilities_battle_start", "enemy_abilities_battle_start", "player_abilities_gain_initial", "enemy_abilities_gain_initial", "player_relics_ability_gain_initial", "player_relics_battle_start"];
export type BattleStartFlowStep = (typeof BATTLE_START_FLOW_STEPS)[number];
export interface BattleTurnFlowPorts {
    isTerminal(): boolean;
    execute(step: BattleTurnFlowStep): void | Promise<void>;
    beginEnemyTurn?(): void | Promise<void>;
    consumeExtraTurn?(actor: 'player' | 'enemy'): boolean | Promise<boolean>;
}
export interface BattleTurnFlowResult {
    completed: boolean;
    executedSteps: BattleTurnFlowStep[];
    stoppedAfter?: BattleTurnFlowStep;
}
export interface BattleStartFlowPorts {
    isTerminal(): boolean;
    execute(step: BattleStartFlowStep): void | Promise<void>;
}
export interface BattleStartFlowResult {
    completed: boolean;
    executedSteps: BattleStartFlowStep[];
    stoppedAfter?: BattleStartFlowStep;
}
/** Run one-shot battle-start triggers in a host-independent, terminal-aware order. */
export declare function runBattleStartFlow(ports: BattleStartFlowPorts): Promise<BattleStartFlowResult>;
/**
 * Run one complete player-end -> enemy -> next-player cycle.
 * Hosts own effects and presentation; the portable core owns ordering and terminal short-circuiting.
 */
export declare function runBattleTurnFlow(ports: BattleTurnFlowPorts): Promise<BattleTurnFlowResult>;
export type EnemyTurnActionDecision = 'none' | 'stunned' | 'execute_prepared' | 'select_and_execute' | 'execute_default';
export interface EnemyTurnActionContext {
    hasEnemy: boolean;
    stunned: boolean;
    currentTurn: number;
    hasPreparedAction: boolean;
    actionCount: number;
}
export declare const DEFAULT_ENEMY_ATTACK_DAMAGE: {
    readonly min: 5;
    readonly max: 12;
};
/** Resolve the fallback attack amount from an injected random source. */
export declare function rollDefaultEnemyAttackDamage(random: () => number): number;
/** Resolve the enemy action branch without reading runtime globals or mutating the enemy. */
export declare function resolveEnemyTurnAction(context: EnemyTurnActionContext): EnemyTurnActionDecision;
