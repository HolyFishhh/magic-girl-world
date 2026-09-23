import { builtinStatusReferenceContract } from './builtinStatusCatalog';
import { INTERCEPTION_SCHEMA } from './interception';
import { STATUS_DEFENSE_SCHEMA } from './statusDefense';
import { createOpeningDeckTransformsSchema, OPENING_TRANSFORM_GUIDANCE } from './towerOpeningTransforms';
import { INITIAL_CARD_REFERENCE_SCHEMA } from './initialCardReference';
import { DAMAGE_PROTECTION_SCHEMA } from './damageProtection';
import { CHARACTER_EMOJI_SCHEMA } from './characterAppearance';
import { towerGameplayDesignGuidance } from './towerGameplayGuidance';
import { towerEventToneGuidance } from './towerMystery';
import { formatCompactEffectProtocol } from './authoredEffectProtocol';
import { semanticPreservationContract } from './semanticPreservationContract';
import { isBattleRunNode, type RunNodeKind } from './runState';
import {
  enforceBattleRewardBudget,
  formatBattleRewardBudget,
  formatShopBudget,
  recommendShopBudget,
  recommendTowerBattleRewardBudget,
  type BattleRewardBudget,
  type ShopBudget,
} from './contentBudget';
import { planTowerOpeningOutcome } from './towerOpeningOutcome';
import { planTowerEventOutcome } from './towerEventOutcome';
import { parseTowerEventFlow } from './towerEventFlow';
import { aiSchemaRef, withAiContentDefinitions, withAiContentDefinitionsSubset } from './aiContentJsonSchema';
import {
  ABILITY_TRIGGERS,
  REGISTERABLE_EFFECT_TRIGGERS,
  STATUS_EVENT_TRIGGERS,
  STATUS_TRIGGERS,
} from './battleTriggers';
import { BATTLE_EVENT_KINDS } from './battleEventJournal';
import { jsonrepair } from 'jsonrepair';
import { assertNoInventedJsonValues, assertUnambiguousObjectJson } from './jsonObjectIntegrity';
import { createLiteralEffectSequenceSchema } from './authoredLiteralEffects';
import { formatTowerRepairDefinitionContext } from './towerRepairContext';
import { initialDeckAuthoringGuidance } from './initialDeckAuthoringGuidance';
import { createTowerEncounterPlan, formatTowerEncounterPlan } from './towerEncounterPlan';

export const TOWER_NODE_RESULT_SPEC = 'mwg.tower-node-result/v1' as const;
export const TOWER_NODE_BATCH_RESULT_SPEC = 'mwg.tower-node-batch-result/v1' as const;
export const TOWER_OPENING_RESULT_SPEC = 'mwg.tower-opening-result/v1' as const;
export const TOWER_NODE_RESULT_TAG = 'TOWER_NODE_RESULT' as const;
export const TOWER_NODE_BATCH_RESULT_TAG = 'TOWER_NODE_BATCH_RESULT' as const;
export const TOWER_OPENING_RESULT_TAG = 'TOWER_OPENING_RESULT' as const;

export interface TowerGenerationJobDescriptor {
  nodeId: string;
  requestId: string;
  basedOnRevision: number;
  kind: RunNodeKind;
  act: number;
  floor: number;
  contentSeed: number;
  rewardSeed: number;
  difficultyMultiplier: number;
  shopMemoryCards?: Record<string, any>[];
}

export interface TowerGenerationContext {
  /** Authoritative gameplay facts, with program-only map/cache/schema data removed. */
  completeMvuContext?: string;
  /** Compact exact-ID registry repeated near the final output check. */
  contentReferenceContext?: string;
  worldContext?: string;
  playerContext?: string;
  deckBalanceContext?: string;
  enemyBudgetEnvelope?: import('./encounterBalance').EnemyBudgetEnvelope;
  enemyBudgets?: Record<string, import('./encounterBalance').EnemyBudgetEnvelope>;
  enemyLineageContext?: string;
  customRequirements?: string;
  difficultyPercent: number;
}

export interface TowerNodeResult {
  spec: typeof TOWER_NODE_RESULT_SPEC;
  node_id: string;
  request_id: string;
  based_on_revision: number;
  kind: RunNodeKind;
  title: string;
  narrative: string;
  payload: Record<string, unknown>;
  reward?: Record<string, unknown>;
  /** Program-authored after parsing; model output is never trusted for this field. */
  program_balance?: TowerProgramBalanceAudit;
  program_reward_seed?: number;
  program_shop_memory_ids?: string[];
}

export interface TowerNodeBatchResult {
  spec: typeof TOWER_NODE_BATCH_RESULT_SPEC;
  batch_id: string;
  based_on_revision: number;
  results: TowerNodeResult[];
}

export type TowerNodeBatchEntry =
  { nodeId: string; ok: true; result: TowerNodeResult } | { nodeId: string; ok: false; error: string };

/** Internal assessment, never an AI wire response or an activation bypass. */
export interface TowerNodeBatchInspection {
  batchId: string;
  basedOnRevision: number;
  entries: TowerNodeBatchEntry[];
}

export interface TowerProgramBalanceAudit {
  [key: string]: unknown;
  spec: string;
  winnableAtCurrentResources?: boolean;
  modelRepairUsed: boolean;
}

export interface TowerOpeningResult {
  spec: typeof TOWER_OPENING_RESULT_SPEC;
  request_id: string;
  based_on_revision: number;
  title: string;
  narrative: string;
  choices: Array<{
    id: string;
    label: string;
    description?: string;
    outcome: Record<string, unknown>;
  }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function boundedText(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maximum;
}

function requiredTextValue(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function requireDifficulty(value: number): number {
  if (!Number.isFinite(value) || value < 10 || value > 200) throw new Error('tower difficulty percent is invalid');
  return Math.round(value * 10) / 10;
}

function compactContext(value: string | undefined, maximum: number): string | null {
  const text = String(value || '').trim();
  return text ? text.slice(0, maximum) : null;
}

/** Player-authored generation requirements are authoritative and must never be
 * shortened as a performance optimization. Only derived/repeated context uses
 * `compactContext` limits. */
function completeRequirementContext(value: string | undefined): string | null {
  const text = String(value || '').trim();
  return text || null;
}

type TowerNodeScope = Pick<TowerGenerationJobDescriptor, 'nodeId' | 'requestId' | 'basedOnRevision' | 'kind'> &
  Partial<Pick<TowerGenerationJobDescriptor, 'act' | 'floor' | 'contentSeed' | 'rewardSeed' | 'shopMemoryCards'>>;

function battleRewardBudgetFor(scope: TowerNodeScope): BattleRewardBudget {
  if (!isBattleRunNode(scope.kind)) throw new Error('tower reward budget requires a battle node');
  return recommendTowerBattleRewardBudget({
    nodeId: scope.nodeId,
    kind: scope.kind as 'battle' | 'elite' | 'boss',
    act: scope.act ?? 1,
    floor: scope.floor ?? 1,
    rewardSeed: scope.rewardSeed,
  });
}

function shopRewardBudgetFor(scope: TowerNodeScope): ShopBudget {
  if (scope.kind !== 'shop') throw new Error('tower shop reward budget requires a shop node');
  const budget = recommendShopBudget({
    act: scope.act ?? 1,
    actCount: 3,
    floor: scope.floor ?? 1,
    floorsPerAct: 16,
    kind: 'shop',
    danger: 0,
  });
  return { ...budget, cards: budget.cards - Math.min(2, scope.shopMemoryCards?.length ?? 0) };
}

function resultContractFor(scope: TowerNodeScope, envelope?: import('./encounterBalance').EnemyBudgetEnvelope): string {
  const { kind } = scope;
  if (isBattleRunNode(kind)) {
    const budget = battleRewardBudgetFor(scope);
    const artifacts = budget.artifacts?.candidates ?? 0;
    const items = budget.items?.candidates ?? 0;
    return [
      formatTowerEncounterPlan(scope, envelope),
      'payload 必须包含 battle；有程序遭遇计划时，只能使用计划指定数量的 enemies 数组；无计划的旧请求兼容 enemy。reward 必须存在并预先给出本场胜利候选。',
      '爬塔没有经验值和等级成长；不得生成、修改或以任何叙事奖励形式承诺 level 或 exp。',
      `本节点奖励预算固定为：${formatBattleRewardBudget(budget, { includeExperience: false })}。`,
      `reward 必须使用单数键并完整写成 {card:[恰好${budget.cards.candidates}个卡牌对象],artifact:[恰好${artifacts}个遗物对象],item:[恰好${items}个道具对象],limits:{"cards":${budget.cards.pick},"artifacts":${budget.artifacts?.pick ?? 0},"items":${budget.items?.pick ?? 0}}}。card/artifact/item 三个字段始终都是数组；0 项必须逐字写成空数组 []，绝不能写数字 0、null 或空对象。禁止增加或省略候选，也不要把复数 cards/artifacts/items 与单数键混用。`,
      '节点 reward 与 payload 同级，不能放进 payload.battle 或 payload.reward。预算中的 gold 仅供程序结算，禁止生成 gold 或 gold_claimed，也不能从当前 MVU 奖励池复制这两个字段；它们不是 AI 可指定的奖励。敌人独立 defeat_reward.gold 与事件 outcome.gold 是不同作用域的合法收益，不得因此删除或改写。',
      'reward 不得复制当前 reward 的 request、disabled_categories、pool_revision、reroll_count 等程序运行字段。同一奖励中每个候选 id 必须唯一；已有非唯一卡的名称、类型、费用和可执行规则完全相同时可复用当前稳定 id、名称和完整定义，并用 quantity 表示副本。规则不同、遗物或道具不得复用当前内容 id；它们必须是新的候选。',
      '已有玩家欲望效果时，允许额外给出 payload.desire_growth:{effect:完整命名欲望效果,statuses?:新状态定义数组}，作为胜利后持久增强或机制深化；不降低多回合积累的兑现收益，不改触发归属，不覆盖共享状态，不减少普通奖励。入战只暂存，胜利才应用；无成长则省略，无欲望效果构筑不生成。',
    ].join('');
  }
  if (kind === 'event')
    return (
      towerEventToneGuidance(scope.rewardSeed ?? 0) +
      'payload 必须包含 event。兼容旧格式 event.choices（2–6 项）；递进事件使用 {spec:"mwg.tower-event/v2",start_stage,stages}，每个 stage 至少一项 choices，choice.next_stage 只能指向预先给出的后续 stage，阶段图必须有限且无循环。每项含稳定 id、中文 label 与结构化 outcome。outcome 可写 outcome、hp、max_hp、lust、max_lust、gold、card_removals、resources、reward、gain_cards、cost、deck_actions、grant；结果、成本、卡牌和替换牌均在本次请求中完整预生成。cost 是先验支付，数值可以为 0；只有当前确实可支付时才能选择。gain_cards 为必定获得的完整卡牌数组；grant 是预生成候选及 limits 的 x 选 y，limits 不得超过候选数。deck_actions 只表达预生成的永久牌组操作，不能把删牌额度当作已删牌。outcome.resources 只用于增减玩家当前已注册的自定义资源，固定写成 {"资源ID":整数变化量}。事件奖励只放在对应 outcome.reward，使用 cards、artifacts、items 与 limits；事件节点顶层不写 reward。'
    );
  if (kind === 'shop') {
    const budget = shopRewardBudgetFor(scope);
    return [
      'payload 必须包含 shop；reward 必须存在并作为直接商品候选池，价格由程序结算，AI 不写 price、gold 或货币公式。',
      `本商店由你新生成的商品数量固定为 ${formatShopBudget(budget)}。`,
      scope.shopMemoryCards?.length
        ? `程序另行补入旧候选卡：${scope.shopMemoryCards.map(card => card.name + '（' + card.id + '）').join('、')}。不要重新生成这些牌或占用新卡名额。`
        : '当前没有可复用旧候选，由你补足这批商品。',
      `reward 只使用复数键并完整写成 cards=${budget.cards}项、artifacts=${budget.artifacts}项、items=${budget.items}项、limits={"cards":${budget.cards},"artifacts":${budget.artifacts},"items":${budget.items}}。`,
      '不得使用单数 card/artifact/item，也不得在 reward 中写 choices、outcome、gold、price 或程序运行字段；商品全部同时展示，由程序根据金币和 limits 处理购买。',
    ].join('');
  }
  if (kind === 'treasure')
    return 'payload 必须包含 treasure；reward 必须固定写成 {cards:[],artifacts:[恰好3个遗物对象],items:[],limits:{cards:0,artifacts:1,items:0}}。宝箱只提供遗物三选一，绝不提供卡牌、消耗道具、金币或事件选项；遗物只能放 artifacts，绝不能把 type:"Relic" 的对象塞进 cards。不得使用单数 card/artifact/item，也不得写 choices、outcome、gold、price 或程序运行字段；宝箱候选直接展示并由程序结算，不是事件选择。';
  return 'payload 必须包含 rest；只写简短休整情境，恢复、升级、删卡等操作由程序提供。';
}

/**
 * `generateRaw` intentionally does not inherit the story preset or lorebook.
 * Keep the public AI grammar beside every structured worker request so models
 * never have to infer a generic `{ operation, target, amount }` vocabulary.
 * This is a syntax contract only: themes, mechanics and numbers remain free.
 */
export function formatCompactEffectAuthoringContract(placement: 'runtime' | 'initial-draft' = 'runtime'): string {
  return formatCompactEffectProtocol(placement);
}

/**
 * Highlight the grammar fragments most relevant to the concrete failing
 * paths. This is an error-focused repair guide: callers pair it with the exact
 * rejected source, path-scoped preservation, the provider schema, and final
 * authoritative validation. Node repair flows may additionally include the
 * full gameplay contract when their broader payload requires it.
 */
export function formatCompactEffectRepairContract(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error || '');
  const isTowerRewardStatusError =
    /(?:tower reward (?:cards|artifacts|items) is invalid|opening\.choices|开局馈赠)[^;；\n]*(?:UNKNOWN_STATUS|引用了未注册状态|状态未注册|unregistered status)/i.test(
      detail,
    );
  const numericPoolMisreadAsStatus = detail
    .match(
      /(?:unregistered status|未注册状态|状态未注册)\s*[：:]?\s*(block|energy|hp|max_hp|lust|max_lust|max_energy)\b/i,
    )?.[1]
    ?.toLowerCase();
  const statusEventTrigger = STATUS_EVENT_TRIGGERS.find(trigger =>
    new RegExp(`triggers\\.${trigger}(?:\\b|[：:])`, 'i').test(detail),
  );
  const lines = [
    '[局部 effects 快速修复契约]',
    semanticPreservationContract(),
    '这是快速字段修复：直接按报错逐项机械修正，不重新构思题材、流派或数值，也不需要展开长推理。',
    '逐条修正 VALIDATION_ERROR 指向的路径；未报错字段原样保留。每个 effects 项直接写 {操作名:值,该操作允许的同级字段}，禁止 operation/target/value/source 通用对象。',
    'trigger 只能写在卡牌、遗物、能力或召唤能力的根部，不得把 trigger 塞进 effects 数组项。',
    'damage/heal/block/energy/lust 的值只能是有限数值或受支持的公式字符串；状态只写 {apply_status:"状态ID",stacks?:层数,to?:目标}。',
    'when 只写会得到真/假的比较或 &&/||/! 条件；无条件效果省略 when，禁止 true、数字、自然语言和三元式。数值三元式直接写进 damage/block 等操作值。',
  ];
  if (/tick_timing/i.test(detail)) {
    lines.push(
      '报错状态的 tick_timing 只能省略（默认 before_action）或精确写为 "before_action"、"after_action"。它只决定 triggers.tick 围绕持有者本次行动的前后，不能改写为 turn_start/turn_end，也不改变 stacks_change 每回合末仅衰减一次。只修正这个字段，保留原 tick 效果、目标和状态寿命。',
    );
  }
  if (
    /(?:stacks_change[^;；\n]*(?:无效|invalid|unsupported)|(?:无效|invalid|unsupported)[^;；\n]*stacks_change)/i.test(
      detail,
    )
  ) {
    lines.push(
      '报错状态的 stacks_change 只接受有限数字、"keep"、"reset" 或形如 "x0.5" 的非负倍率字符串，禁止 decrement/decay/subtract:1 等自然语言别名。必须依据该状态现有 description 保持寿命语义：每回合减少 1 层写 stacks_change:-1；回合末全部清除写 "reset"；不自动变化写 "keep" 或省略；按倍率保留写合法的 "x倍率"。只修正这个语法值，不改状态效果、层数上限或剧情含义。',
    );
  }
  if (
    /(?:状态定义不合法|候选 status(?:es)?(?:\[\d+\])? 无效|candidate status definition|status definition is invalid)/i.test(
      detail,
    )
  ) {
    lines.push(
      `报错触及一个完整状态定义，必须同时复核该状态的全部字段，而不只修第一条：根对象只用 id/name/emoji/description/type/stacks_change/tick_timing/maxStacks/tags/stun/character_emoji/protection/defense/intercepts/triggers/creates；保留合法 creates 模板及其触发器引用，不得为修复其他字段而删除造牌机制。type 只用 buff/debuff/neutral；stacks_change 只用有限数字、"keep"、"reset" 或 "x倍率"；tick_timing 仅可省略（默认 before_action）、before_action 或 after_action。triggers 键只用 ${STATUS_TRIGGERS.join('/')}；hold 只放持续 modify/card_rule，其他触发键只放一次性浅层 effects。hold 的 modify 只允许 damage/damage_taken/lust/lust_taken/heal/block/summon_capacity/draw_per_turn。actions_per_activation 只能由一次性的 modify_summon 修改，不是状态持续 modifier；不得用一次性强化替代持续规则、删除原状态施加或修改说明掩盖寿命差异。仅当原机制本来就是一次性修改，且指定修复范围允许保持原事件、目标、次数与寿命时，才可等价迁移；否则保留失败。所有 apply_status/apply_summon_status 引用必须由本候选 statuses 依赖闭包或已有状态库完整登记。`,
    );
  }
  const unknownFields = [...detail.matchAll(/([^;；\n]+?):\s*Unknown field:\s*([A-Za-z_][A-Za-z0-9_]*)/gi)];
  for (const match of unknownFields.slice(0, 8)) {
    lines.push(
      `路径 ${match[1].trim()} 不允许字段 ${match[2]}：必须从该路径删除 ${match[2]}，不得原样返回。若 ${match[2]} 承载机制语义，改用完整契约中对应的公开操作或字段；找不到等价写法时保留失败；只有删除后不改变机制的技术冗余字段才可直接移除。`,
    );
  }
  const forbiddenFields = [
    ...detail.matchAll(/([^;；\n]+?)[：:][^;；\n]*?该效果不允许字段\s+([A-Za-z_][A-Za-z0-9_]*)/gi),
  ];
  for (const match of forbiddenFields.slice(0, 8)) {
    lines.push(
      `路径 ${match[1].trim()} 不允许字段 ${match[2]}：必须删除该字段，不得原样返回。若它位于 creates 模板，模板数量由 add_card.count/ensure_card.minimum 决定，模板本身不写 quantity、tags 或 innate。`,
    );
  }
  if (
    /\.(?:discard|exhaust|recover|copy|double|remove_card)[：:][^;；\n]*(?:规则字段不符合|INVALID_EFFECT|unsupported)/i.test(
      detail,
    )
  ) {
    lines.push(
      '逐字检查报错牌区操作所在的同一个效果对象：当 discard/exhaust/recover/copy/double/remove_card 的操作值是数字 N 时，pick 绝不能是 "all"；保留 N，并按原描述使用 random、choose 或合法位置选择，描述没有明确随机/位置时使用 pick:"choose"。只有操作值本身就是字符串 "all" 时才能使用 pick:"all"。不得只修同数组里的其他效果后把这条报错原样返回。',
    );
  }
  if (/creates(?:\[\d+\])?\.quantity|unsupported content field:\s*quantity/i.test(detail)) {
    lines.push(
      'creates 中的是临时牌模板，不是玩家持有卡牌：必须删除模板内的 quantity；生成份数只由引用该模板的 add_card.count 或 ensure_card.minimum 决定。player.cards 自身的 quantity 必须保留，不能把两种容器混淆。',
    );
  }
  if (
    /(?:creates\[\d+\]|template\([^)]*\))[^;；\n]*(?:Only Power templates can register a trigger|只有 Power|trigger)|Only Power templates can register a trigger/i.test(
      detail,
    )
  ) {
    lines.push(
      '报错对象是 creates 中的临时牌模板：只有 type:"Power" 的模板可以写根 trigger，Attack/Skill/Event/Curse 模板必须删除 trigger。不能为了保留一个不受支持的 on_draw 等触发而把负面牌、攻击牌或技能牌擅自改成 Power；应按原本可执行部分保留根 effects/discard_effects/关键词，无法由卡牌公开时机等价表达时保留失败，不删除触发收益或通过改写 description 降级机制。模板绝不能嵌套 creates，也不能用 add_card/ensure_card 生成自己。',
    );
  }
  if (
    /battle\.(?:cards|artifacts|items)\[\d+\]\.status(?:es)?[^;；\n]*(?:unsupported content field|规则字段不符合)/i.test(
      detail,
    )
  ) {
    lines.push(
      '初始已持有的 player.cards/artifacts/items 不能携带奖励候选专用的 status/statuses 外壳。若其中是完整定义且该内容确实引用它们：把全部定义原样移动到全局 player.statuses，并从持有内容删除两种外壳；若 player.statuses 已有同 ID 同定义则只删除重复外壳。不要删除内容中的状态引用，也不要改状态机制。只有尚未领取的奖励候选才可在自身同级携带 statuses。',
    );
  }
  if (/spawn_summon\.slot|INVALID_SUMMON_SLOT|summon slot must be stable English|召唤槽必须是稳定英文/i.test(detail)) {
    lines.push(
      'spawn_summon.slot 是召唤物在所属阵营内的稳定英文槽位 ID，不是数组下标或数量；只能写以字母或下划线开头的字符串，例如 slot_0，绝不能写数字 0。修复时把数字 N 机械改成字符串 "slot_N"，并对同一召唤定义及其 selector 中引用该槽位的地方保持完全相同的字符串；不得删除召唤或改动其数值。',
    );
  }
  if (
    /候选 status 必须是一个状态定义对象|候选 statuses|candidate status must be a status definition object|status(?:es)?\s*:\s*null/i.test(
      detail,
    )
  ) {
    lines.push(
      '奖励候选的 statuses 是可选的新状态定义数组，不是固定占位字段。逐项扫描全部 cards/artifacts/items：null、空数组、字符串、非法对象或未被该候选直接或经状态依赖链引用的定义都必须移除；绝不能为普通数值内容凭空编造状态。只有候选确实引用了当前游戏事实中尚未登记的新状态时，才在该候选同级写非空 statuses:[完整定义...]；旧单个 status 仅用于兼容输入，修复输出统一改用 statuses。',
    );
  }
  if (
    /(?:effects|discard_effects|triggers?)[^;；\n]*\.(?:options|count)[^;；\n]*(?:规则字段不符合|INVALID_CHOICE_(?:OPTIONS|COUNT)|choose requires|choice count)|choose requires|choice count/i.test(
      detail,
    )
  ) {
    lines.push(
      'choose/options 表示预先写好的不同效果分支：options 至少 1 项、每项有唯一稳定英文 id、非空 label 与非空浅层 effects；count 省略为 1，写出时必须是 1 到 options 数量的整数。若原描述实际是“从某个牌区选择一张牌去弃掉、取回、复制、强化或自动打出”，它不是效果分支选择：删除整个 choose/options 外壳，按原动作改成对应牌区操作，并同级写 from、pick:"choose"、数量与原筛选；例如“从手牌选择一张技能牌免费打出”写 {auto_play:1,from:"hand",pick:"choose",card_type:"Skill",free:true}。若原结构只有一个固定 option 且没有选牌语义，移除无意义的 choose 外壳并把该 option 的 effects 原样放回当前位置。',
    );
  }
  if (
    /card_rule[^;；\n]*\.when|(?:passive|triggers\.hold)[^;；\n]*when[^;；\n]*(?:该效果不允许字段|Unknown field)|trigger\.effects(?:\[\d+\])?\.when[^;；\n]*(?:该效果不允许字段|Unknown field)/i.test(
      detail,
    )
  ) {
    lines.push(
      'card_rule 是持续规则，不接受 when 或 on。若 when 只是检查一个状态是否存在，把同一条 card_rule 原样移动到该状态定义的 triggers.hold，并删除 when；由 apply_status/remove_status 和 stacks_change 决定规则何时存在。若卡牌根 effects 已在打出时施加该状态，必须保留这项施加效果。不要直接删除条件后把原本有条件的规则扩大为永久无条件生效，也不要把持续规则塞进 turn_start 等一次性触发。',
    );
  }
  if (/battle\.cards\[\d+\]\.quantity|数量必须是 1 到 100 的整数|player\.cards[^\n]*quantity/i.test(detail)) {
    lines.push(
      'player.cards 是玩家当前真实拥有的牌，quantity 必须是 1..100 的整数；quantity:0 表示实际未拥有，必须从 player.cards 删除整个该卡对象，不能擅自改成 1 增加卡组，也不能保留零数量占位。其他合法卡牌及其 quantity 原样保留。opening/reward 中的新候选另按对应奖励契约处理。',
    );
  }
  if (/recover[^\n;；]*pick|recover pick must be random, choose, or all/i.test(detail)) {
    lines.push(
      'recover 表示从 discard/exhaust 回到手牌，pick 只能 random/choose/all，不能用 top/bottom，也没有 to。若原描述是“把弃牌堆顶若干张移到抽牌堆顶”，保留数量与顺序意图，把整个效果项改为 {move_card:原数量,from:"discard",pick:"top",destination:"draw",position:"top"}；若原意确实是回手，则删除 to，并把 pick 改成与描述一致的 random、choose 或 all。',
    );
  }
  if (/recover from must be discard or exhaust|\.recover[^;；\n]*\.from/i.test(detail)) {
    lines.push(
      'recover 的来源只能是 discard/exhaust，固定目的地是手牌。若原对象明确写 from:"draw" 且 description 是从抽牌堆移入手牌，必须保留数量与 pick，等价改成 {move_card:原数量,from:"draw",pick:原pick,destination:"hand"}；绝不能把 from:"draw" 原样返回，也不能为了过检验擅自改成 discard。',
    );
  }
  if (
    /recover[^\n;；]*(?:exhaust|INVALID_EFFECT_BUNDLE)|(?:exhaust[^\n;；]*This operation must remain a separate effect object)/i.test(
      detail,
    )
  ) {
    lines.push(
      '若 recover 同一对象里出现 exhaust:true，它表达的是筛选“带消耗关键词的牌”，不是第二个消耗操作。保留 recover/from/pick 与数量，把布尔字段机械改成 keyword:"exhaust"；不要把 exhaust:true 拆成独立 effects 项，也不要删除这项筛选或把取回改成消耗。若 exhaust 是正整数或 "all"，它才是需要拆开的真实第二个消耗操作。',
    );
  }
  if (
    /left\/right can only select cards from hand|top\/bottom can only select cards from ordered piles|from:\s*(?:all\/combat|all|combat)\s+requires\s+pick:\s*all|(?:pick|选择)[^\n;；]*(?:left|right|top|bottom)/i.test(
      detail,
    )
  ) {
    lines.push(
      '牌区位置选择必须保留原来源：from:"hand" 才使用 pick:"left"/"right"；from:"draw"/"discard"/"exhaust" 才使用 pick:"top"/"bottom"。若候选把非手牌写成 left/right，保持 from、数量、操作和筛选不变，将 left 等价改为 top、right 等价改为 bottom，并把 description 的“最左/最右”同步改成“牌堆顶/牌堆底”；绝不能为了让字段通过而把 from 改成 hand。from:"all"/"combat" 固定使用 pick:"all"。',
    );
  }
  if (/pick must be random, choose, left, right, top, bottom, or all:\s*this|pick\s*[:=]\s*["']?this/i.test(detail)) {
    lines.push(
      '牌区 pick 不存在 "this"。若当前卡根部已经有 exhaust:true，表示这张卡结算后自身消耗，此时删除那条用 exhaust+pick:"this" 再次选择自己的冗余效果，保留根 exhaust:true；否则必须按 description 用合法的 from 与 random/choose/left/right/top/bottom 选择。禁止把数字操作机械改成 pick:"all"；pick:"all" 时操作值也必须是字符串 "all"。',
    );
  }
  if (/UNKNOWN_CARD_TEMPLATE|Unknown card template|add_card must reference a template ID|\.add_card/i.test(detail)) {
    lines.push(
      'add_card 只能引用同一内容对象 creates 中完整定义的新临时牌模板，不能引用玩家现有牌、当前牌自身或只存在于描述中的 ID。若原意是复制手牌、抽牌堆或弃牌堆中的现有牌，改用 copy 并保留 from/pick/筛选；若同一 effects 前一步已经完成该 copy，删除多余的 add_card 项。若原意是真正生成新牌，则在该内容同级 creates 补齐被引用模板。',
    );
    if (/(?:battle|player)\.statuses\[\d+\]|状态定义/i.test(detail)) {
      lines.push(
        '报错根是状态定义：非 hold/threshold_execute 的状态触发器可用 add_card/ensure_card/transform_card 引用该状态自身 creates 中的完整临时牌模板；不能借用施加状态的卡牌 creates，更不能改成不存在的 spawn_card。修复应补齐该状态自身真实引用的模板，保留原触发时机、效果和数量；若本次采用 registry 草稿，则只在 registry.templates 登记，由程序分配 creates。',
      );
    }
  }
  if (/Unknown compact effect:\s*gain_block|不支持的效果操作\s+gain_block/i.test(detail)) {
    lines.push(
      'gain_block 是程序内部动作名，不是 AI 可写的浅层操作。必须保留原数值、条件和目标语义，等价改成公开写法 {block:原数值,to?:原目标,when?:原条件}；例如 {gain_block:10} 只能改成 {block:10}。绝不能改成 damage:0、block:0、空 effects 或其他机制。',
    );
  }
  if (/Unknown compact effect:\s*gain_energy|不支持的效果操作\s+gain_energy/i.test(detail)) {
    lines.push(
      'gain_energy 是程序内部动作名，不是 AI 可写的浅层操作。必须保留原数值、条件和目标语义，等价改成公开写法 {energy:原数值,to?:原目标,when?:原条件}；绝不能用 0 值或其他机制代替。',
    );
  }
  if (/Unknown compact effect:\s*gain_lust|不支持的效果操作\s+gain_lust/i.test(detail)) {
    lines.push(
      'gain_lust 是程序内部动作名，不是 AI 可写的浅层操作。必须保留原数值、条件和目标语义，等价改成公开写法 {lust:原数值,to?:原目标,when?:原条件}；绝不能用 0 值或其他机制代替。',
    );
  }
  if (/Unknown compact effect:\s*gain_resource|不支持的效果操作\s+gain_resource/i.test(detail)) {
    lines.push(
      'gain_resource 是程序内部动作名，不是 AI 可写的浅层操作。必须保留原资源 ID、数量、条件和目标，等价改成公开写法 {resource:{id:"原资源ID",amount:原数量},to?:原目标,when?:原条件}；to/when 位于 resource 同级，绝不能留在 resource 对象内部，也不能改成 set_resource。',
    );
  }
  if (/\bto_modify\b/i.test(detail)) {
    lines.push(
      'to_modify 不是任何公开 effects 操作，把它从原对象拆成新的 effects 项仍然错误。若它修饰 copy/double 并声称“副本费用变为 0”，当前动态复制操作无法唯一选中刚创建的副本：必须保留副本零费、数量、牌区、选择器和条件的原承诺；在当前修复范围无法等价表达时保留失败，不把副本改为原费用。不得改名为 modify_to、modify_copy 或其他自造操作，也不得为了零费承诺随意修改牌组中的其他牌。',
    );
  }
  if (
    /resource\.amount(?:\.[A-Za-z_][A-Za-z0-9_]*)?[^;；\n]*(?:该效果不允许字段|Unknown field|INVALID)|resource\.amount\.when/i.test(
      detail,
    )
  ) {
    lines.push(
      'resource.amount 只是本次增减的数值：写有限数字、合法数值公式，或仅含 history 的数值对象。when 必须移到整个 resource 操作的同级，equals/condition/filter 不得塞入 amount。若 description 明确“每第 N 张牌获得 X 点资源”，唯一对应形状是 {resource:{id:"资源ID",amount:X},when:"cards_played_this_turn % N == 0"}；amount 不再写 history，不得自造 equals:0。',
    );
  }
  if (
    /Unknown compact effect:\s*hp|\.(?:effects|discard_effects)(?:\[\d+\])?\.hp\b|\bhp\s*:\s*Unknown compact effect/i.test(
      detail,
    )
  ) {
    lines.push(
      '报错路径把 hp 当成了相对增减操作，但浅层 effects 不存在 hp 操作。若原值为负数或原描述明确是“失去 N 点生命”，保留 N 和目标，等价改为 {damage:N,damage_type:"hp_loss",to:原目标}，其中 N 取正值；这种生命流失自动无视格挡。若原描述是恢复生命则改用 heal，只有明确“设为某个生命值”才改用 set_hp；不得把负数 hp 错改成治疗或普通可被格挡的自伤。',
    );
  }
  if (/ConditionalExpression|公式写法不受支持|UNSUPPORTED_FORMULA/i.test(detail)) {
    lines.push(
      '数值三元式可用于数值效果的算式或数值函数；when 仍只用布尔条件。检查报错路径的变量、函数及类型，不改动原有条件或数值；过度复杂的公式应等价简化。',
    );
  }
  const historyWhenError =
    /\.when[：:][^;；\n]*(?:Unexpected\s+["']?\{|history)|when[^;；\n]*["']\{\s*history\s*:/i.test(detail);
  if (historyWhenError) {
    lines.push(
      '报错位于 when：when 只能是公开变量组成的 CEL 条件字符串，绝不能把 {history:{...}} 对象或伪 JSON 塞进字符串。当前语法不支持在 when 中比较 history 对象。只有完整契约白名单中的布尔条件/出牌计数器与原条件的事件、时间范围、归属和数量完全等价时，才可改写；必须保留原效果、数值、目标与触发条件。禁止删除条件后改成无条件触发，也禁止修改 description 来掩盖机制丢失；无法等价表达时不能声称修复成功，应保留失败由校验阻止写入。不得用 false、0 或空效果掩盖。',
    );
  }
  if (
    !historyWhenError &&
    /Unexpected\s+["']?\{["']?\s+at character 0|history[^;；\n]*(?:字符串|string)|["']\{\s*history\s*:/i.test(detail)
  ) {
    lines.push(
      '报错数值把 history 对象写成了字符串或伪 JSON。必须去掉包住整个对象的引号，并改成真正 JSON：例如 "block":{"history":{"metric":"last_hp_loss"}}；所有键名和字符串值使用双引号，绝不能返回 "block":"{history:{metric:\'last_hp_loss\'}}"。保留原 metric、筛选、目标与数值语义，不要改成自造公式变量。',
    );
  }
  if (
    /(?:history(?:\.[A-Za-z0-9_]+)*\.event|amount\.filter\.kind|value\.filter\.kind)[^;；\n]*(?:unsupported event kind|INVALID_EVENT_KIND|不支持的事件)|unsupported event kind[^;；\n]*(?:deal_damage|take_damage|deal_heal|take_heal|attack_played|skill_played|power_played)/i.test(
      detail,
    )
  ) {
    lines.push(
      `报错位于 history 的事件筛选：history.event 不能使用 trigger.on 的名字。它只能逐字使用底层事件枚举 ${BATTLE_EVENT_KINDS.join(',')}。保留 metric、scope、source_kind、card_type、actor_id、target_id 和数值语义；伤害改用 event:"damage_resolved"，治疗改用 event:"heal_resolved"，出牌改用 event:"card_played"，获得/失去状态改用 event:"status_applied"/"status_removed"。deal_damage/take_damage 等方向含义应由所属根 trigger 及原 actor_id/target_id 保留，不能只删除筛选或改成不存在的新名字。`,
    );
  }
  if (
    /Expected expression after %|Unexpected token\s+%|(?:modify|add|subtract|multiply|divide|set)[^;；\n]*\d+(?:\.\d+)?%/i.test(
      detail,
    )
  ) {
    lines.push(
      '报错的 modify 运算值把百分比写成了字符串，公式不支持 % 后缀。若原意是“属性提高 P%”，保留同一 modify 属性并改为 multiply:(1+P/100)；“降低 P%”改为 multiply:(1-P/100)。例如 {modify:"damage_taken",add:"50%"} 等价修正为 {modify:"damage_taken",multiply:1.5}。不要删除状态、改变受影响属性或把百分比猜成固定点数。',
    );
  }
  if (/EMPTY_EFFECTS|effects 不能为空|缺少 effects/i.test(detail)) {
    lines.push(
      '报错内容不能保留 effects:[] 或 effects:{}。Attack/Skill/Event、需要打出时生效的 Power、已生成的道具等必要内容必须按其现有 description 补成真实非空浅层根 effects；已有 discard_effects 不能替代这些牌的根 effects。若原描述明确表示该牌不可正常打出、主要靠被弃掉等后果生效，则应按原语义改为 Curse、彻底删除 cost 字段并保留真实 discard_effects；只有明确只是不可打出并占据手牌的纯死牌 Curse 可以删除空 effects 后直接省略该字段，不得为它编造零值或无关惩罚。player_lust_effect、可选能力、状态触发等非必要内容若没有可唯一恢复的机制，应保留失败；可选是指允许不创作，不代表修复时可以删除已承诺的机制。只有确实不承载任何机制的技术空壳才可移除。',
    );
    if (/(?:battle\.)?artifacts\[\d+\]\.trigger\.effects/i.test(detail)) {
      lines.push(
        '报错对象是已生成遗物的空 trigger。若 description 承诺的是整场持续增伤、减伤、治疗或格挡修饰，保留属性与数值并把根 trigger 改成 on:"passive"，effects 只写对应 modify；绝不能保留 on:"battle_start" 再把 modify 塞入其事件 effects。只有真正开战时结算一次的伤害、格挡、抽牌、能量、资源或状态施加才保留 battle_start 并写对应的一次性操作。若原意是“打出攻击牌时”，使用根层 trigger:{on:"card_played",card_type:"Attack",effects:...}；禁止在 effects.when 中自造 event.card.type 条件。',
      );
    }
  }
  if (
    /INVALID_CURSE_COST|Curse (?:card templates|cards?) cannot contain cost|Curse 不得包含 cost|Curse 不能带 cost|诅咒牌不能填写费用/i.test(
      detail,
    )
  ) {
    lines.push(
      '报错对象是 Curse：必须彻底删除整个 cost 字段；cost:null、cost:0 或 cost:"energy" 都不算省略。保留它原有的 effects、discard_effects、关键词、名称与描述，不要为了删费用改写玩法。',
    );
  }
  if (/INVALID_RELIC_RARITY|unsupported relic rarity|遗物 rarity 无效|遗物稀有度不受支持/i.test(detail)) {
    lines.push(
      '报错对象是遗物而不是卡牌：rarity 使用 Common/Uncommon/Rare/Epic/Legendary/Corrupt；Corrupt 表示诅咒遗物，必须保留其真实负面或代价机制，不能只改名称或用空壳替代。Boss/ENS 只兼容旧内容。程序若已指定本槽位稀有度，按该稀有度设计，保留原机制语义，不得擅自降级。',
    );
  }
  if (/narrate 只允许作为 Event|\bnarrate\b/i.test(detail)) {
    lines.push(
      'narrate 只能是 Event 卡唯一的顶层主效果，敌人 action/ability/lust_effect、普通卡、状态、遗物和道具一律不能使用。把原句移动到所属内容的 description；若报错对象是只想表达“无法打出、占据手牌”的 Curse，删除 narrate 并直接省略 effects，不得编造伤害或零值占位。若可选 ability 除 narrate 外没有任何游戏效果，删除整个 ability，而不是留下空 trigger；其他内容若原文描述了真实战斗机制，则用该机制对应的非空浅层 effects 实现。',
    );
  }
  if (/遗物已持有|道具已持有|ID\s+[A-Za-z_][A-Za-z0-9_-]*\s+已存在|already exists|already owned/i.test(detail)) {
    lines.push(
      '馈赠或节点奖励候选中，已有非唯一卡的名称、类型、费用和可执行规则完全相同时，保留当前稳定 id、名称和完整定义，并用 quantity 表示副本；不要为同一张 6 点伤害卡改名。规则不同、遗物或道具不得复用玩家当前已持有内容的 id，也不能与本次其他新候选重名；为真正不同的新候选填写新的稳定英文 id 和完整规则。',
    );
  }
  if (/(?:^|[^.\w])summon_count\b|enemy_summon_count|slot_count/i.test(detail)) {
    lines.push(
      '召唤数量必须写成 self.summon_count 或 opponent.summon_count；存在性条件可写 self.has_summon 或 opponent.has_summon，这四者都是字段而不是函数。禁止裸 summon_count、enemy_summon_count、slot_count 或其他近义变量。',
    );
  }
  if (
    /公式引用了不支持的变量|不支持(?:的)?变量|Unsupported variable|UNSUPPORTED_FORMULA_VARIABLE|INVALID_FORMULA_REFERENCE/i.test(
      detail,
    )
  ) {
    if (/(?:player_lust_effect|lust_effect)[^;；\n]*(?:effects\.)?when\b/i.test(detail)) {
      lines.push(
        '欲望效果条件中的属性使用 self.lust/opponent.lust 与 self.max_lust/opponent.max_lust，不用裸 lust/max_lust 或 lust_max。依据原条件、来源视角与说明确定实际对象并保留原限制；不能仅凭报错路径认定条件重复并删除，也不能把根条件复制到各效果项。只修改本次明确允许的字段，保留原 effects、目标和数值；无法确定原意时保留失败。',
      );
    }
    const playerOwnedPileVariables = [
      ...new Set(
        detail
          .split(/[;；\n]+/)
          .filter(segment =>
            /(?:battle|player)\.(?:cards|artifacts|items|player_abilities|player_lust_effect)|opening[^;；\n]*(?:cards|artifacts|items)|reward[^;；\n]*(?:cards|artifacts|items)/i.test(
              segment,
            ),
          )
          .flatMap(segment => [
            ...segment.matchAll(/\b(hand_size|draw_pile_size|discard_pile_size|exhaust_pile_size)\b/gi),
          ])
          .map(match => match[1].toLowerCase()),
      ),
    ];
    if (playerOwnedPileVariables.length > 0) {
      lines.push(
        `报错路径属于玩家持有或将要领取的卡牌、遗物、道具、能力或欲望效果；其中裸写的 ${playerOwnedPileVariables.join('、')} 指的是玩家自己的牌区，必须逐字改成 ${playerOwnedPileVariables.map(variable => `self.${variable}`).join('、')}。不要删除原条件，不要改成 opponent，也不要顺手修改数值或其他机制。`,
      );
    }
    const enemyPileVariables = [
      ...new Set(
        detail
          .split(/[;；\n]+/)
          .filter(segment =>
            /(?:battle\.)?(?:enemy|enemies)(?:\[\d+\])?\.(?:actions|abilities|lust_effect)|spawn_enemy/i.test(segment),
          )
          .flatMap(segment => [
            ...segment.matchAll(/\b(hand_size|draw_pile_size|discard_pile_size|exhaust_pile_size)\b/gi),
          ])
          .map(match => match[1].toLowerCase()),
      ),
    ];
    if (enemyPileVariables.length > 0) {
      lines.push(
        `报错路径属于敌人内容。敌人自身没有牌区；若原效果读取玩家牌区，裸写的 ${enemyPileVariables.join('、')} 必须按原描述改成 ${enemyPileVariables.map(variable => `opponent.${variable}`).join('、')}。只有原描述确实要读取敌人自身时才使用 self，但该值恒为 0。无法等价表达原要求时保留失败，不替换为另一机制；不得在不读原描述的情况下盲猜阵营。`,
      );
    }
    lines.push(
      '报错公式引用了公开白名单之外的变量。self 与 opponent 是并列根对象，出现 self.opponent.xxx 时必须保留后半路径并改成 opponent.xxx，绝不能保留 self.opponent。不能把错误变量改成猜测出来的近义字段；召唤数量只能写 self.summon_count/opponent.summon_count，存在性条件只能写 self.has_summon/opponent.has_summon；存活非召唤队友数量只能写 self.ally_count/opponent.ally_count，存在性条件只能写 self.has_ally/opponent.has_ally。禁止裸 summon_count、ally_count、enemy_summon_count、slot_count。has_status/has_buff/has_debuff/has_neutral/has_summon/has_ally 是无参数布尔字段，不是函数；指定某个状态必须写 self.status.状态ID.stacks > 0 或 opponent.status.状态ID.stacks > 0。若无法用现有公开变量等价表达，保留失败，不删除条件分支、不把条件收益改成无条件，也不通过改写 description 掩盖机制变化。',
    );
  }
  const unsupportedTurnCounters = [
    ...new Set(
      [...detail.matchAll(/\b(?:self\.|opponent\.)?([A-Za-z_][A-Za-z0-9_]*_this_turn)\b/g)]
        .map(match => match[1])
        .filter(
          counter =>
            !['cards_played_this_turn', 'attacks_played_this_turn', 'skills_played_this_turn'].includes(counter),
        ),
    ),
  ];
  if (unsupportedTurnCounters.length > 0) {
    lines.push(
      `${unsupportedTurnCounters.join('、')} 不是可用变量，也不存在删掉 self. 后即可使用的同名别名。当前仅支持 cards_played_this_turn、attacks_played_this_turn、skills_played_this_turn 三种本回合计数；只有原描述语义完全相同才可换用其中之一。否则按原语义检查是否能用公开事件触发或历史查询等价表达；不能等价表达时保留失败，不删除条件或加成，不改写说明伪装完成。不得返回同一错误变量、相似拼写或自造替代变量。`,
    );
  }
  if (/threshold_execute/i.test(detail)) {
    lines.push(
      '状态 triggers.threshold_execute 只允许处决状态持有者：每项只能写 {execute:阈值,threshold_mode?:"hp"|"hp_percent",to:"self"} 或 {kill:true,to:"self"}，不得写 opponent、targets、damage、状态或牌区操作。若原意是处决对方，此槽无法表达；只有本次修复范围能锁定原事件、条件、发生者与持有者、目标、阈值、时机、次数及寿命时，才允许语义等价的载体迁移。否则保留失败，不删除原处决收益，不改成任意卡牌或行动的即时处决。',
    );
  }
  if (
    /当前卡牌不会支付资源\s+[A-Za-z_][A-Za-z0-9_]*|SPENT_RESOURCE_NOT_ALLOWED|当前卡牌没有资源\s+[A-Za-z_][A-Za-z0-9_]*\s+的 X 费用|X_RESOURCE_NOT_ALLOWED/i.test(
      detail,
    )
  ) {
    lines.push(
      '报错公式读取了当前卡没有实际支付的资源。先按原卡描述判断：若原意明确是“花费/消耗该资源”，必须把同一张卡的 cost 改为包含该资源 ID 的费用对象；固定支付写非负整数，支付全部当前值写 "all"。读取 spent_resource.资源ID 要求 cost 含同名键，读取 x_resource.资源ID 还要求同名键的值为 "all"。若原 cost:"energy" 表示能量 X 费，但现在改成复合费用，则把能量组件写成 energy:"all"，并把公式中的 x_value 等价改成 x_resource.energy。若原意只是按当前资源量计算且不消费资源，则保持 cost 不变，把 spent_resource.资源ID/x_resource.资源ID 改成 self.resource.资源ID.current。只能选择符合原 description 的一条路线，并同步修正 description；不得保留报错公式、把资源读数改成 0，或删除整张卡。',
    );
  }
  if (
    /INVALID_EVENT_ORDINAL|n is only valid with (?:first_n\/)?nth\/every_n|(?:first_n\/)?nth\/every_n require a positive integer n|ordinal 为 first 或省略时不能填写 n|ordinal 为 nth\/every_n 时必须填写正整数 n/i.test(
      detail,
    )
  ) {
    lines.push(
      '报错位于根 trigger 的事件次序字段：ordinal:"first" 表示范围内第一次，必须删除 n；ordinal:"first_n"、"nth" 或 "every_n" 才必须保留正整数 n。只修正 ordinal/n 这一组字段，scope、on、effects、数值和其他筛选保持不变。',
    );
  }
  if (/trigger(?:\.filter)?\.sourceKind|unsupported event source kind/i.test(detail)) {
    lines.push(
      '报错位于根 trigger 的 source_kind。公开值只允许 card/relic/status/ability/enemy_action/system/summon/enchantment/affliction，不存在 source_kind:"enemy"。若真实来源是敌人行动，使用 enemy_action；但敌人行动不会产生 card_played，不能用 card_played+enemy_action 冒充跨敌人监听。需要两名敌人协作时，应让发起行动本身通过 targets、状态或资源产生队友联动，或改用该能力真实能够收到的公开事件；不得原样保留 enemy。',
    );
  }
  if (/trigger(?:\.filter)?\.when|unsupported trigger field:\s*when/i.test(detail)) {
    lines.push(
      '根 trigger 不支持 when。单个效果可将条件移到该效果同级 when，并与原条件用 && 合并。数组各项的 when 在执行到该项时重新判断，不是事件开始时的快照。共享条件仅在前序效果及其触发联动不会改变条件真假时才能逐项复制；有支付、状态移除或其他依赖时，必须保留判断时机和先后关系，不能机械展开。一次判断后顺序执行使用 guard 条件组，见组合契约；必须保留原组边界及子条件，不删除条件或收益。不得留下空 effects 或删除原效果。',
    );
  }
  if (
    /CURRENT_CARD_REPLAY_NOT_ALLOWED|replay_current 只允许用于当前正在结算|replay_current[^;；\n]*(?:遗物|能力|trigger|状态|Power|Event)/i.test(
      detail,
    )
  ) {
    lines.push(
      'replay_current 只允许放在当前这张非 Power、非 Event 卡的直接根 effects，因为只有那里存在“当前卡”。若遗物、能力、Power 或状态的原意是“之后每回合前 N 张匹配牌额外完整结算”，必须保留牌型、次数与每回合限制，删除事件型 replay_current，改为 trigger:{on:"passive",effects:{card_rule:"replay",limit:N,extra:原次数,筛选字段...}}；状态则把同一 card_rule 放在 triggers.hold。改成 passive/card_rule 后必须彻底删除原事件的 ordinal、n、scope、event、phase、reason、source_kind、source_id；“第一张”已经由 limit:1 表达，这些字段不能移进 card_rule 效果。不要改成重复 damage、copy/double、0 值或空效果。',
    );
  }
  if (
    /Unsupported card rule:\s*\[object Object\]|card_rule[^;；\n]*(?:必须是字符串|值.*对象|规则字段不符合)/i.test(
      detail,
    )
  ) {
    lines.push(
      'card_rule 的值必须直接是公开规则字符串，limit/extra/筛选字段与 card_rule 同级，绝不能写成 {rule:...,limit:...} 对象。若对象中的 rule 实际表示 draw、energy、block、heal 等按时结算的一次性操作，它不是持续 card_rule：保留原数量和时机，把所属 Power/遗物/能力改成对应事件 trigger，并把 draw/energy/block/heal 直接写入 trigger.effects；禁止猜成 limit_draw、limit_energy_gain 等限制规则，更不能用 0 值占位。',
    );
  }
  if (
    /card_rule[^;；\n]*(?:This operation must remain a separate effect object|该操作必须单独占一个 effects 数组项)|(?:ordinal|scope|event|phase|reason|source_kind|source_id|damage_type)[^;；\n]*card_rule/i.test(
      detail,
    )
  ) {
    lines.push(
      '报错对象已经是一个 card_rule 持续规则：保留 card_rule、limit、extra 与真实卡牌筛选，只删除误塞进同一对象的 trigger 事件字段 ordinal/n/scope/event/phase/reason/source_kind/source_id/damage_type。card_rule 的 limit 本身就是每回合匹配前 N 张牌的窗口，所以“每回合第一张”写 card_rule:"replay",limit:1,extra:次数，不再写 ordinal:"first"；不能把它拆成两个效果项，也不能删除 card_rule。',
    );
  }
  if (
    /this card_rule does not accept limit|card_rule[^;；\n]*不接受 limit|limit[^;；\n]*card_rule[^;；\n]*不支持/i.test(
      detail,
    )
  ) {
    lines.push(
      '先读取报错对象当前的 card_rule。retain_hand 与 retain_block 表示整项持续规则，必须删除同级 limit；它们分别表示回合结束保留手牌、回合开始保留格挡，不表示“手牌上限+N”或“格挡上限+N”，所以 description 若有这种错误承诺也必须同步改成真实含义。card_destination、deny_card_play、allow_card_play 同样不使用 limit；只有 replay/free/limit_draw/limit_block_gain/limit_energy_gain/limit_card_play 按各自契约使用 limit。不要删除整个遗物、卡牌或其他未报错效果。',
    );
  }
  if (/spawn_enemy|INVALID_ENEMY_CAPACITY/i.test(detail)) {
    lines.push(
      'spawn_enemy 必须独占一个 effects 数组项，并固定写成 {spawn_enemy:{完整敌人字段...,count?:数量,capacity?:场上容量}}。若 count/capacity 当前与 spawn_enemy 同级，必须原样移动到 spawn_enemy 对象内部；不能把它们拆成另一个效果项，也不能删除完整敌人定义。无欲望体系的增援可省略 lust_effect；若已经提供，必须修成闭合的 {name,effects}，effects 非空，不能写 null、数组或空对象。不要为通过校验补造默认弱效果。',
    );
  }
  if (/escape_when|defeat_reward|INVALID_DEFEAT_REWARD/i.test(detail)) {
    lines.push(
      '初始敌人的 escape_when 必须是可执行的公开条件公式；保留原条件语义，不能把它替换成 true、叙事文字或虚构变量。defeat_reward 只允许 cards、artifacts、items 数组和非负整数 gold；保留每个完整候选的真实字段与收益。它只属于初始 enemies，若出现在 spawn_enemy 增援定义中必须删除该掉落字段，不能迁移为增援或召唤物的死亡效果。',
    );
  }
  if (/Target must be self or opponent|INVALID_TARGET|Target must be one of self/i.test(detail)) {
    lines.push(
      'to 只接受 "self" 或 "opponent"，永远不能填写实体 ID。保留原目标语义：玩家来源指定某个敌人时用 to:"opponent" 与 targets:{mode:"by_id",id:"敌人ID"}；敌人来源治疗或强化指定队友时用 to:"self" 与 targets:{mode:"by_id",id:"队友ID"}；敌人攻击玩家仍只写 to:"opponent" 且不写 targets。',
    );
  }
  if (/targets can only address the opponent combatant collection|INVALID_TARGET_COLLECTION/i.test(detail)) {
    lines.push(
      '报错效果把普通 damage/heal/block 等 combatant targets 误用于召唤物。先读原 description：若目标是召唤物，只替换这一项为 damage_summon/heal_summon/modify_summon 等对应召唤操作，保留原数值、when、卡牌 type、费用和同数组其他效果；未指定哪只召唤时使用 selector:{owner:"self",pick:"choose"}，指定模板/槽位时使用真实 template_id/slot，绝不能写虚假 targets:{mode:"by_id",id:"summon"}。若目标其实是自己，删除 targets 并保留 to:"self"；若目标是敌方战斗实体，才保留普通操作并使用合法 opponent targets。不得为了修这一项把格挡牌改成攻击牌或改小数值。',
    );
  }
  if (
    /Unsupported boolean CEL node:\s*Identifier|UNSUPPORTED_CONDITION|when 必须是会得到真\/假的比较或逻辑条件/i.test(
      detail,
    )
  ) {
    lines.push(
      '报错路径中的 when 不是合法比较条件。若它只是 battle_won/victory/battle_end 等战后裸标识符，当前战斗 DSL 没有等价变量：保留失败，不删除对应收益或说明承诺；胜利奖励只能由节点 reward/结算事务承担，仅在当前修复范围允许且时机、目标、次数、收益均等价时迁移。不得把它改成 true、数字、另一个裸单词或虚假状态标记。其他条件必须改成完整的公开变量比较。',
    );
  }
  if (/summon|spawn_summon|intercept|on_defeated|on_existing|overflow/i.test(detail)) {
    lines.push(
      'spawn_summon 只用 actions 数组；intercept 省略或写 {mode:"unblocked_attack",priority?:整数,max_per_turn?:正整数}。on_existing 只用 reinforce/replace，on_defeated 只用 new_instance/revive_reset/revive_reinforce 且两者需 slot；overflow 只用 reject/replace_oldest/replace_lowest_hp。',
    );
    lines.push(
      '若要让指定已存在召唤物单次执行新行动，使用 {activate_summon:{selector:{...},action:{id:"稳定英文ID",name:"行动名",effects:非空效果}}}；action 不写 weight，普通 self 绑定被选中的召唤物，给主人效果仍使用 summoner_effects。没有匹配召唤物时该项自然无效果，不能伪造玩家来源。',
    );
    lines.push(
      '修改召唤本体用 modify_summon，stat 只用 max_hp/block/actions_per_activation/speed/action_priority；修改召唤行动输出用 modify_summon_effect，stat 只用 damage/block/lust/stacks。两者都必须含 selector。',
    );
  }
  if (/selector\.tags|INVALID_SUMMON_TAGS|summon tags must be unique stable English ids/i.test(detail)) {
    lines.push(
      '召唤 selector.tags 只能是唯一、非空的稳定英文 ID 数组，而且被选择的 spawn_summon.tags 必须登记完全相同的标签。若当前只是要选择某个已知召唤，优先保留其现有英文 id，改写为 selector:{template_id:"该召唤英文ID",pick:"all"}，并删除中文或未登记的 tags；不要只把中文标签翻译后留下无法命中的选择器。',
    );
  }
  if (/spawn_summon\.actions|spawn_summon\.abilities/i.test(detail) && /damage_summon|heal_summon/i.test(detail)) {
    lines.push(
      '召唤自己的 action/ability 向敌人造成伤害或欲望时使用普通 {damage:数值}/{lust:数值}；damage_summon/heal_summon 只表示外部效果用 selector 直接伤害或治疗召唤单位。若当前错误把 damage_summon.amount 当作召唤攻击伤害，必须保留该 amount 数值并改成 {damage:原数值}，删除错误 selector；给主人结算的部分继续放在 summoner_effects。',
    );
  }
  if (/modify_summon\.stat|modify_summon[^\n]*(?:damage|lust|stacks)/i.test(detail)) {
    lines.push(
      'modify_summon 不能修改 damage/lust/stacks；这些是召唤行动或能力的输出，必须保留 selector 与运算并把操作改为 modify_summon_effect。modify_summon 只修改 max_hp/block/actions_per_activation/speed/action_priority。',
    );
  }
  if (statusEventTrigger) {
    lines.push(
      `报错路径是状态事件 triggers.${statusEventTrigger}，不是卡牌、遗物或能力的根 trigger。该键的值必须直接是非空浅层效果对象或数组，绝不能包成 {effects:...}、{on,effects} 或 {when:X,effects:...}。`,
    );
    lines.push(
      `状态事件 triggers.${statusEventTrigger} 的效果项不接受 scope/ordinal/n/event/phase/reason/source_kind/source_id 等根触发器筛选字段。若这些字段只是重复表达状态寿命，删除它们并保留状态自身 stacks_change；若机制确实依赖首次、第 N 次或事件来源筛选，就不能留在状态事件中，必须按原意改由 Power、遗物、独立能力或召唤 ability 的根 trigger:{on,effects,筛选字段} 承载。`,
    );
    lines.push(
      '单个效果可把外层 when 移到该项并与其原条件用 && 合并。数组各项的 when 在执行到该项时重新判断，不是事件开始时的快照。共享条件仅在前序效果及其触发联动不会改变条件真假时才能逐项复制；有支付、状态移除或其他依赖时，必须保留判断时机和先后关系，不能机械展开。一次判断后顺序执行使用 guard 条件组，见组合契约；必须保留原组边界及子条件，不删除条件或收益。',
    );
    lines.push(
      "若 X 写成 self.has_status('状态ID') 或 opponent.has_status('状态ID')，必须分别改成 self.status.状态ID.stacks > 0 或 opponent.status.状态ID.stacks > 0；has_status 仅表示“任意状态是否存在”的无参数布尔字段，禁止当函数调用。",
    );
    lines.push(
      `若 triggers.${statusEventTrigger} 的嵌套 effects 使用 replay_current，它不能留在状态事件中，因为这里没有“当前正在结算的卡牌”。若原意是“持有该状态时，下一张或前 N 张符合类型的牌额外完整结算”，保留重放次数和牌型语义，删除该事件子触发器，改在同一状态 triggers.hold 写 {card_rule:"replay",card_type:"对应 Attack/Skill/Power",limit:N,extra:原重放次数}，并按原本持续时间保留或补正 stacks_change；一次性状态使用 stacks_change:"reset"。不得把重放改成增伤、重复 damage、空效果或只剩条件。`,
    );
    lines.push(
      `若 triggers.${statusEventTrigger} 中出现 modify/card_rule，不能留在这个一次性事件槽，也不能增加 0 值假规则掩盖错误。像“下一次攻击伤害 +N，随后移除”必须把 {modify:"damage",add:N或stacks} 原样移到同一状态 triggers.hold，同时在 triggers.attack_played 只保留 {remove_status:"本状态ID",to:"self"}；这样攻击结算前持续增伤，出牌事件后移除。其他持续规则同样移到 hold，事件中的 damage/block/remove_status 等一次性操作原样保留。`,
    );
  }
  if (!statusEventTrigger && /trigger|Power|ability|passive/i.test(detail)) {
    lines.push(
      `trigger 固定写在内容根部 {on,effects}，on 只用：${ABILITY_TRIGGERS.join(',')}。只有 trigger 的 Power 省略根 effects，禁止空 effects:[]；修复保留原卡牌类型，不能用改类型掩盖缺失的持续机制。`,
    );
    lines.push(
      '逐项按内容类型检查触发时机：Power 绝不能使用 battle_start；开战触发只属于遗物、独立能力或状态。若 Power 原意是打出后永久生效，改用 passive 的 modify/card_rule；若是之后每回合或特定事件结算，使用对应真实事件 trigger。只有即时效果不足以证明类型无关；无法在允许字段内等价恢复持续机制时保留失败，不改类型或说明。',
    );
    lines.push(
      'Power 的 passive.effects 只能是 modify/card_rule。若报错项是 apply_status，应保留状态机制，把该项移动到同一张 Power 的根 effects，并保留状态 triggers.hold 中的持续规则；若是 damage/block/energy/draw 等按时结算收益，仅可改用与原意完全等价的非 passive 事件 trigger；没有等价时机则保留失败。绝不能把一次性操作原样留在 passive。',
    );
  }
  if (/summon_spawned/i.test(detail)) {
    lines.push(
      `summon_spawned 不是公开 trigger.on，必须删除该名字。卡牌 Power 只能从这些事件中选择：${REGISTERABLE_EFFECT_TRIGGERS.join(',')}，或使用 passive；若机制是“召唤物命中后给主人收益”，把真实事件 trigger 写进 spawn_summon.abilities，并通过 summoner_effects 结算给主人。不得把 trigger 嵌入 effects 项。`,
    );
  }
  if (/unsupported trigger:\s*summon_acted|trigger\.on[^;；\n]*summon_acted/i.test(detail)) {
    lines.push(
      'summon_acted 不是公开触发器，遗物也无法监听“任意召唤物行动”。禁止把它改成拼写错误的 eal_damage，也不得用玩家本体 deal_damage 伪装召唤物命中。若固定根仅是 opening 奖励遗物，不能把原机制改成 turn_start/turn_end/card_played；当前范围没有等价实现时保留失败；资源操作仍只能写 {resource:{id:"资源ID",amount:数量}}，禁止 gain_resource。只有同一修复根内实际包含 spawn_summon 定义时，才可把 deal_damage 能力写到召唤物自身并用 summoner_effects 给主人收益。',
    );
  }
  if (/summon ability trigger is invalid|spawn_summon\.abilities\[\d+\]\.trigger/i.test(detail)) {
    lines.push(
      '报错位于召唤 ability 的 trigger：召唤能力监听主人出牌时也直接使用公开团队事件，owner_attack_played/owner_skill_played/owner_power_played/owner_card_played 分别机械改成 attack_played/skill_played/power_played/card_played。若原意已经限定攻击牌，优先直接使用 attack_played，绝不能改成 card_played 再在 when 中读取不存在的 event.card_type。原 effects、数值和召唤归属保持不变。',
    );
  }
  if (/(?:\.hits\b|hits[^;；\n]*(?:正整数|positive integer|INVALID))/i.test(detail)) {
    lines.push(
      'hits 必须是字面正整数，不能是公式、变量或三元式。保留原伤害与多段语义：固定段数直接改成整数；动态条件段数则拆成多个 damage 效果项，并在额外段同级写 when。',
    );
  }
  if (/rarity[^;；\n]*Starter|Starter[^;；\n]*rarity/i.test(detail)) {
    lines.push(
      'Starter 不是 rarity。按原强度与定位改为 Common/Uncommon/Rare/Epic/Legendary/Corrupt 中最接近的一项；不得改卡牌机制、数量或题材。',
    );
  }
  if (/卡牌稀有度不受支持|unsupported card rarity|rarity[^;；\n]*(?:Special|Token)/i.test(detail)) {
    lines.push(
      '报错对象是正式卡牌或 creates 临时牌模板：rarity 只能逐字使用 Common/Uncommon/Rare/Epic/Legendary/Corrupt，不存在 Special、Token 或 Starter。按原强度选最接近的合法值，只修 rarity，不改变机制、数量、类型或题材。',
    );
  }
  if (/unsupported trigger[^;；\n]*resource_changed|trigger\.on[^;；\n]*resource_changed/i.test(detail)) {
    lines.push(
      'resource_changed 是底层历史事件名，不是公开 trigger.on。当前根触发器没有“资源变化时”这一项；不得把它原样返回，也不得在 when 中发明 event.metric/event.amount。必须保留资源变化这个触发条件，不能改为 turn_start/turn_end/card_played 或删除能力来通过校验；无法在当前范围等价表达则保留失败，不返回空 trigger。',
    );
  }
  if (/trigger\.effects(?:\[\d+\])?[^;；\n]*(?:持续规则只允许用于 passive|MODIFIER_NOT_ALLOWED)/i.test(detail)) {
    lines.push(
      '报错位于非 passive 的真实事件 trigger：modify/card_rule 不能在事件发生后临时改变该次结算。若原描述是“打出攻击牌时额外造成 N 点伤害”，保持 N 与触发筛选不变，把 {modify:"damage",add:N} 改成该 trigger.effects 的一次性 {damage:N}；格挡、治疗、能量等同理使用真实一次性操作。只有无条件持续规则才改成 passive；带 ordinal/n/event 等事件筛选的机制不得移到 passive 后丢失筛选。',
    );
  }
  if (
    /ROOT_TRIGGER_REQUIRED|Power 必须至少(?:注册一个触发器|包含真实触发能力)|Power 的所有顶层效果必须注册为触发器/i.test(
      detail,
    )
  ) {
    lines.push(
      '报错 Power 若根 effects 是 spawn_summon、damage、block、draw、resource 等打出时即时效果，保留这些 effects 和原 type；缺少触发器不授权改为 Skill 或 Attack，也不授权发明空 trigger、假状态或虚假持续能力。仅在允许字段内等价恢复原持续规则、事件触发或已注册持续状态；无法等价恢复则保留失败，不改说明掩盖缺口。',
    );
  }
  if (/modify[^\n]*(?:energy|hp|max_hp|max_energy)|passive[^\n]*(?:energy|hp)/i.test(detail)) {
    lines.push(
      'passive/hold 中的 modify 只允许 damage、damage_taken、lust、lust_taken、heal、block、summon_capacity、draw_per_turn。若原意是每回合获得能量、格挡、治疗或其他即时收益，保留原意并改用 trigger.on="turn_start"，把 energy/block/heal 等即时效果直接写入 trigger.effects；不能给 modify 发明 energy/hp 等属性。',
    );
  }
  if (/Unsupported card rule:\s*energy_gain|card_rule[^\n]*(?:energy_gain|energy)/i.test(detail)) {
    lines.push(
      '不存在 card_rule:"energy_gain"，也不能改猜成 modify:"energy"。原意“每回合开始获得能量”必须保留为真实事件：若来源是 Power 卡，删除该卡用于套壳的 apply_status 与对应空壳状态，改成卡牌根 trigger:{on:"turn_start",effects:{energy:原数值}}；若来源是独立能力或遗物，就在该内容根 trigger 使用同一写法。不要用状态 hold 表示按回合结算。',
    );
  }
  if (
    /INVALID_CARD_FILTER|name must be a non-empty card name|card_type contains an unsupported|origin must be one of/i.test(
      detail,
    )
  ) {
    lines.push(
      'card_rule 的筛选字段只能保留真实、非空且受支持的值。card_type 只允许 Attack、Skill、Power、Event、Curse 或这些值的非空数组；"Card"、"Any"、"All" 表示没有类型限制，必须直接删除 card_type，不能把它们当成类型。删除 name:""、origin:""、空数组等占位；deny_card_play、allow_card_play、limit_card_play 若需要限定卡牌，至少保留一个真实筛选字段（例如现有的 card_type），并省略其他空字段。不得为了凑字段新造不存在的卡名或来源。',
    );
  }
  if (/opening\.choices\[\d+\]\.outcome|开局馈赠不支持字段/i.test(detail)) {
    lines.push(
      'opening choice.outcome 是开局节点结算，不是战斗 effects；它只允许 hp、max_hp、lust、max_lust、gold、card_removals、reward、deck_transforms。hp/max_hp/lust/max_lust/gold/card_removals 都是会写入玩家长期状态的相对变化；block、energy、status、effects 等战斗临时字段不能直接写在 outcome。若报错字段没有等价的合法结算含义，保留失败，不删除 choice 的收益或承诺；不得把 block 猜成 hp 或 max_hp。若确实要提供战斗内收益，应把它做成 reward 中结构完整的卡牌、遗物或道具，而不是给 outcome 增加新键。',
      OPENING_TRANSFORM_GUIDANCE,
    );
  }
  if (/opening\.choices\[\d+\]\.outcome[^;；\n]*max_energy|开局馈赠不支持字段[：:]\s*max_energy/i.test(detail)) {
    lines.push(
      'max_energy 不是 opening outcome 的可结算字段。不能删除“增加能量上限”的承诺后当作修复成功，绝不能把 max_energy 改猜成 max_hp；若无法等价实现则保留失败。只有候选本来已经包含一件能唯一承载该机制的完整奖励遗物、能力牌或道具时，才由该奖励自身的可执行效果表达。',
    );
  }
  if (
    /opening\.choices\[\d+\]\.outcome[^;；\n]*(?:resource|set_resource)|开局馈赠不支持字段[：:]\s*(?:resource|set_resource)/i.test(
      detail,
    )
  ) {
    lines.push(
      'outcome 不支持直接修改自定义战斗资源。保留资源 ID、数值、受益对象和生效时机；不能因另有合法收益就删除资源收益。只有原意本就允许通过领取后在战斗内使用内容实现时，才可由完整 reward 承载；即时到账不能擅自换成未来收益，无法等价则保留失败。不得留下全零字段与全空 reward 的无效果馈赠。',
    );
  }
  if (/reward 不支持字段|reward[^\n;；]*(?:description|name|effects|limits)/i.test(detail)) {
    lines.push(
      'opening 的 reward 容器只允许 cards、artifacts、items 数组，不能写 description、name、effects、limits 或其他元数据。若报错字段是 description：保留 choice.description 作为整项馈赠说明；若文字实际是某个唯一奖励内容的效果说明且该内容缺少 description，则把文字移动到该卡牌、遗物或道具自身的 description，然后删除 reward.description。其他不支持字段直接从 reward 容器删除；不得删除或重写合法候选数组。',
    );
  }
  if (
    /Unsupported modifier:\s*\[object Object\]|(?:triggers\.hold|passive)[^\n]*\.modify|modify[^\n]*(?:必须|must)[^\n]*(?:字符串|string)/i.test(
      detail,
    )
  ) {
    lines.push(
      '报错路径中的 modify 被错误写成了对象。必须把它展开为一个浅层持续规则，例如 {modify:"damage",add:1}；modify 的值只能是属性字符串，add/subtract/multiply/divide/set 恰好一个且与 modify 同级。禁止返回 {modify:{damage:1}}、{modify:{stat:"damage",...}} 或只改 description。',
    );
  }
  if (/Modifier formulas may only use numbers and status stacks|INVALID_MODIFIER_FORMULA/i.test(detail)) {
    lines.push(
      'modify 的 add/subtract/multiply/divide/set 只能由有限常数与当前状态的裸变量 stacks 组成。若错误位于某状态 triggers.hold 且原式写 self.status.该状态ID.stacks，保留层数语义并改成裸 stacks；Power、遗物或能力的 passive 没有状态层数上下文；不能用常数替代依赖层数的原机制，必须等价迁回该状态的 hold，否则保留失败。',
    );
  }
  if (
    /(?:triggers\.hold|status(?:es)?\[\d+\])[^;；\n]*Unsupported variable:\s*self\.stacks|Unsupported variable:\s*self\.stacks/i.test(
      detail,
    )
  ) {
    lines.push(
      '报错位于状态 triggers.hold 的 modify 公式：当前状态层数只写裸变量 stacks。把 self.stacks 逐字等价改成 stacks，保留 modify 属性、运算符和其他数值；不得改成 self.status.ID.stacks、常数或删除持续效果。',
    );
  }
  if (/apply_status|remove_status/i.test(detail)) {
    lines.push(
      '若 apply_status/remove_status 的值是对象，必须拆平：状态 ID 直接作为操作值，stacks 与 to 移到同一个 effects 项的同级。例如 {apply_status:"status_id",stacks:2,to:"opponent"}；绝不能写 {apply_status:{id:"status_id"}}、{apply_status:{status_id:2}} 或 {apply_status:{apply_status:"status_id"}}。对象原有 id、stacks、to 必须原样搬到这些规范位置，不能改名或丢失。引用的非预设新状态必须补入 statuses 完整定义。',
    );
  }
  if (/(?:remove_status[^\n;；]*stacks|stacks[^\n;；]*remove_status|triggers\.tick[^\n;；]*stacks)/i.test(detail)) {
    lines.push(
      'remove_status 只能立即移除整个状态，绝不接受 stacks。若原意是“持有者每回合结束时减少若干层”，删除 tick 中的 remove_status/stacks 组合，在同一状态定义根部写 stacks_change:-1（或原本需要的负数）；tick 在状态根 tick_timing 指定的持有者行动前/后执行（省略为行动前）；stacks_change 仍只在持有者回合末衰减一次，归零后再执行 remove。不要把逐层衰减改成整状态立即移除。',
    );
  }
  if (/Unknown field:\s*scope|\.scope\b/i.test(detail)) {
    lines.push(
      'modify 与 card_rule 都没有 scope:"summon"、scope:"turn" 等字段；普通 reduce_cost/modify_card/copy/double 也不接受 scope。非法字段必须修正，但它表达的期限、对象和收益不能随字段一起删除。',
    );
    lines.push(
      'reduce_cost 只立即修改当前已选中的卡牌。若原意包含 turn/combat/run 等期限，仅在保持原减费数值、选择器、目标实例和生命周期时等价改用 patch_card:"cost"；不能把“下一张牌”改成当前任意牌，也不能改写 description 掩盖差异。无法在本次修复范围内等价实现时保留失败。',
    );
    lines.push(
      '普通 Attack/Skill 的本回合 replay/free 规则不能只删除 scope 后把 card_rule 留在根 effects。若原要求确实在本回合持有期间生效，可由该牌施加已登记状态，其 triggers.hold 承载规则、stacks_change:"reset"负责回合末结束；须保留原筛选、次数和收益，不把整个回合首次偷换成获得状态后首次。',
    );
    lines.push(
      '强化召唤时，绝不能只把 passive 内的操作改成 modify_summon/modify_summon_effect：这些是一次性操作，不属于 passive/hold。不得为通过校验将 Power 改成 Skill、删除持续触发或改成即时强化。状态 apply/stack 与 hold 的时机也不等价；只有原意及允许修复的字段明确支持等价迁移时才移动，否则保留失败。',
    );
  }
  if (/replay_current|(?:^|[^_])replay\s*:/i.test(detail)) {
    lines.push(
      '若原意是“当前这张非 Power、非 Event 卡在原效果结束后再次完整结算 N 次”，保留整段原效果，并把错误的 replay:true、replay:N 等价迁移为独立数组项 {replay_current:N,when?:原条件}。若 replay_current 使用“条件 ? N : 0”三元式，把条件只保留在 when，并把 replay_current 改成正数 N；不得同时重复两份条件。禁止删除重放、改成零值占位、只增加伤害，或误改为影响后续卡牌的 double/patch_card/card_rule。若 replay_current 被错误放进触发器、弃牌效果、状态、遗物、能力、敌人、召唤或 schedule，应依据原描述把机制迁回实际卡牌主效果；这些入口没有当前牌，不得留下 replay_current。',
    );
  }
  if (/ONLY_MODIFIERS_ALLOWED|passive 与状态 hold 只能包含持续修饰或出牌规则/i.test(detail)) {
    lines.push(
      '报错的 passive/hold 项只能保留 {modify:属性,唯一运算:数值} 或 {card_rule:规则,...}。modify_summon、modify_summon_effect、damage、block、resource、apply_status 等都是一次性操作，绝不能留在 passive/hold；只能在允许字段内按原时机等价迁移，保留原卡牌类型和持续机制，否则保留失败。',
    );
  }
  if (
    /(?:cards|artifacts|relics|player_abilities)\[\d+\]\.trigger\.effects[^;；\n]*(?:持续规则只允许用于 passive|MODIFIER_NOT_ALLOWED|modifier)/i.test(
      detail,
    )
  ) {
    lines.push(
      '报错的是卡牌、遗物或能力的非 passive 根 trigger，却在 effects 中放了持续 modify/card_rule。若 description 表达的是持续规则，必须把同一根 trigger 的 on 改为 "passive"，原样保留 modify/card_rule 的属性、数值、limit/extra/筛选，并删除只属于事件触发的 scope/ordinal/n/event/phase/reason/source_kind/source_id 等筛选；仅当删除这些字段确实不改变原条件和时机才可迁移；“第 N 次/某事件时”不能删除或改写为持续规则，无法等价则保留失败。若 description 表达的是事件当下收益，则保留原 on 与事件筛选，把 effects 改为描述中可唯一确定的一次性公开操作。不能只删除 event 后把 card_rule/modify 原样留在非 passive 触发器，也不能用空 effects 或 0 值占位。',
    );
  }
  if (
    /(?:enemy|enemies\[\d+\])\.actions\[\d+\][^;；\n]*(?:持续规则只允许用于 passive|MODIFIER_NOT_ALLOWED|modifier)/i.test(
      detail,
    )
  ) {
    lines.push(
      '敌人 action 是一次性行动，不能直接包含 modify/card_rule。若原行动要给予一段时间的持续增伤、减伤或规则，保留原数值与持续语义：把该项改成 apply_status，引用同一 battle.statuses 中已登记、triggers.hold 含对应 modify/card_rule 的状态；若尚无等价状态，就补齐唯一的新状态定义及明确 stacks_change。不要把行动改成 passive，也不要把持续收益删掉。',
    );
  }
  if (
    /player_lust_effect[^\n;；]*(?:MODIFIER_NOT_ALLOWED|持续规则只允许用于 passive|规则字段不符合浅层 effects 契约)/i.test(
      detail,
    )
  ) {
    lines.push(
      'player_lust_effect 是满溢时的一次性结算，不能直接包含 modify/card_rule。若候选描述的是强化当前召唤物，保留原数值并改成独占项 {modify_summon_effect:{selector:{owner:"self",pick:"all"},stat:"damage",add:原数值}}（强化生命、格挡或行动次数时按完整契约改用 modify_summon）；若确实要持续影响玩家或未来效果，则改成 {apply_status:"稳定英文状态ID",stacks:层数,to:"self"}，并在本结果 statuses 中补齐同 ID 的完整可执行定义。两条路线只能按原描述择一，绝不能引用未登记状态。',
    );
  }
  if (!numericPoolMisreadAsStatus && /(?:status|triggers\.(?:apply|stack|tick|remove|hold))/i.test(detail)) {
    lines.push(
      isTowerRewardStatusError
        ? '状态 apply/stack/tick/remove 的值直接是一次性浅层效果；hold 只放 modify/card_rule 持续规则，不要再包一层 effects。奖励候选引用的一个或多个新状态由该候选自身同级 statuses:[完整定义...] 闭合，不使用节点根 statuses、reward.statuses 或 payload.battle.statuses 代替；定义之间可以互相引用，但都必须从候选的真实效果沿依赖链可达。'
        : '状态 apply/stack/tick/remove 的值直接是一次性浅层效果；hold 只放 modify/card_rule 持续规则，不要再包一层 effects。每个 apply_status、remove_status、active status 与 status 公式引用的非预设 ID 都必须在该内容所属的状态定义容器中恰好登记一次；修复时补齐原机制需要的完整状态定义，不能只造一个没有维护逻辑的空标记状态，也不能仅删除引用来掩盖错误。',
    );
  }
  if (/UNKNOWN_STATUS|unregistered status|引用了未注册状态|状态未注册/i.test(detail)) {
    if (numericPoolMisreadAsStatus) {
      lines.push(
        `${numericPoolMisreadAsStatus} 是角色数值池，不是状态 ID，绝不能为它补造状态定义。若原描述是清空格挡，把 remove_status:"block" 等价改为 {set_block:0,to?:原目标}；若是增加或减少格挡，分别使用 block 或 set_block 的数值公式。energy/hp/lust 也必须使用各自数值操作，不能写入 apply_status/remove_status。保持原目标和其他机制不变。`,
      );
    } else {
      if (isTowerRewardStatusError) {
        lines.push(
          '本次未注册状态来自爬塔节点 reward 候选，不属于节点 payload 或节点根部。对每一张引用新状态的具体奖励卡、遗物或道具，在该候选自身同级添加 statuses:[所需全部完整定义]；一个候选可登记多个互相引用的状态，领取时程序会一次原子登记。即使同一奖励池有多个候选引用同一状态，也要让每个候选各自闭合，因为玩家最终可能只取得其中任意一个。绝不能把 status/statuses 放到节点顶层、reward 容器或 payload.battle.statuses。',
        );
        lines.push(
          '从候选 effects、trigger、discard_effects 和公式的直接状态引用开始，沿每个新状态 triggers 中的引用继续展开，直到全部依赖都已存在于当前游戏事实或该候选 statuses。数组中每个定义都必须沿这条依赖链真实可达、ID 完全一致且规则可执行；不能放 null、空占位、未使用定义或仅有叙事的标记。已有同 ID 同机制状态直接复用，不再重复携带。',
        );
      } else {
        lines.push(
          '每个报错的未注册状态引用都必须在本次修复中闭合：若该状态承载描述中的真实机制，在该内容所属的状态定义容器补入同 ID、字段完整且可执行的唯一状态定义；若原候选没有足够信息确定等价状态规则，保留失败，不删除对应 apply_status/remove_status 效果或说明承诺。不得为了通过校验而把它随意改名成另一个已存在但机制不同的状态；只有名称、描述和执行规则确实相同才可复用已有 ID。绝不能保留原引用、换成另一个未登记 ID，或只写一个没有真实规则的空标记状态。',
        );
      }
      if (
        /(?:opening\.choices|开局馈赠)[^;；\n]*(?:UNKNOWN_STATUS|引用了未注册状态|状态未注册|unregistered status)/i.test(
          detail,
        )
      ) {
        lines.push(
          '本次未注册状态来自 opening 馈赠候选。若某张奖励卡、遗物或道具引用 player.statuses 尚无的一个或多个新状态，必须在那个具体候选同级添加 statuses:[全部完整定义]；领取时程序会原子登记。若与 player.statuses 已有机制完全相同则直接复用。不要给 reward 容器写 statuses，也不要把未选择候选的状态提前塞进全局 player.statuses。',
        );
      }
      if (/battle\.player_lust_effect[^;；\n]*引用了未注册状态/i.test(detail)) {
        lines.push(
          '本次未注册状态来自 player_lust_effect，它属于初始化后玩家真实持有的战斗内容，不是奖励候选。保持 apply_status 的 ID、层数、目标和描述承诺不变，在顶层 player.statuses 新增同 ID 的完整可执行定义；绝不能给 player_lust_effect 添加 status 外壳，也不能把它路由到 opening 奖励候选。',
        );
      }
    }
  }
  if (/triggers\.hold/i.test(detail)) {
    lines.push(
      '若 hold 中误放 modify_summon_effect 等一次性操作，不能原样保留，也不能复制到 Power/遗物/能力的 passive：按机制时机移到 triggers.apply 或 triggers.stack，或改由卡牌/能力的真实非 passive 事件 trigger 执行。hold 与 passive 本身只描述持续生效的 modify/card_rule。',
    );
    lines.push(
      '若原状态把事件监听误写成 hold:{on:"事件名",effects:原效果} 或 hold:[{on:"事件名",effects:原效果}]，保留原事件、效果、数值、目标与状态生命周期，把原效果机械移动到同一状态的同级 triggers.事件名；例如 on:"attack_played" 改成 triggers.attack_played。不得删除事件效果，不得改成空 hold，也不得用另一种伤害、成长或 0 数值占位替代。',
    );
  }
  if (/triggers\.(?:apply|stack|tick|remove)/i.test(detail)) {
    lines.push(
      '若 apply/stack/tick/remove 中误放 modify 或 card_rule，必须把这条持续规则原样移动到同一状态的 triggers.hold；不能只改 modify 的属性名后仍留在一次性触发槽。apply/stack/tick/remove 只执行 damage、heal、block、energy、状态、资源、牌区、召唤控制等一次性操作。',
    );
  }
  return lines.join('\n');
}

function effectAuthoringFinalPreflight(): string {
  return [
    '[输出前结构自检；不改变题材、机制或数值设计]',
    '逐项核对每个 effects：主操作及同级字段必须符合上方完整语法；targets 必须是 {mode:...} 对象；不存在的字段、公式变量和空占位全部修正。',
    '逐项核对状态：所有引用 ID 已登记；block/energy/hp/lust 及其上限是数值池，不是状态，清空格挡必须写 set_block:0 而不是 remove_status:"block"；modify/card_rule 只在 passive 或 triggers.hold；apply/stack/tick/remove 与状态事件键不含持续规则。状态事件直接写为 triggers.事件名:浅层效果，不包 {on,effects}，也不塞进 hold；事件名必须来自完整白名单。每个 card_rule:"replay" 必须同层同时有 limit 与正整数 extra；card_rule:"free" 必须有 limit 且不写 extra。modify 的 add/subtract/multiply/divide/set 只能是普通数值，或在状态 hold 中使用只含 stacks 与四则运算的公式，绝不能使用 history、资源、牌数或其他动态对象；不得用空标记状态伪装运行时计数。',
    '逐项核对召唤、多敌条件与 Power：召唤本体属性使用 modify_summon，行动输出使用 modify_summon_effect；两者都是一次性修改，绝不位于 passive/hold；spawn_summon.modifiers 的六种 modifier 值必须是有限数字，绝不能写 self/opponent、公式、对象或目标名。召唤 selector 没有匹配对象时自然无效果，不必额外判断。召唤 action/ability 作用自己时只写 to:"self"，绝不能再加 targets；要选择一个或多个召唤，必须使用 damage_summon/heal_summon/modify_summon 等操作内部的 selector，普通 targets 永远不含 owner。确有条件收益时可用 self.has_summon/opponent.has_summon、self.has_ally/opponent.has_ally、self.alive/opponent.alive，或相应的 summon_count/ally_count 数量字段；布尔字段直接使用或加 !，禁止裸 summon_count、ally_count 与自造近义字段。Power 的即时 effects 与事件 trigger 各在根部，passive 只含 modify/card_rule；一张 Power 同时立即召唤和持续提高召唤上限时，spawn_summon 留在根 effects，modify:"summon_capacity" 必须放进同级 trigger:{on:"passive",effects:...}，绝不能把两者都塞入根 effects。只有 trigger 的 Power 必须完全省略根 effects，不能写 effects:[]、0 数值规则或其他占位；description 声称每回合或某事件发生时，就必须使用对应的真实非 passive trigger。apply_status 若用于让 Power 获得持续状态，必须放在 Power 根 effects，不能放在 passive。',
    '逐项核对卡牌触发与复杂操作：正式卡与 creates 模板都只有 type:"Power" 可以有根 trigger，Attack/Skill/Event/Curse 全部不写 trigger；Curse 必须完全没有 cost 字段，cost:null 也必须删除。Attack/Skill/Event 以及不靠 trigger 生效的 Power 即使存在 discard_effects，也必须有非空根 effects；只有 Curse 可按其不可打出语义省略根 effects。模板还绝不嵌套 creates，也不允许 add_card/ensure_card 生成模板自己。spawn_enemy 必须独占 effects 数组项，count/capacity 必须位于 spawn_enemy 对象内部，绝不能与 spawn_enemy 同级。',
    '逐项核对能力：每项能力根部只能有显示字段、可选 creates 与唯一 trigger:{on,effects}；trigger.effects 必须非空。trigger 可选筛选键只用 scope/ordinal/n/event/phase/reason/source_kind/source_id/damage_type/card_type/template_id/card_instance_id/actor_id/target_id，绝不能在 trigger 根部写 when；有条件触发时把同一 when 写到 trigger.effects 内每个真实操作项。source_kind 只用 card/relic/status/ability/enemy_action/system/summon/enchantment/affliction，不存在 enemy；敌人行动不是卡牌，不能用 card_played 监听另一名敌人的行动。passive 只能含 modify/card_rule，不得放即时收益、when 或事件筛选；无法用公开触发器表达的可选能力不要生成，更不能用 0 数值或空数组占位。',
    '能力或遗物生成临时牌时，creates 必须与 trigger 同级放在内容根部，绝不能写进 trigger；add_card/ensure_card 的值直接是同一内容 creates 中的模板 ID 字符串，count/minimum 与它同级，不能把 {id,count} 对象塞进操作值。',
    '逐项核对敌人行动：action 与 lust_effect 都是一次性结算，绝不能直接包含 modify/card_rule。若行动要获得持续规则，必须改为 apply_status，并在同一 battle.statuses 中登记由 triggers.hold 实现该规则、且寿命明确的状态；不要把 action 改成 passive。',
    '逐项核对奖励状态：每张奖励卡、遗物或道具若引用当前游戏事实中没有的新状态，该候选自身必须同级携带 statuses:[全部完整定义]；从候选直接引用沿状态定义依赖链可达的每个新 ID 都恰好闭合，数组内不能有未使用定义。不能依赖同奖励池的另一候选、节点 payload 或尚未领取的战斗状态代为登记；已有同机制状态直接复用。旧 status 只读兼容，修复输出统一使用 statuses。',
    '逐项核对目标与活动状态：to 只能是 self/opponent；全体与指定实体必须改用 targets 对象，不能把 all 或实体 ID 写进 to。敌人的 status_effects 只列实际生效状态，每项 stacks 必须是正整数；0 层状态不写入活动列表，定义仍保留在 battle.statuses。',
    '逐项核对公式、目标与描述：draw/scry/seek 只操作玩家牌区，因此这些效果项绝不能写 to、targets、from、pick、count 或 amount；敌人来源要干扰玩家牌区也直接写 draw/scry/seek，不添加 opponent。公式只能使用上方完整白名单中的变量与 floor/ceil/abs/min/max 五个纯数学函数；不支持 Math.floor、对象方法或其他函数。hp/max_hp/lust/max_lust/energy/max_energy/block/hand_size/draw_pile_size/discard_pile_size/exhaust_pile_size/status/resource 与状态统计都必须逐个写出 self. 或 opponent. 前缀，绝不能裸写；只有 discard_count、spent_energy、x_value、turn_number 和三种本回合出牌计数器不加角色前缀，只有状态触发器中的 stacks 可裸写。hits 永远只能是字面正整数，不能写公式、三元式或变量；条件性多段攻击要拆成多个 damage 效果项，并在额外段同级写 when。self 与 opponent 是并列根对象，读取敌方状态必须写 opponent.status.ID.stacks，绝不能写 self.opponent.status；历史统计必须写 {history:{metric,...}}，不能写 self.history 点链。逐项搜索每个 card_rule：它的值必须直接是公开规则字符串，limit/extra/筛选与它同级，绝不能把 card_rule 写成 {rule,limit,extra} 对象；对象里没有明确合法 rule 时不能猜。结构自检必须保留原条件、时机、目标、数值和收益；仅允许语义等价的结构改写。没有可执行变量或触发器能等价表达时保留失败，不删除条件、不改写 description，也不替换成另一机制；禁止自造变量，也禁止用 draw:0、damage:0、空 trigger 或其他无效果占位伪装实现。',
    '逐项核对随机与召唤主人：公式没有 random()/chance() 等概率函数；牌区随机只用 pick:"random"，敌人行动随机只用 action_mode。召唤 action 要让主人获得收益必须使用 summoner_effects，不能写 targets:{mode:"owner"}；召唤作用自身只写 to:"self"。',
    '逐项核对牌区数量：pick:"all" 时 discard/exhaust/recover/copy/double/remove_card 的操作值也必须是 "all"；操作值是数字时 pick 只能使用 random/choose/left/right/top/bottom 中与 from 相容的方式。卡牌自身打出后消耗写卡牌根 exhaust:true，不要在 effects 中按名称再次选择并 exhaust 自己。',
    '逐项核对奖励类别：cards/card 只放 Attack/Skill/Power/Event/Curse，绝不能放 type:"Relic"；遗物只放 artifacts/artifact，道具只放 items/item。一个遗物也不能同时复制进卡牌与遗物数组。',
    '最后做一次纯结构扫描：apply_status/remove_status/card_rule/modify/damage/heal/block/energy/lust/draw/scry/seek/discard/exhaust/recover/reduce_cost/copy/double/auto_play/remove_card 的操作值不得再包对象；数值、状态 ID 或规则名直接作为该键的值，选择器与修饰字段放在同级。浅层效果项不得再嵌套 effects 或 trigger；stacks_change 与 tick_timing 只能在状态根部；spawn_enemy 的 count/capacity 只能在 spawn_enemy 对象内部；敌人 targets 只含 mode/id/count/allow_repeat/retarget，召唤筛选才使用 selector 与 include_untargetable。发现任一项时先就地改成上方唯一规范形状，再输出 JSON。',
    '逐项核对完整性：每个要求的节点、敌人基础字段、行动、奖励候选和请求标识都保留且数量正确。只修结构，不因评分或构筑偏好改写自由设计。',
  ].join('\n');
}

function towerBattleDslContract(): string {
  return [
    '[战斗效果结构边界]',
    formatCompactEffectAuthoringContract(),
    '敌人来源中 self=该敌人，opponent=玩家；玩家来源中 self=玩家，opponent=敌人。不要按叙述句子的主语猜目标。',
    '后台节点的 payload.battle 是本节点新增战斗内容，不是完整玩家快照；闭合字段只允许 enemy、enemies、statuses、player_abilities、player_status_effects。统一使用 enemies:[敌人对象]，即使只有一个敌人也这样写；不要同时再写 enemy，更不得复制当前玩家的 core/cards/artifacts/items/player_lust_effect/level/exp。每个敌人的固定基础结构是 {id,name,emoji,hp,max_hp,lust,max_lust,actions:[...]}：hp/lust 是当前值，max_hp/max_lust 是正数上限。actions 必须是至少一项的 JSON 数组，绝不能写成以行动 id 或名称为键的对象映射；每项使用 {id?,name,emoji?,description?,weight?,when?,creates?,effects}，其中 name 与 effects 必填。abilities、status_effects、lust_effect、resources、当前姿态与姿态槽 都是可选扩展，不得代替基础字段。',
    '多个敌人时，enemies 每项必须有互不重复的稳定英文 id，只能使用字母、数字和下划线且不能以数字开头；不要使用冒号、短横线、空格或中文。敌人 action 只写 effects，不写 trigger。敌人 abilities 每项必须有稳定英文 id、中文 name/source/description，以及 trigger:{on:"触发时机",effects:浅层效果}；不得把 trigger 塞进 effects 数组项，也不得同时保留同级 effects。narrate 不能出现在敌人 action、ability 或 lust_effect；动作演出说明写入 description，实际行动台词主动填写 action.dialogue；能力必须有真实可执行战斗效果；纯持续保护能力可以用合法 protection 配合 trigger:{on:"passive",effects:{}}，不得凭空添加格挡占位。',
    '敌人行动模式只允许 random、probability、sequence、sequence_then_probability。random 不需要配置；probability 使用 action_config:{probability:{"行动引用":正数权重}}；sequence 使用 action_config:{sequence:["行动引用"]}；混合模式同时提供两项。“行动引用”优先使用该 action 的稳定英文 id，没有 id 时才逐字使用 name，不得引用 description 或未登记行动。probability 必须非空，其中每个权重都必须是严格大于 0 的有限数字；只在 sequence 阶段使用的行动可以不写入 probability，绝不能用 0 表示禁用。',
    '持续被动使用 trigger:{on:"passive",effects:{modify:"damage|damage_taken|lust|lust_taken|heal|block|summon_capacity|draw_per_turn",add|subtract|multiply|divide|set:数值}}；modify 不得是对象。',
    'modify 与出牌规则都是持续规则：只能放在独立 ability/遗物/Power 卡的 trigger.on="passive"，或状态 triggers.hold 中；不能放进敌人 action、普通卡牌 effects、欲望效果、turn_start 等非 passive 触发。Power 的 passive 会在打出后登记为本场能力。反过来，passive 与状态 triggers.hold 只能放 modify/出牌规则，damage、block、draw、apply_status 等即时效果应使用真实事件 trigger，或状态的 tick、apply、stack、remove、threshold_execute。',
    '卡牌数值修改写成独立项，例如 {modify_card:"damage",multiply:1.5,from:"hand",pick:"random"}；不得嵌套 modify_card，也不得改 hits。',
    '自定义状态先登记在本节点自己的 battle.statuses：{id,name,emoji,type,triggers}；状态不能按中文名称自动生效；白名单内置 ID 可直接引用，其余 ID 只要当前完整游戏事实中没有同 ID 定义，本节点 action、ability、lust_effect、status_effects、公式或奖励引用它之前就必须在本节点 battle.statuses 写出完整定义。批量结果中的每个节点各自闭合，绝不能借用同批另一个节点的定义。triggers 的生命周期键 apply/stack/tick/remove/hold/threshold_execute 与事件键 battle_start/ability_gain/turn_start/turn_end/card_played/attack_played/skill_played/power_played/on_discard/on_exhaust/on_draw/on_shuffle/take_damage/take_heal/deal_damage/deal_heal/lust_increase/lust_decrease/deal_lust_increase/deal_lust_decrease/gain_buff/gain_debuff/lose_buff/lose_debuff/enemy_gain_buff/enemy_gain_debuff/enemy_lose_buff/enemy_lose_debuff/gain_block/lose_block/defeated 都直接对应浅层效果，不再包 effects 或 {on,effects}。hold 只放持续 modify/card_rule；所有事件键只放一次性效果。敌人 status_effects 只引用已登记或白名单预设状态 id 与当前 stacks。',
    '敌人欲望效果如果存在，写 lust_effect:{name,description?,effects}，不写 trigger；无欲望体系时直接省略，绝不写空壳。任何非预设状态 id 都必须先在 battle.statuses 注册。初始 enemies 的每项可选 escape_when:"条件公式"：满足后先显示准备逃跑，至少预警一回合；头顶倒计时为0时，在本回合结束时播放逃跑动画后离场；只用公开 self/opponent 数值、状态、summon_count、ally_count 等条件，不能写叙事或未公开变量。ally_count 只数其他存活非召唤战斗实体，不含条件主体；召唤数量另用 summon_count。初始 enemies 的每项还可选 defeat_reward:{cards?:完整卡牌数组,artifacts?:完整遗物数组,items?:完整道具数组,gold?:非负整数}，仅该原始敌人实际被击败时发放；逃跑、增援、分裂或复制敌人都不产生这份掉落。动态增援固定写成独占项 {spawn_enemy:{完整敌人字段...,count?:数量,capacity?:场上容量}}，count/capacity 绝不能放到 spawn_enemy 外层；增援必须重复提供完整敌人基础结构与非空 actions 数组，只有有欲望体系才附带 lust_effect:{name,effects}，不得写 defeat_reward。敌人治疗或强化指定同阵营实体时，实体 ID 写入 targets:{mode:"by_id",id:"敌人ID",team:"self"}，to 写 "self" 或省略，绝不能把实体 ID 写进 to；玩家选择敌方实体时用 team:"opponent" 且 to:"opponent"。targets.team 只能是 self 或 opponent，必须和 to 一致。',
    '敌人 status_effects 只登记当前确实拥有的活动状态，每项 stacks 必须是正整数；尚未施加或 0 层状态只在 battle.statuses 保留定义，不得用 status_effects 中的 stacks:0 占位。',
    '普通 apply_status 只能作用于玩家或战斗敌人，固定写成 {apply_status:"状态ID",stacks?,to?}；不能在其值内嵌 id/stacks/targets，也不能用 targets 选召唤。给召唤施加状态必须改用独占项 {apply_summon_status:{selector,id,stacks?}}，非预设状态定义仍先登记在 payload.battle.statuses。',
  ].join('\n');
}

function towerRewardDslContract(): string {
  return [
    '[奖励可执行结构]',
    '任何奖励卡都必须有稳定英文 id、中文 name、type、rarity、cost（Curse 除外）和可执行浅层 effects；描述中的数值不能代替 effects。',
    '奖励类别必须按真实内容分类：cards 只放 type 为 Attack/Skill/Power/Event/Curse 的卡牌；artifacts 只放带 rarity 与 trigger 的遗物；items 只放带 count 与 effects 的消耗道具。type:"Relic" 不是卡牌类型，遗物绝不能塞进 cards；同理卡牌和道具也不能借用错误类别。',
    'Power 是持续能力牌：无条件持续规则写 trigger:{on:"passive",effects:modify或card_rule}，打出后会登记为本场能力；passive 不得携带任何事件筛选，也绝不能含 apply_status、damage、block、energy、draw 等一次性操作。需要每回合、每次出牌、首次或每 N 次等时机时，使用对应的真实事件 trigger 及其筛选。Power 不允许 battle_start。若打出当下还应结算一次伤害、格挡、抽牌、资源或其他即时效果，可以同时保留根 effects；它与 trigger 分别执行，不要互相嵌套。自由设计纯即时牌可选 Skill 或 Attack；已有或明确要求的 Power 不因缺少触发器而改类型，无法等价实现则保留失败。Power 也可以只在根 effects 中施加已在玩家全局状态表登记、或由同一奖励候选 statuses 提供完整定义的持续状态；此时不再给 passive 重复放 apply_status。',
    '奖励遗物必须有稳定英文 id、中文 name、rarity 与 trigger:{on,effects}；奖励道具必须有稳定英文 id、中文 name、count 与浅层 effects。',
    '奖励卡、遗物或道具引用当前未登记的新状态时，必须在那个具体候选对象同级附带 statuses:[完整状态定义...]；一项或多项都使用该数组。从候选的 effects、trigger、discard_effects 和公式直接引用开始，沿状态定义内的引用展开，数组必须闭合这条依赖链，且每项都真实可达。领取时程序会原子登记全部定义并从最终持有内容移除外壳。已有同 ID 同机制状态只复用。同一奖励池中若多个互斥候选引用同一新状态，每个候选都必须独立闭合；status/statuses 绝不能放到节点顶层、reward 容器或 payload。旧单个 status 仅为兼容读取，新输出不要使用。',
    'statuses 不是每个奖励候选都要填写的固定字段。没有引入并引用新状态的候选必须完全省略它，绝不能输出 status:null、statuses:null、空数组、未被引用定义或普通数值内容的占位状态。',
    '奖励卡、遗物、道具仍可自由设计题材、数值与机制，但必须能由当前效果系统直接执行。',
    '奖励描述不得承诺当前 DSL 无法执行的条件或效果。若所需统计量不在公式白名单、所需时机不在 trigger 白名单，应改为另一种完整可执行的创意；不得发明公式变量，也不得用 draw:0、damage:0、空 effects 或空 trigger 充当占位。',
  ].join('\n');
}

/** Soft creative method shared by enemies and rewards; it deliberately contains no copyable content preset. */
function towerArchetypeDesignMethod(): string {
  return [
    '[流派与敌人创作方法]',
    towerGameplayDesignGuidance(),
    '先读取玩家明确要求、当前卡组的流派画像与本轮剧情。明确指定的流派必须用真实 effects、trigger、状态、资源、牌区、召唤或规则字段形成“启动→运转→收益”；卡名、emoji、description 和题材换皮不算实现。未指定流派时不强行套图谱，允许通用散卡与剧情需要的简单机制。',
    '卡牌内容应让启动端能在正常抽牌中实际进入循环，并提供可兑现收益；可以深化当前流派、连接相邻机制、渐进转向或补独立短板，不按标签数量评价质量。',
    '只有存在真实欲望施压、积累、读取或转化入口时才生成欲望效果；满溢通常积累数回合，主副轴的兑现都须明显超过普通单卡：以同等回合与费用用于直接输出能取得的累计收益为参照，并计入触发后的持续收益，不能只多一点；不用固定数值、倍率上限或硬编码终结冒充兑现。',
    '召唤作为核心时必须真实使用 spawn_summon，并让召唤实例通过行动、触发、援护、资源、强化、选择或离场关系参与玩法；普通伤害与格挡仅改写召唤措辞不成立。',
    '敌人先把剧情身份转成可执行动作，再选择一个主压力与零到两个有因果协同的副机制；按铺垫、施压、兑现、保护或调整组织节奏，并提供可观察反制。简单表示核心规则容易读懂，不表示无成长、无节奏的重复攻击；不要给每个敌人套同一套行动表。',
    '敌人核心行为删去描述后仍须从可执行字段中成立；生命、欲望、控制、成长、格挡、召唤与牌库压力共享数值预算，增加一种强压力时减少其他压力。',
  ].join('\n');
}

/** Complete gameplay prompt with only repeated state/topology kept compact. */
export function formatTowerNodeGenerationPrompt(
  job: TowerGenerationJobDescriptor,
  context: TowerGenerationContext,
): string {
  const lines = [
    '[爬塔后台节点生成]',
    `node_id=${job.nodeId} request_id=${job.requestId} revision=${job.basedOnRevision}`,
    `act=${job.act} floor=${job.floor} kind=${job.kind}`,
    `content_seed=${job.contentSeed} reward_seed=${job.rewardSeed}`,
    `玩家难度=${requireDifficulty(context.difficultyPercent)}%；幕/层成长已计入本节点总预算，不另乘倍率。`,
    '只生成这个节点。不要改变地图、模式、run、玩家现有卡组或已经结算的内容。',
    'title 和 narrative 必须是中文；它们只描述当前节点，不代替或约束使用原预设生成的剧情正文。',
    resultContractFor(job, context.enemyBudgets?.[job.nodeId] ?? context.enemyBudgetEnvelope),
  ];
  if (isBattleRunNode(job.kind)) lines.push(towerBattleDslContract());
  else if (job.kind !== 'rest') lines.push(formatCompactEffectAuthoringContract());
  if (job.kind !== 'rest') lines.push(towerRewardDslContract());
  lines.push(towerArchetypeDesignMethod());
  const completeMvu = completeRequirementContext(context.completeMvuContext);
  const world = completeMvu ? null : compactContext(context.worldContext, 8000);
  const player = completeMvu ? null : completeRequirementContext(context.playerContext);
  const balance = completeRequirementContext(context.deckBalanceContext);
  const lineage = completeRequirementContext(context.enemyLineageContext);
  const custom = completeRequirementContext(context.customRequirements);
  const references = completeRequirementContext(context.contentReferenceContext);
  if (completeMvu) lines.push(`[当前完整游戏事实]\n${completeMvu}`);
  else {
    if (world) lines.push(`[世界与当前进度]\n${world}`);
    if (player) lines.push(`[玩家状态]\n${player}`);
  }
  if (balance) lines.push(`[当前卡组事实与构筑分析]\n${balance}`);
  if (lineage) lines.push(`[敌人谱系连续性]\n${lineage}`);
  if (custom) lines.push(`[玩家额外要求]\n${custom}`);
  lines.push(
    ...(isBattleRunNode(job.kind)
      ? [
          '[遭遇玩法复核，仅内部推演]按当前剧情与玩家要求，检查人数与职责、前4至6回合的成长/爆发、减益兑现、先击杀不同目标的后果。人数严格遵守本节点程序预定的1至5名敌人；选择单敌时也要有回合压力。同类谱系保留身份，改变具体打法。推演只落实到已有字段，不输出分析，不用模板补牌或改玩家构筑。',
        ]
      : []),
    effectAuthoringFinalPreflight(),
    references
      ? `[现有内容精确 ID 表]\n${references}\n复用现有状态、资源或内容时必须逐字复制表内 ID，不能删尾缀、改成近义词或只凭中文名猜测；想要不同机制就创建新英文 ID，并在正确容器完整登记。`
      : '',
    '只输出一个 JSON 对象，不要用 XML 标签或 Markdown 代码块包裹。',
    `JSON 顶层固定为 spec="${TOWER_NODE_RESULT_SPEC}"、node_id、request_id、based_on_revision、kind、title、narrative、payload，可选 reward。`,
    '不要输出解释、思考过程、变量命令、选项外正文或第二个结果。',
  );
  return lines.join('\n');
}

/** Generate the complete currently reachable window in one model call. */
export function formatTowerNodeBatchGenerationPrompt(
  batchId: string,
  jobs: readonly TowerGenerationJobDescriptor[],
  context: TowerGenerationContext,
): string {
  if (!batchId.trim()) throw new Error('tower batch id is invalid');
  if (jobs.length < 1 || jobs.length > 3) throw new Error('tower batch must contain one to three nodes');
  const revisions = new Set(jobs.map(job => job.basedOnRevision));
  if (revisions.size !== 1) throw new Error('tower batch revisions must match');
  const lines = [
    '[爬塔后台批量节点生成]',
    `batch_id=${batchId} revision=${jobs[0].basedOnRevision} node_count=${jobs.length}`,
    '以下节点属于玩家当前真正可达的预生成窗口。必须在这一次响应中全部生成，不要拆成多次请求，也不要生成清单以外的地图节点。',
    ...jobs.map((job, index) =>
      [
        `[节点 ${index + 1}] node_id=${job.nodeId} request_id=${job.requestId}`,
        `act=${job.act} floor=${job.floor} kind=${job.kind}`,
        `content_seed=${job.contentSeed} reward_seed=${job.rewardSeed}`,
        resultContractFor(job, context.enemyBudgets?.[job.nodeId] ?? context.enemyBudgetEnvelope),
      ].join('\n'),
    ),
    `玩家难度=${requireDifficulty(context.difficultyPercent)}%`,
    '每个结果的 title 和 narrative 使用中文，只描述自己的节点；不得改变地图、模式、run、玩家已有内容或其他节点。',
  ];
  if (jobs.some(job => isBattleRunNode(job.kind))) lines.push(towerBattleDslContract());
  else if (jobs.some(job => job.kind !== 'rest')) lines.push(formatCompactEffectAuthoringContract());
  if (jobs.some(job => job.kind !== 'rest')) lines.push(towerRewardDslContract());
  lines.push(towerArchetypeDesignMethod());
  const completeMvu = completeRequirementContext(context.completeMvuContext);
  const world = completeMvu ? null : compactContext(context.worldContext, 8000);
  const player = completeMvu ? null : completeRequirementContext(context.playerContext);
  const balance = completeRequirementContext(context.deckBalanceContext);
  const lineage = completeRequirementContext(context.enemyLineageContext);
  const custom = completeRequirementContext(context.customRequirements);
  const references = completeRequirementContext(context.contentReferenceContext);
  if (completeMvu) lines.push(`[当前完整游戏事实]\n${completeMvu}`);
  else {
    if (world) lines.push(`[世界与当前进度]\n${world}`);
    if (player) lines.push(`[玩家状态]\n${player}`);
  }
  if (balance) lines.push(`[当前卡组事实与构筑分析]\n${balance}`);
  if (lineage) lines.push(`[敌人谱系连续性]\n${lineage}`);
  if (custom) lines.push(`[玩家额外要求]\n${custom}`);
  lines.push(
    ...(jobs.some(job => isBattleRunNode(job.kind))
      ? [
          '[遭遇玩法复核，仅内部推演]逐个战斗节点检查人数与职责、前4至6回合的成长/爆发、减益兑现、先击杀不同目标的后果；比较同批与近期遭遇，在程序预定人数内主动变化职责、行动周期和核心联动。人数严格遵守本节点程序预定的1至5名敌人；选择单敌时也要有回合压力。推演只落实到已有字段，不输出分析，不用模板补牌或改玩家构筑。',
        ]
      : []),
    effectAuthoringFinalPreflight(),
    references
      ? `[现有内容精确 ID 表]\n${references}\n复用现有状态、资源或内容时必须逐字复制表内 ID，不能删尾缀、改成近义词或只凭中文名猜测；想要不同机制就创建新英文 ID，并在正确容器完整登记。`
      : '',
    `[最终逐节点结构复核]\n${jobs.map(job => `${job.nodeId} (${job.kind})：${resultContractFor(job)}`).join('\n')}`,
    '最后机械扫描：所有内容说明字段只能写 description，绝不能写 desc。每个 trigger.on 不是 passive 的真实事件触发器中，effects 只能放该时机结算的一次性操作，绝不能放 modify 或 card_rule；“首次打出攻击后追加伤害”直接写 damage，“获得格挡/能量”直接写 block/energy。modify 与 card_rule 只能进入 on:"passive" 或状态 triggers.hold。card_type 只用 Attack/Skill/Power/Event/Curse；规则适用于全部卡牌时省略 card_type，绝不能写 Card/Any/All，也不能写空 name、空 tag、racial 等占位筛选。',
    ...(jobs.some(job => isBattleRunNode(job.kind))
      ? [
          `[最终逐节点数量复核]\n${jobs
            .filter(job => isBattleRunNode(job.kind))
            .map(job => {
              const budget = battleRewardBudgetFor(job);
              return `${job.nodeId}: reward.card 恰好 ${budget.cards.candidates} 项，reward.artifact 恰好 ${budget.artifacts?.candidates ?? 0} 项，reward.item 恰好 ${budget.items?.candidates ?? 0} 项`;
            })
            .join('\n')}`,
          '逐张复核奖励候选：引用新状态的候选自身必须携带完整 statuses；没有引用状态的候选不要附带 statuses。不得少写候选，也不得复制同一候选凑数。',
        ]
      : []),
    '只输出一个 JSON 对象，不要使用 XML 标签或 Markdown 代码块。',
    `顶层固定为 spec="${TOWER_NODE_BATCH_RESULT_SPEC}"、batch_id、based_on_revision、results。`,
    `results 必须恰好 ${jobs.length} 项，每个指定 node_id/request_id 各出现一次，并保持清单顺序；每项仍使用 spec="${TOWER_NODE_RESULT_SPEC}" 的完整节点结构。`,
    '不要输出解释、思考过程、变量命令、额外正文或第二个对象。',
  );
  return lines.join('\n');
}

/** One bounded retry for providers that return JSON with a non-executable node shape. */
export function formatTowerNodeStructureRepairPrompt(
  job: TowerNodeScope,
  response: string,
  error: unknown,
  existingBattle?: unknown,
): string {
  const detail = error instanceof Error ? error.message : String(error);
  const unknownField = detail.match(/([^:\n]+):\s*Unknown field:\s*([A-Za-z_][A-Za-z0-9_]*)/i);
  const unknownFieldInstruction = unknownField
    ? `校验已经明确指出路径 ${unknownField[1].trim()} 不支持字段 ${unknownField[2]}：必须从该路径删除这个字段，不得原样回填；若要保留机制意图，请拆成多个浅层 effects 项，并只给每个主操作填写它支持的元字段。`
    : '';
  const targetFieldInstruction =
    unknownField?.[2] === 'to'
      ? '敌人行动的伤害与欲望伤害默认作用于玩家，格挡与自身增益默认作用于行动者；不要为了重复默认目标而给 draw、discard、copy 等不支持目标的操作添加 to。'
      : '';
  const rewardRepairInstruction =
    isBattleRunNode(job.kind) && /reward .* requires \d+ candidates/i.test(detail)
      ? '本次错误是奖励候选数量不足：保留已有合法候选，并新写不同 id、不同机制的候选补足到本节点固定数量；不得复制同一候选凑数，也不得仍按原来的不足数量返回。'
      : isBattleRunNode(job.kind) && /tower battle reward must be an object/i.test(detail)
        ? '本次错误只定位到 battle reward 的容器类型：仅修正该节点 reward 这一槽，使其成为协议要求的对象，并保留原响应中可明确对应的合法 card/artifact/item 数组与 limits；不得把数组或标量盲目包装、不得凭空造奖励、不得修改其他字段。若无法无损判断数组元素归属，保留失败而不要猜测。'
        : '';
  const powerRepairInstruction = /ROOT_TRIGGER_REQUIRED|Power 必须|Power 的所有顶层效果/i.test(detail)
    ? '本次错误来自 Power 能力牌结构：逐张检查 reward 中 type="Power" 的卡。无条件持续规则改成 trigger:{on:"passive",effects:modify或card_rule}；每回合、每次出牌、首次或每 N 次等能力改用对应真实事件 trigger。passive 不得携带事件筛选，Power 不得使用 battle_start。若同级根 effects 表示打出当下真实发生的即时效果，可与 trigger 同时保留；不要删除合法即时效果，也不要把它塞进 trigger.effects。保留原 type；只有即时效果不足以证明类型无关，无法在允许字段内等价恢复持续机制时保留失败。不要只改描述。'
    : '';
  return [
    '[爬塔后台节点结构修复]',
    formatTowerRepairDefinitionContext(existingBattle),
    `node_id=${job.nodeId} request_id=${job.requestId} revision=${job.basedOnRevision} kind=${job.kind}`,
    `VALIDATION_ERROR=${detail}`,
    resultContractFor(job),
    ...(isBattleRunNode(job.kind)
      ? [towerBattleDslContract()]
      : job.kind !== 'rest'
        ? [formatCompactEffectRepairContract(detail), formatCompactEffectAuthoringContract()]
        : []),
    ...(job.kind === 'rest' ? [] : [towerRewardDslContract()]),
    '只补全或修正缺失、错位的结构字段，保留原有题材、身份、名称、叙事、机制意图、数值与奖励。',
    unknownFieldInstruction,
    targetFieldInstruction,
    rewardRepairInstruction,
    powerRepairInstruction,
    job.kind === 'event' && /(?:resource|resources)/i.test(detail)
      ? '事件要直接增减已注册自定义资源时，只能在对应 choice.outcome 写 resources:{"资源ID":整数变化量}。若原响应把 resource/resources 放进 outcome.reward、单数 resource 对象或 effects，保留资源 ID 与增减数值并移到 outcome.resources；reward 仍只保留 cards、artifacts、items、limits。只能引用当前完整游戏事实中已经登记的资源 ID。'
      : '',
    '如果校验错误包含“重复 ID”或“duplicate ID”，只把冲突候选的 id 改成当前游戏事实与本结果中从未出现过的稳定英文 id；不要继续沿用冲突 id，也不要借此重写题材、机制或数值。',
    '如果校验错误提到“持续规则只允许”或“hold 只能包含”，逐项检查 modify/出牌规则与即时效果：纯持续能力改成 trigger.on="passive"；hold 只保留持续规则；生命周期即时效果移动到符合原意的 tick、apply、stack、remove 或 threshold_execute。若 hold 原文包含 on+effects 事件监听，必须把原 effects 完整移动到同一状态的 triggers.事件名，绝不能删成空 hold、移成不等价生命周期或改写玩法。',
    isBattleRunNode(job.kind)
      ? '战斗节点 reward 只使用单数 card、artifact、item 与 limits；删除复数别名、choices、gold、price，并删除 request、disabled_categories、pool_revision、reroll_count 等程序运行字段。'
      : job.kind === 'shop' || job.kind === 'treasure'
        ? '商店和宝箱的节点 reward 只使用复数 cards、artifacts、items 与 limits；删除单数别名、choices、outcome、gold、price，并删除 request、disabled_categories、pool_revision、reroll_count 等程序运行字段。'
        : job.kind === 'event'
          ? '事件奖励只放在具体 choice.outcome.reward，并只使用复数 cards、artifacts、items 与可选 limits；事件节点顶层不得写 reward。'
          : '营火节点不得写 reward。',
    /action_config\.probability|positive weight|INVALID_PROBABILITY|概率权重/i.test(detail)
      ? '逐项修正 action_config.probability：每个键必须逐字引用同一敌人 actions 中已存在的稳定 id（没有 id 才用完整 name），每个权重都必须是严格大于 0 的有限数字。需要只在 sequence 阶段出现的行动可以从 probability 中省略，绝不能用权重 0 排除；sequence_then_probability 中保留在概率阶段的行动同样必须使用正权重。'
      : '',
    '战斗节点的每个敌人都必须有 actions；每个 action 必须有非空 name 和可执行 effects。effects 可以是一个效果对象，也可以是效果对象数组。敌人 action/ability/lust_effect 不能使用 narrate；纯叙事句移入 description，只有叙事而没有游戏效果的可选 ability 应整个删除，不能留下空 trigger。',
    '不得修改玩家、地图、run、节点 scope 或请求标识，不得输出解释、思考过程、Markdown、UpdateVariable 或第二个结果。',
    `原始响应：${String(response || '')}`,
    ...(isBattleRunNode(job.kind) ? ['[按本次错误修复并复核]', formatCompactEffectRepairContract(detail)] : []),
    '只输出一个满足 JSON Schema 的 JSON 对象，顶层 scope 字段必须与本请求完全相同。',
  ].join('\n');
}

export function formatTowerNodeBatchStructureRepairPrompt(
  batchId: string,
  jobs: readonly TowerGenerationJobDescriptor[],
  response: string,
  error: unknown,
  existingBattle?: unknown,
): string {
  const detail = error instanceof Error ? error.message : String(error);
  return [
    '[爬塔后台批量节点结构修复]',
    formatTowerRepairDefinitionContext(existingBattle),
    `batch_id=${batchId} revision=${jobs[0]?.basedOnRevision ?? 0} node_count=${jobs.length}`,
    `VALIDATION_ERROR=${detail}`,
    ...jobs.map(job =>
      [
        `node_id=${job.nodeId} request_id=${job.requestId} kind=${job.kind} act=${job.act} floor=${job.floor}`,
        resultContractFor(job),
      ].join('\n'),
    ),
    ...(jobs.some(job => isBattleRunNode(job.kind))
      ? [towerBattleDslContract()]
      : jobs.some(job => job.kind !== 'rest')
        ? [formatCompactEffectRepairContract(detail), formatCompactEffectAuthoringContract()]
        : []),
    ...(jobs.some(job => job.kind !== 'rest') ? [towerRewardDslContract()] : []),
    /tower battle reward must be an object/i.test(detail)
      ? '本次错误只定位到一个或多个 battle 节点的 reward 容器类型；只修正报错节点的 reward 槽为对象，保留可明确对应的原始候选与 limits，不得把数组盲目包装、不得凭空造奖励、不得改写未报错 sibling。无法无损判断时让该节点失败而不要猜测。'
      : '',
    jobs.some(job => job.kind === 'event') && /(?:resource|resources)/i.test(detail)
      ? '逐个修正事件节点的资源变化：直接写在 choice.outcome.resources，形状固定为 {"已注册资源ID":整数变化量}；不得写入 outcome.reward，不得使用单数 resource、set_resource 或 effects。保留原资源 ID、正负方向与数值。'
      : '',
    '保留原有题材、身份、标题、叙事、机制意图和数值，只修正缺失、错位、非法或不完整的结构。',
    '逐字处理 VALIDATION_ERROR 中的每条路径。若敌人 actions 是对象映射，保留每个行动内容并转换成数组；若缺少 hp/max_hp/lust/max_lust，只补齐基础数值字段；不得通过删除具有真实游戏效果的敌人、行动、能力、召唤、奖励或 trigger 来掩盖结构错误。仅当一个可选 ability 只有非法 narrate、没有任何游戏机制时，才把句子移入 description 并删除该空壳能力。',
    /action_config\.probability|positive weight|INVALID_PROBABILITY|概率权重/i.test(detail)
      ? '逐项修正所有报错的 action_config.probability：键必须逐字引用所属敌人已登记 action 的稳定 id（没有 id 才用完整 name），权重必须是严格大于 0 的有限数字。若某行动只属于 sequence 阶段就从 probability 删除该键，不得保留 0；不要删除 action 本身来掩盖错误。'
      : '',
    '不得遗漏节点、增加节点、交换 request_id，也不得修改玩家、地图、模式、run 或请求标识。',
    `原始响应：${String(response || '')}`,
    ...(jobs.some(job => isBattleRunNode(job.kind))
      ? ['[按本次错误修复并复核]', formatCompactEffectRepairContract(detail)]
      : []),
    '只输出一个满足本次 JSON Schema 的批量 JSON 对象，不输出解释、Markdown、UpdateVariable 或第二个结果。',
  ].join('\n');
}

/** Bounded repair for a structurally invalid opening gift response. */
export function formatTowerOpeningStructureRepairPrompt(
  job: Pick<TowerOpeningPromptInput, 'requestId' | 'basedOnRevision'>,
  response: string,
  error: unknown,
  existingBattle?: unknown,
): string {
  const detail = error instanceof Error ? error.message : String(error);
  return [
    '[爬塔开局馈赠结构修复]',
    formatTowerRepairDefinitionContext(existingBattle),
    `request_id=${job.requestId} revision=${job.basedOnRevision}`,
    `上一份结果未通过可执行结构校验：${detail}`,
    '保留原来的馈赠者、标题、叙事、选项主题、代价和收益意图，只修正不合法或缺失的字段。',
    'choices 必须恰好包含三项；不得缩成一项，也不得用一个 choice 同时代表多个可选馈赠。',
    '每个 choice 必须包含唯一的 id、非空 label 和 outcome 对象；description 可选。',
    'outcome 只允许 hp、max_hp、lust、max_lust、gold、card_removals、reward、deck_transforms；这些数值必须是整数且表示相对变化。max_lust 表示欲望上限的整数变化（-99..999），结算后上限至少为 1；lust 会直接改变玩家当前欲望并限制在新的 0..max_lust 之间。',
    OPENING_TRANSFORM_GUIDANCE,
    'outcome 不支持 energy、max_energy、block、status、resource、set_resource 或 effects。若原说明承诺这些无法直接结算的内容，删除非法字段并同步删除对应文字承诺，同时保留同一选项中原有的合法 reward 或其他合法收益；不得把 max_energy 猜成 max_hp。',
    'reward 只允许 cards、artifacts、items 数组；省略没有奖励的类别，不得写单个对象、数字、字符串、limits 或运行时奖励池字段。',
    formatCompactEffectAuthoringContract(),
    towerRewardDslContract(),
    towerArchetypeDesignMethod(),
    '不得修改 request_id、based_on_revision 或顶层 spec，不得输出解释、思考过程、Markdown、UpdateVariable 或第二个结果。',
    `原始响应：${String(response || '')}`,
    '只输出一个满足本次 json_schema 的 JSON 对象。',
  ].join('\n');
}

export interface TowerOpeningPromptInput {
  requestId: string;
  basedOnRevision: number;
  seed: number;
  act?: number;
  context: TowerGenerationContext;
}

export function formatTowerOpeningGenerationPrompt(input: TowerOpeningPromptInput): string {
  const lines = [
    `[爬塔第 ${input.act ?? 1} 幕开幕馈赠事件]`,
    `request_id=${input.requestId} revision=${input.basedOnRevision} seed=${input.seed}`,
    `玩家难度=${requireDifficulty(input.context.difficultyPercent)}%`,
    '根据当前世界、角色与卡组创造一位适合本幕开场的馈赠者或引路存在，不绑定固定身份。',
    input.act && input.act > 1
      ? 'narrative 要承接上一幕首领之后的独立过幕剧情，让馈赠成为新一幕起点；必须使用当前传统酒馆预设生成，不复用上一幕文本。'
      : 'narrative 要承接玩家已经进入的处境，并让馈赠自然成为连续战斗旅程的起点；只限定这一叙事架构，不限定文风或长度。',
    '固定提供三个彼此独立的中文选择，并且明显强于普通房间奖励；至少覆盖三种不同方向（构筑、遗物、道具、成长或经济），不得只给一项，也不得把三种收益合并到同一个 choice。可以无条件馈赠，也可以让玩家用明确代价换取更高收益。所有结果必须结构化且可由程序一次结算。',
    '每个 outcome 只允许 hp、max_hp、lust、max_lust、gold、card_removals、reward、deck_transforms；数值都是相对变化。max_lust 表示欲望上限的整数变化（-99..999），结算后上限至少为 1；lust 会直接改变玩家当前欲望并限制在新的 0..max_lust 之间。它是开局节点的一次性持久结算，不是战斗 effects，因此不能直接写 block、energy、status 或 effects。想给予战斗内能力时必须放进 reward 的完整卡牌、遗物或道具。reward 只允许 cards、artifacts、items 数组，可省略不变化的字段。',
    OPENING_TRANSFORM_GUIDANCE,
    '馈赠可提供已有非唯一卡的完全相同副本：名称、类型、费用和可执行规则均相同时，复用当前卡的稳定 ID、名称和完整定义，并以 quantity 表示份数；每份由程序保留为独立持有实例。不要为同一张“造成 6 点伤害”的卡改名或造新 ID。规则、费用或效果不同才使用新的稳定英文内容 ID；unique:true 卡不能作为额外副本。遗物仍不可重复持有，同一奖励 choice 中也不要重复列出同一候选，应合并数量。内容 ID 唯一不表示状态必须改名：已有同机制状态直接复用当前完整游戏事实中的 ID；奖励内容引入一个或多个新状态时，在该卡牌、遗物或道具自身同级附带 statuses:[全部完整定义]，领取时程序会原子登记。reward 容器本身不写 statuses。',
    '爬塔模式最多携带三个战斗道具；根据当前事实中的 battle.items 控制馈赠道具数量，不能让任一选项结算后超过三个。',
    '程序会在领取后把生命恢复到当时生命上限；不要把治疗当成某一项的卖点。不要修改地图、模式和 run，不要展开后续节点；这不是宝箱，宝箱只提供遗物三选一；这里的 narrative 不覆盖剧情模型所用的原预设。',
  ];
  lines.push(formatCompactEffectAuthoringContract(), towerRewardDslContract(), towerArchetypeDesignMethod());
  const completeMvu = completeRequirementContext(input.context.completeMvuContext);
  const world = completeMvu ? null : compactContext(input.context.worldContext, 8000);
  const player = completeMvu ? null : completeRequirementContext(input.context.playerContext);
  const balance = completeRequirementContext(input.context.deckBalanceContext);
  const custom = completeRequirementContext(input.context.customRequirements);
  const references = completeRequirementContext(input.context.contentReferenceContext);
  if (completeMvu) lines.push(`[当前完整游戏事实]\n${completeMvu}`);
  else {
    if (world) lines.push(`[世界与开局]\n${world}`);
    if (player) lines.push(`[玩家状态]\n${player}`);
  }
  if (balance) lines.push(`[初始构筑预算]\n${balance}`);
  if (custom) lines.push(`[玩家额外要求]\n${custom}`);
  lines.push(
    references
      ? `[现有内容精确 ID 表]\n${references}\n复用现有状态、资源或内容时必须逐字复制表内 ID；新机制必须使用新 ID 并由具体奖励候选完整登记。`
      : '',
    '只输出一个 JSON 对象，不要用 XML 标签或 Markdown 代码块包裹。',
    `JSON 顶层固定为 spec="${TOWER_OPENING_RESULT_SPEC}"、request_id、based_on_revision、title、narrative、choices。`,
    '每个 choice 固定包含 id、label、outcome，可选 description；不要输出解释、思考过程或变量命令。',
  );
  return lines.join('\n');
}

export interface TowerJsonSchema {
  name: string;
  description: string;
  strict: false;
  value: Record<string, unknown>;
}

export const TOWER_INITIAL_ROOT_REPAIR_SPEC = 'mwg.tower-initial-root-repair/v1' as const;
export const TOWER_INITIAL_SLOT_REPAIR_SPEC = 'mwg.tower-initial-slot-repair/v1' as const;

export type TowerInitialRepairSlotKind =
  | 'effect_item'
  | 'literal_effect_sequence'
  | 'effect_item_sequence'
  | 'effect_order_strategy'
  | 'effect_sequence'
  | 'passive_effect_sequence'
  | 'trigger_on'
  | 'condition'
  | 'lust_condition'
  | 'missing_lust_effect'
  | 'first_card_event_condition'
  | 'description'
  | 'card_type'
  | 'status_type'
  | 'status_stacks_change'
  | 'status_tick_timing'
  | 'status_max_stacks'
  | 'status_stun'
  | 'status_character_emoji'
  | 'status_protection'
  | 'status_defense'
  | 'status_trigger_effect_item'
  | 'status_trigger_effect_sequence'
  | 'status_hold_effect_item'
  | 'status_hold_sequence'
  | 'trigger_mode_strategy'
  | 'summon_lifecycle_default'
  | 'resource_payment_strategy'
  | 'status_next_attack_modifier_strategy'
  | 'card_quantity_strategy'
  | 'unknown_effect_item_strategy'
  | 'skill_trigger_classification_strategy'
  | 'condition_alias_strategy'
  | 'add_card_destination'
  | 'discard_strategy'
  | 'card_copy_strategy'
  | 'remove_field';

export type TowerInitialRepairSlotAction =
  'replace_effect' | 'replace_effect_sequence' | 'replace_trigger' | 'replace_value' | 'remove_invalid_field';

export interface TowerInitialRepairSlotSchemaTarget {
  token: string;
  kind: TowerInitialRepairSlotKind;
  action: TowerInitialRepairSlotAction;
  preserveId?: string;
  allowedModes?: readonly string[];
  operationNames?: readonly string[];
}

export interface TowerInitialRepairSlotRootSchemaTarget {
  token: string;
  slots: readonly TowerInitialRepairSlotSchemaTarget[];
  allowSupportStatuses?: boolean;
  allowSupportResources?: boolean;
  supportStatusIds?: readonly string[];
  supportResourceIds?: readonly string[];
}

export type TowerInitialRepairRootKind =
  | 'narrative'
  | 'player'
  | 'player_status'
  | 'player_core'
  | 'player_card'
  | 'player_cards'
  | 'player_artifact'
  | 'player_artifacts'
  | 'player_item'
  | 'player_items'
  | 'player_status_definition'
  | 'player_statuses'
  | 'player_ability'
  | 'player_abilities'
  | 'player_active_status'
  | 'player_active_statuses'
  | 'player_lust_effect'
  | 'player_level'
  | 'player_exp'
  | 'opening'
  | 'opening_title'
  | 'opening_narrative'
  | 'opening_choice'
  | 'opening_choices';

export interface TowerInitialRepairSchemaTarget {
  token: string;
  kind: TowerInitialRepairRootKind;
  nullable?: boolean;
  preserveId?: string;
}

function createTowerInitialSimpleEffectJsonSchema(): Record<string, unknown> {
  const withoutLegacyOn = (name: string): Record<string, unknown> => ({
    allOf: [aiSchemaRef(name), { not: { required: ['on'] } }],
  });
  return {
    oneOf: [
      withoutLegacyOn('amountEffect'),
      withoutLegacyOn('healEffect'),
      withoutLegacyOn('blockEffect'),
      withoutLegacyOn('energyEffect'),
      withoutLegacyOn('lustEffect'),
      withoutLegacyOn('setEffect'),
      withoutLegacyOn('drawEffect'),
      withoutLegacyOn('applyStatusEffect'),
      withoutLegacyOn('removeStatusEffect'),
      withoutLegacyOn('resourceEffect'),
      withoutLegacyOn('moveCardEffect'),
      withoutLegacyOn('recoverEffect'),
      withoutLegacyOn('advancedZoneEffect'),
      withoutLegacyOn('selectCardEffect'),
      withoutLegacyOn('reduceCostEffect'),
    ],
  };
}

function createTowerInitialSimpleEffectSequenceJsonSchema(): Record<string, unknown> {
  return {
    type: 'array',
    minItems: 1,
    maxItems: 32,
    items: createTowerInitialSimpleEffectJsonSchema(),
  };
}

function createTowerInitialPassiveEffectSequenceJsonSchema(): Record<string, unknown> {
  return {
    type: 'array',
    minItems: 1,
    maxItems: 16,
    items: { oneOf: [aiSchemaRef('modifierEffect'), aiSchemaRef('cardPlayRuleEffect')] },
  };
}

function createTowerInitialFiniteSupportStatusJsonSchema(id?: string): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'name', 'emoji', 'type', 'triggers'],
    properties: {
      id: id ? { type: 'string', const: id } : { type: 'string', pattern: '^[A-Za-z_][A-Za-z0-9_]*$' },
      name: { type: 'string', minLength: 1 },
      emoji: { type: 'string', minLength: 1 },
      description: { type: 'string' },
      type: { enum: ['buff', 'debuff', 'neutral'] },
      stacks_change: {
        anyOf: [
          { type: 'number' },
          { enum: ['keep', 'reset'] },
          { type: 'string', pattern: '^x(?:\\d+(?:\\.\\d+)?|\\.\\d+)$' },
        ],
      },
      maxStacks: { type: 'integer', minimum: 1, maximum: 999 }, intercepts: structuredClone(INTERCEPTION_SCHEMA), tags: { type: 'array', maxItems: 64, uniqueItems: true, items: { type: 'string', pattern: '^[a-zA-Z_][a-zA-Z0-9_]*$' } },
      tick_timing: { enum: ['before_action', 'after_action'] },
      stun: { type: 'boolean' }, character_emoji: CHARACTER_EMOJI_SCHEMA, protection: DAMAGE_PROTECTION_SCHEMA, defense: structuredClone(STATUS_DEFENSE_SCHEMA),
      triggers: {
        type: 'object',
        additionalProperties: false,
        properties: {
          apply: createTowerInitialSimpleEffectSequenceJsonSchema(),
          stack: createTowerInitialSimpleEffectSequenceJsonSchema(),
          tick: createTowerInitialSimpleEffectSequenceJsonSchema(),
          remove: createTowerInitialSimpleEffectSequenceJsonSchema(),
          hold: createTowerInitialPassiveEffectSequenceJsonSchema(),
          ...Object.fromEntries(
            STATUS_EVENT_TRIGGERS.map(trigger => [trigger, createTowerInitialSimpleEffectSequenceJsonSchema()]),
          ),
        },
      },
    },
  };
}

function createTowerInitialFiniteSupportResourceJsonSchema(id?: string): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'name', 'emoji', 'max', 'refresh'],
    anyOf: [{ required: ['start'] }, { required: ['current'] }],
    properties: {
      id: id ? { type: 'string', const: id } : { type: 'string', pattern: '^[A-Za-z_][A-Za-z0-9_]*$' },
      name: { type: 'string', minLength: 1 },
      emoji: { type: 'string', minLength: 1 },
      start: { type: 'integer', minimum: 0 },
      current: { type: 'integer', minimum: 0 },
      max: { type: 'integer', minimum: 1 },
      refresh: { enum: ['reset', 'retain'] },
      end_of_battle: { enum: ['reset', 'retain'] },
      description: { type: 'string' },
    },
  };
}

function createTowerInitialRepairSlotValueJsonSchema(
  target: TowerInitialRepairSlotSchemaTarget,
): Record<string, unknown> {
  if (target.kind === 'literal_effect_sequence') return createLiteralEffectSequenceSchema();
  if (target.kind === 'effect_item') return createTowerInitialSimpleEffectJsonSchema();
  if (target.kind === 'effect_item_sequence') return createTowerInitialSimpleEffectSequenceJsonSchema();
  if (target.kind === 'effect_order_strategy')
    return {
      type: 'array',
      items: { enum: [...(target.operationNames || [])] },
      minItems: target.operationNames?.length || 0,
      maxItems: target.operationNames?.length || 0,
      uniqueItems: true,
    };
  if (target.kind === 'effect_sequence') return createTowerInitialSimpleEffectSequenceJsonSchema();
  if (target.kind === 'passive_effect_sequence') return createTowerInitialPassiveEffectSequenceJsonSchema();
  if (target.kind === 'trigger_on') return { enum: ABILITY_TRIGGERS };
  if (target.kind === 'condition') return aiSchemaRef('formulaString');
  if (target.kind === 'lust_condition') return aiSchemaRef('formulaString');
  if (target.kind === 'missing_lust_effect') return aiSchemaRef('mwgNamedEffects');
  if (target.kind === 'first_card_event_condition') return { type: 'string', enum: [...(target.allowedModes || [])] };
  if (target.kind === 'description') return { type: 'string', minLength: 1 };
  if (target.kind === 'card_type') return { enum: ['Attack', 'Skill'] };
  if (target.kind === 'status_type') return { enum: ['buff', 'debuff', 'neutral'] };
  if (target.kind === 'status_tick_timing') return { anyOf: [{ enum: ['before_action', 'after_action'] }, { type: 'null' }] };
  if (target.kind === 'status_stacks_change') {
    return {
      anyOf: [
        { type: 'number' },
        { enum: ['keep', 'reset'] },
        { type: 'string', pattern: '^x(?:\\d+(?:\\.\\d+)?|\\.\\d+)$' },
      ],
    };
  }
  if (target.kind === 'status_max_stacks') {
    return { anyOf: [{ type: 'integer', minimum: 1, maximum: 999 }, { type: 'null' }] };
  }
  if (target.kind === 'status_defense') return { anyOf: [structuredClone(STATUS_DEFENSE_SCHEMA), { type: 'null' }] };
  if (target.kind === 'status_protection') return { anyOf: [DAMAGE_PROTECTION_SCHEMA, { type: 'null' }] };
  if (target.kind === 'status_character_emoji') return { anyOf: [CHARACTER_EMOJI_SCHEMA, { type: 'null' }] };
  if (target.kind === 'status_stun') return { anyOf: [{ type: 'boolean' }, { type: 'null' }] };
  if (target.kind === 'status_trigger_effect_item') return createTowerInitialSimpleEffectJsonSchema();
  if (target.kind === 'status_trigger_effect_sequence') return createTowerInitialSimpleEffectSequenceJsonSchema();
  if (target.kind === 'status_hold_effect_item') {
    return { oneOf: [aiSchemaRef('modifierEffect'), aiSchemaRef('cardPlayRuleEffect')] };
  }
  if (target.kind === 'status_hold_sequence') return createTowerInitialPassiveEffectSequenceJsonSchema();
  if (target.kind === 'trigger_mode_strategy') {
    return {
      oneOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: ['mode', 'on', 'effects'],
          properties: {
            mode: { const: 'event' },
            on: { enum: ABILITY_TRIGGERS.filter(value => value !== 'passive') },
            effects: createTowerInitialSimpleEffectSequenceJsonSchema(),
          },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['mode', 'effects'],
          properties: {
            mode: { const: 'passive' },
            effects: createTowerInitialPassiveEffectSequenceJsonSchema(),
          },
        },
      ],
    };
  }
  if (target.kind === 'discard_strategy') {
    return {
      oneOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: ['mode'],
          properties: { mode: { const: 'discard_all' } },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['mode', 'count'],
          properties: {
            mode: { const: 'discard_selected' },
            count: { type: 'integer', minimum: 1, maximum: 20 },
          },
        },
      ],
    };
  }
  if (target.kind === 'card_copy_strategy') {
    return {
      type: 'object',
      additionalProperties: false,
      required: ['mode'],
      properties: { mode: { const: 'copy_at_original_cost' } },
    };
  }
  if (target.kind === 'summon_lifecycle_default') {
    return {
      type: 'object',
      additionalProperties: false,
      required: ['mode'],
      properties: { mode: { const: 'use_runtime_default' } },
    };
  }
  if (target.kind === 'resource_payment_strategy') {
    if (!target.preserveId) throw new Error('资源支付策略缺少程序锁定的资源 ID');
    return {
      oneOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: ['mode', 'resource_id', 'amount'],
          properties: {
            mode: { const: 'pay_resource' },
            resource_id: { type: 'string', const: target.preserveId },
            amount: {
              anyOf: [{ type: 'integer', minimum: 1, maximum: 999 }, { const: 'all' }],
            },
          },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['mode'],
          properties: { mode: { const: 'read_current_resource' } },
        },
      ],
    };
  }
  if (target.kind === 'status_next_attack_modifier_strategy') {
    return {
      type: 'object',
      additionalProperties: false,
      required: ['mode'],
      properties: { mode: { const: 'hold_until_next_attack' } },
    };
  }
  if (target.kind === 'card_quantity_strategy') {
    const allowed = new Set(target.allowedModes || ['set_owned_quantity']);
    const branches: Record<string, unknown>[] = [];
    if (allowed.has('set_owned_quantity'))
      branches.push({
        type: 'object',
        additionalProperties: false,
        required: ['mode', 'quantity'],
        properties: {
          mode: { const: 'set_owned_quantity' },
          quantity: { type: 'integer', minimum: 1, maximum: 100 },
        },
      });
    if (allowed.has('remove_unowned_card'))
      branches.push({
        type: 'object',
        additionalProperties: false,
        required: ['mode'],
        properties: { mode: { const: 'remove_unowned_card' } },
      });
    if (branches.length === 0) throw new Error('持有卡数量策略没有可用模式');
    return branches.length === 1 ? branches[0] : { oneOf: branches };
  }
  if (target.kind === 'unknown_effect_item_strategy') return createTowerInitialSimpleEffectJsonSchema();
  if (target.kind === 'skill_trigger_classification_strategy') {
    return {
      type: 'object',
      additionalProperties: false,
      required: ['mode'],
      properties: { mode: { const: 'promote_to_power' } },
    };
  }
  if (target.kind === 'condition_alias_strategy') {
    const modes = [...new Set(target.allowedModes || [])];
    if (modes.length === 0) throw new Error('条件别名策略没有程序验证过的模式');
    return {
      type: 'object',
      additionalProperties: false,
      required: ['mode'],
      properties: { mode: { enum: modes } },
    };
  }
  if (target.kind === 'add_card_destination') return { enum: ['hand', 'deck', 'discard'] };
  return {};
}

function createTowerInitialRepairSlotJsonSchema(target: TowerInitialRepairSlotSchemaTarget): Record<string, unknown> {
  if (target.action === 'remove_invalid_field') {
    return {
      type: 'object',
      additionalProperties: false,
      required: ['action'],
      properties: { action: { const: target.action } },
    };
  }
  return {
    type: 'object',
    additionalProperties: false,
    required: ['action', 'value'],
    properties: {
      action: { const: target.action },
      value: createTowerInitialRepairSlotValueJsonSchema(target),
    },
  };
}

/**
 * Production initial repair protocol. The program chooses every writable slot;
 * the model can neither name a path nor replace an enclosing authored object.
 */
export function createTowerInitialSlotRepairJsonSchema(
  targets: readonly TowerInitialRepairSlotRootSchemaTarget[],
): TowerJsonSchema {
  if (targets.some(root => root.allowSupportStatuses && !root.supportStatusIds?.length)) {
    throw new Error('锁定槽位修复只有在状态 ID 已被程序提取时才允许 support_statuses');
  }
  if (targets.some(root => root.allowSupportResources && !root.supportResourceIds?.length)) {
    throw new Error('锁定槽位修复只有在资源 ID 已被程序提取时才允许 support_resources');
  }
  const supportStatusIds = [...new Set(targets.flatMap(root => root.supportStatusIds || []))];
  const supportResourceIds = [...new Set(targets.flatMap(root => root.supportResourceIds || []))];
  const allowSupportStatuses = supportStatusIds.length > 0 && targets.some(root => root.allowSupportStatuses);
  const allowSupportResources = supportResourceIds.length > 0 && targets.some(root => root.allowSupportResources);
  const roots = Object.fromEntries(
    targets.map(root => [
      root.token,
      {
        type: 'object',
        additionalProperties: false,
        required: ['slots'],
        properties: {
          slots: {
            type: 'object',
            additionalProperties: false,
            required: root.slots.map(slot => slot.token),
            properties: Object.fromEntries(
              root.slots.map(slot => [slot.token, createTowerInitialRepairSlotJsonSchema(slot)]),
            ),
          },
        },
      },
    ]),
  );
  return {
    name: 'mwg_tower_initial_slot_repair',
    description: '魔法少女世界初始内容锁定槽位修复',
    strict: false,
    value: withAiContentDefinitionsSubset({
      type: 'object',
      additionalProperties: false,
      required: ['spec', 'roots', 'support_statuses', 'support_resources'],
      properties: {
        spec: { type: 'string', const: TOWER_INITIAL_SLOT_REPAIR_SPEC },
        roots: {
          type: 'object',
          additionalProperties: false,
          required: targets.map(root => root.token),
          properties: roots,
        },
        support_statuses: {
          type: 'array',
          ...(supportStatusIds.length > 0 ? { minItems: supportStatusIds.length } : {}),
          maxItems: allowSupportStatuses ? (supportStatusIds.length > 0 ? supportStatusIds.length : 32) : 0,
          ...(allowSupportStatuses
            ? {
                items:
                  supportStatusIds.length > 0
                    ? { oneOf: supportStatusIds.map(id => createTowerInitialFiniteSupportStatusJsonSchema(id)) }
                    : createTowerInitialFiniteSupportStatusJsonSchema(),
              }
            : {}),
        },
        support_resources: {
          type: 'array',
          ...(supportResourceIds.length > 0 ? { minItems: supportResourceIds.length } : {}),
          maxItems: allowSupportResources ? (supportResourceIds.length > 0 ? supportResourceIds.length : 16) : 0,
          ...(allowSupportResources
            ? {
                items:
                  supportResourceIds.length > 0
                    ? { oneOf: supportResourceIds.map(id => createTowerInitialFiniteSupportResourceJsonSchema(id)) }
                    : createTowerInitialFiniteSupportResourceJsonSchema(),
              }
            : {}),
        },
      },
    }),
  };
}

function createTowerInitialPlayerStatusValueJsonSchema(): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['time', 'location', 'profession'],
    properties: {
      time: { type: 'string', minLength: 1 },
      location: { type: 'string', minLength: 1 },
      profession: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'ability'],
        properties: {
          name: { type: 'string', minLength: 1 },
          ability: { type: 'string', minLength: 1 },
        },
      },
    },
  };
}

function createTowerOpeningChoiceValueJsonSchema(): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'label', 'outcome'],
    properties: {
      id: { type: 'string', pattern: '^[A-Za-z_][A-Za-z0-9_]*$' },
      label: { type: 'string', minLength: 1 },
      description: { type: 'string' },
      outcome: {
        type: 'object',
        additionalProperties: false,
        properties: {
          hp: { type: 'integer', minimum: -999, maximum: 999 },
          max_hp: { type: 'integer', minimum: -99, maximum: 999 },
          lust: { type: 'integer', minimum: -999, maximum: 999 },
          max_lust: { type: 'integer', minimum: -99, maximum: 999 },
          gold: { type: 'integer', minimum: -9999, maximum: 9999 },
          card_removals: { type: 'integer', minimum: -20, maximum: 20 },
          deck_transforms: createOpeningDeckTransformsSchema(aiSchemaRef('mwgRewardCard')),
          reward: {
            type: 'object',
            additionalProperties: false,
            properties: {
              cards: { type: 'array', maxItems: 6, items: aiSchemaRef('mwgRewardCard') },
              artifacts: { type: 'array', maxItems: 6, items: aiSchemaRef('mwgRewardArtifact') },
              items: { type: 'array', maxItems: 6, items: aiSchemaRef('mwgRewardItem') },
            },
          },
        },
      },
    },
  };
}

function createTowerOpeningValueJsonSchema(): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      title: { type: 'string', minLength: 1 },
      narrative: { type: 'string', minLength: 1 },
      choices: {
        type: 'array',
        minItems: 3,
        maxItems: 3,
        items: createTowerOpeningChoiceValueJsonSchema(),
      },
    },
    required: ['title', 'narrative', 'choices'],
  };
}

function createTowerInitialPlayerValueJsonSchema(): Record<string, unknown> {
  const battle = createTowerInitialBattleValueJsonSchema();
  return {
    ...battle,
    properties: {
      status: createTowerInitialPlayerStatusValueJsonSchema(),
      ...(battle.properties as Record<string, unknown>),
    },
    required: ['status', 'core', 'cards'],
  };
}

function createTowerInitialBattleValueJsonSchema(): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      core: {
        type: 'object',
        additionalProperties: false,
        required: ['emoji', 'hp', 'max_hp', 'lust', 'max_lust'],
        properties: {
          emoji: { type: 'string', minLength: 1 },
          hp: { type: 'number', minimum: 0 },
          max_hp: { type: 'number', exclusiveMinimum: 0 },
          lust: { type: 'number', minimum: 0 },
          max_lust: { type: 'number', exclusiveMinimum: 0 },
          energy: { type: 'integer', minimum: 0 },
          max_energy: { type: 'integer', minimum: 0 },
          block: { type: 'number', minimum: 0 },
          card_removal_count: { type: 'integer', minimum: 0 },
          resources: { type: 'array', maxItems: 16, items: aiSchemaRef('mwgCombatResource') },
          stance: { anyOf: [aiSchemaRef('mwgInitialStance'), { type: 'null' }] },
          orb_slots: { type: 'integer', minimum: 0, maximum: 20 },
          orbs: { type: 'array', maxItems: 20, items: aiSchemaRef('mwgInitialOrb') },
        },
      },
      cards: {
        type: 'array',
        minItems: 1,
        maxItems: 64,
        items: aiSchemaRef('mwgCard'),
        description: initialDeckAuthoringGuidance(),
      },
      artifacts: { type: 'array', maxItems: 32, items: aiSchemaRef('mwgArtifact') },
      items: { type: 'array', maxItems: 32, items: aiSchemaRef('mwgItem') },
      statuses: {
        type: 'array',
        maxItems: 64,
        items: aiSchemaRef('mwgStatusDefinition'),
        description:
          '玩家已持有卡牌、遗物、道具、能力、活动状态与欲望满溢效果引用的每个状态 ID 都必须在这里恰好登记一次完整定义。',
      },
      player_abilities: {
        type: 'array',
        maxItems: 32,
        items: aiSchemaRef('mwgAbility'),
        description:
          '只属于本场战斗，结算后清除；每场自动生效的持久职业特性应由 AI 写入已持有 artifacts 的真实 trigger。能力 creates 中的临时牌仍使用正式卡牌 type/rarity 枚举，不存在 Special 或 Token 稀有度。',
      },
      player_status_effects: { type: 'array', maxItems: 64, items: aiSchemaRef('mwgActiveStatus') },
      player_lust_effect: {
        ...aiSchemaRef('mwgNamedEffects'),
        description:
          '可选欲望满溢效果。其 effects 引用的每个状态 ID 必须在同级 player.statuses 中登记完整定义；本对象不能携带 status 外壳。',
      },
      level: { type: 'integer', minimum: 1 },
      exp: { type: 'integer', minimum: 0 },
    },
    required: ['core', 'cards'],
  };
}

/** One strict battle grammar shared by first generation and its bounded repair. */
export function createTowerInitialBattleRepairJsonSchema(): TowerJsonSchema {
  return {
    name: 'mwg_initial_battle_repair',
    description: '魔法少女世界初始战斗内容结构化修复',
    strict: false,
    value: withAiContentDefinitions({
      type: 'object',
      additionalProperties: false,
      properties: { battle: createTowerInitialBattleValueJsonSchema() },
      required: ['battle'],
    }),
  };
}

/** First tower request: narrative, player state/deck, and opening gift in one response. */
export function createTowerInitialContentJsonSchema(options: { allowCardReferences?: boolean } = {}): TowerJsonSchema {
  const schema: TowerJsonSchema = {
    name: 'mwg_tower_single_floor_initial_content',
    description: '魔法少女世界爬塔模式初始角色与可执行卡组',
    strict: false,
    value: withAiContentDefinitions({
      type: 'object',
      additionalProperties: false,
      properties: {
        narrative: { type: 'string', minLength: 1 },
        player: createTowerInitialPlayerValueJsonSchema(),
        opening: createTowerOpeningValueJsonSchema(),
      },
      required: ['narrative', 'player', 'opening'],
    }),
  };
  if (options.allowCardReferences) {
    const definitions = schema.value.$defs as Record<string, unknown>;
    definitions.mwgRewardCard = { anyOf: [definitions.mwgRewardCard, structuredClone(INITIAL_CARD_REFERENCE_SCHEMA)] };
  }
  return schema;
}

function createTowerInitialRepairRootJsonSchema(target: TowerInitialRepairSchemaTarget): Record<string, unknown> {
  const battle = createTowerInitialBattleValueJsonSchema();
  const battleProperties = battle.properties as Record<string, unknown>;
  const base: Record<TowerInitialRepairRootKind, Record<string, unknown>> = {
    narrative: { type: 'string', minLength: 1 },
    player: createTowerInitialPlayerValueJsonSchema(),
    player_status: createTowerInitialPlayerStatusValueJsonSchema(),
    player_core: battleProperties.core as Record<string, unknown>,
    player_card: aiSchemaRef('mwgCard'),
    player_cards: battleProperties.cards as Record<string, unknown>,
    player_artifact: aiSchemaRef('mwgArtifact'),
    player_artifacts: battleProperties.artifacts as Record<string, unknown>,
    player_item: aiSchemaRef('mwgItem'),
    player_items: battleProperties.items as Record<string, unknown>,
    player_status_definition: aiSchemaRef('mwgStatusDefinition'),
    player_statuses: battleProperties.statuses as Record<string, unknown>,
    player_ability: aiSchemaRef('mwgAbility'),
    player_abilities: battleProperties.player_abilities as Record<string, unknown>,
    player_active_status: aiSchemaRef('mwgActiveStatus'),
    player_active_statuses: battleProperties.player_status_effects as Record<string, unknown>,
    player_lust_effect: aiSchemaRef('mwgNamedEffects'),
    player_level: battleProperties.level as Record<string, unknown>,
    player_exp: battleProperties.exp as Record<string, unknown>,
    opening: createTowerOpeningValueJsonSchema(),
    opening_title: { type: 'string', minLength: 1 },
    opening_narrative: { type: 'string', minLength: 1 },
    opening_choice: createTowerOpeningChoiceValueJsonSchema(),
    opening_choices: {
      type: 'array',
      minItems: 3,
      maxItems: 3,
      items: createTowerOpeningChoiceValueJsonSchema(),
    },
  };
  let schema = base[target.kind];
  if (target.preserveId) {
    schema = {
      allOf: [
        schema,
        {
          type: 'object',
          properties: { id: { type: 'string', const: target.preserveId } },
          required: ['id'],
        },
      ],
    };
  }
  return target.nullable ? { anyOf: [schema, { type: 'null' }] } : schema;
}

/**
 * One bounded repair emits only fixed-token replacements selected by the
 * program. Requiring every token makes it structurally impossible for the
 * model to repair one reported root while silently omitting another.
 */
export function createTowerInitialRootRepairJsonSchema(
  targets: readonly TowerInitialRepairSchemaTarget[],
): TowerJsonSchema {
  const rootProperties = Object.fromEntries(
    targets.map(target => [target.token, createTowerInitialRepairRootJsonSchema(target)]),
  );
  return {
    name: 'mwg_tower_initial_root_repair',
    description: '魔法少女世界初始内容固定根结构修复',
    strict: false,
    value: withAiContentDefinitions({
      type: 'object',
      additionalProperties: false,
      properties: {
        spec: { type: 'string', const: TOWER_INITIAL_ROOT_REPAIR_SPEC },
        roots: {
          type: 'object',
          additionalProperties: false,
          properties: rootProperties,
          required: targets.map(target => target.token),
        },
        support_statuses: {
          type: 'array',
          maxItems: 32,
          items: aiSchemaRef('mwgStatusDefinition'),
        },
        support_resources: {
          type: 'array',
          maxItems: 16,
          items: aiSchemaRef('mwgCombatResource'),
        },
      },
      required: ['spec', 'roots', 'support_statuses', 'support_resources'],
    }),
  };
}

export function createTowerOpeningJsonSchema(): TowerJsonSchema {
  return {
    name: 'mwg_tower_opening_result',
    description: '魔法少女世界爬塔模式开局馈赠结果',
    strict: false,
    value: withAiContentDefinitions({
      type: 'object',
      additionalProperties: false,
      properties: {
        spec: { type: 'string', const: TOWER_OPENING_RESULT_SPEC },
        request_id: { type: 'string' },
        based_on_revision: { type: 'integer', minimum: 0 },
        title: { type: 'string' },
        narrative: { type: 'string' },
        choices: {
          type: 'array',
          minItems: 3,
          maxItems: 3,
          items: createTowerOpeningChoiceValueJsonSchema(),
        },
      },
      required: ['spec', 'request_id', 'based_on_revision', 'title', 'narrative', 'choices'],
    }),
  };
}

function createTowerTriggeredDefinitionJsonSchema(): Record<string, unknown> {
  return aiSchemaRef('mwgAbility');
}

function createTowerActiveStatusJsonSchema(): Record<string, unknown> {
  return aiSchemaRef('mwgActiveStatus');
}

function createTowerStatusDefinitionJsonSchema(): Record<string, unknown> {
  return aiSchemaRef('mwgStatusDefinition');
}

function createTowerRewardCardJsonSchema(): Record<string, unknown> {
  return aiSchemaRef('mwgRewardCard');
}

function createTowerRewardArtifactJsonSchema(): Record<string, unknown> {
  return aiSchemaRef('mwgRewardArtifact');
}

function createTowerRewardItemJsonSchema(): Record<string, unknown> {
  return aiSchemaRef('mwgRewardItem');
}

function createTowerRewardEntryArrayJsonSchema(
  category: 'cards' | 'artifacts' | 'items',
  options: { minimum?: number; maximum?: number } = {},
): Record<string, unknown> {
  const item =
    category === 'cards'
      ? createTowerRewardCardJsonSchema()
      : category === 'artifacts'
        ? createTowerRewardArtifactJsonSchema()
        : createTowerRewardItemJsonSchema();
  return {
    type: 'array',
    ...(options.minimum !== undefined && options.minimum === options.maximum
      ? { description: `必须恰好包含 ${options.minimum} 个彼此独立的${category}候选；逐项计数后再输出。` }
      : {}),
    ...(options.minimum === undefined ? {} : { minItems: options.minimum }),
    ...(options.maximum === undefined ? {} : { maxItems: options.maximum }),
    items: item,
  };
}

function createTowerEnemyJsonSchema(requireId = false): Record<string, unknown> {
  void requireId;
  return aiSchemaRef('mwgEnemy');
}

function createTowerEventOutcomeJsonSchema(): Record<string, unknown> {
  const reward = {
    type: 'object',
    additionalProperties: false,
    properties: {
      cards: createTowerRewardEntryArrayJsonSchema('cards'),
      artifacts: createTowerRewardEntryArrayJsonSchema('artifacts'),
      items: createTowerRewardEntryArrayJsonSchema('items'),
      limits: {
        type: 'object',
        additionalProperties: false,
        properties: {
          cards: { type: 'integer', minimum: 0 },
          artifacts: { type: 'integer', minimum: 0 },
          items: { type: 'integer', minimum: 0 },
        },
        required: ['cards', 'artifacts', 'items'],
      },
    },
  };
  const deckAction = {
    type: 'object',
    additionalProperties: false,
    properties: {
      id: { type: 'string', minLength: 1 },
      kind: { type: 'string', enum: ['remove', 'transform', 'duplicate'] },
      count: { type: 'integer', minimum: 1 },
      pick: { type: 'string', enum: ['choose', 'random'] },
      filter: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ids: { type: 'array', items: { type: 'string', minLength: 1 } },
          types: { type: 'array', items: { type: 'string', minLength: 1 } },
        },
      },
      replacement: aiSchemaRef('mwgCard'),
    },
    required: ['id', 'kind', 'count', 'pick'],
    allOf: [
      {
        if: { properties: { kind: { const: 'transform' } }, required: ['kind'] },
        then: { required: ['replacement'] },
        else: { not: { required: ['replacement'] } },
      },
    ],
  };
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      outcome: { type: 'string', enum: ['cleared', 'failed', 'escaped'] },
      hp: { type: 'integer', minimum: -999, maximum: 999 },
      max_hp: { type: 'integer', minimum: -99, maximum: 999 },
      lust: { type: 'integer', minimum: -999, maximum: 999 },
      max_lust: { type: 'integer', minimum: -99, maximum: 999 },
      gold: { type: 'integer', minimum: -9999, maximum: 9999 },
      card_removals: { type: 'integer', minimum: -20, maximum: 20 },
      gain_cards: createTowerRewardEntryArrayJsonSchema('cards'),
      resources: {
        type: 'object',
        maxProperties: 16,
        additionalProperties: { type: 'integer', minimum: -999, maximum: 999 },
      },
      reward,
      cost: {
        type: 'object',
        additionalProperties: false,
        properties: {
          hp: { type: 'integer', minimum: 0, maximum: 999 },
          max_hp: { type: 'integer', minimum: 0, maximum: 999 },
          gold: { type: 'integer', minimum: 0, maximum: 9999 },
          resources: {
            type: 'object',
            maxProperties: 16,
            additionalProperties: { type: 'integer', minimum: 0, maximum: 999 },
          },
        },
      },
      deck_actions: { type: 'array', items: deckAction },
      grant: {
        type: 'object',
        additionalProperties: false,
        properties: {
          cards: createTowerRewardEntryArrayJsonSchema('cards'),
          items: createTowerRewardEntryArrayJsonSchema('items'),
          limits: {
            type: 'object',
            additionalProperties: false,
            properties: {
              cards: { type: 'integer', minimum: 0 },
              items: { type: 'integer', minimum: 0 },
            },
          },
        },
      },
    },
  };
}

function createTowerEventJsonSchema(): Record<string, unknown> {
  const outcome = createTowerEventOutcomeJsonSchema();
  const legacyChoice = {
    type: 'object',
    additionalProperties: false,
    properties: {
      id: { type: 'string', minLength: 1 },
      label: { type: 'string', minLength: 1 },
      description: { type: 'string' },
      outcome,
    },
    required: ['id', 'label', 'outcome'],
  };
  const stagedChoice = {
    ...legacyChoice,
    properties: { ...legacyChoice.properties, next_stage: { type: 'string', minLength: 1 } },
  };
  return {
    oneOf: [
      {
        type: 'object',
        additionalProperties: false,
        properties: { choices: { type: 'array', minItems: 2, maxItems: 6, items: legacyChoice } },
        required: ['choices'],
      },
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          spec: { const: 'mwg.tower-event/v2' },
          start_stage: { type: 'string', minLength: 1 },
          stages: {
            type: 'array',
            minItems: 1,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', minLength: 1 },
                narrative: { type: 'string' },
                choices: { type: 'array', minItems: 1, items: stagedChoice },
              },
              required: ['id', 'choices'],
            },
          },
        },
        required: ['spec', 'start_stage', 'stages'],
      },
    ],
  };
}
function createTowerNodePayloadJsonSchema(kind: RunNodeKind, scope?: TowerNodeScope): Record<string, unknown> {
  if (isBattleRunNode(kind)) {
    const plan = scope && createTowerEncounterPlan(scope);
    const enemy = createTowerEnemyJsonSchema();
    const rosterEnemy = createTowerEnemyJsonSchema(true);
    return {
      type: 'object',
      properties: {
        desire_growth: {
          type: 'object',
          additionalProperties: false,
          required: ['effect'],
          description: '可选胜利后欲望成长，仅已有欲望效果构筑使用；入战暂存，胜利才替换，不减少正常奖励。',
          properties: {
            effect: aiSchemaRef('mwgNamedEffects'),
            statuses: { type: 'array', items: aiSchemaRef('mwgStatusDefinition') },
          },
        },
        battle: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ...(plan ? {} : { enemy }),
            enemies: {
              type: 'array',
              minItems: plan?.enemyCount ?? 1,
              ...(plan ? { maxItems: plan.enemyCount } : {}),
              items: rosterEnemy,
            },
            statuses: {
              type: 'array',
              items: createTowerStatusDefinitionJsonSchema(),
              description:
                builtinStatusReferenceContract() + '本节点独立状态定义表。本节点敌人、能力、行动、欲望效果、活动状态、公式与奖励引用的每个非既有且非预设状态 ID 都必须在这里完整登记，不能借用批量中的兄弟节点。',
            },
            player_abilities: { type: 'array', items: createTowerTriggeredDefinitionJsonSchema() },
            player_status_effects: { type: 'array', items: createTowerActiveStatusJsonSchema() },
          },
          ...(plan ? { required: ['enemies'] } : { anyOf: [{ required: ['enemy'] }, { required: ['enemies'] }] }),
        },
      },
      required: ['battle'],
    };
  }
  if (kind === 'event') {
    return {
      type: 'object',
      additionalProperties: false,
      properties: { event: createTowerEventJsonSchema() },
      required: ['event'],
    };
  }
  return {
    type: 'object',
    properties: { [kind]: { type: 'object' } },
    required: [kind],
  };
}

function createTowerRewardJsonSchema(scope: TowerNodeScope): Record<string, unknown> {
  if (isBattleRunNode(scope.kind)) {
    const budget = battleRewardBudgetFor(scope);
    const artifacts = budget.artifacts?.candidates ?? 0;
    const items = budget.items?.candidates ?? 0;
    return {
      type: 'object',
      additionalProperties: false,
      properties: {
        card: createTowerRewardEntryArrayJsonSchema('cards', {
          minimum: budget.cards.candidates,
          maximum: budget.cards.candidates,
        }),
        artifact: createTowerRewardEntryArrayJsonSchema('artifacts', {
          minimum: artifacts,
          maximum: artifacts,
        }),
        item: createTowerRewardEntryArrayJsonSchema('items', {
          minimum: items,
          maximum: items,
        }),
        limits: {
          type: 'object',
          additionalProperties: false,
          properties: {
            cards: { type: 'integer', const: budget.cards.pick },
            artifacts: { type: 'integer', const: budget.artifacts?.pick ?? 0 },
            items: { type: 'integer', const: budget.items?.pick ?? 0 },
          },
          required: ['cards', 'artifacts', 'items'],
        },
      },
      required: ['card', 'artifact', 'item', 'limits'],
    };
  }
  if (scope.kind === 'shop') {
    const budget = shopRewardBudgetFor(scope);
    return {
      type: 'object',
      additionalProperties: false,
      properties: {
        cards: createTowerRewardEntryArrayJsonSchema('cards', {
          minimum: budget.cards,
          maximum: budget.cards,
        }),
        artifacts: createTowerRewardEntryArrayJsonSchema('artifacts', {
          minimum: budget.artifacts,
          maximum: budget.artifacts,
        }),
        items: createTowerRewardEntryArrayJsonSchema('items', {
          minimum: budget.items,
          maximum: budget.items,
        }),
        limits: {
          type: 'object',
          additionalProperties: false,
          properties: {
            cards: { type: 'integer', const: budget.cards },
            artifacts: { type: 'integer', const: budget.artifacts },
            items: { type: 'integer', const: budget.items },
          },
          required: ['cards', 'artifacts', 'items'],
        },
      },
      required: ['cards', 'artifacts', 'items', 'limits'],
    };
  }
  if (scope.kind === 'treasure') {
    return {
      type: 'object',
      additionalProperties: false,
      properties: {
        cards: createTowerRewardEntryArrayJsonSchema('cards', { minimum: 0, maximum: 0 }),
        artifacts: createTowerRewardEntryArrayJsonSchema('artifacts', { minimum: 3, maximum: 3 }),
        items: createTowerRewardEntryArrayJsonSchema('items', { minimum: 0, maximum: 0 }),
        limits: {
          type: 'object',
          additionalProperties: false,
          properties: {
            cards: { type: 'integer', const: 0 },
            artifacts: { type: 'integer', const: 1 },
            items: { type: 'integer', const: 0 },
          },
          required: ['cards', 'artifacts', 'items'],
        },
      },
      required: ['cards', 'artifacts', 'items', 'limits'],
    };
  }
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      cards: createTowerRewardEntryArrayJsonSchema('cards'),
      artifacts: createTowerRewardEntryArrayJsonSchema('artifacts'),
      items: createTowerRewardEntryArrayJsonSchema('items'),
      limits: {
        type: 'object',
        additionalProperties: false,
        properties: {
          cards: { type: 'integer', minimum: 0 },
          artifacts: { type: 'integer', minimum: 0 },
          items: { type: 'integer', minimum: 0 },
        },
        required: ['cards', 'artifacts', 'items'],
      },
    },
  };
}

export function createTowerNodeJsonSchema(
  kind: RunNodeKind,
  scope: Partial<
    Pick<TowerGenerationJobDescriptor, 'nodeId' | 'act' | 'floor' | 'contentSeed' | 'rewardSeed' | 'shopMemoryCards'>
  > = {},
): TowerJsonSchema {
  const nodeScope: TowerNodeScope = {
    ...scope,
    nodeId: scope.nodeId || '__schema__',
    requestId: '__schema__',
    basedOnRevision: 0,
    kind,
    ...(scope.act === undefined ? {} : { act: scope.act }),
    ...(scope.floor === undefined ? {} : { floor: scope.floor }),
  };
  const rewardRequired = isBattleRunNode(kind) || kind === 'shop' || kind === 'treasure';
  return {
    name: `mwg_tower_${kind}_result`,
    description: `魔法少女世界爬塔模式 ${kind} 节点结果`,
    strict: false,
    value: withAiContentDefinitions({
      type: 'object',
      additionalProperties: false,
      properties: {
        spec: { type: 'string', const: TOWER_NODE_RESULT_SPEC },
        node_id: { type: 'string' },
        request_id: { type: 'string' },
        based_on_revision: { type: 'integer', minimum: 0 },
        kind: { type: 'string', const: kind },
        title: { type: 'string' },
        narrative: { type: 'string' },
        payload: createTowerNodePayloadJsonSchema(kind, nodeScope),
        reward: createTowerRewardJsonSchema(nodeScope),
      },
      required: [
        'spec',
        'node_id',
        'request_id',
        'based_on_revision',
        'kind',
        'title',
        'narrative',
        'payload',
        ...(rewardRequired ? ['reward'] : []),
      ],
    }),
  };
}

export function createTowerNodeBatchJsonSchema(
  batchId: string,
  jobs: readonly TowerGenerationJobDescriptor[],
): TowerJsonSchema {
  if (!batchId.trim()) throw new Error('tower batch id is invalid');
  if (jobs.length < 1 || jobs.length > 3) throw new Error('tower batch must contain one to three nodes');
  const nodeSchemas = jobs.map(job => {
    const value = structuredClone(
      createTowerNodeJsonSchema(job.kind, {
        rewardSeed: job.rewardSeed,
        contentSeed: job.contentSeed,
        shopMemoryCards: job.shopMemoryCards,
        nodeId: job.nodeId,
        act: job.act,
        floor: job.floor,
      }).value,
    ) as Record<string, any>;
    delete value.$defs;
    value.properties.node_id = { type: 'string', const: job.nodeId };
    value.properties.request_id = { type: 'string', const: job.requestId };
    value.properties.based_on_revision = { type: 'integer', const: job.basedOnRevision };
    return value;
  });
  return {
    name: 'mwg_tower_node_batch_result',
    description: '魔法少女世界爬塔模式当前可达窗口的批量节点结果',
    strict: false,
    value: withAiContentDefinitions({
      type: 'object',
      additionalProperties: false,
      properties: {
        spec: { type: 'string', const: TOWER_NODE_BATCH_RESULT_SPEC },
        batch_id: { type: 'string', const: batchId },
        based_on_revision: { type: 'integer', const: jobs[0].basedOnRevision },
        results: {
          type: 'array',
          minItems: jobs.length,
          maxItems: jobs.length,
          items: {
            oneOf: nodeSchemas,
          },
        },
      },
      required: ['spec', 'batch_id', 'based_on_revision', 'results'],
    }),
  };
}

function unwrapJsonFence(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

function fallbackJsonBodies(text: string): string[] {
  const unwrapped = unwrapJsonFence(text);
  const bodies = [unwrapped];
  const firstBrace = unwrapped.indexOf('{');
  const lastBrace = unwrapped.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) bodies.push(unwrapped.slice(firstBrace, lastBrace + 1));
  return [...new Set(bodies.map(body => body.trim()).filter(Boolean))];
}

/**
 * Remove only closing braces/brackets that cannot close the currently open
 * JSON container. Some structured-output providers append one extra `}` after
 * every nested result object. This is a transport punctuation repair: it does
 * not add fields, choose values, or close a missing container on the model's
 * behalf. Strings and escaped quotes are preserved byte-for-byte.
 */
export function removeImpossibleJsonClosers(text: string): string {
  const stack: Array<'{' | '['> = [];
  let result = '';
  let inString = false;
  let escaped = false;
  for (const character of String(text || '')) {
    if (inString) {
      result += character;
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      result += character;
      continue;
    }
    if (character === '{' || character === '[') {
      stack.push(character);
      result += character;
      continue;
    }
    if (character === '}' || character === ']') {
      const expected = character === '}' ? '{' : '[';
      if (stack.at(-1) === expected) {
        stack.pop();
        result += character;
      }
      continue;
    }
    result += character;
  }
  return result;
}

/** Replace only semicolons which occur outside JSON strings. In JSON member
 * position they can only be a mistyped comma; semicolons inside narrative text
 * remain byte-for-byte unchanged. */
export function replaceOutsideStringJsonSemicolons(text: string): string {
  let result = '';
  let inString = false;
  let escaped = false;
  for (const character of String(text || '')) {
    if (inString) {
      result += character;
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      result += character;
      continue;
    }
    result += character === ';' || character === '；' ? ',' : character;
  }
  return result;
}

/**
 * Providers occasionally echo the requested result block in reasoning, repeat
 * an identical final block, or omit only the XML wrapper while still returning
 * one scoped JSON object. Treat those transport artefacts as recoverable, but
 * never guess between two different valid scoped results.
 */
function parseTaggedJson(text: string, tag: string, acceptsScope: (value: unknown) => boolean): unknown {
  const pattern = new RegExp(`<${tag}>\\s*([\\s\\S]*?)\\s*<\\/${tag}>`, 'g');
  const matches = [...text.matchAll(pattern)];
  const bodies = matches.length > 0 ? matches.map(match => match[1]) : fallbackJsonBodies(text);
  const parsed: unknown[] = [];
  let lastError: unknown = null;
  for (const body of bodies) {
    const punctuation = replaceOutsideStringJsonSemicolons(body);
    const candidates = [
      ...new Set([body, removeImpossibleJsonClosers(body), punctuation, removeImpossibleJsonClosers(punctuation)]),
    ];
    let accepted = false;
    for (const candidate of candidates) {
      let value: unknown;
      try {
        value = JSON.parse(candidate);
      } catch (error) {
        lastError = error;
        continue;
      }
      assertUnambiguousObjectJson(candidate);
      parsed.push(value);
      accepted = true;
      break;
    }
    if (accepted) continue;
    for (const candidate of candidates) {
      let repaired: string;
      let value: unknown;
      try {
        repaired = jsonrepair(candidate);
        value = JSON.parse(repaired);
      } catch (repairError) {
        lastError = repairError;
        continue;
      }
      assertUnambiguousObjectJson(repaired);
      assertNoInventedJsonValues(candidate, repaired);
      parsed.push(value);
      accepted = true;
      break;
    }
  }

  const scoped = parsed.filter(acceptsScope);
  const unique = new Map<string, unknown>();
  for (const value of scoped) unique.set(JSON.stringify(value), value);
  if (unique.size === 1) return unique.values().next().value;
  if (unique.size > 1) throw new Error(`${tag} result contains multiple different scoped blocks`);
  if (parsed.length === 1) return parsed[0];
  if (parsed.length > 1) throw new Error(`${tag} result does not contain exactly one scoped block`);
  if (lastError) {
    throw new Error(
      `${tag} result JSON is invalid: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
    );
  }
  throw new Error(`${tag} result block is missing`);
}

function directNodeRewardShapeIssues(scope: TowerNodeScope, reward: unknown): string[] {
  const label = scope.kind === 'shop' ? '商店' : '宝箱';
  if (!isRecord(reward)) return [`${label} reward 必须是对象`];
  const issues: string[] = [];
  const categories = ['cards', 'artifacts', 'items'] as const;
  const allowed = new Set([...categories, 'limits']);
  for (const key of Object.keys(reward)) {
    if (!allowed.has(key as (typeof categories)[number] | 'limits')) {
      issues.push(`${label} reward 不支持字段 ${key}；只允许 cards、artifacts、items、limits`);
    }
  }
  const counts = { cards: 0, artifacts: 0, items: 0 };
  for (const category of categories) {
    if (!Object.hasOwn(reward, category)) {
      issues.push(`${label} reward.${category} 必须存在，没有候选时写 []`);
      continue;
    }
    const values = reward[category];
    if (!Array.isArray(values)) issues.push(`${label} reward.${category} 必须是数组`);
    else counts[category] = values.length;
  }
  const limits = isRecord(reward.limits) ? reward.limits : null;
  if (!limits) issues.push(`${label} reward.limits 必须是对象`);
  else {
    for (const key of Object.keys(limits)) {
      if (!categories.includes(key as (typeof categories)[number])) {
        issues.push(`${label} reward.limits 不支持字段 ${key}`);
      }
    }
    for (const category of categories) {
      const limit = limits[category];
      if (!Number.isInteger(limit) || Number(limit) < 0) {
        issues.push(`${label} reward.limits.${category} 必须是非负整数`);
      } else if (scope.kind === 'shop' && Number(limit) > counts[category]) {
        issues.push(`${label} reward.limits.${category} 不能大于 ${category} 候选数`);
      }
    }
  }
  if (scope.kind === 'shop') {
    const budget = shopRewardBudgetFor(scope);
    for (const category of categories) {
      if (counts[category] !== budget[category]) {
        issues.push(`商店 reward.${category} 必须恰好包含 ${budget[category]} 项`);
      }
      if (limits && limits[category] !== budget[category]) {
        issues.push(`商店 reward.limits.${category} 必须等于 ${budget[category]}`);
      }
    }
  } else {
    if (counts.cards !== 0) issues.push('宝箱 reward.cards 必须为空数组');
    if (counts.artifacts !== 3) issues.push('宝箱 reward.artifacts 必须恰好包含 3 项遗物候选');
    if (counts.items !== 0) issues.push('宝箱 reward.items 必须为空数组');
    if (limits && (limits.cards !== 0 || limits.artifacts !== 1 || limits.items !== 0)) {
      issues.push('宝箱 reward.limits 必须固定为 cards=0、artifacts=1、items=0');
    }
  }
  return issues;
}

function nodePayloadShapeIssues(scope: TowerNodeScope, payload: Record<string, unknown>, reward: unknown): string[] {
  const kind = scope.kind;
  const issues: string[] = [];
  const validEffects = (value: unknown): boolean =>
    (isRecord(value) && Object.keys(value).length > 0) ||
    (Array.isArray(value) &&
      value.length > 0 &&
      value.every(entry => isRecord(entry) && Object.keys(entry).length > 0));
  if (payload.desire_growth !== undefined) {
    if (!isBattleRunNode(kind)) issues.push('desire_growth 仅用于战斗胜利成长');
    const growth = payload.desire_growth;
    if (
      !isRecord(growth) ||
      !isRecord(growth.effect) ||
      !boundedText(growth.effect.name, 120) ||
      !validEffects(growth.effect.effects)
    ) {
      issues.push('desire_growth 必须含完整非空命名 effect');
    } else if (
      Object.keys(growth).some(key => !['effect', 'statuses'].includes(key)) ||
      (growth.statuses !== undefined && !Array.isArray(growth.statuses))
    ) {
      issues.push('desire_growth 只允许 effect 与可选 statuses 数组');
    }
  }
  if (isBattleRunNode(kind)) {
    const battle = isRecord(payload.battle) ? payload.battle : null;
    if (!battle) issues.push('payload.battle 必须是对象');
    if (!isRecord(reward)) issues.push('reward 必须是对象');
    if (!battle) return issues;
    const plan = createTowerEncounterPlan(scope);
    if (
      plan &&
      (battle.enemy !== undefined || !Array.isArray(battle.enemies) || battle.enemies.length !== plan.enemyCount)
    ) {
      issues.push(
        `payload.battle.enemies 必须恰好 ${plan.enemyCount} 名且不得同时输出 enemy；遵守程序已确定数量，不得重掷`,
      );
    }
    const allowedBattleFields = new Set(['enemy', 'enemies', 'statuses', 'player_abilities', 'player_status_effects']);
    for (const key of Object.keys(battle)) {
      if (!allowedBattleFields.has(key)) issues.push(`payload.battle.${key} 不是允许的节点战斗字段`);
    }
    const validateEnemy = (value: unknown, path: string, requireId = false): void => {
      if (!isRecord(value)) {
        issues.push(`${path} 必须是对象`);
        return;
      }
      if (!boundedText(value.name, 120)) issues.push(`${path}.name 必须是非空文本`);
      const id = typeof value.id === 'string' ? value.id.trim() : '';
      if (requireId && !id) issues.push(`${path}.id 是多敌数组中的必填稳定英文标识`);
      else if (id && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(id))
        issues.push(`${path}.id 只能使用字母、数字和下划线且不能以数字开头`);
      const hp = Number(value.hp);
      const maxHp = Number(value.max_hp);
      const lust = Number(value.lust);
      const maxLust = Number(value.max_lust);
      if (!Number.isFinite(hp) || hp < 0) issues.push(`${path}.hp 必须是非负数`);
      if (!Number.isFinite(maxHp) || maxHp <= 0) issues.push(`${path}.max_hp 必须是正数`);
      else if (Number.isFinite(hp) && hp > maxHp) issues.push(`${path}.hp 不能大于 max_hp`);
      if (!Number.isFinite(lust) || lust < 0) issues.push(`${path}.lust 必须是非负数`);
      if (!Number.isFinite(maxLust) || maxLust <= 0) issues.push(`${path}.max_lust 必须是正数`);
      else if (Number.isFinite(lust) && lust > maxLust) issues.push(`${path}.lust 不能大于 max_lust`);
      if (!Array.isArray(value.actions) || value.actions.length === 0) {
        issues.push(`${path}.actions 必须是至少一项的数组，不能写成对象映射`);
        return;
      }
      value.actions.forEach((action, index) => {
        const actionPath = `${path}.actions[${index}]`;
        if (!isRecord(action)) {
          issues.push(`${actionPath} 必须是对象`);
          return;
        }
        if (!boundedText(action.name, 120)) issues.push(`${actionPath}.name 必须是非空文本`);
        if (!validEffects(action.effects)) issues.push(`${actionPath}.effects 必须是非空浅层效果对象或数组`);
      });
    };
    const hasEnemy = battle.enemy !== undefined;
    const hasEnemies = battle.enemies !== undefined;
    if (!hasEnemy && !hasEnemies) issues.push('payload.battle 必须包含 enemy 或 enemies');
    if (hasEnemy) validateEnemy(battle.enemy, 'payload.battle.enemy');
    if (hasEnemies && (!Array.isArray(battle.enemies) || battle.enemies.length === 0)) {
      issues.push('payload.battle.enemies 必须是至少一项的数组');
    } else if (Array.isArray(battle.enemies)) {
      battle.enemies.forEach((enemy, index) => validateEnemy(enemy, `payload.battle.enemies[${index}]`, true));
      const ids = (battle.enemies as Array<Record<string, unknown>>).map(enemy => String(enemy.id));
      if (new Set(ids).size !== ids.length) issues.push('payload.battle.enemies 的 id 不能重复');
    }
    return issues;
  }
  if (kind === 'event') {
    if (reward !== undefined) issues.push('事件节点顶层不得写 reward；奖励必须放在具体 choice.outcome.reward');
    if (!isRecord(payload.event)) {
      issues.push('payload.event 必须是对象');
      return issues;
    }
    try {
      const flow = parseTowerEventFlow(payload.event, planTowerEventOutcome);
      if (flow.version === 1 && flow.stages[0].choices.length > 6) {
        throw new Error('旧事件 choices 最多 6 项；递进事件请使用 mwg.tower-event/v2');
      }
    } catch (error) {
      issues.push(`payload.event 不可结算：${error instanceof Error ? error.message : String(error)}`);
    }
    return issues;
  }
  if (kind === 'shop') {
    if (!isRecord(payload.shop)) issues.push('payload.shop 必须是对象');
    issues.push(...directNodeRewardShapeIssues(scope, reward));
    return issues;
  }
  if (kind === 'treasure') {
    if (!isRecord(payload.treasure)) issues.push('payload.treasure 必须是对象');
    issues.push(...directNodeRewardShapeIssues(scope, reward));
    return issues;
  }
  if (reward !== undefined) issues.push('营火节点不得写 reward');
  if (!isRecord(payload.rest)) issues.push('payload.rest 必须是对象');
  return issues;
}

export function parseTowerNodeResult(text: string, expected: TowerNodeScope): TowerNodeResult {
  const value = parseTaggedJson(
    text,
    TOWER_NODE_RESULT_TAG,
    candidate =>
      isRecord(candidate) &&
      candidate.spec === TOWER_NODE_RESULT_SPEC &&
      candidate.node_id === expected.nodeId &&
      candidate.request_id === expected.requestId &&
      candidate.based_on_revision === expected.basedOnRevision &&
      candidate.kind === expected.kind,
  );
  if (!isRecord(value) || value.spec !== TOWER_NODE_RESULT_SPEC) throw new Error('tower node result spec is invalid');
  if (
    value.node_id !== expected.nodeId ||
    value.request_id !== expected.requestId ||
    value.based_on_revision !== expected.basedOnRevision ||
    value.kind !== expected.kind
  ) {
    throw new Error('tower node result scope is stale or mismatched');
  }
  const normalizedValue = structuredClone(value) as Record<string, unknown>;
  // Event/rest nodes do not have a direct reward channel. Models sometimes
  // preserve an empty optional envelope after a repair. Removing an object
  // with no keys is semantics-preserving; a non-empty reward still fails so
  // authored content can never be silently discarded or moved.
  if (
    (expected.kind === 'event' || expected.kind === 'rest') &&
    isRecord(normalizedValue.reward) &&
    Object.keys(normalizedValue.reward).length === 0
  ) {
    delete normalizedValue.reward;
  }
  if (!boundedText(normalizedValue.title, 120) || !requiredTextValue(normalizedValue.narrative)) {
    throw new Error('tower node title or narrative is invalid');
  }
  if (!isRecord(normalizedValue.payload)) {
    throw new Error(`tower ${expected.kind} payload is invalid: payload 必须是对象`);
  }
  if (isBattleRunNode(expected.kind) && isRecord(normalizedValue.payload.battle)) {
    const battle = normalizedValue.payload.battle;
    if (battle.enemy == null && Array.isArray(battle.enemies) && battle.enemies.length > 0) delete battle.enemy;
    if (battle.enemies == null && isRecord(battle.enemy)) delete battle.enemies;
  }
  const payloadIssues = nodePayloadShapeIssues(expected, normalizedValue.payload, normalizedValue.reward);
  let normalizedBattleReward: unknown = normalizedValue.reward;
  if (isBattleRunNode(expected.kind)) {
    try {
      // Currency is program-owned, never authored. Providers can echo it from
      // MVU (including in a bounded repair); discard only those two metadata
      // fields and recompute, just as activation does. Unknown fields and
      // invalid creative candidates still fail; nested defeat_reward is intact.
      normalizedBattleReward = enforceBattleRewardBudget(normalizedValue.reward, battleRewardBudgetFor(expected), {
        allowProgramCurrency: true,
      });
    } catch (error) {
      payloadIssues.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (payloadIssues.length > 0) {
    throw new Error(
      `tower ${expected.kind} payload is invalid: ${payloadIssues.slice(0, 12).join('；')}${payloadIssues.length > 12 ? `；另有 ${payloadIssues.length - 12} 处` : ''}`,
    );
  }
  const parsed = normalizedValue as unknown as TowerNodeResult;
  if (isBattleRunNode(expected.kind)) {
    parsed.reward = normalizedBattleReward as TowerNodeResult['reward'];
  }
  delete parsed.program_shop_memory_ids;
  if (expected.kind === 'shop' && parsed.reward) {
    const reused = structuredClone(expected.shopMemoryCards?.slice(0, 2) ?? []);
    const cards = [...reused, ...((parsed.reward.cards as unknown[]) || [])];
    parsed.reward.cards = cards;
    parsed.reward.limits = { ...(parsed.reward.limits as object), cards: cards.length };
    parsed.program_shop_memory_ids = reused.map(card => card.id);
  }
  delete parsed.program_reward_seed;
  if (isBattleRunNode(expected.kind) && expected.rewardSeed !== undefined)
    parsed.program_reward_seed = expected.rewardSeed;
  delete parsed.program_balance;
  return parsed;
}

export function inspectTowerNodeBatchResult(
  text: string,
  batchId: string,
  jobs: readonly TowerGenerationJobDescriptor[],
  validate?: (result: TowerNodeResult, job: TowerGenerationJobDescriptor) => void,
): TowerNodeBatchInspection {
  if (jobs.length < 1 || jobs.length > 3) throw new Error('tower batch must contain one to three nodes');
  const expectedRevision = jobs[0].basedOnRevision;
  if (
    !batchId.trim() ||
    !Number.isInteger(expectedRevision) ||
    expectedRevision < 0 ||
    new Set(jobs.map(job => job.nodeId)).size !== jobs.length ||
    new Set(jobs.map(job => job.requestId)).size !== jobs.length ||
    jobs.some(job => !job.nodeId?.trim() || !job.requestId?.trim() || job.basedOnRevision !== expectedRevision)
  ) {
    throw new Error('tower node batch expected scope is invalid');
  }
  const value = parseTaggedJson(
    text,
    TOWER_NODE_BATCH_RESULT_TAG,
    candidate =>
      isRecord(candidate) &&
      candidate.spec === TOWER_NODE_BATCH_RESULT_SPEC &&
      candidate.batch_id === batchId &&
      candidate.based_on_revision === expectedRevision,
  );
  if (!isRecord(value) || value.spec !== TOWER_NODE_BATCH_RESULT_SPEC) {
    throw new Error('tower node batch result spec is invalid');
  }
  if (value.batch_id !== batchId || value.based_on_revision !== expectedRevision) {
    throw new Error('tower node batch scope is stale or mismatched');
  }
  if (!Array.isArray(value.results) || value.results.length !== jobs.length) {
    throw new Error(`tower node batch must contain exactly ${jobs.length} results`);
  }
  const rawByNodeId = new Map<string, unknown>();
  for (const entry of value.results) {
    if (!isRecord(entry) || typeof entry.node_id !== 'string' || rawByNodeId.has(entry.node_id)) {
      throw new Error('tower node batch contains an invalid or duplicate node result');
    }
    rawByNodeId.set(entry.node_id, entry);
  }
  // Identity and membership are batch-wide trust boundaries. Do not salvage
  // a sibling from an ambiguous, incomplete, duplicated or cross-scope batch.
  for (const job of jobs) {
    const entry = rawByNodeId.get(job.nodeId);
    if (
      !isRecord(entry) ||
      entry.spec !== TOWER_NODE_RESULT_SPEC ||
      entry.request_id !== job.requestId ||
      entry.based_on_revision !== job.basedOnRevision ||
      entry.kind !== job.kind
    ) {
      throw new Error(`${job.nodeId}: tower node batch member scope is stale or mismatched`);
    }
  }
  const entries: TowerNodeBatchEntry[] = jobs.map(job => {
    try {
      const result = parseTowerNodeResult(JSON.stringify(rawByNodeId.get(job.nodeId)), job);
      validate?.(result, job);
      return { nodeId: job.nodeId, ok: true, result };
    } catch (error) {
      return { nodeId: job.nodeId, ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
  return { batchId, basedOnRevision: expectedRevision, entries };
}

/** Existing strict consumers still require every member to be executable. */
export function parseTowerNodeBatchResult(
  text: string,
  batchId: string,
  jobs: readonly TowerGenerationJobDescriptor[],
): TowerNodeBatchResult {
  const inspected = inspectTowerNodeBatchResult(text, batchId, jobs);
  const resultErrors = inspected.entries.flatMap(entry => (entry.ok ? [] : [`${entry.nodeId}: ${entry.error}`]));
  if (resultErrors.length > 0) {
    throw new Error(`tower node batch contains invalid results: ${resultErrors.slice(0, 12).join('；')}`);
  }
  return {
    spec: TOWER_NODE_BATCH_RESULT_SPEC,
    batch_id: batchId,
    based_on_revision: inspected.basedOnRevision,
    results: inspected.entries.flatMap(entry => (entry.ok ? [entry.result] : [])),
  };
}

/** Inspect independent opening fields before spending a bounded repair request.
 * Reward rule/reference validation remains separate and must also run. */
export function collectTowerOpeningEnvelopeIssues(value: unknown): string[] {
  if (!isRecord(value)) return ['opening：必须是对象'];
  const issues: string[] = [];
  if (!boundedText(value.title, 120) || !requiredTextValue(value.narrative))
    issues.push('tower opening title or narrative is invalid');
  if (!Array.isArray(value.choices)) return [...issues, 'opening.choices：必须是恰好包含三项馈赠的数组'];
  if (value.choices.length !== 3)
    return [...issues, `opening.choices：需要恰好 3 项，实际为 ${value.choices.length} 项`];
  const choiceIds = new Set<string>();
  for (const [index, choice] of value.choices.entries()) {
    const path = `opening.choices[${index}]`;
    if (!isRecord(choice)) {
      issues.push(`${path}：必须是对象`);
      continue;
    }
    if (!boundedText(choice.id, 64)) issues.push(`${path}.id：必须是长度不超过 64 的非空字符串`);
    else {
      if (choiceIds.has(choice.id as string)) issues.push(`${path}.id：与前面的馈赠选项重复`);
      choiceIds.add(choice.id as string);
    }
    if (!boundedText(choice.label, 120)) issues.push(`${path}.label：必须是长度不超过 120 的非空字符串`);
    if (choice.description !== undefined && !boundedText(choice.description, 300))
      issues.push(`${path}.description：如果提供，必须是长度不超过 300 的字符串`);
    if (!isRecord(choice.outcome)) issues.push(`${path}.outcome：必须是可结算对象`);
    else
      try {
        planTowerOpeningOutcome(choice.outcome);
      } catch (error) {
        issues.push(`${path}.outcome：${error instanceof Error ? error.message : String(error)}`);
      }
  }
  return issues;
}

export function parseTowerOpeningResult(
  text: string,
  expected: Pick<TowerOpeningPromptInput, 'requestId' | 'basedOnRevision'>,
): TowerOpeningResult {
  const value = parseTaggedJson(
    text,
    TOWER_OPENING_RESULT_TAG,
    candidate =>
      isRecord(candidate) &&
      candidate.spec === TOWER_OPENING_RESULT_SPEC &&
      candidate.request_id === expected.requestId &&
      candidate.based_on_revision === expected.basedOnRevision,
  );
  if (!isRecord(value) || value.spec !== TOWER_OPENING_RESULT_SPEC)
    throw new Error('tower opening result spec is invalid');
  if (value.request_id !== expected.requestId || value.based_on_revision !== expected.basedOnRevision) {
    throw new Error('tower opening result scope is stale or mismatched');
  }
  const issues = collectTowerOpeningEnvelopeIssues(value);
  if (issues.length) throw new Error(issues.join('；'));
  return structuredClone(value) as unknown as TowerOpeningResult;
}
