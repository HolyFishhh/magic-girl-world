import { RUN_NODE_KINDS, type RunNodeChoice, type RunNodeCounts, type RunNodeKind, type RunState } from './runState';

export type RunPacingPhase = 'opening' | 'development' | 'pressure' | 'finale';
export type RunEventCost = 'none' | 'light' | 'tradeoff' | 'high';
export type RunShopTier = 'none' | 'basic' | 'focused' | 'premium';
export type RunRewardTier = 'standard' | 'enhanced' | 'major';
export type RunStoryBeat = 'setup' | 'escalation' | 'resolution';

export interface RunPacingContext {
  act: number;
  actCount?: number;
  floor: number;
  floorsPerAct?: number;
  kind: RunNodeKind;
  danger: 0 | 1 | 2 | 3;
  nodeCounts?: Partial<RunNodeCounts>;
}

export interface RunNodePacing {
  phase: RunPacingPhase;
  intensity: 1 | 2 | 3 | 4;
  repeatCount: number;
  eventCost: RunEventCost;
  shopTier: RunShopTier;
  rewardTier: RunRewardTier;
  storyBeat: RunStoryBeat;
}

const PHASE_LABELS: Record<RunPacingPhase, string> = {
  opening: '开局建立规则',
  development: '中段形成联动',
  pressure: '后段提高压力',
  finale: '终局集中检验',
};

const EVENT_COST_LABELS: Record<RunEventCost, string> = {
  none: '',
  light: '轻量代价',
  tradeoff: '明确取舍',
  high: '高价值高代价',
};

const SHOP_TIER_LABELS: Record<RunShopTier, string> = {
  none: '',
  basic: '基础补给',
  focused: '定向补强',
  premium: '高阶成长',
};

const STORY_BEAT_LABELS: Record<RunStoryBeat, string> = {
  setup: '建立威胁与关键关系',
  escalation: '揭示幕后联系，让既有选择产生后果',
  resolution: '回收伏笔，推进最终决战',
};

function integer(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const numeric = Number(value);
  if (!Number.isInteger(numeric)) return fallback;
  return Math.max(minimum, Math.min(maximum, numeric));
}

/** Normalize an Act at a shared boundary so consumers do not reimplement clamping. */
export function normalizeRunAct(value: unknown, maximum = 9): number {
  const numeric = Number(value);
  const upper = integer(maximum, 9, 1, 9);
  return Number.isFinite(numeric) ? Math.max(1, Math.min(upper, Math.floor(numeric))) : 1;
}

function phaseFor(floor: number, floorsPerAct: number, kind: RunNodeKind): RunPacingPhase {
  if (kind === 'boss' || floor >= floorsPerAct - 1) return 'finale';
  if (floor <= Math.max(2, Math.ceil(floorsPerAct * 0.2))) return 'opening';
  if (floor / floorsPerAct >= 0.65) return 'pressure';
  return 'development';
}

function intensityFor(phase: RunPacingPhase, act: number, kind: RunNodeKind, danger: 0 | 1 | 2 | 3): 1 | 2 | 3 | 4 {
  if (kind === 'boss') return 4;
  const base: Record<RunPacingPhase, number> = { opening: 1, development: 2, pressure: 3, finale: 4 };
  return Math.min(4, Math.max(danger, base[phase] + Math.max(0, act - 1))) as 1 | 2 | 3 | 4;
}

/** One deterministic pacing contract shared by route prompts, budgets, and adapters. */
export function recommendRunNodePacing(input: RunPacingContext): RunNodePacing {
  const act = normalizeRunAct(input.act);
  const actCount = integer(input.actCount, 3, 1, 9);
  const floor = integer(input.floor, 1, 1, 99);
  const floorsPerAct = integer(input.floorsPerAct, 10, 4, 99);
  const phase = phaseFor(floor, floorsPerAct, input.kind);
  const repeatCount = integer(input.nodeCounts?.[input.kind], 0, 0, 9999);
  const storyBeat: RunStoryBeat = act === 1 ? 'setup' : act >= actCount ? 'resolution' : 'escalation';
  const eventCost: RunEventCost =
    input.kind !== 'event'
      ? 'none'
      : phase === 'opening'
        ? act === 1
          ? 'light'
          : 'tradeoff'
        : phase === 'development' && act < 3
          ? 'tradeoff'
          : 'high';
  const shopTier: RunShopTier =
    input.kind !== 'shop'
      ? 'none'
      : phase === 'opening' && act === 1
        ? 'basic'
        : phase === 'pressure' || phase === 'finale' || act >= actCount
          ? 'premium'
          : 'focused';
  const rewardTier: RunRewardTier =
    input.kind === 'boss'
      ? 'major'
      : input.kind === 'elite' || phase === 'pressure' || phase === 'finale'
        ? 'enhanced'
        : 'standard';
  return {
    phase,
    intensity: intensityFor(phase, act, input.kind, input.danger),
    repeatCount,
    eventCost,
    shopTier,
    rewardTier,
    storyBeat,
  };
}

export function createRunPacingContext(
  node: Pick<RunNodeChoice, 'act' | 'floor' | 'kind' | 'danger'>,
  run?: Pick<RunState, 'actCount' | 'floorsPerAct' | 'nodeCounts'> | null,
): RunPacingContext {
  return {
    act: node.act,
    floor: node.floor,
    kind: node.kind,
    danger: node.danger,
    actCount: run?.actCount,
    floorsPerAct: run?.floorsPerAct,
    nodeCounts: run?.nodeCounts,
  };
}

/** Normalize external route context before it crosses into the portable core. */
export function normalizeRunPacingContext(value: unknown): RunPacingContext | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const kind = source.kind as RunNodeKind;
  const danger = Number(source.danger);
  const act = Number(source.act);
  const floor = Number(source.floor);
  if (!Number.isInteger(act) || act < 1 || !Number.isInteger(floor) || floor < 1) return null;
  if (!RUN_NODE_KINDS.includes(kind)) return null;
  if (![0, 1, 2, 3].includes(danger)) return null;
  const context: RunPacingContext = {
    act,
    floor,
    kind,
    danger: danger as 0 | 1 | 2 | 3,
  };
  if (Number.isInteger(source.actCount) && Number(source.actCount) >= 1 && Number(source.actCount) <= 9) {
    context.actCount = Number(source.actCount);
  }
  if (Number.isInteger(source.floorsPerAct) && Number(source.floorsPerAct) >= 4 && Number(source.floorsPerAct) <= 99) {
    context.floorsPerAct = Number(source.floorsPerAct);
  }
  if (source.nodeCounts && typeof source.nodeCounts === 'object' && !Array.isArray(source.nodeCounts)) {
    const counts: Partial<RunNodeCounts> = {};
    for (const nodeKind of RUN_NODE_KINDS) {
      const count = Number((source.nodeCounts as Record<string, unknown>)[nodeKind]);
      if (Number.isInteger(count) && count >= 0) counts[nodeKind] = count;
    }
    context.nodeCounts = counts;
  }
  return context;
}

export function formatRunPacingHint(pacing: RunNodePacing, kind: RunNodeKind): string {
  const variation = pacing.repeatCount > 0 ? '叙事身份与此前同类节点区分，机制允许复用。' : '';
  const story = `章线：${STORY_BEAT_LABELS[pacing.storyBeat]}。`;
  if (kind === 'event')
    return `节奏：${PHASE_LABELS[pacing.phase]}，${EVENT_COST_LABELS[pacing.eventCost]}。${story}${variation}`;
  if (kind === 'shop')
    return `节奏：${PHASE_LABELS[pacing.phase]}，${SHOP_TIER_LABELS[pacing.shopTier]}。${story}${variation}`;
  if (kind === 'treasure') return `节点阶段：${PHASE_LABELS[pacing.phase]}。${story}${variation}`;
  if (kind === 'rest') return `节点阶段：${PHASE_LABELS[pacing.phase]}。${story}${variation}`;
  return `节奏：${PHASE_LABELS[pacing.phase]}，压力${pacing.intensity}/4。${story}${variation}`;
}
