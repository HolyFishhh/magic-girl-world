import { recoverTowerCardMemory, towerMemoryCandidates } from '../game-core/towerCardMemory';
import { validateRunState } from '../game-core/runState';
import { validateRewardCandidateAgainstLibrary } from '../game-core/rewardCandidateValidation';
import { flattenMvuArray, normalizeMvuStatusDefinitions } from './mvuArrays';

/** Filter old offers through today's owned cards and dependency contract. */
export function availableTowerMemoryCards(stat: Record<string, any>, nodeId: string, purpose: 'recall' | 'shop'): Record<string, any>[] {
  const parsed = validateRunState(stat.run);
  if (!parsed.ok) return [];
  const battle = stat.battle || {};
  const owned = flattenMvuArray<Record<string, any>>(battle.cards, { objectsOnly: true });
  const run = recoverTowerCardMemory(parsed.value, owned);
  const resources = flattenMvuArray<Record<string, any>>(battle.core?.resources, { objectsOnly: true }).map(x => String(x.id));
  return towerMemoryCandidates(run, nodeId, purpose).filter(card => validateRewardCandidateAgainstLibrary('cards', card, {
    existing: owned, statusDefinitions: normalizeMvuStatusDefinitions(battle.statuses),
    knownResourceIds: resources, playerDesireEffect: battle.player_lust_effect,
  }).ok);
}
