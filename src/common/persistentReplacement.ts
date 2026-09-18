import { flattenMvuArray, normalizeMvuStatusDefinitions } from '../runtime/mvuArrays';
import { readRewardCandidateSupportStatuses, rewardStatusDefinitionsEqual, validateRewardCandidateAgainstLibrary } from '../game-core/rewardCandidateValidation';

export function preparePersistentReplacement(
  stat: Record<string, any>,
  cards: readonly Record<string, any>[],
  sourceRunInstanceId: string,
  replacement: Record<string, unknown>,
): Record<string, unknown> {
  const battle = stat.battle;
  const prepared = structuredClone(replacement);
  for (const key of [
    'runInstanceId',
    'runInstanceIds',
    'combatInstanceId',
    'parentCombatInstanceId',
    'parentRunInstanceId',
    'templateId',
    'origin',
    '$meta',
    'upgrade_level',
  ])
    delete prepared[key];
  const statusDefinitions = normalizeMvuStatusDefinitions(battle.statuses);
  const supportStatuses = readRewardCandidateSupportStatuses(prepared);
  if (!supportStatuses.ok) throw new Error(`卡牌变形失败：${supportStatuses.message}`);
  const validation = validateRewardCandidateAgainstLibrary('cards', prepared, {
    playerDesireEffect: battle.player_lust_effect,
    existing: cards.filter(card => card.runInstanceId !== sourceRunInstanceId),
    statusDefinitions,
    knownResourceIds: flattenMvuArray<Record<string, any>>(battle.core?.resources)
      .map(resource => String(resource?.id || ''))
      .filter(Boolean),
  });
  if (!validation.ok) throw new Error(`卡牌变形失败：${validation.message}`);
  if (supportStatuses.statuses.length > 0) {
    const statuses = Array.isArray(battle.statuses) ? battle.statuses : null;
    if (!statuses) throw new Error('卡牌变形失败：battle.statuses 不是数组');
    for (const supportStatus of supportStatuses.statuses) {
      const supportId = String(supportStatus.id);
      const existing = statusDefinitions.find(status => status.id === supportId);
      if (existing && !rewardStatusDefinitionsEqual(existing, supportStatus)) {
        throw new Error(`卡牌变形失败：状态 ${supportId} 已存在但定义不同`);
      }
      if (!existing) {
        statuses.push(structuredClone(supportStatus));
        statusDefinitions.push(structuredClone(supportStatus));
      }
    }
  }
  delete prepared.status;
  delete prepared.statuses;
  return prepared;
}

