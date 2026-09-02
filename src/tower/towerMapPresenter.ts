import type { RunMapAct, RunMapNode, RunMapNodeKind } from '../game-core/runMap';
import type { RunState } from '../game-core/runState';
import type { TowerContentPhase } from '../game-core/towerContentState';

export type TowerRouteState = 'current' | 'reachable' | 'visited' | 'locked';
export type TowerActState = 'current' | 'cleared' | 'future';

export interface TowerNodeTypePresentation {
  icon: string;
  label: string;
  description: string;
}

export interface TowerNodePresentation {
  node: RunMapNode;
  routeState: TowerRouteState;
  contentPhase: TowerContentPhase;
  type: TowerNodeTypePresentation;
  interactive: boolean;
  error: string;
  ariaLabel: string;
}

export interface TowerActTabPresentation {
  act: number;
  label: string;
  state: TowerActState;
  difficultyPercent: number;
}

export interface TowerMapPresentation {
  snapshot: RunState;
  act: RunMapAct | null;
  selectedAct: number;
  activeAct: number;
  actTabs: TowerActTabPresentation[];
  nodes: TowerNodePresentation[];
  currentNodeId: string | null;
  chapterLabel: string;
  chapterStateLabel: string;
  floorLabel: string;
  goldLabel: string;
  difficultyLabel: string;
  mapError: string;
  failedNodes: TowerNodePresentation[];
}

export interface TowerMapPresentationOptions {
  selectedAct?: number;
  /** Player-selected base difficulty from the design assistant. */
  difficultyPercent?: number;
}

const NODE_TYPES: Readonly<Record<RunMapNodeKind, TowerNodeTypePresentation>> = {
  battle: { icon: '⚔', label: '战斗', description: '遭遇普通敌人' },
  elite: { icon: '♜', label: '精英', description: '挑战危险的精英敌人' },
  event: { icon: '❔', label: '事件', description: '进入未知事件' },
  rest: { icon: '♨', label: '篝火', description: '在篝火旁休整' },
  shop: { icon: '⚖', label: '商店', description: '拜访沿途商人' },
  treasure: { icon: '◆', label: '宝箱', description: '开启本幕宝箱' },
  boss: { icon: '♛', label: '首领', description: '挑战本幕首领' },
};

const CONTENT_PHASE_LABELS: Readonly<Record<TowerContentPhase, string>> = {
  idle: '内容尚未生成',
  queued: '已加入后台生成队列',
  generating: '后台生成中',
  ready: '内容已准备完成',
  failed: '内容生成失败',
  consumed: '内容已使用',
  abandoned: '已离开这条路线',
};

const ROUTE_STATE_LABELS: Readonly<Record<TowerRouteState, string>> = {
  current: '当前位置',
  reachable: '下一步可达',
  visited: '已经走过',
  locked: '当前不可达',
};

function clampDifficulty(value: number | undefined): number | null {
  if (!Number.isFinite(value)) return null;
  return Math.max(10, Math.min(110, Math.round(Number(value))));
}

function latestVisitedNodeId(snapshot: RunState): string | null {
  const nodes = new Map(snapshot.map?.nodes.map(node => [node.id, node]) ?? []);
  for (let index = snapshot.visitedNodeIds.length - 1; index >= 0; index -= 1) {
    const id = snapshot.visitedNodeIds[index];
    const node = nodes.get(id);
    if (node?.act === snapshot.act) return id;
  }
  return null;
}

function determineCurrentNodeId(snapshot: RunState): string | null {
  return snapshot.currentNode?.id ?? latestVisitedNodeId(snapshot);
}

function actState(snapshot: RunState, act: number): TowerActState {
  if (act === snapshot.act) return 'current';
  if (act < snapshot.act || snapshot.phase === 'won') return 'cleared';
  return 'future';
}

function chapterStateLabel(snapshot: RunState, selectedAct: number): string {
  const state = actState(snapshot, selectedAct);
  if (state === 'cleared') return '已通过';
  if (state === 'future') return '尚未抵达';
  if (snapshot.phase === 'won') return '远征完成';
  if (snapshot.phase === 'lost') return '远征结束';
  if (snapshot.phase === 'in_node') return '正在探索';
  return '选择前路';
}

function routeStateFor(
  node: RunMapNode,
  snapshot: RunState,
  currentNodeId: string | null,
  reachableIds: ReadonlySet<string>,
  visitedIds: ReadonlySet<string>,
): TowerRouteState {
  if (node.act === snapshot.act && node.id === currentNodeId) return 'current';
  if (node.act === snapshot.act && reachableIds.has(node.id)) return 'reachable';
  if (visitedIds.has(node.id)) return 'visited';
  return 'locked';
}

function buildNodePresentation(
  node: RunMapNode,
  snapshot: RunState,
  currentNodeId: string | null,
  reachableIds: ReadonlySet<string>,
  visitedIds: ReadonlySet<string>,
): TowerNodePresentation {
  const routeState = routeStateFor(node, snapshot, currentNodeId, reachableIds, visitedIds);
  const envelope = snapshot.nodeContent[node.id];
  const contentPhase = envelope?.phase ?? 'idle';
  const type = NODE_TYPES[node.kind];
  const error = contentPhase === 'failed' ? String(envelope?.error || '后台生成失败，请重试。').slice(0, 500) : '';
  const interactive = routeState === 'reachable' && snapshot.phase === 'awaiting_choice' && contentPhase === 'ready';
  const stateCopy = `${ROUTE_STATE_LABELS[routeState]}，${CONTENT_PHASE_LABELS[contentPhase]}`;
  return {
    node,
    routeState,
    contentPhase,
    type,
    interactive,
    error,
    ariaLabel: `第${node.floor}层，${type.label}，${type.description}，${stateCopy}`,
  };
}

export function getTowerNodeTypePresentation(kind: RunMapNodeKind): TowerNodeTypePresentation {
  return NODE_TYPES[kind];
}

export function createTowerMapPresentation(
  snapshot: RunState,
  options: TowerMapPresentationOptions = {},
): TowerMapPresentation {
  const map = snapshot.map;
  const availableActs = map?.acts.map(act => act.act) ?? [];
  const requestedAct = Number.isInteger(options.selectedAct) ? Number(options.selectedAct) : snapshot.act;
  const selectedAct = availableActs.includes(requestedAct)
    ? requestedAct
    : availableActs.includes(snapshot.act)
      ? snapshot.act
      : 1;
  const act = map?.acts.find(candidate => candidate.act === selectedAct) ?? null;
  const currentNodeId = determineCurrentNodeId(snapshot);
  const reachableIds = new Set(snapshot.choices.map(choice => choice.id));
  const visitedIds = new Set(snapshot.visitedNodeIds);
  const nodes = (act?.nodes ?? []).map(node =>
    buildNodePresentation(node, snapshot, currentNodeId, reachableIds, visitedIds),
  );
  const difficulty = clampDifficulty(options.difficultyPercent);
  const actDifficultyPercent = Math.round((act?.difficultyMultiplier ?? 1) * 100);
  const effectiveDifficulty =
    difficulty === null ? actDifficultyPercent : Math.round((difficulty * actDifficultyPercent) / 100);
  const mapError =
    snapshot.schemaVersion !== 3
      ? '该存档不是爬塔模式所需的 v3 远征数据。'
      : snapshot.routeMode !== 'map' || !map
        ? '当前存档尚未生成完整的三幕爬塔地图。'
        : !act
          ? '所选章节的地图数据不存在。'
          : '';

  return {
    snapshot,
    act,
    selectedAct,
    activeAct: snapshot.act,
    actTabs: (map?.acts ?? []).map(candidate => ({
      act: candidate.act,
      label: `第 ${candidate.act} 幕`,
      state: actState(snapshot, candidate.act),
      difficultyPercent: Math.round(candidate.difficultyMultiplier * 100),
    })),
    nodes,
    currentNodeId,
    chapterLabel: `第 ${selectedAct} 幕`,
    chapterStateLabel: chapterStateLabel(snapshot, selectedAct),
    floorLabel:
      selectedAct === snapshot.act ? `${snapshot.floor}/${snapshot.floorsPerAct}` : `—/${snapshot.floorsPerAct}`,
    goldLabel: String(snapshot.gold),
    difficultyLabel:
      difficulty === null ? `${actDifficultyPercent}%` : `${effectiveDifficulty}%（基础 ${difficulty}%）`,
    mapError,
    failedNodes: nodes.filter(node => node.contentPhase === 'failed'),
  };
}
