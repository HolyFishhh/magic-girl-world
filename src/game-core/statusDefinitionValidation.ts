import { STATUS_TRIGGER_SET } from './battleTriggers';
import { compileCompactEffectList, type CompactEffectCompilationResult } from './compactEffectDsl';
import { describeCompactStatus } from './contentDescription';
import type { EffectNode, EffectProgram } from './effectDsl';

export type CompactStatusValidationResult = { ok: true } | { ok: false; message: string };

const ROOT_KEYS = new Set([
  'id',
  'name',
  'emoji',
  'description',
  'type',
  'stacks_change',
  'maxStacks',
  'stun',
  'triggers',
  '$meta',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function failure(message: string): CompactStatusValidationResult {
  return { ok: false, message };
}

function validDecay(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'string') return false;
  const normalized = value.trim().toLowerCase();
  return normalized === 'keep' || normalized === 'reset' || /^x(?:\d+(?:\.\d+)?|\.\d+)$/.test(normalized);
}

function stunHasDecay(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value) && value < 0;
  if (typeof value !== 'string') return false;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'reset') return true;
  const multiplier = normalized.match(/^x((?:\d+(?:\.\d+)?|\.\d+))$/);
  return !!multiplier && Number(multiplier[1]) >= 0 && Number(multiplier[1]) < 1;
}

function nestedNodes(node: EffectNode): EffectNode[] {
  if (node.op === 'if') return [...node.then, ...(node.else || [])];
  if (node.op === 'register_trigger') return node.effects;
  if (node.op === 'add_card') {
    return [...node.card.program.steps, ...(node.card.discardProgram?.steps || [])];
  }
  return [];
}

function everyLeafIsModifier(node: EffectNode): boolean {
  if (node.op === 'modify') return true;
  const nested = nestedNodes(node);
  return nested.length > 0 && nested.every(everyLeafIsModifier);
}

function containsModifier(node: EffectNode): boolean {
  return node.op === 'modify' || nestedNodes(node).some(containsModifier);
}

function compileTrigger(value: unknown): CompactEffectCompilationResult | null {
  return compileCompactEffectList(value);
}

/** Validate the only supported AI-facing shallow status format. */
export function validateCompactStatusDefinition(value: unknown): CompactStatusValidationResult {
  if (!isRecord(value)) return failure('状态定义必须是对象');
  const unknown = Object.keys(value).find(key => !ROOT_KEYS.has(key));
  if (unknown) return failure(`状态字段不允许: ${unknown}`);
  if (typeof value.id !== 'string' || !/^[a-z_][a-z0-9_]*$/i.test(value.id)) return failure('状态 id 无效');
  for (const field of ['name', 'emoji'] as const) {
    if (typeof value[field] !== 'string' || !value[field].trim()) return failure(`状态 ${field} 不能为空`);
  }
  if (value.description !== undefined && typeof value.description !== 'string')
    return failure('状态 description 必须是字符串');
  if (!String(value.description ?? '').trim() && !describeCompactStatus(value)) return failure('状态规则无法生成描述');
  if (!['buff', 'debuff', 'neutral'].includes(String(value.type))) return failure('状态 type 无效');
  if (!validDecay(value.stacks_change)) return failure('状态 stacks_change 无效');
  const maxStacks = value.maxStacks;
  if (maxStacks !== undefined && (!Number.isInteger(maxStacks) || Number(maxStacks) < 1 || Number(maxStacks) > 999)) {
    return failure('状态 maxStacks 必须是 1..999 的整数');
  }
  if (value.stun !== undefined && typeof value.stun !== 'boolean') return failure('状态 stun 必须是布尔值');
  if (value.stun === true && !stunHasDecay(value.stacks_change)) return failure('眩晕状态必须设置可靠衰减');

  const triggers = value.triggers ?? {};
  if (!isRecord(triggers)) return failure('状态 triggers 必须是对象');
  const unknownTrigger = Object.keys(triggers).find(key => !STATUS_TRIGGER_SET.has(key));
  if (unknownTrigger) return failure(`状态 trigger 不允许: ${unknownTrigger}`);
  for (const [trigger, effects] of Object.entries(triggers)) {
    const compiled = compileTrigger(effects);
    if (!compiled?.ok) {
      if (!compiled) return failure(`triggers.${trigger}: effects 无效`);
      const issue = compiled.issues[0];
      return failure(`triggers.${trigger}${issue.path.slice(1)}: ${issue.message}`);
    }
    if (trigger === 'hold' && !compiled.value.steps.every(everyLeafIsModifier)) {
      return failure('状态 hold 只能包含 modify');
    }
    if (trigger !== 'hold' && compiled.value.steps.some(containsModifier)) {
      return failure(`状态 ${trigger} 不能包含 modify`);
    }
  }
  return { ok: true };
}

export function collectEffectProgramStatusReferences(program: EffectProgram): Set<string> {
  const references = new Set<string>();
  const visit = (entry: unknown): void => {
    if (Array.isArray(entry)) {
      entry.forEach(visit);
      return;
    }
    if (!isRecord(entry)) return;
    if ((entry.op === 'apply_status' || entry.op === 'remove_status') && typeof entry.status === 'string') {
      if (!['all', 'buffs', 'debuffs'].includes(entry.status)) references.add(entry.status);
    }
    if (entry.op === 'var' && typeof entry.path === 'string') {
      const match = entry.path.match(/^(?:self|opponent)\.status\.([A-Za-z0-9_]+)\.stacks$/);
      if (match) references.add(match[1]);
    }
    Object.values(entry).forEach(visit);
  };
  visit(program);
  return references;
}

/** Collect status dependencies from one compact definition without executing it. */
export function collectCompactStatusDefinitionReferences(value: unknown): Set<string> {
  const references = new Set<string>();
  if (!isRecord(value) || !isRecord(value.triggers)) return references;
  for (const effects of Object.values(value.triggers)) {
    const compiled = compileTrigger(effects);
    if (!compiled?.ok) continue;
    collectEffectProgramStatusReferences(compiled.value).forEach(id => references.add(id));
  }
  return references;
}
