import {
  runEffectCommandProgram,
  isBattleEffectCommand,
  isCardEffectCommand,
  resolveBattleEffectTarget,
  EFFECT_PROGRAM_SPEC,
  type BattleEffectCommand,
  type CardEffectCommand,
  type CoreEffectState,
  type EffectCommand,
  type EffectProgram,
  type EnemyTargetSelector,
} from '../../game-core';

export interface TavernEffectCommandContext {
  spentEnergy?: unknown;
  statusContext?: { stacks?: unknown };
}

export interface TavernEffectCommandHostPorts {
  readState(sourceIsPlayer: boolean): CoreEffectState;
  isTerminal(): boolean;
  executeCardCommand(command: CardEffectCommand): Promise<void>;
  presentCommand(command: Exclude<EffectCommand, CardEffectCommand | { type: 'register_trigger' }>): void;
  executeBattleCommand(command: BattleEffectCommand, sourceIsPlayer: boolean): Promise<void>;
  forEachEnemyTarget(selector: EnemyTargetSelector, execute: () => Promise<void>): Promise<void>;
  applyStatus(targetType: 'player' | 'enemy', status: string, stacks: number): Promise<void>;
  removeStatuses(targetType: 'player' | 'enemy', selection: string): Promise<void>;
  registerAbility(
    targetType: 'player' | 'enemy',
    definition: {
      trigger: string;
      effectProgram: EffectProgram;
      name?: string;
      emoji?: string;
      description?: string;
      source?: string;
    },
  ): Promise<void>;
  scheduleEffect(
    command: Extract<EffectCommand, { type: 'schedule_effect' }>,
    sourceIsPlayer: boolean,
  ): Promise<void>;
  setCardDestination(destination: import('../../game-core').PlayedCardDestination): Promise<void>;
  narrate(text: string): Promise<void>;
}

function finiteNumber(value: unknown, fallback?: number): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function commandTarget(target: 'self' | 'opponent', sourceIsPlayer: boolean): 'player' | 'enemy' {
  return resolveBattleEffectTarget(target, sourceIsPlayer ? 'player' : 'enemy');
}

/** Runs portable modern programs against Tavern side-effect ports. */
export class TavernEffectCommandHost {
  public constructor(private readonly ports: TavernEffectCommandHostPorts) {}

  public async executeProgram(
    program: EffectProgram,
    sourceIsPlayer: boolean,
    context: TavernEffectCommandContext = {},
  ): Promise<void> {
    await runEffectCommandProgram(
      program,
      {
        spentEnergy: finiteNumber(context.spentEnergy, 0) || 0,
        xValue: finiteNumber((context as { xValue?: unknown }).xValue, finiteNumber(context.spentEnergy, 0) || 0),
        statusStacks: finiteNumber(context.statusContext?.stacks),
      },
      {
        readState: () => this.ports.readState(sourceIsPlayer),
        isTerminal: () => this.ports.isTerminal(),
        execute: command => this.executeCommand(command, sourceIsPlayer),
      },
    );
  }

  private async executeCommand(command: EffectCommand, sourceIsPlayer: boolean): Promise<void> {
    if (
      'target' in command &&
      'targetSelector' in command &&
      command.targetSelector &&
      commandTarget(command.target, sourceIsPlayer) === 'enemy'
    ) {
      const single = { ...command, targetSelector: undefined } as EffectCommand;
      await this.ports.forEachEnemyTarget(command.targetSelector, () => this.executeCommand(single, sourceIsPlayer));
      return;
    }
    if (isCardEffectCommand(command)) {
      await this.ports.executeCardCommand(command);
      return;
    }

    // Continuous card-play rules are read from passive/hold programs before a play.
    // They do not perform an immediate host mutation when encountered directly.
    if (command.type === 'card_play_rule') return;

    if (command.type !== 'register_trigger') this.ports.presentCommand(command);
    if (isBattleEffectCommand(command)) {
      await this.ports.executeBattleCommand(command, sourceIsPlayer);
      return;
    }
    if (command.type === 'register_trigger') {
      const effectProgram: EffectProgram = { spec: EFFECT_PROGRAM_SPEC, steps: command.effects };
      await this.ports.registerAbility(commandTarget(command.target, sourceIsPlayer), {
        trigger: command.trigger,
        effectProgram,
      });
      return;
    }
    if (command.type === 'schedule_effect') {
      await this.ports.scheduleEffect(command, sourceIsPlayer);
      return;
    }
    if (command.type === 'set_card_destination') {
      await this.ports.setCardDestination(command.destination);
      return;
    }
    if (command.type === 'apply_status') {
      await this.ports.applyStatus(commandTarget(command.target, sourceIsPlayer), command.status, command.stacks);
      return;
    }
    if (command.type === 'remove_status') {
      await this.ports.removeStatuses(
        commandTarget(command.target, sourceIsPlayer),
        command.status === 'all' ? 'all_buffs' : command.status,
      );
      return;
    }
    await this.ports.narrate(command.text);
  }
}
