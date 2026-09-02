import { isBattleRunNode, type RunNodeKind } from './runState';
import {
  enforceBattleRewardBudget,
  formatBattleRewardBudget,
  recommendTowerBattleRewardBudget,
  type BattleRewardBudget,
} from './contentBudget';
import { planTowerOpeningOutcome } from './towerOpeningOutcome';
import { planTowerEventOutcome } from './towerEventOutcome';

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
}

export interface TowerGenerationContext {
  /** Authoritative gameplay facts, with program-only map/cache/schema data removed. */
  completeMvuContext?: string;
  worldContext?: string;
  playerContext?: string;
  deckBalanceContext?: string;
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
}

export interface TowerNodeBatchResult {
  spec: typeof TOWER_NODE_BATCH_RESULT_SPEC;
  batch_id: string;
  based_on_revision: number;
  results: TowerNodeResult[];
}

export interface TowerProgramBalanceAudit {
  [key: string]: unknown;
  spec: string;
  winnableAtCurrentResources: boolean;
  modelRepairUsed: boolean;
}

export interface TowerBalanceRepairContext {
  playerDeckScore: number;
  targetEnemyScore: number;
  originalEnemyScore: number;
  finalEnemyScore: number;
  effectiveRatio: number;
  warnings?: string[];
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

type TowerNodeScope = Pick<TowerGenerationJobDescriptor, 'nodeId' | 'requestId' | 'basedOnRevision' | 'kind'>
  & Partial<Pick<TowerGenerationJobDescriptor, 'act' | 'floor'>>;

function battleRewardBudgetFor(scope: TowerNodeScope): BattleRewardBudget {
  if (!isBattleRunNode(scope.kind)) throw new Error('tower reward budget requires a battle node');
  return recommendTowerBattleRewardBudget({
    nodeId: scope.nodeId,
    kind: scope.kind as 'battle' | 'elite' | 'boss',
    act: scope.act ?? 1,
    floor: scope.floor ?? 1,
  });
}

function resultContractFor(scope: TowerNodeScope): string {
  const { kind } = scope;
  if (isBattleRunNode(kind)) {
    const budget = battleRewardBudgetFor(scope);
    const artifacts = budget.artifacts?.candidates ?? 0;
    const items = budget.items?.candidates ?? 0;
    return [
      'payload 必须包含 battle，且 battle 中至少有 enemy 或 enemies；reward 必须存在并预先给出本场胜利候选。',
      `本节点奖励预算固定为：${formatBattleRewardBudget(budget, { includeExperience: false })}。`,
      `reward 必须使用单数键并完整写成 card=${budget.cards.candidates}项、artifact=${artifacts}项、item=${items}项、limits={"cards":${budget.cards.pick},"artifacts":${budget.artifacts?.pick ?? 0},"items":${budget.items?.pick ?? 0}}；禁止增加或省略候选，也不要把复数 cards/artifacts/items 与单数键混用。`,
      'reward 不得复制当前 reward 的 request、disabled_categories、pool_revision、reroll_count 等程序运行字段。reward 中每个卡牌、遗物、道具的 id 必须在本次结果内唯一，也不得复用当前游戏事实里已经存在的 id；这是新候选，不要重新发放玩家已有内容。',
    ].join('');
  }
  if (kind === 'event')
    return 'payload 必须包含 event；event.choices 至少两个，每项含稳定 id、中文 label 与结构化 outcome。outcome 只允许 outcome、hp、max_hp、gold、card_removals、reward；数值都是相对变化，reward 使用 cards、artifacts、items 与可选 limits。';
  if (kind === 'shop') return 'payload 必须包含 shop；reward 必须存在并作为商店商品池，价格由程序结算。';
  if (kind === 'treasure') return 'payload 必须包含 treasure；reward 必须存在并作为宝箱候选。';
  return 'payload 必须包含 rest；只写简短休整情境，恢复、升级、删卡等操作由程序提供。';
}

/**
 * The tower worker does not inherit the story preset/worldbook. Keep the
 * executable boundary beside the JSON request so a provider cannot silently
 * fall back to its own nested "target / operator / condition" vocabulary.
 * This is deliberately structural: themes, mechanics and numbers remain free.
 */
function towerBattleDslContract(): string {
  return [
    '[战斗效果结构边界]',
    '所有 effects 都是浅层对象或浅层对象数组；连续、条件不同或触发不同的操作拆成数组项。禁止旧 effect、内部 spec/op/steps，以及 target、condition、operator、value 字段。',
    '目标只用同级 to:"self"/"opponent"，条件只用同级 when 字符串；数值运算直接写 add/subtract/multiply/divide/set。敌人来源中 self=该敌人，opponent=玩家。',
    '多个敌人时，enemies 每项必须有互不重复的稳定英文 id，只能使用字母、数字和下划线且不能以数字开头；不要使用冒号、短横线、空格或中文。敌人 action 只写 effects，不写 trigger。敌人 abilities 每项必须有稳定英文 id、中文 name/source/description，以及 trigger:{on:"触发时机",effects:浅层效果}；不得把 trigger 塞进 effects 数组项，也不得同时保留同级 effects。',
    '敌人行动模式只允许 random、probability、sequence、sequence_then_probability。random 不需要配置；probability 使用 action_config:{probability:{"行动名":正数权重}}；sequence 使用 action_config:{sequence:["行动名"]}；混合模式同时提供两项。',
    '持续被动使用 trigger:{on:"passive",effects:{modify:"damage|damage_taken|lust|lust_taken|heal|block|summon_capacity",add|subtract|multiply|divide|set:数值}}；modify 不得是对象。',
    'modify 与出牌规则都是持续规则：只能放在 ability 的 trigger.on="passive" 或状态 triggers.hold 中；不能放进敌人 action、卡牌、欲望效果、turn_start 等非 passive 触发。反过来，状态 triggers.hold 只能放 modify/出牌规则，damage、block、draw、apply_status 等即时效果应使用 tick、apply、stack、remove 或 threshold_execute。',
    '卡牌数值修改写成独立项，例如 {modify_card:"damage",multiply:1.5,from:"hand",pick:"random"}；不得嵌套 modify_card，也不得改 hits。',
    '状态先登记在 battle.statuses：{id,name,emoji,type,triggers}；triggers 的 apply/stack/tick/remove/hold/threshold_execute 直接对应浅层效果，不再包 effects。敌人 status_effects 只引用已登记状态 id 与当前 stacks。',
    '敌人欲望效果写 lust_effect:{name,description,effects}，不写 trigger；任何状态 id 都必须先在 battle.statuses 注册。',
  ].join('\n');
}

function towerRewardDslContract(): string {
  return [
    '[奖励可执行结构]',
    '任何奖励卡都必须有稳定英文 id、中文 name、type、rarity、cost（Curse 除外）和可执行浅层 effects；描述中的数值不能代替 effects。',
    'Power 是持续能力牌：若效果会在出牌后持续触发，必须使用 trigger:{on,effects} 且不要再保留同级即时 effects；若只想打出时立即造成伤害、格挡、抽牌或获得能量，应把 type 改为 Skill 或 Attack 并保留 effects。Power 也可以只在 effects 中施加一个已在 battle.statuses 登记、且自身带触发规则的状态。',
    '奖励遗物必须有稳定英文 id、中文 name、rarity 与 trigger:{on,effects}；奖励道具必须有稳定英文 id、中文 name、count 与浅层 effects。',
    '奖励卡、遗物、道具仍可自由设计题材、数值与机制，但必须能由当前效果系统直接执行。',
  ].join('\n');
}

/** Soft creative method shared by enemies and rewards; it deliberately contains no copyable content preset. */
function towerArchetypeDesignMethod(): string {
  return [
    '[流派与敌人创作方法]',
    '先读取玩家明确要求、当前卡组的流派画像与本轮剧情。明确指定的流派必须用真实 effects、trigger、状态、资源、牌区、召唤或规则字段形成“启动→运转→收益”；卡名、emoji、description 和题材换皮不算实现。未指定流派时不强行套图谱，允许通用散卡与剧情需要的简单机制。',
    '卡牌内容应让启动端能在正常抽牌中实际进入循环，并提供可兑现收益；可以深化当前流派、连接相邻机制、渐进转向或补独立短板，不按标签数量评价质量。',
    '召唤作为核心时必须真实使用 spawn_summon，并让召唤实例通过行动、触发、援护、资源、强化、选择或离场关系参与玩法；普通伤害与格挡仅改写召唤措辞不成立。',
    '敌人先把剧情身份转成可执行动作，再选择一个主压力与零到两个有因果协同的副机制；按铺垫、施压、兑现、保护或调整组织节奏，并提供可观察反制。它们是方法而非固定行动表，简单遭遇不必强行复杂化。',
    '敌人核心行为删去描述后仍须从可执行字段中成立；生命、欲望、控制、成长、格挡、召唤与牌库压力共享数值预算，增加一种强压力时减少其他压力。',
  ].join('\n');
}

/** Compact node prompt: topology and reward timing stay program-owned. */
export function formatTowerNodeGenerationPrompt(
  job: TowerGenerationJobDescriptor,
  context: TowerGenerationContext,
): string {
  const lines = [
    '[爬塔后台节点生成]',
    `node_id=${job.nodeId} request_id=${job.requestId} revision=${job.basedOnRevision}`,
    `act=${job.act} floor=${job.floor} kind=${job.kind}`,
    `content_seed=${job.contentSeed} reward_seed=${job.rewardSeed}`,
    `本幕倍率=${job.difficultyMultiplier} 玩家难度=${requireDifficulty(context.difficultyPercent)}%`,
    '只生成这个节点。不要改变地图、模式、run、玩家现有卡组或已经结算的内容。',
    'title 和 narrative 必须是中文；它们只描述当前节点，不代替或约束使用原预设生成的剧情正文。',
    resultContractFor(job),
  ];
  if (isBattleRunNode(job.kind)) lines.push(towerBattleDslContract());
  if (job.kind !== 'rest') lines.push(towerRewardDslContract());
  lines.push(towerArchetypeDesignMethod());
  const completeMvu = compactContext(context.completeMvuContext, 32_000);
  const world = completeMvu ? null : compactContext(context.worldContext, 8000);
  const player = completeMvu ? null : compactContext(context.playerContext, 10_000);
  const balance = compactContext(context.deckBalanceContext, 2400);
  const lineage = compactContext(context.enemyLineageContext, 1200);
  const custom = compactContext(context.customRequirements, 1000);
  if (completeMvu) lines.push(`[当前完整游戏事实]\n${completeMvu}`);
  else {
    if (world) lines.push(`[世界与当前进度]\n${world}`);
    if (player) lines.push(`[玩家状态]\n${player}`);
  }
  if (balance) lines.push(`[构筑与数值预算]\n${balance}`);
  if (lineage) lines.push(`[敌人谱系连续性]\n${lineage}`);
  if (custom) lines.push(`[玩家额外要求]\n${custom}`);
  lines.push(
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
    ...jobs.map((job, index) => [
      `[节点 ${index + 1}] node_id=${job.nodeId} request_id=${job.requestId}`,
      `act=${job.act} floor=${job.floor} kind=${job.kind}`,
      `content_seed=${job.contentSeed} reward_seed=${job.rewardSeed} 本幕倍率=${job.difficultyMultiplier}`,
      resultContractFor(job),
    ].join('\n')),
    `玩家难度=${requireDifficulty(context.difficultyPercent)}%`,
    '每个结果的 title 和 narrative 使用中文，只描述自己的节点；不得改变地图、模式、run、玩家已有内容或其他节点。',
  ];
  if (jobs.some(job => isBattleRunNode(job.kind))) lines.push(towerBattleDslContract());
  if (jobs.some(job => job.kind !== 'rest')) lines.push(towerRewardDslContract());
  lines.push(towerArchetypeDesignMethod());
  const completeMvu = compactContext(context.completeMvuContext, 32_000);
  const world = completeMvu ? null : compactContext(context.worldContext, 8000);
  const player = completeMvu ? null : compactContext(context.playerContext, 10_000);
  const balance = compactContext(context.deckBalanceContext, 3000);
  const lineage = compactContext(context.enemyLineageContext, 1600);
  const custom = compactContext(context.customRequirements, 1200);
  if (completeMvu) lines.push(`[当前完整游戏事实]\n${completeMvu}`);
  else {
    if (world) lines.push(`[世界与当前进度]\n${world}`);
    if (player) lines.push(`[玩家状态]\n${player}`);
  }
  if (balance) lines.push(`[构筑与数值预算]\n${balance}`);
  if (lineage) lines.push(`[敌人谱系连续性]\n${lineage}`);
  if (custom) lines.push(`[玩家额外要求]\n${custom}`);
  lines.push(
    '只输出一个 JSON 对象，不要使用 XML 标签或 Markdown 代码块。',
    `顶层固定为 spec="${TOWER_NODE_BATCH_RESULT_SPEC}"、batch_id、based_on_revision、results。`,
    `results 必须恰好 ${jobs.length} 项，每个指定 node_id/request_id 各出现一次，并保持清单顺序；每项仍使用 spec="${TOWER_NODE_RESULT_SPEC}" 的完整节点结构。`,
    '不要输出解释、思考过程、变量命令、额外正文或第二个对象。',
  );
  return lines.join('\n');
}

/** One optional, bounded repair after deterministic numeric calibration fails. */
export function formatTowerBattleBalanceRepairPrompt(
  result: TowerNodeResult,
  audit: TowerBalanceRepairContext,
): string {
  const source = structuredClone(result) as TowerNodeResult;
  delete source.program_balance;
  return [
    '[爬塔敌人可通关性修复]',
    `玩家卡组=${audit.playerDeckScore}分，目标敌人=${audit.targetEnemyScore}分，有效难度=${audit.effectiveRatio}%。`,
    `原始敌人=${audit.originalEnemyScore}分，程序最小数值调整后=${audit.finalEnemyScore}分，但模拟仍未达到可通关置信线。`,
    audit.warnings?.length ? `程序诊断：${audit.warnings.slice(0, 6).join('；')}` : '',
    '只修复 payload.battle 内造成必败、不可规避处决或永久锁死的机制，并让其存在可观察、可应对的窗口。',
    '保留敌人的剧情身份、名称、描述、行动名称、核心机制、title、narrative 和 reward；不得修改玩家、地图、run、节点范围或奖励。',
    '优先做最小机制修正；不要把敌人重写成单纯攻防木桩，也不要解释修改过程。所有效果必须沿用现有可执行 DSL。',
    `原结果：${JSON.stringify(source)}`,
    `只输出一个 <${TOWER_NODE_RESULT_TAG}>JSON</${TOWER_NODE_RESULT_TAG}>，顶层 scope 字段必须与原结果完全相同。`,
  ].filter(Boolean).join('\n');
}

/** One bounded retry for providers that return JSON with a non-executable node shape. */
export function formatTowerNodeStructureRepairPrompt(
  job: TowerNodeScope,
  response: string,
  error: unknown,
): string {
  const detail = error instanceof Error ? error.message : String(error);
  const unknownField = detail.match(/([^:\n]+):\s*Unknown field:\s*([A-Za-z_][A-Za-z0-9_]*)/i);
  const unknownFieldInstruction = unknownField
    ? `校验已经明确指出路径 ${unknownField[1].trim()} 不支持字段 ${unknownField[2]}：必须从该路径删除这个字段，不得原样回填；若要保留机制意图，请拆成多个浅层 effects 项，并只给每个主操作填写它支持的元字段。`
    : '';
  const targetFieldInstruction = unknownField?.[2] === 'to'
    ? '敌人行动的伤害与欲望伤害默认作用于玩家，格挡与自身增益默认作用于行动者；不要为了重复默认目标而给 draw、discard、copy 等不支持目标的操作添加 to。'
    : '';
  const rewardRepairInstruction = isBattleRunNode(job.kind) && /reward .* requires \d+ candidates/i.test(detail)
    ? '本次错误是奖励候选数量不足：保留已有合法候选，并新写不同 id、不同机制的候选补足到本节点固定数量；不得复制同一候选凑数，也不得仍按原来的不足数量返回。'
    : '';
  const powerRepairInstruction = /ROOT_TRIGGER_REQUIRED|Power 必须|Power 的所有顶层效果/i.test(detail)
    ? '本次错误来自 Power 能力牌结构：逐张检查 reward 中 type="Power" 的卡。持续能力要改成 trigger:{on:"合法触发时机",effects:浅层效果} 并删除同级 effects；只在打出当下结算的效果要把 type 改为 Skill 或 Attack 并保留 effects；只有“施加已登记且自带触发规则的状态”时才允许 Power 直接保留 effects。不要只改描述。'
    : '';
  return [
    '[爬塔后台节点结构修复]',
    `node_id=${job.nodeId} request_id=${job.requestId} revision=${job.basedOnRevision} kind=${job.kind}`,
    `上一份结果未通过可执行结构校验：${detail.slice(0, 800)}`,
    resultContractFor(job),
    ...(isBattleRunNode(job.kind) ? [towerBattleDslContract()] : []),
    ...(job.kind === 'rest' ? [] : [towerRewardDslContract()]),
    '只补全或修正缺失、错位的结构字段，保留原有题材、身份、名称、叙事、机制意图、数值与奖励。',
    unknownFieldInstruction,
    targetFieldInstruction,
    rewardRepairInstruction,
    powerRepairInstruction,
    '如果校验错误包含“重复 ID”或“duplicate ID”，只把冲突候选的 id 改成当前游戏事实与本结果中从未出现过的稳定英文 id；不要继续沿用冲突 id，也不要借此重写题材、机制或数值。',
    '如果校验错误提到“持续规则只允许”或“hold 只能包含”，逐项检查 modify/出牌规则与即时效果：纯持续能力改成 trigger.on="passive"；hold 只保留持续规则；即时效果移动到符合原意的 tick、apply、stack、remove 或 threshold_execute。不得只改字段名后保留同一非法嵌套。',
    'reward 只能保留 cards、artifacts、items 与 limits；删除 request、disabled_categories、pool_revision、reroll_count 等当前奖励池的程序运行字段，不得从当前游戏事实复制它们。',
    '战斗节点的每个敌人都必须有 actions；每个 action 必须有非空 name 和可执行 effects。effects 可以是一个效果对象，也可以是效果对象数组。',
    '不得修改玩家、地图、run、节点 scope 或请求标识，不得输出解释、思考过程、Markdown、UpdateVariable 或第二个结果。',
    `原始响应：${String(response || '').slice(0, 30_000)}`,
    '只输出一个满足 JSON Schema 的 JSON 对象，顶层 scope 字段必须与本请求完全相同。',
  ].join('\n');
}

export function formatTowerNodeBatchStructureRepairPrompt(
  batchId: string,
  jobs: readonly TowerGenerationJobDescriptor[],
  response: string,
  error: unknown,
): string {
  const detail = error instanceof Error ? error.message : String(error);
  return [
    '[爬塔后台批量节点结构修复]',
    `batch_id=${batchId} revision=${jobs[0]?.basedOnRevision ?? 0} node_count=${jobs.length}`,
    `上一份批量结果未通过可执行校验：${detail.slice(0, 1200)}`,
    ...jobs.map(job => [
      `node_id=${job.nodeId} request_id=${job.requestId} kind=${job.kind} act=${job.act} floor=${job.floor}`,
      resultContractFor(job),
    ].join('\n')),
    ...(jobs.some(job => isBattleRunNode(job.kind)) ? [towerBattleDslContract()] : []),
    ...(jobs.some(job => job.kind !== 'rest') ? [towerRewardDslContract()] : []),
    '保留原有题材、身份、标题、叙事、机制意图和数值，只修正缺失、错位、非法或不完整的结构。',
    '不得遗漏节点、增加节点、交换 request_id，也不得修改玩家、地图、模式、run 或请求标识。',
    `原始响应：${String(response || '').slice(0, 60_000)}`,
    '只输出一个满足本次 JSON Schema 的批量 JSON 对象，不输出解释、Markdown、UpdateVariable 或第二个结果。',
  ].join('\n');
}

/** Bounded repair for a structurally invalid opening gift response. */
export function formatTowerOpeningStructureRepairPrompt(
  job: Pick<TowerOpeningPromptInput, 'requestId' | 'basedOnRevision'>,
  response: string,
  error: unknown,
): string {
  const detail = error instanceof Error ? error.message : String(error);
  return [
    '[爬塔开局馈赠结构修复]',
    `request_id=${job.requestId} revision=${job.basedOnRevision}`,
    `上一份结果未通过可执行结构校验：${detail.slice(0, 800)}`,
    '保留原来的馈赠者、标题、叙事、选项主题、代价和收益意图，只修正不合法或缺失的字段。',
    '每个 choice 必须包含唯一的 id、非空 label 和 outcome 对象；description 可选。',
    'outcome 只允许 hp、max_hp、gold、card_removals、reward；这些数值必须是整数且表示相对变化。',
    'reward 只允许 cards、artifacts、items 数组；省略没有奖励的类别，不得写单个对象、数字、字符串、limits 或运行时奖励池字段。',
    towerRewardDslContract(),
    towerArchetypeDesignMethod(),
    '不得修改 request_id、based_on_revision 或顶层 spec，不得输出解释、思考过程、Markdown、UpdateVariable 或第二个结果。',
    `原始响应：${String(response || '').slice(0, 30_000)}`,
    '只输出一个满足本次 json_schema 的 JSON 对象。',
  ].join('\n');
}

export interface TowerOpeningPromptInput {
  requestId: string;
  basedOnRevision: number;
  seed: number;
  context: TowerGenerationContext;
}

export function formatTowerOpeningGenerationPrompt(input: TowerOpeningPromptInput): string {
  const lines = [
    '[爬塔开局馈赠事件]',
    `request_id=${input.requestId} revision=${input.basedOnRevision} seed=${input.seed}`,
    `玩家难度=${requireDifficulty(input.context.difficultyPercent)}%`,
    '根据当前世界、角色与卡组创造一位适合开场的馈赠者或引路存在，不绑定固定身份。',
    'narrative 要承接玩家已经进入的处境，并让馈赠自然成为连续战斗旅程的起点；只限定这一叙事架构，不限定文风或长度。',
    '提供二至四个中文选择；可以无条件馈赠，也可以让玩家用明确代价换取更高收益。所有结果必须结构化且可由程序一次结算。',
    '每个 outcome 只允许 hp、max_hp、gold、card_removals、reward；数值都是相对变化。reward 只允许 cards、artifacts、items 数组，可省略不变化的字段。',
    '爬塔模式最多携带三个战斗道具；根据当前事实中的 battle.items 控制馈赠道具数量，不能让任一选项结算后超过三个。',
    '不要修改地图、模式和 run，不要展开后续节点；这里的 narrative 不覆盖剧情模型所用的原预设。',
  ];
  lines.push(towerRewardDslContract(), towerArchetypeDesignMethod());
  const completeMvu = compactContext(input.context.completeMvuContext, 32_000);
  const world = completeMvu ? null : compactContext(input.context.worldContext, 8000);
  const player = completeMvu ? null : compactContext(input.context.playerContext, 10_000);
  const balance = compactContext(input.context.deckBalanceContext, 2200);
  const custom = compactContext(input.context.customRequirements, 1000);
  if (completeMvu) lines.push(`[当前完整游戏事实]\n${completeMvu}`);
  else {
    if (world) lines.push(`[世界与开局]\n${world}`);
    if (player) lines.push(`[玩家状态]\n${player}`);
  }
  if (balance) lines.push(`[初始构筑预算]\n${balance}`);
  if (custom) lines.push(`[玩家额外要求]\n${custom}`);
  lines.push(
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

export function createTowerOpeningJsonSchema(): TowerJsonSchema {
  return {
    name: 'mwg_tower_opening_result',
    description: '魔法少女世界爬塔模式开局馈赠结果',
    strict: false,
    value: {
      type: 'object',
      properties: {
        spec: { type: 'string', const: TOWER_OPENING_RESULT_SPEC },
        request_id: { type: 'string' },
        based_on_revision: { type: 'integer', minimum: 0 },
        title: { type: 'string' },
        narrative: { type: 'string' },
        choices: {
          type: 'array',
          minItems: 2,
          maxItems: 4,
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              label: { type: 'string' },
              description: { type: 'string' },
              outcome: {
                type: 'object',
                properties: {
                  hp: { type: 'integer', minimum: -999, maximum: 999 },
                  max_hp: { type: 'integer', minimum: -99, maximum: 999 },
                  gold: { type: 'integer', minimum: -9999, maximum: 9999 },
                  card_removals: { type: 'integer', minimum: -20, maximum: 20 },
                  reward: {
                    type: 'object',
                    properties: {
                      cards: createTowerRewardEntryArrayJsonSchema('cards', { maximum: 6 }),
                      artifacts: createTowerRewardEntryArrayJsonSchema('artifacts', { maximum: 6 }),
                      items: createTowerRewardEntryArrayJsonSchema('items', { maximum: 6 }),
                    },
                    additionalProperties: false,
                  },
                },
                additionalProperties: false,
              },
            },
            required: ['id', 'label', 'outcome'],
          },
        },
      },
      required: ['spec', 'request_id', 'based_on_revision', 'title', 'narrative', 'choices'],
    },
  };
}

function createTowerEffectsJsonSchema(): Record<string, unknown> {
  return {
    anyOf: [
      { type: 'object', minProperties: 1 },
      { type: 'array', minItems: 1, items: { type: 'object', minProperties: 1 } },
    ],
  };
}

function createTowerTriggeredDefinitionJsonSchema(): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      id: { type: 'string', pattern: '^[A-Za-z_][A-Za-z0-9_]*$' },
      name: { type: 'string', minLength: 1 },
      source: { type: 'string', minLength: 1 },
      description: { type: 'string' },
      emoji: { type: 'string' },
      trigger: {
        type: 'object',
        properties: {
          on: { type: 'string', minLength: 1 },
          effects: createTowerEffectsJsonSchema(),
        },
        required: ['on', 'effects'],
      },
    },
    required: ['id', 'name', 'source', 'trigger'],
  };
}

function createTowerActiveStatusJsonSchema(): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      id: { type: 'string', pattern: '^[A-Za-z_][A-Za-z0-9_]*$' },
      stacks: { type: 'integer', minimum: 1 },
    },
    required: ['id', 'stacks'],
  };
}

function createTowerStatusDefinitionJsonSchema(): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      id: { type: 'string', pattern: '^[A-Za-z_][A-Za-z0-9_]*$' },
      name: { type: 'string', minLength: 1 },
      emoji: { type: 'string', minLength: 1 },
      type: { type: 'string', enum: ['buff', 'debuff', 'neutral'] },
      description: { type: 'string' },
      maxStacks: { type: 'integer', minimum: 1 },
      stacks_change: { type: ['string', 'number'] },
      triggers: { type: 'object' },
    },
    required: ['id', 'name', 'emoji', 'type', 'triggers'],
  };
}

function createTowerNamedEffectsJsonSchema(): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      name: { type: 'string', minLength: 1 },
      description: { type: 'string' },
      emoji: { type: 'string' },
      effects: createTowerEffectsJsonSchema(),
    },
    required: ['name', 'effects'],
  };
}

function createTowerRewardTriggerJsonSchema(): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      on: { type: 'string', minLength: 1 },
      effects: createTowerEffectsJsonSchema(),
    },
    required: ['on', 'effects'],
  };
}

function createTowerRewardCardJsonSchema(): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      id: { type: 'string', pattern: '^[A-Za-z_][A-Za-z0-9_-]*$' },
      name: { type: 'string', minLength: 1 },
      type: { type: 'string', minLength: 1 },
      rarity: { type: 'string', minLength: 1 },
      cost: {},
      quantity: { type: 'integer', minimum: 0, maximum: 100 },
      emoji: { type: 'string' },
      description: { type: 'string' },
      effects: createTowerEffectsJsonSchema(),
      trigger: createTowerRewardTriggerJsonSchema(),
    },
    required: ['id', 'name', 'type', 'rarity'],
    anyOf: [{ required: ['effects'] }, { required: ['trigger'] }],
  };
}

function createTowerRewardArtifactJsonSchema(): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      id: { type: 'string', pattern: '^[A-Za-z_][A-Za-z0-9_-]*$' },
      name: { type: 'string', minLength: 1 },
      rarity: { type: 'string', minLength: 1 },
      emoji: { type: 'string' },
      description: { type: 'string' },
      trigger: createTowerRewardTriggerJsonSchema(),
    },
    required: ['id', 'name', 'rarity', 'trigger'],
  };
}

function createTowerRewardItemJsonSchema(): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      id: { type: 'string', pattern: '^[A-Za-z_][A-Za-z0-9_-]*$' },
      name: { type: 'string', minLength: 1 },
      count: { type: 'integer', minimum: 1, maximum: 999 },
      emoji: { type: 'string' },
      description: { type: 'string' },
      effects: createTowerEffectsJsonSchema(),
    },
    required: ['id', 'name', 'count', 'effects'],
  };
}

function createTowerRewardEntryArrayJsonSchema(
  category: 'cards' | 'artifacts' | 'items',
  options: { minimum?: number; maximum?: number } = {},
): Record<string, unknown> {
  const item = category === 'cards'
    ? createTowerRewardCardJsonSchema()
    : category === 'artifacts'
      ? createTowerRewardArtifactJsonSchema()
      : createTowerRewardItemJsonSchema();
  return {
    type: 'array',
    ...(options.minimum === undefined ? {} : { minItems: options.minimum }),
    ...(options.maximum === undefined ? {} : { maxItems: options.maximum }),
    items: item,
  };
}

function createTowerEnemyJsonSchema(requireId = false): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      id: { type: 'string', pattern: '^[A-Za-z_][A-Za-z0-9_]*$' },
      name: { type: 'string', minLength: 1 },
      emoji: { type: 'string' },
      description: { type: 'string' },
      hp: { type: 'number', minimum: 0 },
      max_hp: { type: 'number', exclusiveMinimum: 0 },
      lust: { type: 'number', minimum: 0 },
      max_lust: { type: 'number', exclusiveMinimum: 0 },
      actions: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string', minLength: 1 },
            description: { type: 'string' },
            weight: { type: 'number', exclusiveMinimum: 0 },
            effects: createTowerEffectsJsonSchema(),
          },
          required: ['name', 'effects'],
        },
      },
      abilities: { type: 'array', items: createTowerTriggeredDefinitionJsonSchema() },
      status_effects: { type: 'array', items: createTowerActiveStatusJsonSchema() },
      lust_effect: createTowerNamedEffectsJsonSchema(),
      action_mode: { type: 'string', enum: ['random', 'probability', 'sequence', 'sequence_then_probability'] },
      action_config: { type: 'object' },
    },
    required: [...(requireId ? ['id'] : []), 'name', 'hp', 'max_hp', 'lust', 'max_lust', 'actions'],
  };
}

function createTowerNodePayloadJsonSchema(kind: RunNodeKind): Record<string, unknown> {
  if (isBattleRunNode(kind)) {
    const enemy = createTowerEnemyJsonSchema();
    const rosterEnemy = createTowerEnemyJsonSchema(true);
    return {
      type: 'object',
      properties: {
        battle: {
          type: 'object',
          additionalProperties: false,
          properties: {
            enemy,
            enemies: { type: 'array', minItems: 1, items: rosterEnemy },
            statuses: { type: 'array', items: createTowerStatusDefinitionJsonSchema() },
            player_abilities: { type: 'array', items: createTowerTriggeredDefinitionJsonSchema() },
            player_status_effects: { type: 'array', items: createTowerActiveStatusJsonSchema() },
          },
          anyOf: [{ required: ['enemy'] }, { required: ['enemies'] }],
        },
      },
      required: ['battle'],
    };
  }
  if (kind === 'event') {
    return {
      type: 'object',
      additionalProperties: false,
      properties: {
        event: {
          type: 'object',
          additionalProperties: false,
          properties: {
            choices: {
              type: 'array',
              minItems: 2,
              maxItems: 6,
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  id: { type: 'string', minLength: 1 },
                  label: { type: 'string', minLength: 1 },
                  description: { type: 'string' },
                  outcome: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      outcome: { type: 'string', enum: ['cleared', 'failed', 'escaped'] },
                      hp: { type: 'integer', minimum: -999, maximum: 999 },
                      max_hp: { type: 'integer', minimum: -99, maximum: 999 },
                      gold: { type: 'integer', minimum: -9999, maximum: 9999 },
                      card_removals: { type: 'integer', minimum: -20, maximum: 20 },
                      reward: {
                        type: 'object',
                        additionalProperties: false,
                        properties: {
                          cards: createTowerRewardEntryArrayJsonSchema('cards', { maximum: 6 }),
                          artifacts: createTowerRewardEntryArrayJsonSchema('artifacts', { maximum: 6 }),
                          items: createTowerRewardEntryArrayJsonSchema('items', { maximum: 6 }),
                          limits: {
                            type: 'object',
                            additionalProperties: false,
                            properties: {
                              cards: { type: 'integer', minimum: 0 },
                              artifacts: { type: 'integer', minimum: 0 },
                              items: { type: 'integer', minimum: 0 },
                            },
                          },
                        },
                      },
                    },
                  },
                },
                required: ['id', 'label', 'outcome'],
              },
            },
          },
          required: ['choices'],
        },
      },
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
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      card: createTowerRewardEntryArrayJsonSchema('cards'),
      artifact: createTowerRewardEntryArrayJsonSchema('artifacts'),
      item: createTowerRewardEntryArrayJsonSchema('items'),
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
      },
    },
  };
}

export function createTowerNodeJsonSchema(kind: RunNodeKind, scope: Partial<Pick<TowerGenerationJobDescriptor, 'nodeId' | 'act' | 'floor'>> = {}): TowerJsonSchema {
  const nodeScope: TowerNodeScope = {
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
    value: {
      type: 'object',
      properties: {
        spec: { type: 'string', const: TOWER_NODE_RESULT_SPEC },
        node_id: { type: 'string' },
        request_id: { type: 'string' },
        based_on_revision: { type: 'integer', minimum: 0 },
        kind: { type: 'string', const: kind },
        title: { type: 'string' },
        narrative: { type: 'string' },
        payload: createTowerNodePayloadJsonSchema(kind),
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
    },
  };
}

export function createTowerNodeBatchJsonSchema(
  batchId: string,
  jobs: readonly TowerGenerationJobDescriptor[],
): TowerJsonSchema {
  if (!batchId.trim()) throw new Error('tower batch id is invalid');
  if (jobs.length < 1 || jobs.length > 3) throw new Error('tower batch must contain one to three nodes');
  const nodeSchemas = jobs.map(job => {
    const value = structuredClone(createTowerNodeJsonSchema(job.kind, {
      nodeId: job.nodeId,
      act: job.act,
      floor: job.floor,
    }).value) as Record<string, any>;
    value.properties.node_id = { type: 'string', const: job.nodeId };
    value.properties.request_id = { type: 'string', const: job.requestId };
    value.properties.based_on_revision = { type: 'integer', const: job.basedOnRevision };
    return value;
  });
  return {
    name: 'mwg_tower_node_batch_result',
    description: '魔法少女世界爬塔模式当前可达窗口的批量节点结果',
    strict: false,
    value: {
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
    },
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
 * Providers occasionally echo the requested result block in reasoning, repeat
 * an identical final block, or omit only the XML wrapper while still returning
 * one scoped JSON object. Treat those transport artefacts as recoverable, but
 * never guess between two different valid scoped results.
 */
function parseTaggedJson(
  text: string,
  tag: string,
  acceptsScope: (value: unknown) => boolean,
): unknown {
  const pattern = new RegExp(`<${tag}>\\s*([\\s\\S]*?)\\s*<\\/${tag}>`, 'g');
  const matches = [...text.matchAll(pattern)];
  const bodies = matches.length > 0 ? matches.map(match => match[1]) : fallbackJsonBodies(text);
  const parsed: unknown[] = [];
  let lastError: unknown = null;
  for (const body of bodies) {
    try {
      parsed.push(JSON.parse(body));
    } catch (error) {
      lastError = error;
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
    throw new Error(`${tag} result JSON is invalid: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
  }
  throw new Error(`${tag} result block is missing`);
}

function validateNodePayloadShape(kind: RunNodeKind, payload: Record<string, unknown>, reward: unknown): boolean {
  if (isBattleRunNode(kind)) {
    const battle = isRecord(payload.battle) ? payload.battle : null;
    if (!battle || !isRecord(reward)) return false;
    const allowedBattleFields = new Set([
      'enemy',
      'enemies',
      'statuses',
      'player_abilities',
      'player_status_effects',
    ]);
    if (Object.keys(battle).some(key => !allowedBattleFields.has(key))) return false;
    const validEffects = (value: unknown): boolean =>
      (isRecord(value) && Object.keys(value).length > 0) ||
      (Array.isArray(value) && value.length > 0 && value.every(entry => isRecord(entry) && Object.keys(entry).length > 0));
    const validEnemy = (value: unknown, requireId = false): boolean => {
      if (!isRecord(value) || !boundedText(value.name, 120)) return false;
      const id = typeof value.id === 'string' ? value.id.trim() : '';
      if ((requireId && !id) || (id && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(id))) return false;
      const hp = Number(value.hp);
      const maxHp = Number(value.max_hp);
      const lust = Number(value.lust);
      const maxLust = Number(value.max_lust);
      if (
        !Number.isFinite(hp) || hp < 0 ||
        !Number.isFinite(maxHp) || maxHp <= 0 || hp > maxHp ||
        !Number.isFinite(lust) || lust < 0 ||
        !Number.isFinite(maxLust) || maxLust <= 0 || lust > maxLust
      ) return false;
      return Array.isArray(value.actions) && value.actions.length > 0 && value.actions.every(action =>
        isRecord(action) && boundedText(action.name, 120) && validEffects(action.effects),
      );
    };
    const hasEnemy = battle.enemy !== undefined;
    const hasEnemies = battle.enemies !== undefined;
    if (!hasEnemy && !hasEnemies) return false;
    if (hasEnemy && !validEnemy(battle.enemy)) return false;
    if (
      hasEnemies &&
      (!Array.isArray(battle.enemies) || battle.enemies.length === 0 || !battle.enemies.every(enemy => validEnemy(enemy, true)))
    ) return false;
    if (hasEnemies) {
      const ids = (battle.enemies as Array<Record<string, unknown>>).map(enemy => String(enemy.id));
      if (new Set(ids).size !== ids.length) return false;
    }
    return true;
  }
  if (kind === 'event') {
    const event = isRecord(payload.event) ? payload.event : null;
    const choices = event?.choices;
    const shapeValid =
      Array.isArray(choices) &&
      choices.length >= 2 &&
      choices.length <= 6 &&
      choices.every(
        choice =>
          isRecord(choice) && boundedText(choice.id, 64) && boundedText(choice.label, 120) && isRecord(choice.outcome),
      );
    if (!shapeValid) return false;
    try {
      for (const choice of choices as Array<Record<string, unknown>>) planTowerEventOutcome(choice.outcome);
      return true;
    } catch {
      return false;
    }
  }
  if (kind === 'shop') return isRecord(payload.shop) && isRecord(reward);
  if (kind === 'treasure') return isRecord(payload.treasure) && isRecord(reward);
  return isRecord(payload.rest);
}

export function parseTowerNodeResult(
  text: string,
  expected: TowerNodeScope,
): TowerNodeResult {
  const value = parseTaggedJson(text, TOWER_NODE_RESULT_TAG, candidate =>
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
  if (!boundedText(value.title, 120) || !requiredTextValue(value.narrative)) {
    throw new Error('tower node title or narrative is invalid');
  }
  if (!isRecord(value.payload) || !validateNodePayloadShape(expected.kind, value.payload, value.reward)) {
    throw new Error(`tower ${expected.kind} payload is invalid`);
  }
  const parsed = structuredClone(value) as unknown as TowerNodeResult;
  if (isBattleRunNode(expected.kind)) {
    parsed.reward = enforceBattleRewardBudget(parsed.reward, battleRewardBudgetFor(expected));
  }
  delete parsed.program_balance;
  return parsed;
}

export function parseTowerNodeBatchResult(
  text: string,
  batchId: string,
  jobs: readonly TowerGenerationJobDescriptor[],
): TowerNodeBatchResult {
  if (jobs.length < 1 || jobs.length > 3) throw new Error('tower batch must contain one to three nodes');
  const expectedRevision = jobs[0].basedOnRevision;
  const value = parseTaggedJson(text, TOWER_NODE_BATCH_RESULT_TAG, candidate =>
    isRecord(candidate)
    && candidate.spec === TOWER_NODE_BATCH_RESULT_SPEC
    && candidate.batch_id === batchId
    && candidate.based_on_revision === expectedRevision,
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
  const results = jobs.map(job => {
    const entry = rawByNodeId.get(job.nodeId);
    if (!entry) throw new Error(`tower node batch is missing ${job.nodeId}`);
    return parseTowerNodeResult(JSON.stringify(entry), job);
  });
  return {
    spec: TOWER_NODE_BATCH_RESULT_SPEC,
    batch_id: batchId,
    based_on_revision: expectedRevision,
    results,
  };
}

export function parseTowerOpeningResult(
  text: string,
  expected: Pick<TowerOpeningPromptInput, 'requestId' | 'basedOnRevision'>,
): TowerOpeningResult {
  const value = parseTaggedJson(text, TOWER_OPENING_RESULT_TAG, candidate =>
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
  if (!boundedText(value.title, 120) || !requiredTextValue(value.narrative)) {
    throw new Error('tower opening title or narrative is invalid');
  }
  if (
    !Array.isArray(value.choices) ||
    value.choices.length < 2 ||
    value.choices.length > 4 ||
    value.choices.some(
      choice =>
        !isRecord(choice) ||
        !boundedText(choice.id, 64) ||
        !boundedText(choice.label, 120) ||
        (choice.description !== undefined && !boundedText(choice.description, 300)) ||
        !isRecord(choice.outcome),
    ) ||
    new Set(value.choices.map(choice => (choice as Record<string, unknown>).id)).size !== value.choices.length
  ) {
    throw new Error('tower opening choices are invalid');
  }
  for (const choice of value.choices) {
    planTowerOpeningOutcome((choice as Record<string, unknown>).outcome);
  }
  return structuredClone(value) as unknown as TowerOpeningResult;
}
