import { validateEnemyActionReferences } from './enemyActionReferences';
import { isEmptyProtectionEffect, normalizeDamageProtectionRule } from './damageProtection';
import { compileCompactCondition, compileCompactEffectList, validateStructuredTriggerInput } from './compactEffectDsl';
import { isCompactEffectList } from './compactEffectContract';
import { validateEffectProgramPolicy, type EffectProgramPolicyOptions } from './effectProgramPolicy';
import type { EffectProgram } from './effectDsl';
import { validateCardLifecycle } from './cardLifecycle';
import {
  collectCompactStatusDefinitionReferences,
  validateCompactStatusDefinition,
} from './statusDefinitionValidation';
import { isContentPack, type ContentDefinition, type ContentPack } from './contentPack';
import { ABILITY_TRIGGER_SET } from './battleTriggers';
import { resolveTriggerInput } from './triggerInput';
import { CARD_RARITY_SET, CARD_TYPE_SET, RELIC_RARITY_SET } from './contentCatalog';
import {
  normalizeCardCost,
  validateCardCost,
  validateCombatResourceDefinitions,
} from './combatResource';
import { normalizeEnemyActionSelectionInput } from './enemyActionConfig';
import { validateArtifactAcquisitionContract } from './artifactAcquisitionValidation';
import { validateRewardCandidateAgainstLibrary } from './rewardCandidateValidation';

export interface ContentContractIssue {
  path: string;
  code: string;
  message: string;
}

export type ContentContractResult =
  | { ok: true; value: ContentPack }
  | { ok: false; issues: ContentContractIssue[] };

export interface ContentContractOptions {
  /** Battle requests require an enemy; analysis-only packs may omit it. */
  requireEnemy?: boolean;
  /** Battle requests require every executable definition to expose one effect source. */
  requireExecutable?: boolean;
  /**
   * Status ids supplied by the surrounding persistent library. They are used
   * only to resolve references; their definitions are validated by the owner
   * of that library instead of being revalidated for every isolated candidate.
   */
  knownStatusIds?: Iterable<string>;
  /** External player resource ids for an isolated candidate wrapper. */
  knownResourceIds?: Iterable<string>;
  /** Surrounding definitions used for executable reference traversal only;
   * their owner validates them, while pack.statuses remain candidate-owned. */
  referenceStatusDefinitions?: readonly unknown[];
  /** Only for a complete starting deck, never an isolated reward candidate. */
  requireVictoryRoute?: boolean;
}

const CARD_WRAPPER_FIELDS = new Set([
  'lifecycle',
  'id', 'name', 'emoji', 'type', 'rarity', 'cost', 'quantity', 'description', 'dialogue', 'effects', 'discard_effects',
  'unique', 'trigger', 'retain', 'exhaust', 'ethereal', 'innate', 'sly', 'tags', 'creates', 'when', 'requires_summon',
  // Host-owned persistent identity/progression fields survive between tower battles.
  'runInstanceId', 'runInstanceIds', 'templateId', 'parentRunInstanceId', 'origin', '$meta', 'upgrade_level',
]);
const CARD_TEMPLATE_FIELDS = new Set([
  'lifecycle',
  'id', 'name', 'emoji', 'type', 'rarity', 'cost', 'description', 'dialogue', 'effects', 'discard_effects',
  'unique', 'trigger', 'retain', 'exhaust', 'ethereal', 'sly', 'when', 'requires_summon',
]);
const RELIC_WRAPPER_FIELDS = new Set([
  'id', 'name', 'rarity', 'emoji', 'description', 'creates', 'trigger', 'on_acquire',
  // Accepted only while loading the legacy sibling-trigger shape.
  'effects', 'when',
]);
const ITEM_WRAPPER_FIELDS = new Set(['id', 'name', 'emoji', 'description', 'count', 'creates', 'effects']);
const ABILITY_WRAPPER_FIELDS = new Set([
  'id', 'name', 'source', 'emoji', 'description', 'creates', 'trigger', 'protection',
  // Accepted only while loading the legacy sibling-trigger shape.
  'effects', 'when',
]);
const ENEMY_ACTION_WRAPPER_FIELDS = new Set(['id', 'name', 'emoji', 'description', 'dialogue', 'weight', 'when', 'creates', 'effects']);
const NAMED_EFFECT_WRAPPER_FIELDS = new Set(['name', 'emoji', 'description', 'creates', 'when', 'effects']);


function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * This deliberately follows executable JSON structure rather than names or
 * descriptions.  A status library is shared state: only statuses reached by
 * an active entry or an apply_status reference participate in this check.
 */
function canIncreaseLust(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0;
  if (typeof value !== 'string') return false;
  if (!value.trim()) return false;
  const literal = Number(value);
  if (Number.isFinite(literal)) return literal > 0;
  // A formula can be positive at runtime unless it is an explicitly negative
  // literal/expression.  Do not mistake `lust: -4` for desire pressure.
  return !/^\s*-\s*\d+(?:\.\d+)?\s*$/.test(value);
}

function referencedStatusId(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  return isRecord(value) && typeof value.id === 'string' ? value.id : undefined;
}

interface LustRoot { value: unknown; path: string; }

/** Follow only public executable carriers and references, never arbitrary JSON. */
function contentCanIncreaseLust(
  roots: readonly LustRoot[],
  statusById: ReadonlyMap<string, Record<string, any>>,
  onSpawnEnemy?: (enemy: Record<string, any>, path: string) => void,
  matches: (effect: Record<string, any>) => boolean = entry => canIncreaseLust(entry.lust) || canIncreaseLust(entry.set_lust),
): boolean {
  const visitedStatuses = new Set<string>();
  const visitedDefinitions = new Set<object>();
  let found = false;
  const visitStatus = (id: string): void => {
    if (visitedStatuses.has(id)) return;
    visitedStatuses.add(id);
    const status = statusById.get(id);
    if (!status || !isRecord(status.triggers)) return;
    for (const [trigger, effects] of Object.entries(status.triggers)) {
      visitEffects(effects, `statuses.${id}.triggers.${trigger}`, status.creates);
    }
  };
  const visitTemplate = (id: string, creates: unknown, path: string): void => {
    if (!Array.isArray(creates)) return;
    const template = creates.find(entry => isRecord(entry) && entry.id === id);
    if (template) visitDefinition(template, `${path}.creates[${creates.indexOf(template)}]`);
  };
  const visitEffects = (value: unknown, path: string, creates?: unknown): void => {
    const entries = Array.isArray(value) ? value : isRecord(value) ? [value] : [];
    entries.forEach((entry, index) => {
      if (!isRecord(entry)) return;
      const effectPath = Array.isArray(value) ? `${path}[${index}]` : path;
      // These are effect operation keys; cost/resources/initial entity fields
      // are never passed to this function and therefore cannot be mistaken.
      if (matches(entry)) found = true;
      for (const key of ['apply_status', 'apply_summon_status'] as const) {
        const id = referencedStatusId(entry[key]);
        if (id) visitStatus(id);
      }
      for (const key of ['add_card', 'ensure_card', 'transform_card'] as const) {
        if (typeof entry[key] === 'string') visitTemplate(entry[key], creates, effectPath);
      }
      if (isRecord(entry.spawn_summon)) visitSummon(entry.spawn_summon, `${effectPath}.spawn_summon`);
      if (isRecord(entry.spawn_enemy)) onSpawnEnemy?.(entry.spawn_enemy, `${effectPath}.spawn_enemy`);
      if (isRecord(entry.schedule)) visitEffects(entry.schedule.effects, `${effectPath}.schedule.effects`, creates);
      if (entry.schedule !== undefined && !isRecord(entry.schedule)) visitEffects(entry.effects, `${effectPath}.effects`, creates);
      if (isRecord(entry.guard)) visitEffects(entry.guard.effects, `${effectPath}.guard.effects`, creates);
      if (Array.isArray(entry.summoner_effects) || isRecord(entry.summoner_effects))
        visitEffects(entry.summoner_effects, `${effectPath}.summoner_effects`, creates);
      if (Array.isArray(entry.choose)) entry.choose.forEach((option, optionIndex) => {
        if (isRecord(option)) visitEffects(option.effects, `${effectPath}.choose[${optionIndex}].effects`, creates);
      });
      if (entry.choose !== undefined && Array.isArray(entry.options)) entry.options.forEach((option, optionIndex) => {
        if (isRecord(option)) visitEffects(option.effects, `${effectPath}.options[${optionIndex}].effects`, creates);
      });
    });
  };
  const visitDefinition = (value: unknown, path: string): void => {
    if (!isRecord(value) || visitedDefinitions.has(value)) return;
    visitedDefinitions.add(value);
    visitEffects(value.effects, `${path}.effects`, value.creates);
    visitEffects(value.discard_effects, `${path}.discard_effects`, value.creates);
    if (isRecord(value.trigger)) visitEffects(value.trigger.effects, `${path}.trigger.effects`, value.creates);
  };
  const visitSummon = (summon: Record<string, any>, path: string): void => {
    visitEffects(summon.action, `${path}.action`);
    visitEffects(summon.on_existing_effects, `${path}.on_existing_effects`);
    (Array.isArray(summon.actions) ? summon.actions : []).forEach((action, index) =>
      visitDefinition(action, `${path}.actions[${index}]`));
    (Array.isArray(summon.abilities) ? summon.abilities : []).forEach((ability, index) =>
      visitDefinition(ability, `${path}.abilities[${index}]`));
    (Array.isArray(summon.status_effects) ? summon.status_effects : []).forEach(status => {
      const id = isRecord(status) && typeof status.id === 'string' ? status.id : undefined;
      if (id) visitStatus(id);
    });
  };
  const visitContainer = (value: Record<string, any>, path: string): void => {
    if (isRecord(value.stance)) {
      visitEffects(value.stance.enter, `${path}.stance.enter`);
      visitEffects(value.stance.exit, `${path}.stance.exit`);
      visitEffects(value.stance.passive, `${path}.stance.passive`);
      (Array.isArray(value.stance.events) ? value.stance.events : []).forEach((event, index) =>
        isRecord(event) && visitEffects(event.effects, `${path}.stance.events[${index}].effects`));
    }
    (Array.isArray(value.orbs) ? value.orbs : []).forEach((orb, index) => {
      if (!isRecord(orb)) return;
      visitEffects(orb.passive, `${path}.orbs[${index}].passive`);
      visitEffects(orb.evoke, `${path}.orbs[${index}].evoke`);
    });
  };
  roots.forEach(root => {
    if (!isRecord(root.value)) return;
    visitDefinition(root.value, root.path);
    visitContainer(root.value, root.path);
    const id = typeof root.value.id === 'string' && Object.keys(root.value).every(key => key === 'id' || key === 'stacks');
    if (id) visitStatus(root.value.id);
  });
  return found;
}

function statusLibrary(pack: ContentPack, references: readonly unknown[] = []): Map<string, Record<string, any>> {
  const result = new Map<string, Record<string, any>>();
  [...references, ...pack.statuses].forEach(status => {
    if (isRecord(status) && typeof status.id === 'string') result.set(status.id, status);
  });
  return result;
}

function enemyLustRoots(enemy: Record<string, any>, path: string): LustRoot[] {
  return [
    ...(Array.isArray(enemy.actions) ? enemy.actions.map((value, index) => ({ value, path: `${path}.actions[${index}]` })) : []),
    ...(Array.isArray(enemy.abilities) ? enemy.abilities.map((value, index) => ({ value, path: `${path}.abilities[${index}]` })) : []),
    ...(Array.isArray(enemy.status_effects) ? enemy.status_effects.map((value, index) => ({ value, path: `${path}.status_effects[${index}]` })) : []),
    { value: enemy, path },
  ];
}

function addMissingEnemyLustEffects(
  enemy: Record<string, any>,
  path: string,
  statuses: ReadonlyMap<string, Record<string, any>>,
  issues: ContentContractIssue[],
): void {
  if (contentCanIncreaseLust(enemyLustRoots(enemy, path), statuses, (spawned, spawnedPath) =>
    addMissingEnemyLustEffects(spawned, spawnedPath, statuses, issues)) && !isRecord(enemy.lust_effect)) {
    addIssue(
      issues,
      `${path}.lust_effect`,
      'MISSING_LUST_OVERFLOW_EFFECT',
      'enemy content can increase lust and must define a non-empty lust_effect',
    );
  }
}

function validateLustOverflowCoverage(pack: ContentPack, issues: ContentContractIssue[], options: ContentContractOptions): void {
  const statuses = statusLibrary(pack, options.referenceStatusDefinitions);
  const playerRoots: LustRoot[] = [
    ...pack.cards.map((value, index) => ({ value, path: `cards[${index}]` })),
    ...pack.relics.map((value, index) => ({ value, path: `relics[${index}]` })),
    ...pack.items.map((value, index) => ({ value, path: `items[${index}]` })),
    ...pack.abilities.map((value, index) => ({ value, path: `abilities[${index}]` })),
    ...pack.activeStatuses.map((value, index) => ({ value, path: `activeStatuses[${index}]` })),
    ...(isRecord(pack.playerStance) ? [{ value: { stance: pack.playerStance }, path: 'playerCore' }] : []),
    ...(pack.playerOrbs || []).map((value, index) => ({ value: { orbs: [value] }, path: `playerCore.orbs[${index}]` })),
  ];
  if (contentCanIncreaseLust(playerRoots, statuses, (spawned, spawnedPath) =>
    addMissingEnemyLustEffects(spawned, spawnedPath, statuses, issues)) && !isRecord(pack.desireEffects.player)) {
    addIssue(
      issues,
      'desireEffects.player',
      'MISSING_LUST_OVERFLOW_EFFECT',
      'player content can increase lust and must define a non-empty player desire effect',
    );
  }
  if (isRecord(pack.enemy)) addMissingEnemyLustEffects(pack.enemy, 'enemy', statuses, issues);
  // This is a necessary-path check, not a balance simulator. A resource/draw/
  // heal-only desire deck cannot win, even if its displayed attack metric is positive.
  if (options.requireVictoryRoute && pack.cards.length > 0 && contentCanIncreaseLust(playerRoots, statuses)) {
    const outputRoots = [...playerRoots, { value: pack.desireEffects.player, path: 'desireEffects.player' }];
    const canAffectHp = (entry: Record<string, any>) => canIncreaseLust(entry.damage) || entry.kill !== undefined ||
      entry.set_hp !== undefined || (typeof entry.heal === 'number' && entry.heal < 0);
    if (!contentCanIncreaseLust(outputRoots, statuses, undefined, canAffectHp)) addIssue(issues,
      'desireEffects.player', 'MISSING_DESIRE_VICTORY_ROUTE',
      '欲望体系没有任何可执行的击败敌人路径：满溢仅获得资源、抽牌或恢复，而整套卡组及其引用的状态、召唤物、生成牌均没有输出兑现。请保留欲望主轴并补齐输出或终结链，资源必须连接实际消费入口。');
  }
  (pack.enemies || []).slice(1).forEach((enemy, index) => {
    if (isRecord(enemy)) addMissingEnemyLustEffects(enemy, `enemies[${index + 1}]`, statuses, issues);
  });
}

function addIssue(issues: ContentContractIssue[], path: string, code: string, message: string): void {
  issues.push({ path, code, message });
}

function validateWrapperFields(
  value: Record<string, unknown>,
  path: string,
  allowed: ReadonlySet<string>,
  issues: ContentContractIssue[],
): void {
  if (allowed.has('dialogue') && value.dialogue !== undefined && (typeof value.dialogue !== 'string' || !value.dialogue.trim())) addIssue(issues, `${path}.dialogue`, 'INVALID_DIALOGUE', '台词必须是非空文本');
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) addIssue(issues, `${path}.${key}`, 'UNKNOWN_FIELD', `unsupported content field: ${key}`);
  }
}

function importCompactIssues(
  result: ReturnType<typeof compileCompactEffectList>,
  operation: string,
  path: string,
  issues: ContentContractIssue[],
): void {
  if (result.ok) return;
  const operationPrefix = `$.${operation}`;
  result.issues.forEach(issue => {
    const suffix = issue.path === operationPrefix
      ? ''
      : issue.path.startsWith(operationPrefix)
        ? issue.path.slice(operationPrefix.length)
        : issue.path === '$'
          ? ''
          : issue.path.slice(1);
    addIssue(issues, `${path}${suffix}`, issue.code, issue.message);
  });
}

function validateCombatContainers(
  source: Record<string, any>,
  path: string,
  issues: ContentContractIssue[],
  knownStatusIds: ReadonlySet<string>,
  enemyCollectionTarget?: 'self' | 'opponent',
): void {
  const compilation = enemyCollectionTarget ? { enemyCollectionTarget } : {};
  const validateNested = (
    value: unknown,
    nestedPath: string,
    modifierPolicy: EffectProgramPolicyOptions['modifierPolicy'] = 'forbid',
  ): void => {
    if (value === undefined) return;
    validateEffectSource(
      { effects: value },
      nestedPath,
      issues,
      { triggerPolicy: 'forbid', modifierPolicy, knownStatusIds },
      true,
      compilation,
    );
  };

  if (source.stance !== undefined && source.stance !== null) {
    if (!isRecord(source.stance)) {
      addIssue(issues, `${path}.stance`, 'INVALID_STANCE', 'stance must be an object or null');
    } else {
      importCompactIssues(
        compileCompactEffectList({ stance: source.stance }, compilation),
        'stance',
        `${path}.stance`,
        issues,
      );
      validateNested(source.stance.enter, `${path}.stance.enter`);
      validateNested(source.stance.exit, `${path}.stance.exit`);
      validateNested(source.stance.passive, `${path}.stance.passive`, 'only');
      if (Array.isArray(source.stance.events)) source.stance.events.forEach((event: unknown, index: number) => {
        if (isRecord(event)) validateNested(event.effects, `${path}.stance.events[${index}].effects`);
      });
    }
  }

  if (
    source.orb_slots !== undefined &&
    (!Number.isInteger(source.orb_slots) || Number(source.orb_slots) < 0 || Number(source.orb_slots) > 20)
  ) {
    addIssue(issues, `${path}.orb_slots`, 'INVALID_ORB_SLOTS', '姿态槽必须是 0 到 20 的整数');
  }
  if (source.orbs !== undefined && !Array.isArray(source.orbs)) {
    addIssue(issues, `${path}.orbs`, 'INVALID_ORBS', 'orbs must be an array');
    return;
  }
  const orbs = Array.isArray(source.orbs) ? source.orbs : [];
  if (orbs.length > 20) addIssue(issues, `${path}.orbs`, 'TOO_MANY_ORBS', 'at most 20 initial orbs are supported');
  if (Number.isInteger(source.orb_slots) && orbs.length > Number(source.orb_slots)) {
    addIssue(issues, `${path}.orbs`, 'ORB_SLOT_OVERFLOW', '初始姿态数量超过姿态槽数量');
  }
  orbs.forEach((orb, index) => {
    const orbPath = `${path}.orbs[${index}]`;
    if (!isRecord(orb)) {
      addIssue(issues, orbPath, 'INVALID_ORB', '姿态必须是对象');
      return;
    }
    if (typeof orb.value !== 'number' || !Number.isFinite(orb.value) || orb.value < 0) {
    addIssue(issues, `${orbPath}.value`, 'INVALID_ORB_VALUE', '初始姿态数值必须是非负有限数');
    }
    importCompactIssues(
      compileCompactEffectList({ channel_orb: orb }, compilation),
      'channel_orb',
      orbPath,
      issues,
    );
    validateNested(orb.passive, `${orbPath}.passive`);
    validateNested(orb.evoke, `${orbPath}.evoke`);
  });
}

function validateEnemyActionConfiguration(
  enemy: Record<string, any>,
  path: string,
  actionNames: ReadonlySet<string>,
  issues: ContentContractIssue[],
): void {
  const normalized = normalizeEnemyActionSelectionInput(enemy);
  const mode = normalized.actionMode;
  if (!['random', 'probability', 'sequence', 'sequence_then_probability'].includes(mode)) {
    addIssue(issues, `${path}.action_mode`, 'INVALID_ACTION_MODE', `unsupported action mode: ${mode}`);
    return;
  }
  if (enemy.action_config !== undefined && !isRecord(enemy.action_config)) {
    addIssue(issues, `${path}.action_config`, 'INVALID_ACTION_CONFIG', 'action_config must be an object');
    return;
  }
  const config = normalized.actionConfig;
  const unknown = Object.keys(config).find(key => key !== 'sequence' && key !== 'probability');
  if (unknown) addIssue(issues, `${path}.action_config.${unknown}`, 'UNKNOWN_FIELD', `unsupported action_config field: ${unknown}`);
  if (mode === 'sequence' || mode === 'sequence_then_probability') {
    if (!Array.isArray(config.sequence) || config.sequence.length === 0) {
      addIssue(issues, `${path}.action_config.sequence`, 'INVALID_SEQUENCE', 'sequence mode requires a non-empty sequence');
    } else {
      config.sequence.forEach((name: unknown, index: number) => {
        if (typeof name !== 'string' || !actionNames.has(name)) {
          addIssue(issues, `${path}.action_config.sequence[${index}]`, 'UNKNOWN_ACTION', 'sequence must reference an existing action name');
        }
      });
    }
  }
  if (mode === 'probability' || mode === 'sequence_then_probability') {
    if (!isRecord(config.probability) || Object.keys(config.probability).length === 0) {
      addIssue(issues, `${path}.action_config.probability`, 'INVALID_PROBABILITY', 'probability mode requires a non-empty probability object');
    } else {
      Object.entries(config.probability).forEach(([name, weight]) => {
        if (!actionNames.has(name) || typeof weight !== 'number' || !Number.isFinite(weight) || weight <= 0) {
          addIssue(issues, `${path}.action_config.probability.${name}`, 'INVALID_PROBABILITY', 'probability must reference an existing action with a positive weight');
        }
      });
    }
  }
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z_][A-Za-z0-9_-]*$/.test(value);
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function validateRequiredName(value: Record<string, unknown>, path: string, issues: ContentContractIssue[]): void {
  if (typeof value.name !== 'string' || !value.name.trim()) {
    addIssue(issues, `${path}.name`, 'INVALID_NAME', 'name cannot be empty');
  }
}

function appendProgramIssuePath(base: string, issuePath: string, flattenSteps = false, directObject = false): string {
  if (issuePath === '$') return base;
  if (base.endsWith('.effects') && issuePath === '$.trigger') return `${base.slice(0, -'.effects'.length)}.trigger`;
  if (base.endsWith('.effects') && issuePath.startsWith('$.creates')) {
    return `${base.slice(0, -'.effects'.length)}${issuePath.slice(1)}`;
  }
  let suffix = flattenSteps && issuePath.startsWith('$.steps') ? issuePath.slice('$.steps'.length) : issuePath.slice(1);
  if (directObject && suffix.startsWith('[0]')) suffix = suffix.slice(3);
  return `${base}${suffix}`;
}

interface CompiledEffectSource {
  path: string;
  value: unknown;
  program: EffectProgram;
  triggerWrapped: boolean;
}

function appendAuthoredProgramIssuePath(source: CompiledEffectSource, issuePath: string): string {
  const match = issuePath.match(/^\$\.steps\[(\d+)\](.*)$/);
  if (!match) return appendProgramIssuePath(source.path, issuePath, true, !Array.isArray(source.value));
  const stepIndex = Number(match[1]);
  const remainder = match[2] || '';
  const step = source.program.steps[stepIndex];
  if (source.triggerWrapped && step?.op === 'register_trigger') {
    if (!remainder) return source.path.replace(/\.effects$/, '');
    const eventQuery = remainder.match(/^\.eventQuery(?:\.(.+))?$/);
    if (eventQuery) {
      const triggerPath = source.path.replace(/\.effects$/, '');
      return eventQuery[1] ? `${triggerPath}.${eventQuery[1]}` : triggerPath;
    }
    const nested = remainder.match(/^\.effects\[(\d+)\](.*)$/);
    if (nested) {
      const effectIndex = Number(nested[1]);
      const suffix = nested[2] || '';
      return Array.isArray(source.value)
        ? `${source.path}[${effectIndex}]${suffix}`
        : `${source.path}${effectIndex === 0 ? '' : `[${effectIndex}]`}${suffix}`;
    }
  }
  return appendProgramIssuePath(source.path, issuePath, true, !Array.isArray(source.value));
}

function appendCombinedProgramIssuePath(
  fallbackBase: string,
  issuePath: string,
  sources: readonly CompiledEffectSource[],
): string {
  const match = issuePath.match(/^\$\.steps\[(\d+)\](.*)$/);
  if (!match) return appendProgramIssuePath(fallbackBase, issuePath, true, false);
  let stepIndex = Number(match[1]);
  for (const source of sources) {
    if (stepIndex < source.program.steps.length) {
      return appendAuthoredProgramIssuePath(source, `$.steps[${stepIndex}]${match[2] || ''}`);
    }
    stepIndex -= source.program.steps.length;
  }
  return appendProgramIssuePath(fallbackBase, issuePath, true, false);
}

function validateEffectSource(
  value: Record<string, unknown>,
  path: string,
  issues: ContentContractIssue[],
  options: EffectProgramPolicyOptions,
  required: boolean,
  compilation: { enemyCollectionTarget?: 'self' | 'opponent' } = {},
): void {
  const resolvedTrigger = resolveTriggerInput(value);
  const hasTriggeredEffects = resolvedTrigger.triggeredEffects !== undefined;
  const hasImmediateEffects = resolvedTrigger.immediateEffects !== undefined;
  const hasCompact = hasTriggeredEffects || hasImmediateEffects;
  for (const field of ['effect', 'effect_program', 'effectProgram']) {
    if (hasOwn(value, field)) {
      addIssue(issues, `${path}.${field}`, 'REMOVED_EFFECT_FIELD', `${field} is not supported; use shallow effects`);
    }
  }
  if (!hasCompact) {
    if (required) addIssue(issues, path, 'MISSING_EFFECT_SOURCE', 'an executable definition must contain effects');
    return;
  }

  const rootTrigger = typeof resolvedTrigger.trigger === 'string' ? resolvedTrigger.trigger : undefined;
  const registerPassiveRoot = rootTrigger === 'passive' &&
    (options.triggerPolicy === 'require_root' || options.triggerPolicy === 'require_root_or_status');
  const isOuterLifecycle = rootTrigger === 'battle_start' || (rootTrigger === 'passive' && !registerPassiveRoot);
  const compileTrigger = rootTrigger && !isOuterLifecycle ? rootTrigger : undefined;
  const resolvedOptions = isOuterLifecycle ? { ...options, triggerPolicy: 'forbid' as const } : options;

  if (resolvedTrigger.structured) {
    const triggerObject = value.trigger as Record<string, unknown>;
    validateStructuredTriggerInput(triggerObject, `${path}.trigger`, issues);
    if (resolvedTrigger.trigger === 'passive' && resolvedTrigger.eventQuery !== undefined) {
      addIssue(
        issues,
        `${path}.trigger`,
        'PASSIVE_TRIGGER_FILTER_NOT_ALLOWED',
        'passive trigger cannot use event filters; use a real event trigger instead',
      );
    }
  }

  const programs: EffectProgram[] = [];
  const compiledSources: CompiledEffectSource[] = [];
  const compileSource = (source: unknown, sourcePath: string, trigger?: string): boolean => {
    if (!isCompactEffectList(source)) {
      addIssue(issues, sourcePath, 'INVALID_EFFECT_SOURCE', 'effects must be a shallow object or array');
      return false;
    }
    const compiled = compileCompactEffectList(source, {
      trigger,
      triggerQuery: trigger ? resolvedTrigger.eventQuery : undefined,
      when: trigger ? undefined : value.when,
      creates: value.creates,
      ...(resolvedOptions.knownStatusIds
        ? { statusNames: Object.fromEntries([...resolvedOptions.knownStatusIds].map(id => [id, id])) }
        : {}),
      enemyCollectionTarget: compilation.enemyCollectionTarget,
    });
    if (!compiled.ok) {
      compiled.issues.forEach(issue => {
        const triggerQueryPath = trigger
          ? issue.path.match(/^\$\.steps\[0\]\.eventQuery(?:\.(.+))?$/)
          : null;
        const authoredPath = triggerQueryPath
          ? `${sourcePath.replace(/\.effects$/, '')}${triggerQueryPath[1] ? `.${triggerQueryPath[1]}` : ''}`
          : appendProgramIssuePath(sourcePath, issue.path, true, !Array.isArray(source));
        addIssue(issues, authoredPath, issue.code, issue.message);
      });
      return false;
    }
    programs.push(compiled.value);
    compiledSources.push({
      path: sourcePath,
      value: source,
      program: compiled.value,
      triggerWrapped: Boolean(trigger),
    });
    return true;
  };

  if (hasImmediateEffects) compileSource(resolvedTrigger.immediateEffects, `${path}.effects`);
  const triggeredPath = resolvedTrigger.structured ? `${path}.trigger.effects` : `${path}.effects`;
  if (hasTriggeredEffects) compileSource(resolvedTrigger.triggeredEffects, triggeredPath, compileTrigger);
  const compiledProgram = {
    spec: 'mwg.effect/v1' as const,
    steps: programs.flatMap(program => program.steps),
  };
  if (programs.length === 0) {
    return;
  }
  const policy = validateEffectProgramPolicy(compiledProgram, {
    ...resolvedOptions,
    // Each public creates template is validated independently below. Avoid
    // leaking the compiler's internal generated-card AST path here.
    validateGeneratedCards: false,
  });
  if (!policy.ok) {
    policy.issues.forEach(issue =>
      addIssue(
        issues,
        appendCombinedProgramIssuePath(`${path}.effects`, issue.path, compiledSources),
        issue.code,
        issue.message,
      ),
    );
  }
}

function validateDiscardEffects(
  value: Record<string, any>,
  path: string,
  issues: ContentContractIssue[],
  knownStatusIds: ReadonlySet<string>,
): void {
  if (!hasOwn(value, 'discard_effects')) return;
  if (!isCompactEffectList(value.discard_effects)) {
    addIssue(issues, `${path}.discard_effects`, 'INVALID_EFFECT_SOURCE', 'discard_effects must be an object or array');
    return;
  }
  const compiled = compileCompactEffectList(value.discard_effects, { creates: value.creates });
  if (!compiled.ok) {
    compiled.issues.forEach(issue =>
      addIssue(
        issues,
        appendProgramIssuePath(
          `${path}.discard_effects`,
          issue.path,
          true,
          !Array.isArray(value.discard_effects),
        ),
        issue.code,
        issue.message,
      ),
    );
    return;
  }
  const policyResult = validateEffectProgramPolicy(compiled.value, {
    triggerPolicy: 'forbid',
    modifierPolicy: 'forbid',
    knownStatusIds,
    validateGeneratedCards: false,
  });
  if (!policyResult.ok) {
    policyResult.issues.forEach(issue =>
      addIssue(
        issues,
        appendProgramIssuePath(
          `${path}.discard_effects`,
          issue.path,
          true,
          !Array.isArray(value.discard_effects),
        ),
        issue.code,
        issue.message,
      ),
    );
  }
}

function validateGeneratedCardTemplates(
  value: unknown,
  path: string,
  issues: ContentContractIssue[],
  knownStatusIds: ReadonlySet<string>,
): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    addIssue(issues, path, 'INVALID_CARD_TEMPLATES', 'creates must be an array');
    return;
  }
  if (value.length > 32) {
    addIssue(issues, path, 'TOO_MANY_CARD_TEMPLATES', 'creates cannot exceed 32 templates');
  }
  const templates = validateIdList(value, path, issues, { requireId: true });
  templates.forEach((template, index) => {
    const templatePath = `${path}[${index}]`;
    validateWrapperFields(template, templatePath, CARD_TEMPLATE_FIELDS, issues);
    validateRequiredName(template, templatePath, issues);
    const type = String(template.type ?? 'Skill');
    const rarity = String(template.rarity ?? 'Common');
    if (!CARD_TYPE_SET.has(type)) {
      addIssue(issues, `${templatePath}.type`, 'INVALID_CARD_TYPE', `unsupported card type: ${type}`);
    }
    if (!CARD_RARITY_SET.has(rarity)) {
      addIssue(issues, `${templatePath}.rarity`, 'INVALID_CARD_RARITY', `unsupported card rarity: ${rarity}`);
    }
    if (type === 'Curse') {
      if (template.cost !== undefined) {
        addIssue(issues, `${templatePath}.cost`, 'INVALID_CURSE_COST', 'Curse card templates cannot contain cost');
      }
    } else if (validateCardCost(template.cost ?? 0)) {
      addIssue(
        issues,
        `${templatePath}.cost`,
        'INVALID_CARD_COST',
        'cost must be a non-negative integer, energy, or a valid resource map',
      );
    }
    const lifecycleIssue = validateCardLifecycle(template.lifecycle);
    if (lifecycleIssue) addIssue(issues, `${templatePath}.lifecycle`, 'INVALID_CARD_LIFECYCLE', lifecycleIssue);
    for (const flag of ['unique', 'retain', 'exhaust', 'ethereal', 'sly']) {
      if (template[flag] !== undefined && typeof template[flag] !== 'boolean') {
        addIssue(issues, `${templatePath}.${flag}`, 'INVALID_BOOLEAN', `${flag} must be a boolean`);
      }
    }
    const trigger = resolveTriggerInput(template);
    if (
      trigger.trigger !== undefined &&
      (typeof trigger.trigger !== 'string' || !ABILITY_TRIGGER_SET.has(trigger.trigger) || trigger.trigger === 'battle_start')
    ) {
      addIssue(
        issues,
        `${templatePath}.trigger${trigger.structured ? '.on' : ''}`,
        'INVALID_TRIGGER',
        `unsupported card trigger: ${String(trigger.trigger)}`,
      );
    }
    const costComponents = normalizeCardCost(template.cost ?? 0);
    validateEffectSource(
      { ...template, creates: value },
      templatePath,
      issues,
      {
        triggerPolicy: type === 'Power' ? 'require_root_or_status' : 'forbid',
        modifierPolicy: 'forbid',
        allowSpentEnergy: Object.prototype.hasOwnProperty.call(costComponents, 'energy'),
        allowXValue: costComponents.energy === 'all',
        allowSpentResources: new Set(Object.keys(costComponents)),
        allowXResources: new Set(
          Object.entries(costComponents)
            .filter(([, component]) => component === 'all')
            .map(([id]) => id),
        ),
        allowNarrate: type === 'Event',
        requireSingleNarrate: type === 'Event',
        allowCardDestination: type !== 'Event',
        allowCurrentCardReplay: type !== 'Power' && type !== 'Event',
        allowPersistentGrowth: true,
        knownStatusIds,
      },
      type !== 'Curse',
    );
    validateDiscardEffects({ ...template, creates: value }, templatePath, issues, knownStatusIds);
  });
}

function validateIdList(
  value: unknown,
  path: string,
  issues: ContentContractIssue[],
  options: { requireId?: boolean; allowOwnedCopies?: boolean } = {},
): Array<Record<string, any>> {
  const list = Array.isArray(value) ? value : [];
  if (!Array.isArray(value)) {
    addIssue(issues, path, 'INVALID_LIST', 'content collections must be arrays');
    return [];
  }
  const seen = new Map<string, { entry: Record<string, any>; index: number }>();
  const seenRunInstanceIds = new Set<string>();
  const records: Array<Record<string, any>> = [];
  list.forEach((entry, index) => {
    const entryPath = `${path}[${index}]`;
    if (!isRecord(entry)) {
      addIssue(issues, entryPath, 'INVALID_ENTRY', 'content entries must be objects');
      return;
    }
    records.push(entry);
    if (entry.id === undefined && !options.requireId) return;
    if (!validId(entry.id)) {
      addIssue(issues, `${entryPath}.id`, 'INVALID_ID', 'id must start with a letter or underscore');
      return;
    }
    const previous = seen.get(entry.id);
    if (previous) {
      const previousRunId =
        typeof previous.entry.runInstanceId === 'string' ? previous.entry.runInstanceId.trim() : '';
      const runInstanceId = typeof entry.runInstanceId === 'string' ? entry.runInstanceId.trim() : '';
      const isDistinctOwnedCopy =
        options.allowOwnedCopies === true && previous.entry.unique !== true && entry.unique !== true &&
        Boolean(previousRunId) &&
        Boolean(runInstanceId) &&
        previousRunId !== runInstanceId &&
        !seenRunInstanceIds.has(runInstanceId);
      if (!isDistinctOwnedCopy) {
        addIssue(issues, `${entryPath}.id`, 'DUPLICATE_ID', `duplicate id: ${entry.id}`);
      }
    } else {
      seen.set(entry.id, { entry, index });
    }
    if (typeof entry.runInstanceId === 'string' && entry.runInstanceId.trim()) {
      const runInstanceId = entry.runInstanceId.trim();
      if (seenRunInstanceIds.has(runInstanceId)) {
        addIssue(
          issues,
          `${entryPath}.runInstanceId`,
          'DUPLICATE_RUN_INSTANCE_ID',
          `duplicate run card identity: ${runInstanceId}`,
        );
      }
      seenRunInstanceIds.add(runInstanceId);
    }
  });
  return records;
}

function validateCard(
  value: Record<string, any>,
  path: string,
  issues: ContentContractIssue[],
  required: boolean,
  knownStatusIds: ReadonlySet<string>,
): void {
  validateWrapperFields(value, path, CARD_WRAPPER_FIELDS, issues);
  validateRequiredName(value, path, issues);
  const type = String(value.type ?? 'Skill');
  const rarity = String(value.rarity ?? 'Common');
  if (!CARD_TYPE_SET.has(type)) addIssue(issues, `${path}.type`, 'INVALID_CARD_TYPE', `unsupported card type: ${type}`);
  if (!CARD_RARITY_SET.has(rarity))
    addIssue(issues, `${path}.rarity`, 'INVALID_CARD_RARITY', `unsupported card rarity: ${rarity}`);
  const quantity = value.quantity ?? 1;
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100)
    addIssue(issues, `${path}.quantity`, 'INVALID_QUANTITY', 'quantity must be an integer from 1 to 100');
  if (value.unique === true && quantity !== 1) addIssue(issues, `${path}.quantity`, 'DUPLICATE_UNIQUE_CARD', '唯一卡牌 quantity 必须为 1');
  if (type === 'Curse') {
    if (value.cost !== undefined) addIssue(issues, `${path}.cost`, 'INVALID_CURSE_COST', 'Curse cards cannot contain cost');
  } else if (validateCardCost(value.cost ?? 0)) {
    addIssue(issues, `${path}.cost`, 'INVALID_CARD_COST', 'cost must be a non-negative integer, energy, or a valid resource map');
  }
  const lifecycleIssue = validateCardLifecycle(value.lifecycle);
  if (lifecycleIssue) addIssue(issues, `${path}.lifecycle`, 'INVALID_CARD_LIFECYCLE', lifecycleIssue);
  for (const flag of ['unique', 'retain', 'exhaust', 'ethereal', 'innate', 'sly']) {
    if (value[flag] !== undefined && typeof value[flag] !== 'boolean') {
      addIssue(issues, `${path}.${flag}`, 'INVALID_BOOLEAN', `${flag} must be a boolean`);
    }
  }
  if (value.requires_summon !== undefined && (typeof value.requires_summon !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(value.requires_summon)))
    addIssue(issues, `${path}.requires_summon`, 'INVALID_SUMMON_ID', 'requires_summon must be a stable summon template ID');
  if (hasOwn(value, 'discard_requirement')) {
    addIssue(
      issues,
      `${path}.discard_requirement`,
      'REMOVED_CARD_FIELD',
      'discard_requirement is no longer supported',
    );
  }
  const costComponents = normalizeCardCost(value.cost ?? 0);
  const policy: EffectProgramPolicyOptions = {
    triggerPolicy: type === 'Power' ? 'require_root_or_status' : 'forbid',
    modifierPolicy: 'forbid',
    allowSpentEnergy: Object.prototype.hasOwnProperty.call(costComponents, 'energy'),
    allowXValue: costComponents.energy === 'all',
    allowSpentResources: new Set(Object.keys(costComponents)),
    allowXResources: new Set(Object.entries(costComponents).filter(([, component]) => component === 'all').map(([id]) => id)),
    allowNarrate: type === 'Event',
    requireSingleNarrate: type === 'Event',
    allowCardDestination: type !== 'Event',
    allowCurrentCardReplay: type !== 'Power' && type !== 'Event',
    allowPersistentGrowth: true,
    knownStatusIds,
  };
  validateGeneratedCardTemplates(value.creates, `${path}.creates`, issues, knownStatusIds);
  const cardTrigger = resolveTriggerInput(value);
  if (
    cardTrigger.trigger !== undefined &&
    (typeof cardTrigger.trigger !== 'string' || !ABILITY_TRIGGER_SET.has(cardTrigger.trigger) || cardTrigger.trigger === 'battle_start')
  ) {
    addIssue(issues, `${path}.trigger${cardTrigger.structured ? '.on' : ''}`, 'INVALID_TRIGGER', `unsupported card trigger: ${String(cardTrigger.trigger)}`);
  }
  // A Curse may deliberately be a dead draw whose only mechanic is occupying
  // and retaining a hand slot. That behavior is implemented by the card type
  // itself, so it does not need an invented no-op authored effect.
  validateEffectSource(value, path, issues, policy, required && type !== 'Curse');
  if (hasOwn(value, 'discard_effect')) {
    addIssue(
      issues,
      `${path}.discard_effect`,
      'REMOVED_EFFECT_FIELD',
      'discard_effect is not supported; use shallow discard_effects',
    );
  }
  validateDiscardEffects(value, path, issues, knownStatusIds);
}

function validateNamedExecutable(
  value: Record<string, any>,
  path: string,
  issues: ContentContractIssue[],
  options: EffectProgramPolicyOptions,
  required: boolean,
  requirements: {
    requireName?: boolean;
    requireModernTrigger?: boolean;
    enemyCollectionTarget?: 'self' | 'opponent';
  } = {},
): void {
  if (!isRecord(value)) {
    addIssue(issues, path, 'INVALID_ENTRY', 'executable definitions must be objects');
    return;
  }
  if (requirements.requireName) validateRequiredName(value, path, issues);
  validateGeneratedCardTemplates(value.creates, `${path}.creates`, issues, options.knownStatusIds || new Set());
  const resolvedTrigger = resolveTriggerInput(value);
  if (requirements.requireModernTrigger && resolvedTrigger.structured && resolvedTrigger.immediateEffects !== undefined) {
    addIssue(issues, `${path}.effects`, 'UNEXPECTED_IMMEDIATE_EFFECTS', 'structured relic and ability effects belong inside trigger.effects');
  }
  if (resolvedTrigger.trigger !== undefined && (typeof resolvedTrigger.trigger !== 'string' || !ABILITY_TRIGGER_SET.has(resolvedTrigger.trigger))) {
    addIssue(issues, `${path}.trigger${resolvedTrigger.structured ? '.on' : ''}`, 'INVALID_TRIGGER', `unsupported trigger: ${String(resolvedTrigger.trigger)}`);
  }
  if (requirements.requireModernTrigger && (hasOwn(value, 'effects') || resolvedTrigger.structured) && resolvedTrigger.trigger === undefined) {
    addIssue(issues, `${path}.trigger`, 'MISSING_TRIGGER', 'modern effects require a trigger');
  }
  const protectionOnlyPassive = value.protection !== undefined &&
    normalizeDamageProtectionRule(value.protection) !== null &&
    resolvedTrigger.trigger === 'passive' &&
    isEmptyProtectionEffect(resolvedTrigger.triggeredEffects) &&
    resolvedTrigger.immediateEffects === undefined;
  if (value.protection !== undefined && !normalizeDamageProtectionRule(value.protection)) {
    addIssue(issues, `${path}.protection`, 'INVALID_PROTECTION', 'protection must be a valid damage protection rule');
  }
  if (protectionOnlyPassive && resolvedTrigger.structured) validateStructuredTriggerInput(value.trigger, `${path}.trigger`, issues);
  if (!protectionOnlyPassive) {
    validateEffectSource(
      value,
      path,
      issues,
      options,
      required,
      { enemyCollectionTarget: requirements.enemyCollectionTarget },
    );
  }
}

function observesCardPayment(value: Record<string, any>): boolean {
  const trigger = resolveTriggerInput(value).trigger;
  return trigger === 'card_played' || trigger === 'attack_played' || trigger === 'skill_played' || trigger === 'power_played';
}

function validateStatusList(
  value: unknown,
  path: string,
  issues: ContentContractIssue[],
  externalKnownStatusIds: Iterable<string> = [],
): Set<string> {
  const statuses = validateIdList(value, path, issues, { requireId: true });
  const authoredIds = new Set<string>();
  statuses.forEach((status, index) => {
    const statusPath = `${path}[${index}]`;
    const validation = validateCompactStatusDefinition(status);
    if (!validation.ok) {
      const triggerMatch = validation.message.match(
        /^(?:状态 (apply|stack|tick|remove|hold|threshold_execute)\b|triggers\.(apply|stack|tick|remove|hold|threshold_execute)\b)/,
      );
      const trigger = triggerMatch?.[1] || triggerMatch?.[2];
      const triggerValue = trigger && isRecord(status.triggers) ? status.triggers[trigger] : undefined;
      const triggerPath =
        trigger && Array.isArray(triggerValue)
          ? `${statusPath}.triggers.${trigger}[0]`
          : trigger
            ? `${statusPath}.triggers.${trigger}`
            : statusPath;
      addIssue(issues, triggerPath, 'INVALID_STATUS', validation.message);
    }
    if (validId(status.id)) authoredIds.add(status.id);
  });
  const knownIds = new Set([...externalKnownStatusIds, ...authoredIds]);
  statuses.forEach((status, index) => {
    for (const reference of collectCompactStatusDefinitionReferences(status)) {
      if (!knownIds.has(reference)) {
        addIssue(
          issues,
          `${path}[${index}].triggers`,
          'UNKNOWN_STATUS',
          `status trigger references an unregistered status: ${reference}`,
        );
      }
    }
  });
  return knownIds;
}

/**
 * Validate the portable content boundary shared by Tavern, websites, services, and Mods.
 * Removed effect fields are rejected here so every host consumes one modern contract.
 */
export function validateContentPackContract(
  value: unknown,
  options: ContentContractOptions = {},
): ContentContractResult {
  const issues: ContentContractIssue[] = [];
  if (!isContentPack(value)) return { ok: false, issues: [{ path: 'content', code: 'INVALID_PACK', message: 'content pack shape is invalid' }] };
  const pack = value;
  const required = options.requireExecutable === true;
  const statusIds = validateStatusList(pack.statuses, 'statuses', issues, options.knownStatusIds);
  validateCombatResourceDefinitions(pack.playerResources || [], 'playerResources').forEach(issue =>
    addIssue(issues, issue.path, issue.code, issue.message),
  );
  validateCombatContainers(
    { stance: pack.playerStance, orb_slots: pack.playerOrbSlots, orbs: pack.playerOrbs },
    'playerCore',
    issues,
    statusIds,
  );

  const cards = validateIdList(pack.cards, 'cards', issues, { requireId: true, allowOwnedCopies: true });
  cards.forEach((card, index) => validateCard(card, `cards[${index}]`, issues, required, statusIds));

  const relics = validateIdList(pack.relics, 'relics', issues, { requireId: true });
  relics.forEach((relic, index) => {
    const path = `relics[${index}]`;
    validateWrapperFields(relic, path, RELIC_WRAPPER_FIELDS, issues);
    if (!RELIC_RARITY_SET.has(String(relic.rarity ?? 'Common')))
      addIssue(issues, `${path}.rarity`, 'INVALID_RELIC_RARITY', 'unsupported relic rarity');
    const hasAcquire = Object.prototype.hasOwnProperty.call(relic, 'on_acquire');
    if (hasAcquire) {
      const knownResourceIds = [
        ...(options.knownResourceIds || []),
        ...(pack.playerResources || []).filter(isRecord).map(resource => resource.id).filter((id): id is string => typeof id === 'string'),
      ];
      const acquisitionIssue = validateArtifactAcquisitionContract(relic, {
        knownResourceIds,
        validateCandidate: (category, candidate) => {
          const nested = validateRewardCandidateAgainstLibrary(category, candidate, {
            knownResourceIds,
            knownStatusIds: statusIds,
            statusDefinitions: [...pack.statuses, ...(options.referenceStatusDefinitions || [])],
            existing: category === 'cards' ? pack.cards : category === 'items' ? pack.items : [],
          });
          return nested.ok ? null : nested.message;
        },
      });
      if (acquisitionIssue) addIssue(issues, `${path}.on_acquire`, 'INVALID_ON_ACQUIRE', acquisitionIssue);
    }
    const hasBattleTrigger = resolveTriggerInput(relic).trigger !== undefined;
    if (!hasBattleTrigger && !hasAcquire) {
      addIssue(
        issues,
        Object.prototype.hasOwnProperty.call(relic, 'effects') ? `${path}.trigger` : path,
        Object.prototype.hasOwnProperty.call(relic, 'effects') ? 'MISSING_TRIGGER' : 'MISSING_RELIC_BEHAVIOR',
        Object.prototype.hasOwnProperty.call(relic, 'effects') ? 'modern relic effects require a trigger' : 'relic requires trigger or on_acquire',
      );
      return;
    }
    if (hasBattleTrigger) {
      validateNamedExecutable(
        relic,
        path,
        issues,
        {
          triggerPolicy: 'allow',
          modifierPolicy: resolveTriggerInput(relic).trigger === 'passive' ? 'only' : 'forbid',
          allowSpentEnergy: observesCardPayment(relic),
          allowPersistentGrowth: true,
          knownStatusIds: statusIds,
        },
        required,
        { requireName: true, requireModernTrigger: true },
      );
    } else {
      validateRequiredName(relic, path, issues);
    }
  });

  const items = validateIdList(pack.items, 'items', issues, { requireId: true });
  items.forEach((item, index) => {
    const path = `items[${index}]`;
    validateWrapperFields(item, path, ITEM_WRAPPER_FIELDS, issues);
    const count = item.count ?? 1;
    if (!Number.isInteger(count) || count < 1 || count > 999)
      addIssue(issues, `${path}.count`, 'INVALID_COUNT', 'count must be an integer from 1 to 999');
    if (item.trigger !== undefined) addIssue(issues, `${path}.trigger`, 'INVALID_TRIGGER', 'items cannot register triggers');
    validateNamedExecutable(
      item,
      path,
      issues,
      { triggerPolicy: 'forbid', modifierPolicy: 'forbid', allowPersistentGrowth: true, knownStatusIds: statusIds },
      required,
      { requireName: true },
    );
  });

  const abilities = validateIdList(pack.abilities, 'abilities', issues, { requireId: true });
  abilities.forEach((ability, index) => {
    validateWrapperFields(ability, `abilities[${index}]`, ABILITY_WRAPPER_FIELDS, issues);
    validateNamedExecutable(
      ability,
      `abilities[${index}]`,
      issues,
      {
        triggerPolicy: 'allow',
        modifierPolicy: resolveTriggerInput(ability).trigger === 'passive' ? 'only' : 'forbid',
        allowSpentEnergy: observesCardPayment(ability),
        allowPersistentGrowth: true,
        knownStatusIds: statusIds,
      },
      required,
      { requireModernTrigger: true },
    );
  });

  const activeStatuses = validateIdList(pack.activeStatuses, 'activeStatuses', issues, { requireId: true });
  activeStatuses.forEach((status, index) => {
    const stacks = status.stacks ?? 1;
    if (!Number.isInteger(stacks) || stacks <= 0) addIssue(issues, `activeStatuses[${index}].stacks`, 'INVALID_STACKS', 'stacks must be a positive integer');
    if (validId(status.id) && !statusIds.has(status.id))
      addIssue(issues, `activeStatuses[${index}].id`, 'UNKNOWN_STATUS', `status is not registered: ${status.id}`);
  });

  if (pack.enemy === null) {
    if (options.requireEnemy) addIssue(issues, 'enemy', 'MISSING_ENEMY', 'battle content must contain an enemy');
  } else if (!isRecord(pack.enemy)) {
    addIssue(issues, 'enemy', 'INVALID_ENEMY', 'enemy must be an object');
  } else {
    const enemy = pack.enemy;
    validateRequiredName(enemy, 'enemy', issues);
    if (enemy.quantity !== undefined && (!Number.isSafeInteger(enemy.quantity) || enemy.quantity < 1 || enemy.quantity > 100)) addIssue(issues, 'enemy.quantity', 'INVALID_ENEMY_QUANTITY', '敌人 quantity 必须为 1 到 100 的整数');
    if (enemy.victory_on_defeat !== undefined && typeof enemy.victory_on_defeat !== 'boolean') addIssue(issues, 'enemy.victory_on_defeat', 'INVALID_VICTORY_TARGET', 'victory_on_defeat 必须为布尔值');
    if (enemy.escape_when !== undefined) {
      const compiled = compileCompactCondition(enemy.escape_when, 'enemy.escape_when');
      if (!compiled.ok) compiled.issues.forEach(issue => addIssue(issues, issue.path, issue.code, issue.message));
    }
    if (enemy.defeat_reward !== undefined) {
      if (!isRecord(enemy.defeat_reward)) addIssue(issues, 'enemy.defeat_reward', 'INVALID_DEFEAT_REWARD', 'defeat_reward must be an object');
      else {
        const unknown = Object.keys(enemy.defeat_reward).find(key => !['cards', 'artifacts', 'items', 'gold'].includes(key));
        if (unknown) addIssue(issues, `enemy.defeat_reward.${unknown}`, 'UNKNOWN_FIELD', 'unsupported defeat reward field');
        for (const key of ['cards', 'artifacts', 'items'] as const) {
          if (enemy.defeat_reward[key] !== undefined && !Array.isArray(enemy.defeat_reward[key]))
            addIssue(issues, `enemy.defeat_reward.${key}`, 'INVALID_LIST', `${key} must be an array`);
        }
        if (enemy.defeat_reward.gold !== undefined && (!Number.isInteger(enemy.defeat_reward.gold) || enemy.defeat_reward.gold < 0))
          addIssue(issues, 'enemy.defeat_reward.gold', 'INVALID_GOLD', 'gold must be a non-negative integer');
      }
    }
    validateCombatResourceDefinitions(enemy.resources ?? [], 'enemy.resources').forEach(issue =>
      addIssue(issues, issue.path, issue.code, issue.message),
    );
    issues.push(...validateEnemyActionReferences(enemy, 'enemy'));
    const actions = Array.isArray(enemy.actions) ? enemy.actions : null;
    const actionNames = new Set<string>();
    if (!actions) addIssue(issues, 'enemy.actions', 'INVALID_LIST', 'enemy actions must be an array');
    else {
      if (actions.length === 0) addIssue(issues, 'enemy.actions', 'EMPTY_LIST', 'enemy must contain at least one action');
      actions.forEach((action, index) => {
        const path = `enemy.actions[${index}]`;
        if (!isRecord(action)) {
          addIssue(issues, path, 'INVALID_ENTRY', 'enemy actions must be objects');
          return;
        }
        validateWrapperFields(action, path, ENEMY_ACTION_WRAPPER_FIELDS, issues);
        if (typeof action.name !== 'string' || !action.name.trim()) addIssue(issues, `${path}.name`, 'INVALID_NAME', 'action name cannot be empty');
        else if (actionNames.has(action.name)) addIssue(issues, `${path}.name`, 'DUPLICATE_NAME', `duplicate action name: ${action.name}`);
        else actionNames.add(action.name);
        const weight = action.weight ?? 1;
        if (typeof weight !== 'number' || !Number.isFinite(weight) || weight <= 0)
          addIssue(issues, `${path}.weight`, 'INVALID_WEIGHT', 'action weight must be positive');
        validateNamedExecutable(
          action,
          path,
          issues,
          { triggerPolicy: 'forbid', modifierPolicy: 'forbid', knownStatusIds: statusIds },
          required,
          { enemyCollectionTarget: 'self' },
        );
      });
    }
    validateEnemyActionConfiguration(enemy, 'enemy', actionNames, issues);
    const enemyActiveStatuses = validateIdList(enemy.status_effects ?? [], 'enemy.status_effects', issues, { requireId: true });
    enemyActiveStatuses.forEach((status, index) => {
      const stacks = status.stacks ?? 1;
      if (!Number.isInteger(stacks) || stacks <= 0) {
        addIssue(issues, `enemy.status_effects[${index}].stacks`, 'INVALID_STACKS', 'stacks must be a positive integer');
      }
      if (validId(status.id) && !statusIds.has(status.id)) {
        addIssue(issues, `enemy.status_effects[${index}].id`, 'UNKNOWN_STATUS', `status is not registered: ${status.id}`);
      }
    });
    validateCombatContainers(enemy, 'enemy', issues, statusIds, 'self');
    const enemyAbilities = validateIdList(enemy.abilities ?? [], 'enemy.abilities', issues, { requireId: true });
    enemyAbilities.forEach((ability, index) => {
      validateWrapperFields(ability, `enemy.abilities[${index}]`, ABILITY_WRAPPER_FIELDS, issues);
      validateNamedExecutable(
        ability,
        `enemy.abilities[${index}]`,
        issues,
        {
          triggerPolicy: 'allow',
          modifierPolicy: resolveTriggerInput(ability).trigger === 'passive' ? 'only' : 'forbid',
          allowSpentEnergy: observesCardPayment(ability),
          knownStatusIds: statusIds,
        },
        required,
        { requireModernTrigger: true, enemyCollectionTarget: 'self' },
      );
    });
    const enemyDesire = enemy.lust_effect;
    if (enemyDesire !== undefined) {
      if (!isRecord(enemyDesire)) addIssue(issues, 'enemy.lust_effect', 'INVALID_ENTRY', 'desire effect must be an object');
      else {
        validateWrapperFields(enemyDesire, 'enemy.lust_effect', NAMED_EFFECT_WRAPPER_FIELDS, issues);
        validateNamedExecutable(
          enemyDesire,
          'enemy.lust_effect',
          issues,
          { triggerPolicy: 'forbid', modifierPolicy: 'forbid', knownStatusIds: statusIds },
          required,
          { requireName: true, enemyCollectionTarget: 'self' },
        );
      }
    }
  }

  if (pack.desireEffects.player !== null) {
    validateWrapperFields(pack.desireEffects.player, 'desireEffects.player', NAMED_EFFECT_WRAPPER_FIELDS, issues);
    validateNamedExecutable(
      pack.desireEffects.player,
      'desireEffects.player',
      issues,
      { triggerPolicy: 'forbid', modifierPolicy: 'forbid', allowPersistentGrowth: true, knownStatusIds: statusIds },
      required,
      { requireName: true },
    );
  }
  if (pack.desireEffects.enemy !== null) {
    validateWrapperFields(pack.desireEffects.enemy, 'desireEffects.enemy', NAMED_EFFECT_WRAPPER_FIELDS, issues);
    validateNamedExecutable(
      pack.desireEffects.enemy,
      'desireEffects.enemy',
      issues,
      { triggerPolicy: 'forbid', modifierPolicy: 'forbid', knownStatusIds: statusIds },
      required,
      { requireName: true, enemyCollectionTarget: 'self' },
    );
  }

  // Validate every additional enemy with the same executable contract while
  // preserving the legacy first enemy path for existing diagnostics.
  for (let index = 1; index < (pack.enemies || []).length; index += 1) {
    const enemy = pack.enemies![index];
    const nested = validateContentPackContract(
      {
        ...pack,
        enemy,
        enemies: undefined,
        desireEffects: { ...pack.desireEffects, enemy: isRecord(enemy) && isRecord(enemy.lust_effect) ? enemy.lust_effect : null },
      },
      options,
    );
    if (!nested.ok) {
      for (const issue of nested.issues) {
        if (issue.path === 'enemy' || issue.path.startsWith('enemy.')) {
          issues.push({ ...issue, path: `enemies[${index}]${issue.path.slice('enemy'.length)}` });
        }
      }
    }
  }

  validateLustOverflowCoverage(pack, issues, options);

  return issues.length > 0 ? { ok: false, issues } : { ok: true, value: pack };
}

export function formatContentContractIssues(issues: readonly ContentContractIssue[], limit = 4): string {
  const shown = issues.slice(0, limit).map(issue => `${issue.path}: ${issue.message}`);
  if (issues.length > limit) shown.push(`${issues.length - limit} more issue(s)`);
  return shown.join('; ');
}

/** Project a portable content path onto the canonical MUV battle root. */
export function contentPathToBattlePath(path: string): string {
  if (path === 'playerResources') return 'battle.core.resources';
  if (path.startsWith('playerResources[')) return `battle.core.resources${path.slice('playerResources'.length)}`;
  if (path === 'playerCore') return 'battle.core';
  if (path.startsWith('playerCore.')) return `battle.core.${path.slice('playerCore.'.length)}`;
  if (path === 'enemies') return 'battle.enemies';
  if (path.startsWith('enemies[')) return `battle.${path}`;
  if (path === 'enemy') return 'battle.enemy';
  if (path.startsWith('enemy.')) return `battle.${path}`;
  if (path.startsWith('desireEffects.player')) {
    return `battle.player_lust_effect${path.slice('desireEffects.player'.length)}`;
  }
  if (path.startsWith('desireEffects.enemy')) {
    return `battle.enemy.lust_effect${path.slice('desireEffects.enemy'.length)}`;
  }
  if (path.startsWith('activeStatuses')) return `battle.player_status_effects${path.slice('activeStatuses'.length)}`;
  if (path.startsWith('relics')) return `battle.artifacts${path.slice('relics'.length)}`;
  if (path.startsWith('abilities')) return `battle.player_abilities${path.slice('abilities'.length)}`;
  return `battle.${path}`;
}
