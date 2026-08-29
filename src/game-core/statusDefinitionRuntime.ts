import { STATUS_TRIGGERS, type StatusTrigger } from './battleTriggers';
import { compileCompactEffectList } from './compactEffectDsl';
import { describeCompactStatus, normalizeChinesePlayerDescription } from './contentDescription';
import type { EffectProgram } from './effectDsl';
import { validateCompactStatusDefinition } from './statusDefinitionValidation';

export type StatusRuntimeEffect = EffectProgram;

export interface RuntimeStatusDefinition {
  id: string;
  name: string;
  emoji: string;
  description: string;
  type: 'buff' | 'debuff' | 'neutral';
  stacks_change?: number | string;
  maxStacks?: number;
  stun: boolean;
  triggers: Partial<Record<StatusTrigger, EffectProgram[]>>;
}

export interface StatusDefinitionRegistryLoadResult {
  loaded: readonly RuntimeStatusDefinition[];
  rejected: readonly unknown[];
}

function isThresholdExecuteProgram(program: EffectProgram): boolean {
  return program.steps.length > 0 && program.steps.every(step =>
    (step.op === 'execute' || step.op === 'kill') && step.target === 'self' && !step.targetSelector,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readRequiredString(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeStacksChange(value: unknown): number | string | null | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'keep' || normalized === 'reset') return normalized;
  const multiplier = normalized.match(/^x((?:\d+(?:\.\d+)?|\.\d+))$/);
  return multiplier && Number.isFinite(Number(multiplier[1])) ? normalized : null;
}

/** Normalize one modern shallow status definition into the portable runtime shape. */
export function normalizeRuntimeStatusDefinition(
  value: unknown,
  options: { statusNames?: Readonly<Record<string, string>> } = {},
): RuntimeStatusDefinition | null {
  if (!isRecord(value)) return null;
  if (!validateCompactStatusDefinition(value).ok) return null;
  const id = readRequiredString(value, 'id');
  const name = readRequiredString(value, 'name');
  const emoji = readRequiredString(value, 'emoji');
  const type = readRequiredString(value, 'type');
  if (!id || !/^[a-z_][a-z0-9_]*$/i.test(id) || !name || !emoji) return null;
  if (type !== 'buff' && type !== 'debuff' && type !== 'neutral') return null;
  if (value.stun !== undefined && typeof value.stun !== 'boolean') return null;

  const rawTriggers = value.triggers === undefined ? {} : value.triggers;
  if (!isRecord(rawTriggers)) return null;
  if (Object.keys(rawTriggers).some(key => !STATUS_TRIGGERS.includes(key as StatusTrigger))) return null;
  const triggers: RuntimeStatusDefinition['triggers'] = {};
  for (const trigger of STATUS_TRIGGERS) {
    if (!(trigger in rawTriggers)) continue;
    const compiled = compileCompactEffectList(rawTriggers[trigger], { implicitTarget: 'self' });
    if (!compiled.ok) return null;
    if (trigger === 'threshold_execute' && !isThresholdExecuteProgram(compiled.value)) return null;
    triggers[trigger] = [compiled.value];
  }

  const stacksChange = normalizeStacksChange(value.stacks_change);
  if (stacksChange === null) return null;
  const rawMaxStacks = value.maxStacks;
  const maxStacks = rawMaxStacks === undefined ? undefined : Number(rawMaxStacks);
  if (maxStacks !== undefined && (!Number.isInteger(maxStacks) || maxStacks < 1 || maxStacks > 999)) return null;
  const description = normalizeChinesePlayerDescription(value.description) || describeCompactStatus(value, options);
  if (!description) return null;

  return {
    id,
    name,
    emoji,
    description,
    type,
    stun: value.stun === true,
    ...(stacksChange === undefined ? {} : { stacks_change: stacksChange }),
    ...(maxStacks === undefined ? {} : { maxStacks }),
    triggers,
  };
}

export class StatusDefinitionRegistry {
  private readonly definitions = new Map<string, RuntimeStatusDefinition>();

  public replace(
    values: readonly unknown[],
    options: { statusNames?: Readonly<Record<string, string>> } = {},
  ): StatusDefinitionRegistryLoadResult {
    this.definitions.clear();
    const loaded: RuntimeStatusDefinition[] = [];
    const rejected: unknown[] = [];
    for (const value of values) {
      const definition = normalizeRuntimeStatusDefinition(value, options);
      if (!definition) rejected.push(value);
      else {
        this.definitions.set(definition.id, definition);
        loaded.push(definition);
      }
    }
    return { loaded, rejected };
  }

  public get(statusId: string): RuntimeStatusDefinition | undefined {
    return this.definitions.get(statusId);
  }

  public getTriggerEffects(statusId: string, trigger: StatusTrigger): EffectProgram[] {
    return [...(this.definitions.get(statusId)?.triggers[trigger] || [])];
  }

  public getAll(): Map<string, RuntimeStatusDefinition> {
    return new Map(this.definitions);
  }
}
