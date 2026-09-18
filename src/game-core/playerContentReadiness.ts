import { analyzeContentDefinition } from './contentAnalysis';
import { contentPathToBattlePath, validateContentPackContract, type ContentContractIssue } from './contentContract';
import type { ContentPack } from './contentPack';
import { assessDeckPlayability, type DeckPlayabilityAssessment } from './deckPlayability';
import { formatBoundedContentRepairPrompt } from './contentRepair';

export interface PlayerContentReadinessIssue {
  path: string;
  code: string;
  message: string;
}

export interface PlayerContentReadiness {
  ok: boolean;
  issues: PlayerContentReadinessIssue[];
  deck: DeckPlayabilityAssessment;
}

export interface InitialPlayerStateInput {
  emoji: unknown;
  hp: unknown;
  maxHp: unknown;
  lust: unknown;
  maxLust: unknown;
  level: unknown;
  exp: unknown;
}

const REPAIR_HINTS: Readonly<Record<string, string>> = {
  MISSING_DESIRE_VICTORY_ROUTE: '欲望是与 HP 并行的胜利路线。保留欲望主轴，补齐满溢到有效输出或终结的可执行链；辅助资源必须有开局可用的消费入口，不能靠未来奖励、删欲望牌或补普通攻击绕过。不得使用固定弱伤害兜底',
  INVALID_CURSE_COST: '诅咒牌必须省略 cost，不能用零费用代替',
  EMPTY_EFFECTS: '需要可执行效果的对象必须提供非空浅层 effects',
  MISSING_EFFECT_SOURCE: '补齐非空浅层 effects；欲望效果的操作不能写在对象顶层',
  INVALID_EFFECT: '每个 effects 项都必须是完整操作；hits 只能与 damage 位于同一项',
  INVALID_CARD_COUNT: 'copy/double 的值直接写数量或 all，来源和筛选字段与操作同级',
  INVALID_CARD_ID: 'add_card/ensure_card 的值直接写 creates 中已登记的模板 ID 字符串',
  UNKNOWN_CARD_TEMPLATE: '由 AI 按原机制补齐缺失模板；草稿模式登记到 registry.templates，运行时定义位置遵循当前契约。不得删除原有临时牌引用绕过校验',
  INVALID_STATUS: '状态瞬时触发直接写浅层效果；持续数值修饰只能写在 hold 的 modify 规则中',
  UNKNOWN_STATUS: '由 AI 按原机制完整登记被引用的状态 ID；草稿模式登记到 registry.statuses。不得删除原有状态引用绕过校验',
  SPENT_RESOURCE_NOT_ALLOWED: '只有当前卡 cost 实际包含同名资源时才能读取 spent_resource；否则读取当前资源池',
  X_RESOURCE_NOT_ALLOWED: '只有当前卡 cost 把同名资源写成 all 时才能读取 x_resource',
  INVALID_TRIGGER: 'trigger 必须有受支持的 on 和非空浅层 effects',
  MISSING_TRIGGER: '遗物或独立能力需要合法 trigger，不能只写说明文字',
  UNKNOWN_VARIABLE: '只能使用完整玩法契约列出的闭合变量白名单，不能机械添加 self./opponent. 前缀，也不能猜造近义变量。仅在事件、归属、时序与计数含义均等价时改写表达；必须保留原有效果、数值、目标与条件。没有等价合法实现时明确失败，不得删除条件或效果，也不得改写说明掩盖机制丢失',
  INVALID_EVENT_ORDINAL: 'ordinal 只用 first/first_n/nth/every_n；first 必须省略 n，first_n/nth/every_n 必须填写正整数 n。保留原触发含义，只删除或补齐对应的 n',
  CURRENT_CARD_REPLAY_NOT_ALLOWED: 'replay_current 只能位于当前正在结算的非 Power、非 Event 卡牌根 effects；遗物、能力、状态、trigger、discard_effects 与预约效果若要让之后的牌额外结算，必须改用 passive/hold 中的 card_rule:"replay"',
  MISSING_LUST_OVERFLOW_EFFECT: '保留已存在的欲望增量机制，并补齐对应的完整具名满溢效果（name 与非空浅层 effects）；不得删除欲望操作、改写说明或以固定弱兜底绕过。没有真实欲望增量时才可连同孤立效果一起省略',
};

function repairHintForIssue(issue: PlayerContentReadinessIssue): string | undefined {
  if (
    /\.(?:damage|damage_taken|lust_damage|lust_damage_taken|heal|block)_modifier(?:\.|$)/.test(issue.path)
  ) {
    return 'damage_modifier 等不是卡牌 effects 操作：本次伤害直接写 damage；持续修饰改为状态 triggers.hold 中的 {modify:"damage",add:有限数值}，卡牌只 apply_status';
  }
  if (/\.triggers\.(?:apply|stack|tick|remove)(?:\[|\.|$)/.test(issue.path)) {
    return '状态 apply/stack/tick/remove 只执行瞬时浅层效果且不再包 effects；持续数值修饰只能写在 hold（triggers.hold）';
  }
  return REPAIR_HINTS[issue.code];
}

const ISSUE_LABELS: Readonly<Record<string, string>> = {
  MISSING_DESIRE_VICTORY_ROUTE: '欲望卡组缺少击败敌人的兑现路径',
  INVALID_ID: 'ID 格式错误',
  DUPLICATE_ID: 'ID 重复',
  INVALID_NAME: '名称不能为空',
  INVALID_CARD_TYPE: '卡牌类型不受支持',
  INVALID_CARD_RARITY: '卡牌稀有度不受支持',
  INVALID_CARD_COST: '费用必须是非负整数、energy，或值为非负整数/“all”的资源费用对象',
  INVALID_CURSE_COST: '诅咒牌不能填写费用',
  INVALID_QUANTITY: '数量必须是 1 到 100 的整数',
  INVALID_BOOLEAN: '关键词开关必须是布尔值',
  INVALID_DISCARD_REQUIREMENT: '弃牌需求必须是 0 到 100 的整数',
  INVALID_EFFECT_SOURCE: 'effects 必须是浅层对象或数组',
  MISSING_EFFECT_SOURCE: '缺少 effects',
  MULTIPLE_EFFECT_SOURCES: '只能使用一种效果格式',
  MULTIPLE_DISCARD_EFFECT_SOURCES: '弃牌效果只能使用一种格式',
  MISSING_TRIGGER: '现代遗物或能力缺少 trigger',
  INVALID_TRIGGER: 'trigger 不受支持',
  ROOT_TRIGGER_REQUIRED: 'Power 必须至少包含真实触发能力，或施加至少一个已注册的持续状态',
  EMPTY_EFFECTS: 'effects 不能为空；可选内容若没有真实机制应整个省略',
  ONLY_MODIFIERS_ALLOWED: 'passive 与状态 hold 只能包含 modify 或 card_rule 持续规则',
  UNKNOWN_VARIABLE: '公式引用了不支持的变量',
  INVALID_EVENT_ORDINAL: '事件次序字段组合不合法',
  CURRENT_CARD_REPLAY_NOT_ALLOWED: 'replay_current 使用位置不合法',
  UNSUPPORTED_FORMULA: '公式写法不受支持',
  UNSUPPORTED_CONDITION: 'when 必须是会得到真/假的比较或逻辑条件，不能填写 true、数字或三元表达式',
  INVALID_CARD_PATCH: '卡牌补丁字段不合法',
  INVALID_CARD_PATCH_SCOPE: '卡牌补丁持续范围不合法',
  INVALID_CARD_PATCH_MATCH: '卡牌补丁匹配范围不合法',
  INVALID_CARD_VALUE_OPERATOR: '卡牌数值补丁需要且只能使用一种运算',
  UNKNOWN_STATUS: '引用了未注册状态',
  SPENT_RESOURCE_NOT_ALLOWED: '公式读取了当前卡未支付的资源',
  X_RESOURCE_NOT_ALLOWED: '公式读取了当前卡没有的资源 X 费用',
  INVALID_STATUS: '状态定义不合法',
  INVALID_ENTRY: '内容项必须是对象',
  INVALID_LIST: '内容集合必须是数组',
  INVALID_MAX_HP: '最大生命必须是大于 0 的有限数',
  INVALID_HP: '当前生命必须在 0 到最大生命之间',
  INVALID_MAX_LUST: '最大欲望必须是大于 0 的有限数',
  INVALID_LUST: '当前欲望必须在 0 到最大欲望之间',
  INVALID_LEVEL: '等级必须是正整数',
  INVALID_EXP: '经验必须是非负有限整数',
  INVALID_RESOURCE_COLLECTION: '自定义资源必须是数组',
  TOO_MANY_RESOURCES: '自定义资源数量过多',
  INVALID_RESOURCE_ENTRY: '自定义资源定义必须是对象',
  UNKNOWN_RESOURCE_FIELD: '自定义资源含不受支持字段',
  INVALID_RESOURCE_ID: '自定义资源 ID 不合法',
  DUPLICATE_RESOURCE_ID: '自定义资源 ID 重复',
  INVALID_RESOURCE_NAME: '自定义资源名称不能为空',
  INVALID_RESOURCE_EMOJI: '自定义资源 emoji 不能为空',
  INVALID_RESOURCE_VALUE: '自定义资源数值不合法',
  INVALID_RESOURCE_REFRESH: '自定义资源刷新规则不合法',
  MISSING_PLAYER_EMOJI: '缺少玩家战斗形象',
  EMPTY_DECK: '初始牌组不能为空',
  MISSING_LUST_OVERFLOW_EFFECT: '缺少对应欲望满溢效果',
};

function issueLabel(issue: Pick<PlayerContentReadinessIssue, 'code'>): string {
  return ISSUE_LABELS[issue.code] || '规则字段不符合浅层 effects 契约';
}

const DETAILED_ISSUE_CODES = new Set([
  'INVALID_STATUS',
  'INVALID_EFFECT',
  'INVALID_EFFECT_BUNDLE',
  'INVALID_EFFECT_SOURCE',
  'UNKNOWN_EFFECT',
  'UNKNOWN_FIELD',
  'UNSUPPORTED_CONDITION',
  'ROOT_TRIGGER_REQUIRED',
  'ONLY_MODIFIERS_ALLOWED',
  'INVALID_SUMMON_TAGS',
  'INVALID_CARD_FILTER',
  'MODIFIER_NOT_ALLOWED',
  'INVALID_CARD_PICK',
  'INVALID_CARD_ID',
  'UNKNOWN_CARD_TEMPLATE',
  'INVALID_CARD_ZONE',
  'UNKNOWN_VARIABLE',
  'INVALID_EVENT_ORDINAL',
  'CURRENT_CARD_REPLAY_NOT_ALLOWED',
  'SPENT_RESOURCE_NOT_ALLOWED',
  'X_RESOURCE_NOT_ALLOWED',
  'UNKNOWN_STATUS',
]);

function issueDetail(message: unknown): string {
  let detail = typeof message === 'string'
    ? message.trim().replace(/\s+/g, ' ').replace(/[；;]/g, '，').slice(0, 240)
    : '';
  if (!detail) return '';
  const unknownField = detail.match(/^Unknown (?:bundle )?field:\s*([A-Za-z_][A-Za-z0-9_]*)$/i);
  if (unknownField) return `该效果不允许字段 ${unknownField[1]}`;
  detail = detail
    .replace(/Effect must contain one operation plus optional to\/when fields/gi, '每个效果项必须只有一个主操作，可选字段只能按该操作契约填写')
    .replace(/Unknown compact effect:\s*([A-Za-z_][A-Za-z0-9_]*)/gi, '不支持的效果操作 $1')
    .replace(/Unsupported boolean CEL node:\s*ConditionalExpression/gi, 'when 不能使用三元表达式；把三元式写入 damage/block 等数值字段')
    .replace(/Unsupported boolean CEL node:\s*Literal/gi, 'when 不能只写 true、false 或数字；无条件效果应省略 when')
    .replace(/Unsupported variable:\s*([A-Za-z_][A-Za-z0-9_.-]*)/gi, '不支持的变量 $1')
    .replace(/不支持的变量路径:\s*([A-Za-z_][A-Za-z0-9_.-]*)/gi, '不支持的变量 $1')
    .replace(/status is not registered:\s*([A-Za-z_][A-Za-z0-9_-]*)/gi, '状态未注册: $1')
    .replace(/status trigger references an unregistered status:\s*([A-Za-z_][A-Za-z0-9_-]*)/gi, '状态触发器引用未注册状态: $1')
    .replace(/n is only valid with (?:first_n\/)?nth\/every_n/gi, 'ordinal 为 first 或省略时不能填写 n')
    .replace(/(?:first_n\/)?nth\/every_n require a positive integer n/gi, 'ordinal 为 first_n/nth/every_n 时必须填写正整数 n')
    .replace(/This operation must remain a separate effect object/gi, '该操作必须单独占一个 effects 数组项')
    .replace(/Only common numeric, status, and draw effects may share one object; use separate array entries for other operations/gi, '只有基础数值、状态和抽牌操作可以安全合并；其他操作必须拆成数组项');
  return detail;
}

function portableIssue(issue: ContentContractIssue): PlayerContentReadinessIssue {
  const label = issueLabel(issue);
  const detail = DETAILED_ISSUE_CODES.has(issue.code) ? issueDetail(issue.message) : '';
  // New compiler codes can reach readiness before this presentation layer has
  // a tailored Chinese label. Do not collapse that evidence into the generic
  // effects-contract sentence: the bounded repair coordinator needs the same
  // stable code and concrete compiler reason that identified the bad leaf.
  const fallbackDetail = !detail && !ISSUE_LABELS[issue.code] ? issueDetail(issue.message) : '';
  return {
    path: contentPathToBattlePath(issue.path),
    code: issue.code,
    message: detail && detail !== label
      ? `${label}（具体原因：${detail}）`
      : fallbackDetail
        ? `${label}（校验代码：${issue.code}，具体原因：${fallbackDetail}）`
        : label,
  };
}

/** Validate player-owned content from the first AI response before opening the run. */
export function assessInitialPlayerContent(
  pack: ContentPack,
  player?: InitialPlayerStateInput,
): PlayerContentReadiness {
  const playerPack: ContentPack = {
    ...pack,
    enemy: null,
    desireEffects: { player: pack.desireEffects.player, enemy: null },
  };
  const contract = validateContentPackContract(playerPack, { requireExecutable: true, requireVictoryRoute: true });
  const issues = contract.ok ? [] : contract.issues.map(portableIssue);
  const deck = assessDeckPlayability(
    pack.cards.map(card => ({
      type: card && typeof card === 'object' ? card.type : undefined,
      cost: card && typeof card === 'object' ? card.cost : undefined,
      quantity: card && typeof card === 'object' ? card.quantity : undefined,
      analysis: card && typeof card === 'object' ? analyzeContentDefinition(card) : null,
    })),
  );

  const addDeckIssue = (code: string): void => {
    issues.push({ path: 'battle.cards', code, message: issueLabel({ code }) });
  };
  const addIssue = (path: string, code: string): void => {
    issues.push({ path, code, message: issueLabel({ code }) });
  };
  if (player) {
    if (typeof player.emoji !== 'string' || !player.emoji.trim()) {
      addIssue('battle.core.emoji', 'MISSING_PLAYER_EMOJI');
    }
    const maxHp = typeof player.maxHp === 'number' ? player.maxHp : Number.NaN;
    const hp = typeof player.hp === 'number' ? player.hp : Number.NaN;
    const maxLust = typeof player.maxLust === 'number' ? player.maxLust : Number.NaN;
    const lust = typeof player.lust === 'number' ? player.lust : Number.NaN;
    if (!Number.isFinite(maxHp) || maxHp <= 0) addIssue('battle.core.max_hp', 'INVALID_MAX_HP');
    if (!Number.isFinite(hp) || hp < 0 || hp > maxHp) addIssue('battle.core.hp', 'INVALID_HP');
    if (!Number.isFinite(maxLust) || maxLust <= 0) addIssue('battle.core.max_lust', 'INVALID_MAX_LUST');
    if (!Number.isFinite(lust) || lust < 0 || lust > maxLust) addIssue('battle.core.lust', 'INVALID_LUST');
    if (player.level !== undefined && (!Number.isInteger(player.level) || Number(player.level) < 1)) {
      addIssue('battle.level', 'INVALID_LEVEL');
    }
    if (player.exp !== undefined && (!Number.isInteger(player.exp) || Number(player.exp) < 0)) {
      addIssue('battle.exp', 'INVALID_EXP');
    }
  }
  if (deck.deckQuantity === 0) addDeckIssue('EMPTY_DECK');

  return { ok: issues.length === 0, issues, deck };
}

export function formatPlayerContentReadiness(readiness: PlayerContentReadiness, limit = 3): string {
  if (readiness.ok) return '初始战斗内容已就绪';
  const shown = readiness.issues.slice(0, limit).map(issue => `${issue.path}：${issue.message}`);
  if (readiness.issues.length > limit) shown.push(`另有 ${readiness.issues.length - limit} 处`);
  return shown.join('；');
}

/** Build a bounded repair request without echoing untrusted AI field values. */
export function formatPlayerContentRepairPrompt(readiness: PlayerContentReadiness, limit = 8): string {
  if (readiness.ok) return '';
  const hints = readiness.issues
    .map(repairHintForIssue)
    .filter((hint, index, values): hint is string => !!hint && values.indexOf(hint) === index)
    .slice(0, 5);
  return [
    formatBoundedContentRepairPrompt('[战斗内容修复]', readiness.issues, limit),
    ...(hints.length > 0 ? [`约束=${hints.join('；')}`] : []),
    '任务=一次修正上列全部不可执行结构；保留所有合法内容，不得用空数组、占位值或整套重建绕过错误。只有卡组为空时才创建与本次开局一致的可执行初始牌组；遗物、道具、欲望效果、攻防恢复配比和卡组规模都属于自由设计，未出现不算结构错误。',
    '仅输出世界书规定的一个完整变量更新块；禁止Markdown、代码围栏、YAML块标记或任何块外文字。',
  ].join('\n');
}
