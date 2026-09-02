import { normalizeMvuStatusDefinitions } from './mvuArrays';

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
): string {
  let result = value.replace(/\bself\.opponent\./g, 'opponent.');
  if (actor) result = result.replace(/\b(?:self\|opponent|opponent\|self)\./g, `${actor}.`);
  aliases.forEach((replacement, alias) => {
    if (!alias || alias === replacement) return;
    for (const actor of ['self', 'opponent']) {
      result = result.split(`${actor}.status.${alias}.stacks`).join(`${actor}.status.${replacement}.stacks`);
    }
  });
  return result;
}

function rewriteNode(
  value: unknown,
  aliases: ReadonlyMap<string, string>,
  parentKey = '',
  inheritedActor?: FormulaActor,
): unknown {
  if (typeof value === 'string') return rewriteFormula(value, aliases, inheritedActor);
  if (Array.isArray(value)) return value.map(entry => rewriteNode(entry, aliases, '', inheritedActor));
  if (!isRecord(value)) return value;

  const normalizedEnvelope = normalizeRuleEffectEnvelope(value);
  if (normalizedEnvelope !== value) return rewriteNode(normalizedEnvelope, aliases, parentKey, inheritedActor);

  const actor = inferFormulaActor(value, inheritedActor);

  if (
    FORMULA_VALUE_KEYS.has(parentKey) &&
    Object.keys(value).length === 1 &&
    Object.prototype.hasOwnProperty.call(value, 'formula') &&
    (typeof value.formula === 'string' || typeof value.formula === 'number')
  ) {
    return typeof value.formula === 'string' ? rewriteFormula(value.formula, aliases, actor) : value.formula;
  }

  const result: Record<string, any> = {};
  for (const [key, entry] of Object.entries(value)) {
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

  for (const operation of ['apply_status', 'remove_status'] as const) {
    const nested = result[operation];
    if (!isRecord(nested) || typeof nested.id !== 'string') continue;
    const transferable = operation === 'apply_status' ? ['stacks', 'to', 'targets'] : ['to', 'targets'];
    const allowed = new Set([
      'id', 'name', 'emoji', 'description', 'type', 'stacks_change', 'maxStacks', 'stun', 'triggers', '$meta',
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
  return result;
}

/**
 * Canonicalize common, mechanically equivalent MVU shapes before validation.
 * Narrative names and rules are untouched; only machine ids, formula wrappers,
 * and nested status references are rewritten.
 */
export function normalizeMvuBattleContent(battleData: unknown): Record<string, any> {
  if (!isRecord(battleData)) throw new Error('battle data must be an object');
  const battle = cloneJson(battleData);
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

  battle.statuses = normalizedStatuses;
  return rewriteNode(battle, aliases) as Record<string, any>;
}

/** Replace only the battle branch on a mutable MVU variable snapshot. */
export function normalizeMvuVariablesBattleInPlace(variables: unknown): boolean {
  if (!isRecord(variables) || !isRecord(variables.stat_data) || !isRecord(variables.stat_data.battle)) return false;
  variables.stat_data.battle = normalizeMvuBattleContent(variables.stat_data.battle);
  return true;
}
