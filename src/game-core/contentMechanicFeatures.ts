export type ContentMechanicRole =
  | '启动'
  | '收益'
  | '桥接'
  | '循环'
  | '终结'
  | '成长'
  | '控制'
  | '风险';

export interface ContentMechanicFeatures {
  operations: string[];
  axes: string[];
  targets: string[];
  zones: string[];
  triggers: string[];
  resources: string[];
  statuses: string[];
  /** Stable summon template identities, used to join setup and command cards. */
  summons: string[];
  roles: ContentMechanicRole[];
  /** Structural, not numeric, estimate used only for compact design guidance. */
  complexity: number;
}

/**
 * A plain numeric attack or guard is deliberately not a deck identity. This is a
 * recognition-only predicate: callers may omit it from archetype evidence,
 * while combat analysis still sees the authored card unchanged.
 */
export function isPlainStarterDefinition(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (!['attack', 'skill'].includes(String(value.type || '').toLowerCase())) return false;
  if (value.cost === 0 || isRecord(value.cost) && Object.values(value.cost).every(amount => amount === 0)) return false;
  const allowedCardFields = new Set(['id', 'name', 'type', 'cost', 'quantity', 'description', 'emoji', 'rarity', 'flavor', 'flavorText', 'metadata', 'effects', 'effectProgram', 'retain', 'free', 'innate', 'ethereal', 'exhaust', 'consumable',
    // Runtime-instance identity/progression survives MVU normalization and is
    // not a card mechanism. It must not turn a basic starter into an identity.
    'templateId', 'template_id', 'runInstanceId', 'run_instance_id', 'combatInstanceId', 'combat_instance_id', 'origin', 'upgradeLevel', 'upgrade_level', 'unique']);
  if (Object.keys(value).some(key => !allowedCardFields.has(key))) return false;
  // A structured cost represents a named resource or X-style payment and is
  // already a mechanism even if its immediate damage is small.
  if (isRecord(value.cost) && (Object.keys(value.cost).some(key => key !== 'energy') || !Number.isFinite(Number(value.cost.energy)) || Number(value.cost.energy) < 0)) return false;
  if (['retain', 'free', 'innate', 'ethereal', 'exhaust', 'consumable', 'unique'].some(key => value[key] === true)) return false;
  const compact = value.effects;
  const oneCompact = Array.isArray(compact) ? compact.length === 1 ? compact[0] : undefined : compact;
  const simpleCompact = (effect: unknown): boolean => {
    if (!isRecord(effect)) return false;
    const keys = Object.keys(effect);
    const kind = Object.hasOwn(effect, 'damage') ? 'damage' : Object.hasOwn(effect, 'block') ? 'block' : null;
    if (!kind || Object.hasOwn(effect, kind === 'damage' ? 'block' : 'damage')) return false;
    if (keys.some(key => ![kind, 'to', 'hits', 'bypass_block', 'lifesteal'].includes(key))) return false;
    const amount = effect[kind];
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) return false;
    if (Object.hasOwn(effect, 'hits') && effect.hits !== 1) return false;
    if (Object.hasOwn(effect, 'bypass_block') && effect.bypass_block !== false) return false;
    if (Object.hasOwn(effect, 'lifesteal') && effect.lifesteal !== 0) return false;
    return !Object.hasOwn(effect, 'to') || effect.to === (kind === 'damage' ? 'opponent' : 'self');
  };
  const program = value.effectProgram;
  const simpleCompiled = (): boolean => {
    if (!isRecord(program) || !Array.isArray(program.steps) || program.steps.length !== 1) return false;
    const step = program.steps[0];
    if (!isRecord(step) || !['damage', 'gain_block'].includes(String(step.op))) return false;
    // The compiler adds this stable provenance marker for a one-step compact
    // damage entry.  Other hit groups are part of multi-hit structure.
    const allowed = step.op === 'damage' ? ['op', 'target', 'amount', 'hitGroup', 'bypassBlock', 'lifesteal'] : ['op', 'target', 'amount'];
    if (Object.keys(step).some(key => !allowed.includes(key))) return false;
    if (Object.hasOwn(step, 'hitGroup') && !/^\$(?:\[0\])?:damage$/.test(String(step.hitGroup))) return false;
    if (Object.hasOwn(step, 'bypassBlock') && step.bypassBlock !== false) return false;
    if (Object.hasOwn(step, 'lifesteal') && step.lifesteal !== 0) return false;
    if (typeof step.amount !== 'number' || !Number.isFinite(step.amount) || step.amount <= 0) return false;
    return step.target === (step.op === 'damage' ? 'opponent' : 'self');
  };
  // Some adapters retain authored compact effects beside a compiled program.
  // Both are executable candidates, so a special compiled program must keep
  // the card in recognition even if the compact shadow looks ordinary.
  if (compact !== undefined && program !== undefined) return simpleCompact(oneCompact) && simpleCompiled();
  return compact !== undefined ? simpleCompact(oneCompact) : simpleCompiled();
}

const EFFECT_OPERATIONS = new Set([
  'damage', 'heal', 'block', 'energy', 'lust', 'resource', 'set_resource',
  'set_hp', 'set_lust', 'set_energy', 'set_block', 'apply_status', 'remove_status',
  'status_action',
  'draw', 'scry', 'seek', 'discard', 'exhaust', 'recover', 'reduce_cost',
  'modify_card', 'patch_card', 'attach_card', 'upgrade_card', 'copy', 'double',
  'auto_play', 'replay_current', 'card_destination', 'move_card', 'remove_card', 'transform_card',
  'add_card', 'ensure_card', 'card_rule', 'schedule', 'modify', 'narrate', 'choose',
  'execute', 'kill', 'stance', 'channel_orb', 'evoke_orb', 'orb_slots', 'modify_orb',
  'extra_turn', 'end_turn', 'spawn_summon', 'spawn_enemy', 'damage_summon', 'heal_summon',
  'modify_summon', 'modify_summon_effect', 'summon_resource', 'set_summon_resource', 'apply_summon_status',
  'remove_summon_status', 'activate_summon', 'dismiss_summon', 'copy_summon',
  'summoner_effects', 'lifesteal', 'summon_intercept', 'damage_taken_reduction',
]);

const ZONES = new Set(['hand', 'draw', 'discard', 'exhaust', 'all', 'combat']);
const TARGET_MODES = new Set(['active', 'by_id', 'all', 'random', 'random_n', 'lowest_hp', 'highest_hp']);
const RESERVED_COST_KEYS = new Set(['energy']);
/** Compiled EffectProgram nodes use canonical verbs; compact authoring uses shorter aliases. */
const COMPILED_OPERATION_ALIASES: Readonly<Record<string, string>> = {
  gain_block: 'block', gain_energy: 'energy', gain_resource: 'resource', gain_lust: 'lust',
  draw_cards: 'draw', scry_cards: 'scry', discard_cards: 'discard', exhaust_cards: 'exhaust', recover_cards: 'recover',
  reduce_card_cost: 'reduce_cost', modify_card_value: 'modify_card', copy_cards: 'copy', double_card_effect: 'double',
  auto_play_cards: 'auto_play', set_card_destination: 'card_destination', move_cards: 'move_card', remove_cards: 'remove_card',
  transform_cards: 'transform_card', apply_card_patch: 'patch_card', apply_card_attachment: 'attach_card', upgrade_cards: 'upgrade_card',
  damage_summons: 'damage_summon', heal_summons: 'heal_summon', modify_summons: 'modify_summon',
  modify_summon_effects: 'modify_summon_effect', gain_summon_resource: 'summon_resource',
  activate_summons: 'activate_summon', dismiss_summons: 'dismiss_summon', copy_summons: 'copy_summon',
  set_stance: 'stance', evoke_orbs: 'evoke_orb', set_orb_slots: 'orb_slots', modify_orbs: 'modify_orb',
  grant_extra_turn: 'extra_turn', force_end_turn: 'end_turn', register_trigger: 'trigger', schedule_effect: 'schedule', choose_one: 'choose',
};

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stableId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_]*$/.test(value);
}

function addString(target: Set<string>, value: unknown): void {
  if (typeof value === 'string' && value.trim()) target.add(value.trim());
}

function formulaReferences(value: string, statuses: Set<string>, resources: Set<string>, operations: Set<string>): void {
  for (const match of value.matchAll(/(?:self|opponent)\.status\.([A-Za-z][A-Za-z0-9_]*)\.stacks/g)) {
    statuses.add(match[1]);
    operations.add('history_formula');
  }
  if (/\b(?:self|opponent)\.(?:has_(?:buff|debuff|neutral|status)|(?:buff|debuff|neutral|status)_count)\b/.test(value)) {
    operations.add('status_query');
    operations.add('condition');
  }
  for (const match of value.matchAll(/(?:x_resource|self\.resource|opponent\.resource)\.([A-Za-z][A-Za-z0-9_]*)/g)) {
    resources.add(match[1]);
  }
  if (/\b(?:spent_energy|x_value|x_resource)\b/.test(value)) operations.add('x_formula');
  if (/\b(?:cards_discarded|cards_exhausted|cards_played|attacks_played|skills_played)(?:_[A-Za-z0-9]+)*\b|\bhistory\b/.test(value)) {
    operations.add('history_formula');
  }
  if (/\b(?:orb_value|stance|summon)\b/.test(value)) operations.add('container_formula');
  if (/\b(?:self|opponent)\.(?:summon_count|has_summon)\b/.test(value)) operations.add('summon_condition');
  if (/\b(?:self|opponent)\.(?:ally_count|has_ally)\b/.test(value)) operations.add('ally_condition');
}

function summonDamageReadsHp(value: unknown): boolean {
  const readsHp = (node: unknown): boolean => {
    if (typeof node === 'string') return /\bself\.(?:hp|max_hp)\b/.test(node);
    if (Array.isArray(node)) return node.some(readsHp);
    return isRecord(node) && Object.entries(node).some(([key, child]) => !['name','description','id','emoji'].includes(key) && readsHp(child));
  };
  if (Array.isArray(value)) return value.some(summonDamageReadsHp);
  if (!isRecord(value)) return false;
  if ((Object.hasOwn(value, 'damage') && readsHp(value.damage)) || (value.op === 'damage' && readsHp(value.amount))) return true;
  return Object.entries(value).some(([key, child]) => !['name','description','id','emoji'].includes(key) && summonDamageReadsHp(child));
}

function isDamageTakenReduction(stat: unknown, operator: unknown, value: unknown): boolean {
  if (stat !== 'damage_taken' || typeof operator !== 'string' || typeof value !== 'number' || !Number.isFinite(value)) return false;
  // damage_taken is an additive modifier in the executor: add negative and
  // subtract positive lower incoming damage; multiply zero (and fractions)
  // lowers it; set writes the absolute modifier value, so only a negative
  // set is a reduction. Do not treat additive increases as survival.
  return (operator === 'add' && value < 0)
    || (operator === 'subtract' && value > 0)
    || (operator === 'divide' && value > 1)
    || (operator === 'multiply' && value >= 0 && value < 1)
    || (operator === 'set' && value < 0);
}

function hasSummonIntercept(summon: Record<string, any>): boolean {
  const intercept = summon.intercept;
  return isRecord(intercept) && intercept.mode === 'unblocked_attack'
    && (!Object.hasOwn(intercept, 'priority') || Number.isInteger(intercept.priority))
    && (!Object.hasOwn(intercept, 'max_per_turn') || (Number.isInteger(intercept.max_per_turn) && intercept.max_per_turn > 0))
    && (!Object.hasOwn(intercept, 'maxPerTurn') || (Number.isInteger(intercept.maxPerTurn) && intercept.maxPerTurn > 0));
}

function summonFeatures(summon: Record<string, any>, count: unknown, operations: Set<string>): void {
  if (Number(count) > 1 && !summon.slot) operations.add('summon_multiple');
  if (typeof summon.slot === 'string' && summon.slot) operations.add('summon_single');
  if (Array.isArray(summon.abilities) && summon.abilities.length) operations.add('summon_passive');
  if (summonDamageReadsHp(summon.actions) || summonDamageReadsHp(summon.abilities)) operations.add('summon_hp_damage');
}

function collect(value: unknown, state: {
  operations: Set<string>;
  targets: Set<string>;
  zones: Set<string>;
  triggers: Set<string>;
  resources: Set<string>;
  statuses: Set<string>;
  summons: Set<string>;
  conditional: { value: boolean };
}): void {
  if (typeof value === 'string') {
    formulaReferences(value, state.statuses, state.resources, state.operations);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach(entry => collect(entry, state));
    return;
  }
  if (!isRecord(value)) return;
  if (isRecord(value.payment)) state.operations.add('card_payment');
  if (Array.isArray(value.intercepts) && value.intercepts.length) state.operations.add('interception');

  // A compiled node must be classified by its executable `op`, never by a
  // coincidental field name such as a summon `block: 0` or card metadata.
  if (typeof value.op === 'string') {
    const operation = COMPILED_OPERATION_ALIASES[value.op] || value.op;
    if (EFFECT_OPERATIONS.has(operation) || value.op === 'persistent_growth') state.operations.add(operation);
    if (value.op === 'set_stat' && typeof value.stat === 'string') state.operations.add(`set_${value.stat}`);
    if (value.op === 'damage' && Number(value.lifesteal) > 0) state.operations.add('lifesteal');
    if (value.op === 'modify' && isDamageTakenReduction(value.stat, value.operator, value.value)) state.operations.add('damage_taken_reduction');
    if (value.op === 'if') { state.operations.add('condition'); state.conditional.value = true; }
    if (value.op === 'apply_status' || value.op === 'remove_status' || value.op === 'apply_summon_status' || value.op === 'remove_summon_status') addString(state.statuses, value.status);
    if (value.op === 'gain_resource' || value.op === 'set_resource' || value.op === 'gain_summon_resource' || value.op === 'set_summon_resource') addString(state.resources, value.resource);
    if (value.op === 'gain_resource' && Number(value.amount) < 0) state.operations.add('resource_spend');
    if (value.op === 'spawn_summon' && isRecord(value.summon)) {
      addString(state.summons, value.summon.id);
      if (hasSummonIntercept(value.summon)) state.operations.add('summon_intercept');
      summonFeatures(value.summon, value.count, state.operations);
    }
    if (isRecord(value.selector)) addString(state.summons, value.selector.templateId || value.selector.template_id);
    if (typeof value.target === 'string') state.targets.add(value.target);
    if (isRecord(value.targetSelector) && typeof value.targetSelector.mode === 'string') state.targets.add(value.targetSelector.mode);
  }

  for (const [key, entry] of Object.entries(value)) {
    if (['name', 'description', 'emoji', 'flavor', 'flavorText'].includes(key)) continue;
    // Compact operations are executable only when their own value is present.
    // Boolean card metadata and zero-valued stats are not effects.
    if (EFFECT_OPERATIONS.has(key) && entry !== false && entry !== 0 && entry !== null && entry !== undefined)
      state.operations.add(key);
    if (key === 'lifesteal' && entry !== false && entry !== 0 && entry !== null && entry !== undefined)
      state.operations.add('lifesteal');
    if (key === 'modify' && typeof entry === 'string') {
      const operator = ['add', 'subtract', 'multiply', 'divide', 'set'].find(candidate => Object.hasOwn(value, candidate));
      const amount = operator === undefined ? undefined : value[operator];
      if (isDamageTakenReduction(entry, operator, amount)) state.operations.add('damage_taken_reduction');
    }
    if (key === 'when' || key === 'if') {
      state.operations.add('condition');
      state.conditional.value = true;
    }
    if (key === 'trigger' || key === 'on') {
      if (typeof entry === 'string') state.triggers.add(entry);
      else if (isRecord(entry)) addString(state.triggers, entry.on);
    }
    if ((key === 'apply_status' || key === 'remove_status') && entry !== false && entry !== 0 && entry !== null) {
      if (stableId(entry)) state.statuses.add(entry);
      else if (isRecord(entry) && stableId(entry.id)) state.statuses.add(entry.id);
    }
    if ((key === 'apply_summon_status' || key === 'remove_summon_status') && entry !== false && entry !== 0 && entry !== null) {
      if (isRecord(entry) && stableId(entry.id)) state.statuses.add(entry.id);
    }
    if ((key === 'resource' || key === 'set_resource') && entry !== false && entry !== 0 && entry !== null) {
      if (isRecord(entry) && stableId(entry.id)) state.resources.add(entry.id);
    }
    if ((key === 'summon_resource' || key === 'set_summon_resource') && entry !== false && entry !== 0 && entry !== null) {
      if (isRecord(entry) && stableId(entry.id)) state.resources.add(entry.id);
    }
    if (key === 'spawn_summon' && isRecord(entry)) {
      addString(state.summons, entry.id);
      if (hasSummonIntercept(entry)) state.operations.add('summon_intercept');
      summonFeatures(entry, entry.count, state.operations);
    }
    if (key === 'selector' && isRecord(entry)) addString(state.summons, entry.templateId || entry.template_id);
    if (key === 'cost') {
      if (entry === 'energy') state.operations.add('x_cost');
      if (isRecord(entry)) {
        for (const [resource, amount] of Object.entries(entry)) {
          if (!RESERVED_COST_KEYS.has(resource) && stableId(resource)) state.resources.add(resource);
          if (!RESERVED_COST_KEYS.has(resource) && stableId(resource)) state.operations.add('resource_cost');
          if (amount === 'all') state.operations.add('x_cost');
        }
      }
    }
    if ((key === 'resource' || key === 'summon_resource') && isRecord(entry) && Number(entry.amount) < 0)
      state.operations.add('resource_spend');
    if (key === 'resources' && isRecord(entry)) {
      Object.keys(entry).forEach(resource => {
        if (stableId(resource) && resource !== 'all') state.resources.add(resource);
      });
    }
    if (key === 'to') {
      const destination = String(entry);
      if (destination === 'deck') state.zones.add('draw');
      else if (ZONES.has(destination)) state.zones.add(destination);
      else addString(state.targets, entry);
    }
    if (key === 'targets' && isRecord(entry) && TARGET_MODES.has(String(entry.mode))) {
      state.targets.add(String(entry.mode));
    }
    if (key === 'from' || key === 'destination') {
      if (ZONES.has(String(entry))) state.zones.add(String(entry));
    }
    if (key === 'card_rule') addString(state.operations, isRecord(entry) ? entry.rule : entry);
    if (key === 'kind' && ['enchantment', 'affliction'].includes(String(entry))) state.operations.add(String(entry));
    if (key === 'type' && entry === 'Curse') state.operations.add('curse');
    if ((key === 'replay' || key === 'free' || key === 'retain' || key === 'innate' || key === 'ethereal') && entry === true) {
      state.operations.add(key);
    }
    collect(entry, state);
  }
}

function axesFor(operations: ReadonlySet<string>, targets: ReadonlySet<string>, resources: ReadonlySet<string>, statuses: ReadonlySet<string>): string[] {
  const axes = new Set<string>();
  const has = (...values: string[]) => values.some(value => operations.has(value));
  if (has('damage')) axes.add('生命压制');
  if (has('lust')) axes.add('欲望压制');
  if (has('block')) axes.add('格挡');
  if (has('heal', 'lifesteal', 'damage_taken_reduction', 'summon_intercept')) axes.add('生存');
  if (has('heal')) axes.add('恢复');
  if (statuses.size || has('status_query', 'status_action', 'apply_status', 'remove_status', 'apply_summon_status', 'remove_summon_status')) axes.add('状态');
  if (has('draw', 'scry', 'seek')) axes.add('牌序');
  if (has('discard')) axes.add('弃牌');
  if (has('exhaust')) axes.add('消耗');
  if (has('recover', 'move_card', 'card_destination', 'remove_card')) axes.add('牌区流转');
  if (has('add_card', 'ensure_card', 'copy', 'transform_card')) axes.add('卡牌生成');
  if (has('modify_card', 'patch_card', 'upgrade_card', 'double')) axes.add('卡牌成长');
  if (has('attach_card', 'enchantment', 'affliction')) axes.add('附着');
  if (has('replay', 'replay_current', 'auto_play')) axes.add('回响');
  if (has('interception')) axes.add('结算拦截');
  if (has('card_payment')) axes.add('费用转换');
  if (has('free', 'reduce_cost', 'dynamic_cost')) axes.add('费用转换');
  if (resources.size || has('resource', 'set_resource', 'summon_resource', 'set_summon_resource')) axes.add('自定义资源');
  if (has('x_cost', 'x_formula')) axes.add('X费用');
  if (has('stance')) axes.add('姿态');
  if (has('channel_orb', 'evoke_orb', 'modify_orb', 'orb_slots')) axes.add('姿态槽');
  if (has('spawn_summon', 'damage_summon', 'heal_summon', 'modify_summon', 'modify_summon_effect', 'activate_summon', 'dismiss_summon', 'copy_summon', 'summoner_effects', 'summon_condition')) axes.add('召唤');
  if (has('spawn_enemy')) axes.add('增援与分裂');
  if (has('ally_condition')) axes.add('多目标');
  if (has('schedule')) axes.add('延迟结算');
  if (has('extra_turn', 'end_turn')) axes.add('回合控制');
  if (has('execute', 'kill')) axes.add('处决');
  if (has('modify')) axes.add('修饰符');
  if (has('trigger') || operations.has('history_formula')) axes.add('触发联动');
  if ([...targets].some(target => ['all', 'random', 'random_n', 'lowest_hp', 'highest_hp', 'by_id'].includes(target))) axes.add('多目标');
  return [...axes];
}

function rolesFor(operations: ReadonlySet<string>, axes: readonly string[], conditional: boolean): ContentMechanicRole[] {
  const roles = new Set<ContentMechanicRole>();
  const has = (...values: string[]) => values.some(value => operations.has(value));
  if (has('draw', 'scry', 'seek', 'energy', 'resource', 'set_resource', 'discard', 'apply_status', 'stance', 'channel_orb', 'spawn_summon', 'spawn_enemy')) roles.add('启动');
  if (conditional || has('history_formula', 'container_formula', 'double', 'auto_play', 'replay', 'replay_current', 'free', 'activate_summon')) roles.add('收益');
  if (axes.length >= 2) roles.add('桥接');
  if (has('recover', 'move_card', 'copy', 'replay', 'replay_current', 'free', 'extra_turn')) roles.add('循环');
  if (has('execute', 'kill', 'x_formula')) roles.add('终结');
  if (has('patch_card', 'upgrade_card', 'schedule', 'modify', 'card_rule', 'trigger')) roles.add('成长');
  if (has('apply_status', 'remove_status', 'discard', 'exhaust', 'end_turn', 'card_rule')) roles.add('控制');
  if (has('interception')) roles.add('控制');
  if (has('card_payment')) roles.add('风险');
  if (has('curse', 'affliction') || (has('damage', 'lust') && operations.has('self_target'))) roles.add('风险');
  return [...roles];
}

/** Extract shared structural features from authored compact content without compiling or mutating it. */
export function extractContentMechanicFeatures(value: unknown): ContentMechanicFeatures {
  const operations = new Set<string>();
  const targets = new Set<string>();
  const zones = new Set<string>();
  const triggers = new Set<string>();
  const resources = new Set<string>();
  const statuses = new Set<string>();
  const summons = new Set<string>();
  const conditional = { value: false };
  collect(value, { operations, targets, zones, triggers, resources, statuses, summons, conditional });
  if (triggers.size > 0) operations.add('trigger');
  if (targets.has('self') && (operations.has('damage') || operations.has('lust'))) operations.add('self_target');
  const axes = axesFor(operations, targets, resources, statuses);
  const complexity = Math.min(100, Math.round(
    operations.size * 2 + axes.length * 3 + targets.size + zones.size + triggers.size * 2 + (conditional.value ? 4 : 0),
  ));
  return {
    operations: [...operations].sort(),
    axes,
    targets: [...targets].sort(),
    zones: [...zones].sort(),
    triggers: [...triggers].sort(),
    resources: [...resources].sort(),
    statuses: [...statuses].sort(),
    summons: [...summons].sort(),
    roles: rolesFor(operations, axes, conditional.value),
    complexity,
  };
}

export function mergeContentMechanicFeatures(values: readonly ContentMechanicFeatures[]): ContentMechanicFeatures {
  const merge = (read: (value: ContentMechanicFeatures) => readonly string[]) => [...new Set(values.flatMap(read))];
  const operations = merge(value => value.operations).sort();
  const targets = merge(value => value.targets).sort();
  const zones = merge(value => value.zones).sort();
  const triggers = merge(value => value.triggers).sort();
  const resources = merge(value => value.resources).sort();
  const statuses = merge(value => value.statuses).sort();
  const summons = merge(value => value.summons).sort();
  const axes = merge(value => value.axes);
  const roles = merge(value => value.roles) as ContentMechanicRole[];
  return {
    operations,
    axes,
    targets,
    zones,
    triggers,
    resources,
    statuses,
    summons,
    roles,
    complexity: values.length ? Math.round(values.reduce((sum, value) => sum + value.complexity, 0) / values.length) : 0,
  };
}
