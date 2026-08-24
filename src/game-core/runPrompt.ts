import { formatRunNodeDirection } from './contentDirection';
import type { RunNodeChoice, RunState } from './runState';

const UPGRADE_CARD_KEYS = [
  'id',
  'name',
  'cost',
  'effects',
  'discard_effects',
  'trigger',
  'creates',
  'retain',
  'exhaust',
  'ethereal',
  'innate',
  'upgrade_level',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Shared event-choice protocol text for every host that sends a route action. */
export function formatEventSelectionContext(node: Pick<RunNodeChoice, 'id' | 'kind'> | null | undefined): string {
  if (!node || node.kind !== 'event') return '';
  return `\n[事件选择] node_id=${node.id}\n非战斗结局写 run_result；node_id 保持不变，outcome 只用 cleared/failed/escaped，gold/hp 用实际 JSON 整数变化量且无变化时省略。`;
}

export interface RoutePromptInput {
  node: RunNodeChoice;
  runSeed: number;
  run?: Pick<RunState, 'actCount' | 'floorsPerAct' | 'nodeCounts'> | null;
  worldContinuity?: string | null;
  buildBudget?: string | null;
  enemyBudget?: string | null;
  pending?: string | null;
  shopBudget?: string | null;
  buildGuidance?: string | null;
}

/** Compose one route request without letting a host duplicate marker ordering. */
export function formatRoutePrompt(input: RoutePromptInput): string {
  const { node } = input;
  const lines = [
    `[路线节点] act=${node.act} floor=${node.floor} kind=${node.kind} danger=${node.danger} node_id=${node.id}`,
    formatRunNodeDirection(node, input.runSeed, input.run),
  ];
  if (input.worldContinuity) lines.push(input.worldContinuity);
  if (node.kind === 'battle' || node.kind === 'elite' || node.kind === 'boss') {
    if (input.buildBudget) lines.push(input.buildBudget);
    if (input.enemyBudget) lines.push(input.enemyBudget);
  }
  if (input.pending) lines.push(input.pending);
  if (node.kind === 'shop') {
    lines.push('[商店生成]');
    if (input.shopBudget) lines.push(input.shopBudget);
    if (input.buildGuidance) lines.push(input.buildGuidance);
  }
  if (node.kind === 'battle' || node.kind === 'elite' || node.kind === 'boss') lines.push('[开始战斗]');
  return lines.join('\n');
}

export interface OptionPromptInput {
  optionText: string;
  battle: boolean;
  node?: Pick<RunNodeChoice, 'id' | 'kind'> | null;
  pending?: string | null;
  buildBudget?: string | null;
}

/** Compose normal and battle option messages while sharing event context and pending summaries. */
export function formatOptionPrompt(input: OptionPromptInput): string {
  const eventContext = formatEventSelectionContext(input.node);
  const pending = input.pending ? `\n\n${input.pending}` : '';
  const budget = input.battle && input.buildBudget ? `\n${input.buildBudget}` : '';
  const prefix = input.battle ? '用户选择了战斗选项：' : '用户的选择是：';
  const suffix = input.battle ? '\n\n[开始战斗]' : '';
  return `${prefix}${input.optionText}${eventContext}${pending}${budget}${suffix}`;
}

/** Keep AI-authored campfire patches small without exposing host-only card fields. */
export function compactCardForUpgrade(cardValue: unknown): Record<string, unknown> {
  if (!isRecord(cardValue)) throw new Error('upgrade card must be an object');
  const card: Record<string, unknown> = {};
  for (const key of UPGRADE_CARD_KEYS) {
    if (cardValue[key] !== undefined) card[key] = cardValue[key];
  }
  if (typeof card.id !== 'string' || !card.id.trim()) throw new Error('upgrade card must include a stable id');
  return card;
}

export interface RestUpgradePromptInput {
  node: Pick<RunNodeChoice, 'id' | 'kind'>;
  card: unknown;
}

/** Compose the one compact campfire upgrade request shared by every host. */
export function formatRestUpgradePrompt(input: RestUpgradePromptInput): string {
  if (input.node.kind !== 'rest') throw new Error('campfire upgrade requires an active rest node');
  const card = compactCardForUpgrade(input.card);
  return [
    `[营火升级] node_id=${input.node.id}`,
    `只为这张卡生成短升级补丁：${JSON.stringify(card)}`,
    `输出一条 _.set('run_upgrade', null, 补丁对象) 命令；补丁必须是完整合法 JSON，包含 node_id="${input.node.id}"、card_id 和实际变化字段，不写 description。`,
  ].join('\n');
}
