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
  spentResources?: Readonly<Record<string, number>>;
  xValues?: Readonly<Record<string, number>>;
  statusContext?: { stacks?: unknown };
  orbValue?: unknown;
}

export interface TavernEffectCommandHostPorts {
  readState(sourceIsPlayer: boolean): CoreEffectState;
  isTerminal(): boolean;
  executeCardCommand(command: CardEffectCommand): Promise<void>;
  presentCommand(command: Exclude<EffectCommand, CardEffectCommand | { type: 'register_trigger' }>): void;
  executeBattleCommand(
    command: BattleEffectCommand,
    sourceIsPlayer: boolean,
    resolvedEnemyId?: string,
  ): Promise<void>;
  executeSpecialCommand(
    command: Extract<EffectCommand, {
      type: 'set_stance' | 'channel_orb' | 'evoke_orbs' | 'set_orb_slots' | 'modify_orbs' | 'grant_extra_turn' | 'force_end_turn';
    }>,
    sourceIsPlayer: boolean,
  ): Promise<void>;
  executeSummonCommand(
    command: Extract<EffectCommand, {
      type:
        | 'spawn_summon' | 'damage_summons' | 'heal_summons' | 'modify_summons' | 'modify_summon_effects'
        | 'gain_summon_resource' | 'set_summon_resource' | 'apply_summon_status'
        | 'remove_summon_status' | 'activate_summons' | 'dismiss_summons' | 'copy_summons';
    }>,
    sourceIsPlayer: boolean,
  ): Promise<void>;
  executeEnemyCommand(
    command: Extract<EffectCommand, { type: 'spawn_enemy' }>,
    sourceIsPlayer: boolean,
  ): Promise<void>;
  executeSummonerProgram(
    command: Extract<EffectCommand, { type: 'summoner_effects' }>,
    sourceIsPlayer: boolean,
  ): Promise<void>;
  forEachEnemyTarget(selector: EnemyTargetSelector, execute: (enemyId: string) => Promise<void>): Promise<void>;
  applyStatus(targetType: 'player' | 'enemy', status: string, stacks: number): Promise<void>;
  removeStatuses(targetType: 'player' | 'enemy', selection: string): Promise<void>;
  registerAbility(
    targetType: 'player' | 'enemy',
    definition: {
      trigger: string;
      eventQuery?: import('../../game-core').EventTriggerQuery;
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
  chooseEffectOption(
    choice: Extract<import('../../game-core').EffectNode, { op: 'choose_one' }>,
  ): Promise<string | null>;
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
        spentResources: context.spentResources,
        xValues: context.xValues,
        xValue: finiteNumber((context as { xValue?: unknown }).xValue, finiteNumber(context.spentEnergy, 0) || 0),
        statusStacks: finiteNumber(context.statusContext?.stacks),
        orbValue: finiteNumber(context.orbValue),
      },
      {
        readState: () => this.ports.readState(sourceIsPlayer),
        isTerminal: () => this.ports.isTerminal(),
        execute: command => this.executeCommand(command, sourceIsPlayer),
        chooseEffectOption: choice => this.ports.chooseEffectOption(choice),
      },
    );
  }

  private async executeCommand(
    command: EffectCommand,
    sourceIsPlayer: boolean,
    resolvedEnemyId?: string,
  ): Promise<void> {
    if (
      'target' in command &&
      'targetSelector' in command &&
      command.targetSelector &&
      commandTarget(command.target, sourceIsPlayer) === 'enemy'
    ) {
      const single = { ...command, targetSelector: undefined } as EffectCommand;
      await this.ports.forEachEnemyTarget(
        command.targetSelector,
        enemyId => this.executeCommand(single, sourceIsPlayer, enemyId),
      );
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
    if (command.type === 'choice_selected') return;
    if (isBattleEffectCommand(command)) {
      await this.ports.executeBattleCommand(command, sourceIsPlayer, resolvedEnemyId);
      return;
    }
    if (
      command.type === 'set_stance' || command.type === 'channel_orb' || command.type === 'evoke_orbs' ||
      command.type === 'set_orb_slots' || command.type === 'modify_orbs' || command.type === 'grant_extra_turn' ||
      command.type === 'force_end_turn'
    ) {
      await this.ports.executeSpecialCommand(command, sourceIsPlayer);
      return;
    }
    if (
      command.type === 'spawn_summon' || command.type === 'damage_summons' || command.type === 'heal_summons' ||
      command.type === 'modify_summons' || command.type === 'modify_summon_effects' || command.type === 'gain_summon_resource' ||
      command.type === 'set_summon_resource' || command.type === 'apply_summon_status' ||
      command.type === 'remove_summon_status' || command.type === 'activate_summons' ||
      command.type === 'dismiss_summons' || command.type === 'copy_summons'
    ) {
      await this.ports.executeSummonCommand(command, sourceIsPlayer);
      return;
    }
    if (command.type === 'spawn_enemy') {
      await this.ports.executeEnemyCommand(command, sourceIsPlayer);
      return;
    }
    if (command.type === 'summoner_effects') {
      await this.ports.executeSummonerProgram(command, sourceIsPlayer);
      return;
    }
    if (command.type === 'register_trigger') {
      const effectProgram: EffectProgram = { spec: EFFECT_PROGRAM_SPEC, steps: command.effects };
      await this.ports.registerAbility(commandTarget(command.target, sourceIsPlayer), {
        trigger: command.trigger,
        ...(command.eventQuery ? { eventQuery: command.eventQuery } : {}),
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
    if (command.type === 'narration') {
      await this.ports.narrate(command.text);
    }
  }
}
