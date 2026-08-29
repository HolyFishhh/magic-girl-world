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
  roles: ContentMechanicRole[];
  /** Structural, not numeric, estimate used only for compact design guidance. */
  complexity: number;
}

const EFFECT_OPERATIONS = new Set([
  'damage', 'heal', 'block', 'energy', 'lust', 'resource', 'set_resource',
  'set_hp', 'set_lust', 'set_energy', 'set_block', 'apply_status', 'remove_status',
  'draw', 'scry', 'seek', 'discard', 'exhaust', 'recover', 'reduce_cost',
  'modify_card', 'patch_card', 'attach_card', 'upgrade_card', 'copy', 'double',
  'auto_play', 'card_destination', 'move_card', 'remove_card', 'transform_card',
  'add_card', 'ensure_card', 'card_rule', 'schedule', 'modify', 'narrate', 'choose',
  'execute', 'kill', 'stance', 'channel_orb', 'evoke_orb', 'orb_slots', 'modify_orb',
  'extra_turn', 'end_turn', 'spawn_summon', 'spawn_enemy', 'damage_summon', 'heal_summon',
  'modify_summon', 'modify_summon_effect', 'summon_resource', 'set_summon_resource', 'apply_summon_status',
  'remove_summon_status', 'activate_summon', 'dismiss_summon', 'copy_summon',
  'summoner_effects',
]);

const ZONES = new Set(['hand', 'draw', 'discard', 'exhaust', 'all', 'combat']);
const TARGET_MODES = new Set(['active', 'by_id', 'all', 'random', 'random_n', 'lowest_hp', 'highest_hp']);
const RESERVED_COST_KEYS = new Set(['energy']);

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
  }
  for (const match of value.matchAll(/(?:x_resource|self\.resource|opponent\.resource)\.([A-Za-z][A-Za-z0-9_]*)/g)) {
    resources.add(match[1]);
  }
  if (/\b(?:spent_energy|x_value|x_resource)\b/.test(value)) operations.add('x_formula');
  if (/\b(?:cards_discarded|cards_exhausted|cards_played|attacks_played|skills_played|history)\b/.test(value)) {
    operations.add('history_formula');
  }
  if (/\b(?:orb_value|stance|summon)\b/.test(value)) operations.add('container_formula');
}

function collect(value: unknown, state: {
  operations: Set<string>;
  targets: Set<string>;
  zones: Set<string>;
  triggers: Set<string>;
  resources: Set<string>;
  statuses: Set<string>;
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

  for (const [key, entry] of Object.entries(value)) {
    if (EFFECT_OPERATIONS.has(key)) state.operations.add(key);
    if (key === 'when' || key === 'if') {
      state.operations.add('condition');
      state.conditional.value = true;
    }
    if (key === 'trigger' || key === 'on') {
      if (typeof entry === 'string') state.triggers.add(entry);
      else if (isRecord(entry)) addString(state.triggers, entry.on);
    }
    if (key === 'apply_status' || key === 'remove_status') {
      if (stableId(entry)) state.statuses.add(entry);
      else if (isRecord(entry) && stableId(entry.id)) state.statuses.add(entry.id);
    }
    if (key === 'apply_summon_status' || key === 'remove_summon_status') {
      if (isRecord(entry) && stableId(entry.id)) state.statuses.add(entry.id);
    }
    if (key === 'resource' || key === 'set_resource') {
      if (isRecord(entry) && stableId(entry.id)) state.resources.add(entry.id);
    }
    if (key === 'summon_resource' || key === 'set_summon_resource') {
      if (isRecord(entry) && stableId(entry.id)) state.resources.add(entry.id);
    }
    if (key === 'cost') {
      if (entry === 'energy') state.operations.add('x_cost');
      if (isRecord(entry)) {
        for (const [resource, amount] of Object.entries(entry)) {
          if (!RESERVED_COST_KEYS.has(resource) && stableId(resource)) state.resources.add(resource);
          if (amount === 'all') state.operations.add('x_cost');
        }
      }
    }
    if (key === 'resources' && isRecord(entry)) {
      Object.keys(entry).forEach(resource => {
        if (stableId(resource) && resource !== 'all') state.resources.add(resource);
      });
    }
    if (key === 'to') addString(state.targets, entry);
    if (key === 'targets' && isRecord(entry) && TARGET_MODES.has(String(entry.mode))) {
      state.targets.add(String(entry.mode));
    }
    if (key === 'from' || key === 'destination') {
      if (ZONES.has(String(entry))) state.zones.add(String(entry));
    }
    if (key === 'card_rule') addString(state.operations, isRecord(entry) ? entry.rule : entry);
    if (key === 'kind' && ['enchantment', 'affliction'].includes(String(entry))) state.operations.add(String(entry));
    if (key === 'type' && entry === 'Curse') state.operations.add('curse');
    if (key === 'replay' || key === 'free' || key === 'retain' || key === 'innate' || key === 'ethereal') {
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
  if (has('heal')) axes.add('恢复');
  if (statuses.size || has('apply_status', 'remove_status', 'apply_summon_status', 'remove_summon_status')) axes.add('状态');
  if (has('draw', 'scry', 'seek')) axes.add('牌序');
  if (has('discard')) axes.add('弃牌');
  if (has('exhaust')) axes.add('消耗');
  if (has('recover', 'move_card', 'card_destination', 'remove_card')) axes.add('牌区流转');
  if (has('add_card', 'ensure_card', 'copy', 'transform_card')) axes.add('卡牌生成');
  if (has('modify_card', 'patch_card', 'upgrade_card', 'double')) axes.add('卡牌成长');
  if (has('attach_card', 'enchantment', 'affliction')) axes.add('附着');
  if (has('replay', 'auto_play')) axes.add('回响');
  if (has('free', 'reduce_cost', 'dynamic_cost')) axes.add('费用转换');
  if (resources.size || has('resource', 'set_resource', 'summon_resource', 'set_summon_resource')) axes.add('自定义资源');
  if (has('x_cost', 'x_formula')) axes.add('X费用');
  if (has('stance')) axes.add('姿态');
  if (has('channel_orb', 'evoke_orb', 'modify_orb', 'orb_slots')) axes.add('Orb');
  if (has('spawn_summon', 'damage_summon', 'heal_summon', 'modify_summon', 'modify_summon_effect', 'activate_summon', 'dismiss_summon', 'copy_summon', 'summoner_effects')) axes.add('召唤');
  if (has('spawn_enemy')) axes.add('增援与分裂');
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
  if (conditional || has('history_formula', 'container_formula', 'double', 'auto_play', 'replay', 'free', 'activate_summon')) roles.add('收益');
  if (axes.length >= 2) roles.add('桥接');
  if (has('recover', 'move_card', 'copy', 'replay', 'free', 'extra_turn')) roles.add('循环');
  if (has('execute', 'kill', 'x_formula')) roles.add('终结');
  if (has('patch_card', 'upgrade_card', 'schedule', 'modify', 'card_rule', 'trigger')) roles.add('成长');
  if (has('apply_status', 'remove_status', 'discard', 'exhaust', 'end_turn', 'card_rule')) roles.add('控制');
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
  const conditional = { value: false };
  collect(value, { operations, targets, zones, triggers, resources, statuses, conditional });
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
    roles,
    complexity: values.length ? Math.round(values.reduce((sum, value) => sum + value.complexity, 0) / values.length) : 0,
  };
}
