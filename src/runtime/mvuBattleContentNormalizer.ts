import { expandBuiltinStatusDefinitions } from '../game-core/builtinStatusCatalog';
import { normalizeMvuStatusDefinitions } from './mvuArrays';
import { compileCompactEffectList } from '../game-core/compactEffectDsl';
import { validateEffectProgramPolicy } from '../game-core/effectProgramPolicy';
import { STATUS_TRIGGER_SET } from '../game-core/battleTriggers';
import { canonicalizePlayerPileSelfTargets } from './playerPileTargetNormalizer';

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cloneJson<T>(value: T): T {
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

function stableHash32(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function validContentId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
}

function canonicalStatusId(seed: string, used: Set<string>): string {
  const base = `status_${stableHash32(seed).toString(36)}`;
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) candidate = `${base}_${suffix++}`;
  used.add(candidate);
  return candidate;
}

const FORMULA_VALUE_KEYS = new Set([
  'damage', 'heal', 'block', 'energy', 'lust', 'stacks', 'draw', 'scry', 'seek',
  'set_hp', 'set_lust', 'set_energy', 'set_block', 'count', 'limit', 'extra',
  'add', 'subtract', 'multiply', 'divide', 'minimum', 'maximum',
]);

type FormulaActor = 'self' | 'opponent';

const CONTENT_RARITY_ALIASES: Readonly<Record<string, string>> = {
  common: 'Common', basic: 'Common', normal: 'Common', '普通': 'Common', '基础': 'Common',
  uncommon: 'Uncommon', '罕见': 'Uncommon', '少见': 'Uncommon',
  rare: 'Rare', '稀有': 'Rare', epic: 'Epic', '史诗': 'Epic',
  legendary: 'Legendary', '传说': 'Legendary', corrupt: 'Corrupt', curse: 'Corrupt',
  '腐化': 'Corrupt', '诅咒': 'Corrupt', boss: 'Boss', '首领': 'Boss', ens: 'ENS',
};

const CARD_TYPE_ALIASES: Readonly<Record<string, string>> = {
  attack: 'Attack', '攻击': 'Attack', skill: 'Skill', '技能': 'Skill',
  power: 'Power', ability: 'Power', '能力': 'Power', event: 'Event', '事件': 'Event',
  curse: 'Curse', '诅咒': 'Curse',
};

const RULE_OPERATION_ALIASES: Readonly<Record<string, string>> = {
  damage: 'damage', deal_damage: 'damage', attack: 'damage', '伤害': 'damage',
  heal: 'heal', healing: 'heal', recover_hp: 'heal', '治疗': 'heal',
  block: 'block', gain_block: 'block', defense: 'block', defence: 'block', '格挡': 'block', '防御': 'block',
  energy: 'energy', gain_energy: 'energy', '能量': 'energy',
  lust: 'lust', gain_lust: 'lust', '欲望': 'lust',
  draw: 'draw', draw_card: 'draw', draw_cards: 'draw', '抽牌': 'draw',
  apply_status: 'apply_status', add_status: 'apply_status', '施加状态': 'apply_status',
  remove_status: 'remove_status', '移除状态': 'remove_status',
  discard: 'discard', '弃牌': 'discard', exhaust: 'exhaust', '消耗': 'exhaust',
  scry: 'scry', seek: 'seek',
};

const CARD_PLAY_RULE_NAMES = new Set([
  'replay',
  'free',
  'retain_hand',
  'retain_block',
  'limit_draw',
  'limit_block_gain',
  'limit_energy_gain',
  'deny_card_play',
  'allow_card_play',
  'limit_card_play',
  'card_destination',
]);

const CARD_PLAY_RULE_FIELDS = new Set([
  'rule', 'type', 'card_rule',
  ...CARD_PLAY_RULE_NAMES,
  'limit', 'extra', 'to', 'destination', 'priority', 'resources',
  'name', 'card_type', 'rarity', 'cost', 'min_cost', 'max_cost', 'tag',
  'template_id', 'run_instance_id', 'combat_instance_id', 'origin',
  'upgraded', 'root_only',
]);

const NESTED_SCALAR_EFFECT_FIELDS = new Set([
  'value', 'amount',
  'to', 'targets', 'hits', 'when', 'on',
  'from', 'pick', 'count',
  'name', 'card_type', 'rarity', 'cost', 'min_cost', 'max_cost', 'tag',
  'template_id', 'run_instance_id', 'combat_instance_id', 'origin',
  'upgraded', 'keyword', 'exclude_keyword', 'root_only',
  'add', 'subtract', 'multiply', 'divide', 'set', 'scope',
]);

const NESTED_SCALAR_EFFECT_OPERATIONS = new Set([
  'damage', 'heal', 'block', 'energy', 'lust',
  'set_hp', 'set_lust', 'set_energy', 'set_block',
  'draw', 'scry', 'seek', 'discard', 'exhaust', 'recover',
  'reduce_cost', 'copy', 'double', 'auto_play', 'remove_card',
  'evoke_orb', 'orb_slots',
]);

/**
 * Flatten the common `{recover:{value:1,from:"discard"}}` family into the
 * public shallow DSL. The operation name, amount and every selector already
 * identify one exact meaning; unknown fields and outer/inner conflicts remain
 * untouched so the real validator can reject ambiguity instead of guessing.
 */
function normalizeNestedScalarEffect(result: Record<string, any>): void {
  for (const operation of NESTED_SCALAR_EFFECT_OPERATIONS) {
    const nested = result[operation];
    if (!isRecord(nested)) continue;
    const payloadKeys = ['value', 'amount'].filter(key => nested[key] !== undefined);
    if (payloadKeys.length !== 1 || Object.keys(nested).some(key => !NESTED_SCALAR_EFFECT_FIELDS.has(key))) continue;
    const payloadKey = payloadKeys[0];
    const transferable = Object.keys(nested).filter(key => key !== payloadKey);
    if (transferable.some(key => result[key] !== undefined && result[key] !== nested[key])) continue;
    result[operation] = nested[payloadKey];
    transferable.forEach(key => {
      if (result[key] === undefined) result[key] = nested[key];
    });
  }
}

/** Numeric percentage suffixes on a closed modifier have one exact multiplier. */
function normalizeNumericPercentModifier(result: Record<string, any>): void {
  if (typeof result.modify !== 'string') return;
  const operators = ['add', 'subtract', 'multiply', 'divide', 'set'].filter(
    operator => result[operator] !== undefined,
  );
  if (operators.length !== 1 || !['add', 'subtract'].includes(operators[0])) return;
  if (Object.keys(result).some(key => !['modify', operators[0]].includes(key))) return;
  const authored = result[operators[0]];
  if (typeof authored !== 'string') return;
  const match = authored.trim().match(/^([0-9]+(?:\.[0-9]+)?)%$/);
  if (!match) return;
  const ratio = Number(match[1]) / 100;
  const multiplier = operators[0] === 'add' ? 1 + ratio : 1 - ratio;
  if (!Number.isFinite(multiplier) || multiplier < 0) return;
  delete result[operators[0]];
  result.multiply = multiplier;
}

/** Damage/lust/stacks are summon action outputs, not summon body stats. */
function normalizeSummonOutputModifier(result: Record<string, any>): void {
  if (!isRecord(result.modify_summon) || result.modify_summon_effect !== undefined) return;
  const nested = result.modify_summon;
  if (!['damage', 'lust', 'stacks'].includes(String(nested.stat || ''))) return;
  if (nested.set !== undefined) return;
  const allowed = new Set(['selector', 'stat', 'add', 'subtract', 'multiply', 'divide']);
  if (Object.keys(nested).some(key => !allowed.has(key)) || !isRecord(nested.selector)) return;
  result.modify_summon_effect = nested;
  delete result.modify_summon;
}

function mergeAuthoredWhen(inner: unknown, outerWhen: unknown): unknown {
  if (!isRecord(inner)) return inner;
  if (outerWhen === undefined) return inner;
  if (typeof outerWhen !== 'string' || !outerWhen.trim()) return inner;
  if (inner.when === undefined) return { ...inner, when: outerWhen };
  if (typeof inner.when !== 'string' || !inner.when.trim()) return inner;
  return { ...inner, when: `(${outerWhen}) && (${inner.when})` };
}

/**
 * Some schema-guided models wrap one status/trigger effect list as
 * `{when,effects}`. No valid shallow effect has `effects` as its operation, so
 * this shape has exactly one meaning and can be flattened without inventing
 * gameplay.
 */
function unwrapAuthoredEffectEnvelope(value: Record<string, any>): unknown {
  const keys = Object.keys(value);
  if (!keys.includes('effects') || keys.some(key => key !== 'effects' && key !== 'when')) return value;
  const effects = value.effects;
  if (Array.isArray(effects)) {
    if (effects.length === 0 || effects.some(entry => !isRecord(entry))) return value;
    return effects.map(entry => mergeAuthoredWhen(entry, value.when));
  }
  if (!isRecord(effects)) return value;
  return mergeAuthoredWhen(effects, value.when);
}

function cardPlayRuleFromEnvelope(value: Record<string, any>): string | null {
  for (const field of ['rule', 'type', 'card_rule']) {
    if (typeof value[field] === 'string' && CARD_PLAY_RULE_NAMES.has(value[field])) return value[field];
  }
  const keyedRules = [...CARD_PLAY_RULE_NAMES].filter(rule => value[rule] === true || value[rule] === rule);
  return keyedRules.length === 1 ? keyedRules[0] : null;
}

function normalizeEnumAlias(value: unknown, aliases: Readonly<Record<string, string>>): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return aliases[trimmed] || aliases[trimmed.toLowerCase()] || value;
}

function normalizeRuleTarget(value: unknown): 'self' | 'opponent' | undefined {
  if (typeof value !== 'string') return undefined;
  const target = value.trim().toLowerCase();
  if (['self', 'player', 'owner', 'caster', 'user', '己方', '自身', '玩家'].includes(target)) return 'self';
  if (['opponent', 'enemy', 'target', 'foe', '敌方', '敌人', '对手'].includes(target)) return 'opponent';
  return undefined;
}

/** Canonicalize the generic rule envelope emitted by some schema models. */
function normalizeRuleEffectEnvelope(value: unknown): unknown {
  if (!isRecord(value) || typeof value.operation !== 'string') return value;
  const operation = RULE_OPERATION_ALIASES[value.operation.trim()]
    || RULE_OPERATION_ALIASES[value.operation.trim().toLowerCase()];
  if (!operation) return value;
  const allowed = new Set([
    'source', 'operation', 'target', 'value', 'amount', 'trigger',
    'status', 'status_id', 'stacks', 'hits', 'from', 'pick', 'count',
  ]);
  if (Object.keys(value).some(key => !allowed.has(key))) return value;

  const payload = value.value ?? value.amount;
  const result: Record<string, unknown> = {};
  if (operation === 'apply_status' || operation === 'remove_status') {
    const status = typeof value.status_id === 'string'
      ? value.status_id
      : typeof value.status === 'string'
        ? value.status
        : typeof payload === 'string'
          ? payload
          : isRecord(payload) && typeof payload.id === 'string'
            ? payload.id
            : '';
    if (!status) return value;
    result[operation] = status;
    const stacks = value.stacks ?? (isRecord(payload) ? payload.stacks : undefined);
    if (operation === 'apply_status' && stacks !== undefined) result.stacks = stacks;
  } else {
    if (payload === undefined) return value;
    result[operation] = payload;
  }

  const target = normalizeRuleTarget(value.target);
  if (value.target !== undefined && !target) return value;
  if (target) result.to = target;
  if (value.hits !== undefined) result.hits = value.hits;
  if (value.from !== undefined) result.from = value.from;
  if (value.pick !== undefined) result.pick = value.pick;
  if (value.count !== undefined) result.count = value.count;
  const trigger = typeof value.trigger === 'string' ? value.trigger.trim().toLowerCase() : '';
  if (trigger && !['play', 'on_play', 'immediate', 'card_played', '打出时', '立即'].includes(trigger)) {
    result.on = value.trigger;
  }
  return result;
}

const SUMMON_ACTION_ENVELOPE_FIELDS: Readonly<Record<string, ReadonlySet<string>>> = {
  modify_summon: new Set(['selector', 'stat', 'add', 'subtract', 'multiply', 'divide', 'set']),
  modify_summon_effect: new Set(['selector', 'stat', 'add', 'subtract', 'multiply', 'divide']),
  activate_summon: new Set(['selector']),
  dismiss_summon: new Set(['selector', 'retain_corpse']),
  copy_summon: new Set(['selector', 'to', 'capacity', 'overflow']),
  damage_summon: new Set(['selector', 'amount']),
  heal_summon: new Set(['selector', 'amount']),
  apply_summon_status: new Set(['selector', 'id', 'stacks']),
  remove_summon_status: new Set(['selector', 'id']),
  summon_resource: new Set(['selector', 'id', 'amount']),
  set_summon_resource: new Set(['selector', 'id', 'value']),
};

/**
 * Canonicalize the provider-style `{action:"modify_summon",selector,...}`
 * envelope. Every supported action below has a closed payload vocabulary, so
 * moving those fields under the operation key preserves the exact authored
 * summon command. Unknown actions/fields remain visible to validation.
 */
function normalizeSummonActionEnvelope(value: unknown): unknown {
  if (!isRecord(value) || typeof value.action !== 'string') return value;
  const action = value.action.trim();
  const payloadFields = SUMMON_ACTION_ENVELOPE_FIELDS[action];
  if (!payloadFields) return value;
  const allowed = new Set(['action', 'when', ...payloadFields]);
  if (Object.keys(value).some(key => !allowed.has(key))) return value;
  const payload = Object.fromEntries(
    Object.entries(value).filter(([key]) => payloadFields.has(key)),
  );
  if (!isRecord(payload.selector)) return value;
  return {
    [action]: payload,
    ...(value.when !== undefined ? { when: value.when } : {}),
  };
}

const OPPONENT_DEFAULT_OPERATIONS = new Set([
  'damage', 'lust', 'execute', 'kill', 'apply_status', 'remove_status',
]);
const SELF_DEFAULT_OPERATIONS = new Set([
  'heal', 'block', 'energy', 'draw', 'scry', 'seek',
]);

function inferFormulaActor(value: Readonly<Record<string, unknown>>, inherited?: FormulaActor): FormulaActor | undefined {
  if (value.to === 'self' || value.to === 'opponent') return value.to;
  const keys = Object.keys(value);
  const opponent = keys.some(key => OPPONENT_DEFAULT_OPERATIONS.has(key));
  const self = keys.some(key => SELF_DEFAULT_OPERATIONS.has(key));
  if (opponent !== self) return opponent ? 'opponent' : 'self';
  return inherited;
}

function rewriteFormula(
  value: string,
  aliases: ReadonlyMap<string, string>,
  actor?: FormulaActor,
  parentKey = '',
): string {
  let result = value.replace(/\bself\.opponent\./g, 'opponent.');
  // A boolean condition encoded as `condition ? 1 : 0` (or true/false) has
  // exactly the same truth table as `condition`.  Providers frequently copy
  // the numeric ternary grammar into `when`; collapse only this outer wrapper
  // and leave the condition itself visible to the normal validator.
  if (parentKey === 'when') {
    const ternary = result.match(/^\s*(.+?)\s*\?\s*(1|0|true|false)\s*:\s*(1|0|true|false)\s*$/is);
    if (ternary && !/[?:]/.test(ternary[1])) {
      const truthy = ternary[2].toLowerCase() === 'true' || ternary[2] === '1';
      const falsy = ternary[3].toLowerCase() === 'true' || ternary[3] === '1';
      if (truthy !== falsy) result = truthy ? ternary[1].trim() : `!(${ternary[1].trim()})`;
    }
  }
  if (actor) result = result.replace(/\b(?:self\|opponent|opponent\|self)\./g, `${actor}.`);
  // Boolean fields are already complete conditions. Equality against a
  // literal boolean is only a verbose spelling of the same predicate and
  // otherwise falls into the numeric-expression compiler. Canonicalize both
  // operand orders without changing the condition's truth table.
  const booleanField = '(?:self|opponent)\\.(?:has_buff|has_debuff|has_neutral|has_status|has_summon|has_ally|alive)';
  result = result.replace(
    new RegExp(`\\b(${booleanField})\\s*(==|!=)\\s*(true|false)\\b`, 'g'),
    (_match, field: string, operator: string, literal: string) => {
      const positive = (operator === '==') === (literal === 'true');
      return positive ? field : `!${field}`;
    },
  );
  result = result.replace(
    new RegExp(`\\b(true|false)\\s*(==|!=)\\s*(${booleanField})\\b`, 'g'),
    (_match, literal: string, operator: string, field: string) => {
      const positive = (operator === '==') === (literal === 'true');
      return positive ? field : `!${field}`;
    },
  );
  aliases.forEach((replacement, alias) => {
    if (!alias || alias === replacement) return;
    for (const actor of ['self', 'opponent']) {
      result = result.split(`${actor}.status.${alias}.stacks`).join(`${actor}.status.${replacement}.stacks`);
    }
  });
  return result;
}

/**
 * A Power's trigger belongs at the card root. Some schema-guided providers
 * duplicate that exact object under legacy `effect` and an `effects` wrapper.
 * Promote only the one unambiguous `{trigger:{...}}` shape; mixed wrappers
 * remain untouched so validation can report them instead of guessing.
 */
function normalizePowerRootTriggerWrapper(result: Record<string, any>): void {
  if (result.type !== 'Power' || result.trigger !== undefined) return;
  const wrappedTrigger = (value: unknown): Record<string, any> | null => (
    isRecord(value)
    && Object.keys(value).length === 1
    && isRecord(value.trigger)
      ? value.trigger
      : null
  );
  const singular = wrappedTrigger(result.effect);
  const effectList = Array.isArray(result.effects) ? result.effects : [result.effects];
  const plural = effectList.length === 1 ? wrappedTrigger(effectList[0]) : null;
  if (!singular && !plural) return;
  if (singular && plural && JSON.stringify(singular) !== JSON.stringify(plural)) return;
  if (result.effect !== undefined && !singular) return;
  if (result.effects !== undefined && !plural) return;
  result.trigger = cloneJson(singular || plural!);
  delete result.effect;
  delete result.effects;
}

/** Move a template library accidentally nested beside trigger.on/effects back
 * to the owning content object. The owner and trigger are already explicit, so
 * this changes only field placement. */
function normalizeTriggerCreatesPlacement(result: Record<string, any>): void {
  if (
    !isRecord(result.trigger)
    || !Array.isArray(result.trigger.creates)
    || result.creates !== undefined
    || typeof result.id !== 'string'
    || typeof result.name !== 'string'
  ) return;
  result.creates = result.trigger.creates;
  delete result.trigger.creates;
}

/**
 * Convert the common self-targeting effect spelling of a card's own Exhaust
 * keyword. The exact card name plus `exhaust:1/from:hand/pick:all` cannot be a
 * valid multi-card selection and has one executable meaning after this card is
 * played: move the resolving card to Exhaust instead of Discard.
 */
function normalizeCurrentCardExhaustKeyword(result: Record<string, any>): void {
  if (
    result.exhaust !== undefined
    || typeof result.name !== 'string'
    || !['Attack', 'Skill', 'Event'].includes(String(result.type || ''))
    || result.effects === undefined
  ) return;
  const effects = Array.isArray(result.effects) ? result.effects : [result.effects];
  const index = effects.findIndex(effect => (
    isRecord(effect)
    && effect.exhaust === 1
    && effect.from === 'hand'
    && effect.pick === 'all'
    && effect.name === result.name
    && Object.keys(effect).every(key => ['exhaust', 'from', 'pick', 'name'].includes(key))
  ));
  if (index < 0) return;
  result.exhaust = true;
  effects.splice(index, 1);
  if (effects.length === 0) delete result.effects;
  else result.effects = effects.length === 1 ? effects[0] : effects;
}

/** Remove redundant transport metadata from a summon-effect modifier. */
function stripRedundantSummonEffectScope(
  result: Record<string, any>,
  parentKey: string,
): void {
  if (parentKey !== 'effects') return;
  if (isRecord(result.modify_summon_effect)) delete result.modify_summon_effect.scope;
}

function collectStatusReferences(value: unknown, references: Set<string>): void {
  if (typeof value === 'string') {
    for (const match of value.matchAll(/(?:self|opponent)\.status\.([A-Za-z_][A-Za-z0-9_]*)\.stacks/g)) {
      references.add(match[1]);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach(entry => collectStatusReferences(entry, references));
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, entry] of Object.entries(value)) {
    if (['id', 'name', 'emoji', 'description', 'dialogue', 'source', 'narrate', '$meta'].includes(key)) continue;
    if ((key === 'apply_status' || key === 'remove_status') && typeof entry === 'string') {
      if (!['all', 'buffs', 'debuffs'].includes(entry)) references.add(entry);
      continue;
    }
    if (
      (key === 'apply_summon_status' || key === 'remove_summon_status')
      && isRecord(entry)
      && typeof entry.id === 'string'
    ) references.add(entry.id);
    collectStatusReferences(entry, references);
  }
}

/** Remove reward support definitions which no executable rule can reach. */
function pruneUnreachableCandidateStatuses(result: Record<string, any>): void {
  if (
    !Array.isArray(result.statuses)
    || typeof result.id !== 'string'
    || typeof result.name !== 'string'
    || !['effects', 'trigger', 'discard_effects'].some(key => result[key] !== undefined)
  ) return;
  const definitions = new Map<string, Record<string, any>>();
  for (const entry of result.statuses) {
    if (isRecord(entry) && validContentId(entry.id) && !definitions.has(entry.id)) definitions.set(entry.id, entry);
  }
  const reachable = new Set<string>();
  collectStatusReferences(Object.fromEntries(
    Object.entries(result).filter(([key]) => key !== 'status' && key !== 'statuses'),
  ), reachable);
  const pending = [...reachable];
  while (pending.length) {
    const definition = definitions.get(pending.pop()!);
    if (!definition) continue;
    const nested = new Set<string>();
    collectStatusReferences(definition, nested);
    for (const dependency of nested) {
      if (reachable.has(dependency)) continue;
      reachable.add(dependency);
      pending.push(dependency);
    }
  }
  const retained = result.statuses.filter((entry: unknown) => (
    !isRecord(entry) || !validContentId(entry.id) || reachable.has(entry.id)
  ));
  if (retained.length) result.statuses = retained;
  else delete result.statuses;
}

/**
 * Reward-level status definitions cannot be settled because opening choices
 * are mutually exclusive. If every definition is validly identified and is
 * reachable from one or more concrete candidates, duplicate the exact closed
 * dependency set onto those candidates and remove the misplaced container.
 * Ambiguous/unreferenced/conflicting libraries stay untouched for validation.
 */
function rehomeRewardContainerStatuses(result: Record<string, any>, parentKey: string): void {
  if (parentKey !== 'reward' || !Array.isArray(result.statuses)) return;
  if (result.statuses.length === 0) {
    delete result.statuses;
    return;
  }
  const definitions = result.statuses;
  if (definitions.some(entry => !isRecord(entry) || !validContentId(entry.id))) return;
  const byId = new Map<string, Record<string, any>>();
  for (const definition of definitions as Record<string, any>[]) {
    const existing = byId.get(definition.id);
    if (existing && stableComparableJson(existing) !== stableComparableJson(definition)) return;
    if (!existing) byId.set(definition.id, definition);
  }
  const candidates = ['cards', 'artifacts', 'items']
    .flatMap(category => Array.isArray(result[category]) ? result[category] : [])
    .filter(isRecord);
  if (candidates.length === 0 || candidates.some(candidate => candidate.status !== undefined || candidate.statuses !== undefined)) {
    return;
  }
  const assignments = new Map<Record<string, any>, Set<string>>();
  const assigned = new Set<string>();
  for (const candidate of candidates) {
    const reachable = new Set<string>();
    const visited = new Set<string>();
    collectStatusReferences(candidate, reachable);
    const pending = [...reachable];
    while (pending.length > 0) {
      const id = pending.pop()!;
      const definition = byId.get(id);
      if (!definition || visited.has(id)) continue;
      visited.add(id);
      const dependencies = new Set<string>();
      collectStatusReferences(definition, dependencies);
      dependencies.forEach(dependency => {
        if (!reachable.has(dependency)) {
          reachable.add(dependency);
          pending.push(dependency);
        }
      });
    }
    const local = new Set([...reachable].filter(id => byId.has(id)));
    if (local.size === 0) continue;
    assignments.set(candidate, local);
    local.forEach(id => assigned.add(id));
  }
  if (assigned.size !== byId.size) return;
  assignments.forEach((ids, candidate) => {
    candidate.statuses = definitions
      .filter((definition: Record<string, any>) => ids.has(definition.id))
      .map((definition: Record<string, any>) => cloneJson(definition));
  });
  delete result.statuses;
}

function stableComparableJson(value: unknown): string {
  const normalize = (entry: unknown): unknown => {
    if (Array.isArray(entry)) return entry.map(normalize);
    if (!isRecord(entry)) return entry;
    return Object.fromEntries(Object.keys(entry).sort().map(key => [key, normalize(entry[key])]));
  };
  return JSON.stringify(normalize(value));
}

/**
 * Owned-card arrays define each card type once and express physical copies via
 * `quantity`. If a provider repeats the same definition byte-for-byte apart
 * from quantity, folding those entries and summing quantity preserves the
 * exact deck multiset without asking a model to re-author any gameplay field.
 * Conflicting definitions that merely reuse an id remain untouched so strict
 * validation can reject the ambiguity.
 */
function collapseEquivalentOwnedCardDefinitions(battle: Record<string, any>): void {
  if (!Array.isArray(battle.cards) || battle.cards.length < 2) return;
  const groups = new Map<string, Array<{ card: Record<string, any>; index: number; signature: string }>>();
  battle.cards.forEach((entry: unknown, index: number) => {
    if (
      !isRecord(entry)
      || !validContentId(entry.id)
      || !Number.isInteger(entry.quantity)
      || Number(entry.quantity) < 1
      || Number(entry.quantity) > 100
    ) return;
    const comparable = { ...entry };
    delete comparable.quantity;
    const group = groups.get(entry.id) || [];
    group.push({ card: entry, index, signature: stableComparableJson(comparable) });
    groups.set(entry.id, group);
  });
  const remove = new Set<number>();
  groups.forEach(group => {
    if (group.length < 2 || new Set(group.map(entry => entry.signature)).size !== 1) return;
    const total = group.reduce((sum, entry) => sum + Number(entry.card.quantity), 0);
    if (!Number.isInteger(total) || total < 1 || total > 100) return;
    group[0].card.quantity = total;
    group.slice(1).forEach(entry => remove.add(entry.index));
  });
  if (remove.size > 0) battle.cards = battle.cards.filter((_entry: unknown, index: number) => !remove.has(index));
}

/**
 * Initial owned cards/relics/items use the battle-global status registry.
 * Models also know the reward-candidate shape and may attach the complete,
 * referenced status closure to an already-owned content root. Its only valid
 * placement is global, so move that exact authored definition graph without
 * changing any rule. Malformed, unreachable or conflicting wrappers remain
 * visible to authoritative validation.
 */
function rehomeOwnedContentStatusWrappers(battle: Record<string, any>): void {
  const library = Array.isArray(battle.statuses) ? battle.statuses : [];
  const global = new Map<string, Record<string, any>>();
  for (const definition of library) {
    if (isRecord(definition) && validContentId(definition.id) && !global.has(definition.id)) {
      global.set(definition.id, definition);
    }
  }
  let changed = false;
  for (const field of ['cards', 'artifacts', 'items'] as const) {
    if (!Array.isArray(battle[field])) continue;
    for (const content of battle[field]) {
      if (!isRecord(content)) continue;
      const support = [
        ...(Array.isArray(content.statuses) ? content.statuses : []),
        ...(isRecord(content.status) ? [content.status] : []),
      ];
      if (!support.length || support.some(entry => (
        !isRecord(entry)
        || !validContentId(entry.id)
        || typeof entry.name !== 'string'
        || !entry.name.trim()
        || typeof entry.type !== 'string'
        || !isRecord(entry.triggers)
      ))) continue;
      const definitions = new Map<string, Record<string, any>>();
      let duplicateConflict = false;
      for (const entry of support as Record<string, any>[]) {
        const existing = definitions.get(entry.id);
        if (existing && stableComparableJson(existing) !== stableComparableJson(entry)) {
          duplicateConflict = true;
          break;
        }
        definitions.set(entry.id, entry);
      }
      if (duplicateConflict) continue;
      const references = new Set<string>();
      collectStatusReferences(Object.fromEntries(
        Object.entries(content).filter(([key]) => key !== 'status' && key !== 'statuses'),
      ), references);
      const reachable = new Set<string>();
      const pending = [...references];
      while (pending.length) {
        const id = pending.pop()!;
        if (reachable.has(id)) continue;
        reachable.add(id);
        const definition = definitions.get(id);
        if (!definition) continue;
        const nested = new Set<string>();
        collectStatusReferences(definition, nested);
        nested.forEach(dependency => pending.push(dependency));
      }
      if ([...definitions.keys()].some(id => !reachable.has(id))) continue;
      if ([...definitions.values()].some(definition => {
        const existing = global.get(definition.id);
        return existing !== undefined && stableComparableJson(existing) !== stableComparableJson(definition);
      })) continue;
      for (const definition of definitions.values()) {
        if (global.has(definition.id)) continue;
        const cloned = cloneJson(definition);
        library.push(cloned);
        global.set(definition.id, cloned);
      }
      delete content.status;
      delete content.statuses;
      changed = true;
    }
  }
  if (changed) battle.statuses = library;
}

/**
 * Full status definitions belong to the battle library. Models sometimes put
 * that same `statuses:[{id,name,type,triggers}]` array on one root enemy. Since
 * active statuses use the distinct `status_effects` field, this placement has
 * only one public meaning. Hoist the closed array when every duplicate is
 * identical; conflicting definitions remain untouched for validation.
 */
function hoistRootEnemyStatusDefinitions(battle: Record<string, any>): void {
  const roster = [
    ...(Array.isArray(battle.enemies) ? battle.enemies : []),
    ...(isRecord(battle.enemy) ? [battle.enemy] : []),
  ].filter(isRecord);
  const library = Array.isArray(battle.statuses) ? cloneJson(battle.statuses) : [];
  const byId = new Map<string, Record<string, any>>();
  library.forEach(entry => {
    if (isRecord(entry) && validContentId(entry.id) && !byId.has(entry.id)) byId.set(entry.id, entry);
  });
  let changed = false;
  for (const enemy of roster) {
    if (!Array.isArray(enemy.statuses) || enemy.statuses.length === 0 || enemy.statuses.some(entry => !isRecord(entry))) {
      continue;
    }
    const nested = enemy.statuses as Record<string, any>[];
    if (nested.some(entry => !validContentId(entry.id) || !entry.name || !entry.type || !isRecord(entry.triggers))) {
      continue;
    }
    const conflict = nested.some(entry => {
      const existing = byId.get(entry.id);
      return existing !== undefined && JSON.stringify(existing) !== JSON.stringify(entry);
    });
    if (conflict) continue;
    nested.forEach(entry => {
      if (byId.has(entry.id)) return;
      const cloned = cloneJson(entry);
      library.push(cloned);
      byId.set(entry.id, cloned);
    });
    delete enemy.statuses;
    changed = true;
  }
  if (changed) battle.statuses = library;
}

function rewriteNode(
  value: unknown,
  aliases: ReadonlyMap<string, string>,
  parentKey = '',
  inheritedActor?: FormulaActor,
): unknown {
  if (typeof value === 'string') return rewriteFormula(value, aliases, inheritedActor, parentKey);
  if (Array.isArray(value)) {
    const normalized = value
      .map(entry => rewriteNode(entry, aliases, parentKey, inheritedActor))
      .filter(entry => entry !== undefined);
    // A closed multi-operation effect object can normalize into its ordered
    // public effect entries. Flatten only actual effect lists; arrays used by
    // choices, cards, actions and definitions keep their original nesting.
    return parentKey === 'effects'
      ? normalized.flatMap(entry => Array.isArray(entry) ? entry : [entry])
      : normalized;
  }
  if (!isRecord(value)) return value;

  const normalizedEnvelope = normalizeRuleEffectEnvelope(value);
  if (normalizedEnvelope !== value) return rewriteNode(normalizedEnvelope, aliases, parentKey, inheritedActor);
  const normalizedSummonAction = normalizeSummonActionEnvelope(value);
  if (normalizedSummonAction !== value) {
    return rewriteNode(normalizedSummonAction, aliases, parentKey, inheritedActor);
  }

  const actor = inferFormulaActor(value, inheritedActor);

  if (
    FORMULA_VALUE_KEYS.has(parentKey) &&
    Object.keys(value).length === 1 &&
    (Object.prototype.hasOwnProperty.call(value, 'formula') || Object.prototype.hasOwnProperty.call(value, 'value'))
  ) {
    const scalar = Object.prototype.hasOwnProperty.call(value, 'formula') ? value.formula : value.value;
    if (typeof scalar === 'string') return rewriteFormula(scalar, aliases, actor, parentKey);
    if (typeof scalar === 'number') return scalar;
  }

  const result: Record<string, any> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (
      key === 'desc'
      && value.description === undefined
      && (typeof value.id === 'string' || typeof value.name === 'string')
      && typeof entry === 'string'
    ) {
      result.description = entry;
      continue;
    }
    if (key === 'id' && typeof entry === 'string' && aliases.has(entry)) {
      result[key] = aliases.get(entry);
      continue;
    }
    if ((key === 'apply_status' || key === 'remove_status') && typeof entry === 'string') {
      result[key] = aliases.get(entry) || entry;
      continue;
    }
    if (key === 'rarity') {
      result[key] = normalizeEnumAlias(entry, CONTENT_RARITY_ALIASES);
      continue;
    }
    if (key === 'type') {
      result[key] = normalizeEnumAlias(entry, CARD_TYPE_ALIASES);
      continue;
    }
    result[key] = rewriteNode(entry, aliases, key, actor);
  }

  // Effect envelope normalization can produce a sequence inside an existing
  // status event sequence. Flatten that representation only in known trigger
  // slots, without dropping empty/invalid entries or changing execution order.
  if (parentKey === 'triggers') {
    for (const [key, entries] of Object.entries(result)) {
      if (!STATUS_TRIGGER_SET.has(key) || !Array.isArray(entries)
        || !entries.some(Array.isArray)
        || entries.some(entry => Array.isArray(entry) && entry.length === 0)) continue;
      const flat = entries.flatMap(entry => Array.isArray(entry) ? entry : [entry]);
      if (flat.length > 0 && compileCompactEffectList(flat).ok) result[key] = flat;
    }
  }

  // `creates` contains card templates, never owned-card instances. A provider
  // occasionally copies the owned-card default `quantity: 1` onto a template;
  // one is exactly the template's existing single-definition meaning, so the
  // redundant field can be removed without changing generation count. Any
  // other quantity remains visible for strict validation.
  if (parentKey === 'creates' && result.quantity === 1) delete result.quantity;

  // A current story-generation response emitted both canonical `effects` and
  // the inert typo `eff果s:null`. The null field carries no rule and its
  // canonical sibling is already present, so removing only this exact shape
  // is lossless. Non-null typo fields remain visible to strict validation.
  if (result.effects !== undefined && result['eff果s'] === null) delete result['eff果s'];

  // A status hold modifier's stack variable is the current status' bare
  // `stacks`. `self.stacks` is a common provider spelling of the same local
  // value, but it is not a public formula path. Restrict this alias to hold
  // modifiers so player/enemy formulas with an unknown property remain errors.
  if (parentKey === 'hold' && typeof result.modify === 'string') {
    for (const operation of ['add', 'subtract', 'multiply', 'divide', 'set']) {
      if (typeof result[operation] === 'string') {
        result[operation] = result[operation].replace(/(?<![A-Za-z0-9_.])self\.stacks\b/g, 'stacks');
      }
    }
  }
  // These trigger names already guarantee that the event source is a card.
  // A generated `event.source_kind == 'card'` guard is therefore redundant,
  // and the public formula surface intentionally does not expose that event
  // metadata field. Remove only the exact tautology; every other event
  // condition remains authored and must pass validation.
  if (
    ['card_played', 'attack_played', 'skill_played', 'power_played'].includes(parentKey)
    && typeof result.when === 'string'
    && /^event\.source_kind\s*==\s*(['"])card\1$/.test(result.when.trim())
  ) delete result.when;
  // `discard_effects` is optional. A provider-produced null/empty container
  // has exactly the same authored meaning as omission and cannot be executed
  // as an effect list, so remove only this empty optional shell. Required
  // `effects` remain untouched and continue to fail validation when empty.
  if (
    result.discard_effects === null
    || (Array.isArray(result.discard_effects) && result.discard_effects.length === 0)
    || (isRecord(result.discard_effects) && Object.keys(result.discard_effects).length === 0)
  ) delete result.discard_effects;

  // Optional selectors containing an empty string have exactly the same
  // meaning as no selector. `Card`/`Any`/`All` are frequent schema-language
  // spellings for “all card types”; the public DSL expresses that by omitting
  // card_type. Real unknown non-empty fields remain untouched for validation.
  for (const field of [
    'name', 'card_type', 'rarity', 'tag', 'template_id', 'run_instance_id',
    'combat_instance_id', 'origin', 'keyword', 'exclude_keyword', 'racial',
  ]) {
    if (typeof result[field] === 'string' && !result[field].trim()) delete result[field];
  }
  if (
    typeof result.card_type === 'string'
    && ['card', 'cards', 'any', 'all', '任意', '所有'].includes(result.card_type.trim().toLowerCase())
  ) delete result.card_type;
  if (Array.isArray(result.card_type)) {
    const cardTypes = result.card_type.filter((entry: unknown) => !(
      typeof entry === 'string'
      && ['card', 'cards', 'any', 'all', '任意', '所有'].includes(entry.trim().toLowerCase())
    ));
    if (cardTypes.length === 0) delete result.card_type;
    else result.card_type = cardTypes;
  }
  // A singleton template selector identifies precisely the same template.
  // Accept it only on an otherwise valid effect; never collapse multiple IDs
  // or change array-valued selectors elsewhere (summons, definitions, etc.).
  if (Array.isArray(result.template_id) && result.template_id.length === 1
    && typeof result.template_id[0] === 'string' && result.template_id[0].trim()) {
    const candidate = { ...result, template_id: result.template_id[0] };
    if (compileCompactEffectList(candidate).ok) result.template_id = candidate.template_id;
  }

  // `ordinal:"first"` already has a complete, unambiguous meaning. Some
  // models redundantly emit `n:1`; removing that ignored parameter is a
  // semantics-preserving canonicalization, not a gameplay repair.
  if (result.ordinal === 'first' && result.n !== undefined) delete result.n;
  if (
    parentKey === 'effects'
    && (result.when === false || (typeof result.when === 'string' && result.when.trim().toLowerCase() === 'false'))
  ) {
    return undefined;
  }
  if (result.when === true || (typeof result.when === 'string' && result.when.trim().toLowerCase() === 'true')) {
    delete result.when;
  }
  // `target:"self|opponent"` is a one-to-one legacy spelling of the public
  // effect field `to`. Convert it only inside actual effect containers and
  // only when there is no conflicting `to`; entity ids, `all`, and selector
  // objects remain invalid and visible to validation.
  if (
    (parentKey === 'effects' || parentKey === 'discard_effects')
    && result.to === undefined
    && (result.target === 'self' || result.target === 'opponent')
  ) {
    result.to = result.target;
    delete result.target;
  }
  // A trigger-level condition has one exact public form: copy it onto every
  // concrete effect item while keeping the trigger timing unchanged.
  if (parentKey === 'trigger' && typeof result.when === 'string' && result.when.trim() && result.effects !== undefined) {
    if (Array.isArray(result.effects) && result.effects.length > 0 && result.effects.every(isRecord)) {
      result.effects = result.effects.map((entry: Record<string, any>) => mergeAuthoredWhen(entry, result.when));
      delete result.when;
    } else if (isRecord(result.effects)) {
      result.effects = mergeAuthoredWhen(result.effects, result.when);
      delete result.when;
    }
  }

  // Common singular/verb spellings below have one exact public equivalent.
  // Restrict them to real effect items and leave conflicting values invalid.
  if (
    (parentKey === 'effects' || parentKey === 'discard_effects')
    && result.damage !== undefined
    && result.hits === undefined
    && Number.isInteger(result.hit)
    && Number(result.hit) > 0
  ) {
    result.hits = result.hit;
    delete result.hit;
  }
  if (
    (parentKey === 'effects' || parentKey === 'discard_effects')
    && result.apply_status === undefined
    && (typeof result.add_status === 'string' || isRecord(result.add_status))
  ) {
    const nested = result.add_status;
    if (typeof nested === 'string' && nested.trim()) {
      result.apply_status = nested;
      delete result.add_status;
    } else if (isRecord(nested) && typeof nested.id === 'string' && nested.id.trim()) {
      const transferable = ['stacks', 'to', 'targets'];
      const allowed = new Set(['id', ...transferable]);
      if (
        Object.keys(nested).every(key => allowed.has(key))
        && transferable.every(key => result[key] === undefined || nested[key] === undefined || result[key] === nested[key])
      ) {
        result.apply_status = nested.id;
        transferable.forEach(key => {
          if (result[key] === undefined && nested[key] !== undefined) result[key] = nested[key];
        });
        delete result.add_status;
      }
    }
  }

  for (const operation of ['apply_status', 'remove_status'] as const) {
    const nested = result[operation];
    if (!isRecord(nested)) continue;
    const transferable = operation === 'apply_status' ? ['stacks', 'to', 'targets'] : ['to', 'targets'];
    // Some models use a data-only reference envelope with status_id instead of
    // id. Move only an unambiguous reference and its explicit operands. Do not
    // discard inline mechanics, choose between conflicting IDs, or infer to
    // from status polarity, card type, name or description.
    if (Object.hasOwn(nested, 'status_id')) {
      const referenceFields = new Set(['id', 'status_id', ...transferable]);
      if (typeof nested.status_id !== 'string' || !nested.status_id.trim()
        || (Object.hasOwn(nested, 'id') && nested.id !== nested.status_id)
        || Object.keys(nested).some(key => !referenceFields.has(key))
        || transferable.some(key => result[key] !== undefined && nested[key] !== undefined && result[key] !== nested[key])) continue;
      result[operation] = aliases.get(nested.status_id) || nested.status_id;
      transferable.forEach(key => {
        if (result[key] === undefined && nested[key] !== undefined) result[key] = nested[key];
      });
      continue;
    }
    if (typeof nested.id !== 'string') continue;
    const allowed = new Set([
      'id', 'name', 'emoji', 'description', 'type', 'stacks_change', 'tick_timing', 'maxStacks', 'stun', 'character_emoji', 'triggers', '$meta',
      ...transferable,
    ]);
    if (Object.keys(nested).some(key => !allowed.has(key))) continue;
    if (transferable.some(key => result[key] !== undefined && nested[key] !== undefined && result[key] !== nested[key])) {
      continue;
    }
    result[operation] = aliases.get(nested.id) || nested.id;
    transferable.forEach(key => {
      if (result[key] === undefined && nested[key] !== undefined) result[key] = nested[key];
    });
  }

  normalizeNestedScalarEffect(result);
  // "draw" is the public pile name used by selection/movement; add_card
  // calls that same draw pile "deck". This exact alias changes no destination
  // or authored mechanic. Never infer a pile from prose or a combat target.
  if (typeof result.add_card === 'string' && result.to === 'draw'
    && Object.keys(result).every(key => ['add_card', 'to', 'count', 'when'].includes(key))) {
    result.to = 'deck';
  }
  // The holder-bound event form has an explicit destination now. Only move a
  // sole trigger wrapper; preserve every authored trigger field and condition.
  // Mixed passive/event rules or competing events remain rejected as ambiguous.
  // In a stance's explicitly passive slot, a closed passive envelope adds no
  // timing information. Unwrap only after the shared compiler proves the
  // payload consists exclusively of passive operations. Never drop conditions,
  // unknown fields or reinterpret another event as a continuous modifier.
  if (parentKey === 'stance' && isRecord(result.passive)
    && result.passive.on === 'passive'
    && Object.keys(result.passive).every(key => key === 'on' || key === 'effects')) {
    const payload = result.passive.effects;
    const effects = Array.isArray(payload) ? payload : [payload];
    const compiled = effects.length > 0 ? compileCompactEffectList(effects) : null;
    const policy = compiled?.ok
      ? validateEffectProgramPolicy(compiled.value, {
        triggerPolicy: 'forbid', modifierPolicy: 'only', allowStatusStacks: true,
      })
      : null;
    if (compiled?.ok && policy?.ok) result.passive = payload;
  }
  if (parentKey === 'stance' && result.events === undefined && isRecord(result.passive)
    && Object.keys(result.passive).length === 1 && isRecord(result.passive.trigger)
    && typeof result.passive.trigger.on === 'string' && result.passive.trigger.on !== 'passive') {
    result.events = [result.passive.trigger];
    delete result.passive;
  }
  // A closed gain_<id> envelope with the SAME explicit resource ID and a
  // nonnegative literal is an alternate spelling of that resource gain. This
  // is not arbitrary unknown-wrapper removal or a payable cost conversion.
  if ((parentKey === 'effects' || parentKey === 'discard_effects') && Object.keys(result).length === 1) {
    const key = Object.keys(result)[0];
    const child = result[key];
    if (key.startsWith('gain_') && isRecord(child) && Object.keys(child).length === 1 && isRecord(child.resource)) {
      const resource = child.resource;
      if (typeof resource.id === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(resource.id)
        && key === `gain_${resource.id}` && Object.keys(resource).every(field => field === 'id' || field === 'amount')
        && typeof resource.amount === 'number' && Number.isFinite(resource.amount) && resource.amount >= 0) {
        delete result[key];
        result.resource = resource;
      }
    }
  }
  normalizeNumericPercentModifier(result);
  normalizeSummonOutputModifier(result);

  // Summon operations expose `when` beside the operation, never inside its
  // payload or selector. Hoist only a single identical condition and leave
  // conflicts untouched for validation; this changes placement, not timing.
  for (const operation of ['damage_summon', 'heal_summon', 'modify_summon', 'modify_summon_effect'] as const) {
    const nested = result[operation];
    if (!isRecord(nested)) continue;
    const selector = isRecord(nested.selector) ? nested.selector : null;
    const conditions = [nested.when, selector?.when]
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .map(value => value.trim());
    const unique = [...new Set(conditions)];
    if (unique.length !== 1 || (result.when !== undefined && result.when !== unique[0])) continue;
    if (result.when === undefined) result.when = unique[0];
    if (nested.when !== undefined) delete nested.when;
    if (selector?.when !== undefined) delete selector.when;
  }

  if (isRecord(result.spawn_summon)) {
    // `slot` is an owner-local technical identity, not a numeric board index.
    // Numeric schema output therefore has one lossless stable-ID spelling.
    if (Number.isInteger(result.spawn_summon.slot) && Number(result.spawn_summon.slot) >= 0) {
      result.spawn_summon.slot = `slot_${Number(result.spawn_summon.slot)}`;
    }
    const summonTriggerAliases: Readonly<Record<string, string>> = {
      owner_card_played: 'card_played',
      owner_attack_played: 'attack_played',
      owner_skill_played: 'skill_played',
      owner_power_played: 'power_played',
    };
    if (Array.isArray(result.spawn_summon.abilities)) {
      result.spawn_summon.abilities.forEach((ability: unknown) => {
        if (!isRecord(ability) || !isRecord(ability.trigger) || typeof ability.trigger.on !== 'string') return;
        const alias = summonTriggerAliases[ability.trigger.on.trim().toLowerCase()];
        if (alias) ability.trigger.on = alias;
      });
    }
  }

  // `block_summon` is a frequent literal rendering of “grant block to the
  // selected summons”. Summon block is already a mutable summon stat, so this
  // has one exact public representation and does not require design judgment.
  if (isRecord(result.block_summon) && result.modify_summon === undefined) {
    const nested = result.block_summon;
    const amountKeys = ['amount', 'value'].filter(key => nested[key] !== undefined);
    const allowed = new Set(['selector', 'amount', 'value', 'when']);
    if (
      amountKeys.length === 1
      && isRecord(nested.selector)
      && Object.keys(nested).every(key => allowed.has(key))
      && (result.when === undefined || nested.when === undefined || result.when === nested.when)
    ) {
      result.modify_summon = {
        selector: nested.selector,
        stat: 'block',
        add: nested[amountKeys[0]],
      };
      if (result.when === undefined && nested.when !== undefined) result.when = nested.when;
      delete result.block_summon;
    }
  }

  const nestedCardRule = result.card_rule;
  if (isRecord(nestedCardRule)) {
    const rule = cardPlayRuleFromEnvelope(nestedCardRule);
    const transferable = [...CARD_PLAY_RULE_FIELDS].filter(field => (
      !CARD_PLAY_RULE_NAMES.has(field) && !['rule', 'type', 'card_rule'].includes(field)
    ));
    if (
      rule &&
      Object.keys(nestedCardRule).every(key => CARD_PLAY_RULE_FIELDS.has(key)) &&
      transferable.every(key => (
        result[key] === undefined || nestedCardRule[key] === undefined || result[key] === nestedCardRule[key]
      ))
    ) {
      result.card_rule = rule;
      transferable.forEach(key => {
        if (result[key] === undefined && nestedCardRule[key] !== undefined) result[key] = nestedCardRule[key];
      });
    }
  }

  // `gain_resource` is the runtime command spelling of the public `resource`
  // operation. Convert only its closed, bijective object form; unknown fields
  // or conflicting target metadata remain visible to authoritative validation.
  if (result.resource === undefined && isRecord(result.gain_resource)) {
    const nested = result.gain_resource;
    const transferable = ['to', 'targets', 'when'] as const;
    const idKeys = ['id', 'resource'].filter(key => nested[key] !== undefined);
    const allowed = new Set(['id', 'resource', 'amount', ...transferable]);
    if (
      idKeys.length === 1
      && typeof nested[idKeys[0]] === 'string'
      && nested[idKeys[0]].trim()
      && nested.amount !== undefined
      && Object.keys(nested).every(key => allowed.has(key))
      && transferable.every(key => result[key] === undefined || nested[key] === undefined || result[key] === nested[key])
    ) {
      result.resource = { id: nested[idKeys[0]], amount: nested.amount };
      transferable.forEach(key => {
        if (result[key] === undefined && nested[key] !== undefined) result[key] = nested[key];
      });
      delete result.gain_resource;
    }
  }

  // `recover` has a fixed destination of hand. When a model combines that
  // operation with from:"draw", its intended movement is therefore fully
  // determined even though `recover` only accepts discard/exhaust. Rewrite
  // only the closed selector shape that `move_card` can represent exactly;
  // formulas, conflicting metadata and invalid numeric+all pairs remain for
  // validation and bounded repair.
  if (result.move_card === undefined && result.from === 'draw' && result.recover !== undefined) {
    const selectorKeys = new Set([
      'recover', 'from', 'pick', 'name', 'card_type', 'rarity', 'cost', 'min_cost', 'max_cost',
      'tag', 'template_id', 'run_instance_id', 'combat_instance_id', 'origin', 'upgraded',
      'keyword', 'exclude_keyword', 'root_only', 'when',
    ]);
    const amount = result.recover;
    const pick = result.pick ?? 'choose';
    const validAmount = amount === 'all' || (Number.isInteger(amount) && amount >= 1 && amount <= 100);
    const validPick = ['random', 'choose', 'top', 'bottom', 'all'].includes(pick);
    const compatibleAll = (amount === 'all') === (pick === 'all');
    if (
      validAmount
      && validPick
      && compatibleAll
      && Object.keys(result).every(key => selectorKeys.has(key))
    ) {
      result.move_card = amount;
      result.destination = 'hand';
      delete result.recover;
    }
  }

  // Models frequently place target metadata inside the compact resource
  // payload (`set_resource:{id,value,to:"self"}`) even though the shared
  // contract keeps it beside the operation. The meaning is unambiguous, so
  // canonicalize this equivalent shape before validating the content.
  for (const operation of ['resource', 'set_resource'] as const) {
    const nested = result[operation];
    if (!isRecord(nested)) continue;
    const amountKey = operation === 'resource' ? 'amount' : 'value';
    const transferable = ['to', 'targets', 'when'] as const;
    const allowed = new Set(['id', amountKey, ...transferable]);
    if (Object.keys(nested).some(key => !allowed.has(key))) continue;
    if (transferable.some(key => result[key] !== undefined && nested[key] !== undefined && result[key] !== nested[key])) {
      continue;
    }
    result[operation] = Object.fromEntries(
      Object.entries(nested).filter(([key]) => key === 'id' || key === amountKey),
    );
    transferable.forEach(key => {
      if (result[key] === undefined && nested[key] !== undefined) result[key] = nested[key];
    });
  }


  // Template-producing operations are occasionally emitted as
  // `{add_card:{id,count}}`. Both the template ID and placement metadata map
  // one-to-one to the public shallow form, so flatten only that closed shape.
  for (const operation of ['add_card', 'ensure_card', 'transform_card'] as const) {
    const nested = result[operation];
    if (!isRecord(nested) || typeof nested.id !== 'string' || !nested.id.trim()) continue;
    const transferable = operation === 'add_card'
      ? ['to', 'count']
      : operation === 'ensure_card'
        ? ['to', 'minimum', 'include_copies']
        : [];
    const allowed = new Set(['id', ...transferable]);
    if (Object.keys(nested).some(key => !allowed.has(key))) continue;
    if (transferable.some(key => result[key] !== undefined && nested[key] !== undefined && result[key] !== nested[key])) {
      continue;
    }
    result[operation] = nested.id;
    transferable.forEach(key => {
      if (result[key] === undefined && nested[key] !== undefined) result[key] = nested[key];
    });
  }

  const nestedModify = result.modify;
  if (isRecord(nestedModify)) {
    const attribute = typeof nestedModify.attribute === 'string'
      ? nestedModify.attribute
      : typeof nestedModify.stat === 'string'
        ? nestedModify.stat
        : '';
    const operators = ['add', 'subtract', 'multiply', 'divide', 'set'].filter(
      key => nestedModify[key] !== undefined,
    );
    const allowed = new Set(['attribute', 'stat', 'add', 'subtract', 'multiply', 'divide', 'set', 'to', 'targets']);
    if (
      attribute &&
      operators.length === 1 &&
      Object.keys(nestedModify).every(key => allowed.has(key)) &&
      ['to', 'targets', ...operators].every(
        key => result[key] === undefined || nestedModify[key] === undefined || result[key] === nestedModify[key],
      )
    ) {
      result.modify = attribute;
      ['to', 'targets', ...operators].forEach(key => {
        if (result[key] === undefined && nestedModify[key] !== undefined) result[key] = nestedModify[key];
      });
    }
  }
  // Dynamic enemies own their multiplicity and roster capacity. When a model
  // emits those two fields beside the sole spawn_enemy operation, moving them
  // into the enemy envelope is a lossless shape correction.
  if (isRecord(result.spawn_enemy)) {
    const operationKeys = Object.keys(result).filter(key => !['when', 'count', 'capacity'].includes(key));
    if (operationKeys.length === 1 && operationKeys[0] === 'spawn_enemy') {
      for (const key of ['count', 'capacity'] as const) {
        if (result[key] === undefined || result.spawn_enemy[key] !== undefined) continue;
        result.spawn_enemy[key] = result[key];
        delete result[key];
      }
    }
  }

  normalizePowerRootTriggerWrapper(result);
  normalizeTriggerCreatesPlacement(result);
  normalizeCurrentCardExhaustKeyword(result);

  // Status definitions use `triggers.hold` for continuous modifier/card-rule
  // effects. `triggers.passive` is a frequent schema-language alias with one
  // exact meaning when its payload already consists solely of those rules.
  if (
    ['buff', 'debuff', 'neutral'].includes(String(result.type || ''))
    && isRecord(result.triggers)
    && result.triggers.hold === undefined
    && result.triggers.passive !== undefined
  ) {
    const passive = Array.isArray(result.triggers.passive)
      ? result.triggers.passive
      : [result.triggers.passive];
    if (
      passive.length > 0
      && passive.every((entry: unknown) => isRecord(entry) && (
        Object.hasOwn(entry, 'modify') || Object.hasOwn(entry, 'card_rule')
      ))
    ) {
      result.triggers.hold = result.triggers.passive;
      delete result.triggers.passive;
    }
  }
  // A complete status definition has exactly one executable home for a
  // continuous modifier/card rule: `triggers.hold`. Providers sometimes place
  // that already-valid passive payload beside `triggers`. Move it only when
  // the authoritative compiler proves it is a pure passive sequence and no
  // competing hold/passive lifecycle field exists.
  if (
    validContentId(result.id)
    && typeof result.name === 'string'
    && result.name.trim()
    && typeof result.emoji === 'string'
    && result.emoji.trim()
    && ['buff', 'debuff', 'neutral'].includes(String(result.type || ''))
    && isRecord(result.triggers)
    && result.triggers.hold === undefined
    && result.triggers.passive === undefined
    && result.hold !== undefined
  ) {
    const hold = Array.isArray(result.hold) ? result.hold : [result.hold];
    const compiled = hold.length > 0 ? compileCompactEffectList(hold) : null;
    const policy = compiled?.ok
      ? validateEffectProgramPolicy(compiled.value, {
        triggerPolicy: 'forbid', modifierPolicy: 'only', allowStatusStacks: true,
      })
      : null;
    if (compiled?.ok && policy?.ok) {
      result.triggers.hold = result.hold;
      delete result.hold;
    }
  }
  // A Power that already applies its persistent status may also contain an
  // empty, redundant trigger shell. The shell executes nothing and is not an
  // authored mechanic; deleting only this exact shape preserves the real
  // root effect and lets the registered status own the ongoing behavior.
  if (
    result.type === 'Power'
    && isRecord(result.trigger)
    && Object.keys(result.trigger).every(key => ['on', 'effects'].includes(key))
    && (
      (Array.isArray(result.trigger.effects) && result.trigger.effects.length === 0)
      || (isRecord(result.trigger.effects) && Object.keys(result.trigger.effects).length === 0)
    )
  ) {
    const rootEffects = Array.isArray(result.effects) ? result.effects : [result.effects];
    if (rootEffects.some((entry: unknown) => isRecord(entry) && typeof entry.apply_status === 'string')) {
      delete result.trigger;
    }
  }

  // `stacks_change` belongs to the status definition, never inside triggers.
  // Move it only when the root has no competing value.
  if (isRecord(result.triggers) && result.stacks_change === undefined && result.triggers.stacks_change !== undefined) {
    const nestedDecay = result.triggers.stacks_change;
    if (
      typeof nestedDecay === 'number' ||
      (typeof nestedDecay === 'string' && /^(?:keep|reset|x(?:\d+(?:\.\d+)?|\.\d+))$/i.test(nestedDecay.trim()))
    ) {
      result.stacks_change = nestedDecay;
      delete result.triggers.stacks_change;
    }
  }
  if (isRecord(result.triggers) && result.stacks_change === undefined) {
    const nestedDecayEntries = Object.entries(result.triggers).filter(([, triggerValue]) => (
      isRecord(triggerValue)
      && Object.prototype.hasOwnProperty.call(triggerValue, 'stacks_change')
    ));
    const nestedValues = nestedDecayEntries.map(([, triggerValue]) => (triggerValue as Record<string, any>).stacks_change);
    const oneUnambiguousValue = nestedValues.length === 1 && (
      typeof nestedValues[0] === 'number'
      || nestedValues[0] === 'keep'
      || nestedValues[0] === 'reset'
      || (typeof nestedValues[0] === 'string' && /^x(?:\d+(?:\.\d+)?|\.\d+)$/.test(nestedValues[0]))
    );
    if (oneUnambiguousValue) {
      result.stacks_change = nestedValues[0];
      const [triggerName, triggerValue] = nestedDecayEntries[0];
      const cleaned = { ...(triggerValue as Record<string, any>) };
      delete cleaned.stacks_change;
      if (Object.keys(cleaned).length > 0) result.triggers[triggerName] = cleaned;
      else delete result.triggers[triggerName];
    }
  }

  stripRedundantSummonEffectScope(result, parentKey);

  for (const field of ['status_effects', 'player_status_effects'] as const) {
    if (!Array.isArray(result[field])) continue;
    // Zero stacks means precisely “not active”. The definition remains in the
    // status library, so omitting the inactive entry preserves the state.
    result[field] = result[field].filter((entry: unknown) => (
      !isRecord(entry) || entry.stacks === undefined || Number(entry.stacks) > 0
    ));
  }

  pruneUnreachableCandidateStatuses(result);
  rehomeRewardContainerStatuses(result, parentKey);

  const unwrapped = parentKey ? unwrapAuthoredEffectEnvelope(result) : result;
  return unwrapped === result
    ? result
    : rewriteNode(unwrapped, aliases, parentKey, inheritedActor);
}

/**
 * Canonicalize a generated card/reward/event subtree without assuming that it
 * is a complete battle snapshot. Only syntax with one unambiguous meaning is
 * rewritten; unknown creative fields remain visible to the real validator.
 */
export function normalizeMvuAuthoredContent<T>(value: T): T {
  const normalized = rewriteNode(cloneJson(value), new Map()) as T;
  stripEmptyOptionalStanceAndOrbEffects(normalized);
  promoteCardLifecycleFlags(normalized);
  if (isRecord(normalized) && isRecord(normalized.registry) && Array.isArray(normalized.registry.statuses)) {
    normalized.registry.statuses = expandBuiltinStatusDefinitions(normalized.registry.statuses, normalized);
  }
  return normalized;
}

function stripEmptyOptionalStanceAndOrbEffects(value: unknown, parentKey = ''): void {
  if (Array.isArray(value)) {
    value.forEach(entry => stripEmptyOptionalStanceAndOrbEffects(entry, parentKey));
    return;
  }
  if (!isRecord(value)) return;

  // These fields are optional effect hooks. An empty object/array has exactly
  // the same runtime meaning as omission, while the public contract rejects
  // the empty placeholder. Keep this transport cleanup deliberately scoped:
  // required card/action/lust effects must still fail authoritative validation.
  const optionalFields = parentKey === 'stance'
    ? ['enter', 'exit', 'passive']
    : parentKey === 'orbs' || parentKey === 'channel_orb'
      ? ['passive', 'evoke']
      : [];
  for (const field of optionalFields) {
    const candidate = value[field];
    if (
      (Array.isArray(candidate) && candidate.length === 0)
      || (isRecord(candidate) && Object.keys(candidate).length === 0)
    ) delete value[field];
  }

  Object.entries(value).forEach(([key, entry]) => {
    stripEmptyOptionalStanceAndOrbEffects(entry, key);
  });
}

const DISPLAY_TEXT_KEYS = new Set([
  'name', 'description', 'label', 'title', 'narrative', 'emoji', 'source', 'ability',
]);

/**
 * AI-visible ids are technical persistence keys. When an invalid id appears
 * only on `id` plus display prose (usually the model copied a Chinese name),
 * it has no machine reference to preserve and can be assigned a deterministic
 * backend id. If the token is referenced by an effect, formula or selector we
 * deliberately leave it untouched so the strict validator can request a
 * coherent repair instead of guessing how to rewrite the reference graph.
 */
function canonicalizeUnreferencedTechnicalIds(value: unknown): void {
  const invalidIds = new Set<string>();
  const usedIds = new Set<string>();
  const collectIds = (entry: unknown): void => {
    if (Array.isArray(entry)) {
      entry.forEach(collectIds);
      return;
    }
    if (!isRecord(entry)) return;
    if (typeof entry.id === 'string') {
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(entry.id)) usedIds.add(entry.id);
      else if (entry.id.trim()) invalidIds.add(entry.id);
    }
    Object.values(entry).forEach(collectIds);
  };
  collectIds(value);
  if (invalidIds.size === 0) return;

  const referencedIds = new Set<string>();
  const collectReferences = (entry: unknown, parentKey = ''): void => {
    if (typeof entry === 'string') {
      if (parentKey !== 'id' && !DISPLAY_TEXT_KEYS.has(parentKey)) {
        invalidIds.forEach(id => {
          if (entry.includes(id)) referencedIds.add(id);
        });
      }
      return;
    }
    if (Array.isArray(entry)) {
      entry.forEach(item => collectReferences(item, parentKey));
      return;
    }
    if (!isRecord(entry)) return;
    Object.entries(entry).forEach(([key, item]) => collectReferences(item, key));
  };
  collectReferences(value);

  const replacements = new Map<string, string>();
  invalidIds.forEach(id => {
    if (referencedIds.has(id)) return;
    const stem = `content_${stableHash32(id).toString(36)}`;
    let replacement = stem;
    let suffix = 2;
    while (usedIds.has(replacement)) replacement = `${stem}_${suffix++}`;
    usedIds.add(replacement);
    replacements.set(id, replacement);
  });
  const rewriteIds = (entry: unknown): void => {
    if (Array.isArray(entry)) {
      entry.forEach(rewriteIds);
      return;
    }
    if (!isRecord(entry)) return;
    if (typeof entry.id === 'string' && replacements.has(entry.id)) {
      entry.id = replacements.get(entry.id);
    }
    Object.values(entry).forEach(rewriteIds);
  };
  rewriteIds(value);
}

const CARD_TYPE_SET = new Set(['Attack', 'Skill', 'Power', 'Event', 'Curse']);

/**
 * A boolean `exhaust` inside a card effects list cannot be an exhaust-zone
 * operation (that operation requires a count/formula).  Its only executable
 * meaning is the card lifecycle flag, so move that exact singleton envelope
 * to the card root.  Numeric/formula exhaust operations and conflicting root
 * flags remain untouched for the validator/repair model.
 */
function promoteCardLifecycleFlags(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(entry => promoteCardLifecycleFlags(entry));
    return;
  }
  if (!isRecord(value)) return;

  if (
    CARD_TYPE_SET.has(String(value.type || ''))
    && (value.exhaust === undefined || value.exhaust === true)
  ) {
    if (Array.isArray(value.effects)) {
      const lifecycleEntries = value.effects.filter((entry: unknown) => (
        isRecord(entry)
        && entry.exhaust === true
        && Object.keys(entry).length === 1
      ));
      if (lifecycleEntries.length > 0) {
        value.exhaust = true;
        value.effects = value.effects.filter((entry: unknown) => !lifecycleEntries.includes(entry as Record<string, any>));
      }
    } else if (
      isRecord(value.effects)
      && value.effects.exhaust === true
      && Object.keys(value.effects).length === 1
    ) {
      value.exhaust = true;
      value.effects = [];
    }
  }

  Object.values(value).forEach(entry => promoteCardLifecycleFlags(entry));
}

const PLAYER_PILE_VARIABLE_PATTERN = /(?<![A-Za-z0-9_.])(hand_size|draw_pile_size|discard_pile_size|exhaust_pile_size)\b/g;
const FORMULA_STRING_FIELDS = new Set([
  'when', 'damage', 'heal', 'block', 'energy', 'lust', 'stacks', 'draw', 'scry', 'seek',
  'set_hp', 'set_lust', 'set_energy', 'set_block', 'count', 'limit', 'extra', 'add', 'subtract',
  'multiply', 'divide', 'minimum', 'maximum', 'amount', 'value', 'replay_current', 'execute',
]);

function qualifyPlayerPileFormulaVariables(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(entry => qualifyPlayerPileFormulaVariables(entry));
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string' && FORMULA_STRING_FIELDS.has(key)) {
      value[key] = entry.replace(PLAYER_PILE_VARIABLE_PATTERN, 'self.$1');
      continue;
    }
    qualifyPlayerPileFormulaVariables(entry);
  }
}

/** Normalize a generated player-owned reward/card subtree with known source perspective. */
export function normalizeMvuPlayerAuthoredContent<T>(value: T): T {
  const normalized = normalizeMvuAuthoredContent(value);
  normalizeRedundantInitialRewardReferenceIds(normalized);
  canonicalizeUnreferencedTechnicalIds(normalized);
  qualifyPlayerPileFormulaVariables(normalized);
  canonicalizePlayerPileSelfTargets(normalized);
  return normalized;
}

/** Remove only an exact, redundant identity on a uniquely resolved draft copy.
 * No mechanic, presentation override, missing definition or conflicting ID is repaired.
 * The caller owns a cloned normalized tree; the original AI response stays intact.
 */
function normalizeRedundantInitialRewardReferenceIds(value: unknown): void {
  if (!isRecord(value) || value.spec !== 'mwg.initial-draft/v1'
    || !isRecord(value.player) || !Array.isArray(value.player.cards)
    || !isRecord(value.opening) || !Array.isArray(value.opening.choices)) return;
  for (const choice of value.opening.choices) {
    const cards = choice?.outcome?.reward?.cards;
    if (!Array.isArray(cards)) continue;
    for (const ref of cards) {
      if (!isRecord(ref) || typeof ref.card_ref !== 'string' || !validContentId(ref.card_ref)
        || ref.id !== ref.card_ref || !Number.isInteger(ref.quantity) || ref.quantity < 1 || ref.quantity > 100
        || Object.keys(ref).some(key => !['id', 'card_ref', 'quantity'].includes(key))) continue;
      const sources = value.player.cards.filter((card: unknown) => isRecord(card) && card.id === ref.card_ref);
      if (sources.length === 1 && !Object.hasOwn(sources[0], 'card_ref')) delete ref.id;
    }
  }
}

const LOCAL_TEMPLATE_REFERENCE_OPERATIONS = new Set(['add_card', 'ensure_card', 'transform_card']);

function collectLocalTemplateReferences(value: unknown, references: Set<string>): void {
  if (Array.isArray(value)) {
    value.forEach(entry => collectLocalTemplateReferences(entry, references));
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, entry] of Object.entries(value)) {
    // A template cannot own another template library. Do not mistake an
    // invalid nested/self reference for a reference made by the parent card.
    if (key === 'creates') continue;
    if (LOCAL_TEMPLATE_REFERENCE_OPERATIONS.has(key) && typeof entry === 'string' && validContentId(entry)) {
      references.add(entry);
    }
    collectLocalTemplateReferences(entry, references);
  }
}

/**
 * A provider sometimes emits one unused template library on card A while the
 * sole reference is on sibling card B. `creates` has no runtime effect until a
 * local operation references it, so moving that one definition to its only
 * consumer is semantics-preserving. Ambiguous, duplicated, or shared cases are
 * left untouched for validation/AI repair.
 */
function rehomeUniqueOrphanedPlayerTemplates(battle: Record<string, any>): void {
  const owners: Record<string, any>[] = [];
  for (const field of ['cards', 'artifacts', 'items', 'player_abilities']) {
    if (Array.isArray(battle[field])) owners.push(...battle[field].filter(isRecord));
  }
  if (isRecord(battle.player_lust_effect)) owners.push(battle.player_lust_effect);
  if (owners.length < 2) return;

  const definitions = new Map<string, Array<{ owner: Record<string, any>; template: Record<string, any> }>>();
  const references = new Map<string, Set<Record<string, any>>>();
  for (const owner of owners) {
    if (Array.isArray(owner.creates)) {
      for (const template of owner.creates) {
        if (!isRecord(template) || !validContentId(template.id)) continue;
        const entries = definitions.get(template.id) || [];
        entries.push({ owner, template });
        definitions.set(template.id, entries);
      }
    }
    const localReferences = new Set<string>();
    collectLocalTemplateReferences(owner, localReferences);
    for (const id of localReferences) {
      const consumers = references.get(id) || new Set<Record<string, any>>();
      consumers.add(owner);
      references.set(id, consumers);
    }
  }

  for (const [id, entries] of definitions) {
    if (entries.length !== 1) continue;
    const consumers = references.get(id);
    if (!consumers || consumers.size !== 1) continue;
    const [{ owner: source, template }] = entries;
    const [target] = [...consumers];
    if (target === source) continue;
    const sourceReferences = new Set<string>();
    collectLocalTemplateReferences(source, sourceReferences);
    if (sourceReferences.has(id)) continue;
    if (Array.isArray(target.creates) && target.creates.some((entry: unknown) => isRecord(entry) && entry.id === id)) {
      continue;
    }
    source.creates = (source.creates as unknown[]).filter(entry => entry !== template);
    if (source.creates.length === 0) delete source.creates;
    target.creates = [...(Array.isArray(target.creates) ? target.creates : []), template];
  }
}

/**
 * A generated template with no executable machine reference anywhere in the
 * player-owned graph can never be instantiated. Remove only those inert,
 * stable-ID definitions after unique cross-owner references have already been
 * rehomed. Referenced, ambiguous and malformed definitions stay visible to
 * strict validation.
 */
function pruneUnreachablePlayerTemplates(battle: Record<string, any>): void {
  const owners: Record<string, any>[] = [];
  for (const field of ['cards', 'artifacts', 'items', 'player_abilities']) {
    if (Array.isArray(battle[field])) owners.push(...battle[field].filter(isRecord));
  }
  if (isRecord(battle.player_lust_effect)) owners.push(battle.player_lust_effect);
  const referencedIds = new Set<string>();
  owners.forEach(owner => collectLocalTemplateReferences(owner, referencedIds));
  owners.forEach(owner => {
    if (!Array.isArray(owner.creates)) return;
    owner.creates = owner.creates.filter((template: unknown) => (
      !isRecord(template)
      || !validContentId(template.id)
      || referencedIds.has(template.id)
    ));
    if (owner.creates.length === 0) delete owner.creates;
  });
}

function pruneStrictEmptyPlayerLustEffect(battle: Record<string, any>): void {
  const effect = battle.player_lust_effect;
  if (!isRecord(effect)) return;
  const scaffoldEntries = Object.entries(effect).filter(([key]) => key !== '$meta');
  if (scaffoldEntries.every(([key, value]) =>
    ['name', 'emoji', 'description'].includes(key) && typeof value === 'string' && !value.trim())) {
    delete battle.player_lust_effect;
    return;
  }
  if (typeof effect.name !== 'string' || !effect.name.trim()) return;
  if (Object.keys(effect).some(key => !['name', 'emoji', 'effects'].includes(key))) return;
  const empty = (Array.isArray(effect.effects) && effect.effects.length === 0)
    || (isRecord(effect.effects) && Object.keys(effect.effects).length === 0);
  if (empty) delete battle.player_lust_effect;
}

/**
 * Canonicalize common, mechanically equivalent MVU shapes before validation.
 * Narrative names and rules are untouched; only machine ids, formula wrappers,
 * and nested status references are rewritten.
 */
export function normalizeMvuBattleContent(battleData: unknown): Record<string, any> {
  if (!isRecord(battleData)) throw new Error('battle data must be an object');
  const battle = cloneJson(battleData);
  // Older prompts and some models occasionally use the singular `resource`
  // key for the player's resource-definition array.  This is an unambiguous
  // envelope alias, so canonicalize it before any repair-result preservation
  // or reference-closure validation can accidentally discard the definitions.
  if (
    isRecord(battle.core)
    && battle.core.resources === undefined
    && Array.isArray(battle.core.resource)
  ) {
    battle.core.resources = battle.core.resource;
    delete battle.core.resource;
  }
  // Owned cards already mean one copy when quantity is absent in the content
  // contract. Persist that established default explicitly so the saved MVU,
  // UI counters and runtime deck construction cannot disagree. Templates and
  // unclaimed reward candidates are deliberately untouched.
  if (Array.isArray(battle.cards)) {
    battle.cards.forEach((card: unknown) => {
      if (isRecord(card) && card.quantity === undefined) card.quantity = 1;
    });
  }
  collapseEquivalentOwnedCardDefinitions(battle);
  promoteCardLifecycleFlags(battle);
  hoistRootEnemyStatusDefinitions(battle);
  const statuses = normalizeMvuStatusDefinitions(battle.statuses);
  const used = new Set(
    statuses
      .map(status => status.id)
      .filter((id): id is string => validContentId(id)),
  );
  const aliases = new Map<string, string>();

  const normalizedStatuses = statuses.map((status, index) => {
    const originalId = typeof status.id === 'string' ? status.id.trim() : '';
    if (validContentId(originalId)) return status;
    const name = typeof status.name === 'string' ? status.name.trim() : '';
    const replacement = canonicalStatusId(`${originalId || name || 'status'}:${index}`, used);
    if (originalId) aliases.set(originalId, replacement);
    if (name && !aliases.has(name)) aliases.set(name, replacement);
    return { ...status, id: replacement };
  });

  battle.statuses = expandBuiltinStatusDefinitions(normalizedStatuses, battle);
  const normalized = rewriteNode(battle, aliases) as Record<string, any>;
  stripEmptyOptionalStanceAndOrbEffects(normalized);
  pruneStrictEmptyPlayerLustEffect(normalized);
  canonicalizeUnreferencedTechnicalIds(normalized);
  for (const field of ['cards', 'artifacts', 'items', 'player_abilities']) {
    if (Array.isArray(normalized[field])) {
      normalized[field].forEach((entry: unknown) => {
        qualifyPlayerPileFormulaVariables(entry);
      });
    }
  }
  if (isRecord(normalized.player_lust_effect)) {
    qualifyPlayerPileFormulaVariables(normalized.player_lust_effect);
  }
  rehomeUniqueOrphanedPlayerTemplates(normalized);
  pruneUnreachablePlayerTemplates(normalized);
  rehomeOwnedContentStatusWrappers(normalized);
  canonicalizePlayerPileSelfTargets(normalized);
  if (normalized.enemy == null && Array.isArray(normalized.enemies) && normalized.enemies.length > 0) {
    delete normalized.enemy;
  }
  return normalized;
}

/** Replace only the battle branch on a mutable MVU variable snapshot. */
export function normalizeMvuVariablesBattleInPlace(variables: unknown): boolean {
  if (!isRecord(variables) || !isRecord(variables.stat_data) || !isRecord(variables.stat_data.battle)) return false;
  variables.stat_data.battle = normalizeMvuBattleContent(variables.stat_data.battle);
  return true;
}
