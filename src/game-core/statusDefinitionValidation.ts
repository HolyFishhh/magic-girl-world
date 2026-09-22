import { STATUS_TRIGGER_SET } from './battleTriggers';
import { compileCompactEffectList, type CompactEffectCompilationResult } from './compactEffectDsl';
import { describeCompactStatus } from './contentDescription';
import type { EffectNode, EffectProgram } from './effectDsl';
import { validateEffectProgramPolicy } from './effectProgramPolicy';
import { normalizeDamageProtectionRule } from './damageProtection';
import { normalizeStatusDefenseRule } from './statusDefense';

export type CompactStatusValidationResult = { ok: true } | { ok: false; message: string };

const ROOT_KEYS = new Set([
  'tags',
  'id',
  'name',
  'emoji',
  'description',
  'type',
  'stacks_change',
  'tick_timing',
  'maxStacks',
  'stun',
  'character_emoji',
  'triggers',
  'protection',
  'defense',
  'creates',
  '$meta',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function failure(message: string): CompactStatusValidationResult {
  return { ok: false, message };
}

function validTickTiming(value: unknown): boolean {
  return value === undefined || value === null || value === 'before_action' || value === 'after_action';
}

function validDecay(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'string') return false;
  const normalized = value.trim().toLowerCase();
  return normalized === 'keep' || normalized === 'reset' || /^x(?:\d+(?:\.\d+)?|\.\d+)$/.test(normalized);
}

function nestedNodes(node: EffectNode): EffectNode[] {
  if (node.op === 'if') return [...node.then, ...(node.else || [])];
  if (node.op === 'register_trigger') return node.effects;
  // Generated cards execute in their own later lifecycle. Their modifiers,
  // triggers and payment context are checked by the shared card policy below,
  // not as immediate effects of the status that created them.
  return [];
}

function everyLeafIsModifier(node: EffectNode): boolean {
  if (node.op === 'modify' || node.op === 'card_play_rule') return true;
  const nested = nestedNodes(node);
  return nested.length > 0 && nested.every(everyLeafIsModifier);
}

function containsModifier(node: EffectNode): boolean {
  return node.op === 'modify' || node.op === 'card_play_rule' || nestedNodes(node).some(containsModifier);
}

function compileTrigger(value: unknown, creates?: unknown): CompactEffectCompilationResult {
  return compileCompactEffectList(value, { implicitTarget: 'self', creates });
}

/** Threshold execution is a dedicated terminal phase, not a general tick. */
export function isThresholdExecuteProgram(program: EffectProgram): boolean {
  return program.steps.length > 0 && program.steps.every(step =>
    (step.op === 'execute' || step.op === 'kill') && step.target === 'self' && !step.targetSelector,
  );
}

/**
 * Collect independently discoverable defects from one status definition.
 * Keep the report bounded so a malformed object cannot flood the single
 * model-repair prompt, while avoiding fail-fast masking within one status.
 */
export function collectCompactStatusDefinitionIssues(value: unknown): string[] {
  if (!isRecord(value)) return ['状态定义必须是对象'];
  const issues: string[] = [];
  const push = (message: string): void => {
    if (issues.length < 24 && !issues.includes(message)) issues.push(message);
  };

  Object.keys(value)
    .filter(key => !ROOT_KEYS.has(key))
    .forEach(key => push(`状态字段不允许: ${key}`));
  if (typeof value.id !== 'string' || !/^[a-z_][a-z0-9_]*$/i.test(value.id)) push('状态 id 无效');
  for (const field of ['name', 'emoji'] as const) {
    if (typeof value[field] !== 'string' || !value[field].trim()) push(`状态 ${field} 不能为空`);
  }
  if (value.character_emoji !== undefined && (typeof value.character_emoji !== 'string' || !value.character_emoji.trim() || [...value.character_emoji].length > 32)) push('状态 character_emoji 必须是1..32个字符的外观符号');
  if (value.description !== undefined && typeof value.description !== 'string')
    push('状态 description 必须是字符串');
  if (!String(value.description ?? '').trim() && !describeCompactStatus(value)) push('状态规则无法生成描述');
  if (!['buff', 'debuff', 'neutral'].includes(String(value.type))) push('状态 type 无效');
  if (!validDecay(value.stacks_change)) push('状态 stacks_change 无效');
  if (!validTickTiming(value.tick_timing)) push('状态 tick_timing 只能是 before_action 或 after_action');
  const maxStacks = value.maxStacks;
  if (value.tags !== undefined && (!Array.isArray(value.tags) || value.tags.length > 64
    || value.tags.some(tag => typeof tag !== 'string' || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tag))
    || new Set(value.tags).size !== value.tags.length)) push('状态 tags 必须是不重复的标签 ID 数组');
  if (maxStacks !== undefined && (!Number.isInteger(maxStacks) || Number(maxStacks) < 1 || Number(maxStacks) > 999)) {
    push('状态 maxStacks 必须是 1..999 的整数');
  }
  if (value.stun !== undefined && typeof value.stun !== 'boolean') push('状态 stun 必须是布尔值');
  if (value.protection !== undefined && !normalizeDamageProtectionRule(value.protection)) push('状态 protection 必须是有效的保护规则');
  if (value.defense !== undefined && !normalizeStatusDefenseRule(value.defense)) push('状态 defense 必须是有效的状态防御规则');

  // Validate every local template, including unreferenced ones. Compile only;
  // this validation program is never executed or persisted. The same compact
  // compiler and generated-card policy used by other owners remain authoritative.
  if (value.creates !== undefined) {
    if (!Array.isArray(value.creates) || value.creates.length > 32) {
      push('状态 creates 必须是至多 32 项的临时牌模板数组');
      return issues;
    }
    if (value.creates.length > 0) {
      const templates = compileCompactEffectList(value.creates.map(template => ({
        add_card: isRecord(template) ? template.id : undefined,
      })), { creates: value.creates });
      if (!templates.ok) templates.issues.forEach(issue => push(`creates: ${issue.path}: ${issue.message}`));
      else {
        const policy = validateEffectProgramPolicy(templates.value, { triggerPolicy: 'forbid', modifierPolicy: 'forbid' });
        if (!policy.ok) policy.issues.forEach(issue => push(`creates: ${issue.path}: ${issue.message}`));
      }
    }
  }

  const triggers = value.triggers ?? {};
  if (!isRecord(triggers)) {
    push('状态 triggers 必须是对象');
    return issues;
  }
  Object.keys(triggers)
    .filter(key => !STATUS_TRIGGER_SET.has(key))
    .forEach(key => push(`状态 trigger 不允许: ${key}`));
  for (const [trigger, effects] of Object.entries(triggers)) {
    if (!STATUS_TRIGGER_SET.has(trigger)) continue;
    const compiled = compileTrigger(effects, value.creates);
    if (!compiled.ok) {
      compiled.issues.forEach(issue => push(`triggers.${trigger}${issue.path.slice(1)}: ${issue.message}`));
      continue;
    }
    if (trigger === 'hold' && !compiled.value.steps.every(everyLeafIsModifier)) {
      push('状态 hold 只能包含持续修饰或出牌规则');
    }
    if (trigger === 'threshold_execute' && !isThresholdExecuteProgram(compiled.value)) {
      push('状态 threshold_execute 只能包含作用于持有者 self 且不带 targets 的 execute 或 kill');
    }
    if (trigger !== 'hold' && compiled.value.steps.some(containsModifier)) {
      push(`状态 ${trigger} 不能包含持续修饰或出牌规则`);
    }
    const policy = validateEffectProgramPolicy(compiled.value, {
      triggerPolicy: 'forbid',
      modifierPolicy: trigger === 'hold' ? 'only' : 'forbid',
      allowStatusStacks: true,
    });
    if (!policy.ok) {
      policy.issues.forEach(issue => {
        push(`triggers.${trigger}${issue.path === '$' ? '' : issue.path.slice(1)}: ${issue.message}`);
      });
    }
  }
  return issues;
}

/** Validate the only supported AI-facing shallow status format. */
export function validateCompactStatusDefinition(value: unknown): CompactStatusValidationResult {
  const issues = collectCompactStatusDefinitionIssues(value);
  return issues.length > 0 ? failure(issues[0]) : { ok: true };
}

export function collectEffectProgramStatusReferences(program: EffectProgram): Set<string> {
  const references = new Set<string>();
  const visit = (entry: unknown): void => {
    if (Array.isArray(entry)) {
      entry.forEach(visit);
      return;
    }
    if (!isRecord(entry)) return;
    if (
      (
        entry.op === 'apply_status'
        || entry.op === 'remove_status'
        || entry.op === 'apply_summon_status'
        || entry.op === 'remove_summon_status'
      )
      && typeof entry.status === 'string'
    ) {
      if (!['all', 'buffs', 'debuffs'].includes(entry.status)) references.add(entry.status);
    }
    if (entry.op === 'event_status_is' && typeof entry.statusId === 'string') references.add(entry.statusId);
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
    const compiled = compileTrigger(effects, value.creates);
    if (!compiled?.ok) continue;
    collectEffectProgramStatusReferences(compiled.value).forEach(id => references.add(id));
  }
  return references;
}

