import { createBattleRandomState, drawBattleRandom, stableHash32 } from './deterministicRandom';
import type { EnemyBudgetEnvelope } from './encounterBalance';

export const TOWER_ENCOUNTER_PLAN_SPEC = 'mwg.tower-encounter-plan/v1' as const;
/** Design priors, maintained here. They are not claims about Slay the Spire. */
export const TOWER_ENEMY_COUNT_WEIGHTS = {
  battle: [35, 35, 20, 7, 3], elite: [60, 10, 10, 10, 10], boss: [60, 10, 10, 10, 10],
} as const;

export interface TowerEncounterScope {
  nodeId: string; kind: string; contentSeed?: number; act?: number; floor?: number;
}

export interface TowerEncounterPlan {
  spec: typeof TOWER_ENCOUNTER_PLAN_SPEC;
  enemyCount: number;
  countSeed: number;
  act: number;
  floor: number;
  /** Entire encounter, never a budget to be copied onto every enemy. */
  totalBudget?: EnemyBudgetEnvelope;
  enemyShares: number[];
  challenge: string[];
}

/** No request/revision/time input: retrying and restoring cannot reroll the count. */
export function createTowerEncounterPlan(scope: TowerEncounterScope, budget?: EnemyBudgetEnvelope): TowerEncounterPlan | undefined {
  if (!Object.hasOwn(TOWER_ENEMY_COUNT_WEIGHTS, scope.kind) || !Number.isInteger(scope.contentSeed)) return undefined;
  const kind = scope.kind as keyof typeof TOWER_ENEMY_COUNT_WEIGHTS;
  const countSeed = stableHash32([TOWER_ENCOUNTER_PLAN_SPEC, scope.contentSeed, scope.nodeId, kind]);
  let cursor = drawBattleRandom(createBattleRandomState(countSeed)).value * 100;
  const weights = TOWER_ENEMY_COUNT_WEIGHTS[kind];
  let enemyCount: number = weights.length;
  for (let index = 0; index < weights.length; index++) {
    cursor -= weights[index];
    if (cursor < 0) { enemyCount = index + 1; break; }
  }
  const act = Math.max(1, Math.trunc(scope.act || 1));
  const elite = kind !== 'battle';
  return {
    spec: TOWER_ENCOUNTER_PLAN_SPEC, enemyCount, countSeed, act, floor: Math.max(1, Math.trunc(scope.floor || 1)),
    ...(budget ? { totalBudget: structuredClone(budget) } : {}),
    enemyShares: Array.from({ length: enemyCount }, (_, index) => enemyCount === 1 ? 1 : index === 0 ? 0.4 : 0.6 / (enemyCount - 1)),
    challenge: [
      '先分配全遭遇的总耐久、每回合输出与爆发窗口，再分摊给敌人；不能每个敌人重复使用总预算。角色可重新分摊，首个主敌不要求固定外观或剧情身份。',
      '普通/低难度保留公开意图和可回应的压力；约三回合是参考构筑的整体互动目标，不能锁血或强制每只敌人存活三回合。',
      enemyCount > 1 ? '让目标优先级影响战局：输出、支援、保护或成长职责应使不同击杀顺序产生实际后果，避免同一弱敌复制成群。' : '单体也应有准备、施压和回应窗口，不能每回合无变化地重复一个数值。',
      elite ? '精英/首领至少有一条独特机制链与明确反制窗口；挑战来自可读机制和数值压力，不用无预警必杀。' : '普通遭遇可采用单主机制或简单协同，对防御、抢杀、资源使用至少形成一种取舍。',
      act >= 3 ? '第三幕检验已成型流派：多阶段、协同或增援可组合，但必须有节奏和回应时间，不能凭流派标签生成免疫。'
        : act >= 2 ? '第二幕承接更强的玩家构筑，增加一个可读副机制或协同压力，不把新牌带来的收益全部抵消。'
          : '第一幕为流派启动期，让玩家理解自己的资源、启动和兑现过程。',
    ],
  };
}

export function formatTowerEncounterPlan(scope: TowerEncounterScope, budget?: EnemyBudgetEnvelope): string {
  const plan = createTowerEncounterPlan(scope, budget);
  if (!plan) return '';
  return `[程序遭遇计划]\npayload.battle.enemies 必须恰好 ${plan.enemyCount} 名，禁止另写 enemy；重试保持数量。\n${JSON.stringify(plan)}\n${plan.totalBudget ? 'totalBudget 是整场预算；enemyShares 仅为可调整的职责分摊起点，合计必须为1。' : '数值参考当前真实玩家构筑与下方生存/输出预算；若已有画像未覆盖核心机制，不得将其零收益当作玩家真实实力。'}`;
}
