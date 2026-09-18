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
  type DamageKind,
  type CardEffectRuntimeContext,
  type EffectCommandOutcome,
  type SummonSelector,
} from '../../game-core';

export interface TavernEffectCommandContext {
  kind?: string;
  statusId?: string;
  spentEnergy?: unknown;
  spentResources?: Readonly<Record<string, number>>;
  xValues?: Readonly<Record<string, number>>;
  statusContext?: { stacks?: unknown };
  orbValue?: unknown;
  /** Concrete damage event that caused the current ability/status trigger. */
  damageKind?: DamageKind;
}

export type ResolvedEffectTarget =
  | { kind: 'player'; id: 'player' }
  | { kind: 'enemy'; id: string }
  | { kind: 'summon'; id: string; owner: 'player' | 'enemy' };

/** Per-program, per-domain manual choice. It is discarded when the program ends. */
export interface SharedSummonChoice {
  requirements: readonly Readonly<{ selector: SummonSelector }>[];
  selectedIds?: readonly string[] | null;
}

export interface TavernEffectCommandHostPorts {
  runChoiceBranch?(execute: () => Promise<boolean>): Promise<boolean>;
  readState(sourceIsPlayer: boolean): CoreEffectState;
  isTerminal(): boolean;
  executeCardCommand(command: CardEffectCommand, context?: CardEffectRuntimeContext): Promise<void>;
  presentCommand(command: Exclude<EffectCommand, CardEffectCommand | { type: 'register_trigger' }>): void;
  executeBattleCommand(
    command: BattleEffectCommand,
    sourceIsPlayer: boolean,
    resolvedTarget?: ResolvedEffectTarget | string,
  ): Promise<void>;
  executePersistentGrowth(
    command: Extract<EffectCommand, { type: 'persistent_growth' }>,
    sourceIsPlayer: boolean,
  ): Promise<void>;
  executeSpecialCommand(
    command: Extract<EffectCommand, {
      type: 'set_stance' | 'channel_orb' | 'evoke_orbs' | 'set_orb_slots' | 'modify_orbs' | 'grant_extra_turn' | 'force_end_turn' | 'replay_current';
    }>,
    sourceIsPlayer: boolean,
    resolvedEnemyId?: string,
  ): Promise<void>;
  executeSummonCommand(
    command: Extract<EffectCommand, {
      type:
        | 'spawn_summon' | 'damage_summons' | 'heal_summons' | 'modify_summons' | 'modify_summon_effects'
        | 'gain_summon_resource' | 'set_summon_resource' | 'apply_summon_status'
        | 'remove_summon_status' | 'activate_summons' | 'dismiss_summons' | 'copy_summons';
    }>,
    sourceIsPlayer: boolean,
    sharedChoice?: SharedSummonChoice,
  ): Promise<void>;
  executeEnemyCommand(
    command: Extract<EffectCommand, { type: 'spawn_enemy' | 'enemy_intent' | 'wait' | 'say' }>,
    sourceIsPlayer: boolean,
  ): Promise<void>;
  executeSummonerProgram(
    command: Extract<EffectCommand, { type: 'summoner_effects' }>,
    sourceIsPlayer: boolean,
  ): Promise<void>;
  forEachTarget?(
    selector: EnemyTargetSelector,
    sourceIsPlayer: boolean,
    execute: (target: ResolvedEffectTarget) => Promise<void>,
  ): Promise<void>;
  /** Compatibility bridge for hosts that only know the legacy enemy roster. */
  forEachEnemyTarget?(selector: EnemyTargetSelector, execute: (enemyId: string) => Promise<void>): Promise<void>;
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
  ): Promise<string | readonly string[] | null>;
}

function finiteNumber(value: unknown, fallback?: number): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function commandTarget(target: 'self' | 'opponent', sourceIsPlayer: boolean): 'player' | 'enemy' {
  return resolveBattleEffectTarget(target, sourceIsPlayer ? 'player' : 'enemy');
}

/**
 * Only sibling card/summon upgrade nodes form a group. Keeping branches separate
 * means a choice is never constrained by an option or conditional branch that
 * will not actually execute.
 */
function planSharedUpgradeChoices(program: EffectProgram): Map<string, {
  card?: NonNullable<CardEffectRuntimeContext['sharedCardChoice']>;
  summon?: SharedSummonChoice;
}> {
  const planned = new Map<string, {
    card?: NonNullable<CardEffectRuntimeContext['sharedCardChoice']>;
    summon?: SharedSummonChoice;
  }>();
  const visit = (nodes: readonly import('../../game-core').EffectNode[], path: string): void => {
    const cards = nodes.flatMap((node, index) => {
      const entryPath = `${path}[${index}]`;
      if (node.op === 'modify_card_value' && node.selector.pick === 'choose') {
        return [{ path: entryPath, requirement: { selector: node.selector, stats: [node.stat] } }];
      }
      if (node.op === 'upgrade_cards' && node.selector.pick === 'choose') {
        const numericStats = node.changes.flatMap(change => change.kind === 'numeric' ? [change.stat] : []);
        return [{
          path: entryPath,
          requirement: {
            selector: node.selector,
            ...(numericStats.length === node.changes.length ? { stats: numericStats } : {}),
            ...(node.maxLevel !== undefined ? { maxLevel: node.maxLevel } : {}),
          },
        }];
      }
      return [];
    });
    if (cards.length > 1) {
      const choice = { requirements: cards.map(entry => entry.requirement) };
      for (const entry of cards) planned.set(entry.path, { ...(planned.get(entry.path) || {}), card: choice });
    }
    const summons = nodes.flatMap((node, index) =>
      (node.op === 'modify_summons' || node.op === 'modify_summon_effects') && node.selector.pick === 'choose'
        ? [{ node, path: `${path}[${index}]` }] : []);
    if (summons.length > 1) {
      const choice: SharedSummonChoice = { requirements: summons.map(({ node }) => ({ selector: node.selector })) };
      for (const entry of summons) planned.set(entry.path, { ...(planned.get(entry.path) || {}), summon: choice });
    }
    nodes.forEach((node, index) => {
      const nodePath = `${path}[${index}]`;
      if (node.op === 'if') {
        visit(node.then, `${nodePath}.then`);
        if (node.else) visit(node.else, `${nodePath}.else`);
      } else if (node.op === 'choose_one') {
        node.options.forEach(option => visit(option.effects, `${nodePath}.options.${option.id}`));
      }
    });
  };
  visit(program.steps, '$.steps');
  return planned;
}

/** Runs portable modern programs against Tavern side-effect ports. */
export class TavernEffectCommandHost {
  public constructor(private readonly ports: TavernEffectCommandHostPorts) {}

  public async executeProgram(
    program: EffectProgram,
    sourceIsPlayer: boolean,
    context: TavernEffectCommandContext = {},
  ): Promise<void> {
    let sharedChoices = planSharedUpgradeChoices(program);
    await runEffectCommandProgram(
      program,
      {
        spentEnergy: finiteNumber(context.spentEnergy, 0) || 0,
        spentResources: context.spentResources,
        xValues: context.xValues,
        xValue: finiteNumber((context as { xValue?: unknown }).xValue, finiteNumber(context.spentEnergy, 0) || 0),
        statusStacks: finiteNumber(context.statusContext?.stacks),
        orbValue: finiteNumber(context.orbValue),
        eventDamageKind: context.damageKind,
        eventStatus: (context.kind === 'status_applied' || context.kind === 'status_removed') && typeof context.statusId === 'string'
          ? Object.freeze({ kind: context.kind, id: context.statusId }) : undefined,
      },
      {
        readState: () => this.ports.readState(sourceIsPlayer),
        isTerminal: () => this.ports.isTerminal(),
        execute: (command, path) => this.executeCommand(command, sourceIsPlayer, undefined, sharedChoices.get(path)),
        chooseEffectOption: choice => this.ports.chooseEffectOption(choice),
        ...(this.ports.runChoiceBranch ? { runChoiceBranch: async (execute: () => Promise<boolean>) => {
          const previousChoices = structuredClone(sharedChoices);
          try { return await this.ports.runChoiceBranch!(execute); }
          catch (error) { sharedChoices = previousChoices; throw error; }
        } } : {}),
      },
    );
  }

  private async executeCommand(
    command: EffectCommand,
    sourceIsPlayer: boolean,
    resolvedTarget?: ResolvedEffectTarget | string,
    sharedChoice?: { card?: NonNullable<CardEffectRuntimeContext['sharedCardChoice']>; summon?: SharedSummonChoice },
  ): Promise<void | EffectCommandOutcome> {
    if (
      'target' in command &&
      'targetSelector' in command &&
      command.targetSelector
    ) {
      if (
        (command.targetSelector.team === 'self' || command.targetSelector.team === 'opponent') &&
        !isBattleEffectCommand(command) && command.type !== 'apply_status' && command.type !== 'remove_status'
      ) {
        throw new Error(`targets.team only supports direct entity operations; ${command.type} cannot target summons`);
      }
      const single = {
        ...command,
        targetSelector: undefined,
      } as EffectCommand;
      const visitTarget = this.ports.forEachTarget
        ? (visit: (target: ResolvedEffectTarget) => Promise<void>) => this.ports.forEachTarget!(command.targetSelector!, sourceIsPlayer, visit)
        : this.ports.forEachEnemyTarget
          ? (visit: (target: ResolvedEffectTarget) => Promise<void>) => this.ports.forEachEnemyTarget!(command.targetSelector!, id => visit({ kind: 'enemy', id }))
          : undefined;
      if (!visitTarget) throw new Error('effect host does not provide target selection');
      await visitTarget(
        async target => {
          if (target.kind === 'summon' && command.type === 'apply_status') {
            await this.ports.executeSummonCommand({
              type: 'apply_summon_status', selector: { owner: target.owner === (sourceIsPlayer ? 'player' : 'enemy') ? 'self' : 'opponent', pick: 'by_id', id: target.id },
              status: command.status, stacks: command.stacks,
            }, sourceIsPlayer);
            return;
          }
          if (target.kind === 'summon' && command.type === 'remove_status') {
            await this.ports.executeSummonCommand({
              type: 'remove_summon_status', selector: { owner: target.owner === (sourceIsPlayer ? 'player' : 'enemy') ? 'self' : 'opponent', pick: 'by_id', id: target.id },
              status: command.status,
            }, sourceIsPlayer);
            return;
          }
          if (target.kind === 'summon' && !isBattleEffectCommand(command)) {
            throw new Error(`targets.team cannot silently apply ${command.type} to summon ${target.id}`);
          }
          await this.executeCommand(single, sourceIsPlayer,
            this.ports.forEachTarget ? target : target.kind === 'enemy' ? target.id : target, sharedChoice);
        },
      );
      return;
    }
    if (isCardEffectCommand(command)) {
      if (command.type === 'discard_cards') {
        const discardResult: NonNullable<CardEffectRuntimeContext['discardResult']> = {
          value: Object.freeze({ status: 'pending', cards: Object.freeze([]) }),
        };
        await this.ports.executeCardCommand(command, { discardResult });
        return { discardResult: discardResult.value };
      }
      await this.ports.executeCardCommand(command, sharedChoice?.card ? { sharedCardChoice: sharedChoice.card } : undefined);
      return;
    }

    // Continuous card-play rules are read from passive/hold programs before a play.
    // They do not perform an immediate host mutation when encountered directly.
    if (command.type === 'card_play_rule') return;

    if (command.type !== 'register_trigger') this.ports.presentCommand(command);
    if (command.type === 'choice_selected') return;
    if (isBattleEffectCommand(command)) {
      await this.ports.executeBattleCommand(command, sourceIsPlayer, resolvedTarget);
      return;
    }
    if (command.type === 'persistent_growth') {
      await this.ports.executePersistentGrowth(command, sourceIsPlayer);
      return;
    }
    if (
      command.type === 'set_stance' || command.type === 'channel_orb' || command.type === 'evoke_orbs' ||
      command.type === 'set_orb_slots' || command.type === 'modify_orbs' || command.type === 'grant_extra_turn' ||
      command.type === 'force_end_turn' || command.type === 'replay_current'
    ) {
      await this.ports.executeSpecialCommand(command, sourceIsPlayer, typeof resolvedTarget === 'string' ? resolvedTarget : resolvedTarget?.kind === 'enemy' ? resolvedTarget.id : undefined);
      return;
    }
    if (
      command.type === 'spawn_summon' || command.type === 'damage_summons' || command.type === 'heal_summons' ||
      command.type === 'modify_summons' || command.type === 'modify_summon_effects' || command.type === 'gain_summon_resource' ||
      command.type === 'set_summon_resource' || command.type === 'apply_summon_status' ||
      command.type === 'remove_summon_status' || command.type === 'activate_summons' ||
      command.type === 'dismiss_summons' || command.type === 'copy_summons'
    ) {
      await this.ports.executeSummonCommand(command, sourceIsPlayer, sharedChoice?.summon);
      return;
    }
    if (['spawn_enemy', 'enemy_intent', 'wait', 'say'].includes(command.type)) {
      await this.ports.executeEnemyCommand(command as Extract<EffectCommand, { type: 'spawn_enemy' | 'enemy_intent' | 'wait' | 'say' }>, sourceIsPlayer);
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
