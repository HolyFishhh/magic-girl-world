import { compileCompactEffectList } from './compactEffectDsl';
import { isCompactEffectList } from './compactEffectContract';
import { validateEffectProgramPolicy, type EffectProgramPolicyOptions } from './effectProgramPolicy';
import type { EffectProgram } from './effectDsl';
import { validateCompactStatusDefinition } from './statusDefinitionValidation';
import { isContentPack, type ContentDefinition, type ContentPack } from './contentPack';
import { ABILITY_TRIGGER_SET } from './battleTriggers';
import { resolveTriggerInput } from './triggerInput';
import { CARD_RARITY_SET, CARD_TYPE_SET, RELIC_RARITY_SET } from './contentCatalog';

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
}


function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function addIssue(issues: ContentContractIssue[], path: string, code: string, message: string): void {
  issues.push({ path, code, message });
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

function validateEffectSource(
  value: Record<string, unknown>,
  path: string,
  issues: ContentContractIssue[],
  options: EffectProgramPolicyOptions,
  required: boolean,
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
  const isOuterLifecycle = rootTrigger === 'battle_start' || rootTrigger === 'passive';
  const compileTrigger = rootTrigger && !isOuterLifecycle ? rootTrigger : undefined;
  const resolvedOptions = isOuterLifecycle ? { ...options, triggerPolicy: 'forbid' as const } : options;

  if (resolvedTrigger.structured) {
    const triggerObject = value.trigger as Record<string, unknown>;
    for (const key of Object.keys(triggerObject)) {
      if (key !== 'on' && key !== 'effects') {
        addIssue(issues, `${path}.trigger.${key}`, 'UNKNOWN_FIELD', `unsupported trigger field: ${key}`);
      }
    }
  }

  const programs: EffectProgram[] = [];
  const compileSource = (source: unknown, sourcePath: string, trigger?: string): boolean => {
    if (!isCompactEffectList(source)) {
      addIssue(issues, sourcePath, 'INVALID_EFFECT_SOURCE', 'effects must be a shallow object or array');
      return false;
    }
    const compiled = compileCompactEffectList(source, {
      trigger,
      when: trigger ? undefined : value.when,
      creates: value.creates,
    });
    if (!compiled.ok) {
      compiled.issues.forEach(issue =>
        addIssue(issues, appendProgramIssuePath(sourcePath, issue.path, true, !Array.isArray(source)), issue.code, issue.message),
      );
      return false;
    }
    programs.push(compiled.value);
    return true;
  };

  if (hasImmediateEffects && !compileSource(resolvedTrigger.immediateEffects, `${path}.effects`)) return;
  const triggeredPath = resolvedTrigger.structured ? `${path}.trigger.effects` : `${path}.effects`;
  if (hasTriggeredEffects && !compileSource(resolvedTrigger.triggeredEffects, triggeredPath, compileTrigger)) return;
  const compiledProgram = {
    spec: 'mwg.effect/v1' as const,
    steps: programs.flatMap(program => program.steps),
  };
  if (programs.length === 0) {
    if (required) addIssue(issues, path, 'MISSING_EFFECT_SOURCE', 'an executable definition must contain effects');
    return;
  }
  const policy = validateEffectProgramPolicy(compiledProgram, resolvedOptions);
  if (!policy.ok) {
    policy.issues.forEach(issue =>
      addIssue(issues, appendProgramIssuePath(`${path}.effects`, issue.path, true, !Array.isArray(value.effects)), issue.code, issue.message),
    );
  }
}

function validateIdList(
  value: unknown,
  path: string,
  issues: ContentContractIssue[],
  options: { requireId?: boolean } = {},
): Array<Record<string, any>> {
  const list = Array.isArray(value) ? value : [];
  if (!Array.isArray(value)) {
    addIssue(issues, path, 'INVALID_LIST', 'content collections must be arrays');
    return [];
  }
  const seen = new Set<string>();
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
    if (seen.has(entry.id)) addIssue(issues, `${entryPath}.id`, 'DUPLICATE_ID', `duplicate id: ${entry.id}`);
    seen.add(entry.id);
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
  validateRequiredName(value, path, issues);
  const type = String(value.type ?? 'Skill');
  const rarity = String(value.rarity ?? 'Common');
  if (!CARD_TYPE_SET.has(type)) addIssue(issues, `${path}.type`, 'INVALID_CARD_TYPE', `unsupported card type: ${type}`);
  if (!CARD_RARITY_SET.has(rarity))
    addIssue(issues, `${path}.rarity`, 'INVALID_CARD_RARITY', `unsupported card rarity: ${rarity}`);
  const quantity = value.quantity ?? 1;
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100)
    addIssue(issues, `${path}.quantity`, 'INVALID_QUANTITY', 'quantity must be an integer from 1 to 100');
  if (type === 'Curse') {
    if (value.cost !== undefined) addIssue(issues, `${path}.cost`, 'INVALID_CURSE_COST', 'Curse cards cannot contain cost');
  } else if (value.cost !== 'energy' && (!Number.isInteger(value.cost ?? 0) || Number(value.cost ?? 0) < 0)) {
    addIssue(issues, `${path}.cost`, 'INVALID_CARD_COST', 'cost must be a non-negative integer or energy');
  }
  for (const flag of ['retain', 'exhaust', 'ethereal', 'innate']) {
    if (value[flag] !== undefined && typeof value[flag] !== 'boolean') {
      addIssue(issues, `${path}.${flag}`, 'INVALID_BOOLEAN', `${flag} must be a boolean`);
    }
  }
  if (hasOwn(value, 'discard_requirement')) {
    addIssue(
      issues,
      `${path}.discard_requirement`,
      'REMOVED_CARD_FIELD',
      'discard_requirement is no longer supported',
    );
  }
  const policy: EffectProgramPolicyOptions = {
    triggerPolicy: type === 'Power' ? 'require_root_or_status' : 'forbid',
    modifierPolicy: 'forbid',
    allowSpentEnergy: value.cost === 'energy',
    allowNarrate: type === 'Event',
    requireSingleNarrate: type === 'Event',
    knownStatusIds,
  };
  const cardTrigger = resolveTriggerInput(value);
  if (
    cardTrigger.trigger !== undefined &&
    (typeof cardTrigger.trigger !== 'string' || !ABILITY_TRIGGER_SET.has(cardTrigger.trigger) || ['battle_start', 'passive'].includes(cardTrigger.trigger))
  ) {
    addIssue(issues, `${path}.trigger${cardTrigger.structured ? '.on' : ''}`, 'INVALID_TRIGGER', `unsupported card trigger: ${String(cardTrigger.trigger)}`);
  }
  validateEffectSource(value, path, issues, policy, required);
  if (hasOwn(value, 'discard_effect')) {
    addIssue(
      issues,
      `${path}.discard_effect`,
      'REMOVED_EFFECT_FIELD',
      'discard_effect is not supported; use shallow discard_effects',
    );
  }
  if (hasOwn(value, 'discard_effects')) {
    if (!isCompactEffectList(value.discard_effects)) {
      addIssue(issues, `${path}.discard_effects`, 'INVALID_EFFECT_SOURCE', 'discard_effects must be an object or array');
    } else {
      const compiled = compileCompactEffectList(value.discard_effects, { creates: value.creates });
      if (!compiled.ok) {
        compiled.issues.forEach(issue =>
          addIssue(issues, appendProgramIssuePath(`${path}.discard_effects`, issue.path, true, !Array.isArray(value.discard_effects)), issue.code, issue.message),
        );
      } else {
        const policyResult = validateEffectProgramPolicy(compiled.value, {
          triggerPolicy: 'forbid',
          modifierPolicy: 'forbid',
          knownStatusIds,
        });
        if (!policyResult.ok)
          policyResult.issues.forEach(issue =>
            addIssue(issues, appendProgramIssuePath(`${path}.discard_effects`, issue.path, true, !Array.isArray(value.discard_effects)), issue.code, issue.message),
          );
      }
    }
  }
}

function validateNamedExecutable(
  value: Record<string, any>,
  path: string,
  issues: ContentContractIssue[],
  options: EffectProgramPolicyOptions,
  required: boolean,
  requirements: { requireName?: boolean; requireModernTrigger?: boolean } = {},
): void {
  if (!isRecord(value)) {
    addIssue(issues, path, 'INVALID_ENTRY', 'executable definitions must be objects');
    return;
  }
  if (requirements.requireName) validateRequiredName(value, path, issues);
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
  validateEffectSource(value, path, issues, options, required);
}

function validateStatusList(
  value: unknown,
  path: string,
  issues: ContentContractIssue[],
): Set<string> {
  const statuses = validateIdList(value, path, issues, { requireId: true });
  const ids = new Set<string>();
  statuses.forEach((status, index) => {
    const statusPath = `${path}[${index}]`;
    const validation = validateCompactStatusDefinition(status);
    if (!validation.ok) {
      const triggerMatch = validation.message.match(
        /^(?:状态 (apply|stack|tick|remove|hold)\b|triggers\.(apply|stack|tick|remove|hold)\b)/,
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
    if (validId(status.id)) ids.add(status.id);
  });
  return ids;
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
  const statusIds = validateStatusList(pack.statuses, 'statuses', issues);

  const cards = validateIdList(pack.cards, 'cards', issues, { requireId: true });
  cards.forEach((card, index) => validateCard(card, `cards[${index}]`, issues, required, statusIds));

  const relics = validateIdList(pack.relics, 'relics', issues, { requireId: true });
  relics.forEach((relic, index) => {
    const path = `relics[${index}]`;
    if (!RELIC_RARITY_SET.has(String(relic.rarity ?? 'Common')))
      addIssue(issues, `${path}.rarity`, 'INVALID_RELIC_RARITY', 'unsupported relic rarity');
    validateNamedExecutable(
      relic,
      path,
      issues,
      {
        triggerPolicy: 'allow',
        modifierPolicy: resolveTriggerInput(relic).trigger === 'passive' ? 'only' : 'forbid',
        knownStatusIds: statusIds,
      },
      required,
      { requireName: true, requireModernTrigger: true },
    );
  });

  const items = validateIdList(pack.items, 'items', issues, { requireId: true });
  items.forEach((item, index) => {
    const path = `items[${index}]`;
    const count = item.count ?? 1;
    if (!Number.isInteger(count) || count < 1 || count > 999)
      addIssue(issues, `${path}.count`, 'INVALID_COUNT', 'count must be an integer from 1 to 999');
    if (item.trigger !== undefined) addIssue(issues, `${path}.trigger`, 'INVALID_TRIGGER', 'items cannot register triggers');
    validateNamedExecutable(
      item,
      path,
      issues,
      { triggerPolicy: 'forbid', modifierPolicy: 'forbid', knownStatusIds: statusIds },
      required,
      { requireName: true },
    );
  });

  const abilities = validateIdList(pack.abilities, 'abilities', issues, { requireId: true });
  abilities.forEach((ability, index) =>
    validateNamedExecutable(
      ability,
      `abilities[${index}]`,
      issues,
      {
        triggerPolicy: 'allow',
        modifierPolicy: resolveTriggerInput(ability).trigger === 'passive' ? 'only' : 'forbid',
        knownStatusIds: statusIds,
      },
      required,
      { requireModernTrigger: true },
    ),
  );

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
    const actions = Array.isArray(enemy.actions) ? enemy.actions : null;
    if (!actions) addIssue(issues, 'enemy.actions', 'INVALID_LIST', 'enemy actions must be an array');
    else {
      if (actions.length === 0) addIssue(issues, 'enemy.actions', 'EMPTY_LIST', 'enemy must contain at least one action');
      const names = new Set<string>();
      actions.forEach((action, index) => {
        const path = `enemy.actions[${index}]`;
        if (!isRecord(action)) {
          addIssue(issues, path, 'INVALID_ENTRY', 'enemy actions must be objects');
          return;
        }
        if (typeof action.name !== 'string' || !action.name.trim()) addIssue(issues, `${path}.name`, 'INVALID_NAME', 'action name cannot be empty');
        else if (names.has(action.name)) addIssue(issues, `${path}.name`, 'DUPLICATE_NAME', `duplicate action name: ${action.name}`);
        else names.add(action.name);
        const weight = action.weight ?? 1;
        if (typeof weight !== 'number' || !Number.isFinite(weight) || weight <= 0)
          addIssue(issues, `${path}.weight`, 'INVALID_WEIGHT', 'action weight must be positive');
        validateNamedExecutable(action, path, issues, { triggerPolicy: 'forbid', modifierPolicy: 'forbid', knownStatusIds: statusIds }, required);
      });
    }
    const enemyAbilities = validateIdList(enemy.abilities ?? [], 'enemy.abilities', issues, { requireId: true });
    enemyAbilities.forEach((ability, index) =>
      validateNamedExecutable(
        ability,
        `enemy.abilities[${index}]`,
        issues,
        {
          triggerPolicy: 'allow',
          modifierPolicy: ability.trigger === 'passive' ? 'only' : 'forbid',
          knownStatusIds: statusIds,
        },
        required,
        { requireModernTrigger: true },
      ),
    );
    const enemyDesire = enemy.lust_effect;
    if (enemyDesire !== undefined) {
      if (!isRecord(enemyDesire)) addIssue(issues, 'enemy.lust_effect', 'INVALID_ENTRY', 'desire effect must be an object');
      else
        validateNamedExecutable(
          enemyDesire,
          'enemy.lust_effect',
          issues,
          { triggerPolicy: 'forbid', modifierPolicy: 'forbid', knownStatusIds: statusIds },
          required,
          { requireName: true },
        );
    }
  }

  if (pack.desireEffects.player !== null)
    validateNamedExecutable(
      pack.desireEffects.player,
      'desireEffects.player',
      issues,
      { triggerPolicy: 'forbid', modifierPolicy: 'forbid', knownStatusIds: statusIds },
      required,
      { requireName: true },
    );
  if (pack.desireEffects.enemy !== null)
    validateNamedExecutable(
      pack.desireEffects.enemy,
      'desireEffects.enemy',
      issues,
      { triggerPolicy: 'forbid', modifierPolicy: 'forbid', knownStatusIds: statusIds },
      required,
      { requireName: true },
    );

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

  return issues.length > 0 ? { ok: false, issues } : { ok: true, value: pack };
}

export function formatContentContractIssues(issues: readonly ContentContractIssue[], limit = 4): string {
  const shown = issues.slice(0, limit).map(issue => `${issue.path}: ${issue.message}`);
  if (issues.length > limit) shown.push(`${issues.length - limit} more issue(s)`);
  return shown.join('; ');
}

/** Project a portable content path onto the canonical MUV battle root. */
export function contentPathToBattlePath(path: string): string {
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
