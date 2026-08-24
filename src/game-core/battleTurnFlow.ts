export const BATTLE_TURN_FLOW_STEPS = [
  'player_cards_end',
  'player_relics_end',
  'player_abilities_end',
  'player_statuses_end',
  'advance_turn',
  'enemy_block_reset',
  'enemy_abilities_start',
  'enemy_action',
  'enemy_next_intent',
  'enemy_abilities_end',
  'enemy_statuses_end',
  'temporary_modifiers_clear',
  'player_begin',
  'player_block_reset',
  'player_energy_reset',
  'player_draw',
  'player_abilities_start',
  'player_relics_start',
] as const;

export type BattleTurnFlowStep = (typeof BATTLE_TURN_FLOW_STEPS)[number];

export const BATTLE_START_FLOW_STEPS = [
  'player_abilities_battle_start',
  'enemy_abilities_battle_start',
  'player_abilities_gain_initial',
  'enemy_abilities_gain_initial',
  'player_relics_ability_gain_initial',
  'player_relics_battle_start',
] as const;

export type BattleStartFlowStep = (typeof BATTLE_START_FLOW_STEPS)[number];

export interface BattleTurnFlowPorts {
  isTerminal(): boolean;
  execute(step: BattleTurnFlowStep): void | Promise<void>;
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
export async function runBattleStartFlow(ports: BattleStartFlowPorts): Promise<BattleStartFlowResult> {
  const executedSteps: BattleStartFlowStep[] = [];
  if (ports.isTerminal()) return { completed: false, executedSteps };

  for (const step of BATTLE_START_FLOW_STEPS) {
    await ports.execute(step);
    executedSteps.push(step);
    if (ports.isTerminal()) return { completed: false, executedSteps, stoppedAfter: step };
  }

  return { completed: true, executedSteps };
}

/**
 * Run one complete player-end -> enemy -> next-player cycle.
 * Hosts own effects and presentation; the portable core owns ordering and terminal short-circuiting.
 */
export async function runBattleTurnFlow(ports: BattleTurnFlowPorts): Promise<BattleTurnFlowResult> {
  const executedSteps: BattleTurnFlowStep[] = [];
  if (ports.isTerminal()) return { completed: false, executedSteps };

  for (const step of BATTLE_TURN_FLOW_STEPS) {
    await ports.execute(step);
    executedSteps.push(step);
    if (ports.isTerminal()) return { completed: false, executedSteps, stoppedAfter: step };
  }

  return { completed: true, executedSteps };
}

export type EnemyTurnActionDecision = 'none' | 'stunned' | 'execute_prepared' | 'select_and_execute' | 'execute_default';

export interface EnemyTurnActionContext {
  hasEnemy: boolean;
  stunned: boolean;
  currentTurn: number;
  hasPreparedAction: boolean;
  actionCount: number;
}

export const DEFAULT_ENEMY_ATTACK_DAMAGE = { min: 5, max: 12 } as const;

/** Resolve the fallback attack amount from an injected random source. */
export function rollDefaultEnemyAttackDamage(random: () => number): number {
  const sample = random();
  if (!Number.isFinite(sample) || sample < 0 || sample >= 1) {
    throw new Error('battle random source must return a finite value in [0, 1)');
  }
  const { min, max } = DEFAULT_ENEMY_ATTACK_DAMAGE;
  return min + Math.floor(sample * (max - min + 1));
}

/** Resolve the enemy action branch without reading runtime globals or mutating the enemy. */
export function resolveEnemyTurnAction(context: EnemyTurnActionContext): EnemyTurnActionDecision {
  if (!context.hasEnemy) return 'none';
  if (context.stunned) return 'stunned';
  if (context.currentTurn > 1 && context.hasPreparedAction) return 'execute_prepared';
  if (Number.isFinite(context.actionCount) && context.actionCount > 0) return 'select_and_execute';
  return 'execute_default';
}
