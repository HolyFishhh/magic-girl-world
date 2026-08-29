import { absorbDamageWithBlock, applyNumericOperator, clampBattleAttribute, roundBattleValue } from './battleMath';
import { resolveAttributeTriggerDispatch, type BattleSide, type BattleTriggerDispatch } from './battleEventDispatch';
import type { Enemy, Player } from './battleState';
import type { BattleTriggerEventContext } from './battleEventJournal';
import type { EffectCommand } from './effectCommandRuntime';
import {
  applyModifierOperation,
  MODIFIER_ATTRIBUTE_BY_STAT,
  MODIFIER_SYMBOL_BY_OPERATOR,
  type ModifierOperation,
} from './modifierMath';

export type BattleEffectCommand = Extract<
  EffectCommand,
  {
    type:
      | 'damage'
      | 'execute'
      | 'kill'
      | 'heal'
      | 'gain_block'
      | 'gain_energy'
      | 'gain_resource'
      | 'set_resource'
      | 'gain_lust'
      | 'set_stat'
      | 'modify';
  }
>;

export type BattleEffectAttribute = 'hp' | 'lust' | 'energy' | 'block';
export type BattleModifierAttribute = (typeof MODIFIER_ATTRIBUTE_BY_STAT)[keyof typeof MODIFIER_ATTRIBUTE_BY_STAT];

export interface BattleModifierSource {
  operation: ModifierOperation;
  name: string;
  stacks?: number;
}

export type BattleEffectRuntimeEvent =
  | {
      type: 'modifier_applied';
      target: BattleSide;
      modifier: BattleModifierAttribute;
      source: BattleModifierSource;
      previousValue: number;
      nextValue: number;
    }
  | { type: 'block_absorbed'; target: BattleSide; amount: number }
  | {
      type: 'summon_intercepted';
      source: BattleSide;
      target: BattleSide;
      requested: number;
      intercepted: number;
      remaining: number;
      hits: Array<{ summonId: string; blocked: number; hpLost: number; defeated: boolean }>;
    }
  | {
      type: 'damage_resolved';
      source: BattleSide;
      target: BattleSide;
      requested: number;
      modified: number;
      blocked: number;
      hpLost: number;
      damageKind: import('./battleEventJournal').DamageKind;
    }
  | {
      type: 'heal_resolved';
      source: BattleSide;
      target: BattleSide;
      requested: number;
      modified: number;
      hpGained: number;
    }
  | {
      type: 'defeat_resolved';
      source: BattleSide;
      target: BattleSide;
      method: 'execute' | 'kill';
      succeeded: boolean;
      previousHp: number;
      threshold?: number;
      thresholdMode?: 'hp' | 'hp_percent';
      fatal: boolean;
      excludedBy?: string;
    }
  | {
      type: 'attribute_changed';
      target: BattleSide;
      attribute: BattleEffectAttribute;
      previousValue: number;
      nextValue: number;
    }
  | {
      type: 'attribute_logged';
      target: BattleSide;
      attribute: BattleEffectAttribute;
      previousValue: number;
      nextValue: number;
    }
  | {
      type: 'direct_modifier_changed';
      target: BattleSide;
      modifier: BattleModifierAttribute;
      operation: ModifierOperation;
      previousValue: number;
      nextValue: number;
    }
  | {
      type: 'resource_changed';
      target: BattleSide;
      resource: string;
      previousValue: number;
      nextValue: number;
      change: 'gain' | 'set';
    };

export interface BattleEffectStatePort {
  getPlayer(): Player;
  getEnemy(): Enemy | null;
  getEnemyById?(enemyId: string): Enemy | null;
  updatePlayer(updates: Partial<Player>): void;
  updateEnemy(updates: Partial<Enemy>): void;
  updateEnemyById?(enemyId: string, updates: Partial<Enemy>): void;
}

export interface BattleEffectRuntimePorts {
  readModifierSources(target: BattleSide, modifier: BattleModifierAttribute): readonly BattleModifierSource[];
  dispatchTriggers(dispatches: readonly BattleTriggerDispatch[]): Promise<void>;
  handleLustOverflow(target: BattleSide): Promise<void>;
  interceptDamage?(request: {
    source: BattleSide;
    target: BattleSide;
    amount: number;
    damageKind: import('./battleEventJournal').DamageKind;
    sourceEnemyId?: string;
    targetEnemyId?: string;
  }): Promise<{
    remainingDamage: number;
    interceptedDamage: number;
    hits: Array<{ summonId: string; blocked: number; hpLost: number; defeated: boolean }>;
  }>;
  present?(event: BattleEffectRuntimeEvent): void;
}

export interface BattleEffectRuntimeContext {
  source: BattleSide;
  /** Stable identity for an enemy source while the legacy active alias may move. */
  sourceEnemyId?: string;
  /** Stable identity for an enemy target selected by a multi-enemy selector. */
  targetEnemyId?: string;
  damageKind?: import('./battleEventJournal').DamageKind;
  bypassBlock?: boolean;
  /** Candidate journal metadata for triggers dispatched before the event is appended. */
  triggerEventContext?: BattleTriggerEventContext;
  /**
   * Optional source-local modifier set. Summons and other independent actors can
   * use their own modifiers without inheriting the owning combatant's direct or
   * passive outgoing modifiers.
   */
  sourceModifierSources?: Partial<Record<BattleModifierAttribute, readonly BattleModifierSource[]>>;
}

export interface BattleEffectRuntimeResult {
  applied: boolean;
  target?: BattleSide;
  pendingDeath?: boolean;
  blocked?: number;
  hpLost?: number;
  hpGained?: number;
  defeated?: boolean;
  fatal?: boolean;
  excludedBy?: string;
}

const BATTLE_EFFECT_COMMAND_TYPES = new Set<BattleEffectCommand['type']>([
  'damage',
  'execute',
  'kill',
  'heal',
  'gain_block',
  'gain_energy',
  'gain_resource',
  'set_resource',
  'gain_lust',
  'set_stat',
  'modify',
]);

export function isBattleEffectCommand(command: EffectCommand): command is BattleEffectCommand {
  return BATTLE_EFFECT_COMMAND_TYPES.has(command.type as BattleEffectCommand['type']);
}

export function resolveBattleEffectTarget(target: 'self' | 'opponent', source: BattleSide): BattleSide {
  if (target === 'self') return source;
  return source === 'player' ? 'enemy' : 'player';
}

function readAttribute(entity: Player | Enemy, attribute: BattleEffectAttribute): number {
  if (attribute === 'hp') return entity.currentHp;
  if (attribute === 'lust') return entity.currentLust;
  return entity[attribute];
}

function attributeUpdate(attribute: BattleEffectAttribute, value: number): Partial<Player> & Partial<Enemy> {
  if (attribute === 'hp') return { currentHp: value };
  if (attribute === 'lust') return { currentLust: value };
  return { [attribute]: value };
}

/** Host-independent execution for modern numeric battle commands. */
export class BattleEffectRuntime {
  public constructor(
    private readonly state: BattleEffectStatePort,
    private readonly ports: BattleEffectRuntimePorts,
  ) {}

  public async execute(
    command: BattleEffectCommand,
    context: BattleEffectRuntimeContext,
  ): Promise<BattleEffectRuntimeResult> {
    if (command.type === 'modify') return this.executeModifier(command, context);

    const target = resolveBattleEffectTarget(command.target, context.source);
    if (command.type === 'execute' || command.type === 'kill') {
      return this.executeDefeat(command, target, context);
    }
    if (command.type === 'set_stat') {
      return this.executeAttribute(target, context.source, command.stat, '=', command.value, [], context);
    }
    if (command.type === 'gain_resource' || command.type === 'set_resource') {
      const enemyId = target === 'enemy' ? context.targetEnemyId : undefined;
      const entity = this.getEntity(target, enemyId);
      if (!entity) return { applied: false, target };
      const resource = entity.resources?.[command.resource];
      if (!resource) return { applied: false, target };
      const previousValue = resource.current;
      const nextValue = Math.max(
        0,
        Math.min(resource.max, Math.floor(command.type === 'gain_resource' ? previousValue + command.amount : command.value)),
      );
      const resources = { ...(entity.resources || {}), [command.resource]: { ...resource, current: nextValue } };
      this.updateEntity(target, { resources }, enemyId);
      this.ports.present?.({
        type: 'resource_changed',
        target,
        resource: command.resource,
        previousValue,
        nextValue,
        change: command.type === 'gain_resource' ? 'gain' : 'set',
      });
      return { applied: true, target };
    }

    const definitions = {
      damage: {
        attribute: 'hp',
        operator: '-',
        modifiers: [
          { target: context.source, attribute: 'damage_modifier' },
          { target, attribute: 'damage_taken_modifier' },
        ],
      },
      heal: {
        attribute: 'hp',
        operator: '+',
        modifiers: [{ target: context.source, attribute: 'heal_modifier' }],
      },
      gain_block: {
        attribute: 'block',
        operator: '+',
        modifiers: [{ target, attribute: 'block_modifier' }],
      },
      gain_energy: { attribute: 'energy', operator: '+', modifiers: [] },
      gain_lust: {
        attribute: 'lust',
        operator: '+',
        modifiers: [
          { target: context.source, attribute: 'lust_damage_modifier' },
          { target, attribute: 'lust_damage_taken_modifier' },
        ],
      },
    } as const;
    const definition = definitions[command.type];
    const damageKind = command.type === 'damage'
      ? command.damageKind || context.damageKind || 'effect'
      : context.damageKind;
    const bypassBlock = command.type === 'damage'
      ? command.bypassBlock === true || command.damageKind === 'hp_loss'
      : false;
    const modifiers = command.type === 'damage' && damageKind === 'hp_loss'
      ? []
      : definition.modifiers;
    const result = await this.executeAttribute(
      target,
      context.source,
      definition.attribute,
      definition.operator,
      command.amount,
      modifiers,
      { ...context, ...(damageKind ? { damageKind } : {}), ...(bypassBlock ? { bypassBlock: true } : {}) },
    );
    if (command.type === 'damage' && result.applied && (command.lifesteal || 0) > 0 && (result.hpLost || 0) > 0) {
      await this.executeAttribute(
        context.source,
        context.source,
        'hp',
        '+',
        roundBattleValue((result.hpLost || 0) * (command.lifesteal || 0)),
        [{ target: context.source, attribute: 'heal_modifier' }],
        context,
      );
    }
    return result;
  }

  private getEntity(target: BattleSide, enemyId?: string): Player | Enemy | null {
    if (target === 'player') return this.state.getPlayer();
    return enemyId && this.state.getEnemyById ? this.state.getEnemyById(enemyId) : this.state.getEnemy();
  }

  private updateEntity(target: BattleSide, updates: Partial<Player> & Partial<Enemy>, enemyId?: string): void {
    if (target === 'player') this.state.updatePlayer(updates);
    else if (enemyId && this.state.updateEnemyById) this.state.updateEnemyById(enemyId, updates);
    else this.state.updateEnemy(updates);
  }

  private modifierSources(
    target: BattleSide,
    modifier: BattleModifierAttribute,
    enemyId?: string,
  ): BattleModifierSource[] {
    const sources = [...this.ports.readModifierSources(target, modifier)];
    const direct = this.getEntity(target, enemyId)?.modifiers?.[modifier];
    if (typeof direct === 'number' && direct !== 0) {
      sources.push({ operation: { operator: '+', value: direct }, name: 'direct' });
    }
    return sources;
  }

  private applyModifiers(
    value: number,
    definitions: readonly { target: BattleSide; attribute: BattleModifierAttribute }[],
    context: BattleEffectRuntimeContext,
  ): number {
    let result = value;
    for (const definition of definitions) {
      const enemyId = definition.target === 'enemy'
        ? definition.target === context.source
          ? context.sourceEnemyId || context.targetEnemyId
          : context.targetEnemyId
        : undefined;
      const independentSourceModifiers = definition.target === context.source
        ? context.sourceModifierSources?.[definition.attribute]
        : undefined;
      const sources = independentSourceModifiers === undefined
        ? this.modifierSources(definition.target, definition.attribute, enemyId)
        : [...independentSourceModifiers];
      for (const source of sources) {
        const previousValue = result;
        result = applyModifierOperation(result, source.operation);
        this.ports.present?.({
          type: 'modifier_applied',
          target: definition.target,
          modifier: definition.attribute,
          source,
          previousValue: roundBattleValue(previousValue),
          nextValue: roundBattleValue(result),
        });
      }
    }
    return result;
  }

  private async executeAttribute(
    target: BattleSide,
    source: BattleSide,
    attribute: BattleEffectAttribute,
    operator: '+' | '-' | '=',
    requestedValue: number,
    modifiers: readonly { target: BattleSide; attribute: BattleModifierAttribute }[],
    context: BattleEffectRuntimeContext,
  ): Promise<BattleEffectRuntimeResult> {
    const enemyId = target === 'enemy' ? context.targetEnemyId : undefined;
    let entity = this.getEntity(target, enemyId);
    if (!entity) return { applied: false, target };

    const baseRequested = roundBattleValue(Number.isFinite(requestedValue) ? requestedValue : 0);
    const eventContext: BattleTriggerEventContext = {
      ...(context.triggerEventContext || {}),
      eventRecorded: false,
      phase: 'resolve',
      actorId: source === 'player' ? 'player' : context.sourceEnemyId || context.triggerEventContext?.actorId || 'enemy',
      targetId: target === 'player' ? 'player' : enemyId || context.triggerEventContext?.targetId || 'enemy',
      ...(attribute === 'hp' && operator === '-'
        ? { kind: 'damage_resolved' as const, damageKind: context.damageKind || 'effect' }
        : attribute === 'hp' && operator === '+'
          ? { kind: 'heal_resolved' as const }
          : {}),
    };
    let value = roundBattleValue(
      this.applyModifiers(Number.isFinite(requestedValue) ? requestedValue : 0, modifiers, context),
    );
    const modifiedRequested = value;
    let blocked = 0;
    if (attribute === 'hp' && operator === '-') {
      const absorption = context.bypassBlock
        ? { damage: value, blockUsed: 0, remainingBlock: entity.block }
        : absorbDamageWithBlock(value, entity.block);
      if (absorption.blockUsed > 0) {
        blocked = absorption.blockUsed;
        this.updateEntity(target, { block: absorption.remainingBlock }, enemyId);
        this.ports.present?.({ type: 'block_absorbed', target, amount: absorption.blockUsed });
        await this.ports.dispatchTriggers(
          resolveAttributeTriggerDispatch({
            attribute: 'block',
            change: -absorption.blockUsed,
            target,
            source,
            eventContext,
          }),
        );
        entity = this.getEntity(target, enemyId);
        if (!entity) return { applied: false, target };
      }
      value = absorption.damage;
      if (value > 0 && context.damageKind === 'attack' && this.ports.interceptDamage) {
        const intercepted = await this.ports.interceptDamage({
          source,
          target,
          amount: value,
          damageKind: context.damageKind,
          ...(context.sourceEnemyId ? { sourceEnemyId: context.sourceEnemyId } : {}),
          ...(context.targetEnemyId ? { targetEnemyId: context.targetEnemyId } : {}),
        });
        if (intercepted.interceptedDamage > 0) {
          this.ports.present?.({
            type: 'summon_intercepted',
            source,
            target,
            requested: value,
            intercepted: intercepted.interceptedDamage,
            remaining: intercepted.remainingDamage,
            hits: intercepted.hits,
          });
        }
        value = Math.max(0, roundBattleValue(intercepted.remainingDamage));
      }
    }

    entity = this.getEntity(target, enemyId);
    if (!entity) return { applied: false, target };
    const previousValue = readAttribute(entity, attribute);
    const calculated = applyNumericOperator(previousValue, operator, value);
    const clamped = clampBattleAttribute(attribute, calculated, {
      maxHp: entity.maxHp,
      maxLust: entity.maxLust,
    });
    const nextValue = roundBattleValue(clamped);
    this.updateEntity(target, attributeUpdate(attribute, nextValue), enemyId);
    this.ports.present?.({ type: 'attribute_changed', target, attribute, previousValue, nextValue });

    const change = roundBattleValue(nextValue - previousValue);
    await this.ports.dispatchTriggers(
      resolveAttributeTriggerDispatch({ attribute, change, target, source, eventContext }),
    );

    if (attribute === 'lust') {
      const finalEntity = this.getEntity(target, enemyId);
      if (finalEntity && finalEntity.currentLust >= finalEntity.maxLust) {
        await this.ports.handleLustOverflow(target);
      }
    }
    this.ports.present?.({ type: 'attribute_logged', target, attribute, previousValue, nextValue });

    if (attribute === 'hp' && operator === '-') {
      this.ports.present?.({
        type: 'damage_resolved',
        source,
        target,
        requested: baseRequested,
        modified: modifiedRequested,
        blocked,
        hpLost: Math.max(0, -change),
        damageKind: context.damageKind || 'effect',
      });
    } else if (attribute === 'hp' && operator === '+') {
      this.ports.present?.({
        type: 'heal_resolved',
        source,
        target,
        requested: baseRequested,
        modified: modifiedRequested,
        hpGained: Math.max(0, change),
      });
    }

    if (attribute !== 'hp') return { applied: true, target };
    const finalEntity = this.getEntity(target, enemyId);
    return {
      applied: true,
      target,
      pendingDeath: Boolean(finalEntity && finalEntity.currentHp <= 0),
      ...(operator === '-' ? { blocked, hpLost: Math.max(0, -change) } : {}),
      ...(operator === '+' ? { hpGained: Math.max(0, change) } : {}),
    };
  }

  private executeModifier(
    command: Extract<BattleEffectCommand, { type: 'modify' }>,
    context: BattleEffectRuntimeContext,
  ): BattleEffectRuntimeResult {
    const target = resolveBattleEffectTarget(command.target, context.source);
    const enemyId = target === 'enemy' ? context.targetEnemyId : undefined;
    const entity = this.getEntity(target, enemyId);
    if (!entity) return { applied: false, target };
    const modifier = MODIFIER_ATTRIBUTE_BY_STAT[command.stat];
    const previousValue = entity.modifiers?.[modifier] || 0;
    const operation: ModifierOperation = {
      operator: MODIFIER_SYMBOL_BY_OPERATOR[command.operator],
      value: command.value,
    };
    const nextValue = applyModifierOperation(previousValue, operation);
    this.updateEntity(target, { modifiers: { ...(entity.modifiers || {}), [modifier]: nextValue } }, enemyId);
    this.ports.present?.({
      type: 'direct_modifier_changed',
      target,
      modifier,
      operation,
      previousValue,
      nextValue,
    });
    return { applied: true, target };
  }

  private executeDefeat(
    command: Extract<BattleEffectCommand, { type: 'execute' | 'kill' }>,
    target: BattleSide,
    context: BattleEffectRuntimeContext,
  ): BattleEffectRuntimeResult {
    const enemyId = target === 'enemy' ? context.targetEnemyId : undefined;
    const entity = this.getEntity(target, enemyId);
    if (!entity) return { applied: false, target };
    const excludedBy = command.excludeTags?.find(tag => entity.tags?.includes(tag));
    const thresholdHp = command.type === 'kill'
      ? Number.POSITIVE_INFINITY
      : command.thresholdMode === 'hp_percent'
        ? roundBattleValue(entity.maxHp * command.threshold / 100)
        : command.threshold;
    const defeated = !excludedBy && entity.currentHp > 0 && entity.currentHp <= thresholdHp;
    const previousHp = entity.currentHp;
    if (defeated) this.updateEntity(target, { currentHp: 0 }, enemyId);
    const fatal = defeated && command.triggerFatal !== false;
    this.ports.present?.({
      type: 'defeat_resolved',
      source: context.source,
      target,
      method: command.type,
      succeeded: defeated,
      previousHp,
      ...(command.type === 'execute'
        ? { threshold: command.threshold, thresholdMode: command.thresholdMode }
        : {}),
      fatal,
      ...(excludedBy ? { excludedBy } : {}),
    });
    return {
      applied: true,
      target,
      pendingDeath: defeated,
      defeated,
      fatal,
      ...(excludedBy ? { excludedBy } : {}),
    };
  }
}
