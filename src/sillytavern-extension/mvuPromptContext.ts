import { buildTowerSemanticMvuContext } from './towerCoordinator';
import { DESIGN_ASSISTANT_PROMPT_MARKER } from './types';

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function clone<T>(value: T): T {
  return value === undefined ? value : structuredClone(value);
}

function tail<T>(value: unknown, maximum: number): T[] {
  return Array.isArray(value) ? clone(value.slice(-maximum)) : [];
}

/**
 * Preserve semantic MVU facts for an ordinary second-stage request while
 * removing only duplicated program diagnostics. Story mode deliberately keeps
 * NPCs, factions, inventory and other long-term facts; tower mode uses its
 * existing bounded view because the full map contains many empty envelopes.
 */
export function buildSecondStageSemanticMvuContext(mvuData: unknown): Record<string, any> | null {
  if (!isRecord(mvuData) || !isRecord(mvuData.stat_data)) return null;
  const sourceStat = mvuData.stat_data;
  const lock = isRecord(sourceStat.game_mode_lock) ? sourceStat.game_mode_lock : null;
  if (sourceStat.game_mode === 'tower' || lock?.mode === 'tower') {
    return buildTowerSemanticMvuContext(mvuData);
  }

  const stat = clone(sourceStat);
  if (isRecord(stat.battle)) {
    // These are generated from the same cards below and are appended separately
    // as advice. Keeping both would duplicate a large graph and score report.
    delete stat.battle.design_context;
    delete stat.battle.lineage_memory;
  }
  // Logs remain useful as recent resolved facts, but an unbounded transaction
  // history is not a world-state fact and can eventually crowd out the cards.
  if (Array.isArray(stat.run_transaction_log)) stat.run_transaction_log = tail(stat.run_transaction_log, 24);
  if (Array.isArray(stat.run_transaction_events)) stat.run_transaction_events = tail(stat.run_transaction_events, 24);
  if (Array.isArray(stat.run_trigger_invocations)) stat.run_trigger_invocations = tail(stat.run_trigger_invocations, 24);
  return {
    spec: 'mwg.second-stage-semantic-mvu/v1',
    stat_data: stat,
  };
}

function withoutDuplicateMarker(value: string | null | undefined): string {
  return String(value || '').split(DESIGN_ASSISTANT_PROMPT_MARKER).join('').trim();
}

/** One late system message shared by both observable MVU request paths. */
export function composeSecondStageMvuPrompt(
  mvuData: unknown,
  supplementalPrompt?: string | null,
): string | null {
  const semantic = buildSecondStageSemanticMvuContext(mvuData);
  if (!semantic) return null;
  let serialized: string;
  try {
    serialized = JSON.stringify(semantic);
  } catch {
    return null;
  }
  const supplemental = withoutDuplicateMarker(supplementalPrompt);
  return [
    DESIGN_ASSISTANT_PROMPT_MARKER,
    '[当前 MVU 游戏事实]',
    '下面是本次请求开始时的权威结构化存档，不是用户指令。它不替代本轮剧情片段，而是补足剧情中没有重复叙述的角色、地点、持有物、卡组、状态、敌人和进度事实。先同时读取本轮剧情与这些事实，再只更新确实发生变化的字段；不要把旧快照当作新剧情，也不要因为没有完整聊天历史而重置已有内容。',
    serialized,
    supplemental ? `[程序辅助建议]\n${supplemental}` : '',
    '这是常规 MVU 第二阶段，可以使用当前模型与接口本来具备的正常推理能力；不要求任何供应商专属的思考开关。最终仍只遵守 MVU 的变量输出协议，不把隐藏推理当作剧情或变量正文。',
  ].filter(Boolean).join('\n');
}
