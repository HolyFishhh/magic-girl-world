import { parseTowerEventFlow, requireTowerEventStage, towerEventRandomKey, type TowerEventFlowState } from '../game-core/towerEventFlow';
import { planTowerEventOutcome } from '../game-core/towerEventOutcome';
import { executeNonCombatDeckPlan, planNonCombatDeckAction } from '../game-core/nonCombatDeckActions';
import { migratePersistentRunDeck } from '../game-core/cardProgression';
import { flattenMvuArray } from './mvuArrays';

/** Freeze targets when the player reaches a stage, using the actual current deck. */
export function materializeTowerEventStageInStat(
  stat: Record<string, any>,
  stageId?: string,
  revision = 0,
): TowerEventFlowState {
  const nodeId = stat.run?.currentNode?.id;
  if (typeof nodeId !== 'string' || stat.run.currentNode.kind !== 'event') throw new Error('事件阶段缺少当前节点');
  const flow = parseTowerEventFlow(stat.run_event, planTowerEventOutcome);
  const stage = requireTowerEventStage(flow, stageId ?? flow.startStage);
  const cards = migratePersistentRunDeck(flattenMvuArray<Record<string, any>>(stat.battle?.cards));
  const randomTargets: Record<string, string[]> = {};
  const randomSeeds: Record<string, string> = {};
  for (const choice of stage.choices) {
    const outcome = planTowerEventOutcome(choice.outcome);
    let branchCards = structuredClone(cards);
    let dependsOnChoice = false;
    const seed = JSON.stringify([stat.run.seed, nodeId, stage.id, choice.id]);
    for (const action of outcome.deckActions) {
      if (action.pick !== 'random') { dependsOnChoice = true; continue; }
      const key = towerEventRandomKey(choice.id, action.id);
      if (dependsOnChoice) {
        randomSeeds[key] = seed;
        continue;
      }
      try {
        const planned = planNonCombatDeckAction(branchCards, action, seed);
        branchCards = executeNonCombatDeckPlan(branchCards, planned, replacement => replacement);
        randomTargets[key] = planned.selectedIds;
      } catch {
        // Eligibility can change while the node is prefetched. An unavailable
        // branch remains unavailable; reopening it must not invent a target.
        randomTargets[key] = [];
      }
    }
  }
  const state: TowerEventFlowState = {
    spec: 'mwg.tower-event-state/v1', node_id: nodeId,
    stage_id: stage.id, revision, phase: 'choosing', random_targets: randomTargets,
    random_seeds: randomSeeds,
  };
  stat.battle.cards = cards;
  stat.run_event_state = state;
  return state;
}
