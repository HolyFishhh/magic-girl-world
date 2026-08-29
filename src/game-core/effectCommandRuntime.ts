import {
  EffectExecutionError,
  evaluateConditionExpression,
  evaluateNumericExpression,
  validateEffectProgram,
  type CardSelector,
  type CardPlayRuleKind,
  type CardValueOperator,
  type CardValueStat,
  type CoreEffectState,
  type EffectExecutionContext,
  type EffectCardPatch,
  type EffectCardAttachmentDefinition,
  type EffectCardUpgradeChange,
  type EffectSchedulePhase,
  type EffectStanceDefinition,
  type EffectOrbDefinition,
  type EffectOrbSelector,
  type EffectCardPileZone,
  type EffectModifierOperator,
  type EffectNode,
  type EffectProgram,
  type EffectTarget,
  type EffectTrigger,
  type GeneratedCardDefinition,
  type ModifierStat,
  type NumericExpression,
  type RecoverCardZone,
  type EffectSummonDefinition,
  type EffectEnemySpawnDefinition,
  type SummonValueOperator,
  type SummonValueStat,
} from './effectDsl';
import type { EnemyTargetSelector } from './combatantCollection';
import type { SummonOverflowPolicy, SummonSelector } from './summonUnit';
import { roundBattleValue } from './battleMath';
import type { CardAttachmentChange } from './cardAttachment';

export type ResolvedEffectCardAttachmentDefinition = Omit<EffectCardAttachmentDefinition, 'changes'> & {
  changes: CardAttachmentChange[];
};

export type EffectCommand =
  | {
      type: 'damage'; target: EffectTarget; targetSelector?: EnemyTargetSelector; amount: number;
      damageKind?: Exclude<import('./battleEventJournal').DamageKind, 'execute'>;
      bypassBlock?: boolean; lifesteal?: number;
    }
  | {
      type: 'execute'; target: EffectTarget; targetSelector?: EnemyTargetSelector; threshold: number;
      thresholdMode: 'hp' | 'hp_percent'; excludeTags?: string[]; triggerFatal: boolean;
    }
  | {
      type: 'kill'; target: EffectTarget; targetSelector?: EnemyTargetSelector;
      excludeTags?: string[]; triggerFatal: boolean;
    }
  | { type: 'heal' | 'gain_block' | 'gain_energy' | 'gain_lust'; target: EffectTarget; targetSelector?: EnemyTargetSelector; amount: number }
  | { type: 'gain_resource'; target: EffectTarget; targetSelector?: EnemyTargetSelector; resource: string; amount: number }
  | { type: 'set_resource'; target: EffectTarget; targetSelector?: EnemyTargetSelector; resource: string; value: number }
  | { type: 'set_stat'; target: EffectTarget; targetSelector?: EnemyTargetSelector; stat: 'hp' | 'lust' | 'energy' | 'block'; value: number }
  | { type: 'apply_status'; target: EffectTarget; targetSelector?: EnemyTargetSelector; status: string; stacks: number }
  | { type: 'remove_status'; target: EffectTarget; targetSelector?: EnemyTargetSelector; status: string }
  | { type: 'draw_cards'; amount: number }
  | { type: 'scry_cards'; amount: number }
  | { type: 'discard_cards'; selector: CardSelector; amount: number }
  | { type: 'exhaust_cards'; selector: CardSelector; amount: number }
  | { type: 'recover_cards'; source: RecoverCardZone; pick: 'random' | 'choose' | 'all'; amount: number }
  | { type: 'reduce_card_cost'; selector: CardSelector; amount: number }
  | {
      type: 'modify_card_value';
      selector: CardSelector;
      stat: CardValueStat;
      operator: CardValueOperator;
      value: number;
    }
  | { type: 'copy_cards'; selector: CardSelector }
  | { type: 'double_card_effect'; selector: CardSelector }
  | { type: 'auto_play_cards'; selector: CardSelector; free: boolean }
  | { type: 'set_card_destination'; destination: import('./cardRules').PlayedCardDestination }
  | { type: 'move_cards'; selector: CardSelector; amount: number; destination: EffectCardPileZone; position: 'top' | 'bottom' }
  | { type: 'remove_cards'; selector: CardSelector; amount: number }
  | { type: 'transform_cards'; selector: CardSelector; replacement: GeneratedCardDefinition }
  | { type: 'apply_card_patch'; selector: CardSelector; patch: EffectCardPatch }
  | { type: 'apply_card_attachment'; selector: CardSelector; attachment: ResolvedEffectCardAttachmentDefinition }
  | {
      type: 'upgrade_cards'; selector: CardSelector; scope: 'combat' | 'run' | 'permanent'; levels: number;
      maxLevel?: number; changes: EffectCardUpgradeChange[];
    }
  | { type: 'add_card'; zone: 'hand' | 'draw'; card: GeneratedCardDefinition; count: number }
  | {
      type: 'ensure_card'; zone: 'hand' | 'draw'; card: GeneratedCardDefinition;
      minimum: number; includeCopies: boolean;
    }
  | {
      type: 'spawn_summon'; target: EffectTarget; summon: EffectSummonDefinition; count: number;
      capacity: number; overflow: SummonOverflowPolicy;
    }
  | { type: 'spawn_enemy'; enemy: EffectEnemySpawnDefinition; count: number; capacity: number }
  | { type: 'damage_summons' | 'heal_summons'; selector: SummonSelector; amount: number }
  | {
      type: 'modify_summons'; selector: SummonSelector; stat: SummonValueStat;
      operator: SummonValueOperator; value: number;
    }
  | {
      type: 'modify_summon_effects'; selector: SummonSelector; stat: CardValueStat;
      operator: CardValueOperator; value: number;
    }
  | { type: 'gain_summon_resource'; selector: SummonSelector; resource: string; amount: number }
  | { type: 'set_summon_resource'; selector: SummonSelector; resource: string; value: number }
  | { type: 'apply_summon_status'; selector: SummonSelector; status: string; stacks: number }
  | { type: 'remove_summon_status'; selector: SummonSelector; status: string }
  | { type: 'activate_summons'; selector: SummonSelector }
  | { type: 'dismiss_summons'; selector: SummonSelector; retainCorpse: boolean }
  | {
      type: 'copy_summons'; selector: SummonSelector; targetOwner: 'same' | EffectTarget;
      capacity: number; overflow: SummonOverflowPolicy;
    }
  | { type: 'summoner_effects'; effects: EffectNode[] }
  | {
      type: 'modify';
      target: EffectTarget;
      targetSelector?: EnemyTargetSelector;
      stat: ModifierStat;
      operator: EffectModifierOperator;
      value: number;
    }
  | {
      type: 'card_play_rule';
      target: EffectTarget;
      rule: CardPlayRuleKind;
      limit?: number | 'all';
      extra: number;
      selector?: CardSelector;
      destination?: import('./cardRules').PlayedCardDestination;
      priority: number;
      freeResources?: 'all' | string[];
    }
  | {
      type: 'set_stance'; target: EffectTarget; targetSelector?: EnemyTargetSelector;
      stance: EffectStanceDefinition | null;
    }
  | {
      type: 'channel_orb'; target: EffectTarget; targetSelector?: EnemyTargetSelector;
      orb: EffectOrbDefinition;
    }
  | {
      type: 'evoke_orbs'; target: EffectTarget; targetSelector?: EnemyTargetSelector;
      selector: EffectOrbSelector;
    }
  | {
      type: 'set_orb_slots'; target: EffectTarget; targetSelector?: EnemyTargetSelector;
      amount: number;
    }
  | {
      type: 'modify_orbs'; target: EffectTarget; targetSelector?: EnemyTargetSelector;
      selector: EffectOrbSelector; operator: CardValueOperator; value: number;
    }
  | { type: 'grant_extra_turn'; target: EffectTarget; amount: number }
  | { type: 'force_end_turn'; target: EffectTarget }
  | {
      type: 'register_trigger'; target: EffectTarget; trigger: EffectTrigger;
      eventQuery?: import('./battleEventJournal').EventTriggerQuery; effects: EffectNode[];
    }
  | {
      type: 'schedule_effect';
      afterTurns: number;
      phase: EffectSchedulePhase;
      priority: number;
      repeatEvery?: number;
      repeats?: number;
      effects: EffectNode[];
    }
  | { type: 'choice_selected'; choiceId: string; optionId: string; label: string }
  | { type: 'narration'; text: string };

export interface EffectCommandRuntimePorts {
  readState(): CoreEffectState;
  execute(command: EffectCommand, path: string): void | Promise<void>;
  isTerminal?(): boolean;
  chooseEffectOption?(
    choice: Extract<EffectNode, { op: 'choose_one' }>,
    path: string,
  ): string | null | Promise<string | null>;
}

export interface EffectCommandRuntimeResult {
  completed: boolean;
  commands: EffectCommand[];
  stoppedAfter?: string;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function readAmount(
  expression: NumericExpression,
  state: CoreEffectState,
  context: EffectExecutionContext,
  path: string,
  discrete = false,
  allowNegative = false,
): number {
  const evaluated = evaluateNumericExpression(expression, state, context, path);
  const value = discrete ? Math.floor(evaluated) : roundBattleValue(evaluated);
  if (!allowNegative && value < 0) throw new EffectExecutionError('NEGATIVE_AMOUNT', path, '该效果的数量不能为负数');
  return value;
}

function createCommand(
  node: Exclude<EffectNode, { op: 'if' } | { op: 'choose_one' }>,
  state: CoreEffectState,
  context: EffectExecutionContext,
  path: string,
): EffectCommand {
  if (node.op === 'narrate') return { type: 'narration', text: node.text };
  if (node.op === 'draw_cards' || node.op === 'scry_cards') {
    return { type: node.op, amount: readAmount(node.amount, state, context, `${path}.amount`, true) };
  }
  if (node.op === 'discard_cards' || node.op === 'exhaust_cards') {
    return {
      type: node.op,
      selector: clone(node.selector),
      amount: readAmount(node.amount, state, context, `${path}.amount`, true),
    };
  }
  if (node.op === 'recover_cards') {
    return {
      type: 'recover_cards',
      source: node.source,
      pick: node.pick,
      amount: readAmount(node.amount, state, context, `${path}.amount`, true),
    };
  }
  if (node.op === 'reduce_card_cost') {
    return {
      type: 'reduce_card_cost',
      selector: clone(node.selector),
      amount: readAmount(node.amount, state, context, `${path}.amount`, true),
    };
  }
  if (node.op === 'modify_card_value') {
    return {
      type: 'modify_card_value',
      selector: clone(node.selector),
      stat: node.stat,
      operator: node.operator,
      value: roundBattleValue(evaluateNumericExpression(node.value, state, context, `${path}.value`)),
    };
  }
  if (node.op === 'copy_cards' || node.op === 'double_card_effect') {
    return { type: node.op, selector: clone(node.selector) };
  }
  if (node.op === 'auto_play_cards') {
    return { type: 'auto_play_cards', selector: clone(node.selector), free: node.free };
  }
  if (node.op === 'set_card_destination') {
    return { type: 'set_card_destination', destination: node.destination };
  }
  if (node.op === 'move_cards') {
    return {
      type: 'move_cards', selector: clone(node.selector), amount: node.amount,
      destination: node.destination, position: node.position,
    };
  }
  if (node.op === 'remove_cards') {
    return { type: 'remove_cards', selector: clone(node.selector), amount: node.amount };
  }
  if (node.op === 'transform_cards') {
    return { type: 'transform_cards', selector: clone(node.selector), replacement: clone(node.replacement) };
  }
  if (node.op === 'apply_card_patch') {
    const patch = clone(node.patch);
    if (patch.kind === 'numeric' || patch.kind === 'cost' || patch.kind === 'x_value') {
      patch.value = roundBattleValue(evaluateNumericExpression(patch.value, state, context, `${path}.patch.value`));
    } else if (patch.kind === 'replay') {
      patch.extra = Math.max(1, Math.floor(evaluateNumericExpression(patch.extra, state, context, `${path}.patch.extra`)));
    }
    return { type: 'apply_card_patch', selector: clone(node.selector), patch };
  }
  if (node.op === 'apply_card_attachment') {
    const attachment = clone(node.attachment);
    attachment.changes.forEach((change, index) => {
      if (change.kind === 'numeric' || change.kind === 'cost' || change.kind === 'x_value') {
        change.value = roundBattleValue(evaluateNumericExpression(
          change.value,
          state,
          context,
          `${path}.attachment.changes[${index}].value`,
        ));
      } else if (change.kind === 'replay') {
        change.extra = Math.max(1, Math.floor(evaluateNumericExpression(
          change.extra,
          state,
          context,
          `${path}.attachment.changes[${index}].extra`,
        )));
      }
    });
    return {
      type: 'apply_card_attachment',
      selector: clone(node.selector),
      attachment: attachment as ResolvedEffectCardAttachmentDefinition,
    };
  }
  if (node.op === 'upgrade_cards') {
    const changes = clone(node.changes);
    changes.forEach((change, index) => {
      if (change.kind === 'numeric' || change.kind === 'cost' || change.kind === 'x_value') {
        change.value = roundBattleValue(evaluateNumericExpression(change.value, state, context, `${path}.changes[${index}].value`));
      } else if (change.kind === 'replay') {
        change.extra = Math.max(1, Math.floor(evaluateNumericExpression(change.extra, state, context, `${path}.changes[${index}].extra`)));
      }
    });
    return {
      type: 'upgrade_cards', selector: clone(node.selector), scope: node.scope, levels: node.levels,
      ...(node.maxLevel !== undefined ? { maxLevel: node.maxLevel } : {}), changes,
    };
  }
  if (node.op === 'add_card') {
    return { type: 'add_card', zone: node.zone, card: clone(node.card), count: node.count };
  }
  if (node.op === 'ensure_card') {
    return {
      type: 'ensure_card', zone: node.zone, card: clone(node.card), minimum: node.minimum,
      includeCopies: node.includeCopies === true,
    };
  }
  if (node.op === 'spawn_summon') {
    return {
      type: 'spawn_summon', target: node.target, summon: clone(node.summon),
      count: readAmount(node.count, state, context, `${path}.count`, true),
      capacity: node.capacity ?? 3, overflow: node.overflow ?? 'replace_oldest',
    };
  }
  if (node.op === 'spawn_enemy') {
    return {
      type: 'spawn_enemy', enemy: clone(node.enemy),
      count: readAmount(node.count, state, context, `${path}.count`, true),
      capacity: node.capacity ?? 8,
    };
  }
  if (node.op === 'damage_summons' || node.op === 'heal_summons') {
    return {
      type: node.op, selector: clone(node.selector),
      amount: readAmount(node.amount, state, context, `${path}.amount`),
    };
  }
  if (node.op === 'modify_summons') {
    return {
      type: 'modify_summons', selector: clone(node.selector), stat: node.stat, operator: node.operator,
      value: roundBattleValue(evaluateNumericExpression(node.value, state, context, `${path}.value`)),
    };
  }
  if (node.op === 'modify_summon_effects') {
    return {
      type: 'modify_summon_effects', selector: clone(node.selector), stat: node.stat, operator: node.operator,
      value: roundBattleValue(evaluateNumericExpression(node.value, state, context, `${path}.value`)),
    };
  }
  if (node.op === 'gain_summon_resource') {
    return {
      type: 'gain_summon_resource', selector: clone(node.selector), resource: node.resource,
      amount: readAmount(node.amount, state, context, `${path}.amount`, true, true),
    };
  }
  if (node.op === 'set_summon_resource') {
    return {
      type: 'set_summon_resource', selector: clone(node.selector), resource: node.resource,
      value: readAmount(node.value, state, context, `${path}.value`, true, true),
    };
  }
  if (node.op === 'apply_summon_status') {
    return {
      type: 'apply_summon_status', selector: clone(node.selector), status: node.status,
      stacks: readAmount(node.stacks, state, context, `${path}.stacks`, true),
    };
  }
  if (node.op === 'remove_summon_status') {
    return { type: 'remove_summon_status', selector: clone(node.selector), status: node.status };
  }
  if (node.op === 'activate_summons') return { type: 'activate_summons', selector: clone(node.selector) };
  if (node.op === 'dismiss_summons') {
    return { type: 'dismiss_summons', selector: clone(node.selector), retainCorpse: node.retainCorpse === true };
  }
  if (node.op === 'copy_summons') {
    return {
      type: 'copy_summons', selector: clone(node.selector), targetOwner: node.targetOwner ?? 'same',
      capacity: node.capacity ?? 3, overflow: node.overflow ?? 'replace_oldest',
    };
  }
  if (node.op === 'summoner_effects') {
    return { type: 'summoner_effects', effects: clone(node.effects) };
  }
  if (node.op === 'modify') {
    return {
      type: 'modify',
      target: node.target,
      ...(node.targetSelector ? { targetSelector: clone(node.targetSelector) } : {}),
      stat: node.stat,
      operator: node.operator,
      value: roundBattleValue(evaluateNumericExpression(node.value, state, context, `${path}.value`)),
    };
  }
  if (node.op === 'card_play_rule') {
    return {
      type: 'card_play_rule',
      target: node.target,
      rule: node.rule,
      ...(node.limit === undefined
        ? {}
        : { limit: node.limit === 'all'
          ? 'all'
          : Math.max(0, Math.floor(evaluateNumericExpression(node.limit, state, context, `${path}.limit`))) }),
      extra:
        node.rule === 'replay' && node.extra !== undefined
          ? Math.max(1, Math.floor(evaluateNumericExpression(node.extra, state, context, `${path}.extra`)))
          : 0,
      ...(node.selector ? { selector: clone(node.selector) } : {}),
      ...(node.destination ? { destination: node.destination } : {}),
      ...(node.freeResources ? { freeResources: clone(node.freeResources) } : {}),
      priority: node.priority || 0,
    };
  }
  if (node.op === 'set_stance') {
    return {
      type: 'set_stance', target: node.target,
      ...(node.targetSelector ? { targetSelector: clone(node.targetSelector) } : {}),
      stance: clone(node.stance),
    };
  }
  if (node.op === 'channel_orb') {
    const orb = clone(node.orb);
    orb.value = roundBattleValue(evaluateNumericExpression(node.orb.value, state, context, `${path}.orb.value`));
    return {
      type: 'channel_orb', target: node.target,
      ...(node.targetSelector ? { targetSelector: clone(node.targetSelector) } : {}), orb,
    };
  }
  if (node.op === 'evoke_orbs') {
    return {
      type: 'evoke_orbs', target: node.target,
      ...(node.targetSelector ? { targetSelector: clone(node.targetSelector) } : {}), selector: clone(node.selector),
    };
  }
  if (node.op === 'set_orb_slots') {
    return {
      type: 'set_orb_slots', target: node.target,
      ...(node.targetSelector ? { targetSelector: clone(node.targetSelector) } : {}),
      amount: readAmount(node.amount, state, context, `${path}.amount`, true),
    };
  }
  if (node.op === 'modify_orbs') {
    return {
      type: 'modify_orbs', target: node.target,
      ...(node.targetSelector ? { targetSelector: clone(node.targetSelector) } : {}),
      selector: clone(node.selector), operator: node.operator,
      value: roundBattleValue(evaluateNumericExpression(node.value, state, context, `${path}.value`)),
    };
  }
  if (node.op === 'grant_extra_turn') {
    return { type: 'grant_extra_turn', target: node.target, amount: readAmount(node.amount, state, context, `${path}.amount`, true) };
  }
  if (node.op === 'force_end_turn') return { type: 'force_end_turn', target: node.target };
  if (node.op === 'register_trigger') {
    return {
      type: 'register_trigger',
      target: node.target,
      trigger: node.trigger,
      ...(node.eventQuery ? { eventQuery: clone(node.eventQuery) } : {}),
      effects: clone(node.effects),
    };
  }
  if (node.op === 'schedule_effect') {
    return {
      type: 'schedule_effect',
      afterTurns: node.afterTurns,
      phase: node.phase,
      priority: node.priority || 0,
      ...(node.repeatEvery !== undefined ? { repeatEvery: node.repeatEvery } : {}),
      ...(node.repeats !== undefined ? { repeats: node.repeats } : {}),
      effects: clone(node.effects),
    };
  }
  if (node.op === 'apply_status') {
    return {
      type: 'apply_status',
      target: node.target,
      ...(node.targetSelector ? { targetSelector: clone(node.targetSelector) } : {}),
      status: node.status,
      stacks: readAmount(node.stacks, state, context, `${path}.stacks`, true),
    };
  }
  if (node.op === 'remove_status') {
    return { type: 'remove_status', target: node.target, ...(node.targetSelector ? { targetSelector: clone(node.targetSelector) } : {}), status: node.status };
  }
  if (node.op === 'set_stat') {
    return {
      type: 'set_stat',
      target: node.target,
      ...(node.targetSelector ? { targetSelector: clone(node.targetSelector) } : {}),
      stat: node.stat,
      value:
        node.stat === 'energy'
          ? Math.floor(evaluateNumericExpression(node.value, state, context, `${path}.value`))
          : roundBattleValue(evaluateNumericExpression(node.value, state, context, `${path}.value`)),
    };
  }
  if (node.op === 'gain_resource' || node.op === 'set_resource') {
    const common = {
      target: node.target,
      ...(node.targetSelector ? { targetSelector: clone(node.targetSelector) } : {}),
      resource: node.resource,
    };
    return node.op === 'gain_resource'
      ? { type: 'gain_resource', ...common, amount: readAmount(node.amount, state, context, `${path}.amount`, true, true) }
      : { type: 'set_resource', ...common, value: readAmount(node.value, state, context, `${path}.value`, true, true) };
  }
  if (node.op === 'damage') {
    return {
      type: 'damage',
      target: node.target,
      ...(node.targetSelector ? { targetSelector: clone(node.targetSelector) } : {}),
      amount: readAmount(node.amount, state, context, `${path}.amount`),
      ...(node.damageKind ? { damageKind: node.damageKind } : {}),
      ...(node.bypassBlock !== undefined ? { bypassBlock: node.bypassBlock } : {}),
      ...(node.lifesteal !== undefined
        ? { lifesteal: readAmount(node.lifesteal, state, context, `${path}.lifesteal`) }
        : {}),
    };
  }
  if (node.op === 'execute' || node.op === 'kill') {
    return {
      type: node.op,
      target: node.target,
      ...(node.targetSelector ? { targetSelector: clone(node.targetSelector) } : {}),
      ...(node.op === 'execute'
        ? {
            threshold: readAmount(node.threshold, state, context, `${path}.threshold`),
            thresholdMode: node.thresholdMode,
          }
        : {}),
      ...(node.excludeTags ? { excludeTags: [...node.excludeTags] } : {}),
      triggerFatal: node.triggerFatal !== false,
    } as EffectCommand;
  }
  return {
    type: node.op,
    target: node.target,
    ...(node.targetSelector ? { targetSelector: clone(node.targetSelector) } : {}),
    amount: readAmount(
      node.amount,
      state,
      context,
      `${path}.amount`,
      node.op === 'gain_energy',
      node.op === 'gain_energy' || node.op === 'gain_lust',
    ),
  };
}

/**
 * Resolve a validated effect program one step at a time against the latest host state.
 * The core owns order, branching and formulas; the host owns animations, choices and persistence.
 */
export async function runEffectCommandProgram(
  value: unknown,
  context: EffectExecutionContext,
  ports: EffectCommandRuntimePorts,
): Promise<EffectCommandRuntimeResult> {
  const validation = validateEffectProgram(value);
  if (!validation.ok) {
    const first = validation.issues[0];
    throw new EffectExecutionError(first.code, first.path, first.message);
  }

  const commands: EffectCommand[] = [];
  let stoppedAfter: string | undefined;

  const executeNodes = async (nodes: EffectNode[], path: string): Promise<boolean> => {
    for (let index = 0; index < nodes.length; index += 1) {
      if (ports.isTerminal?.()) return false;
      const node = nodes[index];
      const nodePath = `${path}[${index}]`;
      const state = ports.readState();

      if (node.op === 'if') {
        const branchMatched = evaluateConditionExpression(node.condition, state, context, `${nodePath}.condition`);
        const branch = branchMatched ? node.then : node.else || [];
        const completed = await executeNodes(branch, `${nodePath}.${branchMatched ? 'then' : 'else'}`);
        if (!completed) return false;
        continue;
      }

      if (node.op === 'choose_one') {
        if (!ports.chooseEffectOption)
          throw new EffectExecutionError('CHOICE_HOST_REQUIRED', nodePath, '当前宿主不支持效果选择');
        const optionId = await ports.chooseEffectOption(node, nodePath);
        if (optionId === null) throw new EffectExecutionError('CHOICE_CANCELLED', nodePath, '效果选择已取消');
        const selected = node.options.find(option => option.id === optionId);
        if (!selected) throw new EffectExecutionError('INVALID_CHOICE', nodePath, `无效选项: ${String(optionId)}`);
        const command: EffectCommand = {
          type: 'choice_selected', choiceId: node.choiceId, optionId: selected.id, label: selected.label,
        };
        await ports.execute(command, nodePath);
        commands.push(command);
        const completed = await executeNodes(selected.effects, `${nodePath}.options.${selected.id}`);
        if (!completed) return false;
        continue;
      }

      const command = createCommand(node, state, context, nodePath);
      await ports.execute(command, nodePath);
      commands.push(command);
      if (ports.isTerminal?.()) {
        stoppedAfter = nodePath;
        return false;
      }
    }
    return true;
  };

  const completed = await executeNodes((validation.value as EffectProgram).steps, '$.steps');
  return { completed, commands, ...(stoppedAfter ? { stoppedAfter } : {}) };
}
