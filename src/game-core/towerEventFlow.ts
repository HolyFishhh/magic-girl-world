/** Authored event stages are immutable. The cursor belongs to the run save. */
export interface TowerEventFlowChoice {
  id: string;
  label: string;
  description?: string;
  outcome: Record<string, unknown>;
  next_stage?: string;
}

export interface TowerEventFlowStage {
  id: string;
  narrative?: string;
  choices: TowerEventFlowChoice[];
}

export interface TowerEventFlow {
  version: 1 | 2;
  startStage: string;
  stages: TowerEventFlowStage[];
}

export interface TowerEventFlowState {
  spec: 'mwg.tower-event-state/v1';
  node_id: string;
  stage_id: string;
  revision: number;
  phase: 'choosing' | 'reward';
  next_stage?: string;
  /** Keyed by JSON.stringify([choice id, action id]); values are run instances. */
  random_targets: Record<string, string[]>;
  /** After a manual action, targets depend on that answer; freeze the ordering seed instead. */
  random_seeds?: Record<string, string>;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`);
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label}不能为空`);
  return value;
}

function knownKeys(value: Record<string, unknown>, keys: string[], label: string): void {
  const unknown = Object.keys(value).find(key => !keys.includes(key));
  if (unknown) throw new Error(`${label}不支持字段：${unknown}`);
}

/**
 * Legacy choices keep their original terminal semantics. New stages use a
 * finite graph: every price, replacement and subsequent offer already exists
 * in the authored document, and following an edge never requires generation.
 * Outcome validation is supplied by the shared settlement contract caller.
 */
export function parseTowerEventFlow(
  value: unknown,
  validateOutcome: (outcome: Record<string, unknown>) => unknown,
): TowerEventFlow {
  const event = record(value, '事件');
  const staged = event.spec === 'mwg.tower-event/v2';
  if (event.spec !== undefined && !staged) throw new Error('事件协议版本不支持');
  if (!staged && event.stages !== undefined) throw new Error('分阶段事件必须声明 mwg.tower-event/v2');
  if (staged) knownKeys(event, ['spec', 'start_stage', 'stages'], '分阶段事件');
  const rawStages = staged ? event.stages : [{ id: 'legacy', choices: event.choices }];
  if (!Array.isArray(rawStages) || !rawStages.length) throw new Error('事件必须包含至少一个阶段');
  const stageIds = new Set<string>();
  const stages = rawStages.map(raw => {
    const stage = record(raw, '事件阶段');
    knownKeys(stage, ['id', 'narrative', 'choices'], '事件阶段');
    const id = text(stage.id, '阶段 ID');
    if (stageIds.has(id)) throw new Error(`重复的事件阶段：${id}`);
    stageIds.add(id);
    if (stage.narrative !== undefined && typeof stage.narrative !== 'string') throw new Error('阶段剧情必须是文本');
    if (!Array.isArray(stage.choices) || stage.choices.length < (staged ? 1 : 2)) throw new Error('事件阶段缺少可选行动');
    const choiceIds = new Set<string>();
    const choices = stage.choices.map(rawChoice => {
      const choice = record(rawChoice, '事件选项');
      knownKeys(choice, ['id', 'label', 'description', 'outcome', ...(staged ? ['next_stage'] : [])], '事件选项');
      const choiceId = text(choice.id, '选项 ID');
      if (choiceIds.has(choiceId)) throw new Error(`阶段 ${id} 的选项 ID 重复：${choiceId}`);
      choiceIds.add(choiceId);
      const label = text(choice.label, '选项说明');
      if (choice.description !== undefined && typeof choice.description !== 'string') throw new Error('选项描述必须是文本');
      const outcome = record(choice.outcome, '事件结果');
      validateOutcome(outcome);
      return {
        id: choiceId,
        label,
        ...(choice.description === undefined ? {} : { description: choice.description as string }),
        outcome: structuredClone(outcome),
        ...(choice.next_stage === undefined ? {} : { next_stage: text(choice.next_stage, '后续阶段') }),
      };
    });
    return { id, ...(stage.narrative === undefined ? {} : { narrative: stage.narrative as string }), choices };
  });
  const startStage = staged ? text(event.start_stage, '起始阶段') : 'legacy';
  if (!stageIds.has(startStage)) throw new Error('事件起始阶段不存在');
  const byId = new Map(stages.map(stage => [stage.id, stage]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) throw new Error('事件阶段不能形成循环；请预先展开递进档位');
    if (visited.has(id)) return;
    visiting.add(id);
    for (const choice of byId.get(id)!.choices) {
      if (choice.next_stage === undefined) continue;
      if (!byId.has(choice.next_stage)) throw new Error(`事件后续阶段不存在：${choice.next_stage}`);
      visit(choice.next_stage);
    }
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of stageIds) visit(id);
  return { version: staged ? 2 : 1, startStage, stages };
}

export function towerEventRandomKey(choiceId: string, actionId: string): string {
  return JSON.stringify([choiceId, actionId]);
}

export function requireTowerEventStage(flow: TowerEventFlow, stageId: string): TowerEventFlowStage {
  const stage = flow.stages.find(stage => stage.id === stageId);
  if (!stage) throw new Error(`当前事件阶段不存在：${stageId}`);
  return stage;
}
