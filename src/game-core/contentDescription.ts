import {
  COMPACT_EFFECT_BUNDLE_OPERATION_SET,
  compactEffectOperationKeys,
  normalizeCompactEffectEntries,
  projectCompactOperation,
  sortCompactBundleOperations,
} from './compactEffectContract';
import { resolveTriggerInput } from './triggerInput';

export interface CompactCardDescriptionOptions {
  includeKeywords?: boolean;
  statusNames?: Readonly<Record<string, string>>;
}

const TRIGGER_LABELS: Record<string, string> = {
  battle_start: '战斗开始',
  passive: '持续生效',
  ability_gain: '获得能力',
  turn_start: '回合开始',
  turn_end: '回合结束',
  card_played: '打出卡牌',
  attack_played: '打出攻击牌',
  skill_played: '打出技能牌',
  power_played: '打出能力牌',
  on_discard: '有卡牌被弃掉',
  on_exhaust: '消耗牌',
  on_draw: '抽牌',
  on_shuffle: '洗牌',
  take_damage: '受到伤害',
  take_heal: '受到治疗',
  deal_damage: '造成伤害',
  deal_heal: '造成治疗',
  lust_increase: '自身欲望增加',
  lust_decrease: '自身欲望降低',
  deal_lust_increase: '使敌方欲望增加',
  deal_lust_decrease: '使敌方欲望降低',
  gain_buff: '获得增益',
  gain_debuff: '获得减益',
  lose_buff: '失去增益',
  lose_debuff: '失去减益',
  enemy_gain_buff: '敌方获得增益',
  enemy_gain_debuff: '敌方获得减益',
  enemy_lose_buff: '敌方失去增益',
  enemy_lose_debuff: '敌方失去减益',
  gain_block: '获得格挡',
  lose_block: '失去格挡',
};

const STATUS_TRIGGER_LABELS: Record<string, string> = {
  apply: '首次获得',
  stack: '叠加',
  tick: '回合结束',
  remove: '移除',
  hold: '持续生效',
};

const ZONE_LABELS: Record<string, string> = {
  hand: '手牌',
  draw: '抽牌堆',
  discard: '弃牌堆',
  exhaust: '消耗堆',
  all: '全部牌区',
  deck: '抽牌堆',
};

const VARIABLE_LABELS: Array<[RegExp, string]> = [
  [/\bspent_energy\b/g, '使用能量'],
  [/\bturn_number\b/g, '当前回合数'],
  [/\bcards_played_this_turn\b/g, '本回合出牌数'],
  [/\battacks_played_this_turn\b/g, '本回合攻击牌数'],
  [/\bskills_played_this_turn\b/g, '本回合技能牌数'],
  [/\bstacks\b/g, '当前层数'],
  [/\bself\.hand_size\b/g, '手牌数'],
  [/\bself\.draw_pile_size\b/g, '抽牌堆数量'],
  [/\bself\.discard_pile_size\b/g, '弃牌堆数量'],
  [/\bself\.exhaust_pile_size\b/g, '消耗堆数量'],
  [/\bself\.max_hp\b/g, '自身最大生命'],
  [/\bself\.max_lust\b/g, '自身最大欲望'],
  [/\bself\.max_energy\b/g, '自身最大能量'],
  [/\bself\.hp\b/g, '自身生命'],
  [/\bself\.lust\b/g, '自身欲望'],
  [/\bself\.energy\b/g, '自身能量'],
  [/\bself\.block\b/g, '自身格挡'],
  [/\bopponent\.max_hp\b/g, '敌方最大生命'],
  [/\bopponent\.max_lust\b/g, '敌方最大欲望'],
  [/\bopponent\.max_energy\b/g, '敌方最大能量'],
  [/\bopponent\.hp\b/g, '敌方生命'],
  [/\bopponent\.lust\b/g, '敌方欲望'],
  [/\bopponent\.energy\b/g, '敌方能量'],
  [/\bopponent\.block\b/g, '敌方格挡'],
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function formula(value: unknown, options: CompactCardDescriptionOptions = {}): string {
  if (typeof value === 'number') return String(value);
  let text = typeof value === 'string' ? value.trim() : String(value ?? '');
  text = text.replace(
    /\b(self|opponent)\.status\.([A-Za-z0-9_]+)\.stacks\b/g,
    (_match, target: string, statusId: string) =>
      `${target === 'self' ? '自身' : '敌方'}${displayStatusName(statusId, options)}层数`,
  );
  for (const [pattern, label] of VARIABLE_LABELS) text = text.replace(pattern, label);
  return text;
}

/** Render a boolean expression as a readable condition instead of leaking code operators into player text. */
function condition(value: unknown, options: CompactCardDescriptionOptions = {}): string {
  let text = formula(value, options);
  text = text
    .replace(/\s*===?\s*/g, '等于')
    .replace(/\s*!==?\s*/g, '不等于')
    .replace(/\s*>=\s*/g, '不低于')
    .replace(/\s*<=\s*/g, '不高于')
    .replace(/\s*>\s*/g, '高于')
    .replace(/\s*<\s*/g, '低于')
    .replace(/\s*&&\s*/g, '且')
    .replace(/\s*\|\|\s*/g, '或');
  return text
    .replace(/((?:自身|敌方)[^且或高低等不]+?)\s*\/\s*2\b/g, '$1的一半')
    .replace(/使用能量等于0/g, '没有使用能量')
    .replace(/使用能量高于0/g, '使用了能量');
}

function targetPrefix(value: unknown, defaultTarget: 'self' | 'opponent'): string {
  const target = value === 'self' || value === 'opponent' ? value : defaultTarget;
  return target === 'self' ? '自身' : '敌方';
}

function selectionText(
  value: Record<string, unknown>,
  defaultPick: 'random' | 'choose',
  count: unknown,
  options: CompactCardDescriptionOptions,
): string {
  const zone = ZONE_LABELS[String(value.from ?? 'hand')] || String(value.from ?? '手牌');
  const pick = String(value.pick ?? defaultPick);
  if (pick === 'all' || count === 'all') return `${zone}中的所有牌`;
  const amount = formula(count ?? 1, options);
  const mode = pick === 'random' ? '随机' : pick === 'left' ? '最左侧' : pick === 'right' ? '最右侧' : '选择';
  return `${mode}${amount}张${zone}`;
}

function displayStatusName(id: unknown, options: CompactCardDescriptionOptions): string {
  const value = String(id);
  return options.statusNames?.[value]?.trim() || '未注册状态';
}

/** Keep internal IDs and formula paths out of player-facing AI prose. */
export function normalizeChinesePlayerDescription(value: unknown): string {
  if (typeof value !== 'string') return '';
  const text = value.trim();
  if (!text || /[A-Za-z_]/.test(text)) return '';
  return text;
}

/** Detect prose that merely repeats literal mechanic numbers already shown as effect tags. */
export function isMechanicalDescriptionRestatement(value: unknown): boolean {
  const text = normalizeChinesePlayerDescription(value);
  if (!text) return false;
  return /(?:造成|恢复|回复|获得|增加|减少|施加|移除|抽取?|弃掉|消耗|费用)[^。；，]{0,18}\d+(?:\.\d+)?(?:点|层|张|次|能量|生命|欲望|格挡|伤害)/.test(
    text,
  );
}

function describeSingleOperation(
  value: Record<string, unknown>,
  operation: string,
  templates: ReadonlyMap<string, string>,
  options: CompactCardDescriptionOptions,
): string {
  const amount = formula(value[operation], options);
  const target = targetPrefix(
    value.to,
    ['damage', 'lust', 'apply_status', 'remove_status'].includes(operation) ? 'opponent' : 'self',
  );
  let text = '';

  switch (operation) {
    case 'damage':
      text =
        target === '自身'
          ? `对自身造成${Number(value.hits) > 1 ? `${value.hits}次` : ''}${amount}点伤害`
          : `对敌方造成${Number(value.hits) > 1 ? `${value.hits}次` : ''}${amount}点伤害`;
      break;
    case 'heal':
      text = target === '自身' ? `恢复${amount}点生命` : `使敌方恢复${amount}点生命`;
      break;
    case 'block':
      text = target === '自身' ? `获得${amount}点格挡` : `使敌方获得${amount}点格挡`;
      break;
    case 'energy':
      text = target === '自身' ? `获得${amount}点能量` : `使敌方获得${amount}点能量`;
      break;
    case 'lust':
      text = target === '自身' ? `增加${amount}点欲望` : `使敌方增加${amount}点欲望`;
      break;
    case 'set_hp':
      text = `将${target}生命设为${amount}`;
      break;
    case 'set_lust':
      text = `将${target}欲望设为${amount}`;
      break;
    case 'set_energy':
      text = `将${target}能量设为${amount}`;
      break;
    case 'set_block':
      text = `将${target}格挡设为${amount}`;
      break;
    case 'narrate':
      text = String(value.narrate ?? '').trim();
      break;
    case 'apply_status':
      text = `向${target}施加${formula(value.stacks ?? 1, options)}层${displayStatusName(value.apply_status, options)}`;
      break;
    case 'remove_status': {
      const names: Record<string, string> = { all: '全部状态', buffs: '全部增益', debuffs: '全部减益' };
      text = `移除${target}的${names[String(value.remove_status)] || displayStatusName(value.remove_status, options)}`;
      break;
    }
    case 'draw':
      text = `抽${amount}张牌`;
      break;
    case 'scry':
      text = `查看抽牌堆顶${amount}张牌，可将任意张置入弃牌堆`;
      break;
    case 'seek':
      text = `从抽牌堆选择${amount}张牌加入手牌`;
      break;
    case 'discard':
      text = `弃掉${selectionText(value, 'random', value.discard, options)}`;
      break;
    case 'exhaust':
      text = `消耗${selectionText(value, 'random', value.exhaust, options)}`;
      break;
    case 'recover': {
      const zone = ZONE_LABELS[String(value.from ?? 'discard')] || String(value.from ?? '弃牌堆');
      const pick = String(value.pick ?? 'choose');
      text =
        pick === 'all' || value.recover === 'all'
          ? `将${zone}中的所有牌取回手牌`
          : pick === 'random'
            ? `从${zone}随机取回${amount}张牌`
            : `从${zone}选择${amount}张牌取回手牌`;
      break;
    }
    case 'reduce_cost':
      text = `使${selectionText(value, 'choose', value.count ?? 1, options)}费用降低${amount}`;
      break;
    case 'modify_card': {
      const stats: Record<string, string> = {
        damage: '伤害',
        block: '格挡',
        lust: '欲望',
        stacks: '状态层数',
      };
      const operator = ['add', 'subtract', 'multiply', 'divide'].find(key => value[key] !== undefined) || 'add';
      const verbs: Record<string, string> = {
        add: '增加',
        subtract: '减少',
        multiply: '乘以',
        divide: '除以',
      };
      text = `使${selectionText(value, 'choose', value.count ?? 1, options)}的${stats[String(value.modify_card)] || '数值'}${verbs[operator]}${formula(value[operator], options)}`;
      break;
    }
    case 'copy':
      text = `复制${selectionText(value, 'choose', value.copy, options)}到手牌`;
      break;
    case 'double':
      text = `使${selectionText(value, 'choose', value.double, options)}下次主效果执行两次`;
      break;
    case 'add_card': {
      const id = String(value.add_card);
      const cardName = templates.get(id) || id;
      const destination = value.to === 'deck' ? '抽牌堆' : '手牌';
      text = `将${formula(value.count ?? 1, options)}张${cardName}加入${destination}`;
      break;
    }
    case 'modify': {
      const subjects: Record<string, string> = {
        damage: `${target}造成的伤害`,
        damage_taken: `${target}受到的伤害`,
        lust: `${target}造成的欲望伤害`,
        lust_taken: `${target}受到的欲望伤害`,
        heal: `${target}的治疗量`,
        block: `${target}获得的格挡`,
      };
      const operator = ['add', 'subtract', 'multiply', 'divide', 'set'].find(key => value[key] !== undefined) || 'set';
      const verbs: Record<string, string> = {
        add: '增加',
        subtract: '减少',
        multiply: '乘以',
        divide: '除以',
        set: '设为',
      };
      text = `${subjects[String(value.modify)] || `${target}的未知属性`}${verbs[operator]}${formula(value[operator], options)}`;
      break;
    }
    case 'card_rule': {
      const scope = value.limit === 'all' ? '所有牌' : `前${formula(value.limit, options)}张牌`;
      text =
        value.card_rule === 'free'
          ? `每回合${scope}不消耗能量`
          : `每回合${scope}额外结算${formula(value.extra ?? 1, options)}次`;
      break;
    }
  }

  return text;
}

function describeEntry(
  value: Record<string, unknown>,
  templates: ReadonlyMap<string, string>,
  options: CompactCardDescriptionOptions,
): string {
  const operations = compactEffectOperationKeys(value);
  if (operations.length === 0) return '';
  if (operations.length > 1 && !operations.every(operation => COMPACT_EFFECT_BUNDLE_OPERATION_SET.has(operation))) {
    return '';
  }
  const texts = sortCompactBundleOperations(operations)
    .map(operation =>
      describeSingleOperation(projectCompactOperation(value, operation, false), operation, templates, options),
    )
    .filter(Boolean);
  if (texts.length !== operations.length) return '';
  let text = texts.join('，并');
  if (typeof value.when === 'string' && value.when.trim()) text = `当${condition(value.when, options)}时，${text}`;
  if (typeof value.on === 'string' && value.on.trim()) {
    text = `${TRIGGER_LABELS[value.on] || value.on}时，${text}`;
  }
  return text;
}

export function describeCompactEffectList(
  effects: unknown,
  creates?: unknown,
  options: CompactCardDescriptionOptions = {},
): string {
  const entries = normalizeCompactEffectEntries(effects);
  if (!entries) return '';
  const templates = new Map<string, string>();
  if (Array.isArray(creates)) {
    for (const entry of creates) {
      if (isRecord(entry) && typeof entry.id === 'string' && typeof entry.name === 'string') {
        templates.set(entry.id, entry.name.trim() || entry.id);
      }
    }
  }
  return entries
    .filter(isRecord)
    .map(effect => describeEntry(effect, templates, options))
    .filter(Boolean)
    .join('；');
}

function describeTriggeredEffectList(
  effects: unknown,
  creates: unknown,
  trigger: string,
  options: CompactCardDescriptionOptions,
): string {
  const entries = normalizeCompactEffectEntries(effects);
  if (!entries) return '';
  const defaultEffects: unknown[] = [];
  const overriddenEffects: unknown[] = [];
  for (const effect of entries) {
    if (isRecord(effect) && typeof effect.on === 'string') overriddenEffects.push(effect);
    else defaultEffects.push(effect);
  }
  const parts: string[] = [];
  const defaultText = describeCompactEffectList(defaultEffects, creates, options);
  if (defaultText) {
    parts.push(
      trigger === 'passive' ? `持续生效，${defaultText}` : `${TRIGGER_LABELS[trigger] || trigger}时，${defaultText}`,
    );
  }
  const overriddenText = describeCompactEffectList(overriddenEffects, creates, options);
  if (overriddenText) parts.push(overriddenText);
  return parts.join('；');
}

function describeCompactMain(value: Record<string, unknown>, options: CompactCardDescriptionOptions): string {
  const trigger = resolveTriggerInput(value);
  if (trigger.structured) {
    const immediate = describeCompactEffectList(trigger.immediateEffects, value.creates, options);
    const conditionalImmediate =
      immediate && value.when !== undefined ? `当${condition(value.when, options)}时，${immediate}` : immediate;
    const triggered =
      typeof trigger.trigger === 'string'
        ? describeTriggeredEffectList(trigger.triggeredEffects, value.creates, trigger.trigger, options)
        : '';
    return [conditionalImmediate, triggered].filter(Boolean).join('；');
  }
  const main =
    typeof trigger.trigger === 'string'
      ? describeTriggeredEffectList(value.effects, value.creates, trigger.trigger, options)
      : describeCompactEffectList(value.effects, value.creates, options);
  return main && value.when !== undefined ? `当${condition(value.when, options)}时，${main}` : main;
}

const DYNAMIC_VALUE_FIELDS = new Set([
  'damage',
  'heal',
  'block',
  'energy',
  'lust',
  'set_hp',
  'set_lust',
  'set_energy',
  'set_block',
  'stacks',
  'draw',
  'scry',
  'seek',
  'discard',
  'exhaust',
  'recover',
  'reduce_cost',
  'copy',
  'double',
  'count',
  'add',
  'subtract',
  'multiply',
  'divide',
  'set',
]);

function compactEffectsNeedRuleExplanation(effects: unknown): boolean {
  const entries = normalizeCompactEffectEntries(effects);
  if (!entries) return false;
  return entries.some(entry => {
    if (!isRecord(entry)) return false;
    if (typeof entry.when === 'string' && entry.when.trim()) return true;
    if (typeof entry.on === 'string' && entry.on.trim()) return true;
    return Object.entries(entry).some(([key, nested]) => {
      if (!DYNAMIC_VALUE_FIELDS.has(key) || typeof nested !== 'string') return false;
      const text = nested.trim();
      return text !== '' && text !== 'all' && !/^-?\d+(?:\.\d+)?$/.test(text);
    });
  });
}

function hasCompactEffects(effects: unknown): boolean {
  const entries = normalizeCompactEffectEntries(effects);
  return Boolean(entries?.some(isRecord));
}

/**
 * Simple literal effects are already clearer as UI tags. Only synthesize a rules
 * sentence when conditions, formulas or secondary programs would otherwise be hidden.
 */
export function needsCompactRuleDescription(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    (typeof value.when === 'string' && value.when.trim() !== '') ||
    typeof value.trigger === 'string' ||
    isRecord(value.trigger) ||
    compactEffectsNeedRuleExplanation(value.effects) ||
    compactEffectsNeedRuleExplanation(value.discard_effects) ||
    hasCompactEffects(value.discard_effects) ||
    (Array.isArray(value.creates) && value.creates.length > 0)
  );
}

/** Build player-facing rules for relics, items, abilities and other shallow effect definitions. */
export function describeCompactContent(value: unknown, options: CompactCardDescriptionOptions = {}): string {
  if (!isRecord(value)) return '';
  const main = describeCompactMain(value, options);
  return main ? `${main}。` : '';
}

export function describeCompactContentWhenNeeded(value: unknown, options: CompactCardDescriptionOptions = {}): string {
  return needsCompactRuleDescription(value) ? describeCompactContent(value, options) : '';
}

function mergeAuthoredAndRuleDescription(authored: string, rules: string): string {
  if (!authored) return rules;
  if (!rules) return authored;
  return `${authored.replace(/[。！？；]+$/u, '')}。${rules}`;
}

/** Keep creative prose, but always replace authored mechanical restatements with rules generated from executable data. */
export function resolveCompactContentDescription(
  value: unknown,
  options: CompactCardDescriptionOptions = {},
): string {
  if (!isRecord(value)) return '';
  const authored = normalizeChinesePlayerDescription(value.description);
  const narrative = authored && !isMechanicalDescriptionRestatement(authored) ? authored : '';
  const rules = describeCompactContentWhenNeeded(value, options);
  return mergeAuthoredAndRuleDescription(narrative, rules);
}

function describeStatusStackChange(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value > 0) return `回合结束后增加${formula(value)}层`;
    if (value < 0) return `回合结束后减少${formula(Math.abs(value))}层`;
    return '';
  }
  if (typeof value !== 'string') return '';
  const normalized = value.trim().toLowerCase();
  if (normalized === 'reset') return '回合结束后移除';
  const multiplier = normalized.match(/^x((?:\d+(?:\.\d+)?|\.\d+))$/);
  return multiplier ? `回合结束后层数乘以${multiplier[1]}并向下取整` : '';
}

/** Build player-facing status rules, including triggers, stun, decay and stack cap. */
export function describeCompactStatus(value: unknown, options: CompactCardDescriptionOptions = {}): string {
  if (!isRecord(value)) return '';
  const parts: string[] = [];
  if (value.stun === true) parts.push('持有时无法行动');
  if (isRecord(value.triggers)) {
    for (const trigger of ['hold', 'apply', 'stack', 'tick', 'remove']) {
      const effects = value.triggers[trigger];
      const text = describeCompactEffectList(effects, undefined, options);
      if (text) {
        parts.push(
          trigger === 'hold'
            ? `${STATUS_TRIGGER_LABELS[trigger]}，${text}`
            : `${STATUS_TRIGGER_LABELS[trigger]}时，${text}`,
        );
      }
    }
  }
  const stackChange = describeStatusStackChange(value.stacks_change);
  if (stackChange) parts.push(stackChange);
  const maxStacks = value.maxStacks;
  if (Number.isInteger(maxStacks) && Number(maxStacks) > 0) parts.push(`最多叠加${maxStacks}层`);
  if (parts.length === 0) parts.push('持续记录层数');
  return `${parts.join('；')}。`;
}

export function canGenerateCompactStatusDescription(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value.triggers !== undefined) {
    if (!isRecord(value.triggers)) return false;
    if (Object.values(value.triggers).some(effects => normalizeCompactEffectEntries(effects) === null)) return false;
  }
  return describeCompactStatus(value) !== '';
}

/** Build player-facing card rules from the same shallow fields the compiler validates. */
export function describeCompactCard(value: unknown, options: CompactCardDescriptionOptions = {}): string {
  if (!isRecord(value)) return '';
  const parts: string[] = [];
  if (options.includeKeywords !== false) {
    if (value.innate === true) parts.push('固有');
    if (value.retain === true) parts.push('保留');
    if (value.exhaust === true || value.type === 'Power') parts.push('消耗');
    if (value.ethereal === true) parts.push('空灵');
  }

  let main = describeCompactMain(value, options);
  if (main && value.type === 'Curse') main = `回合结束时，${main}`;
  if (main) parts.push(main);

  const discarded = describeCompactEffectList(value.discard_effects, value.creates, options);
  if (discarded) parts.push(`此牌被战斗效果弃掉后，${discarded}`);
  return parts.length > 0 ? `${parts.join('。')}。` : '';
}

export function describeCompactCardWhenNeeded(value: unknown, options: CompactCardDescriptionOptions = {}): string {
  if (!isRecord(value) || !needsCompactRuleDescription(value)) return '';
  const parts: string[] = [];
  const mainNeedsRule =
    (typeof value.when === 'string' && value.when.trim() !== '') ||
    typeof value.trigger === 'string' ||
    isRecord(value.trigger) ||
    compactEffectsNeedRuleExplanation(value.effects) ||
    (Array.isArray(value.creates) && value.creates.length > 0);
  if (mainNeedsRule) {
    let main = describeCompactMain(value, options);
    if (main && value.type === 'Curse') main = `回合结束时，${main}`;
    if (main) parts.push(main);
  }
  const discarded = describeCompactEffectList(value.discard_effects, value.creates, options);
  if (discarded) parts.push(`此牌被战斗效果弃掉后，${discarded}`);
  return parts.length > 0 ? `${parts.join('。')}。` : '';
}

/** Card-specific display description with authoritative conditional and discard rules. */
export function resolveCompactCardDescription(
  value: unknown,
  options: CompactCardDescriptionOptions = {},
): string {
  if (!isRecord(value)) return '';
  const authored = normalizeChinesePlayerDescription(value.description);
  const narrative = authored && !isMechanicalDescriptionRestatement(authored) ? authored : '';
  const rules = describeCompactCardWhenNeeded(value, options);
  return mergeAuthoredAndRuleDescription(narrative, rules);
}
