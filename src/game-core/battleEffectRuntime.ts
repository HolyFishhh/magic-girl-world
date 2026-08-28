import { absorbDamageWithBlock, applyNumericOperator, clampBattleAttribute, roundBattleValue } from './battleMath';
import { resolveAttributeTriggerDispatch, type BattleSide, type BattleTriggerDispatch } from './battleEventDispatch';
import type { Enemy, Player } from './battleState';
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
      | 'heal'
      | 'gain_block'
      | 'gain_energy'
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
    };

export interface BattleEffectStatePort {
  getPlayer(): Player;
  getEnemy(): Enemy | null;
  updatePlayer(updates: Partial<Player>): void;
  updateEnemy(updates: Partial<Enemy>): void;
}

export interface BattleEffectRuntimePorts {
  readModifierSources(target: BattleSide, modifier: BattleModifierAttribute): readonly BattleModifierSource[];
  dispatchTriggers(dispatches: readonly BattleTriggerDispatch[]): Promise<void>;
  handleLustOverflow(target: BattleSide): Promise<void>;
  present?(event: BattleEffectRuntimeEvent): void;
}

export interface BattleEffectRuntimeContext {
  source: BattleSide;
}

export interface BattleEffectRuntimeResult {
  applied: boolean;
  target?: BattleSide;
  pendingDeath?: boolean;
}

const BATTLE_EFFECT_COMMAND_TYPES = new Set<BattleEffectCommand['type']>([
  'damage',
  'heal',
  'gain_block',
  'gain_energy',
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
    if (command.type === 'set_stat') {
      return this.executeAttribute(target, context.source, command.stat, '=', command.value, []);
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
    return this.executeAttribute(
      target,
      context.source,
      definition.attribute,
      definition.operator,
      command.amount,
      definition.modifiers,
    );
  }

  private getEntity(target: BattleSide): Player | Enemy | null {
    return target === 'player' ? this.state.getPlayer() : this.state.getEnemy();
  }

  private updateEntity(target: BattleSide, updates: Partial<Player> & Partial<Enemy>): void {
    if (target === 'player') this.state.updatePlayer(updates);
    else this.state.updateEnemy(updates);
  }

  private modifierSources(target: BattleSide, modifier: BattleModifierAttribute): BattleModifierSource[] {
    const sources = [...this.ports.readModifierSources(target, modifier)];
    const direct = this.getEntity(target)?.modifiers?.[modifier];
    if (typeof direct === 'number' && direct !== 0) {
      sources.push({ operation: { operator: '+', value: direct }, name: 'direct' });
    }
    return sources;
  }

  private applyModifiers(
    value: number,
    definitions: readonly { target: BattleSide; attribute: BattleModifierAttribute }[],
  ): number {
    let result = value;
    for (const definition of definitions) {
      for (const source of this.modifierSources(definition.target, definition.attribute)) {
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
  ): Promise<BattleEffectRuntimeResult> {
    let entity = this.getEntity(target);
    if (!entity) return { applied: false, target };

    let value = roundBattleValue(
      this.applyModifiers(Number.isFinite(requestedValue) ? requestedValue : 0, modifiers),
    );
    if (attribute === 'hp' && operator === '-') {
      const absorption = absorbDamageWithBlock(value, entity.block);
      if (absorption.blockUsed > 0) {
        this.updateEntity(target, { block: absorption.remainingBlock });
        this.ports.present?.({ type: 'block_absorbed', target, amount: absorption.blockUsed });
        await this.ports.dispatchTriggers(
          resolveAttributeTriggerDispatch({
            attribute: 'block',
            change: -absorption.blockUsed,
            target,
            source,
          }),
        );
        entity = this.getEntity(target);
        if (!entity) return { applied: false, target };
      }
      value = absorption.damage;
    }

    entity = this.getEntity(target);
    if (!entity) return { applied: false, target };
    const previousValue = readAttribute(entity, attribute);
    const calculated = applyNumericOperator(previousValue, operator, value);
    const clamped = clampBattleAttribute(attribute, calculated, {
      maxHp: entity.maxHp,
      maxLust: entity.maxLust,
    });
    const nextValue = roundBattleValue(clamped);
    this.updateEntity(target, attributeUpdate(attribute, nextValue));
    this.ports.present?.({ type: 'attribute_changed', target, attribute, previousValue, nextValue });

    const change = roundBattleValue(nextValue - previousValue);
    await this.ports.dispatchTriggers(
      resolveAttributeTriggerDispatch({ attribute, change, target, source }),
    );

    if (attribute === 'lust') {
      const finalEntity = this.getEntity(target);
      if (finalEntity && finalEntity.currentLust >= finalEntity.maxLust) {
        await this.ports.handleLustOverflow(target);
      }
    }
    this.ports.present?.({ type: 'attribute_logged', target, attribute, previousValue, nextValue });

    if (attribute !== 'hp') return { applied: true, target };
    const finalEntity = this.getEntity(target);
    return { applied: true, target, pendingDeath: Boolean(finalEntity && finalEntity.currentHp <= 0) };
  }

  private executeModifier(
    command: Extract<BattleEffectCommand, { type: 'modify' }>,
    context: BattleEffectRuntimeContext,
  ): BattleEffectRuntimeResult {
    const target = resolveBattleEffectTarget(command.target, context.source);
    const entity = this.getEntity(target);
    if (!entity) return { applied: false, target };
    const modifier = MODIFIER_ATTRIBUTE_BY_STAT[command.stat];
    const previousValue = entity.modifiers?.[modifier] || 0;
    const operation: ModifierOperation = {
      operator: MODIFIER_SYMBOL_BY_OPERATOR[command.operator],
      value: command.value,
    };
    const nextValue = applyModifierOperation(previousValue, operation);
    this.updateEntity(target, { modifiers: { ...(entity.modifiers || {}), [modifier]: nextValue } });
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
}
