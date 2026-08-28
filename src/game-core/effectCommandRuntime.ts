import {
  EffectExecutionError,
  evaluateConditionExpression,
  evaluateNumericExpression,
  validateEffectProgram,
  type CardSelector,
  type CoreEffectState,
  type EffectExecutionContext,
  type EffectModifierOperator,
  type EffectNode,
  type EffectProgram,
  type EffectTarget,
  type EffectTrigger,
  type GeneratedCardDefinition,
  type ModifierStat,
  type NumericExpression,
  type RecoverCardZone,
} from './effectDsl';
import { roundBattleValue } from './battleMath';

export type EffectCommand =
  | { type: 'damage' | 'heal' | 'gain_block' | 'gain_energy' | 'gain_lust'; target: EffectTarget; amount: number }
  | { type: 'set_stat'; target: EffectTarget; stat: 'hp' | 'lust' | 'energy' | 'block'; value: number }
  | { type: 'apply_status'; target: EffectTarget; status: string; stacks: number }
  | { type: 'remove_status'; target: EffectTarget; status: string }
  | { type: 'draw_cards'; amount: number }
  | { type: 'scry_cards'; amount: number }
  | { type: 'discard_cards'; selector: CardSelector; amount: number }
  | { type: 'exhaust_cards'; selector: CardSelector; amount: number }
  | { type: 'recover_cards'; source: RecoverCardZone; pick: 'random' | 'choose' | 'all'; amount: number }
  | { type: 'reduce_card_cost'; selector: CardSelector; amount: number }
  | { type: 'copy_cards'; selector: CardSelector }
  | { type: 'double_card_effect'; selector: CardSelector }
  | { type: 'add_card'; zone: 'hand' | 'draw'; card: GeneratedCardDefinition; count: number }
  | {
      type: 'modify';
      target: EffectTarget;
      stat: ModifierStat;
      operator: EffectModifierOperator;
      value: number;
    }
  | { type: 'register_trigger'; target: EffectTarget; trigger: EffectTrigger; effects: EffectNode[] }
  | { type: 'narration'; text: string };

export interface EffectCommandRuntimePorts {
  readState(): CoreEffectState;
  execute(command: EffectCommand, path: string): void | Promise<void>;
  isTerminal?(): boolean;
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
): number {
  const evaluated = evaluateNumericExpression(expression, state, context, path);
  const value = discrete ? Math.floor(evaluated) : roundBattleValue(evaluated);
  if (value < 0) throw new EffectExecutionError('NEGATIVE_AMOUNT', path, '效果数量不能为负数');
  return value;
}

function createCommand(
  node: Exclude<EffectNode, { op: 'if' }>,
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
  if (node.op === 'copy_cards' || node.op === 'double_card_effect') {
    return { type: node.op, selector: clone(node.selector) };
  }
  if (node.op === 'add_card') {
    return { type: 'add_card', zone: node.zone, card: clone(node.card), count: node.count };
  }
  if (node.op === 'modify') {
    return {
      type: 'modify',
      target: node.target,
      stat: node.stat,
      operator: node.operator,
      value: roundBattleValue(evaluateNumericExpression(node.value, state, context, `${path}.value`)),
    };
  }
  if (node.op === 'register_trigger') {
    return {
      type: 'register_trigger',
      target: node.target,
      trigger: node.trigger,
      effects: clone(node.effects),
    };
  }
  if (node.op === 'apply_status') {
    return {
      type: 'apply_status',
      target: node.target,
      status: node.status,
      stacks: readAmount(node.stacks, state, context, `${path}.stacks`, true),
    };
  }
  if (node.op === 'remove_status') {
    return { type: 'remove_status', target: node.target, status: node.status };
  }
  if (node.op === 'set_stat') {
    return {
      type: 'set_stat',
      target: node.target,
      stat: node.stat,
      value:
        node.stat === 'energy'
          ? Math.floor(evaluateNumericExpression(node.value, state, context, `${path}.value`))
          : roundBattleValue(evaluateNumericExpression(node.value, state, context, `${path}.value`)),
    };
  }
  return {
    type: node.op,
    target: node.target,
    amount: readAmount(node.amount, state, context, `${path}.amount`, node.op === 'gain_energy'),
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
