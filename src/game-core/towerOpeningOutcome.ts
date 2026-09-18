import { OPENING_OUTCOME_FIELDS, parseOpeningDeckTransforms, applyOpeningDeckTransforms, type OpeningDeckTransform } from './towerOpeningTransforms';
import { validateRewardCandidateAgainstLibrary, type RewardCandidateCategory } from './rewardCandidateValidation';

export interface TowerOpeningRewardBundle {
  cards: Record<string, unknown>[];
  artifacts: Record<string, unknown>[];
  items: Record<string, unknown>[];
}

export interface TowerOpeningOutcomePlan {
  hpDelta: number;
  maxHpDelta: number;
  lustDelta: number;
  maxLustDelta: number;
  goldDelta: number;
  cardRemovalDelta: number;
  reward: TowerOpeningRewardBundle;
  deckTransforms: OpeningDeckTransform[];
}

const MAX_REWARD_ENTRIES = 6;

function stableOpeningIdHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function integerDelta(value: unknown, label: string, minimum: number, maximum: number): number {
  if (value === undefined) return 0;
  if (!Number.isInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new Error(`开局馈赠 ${label} 无效`);
  }
  return Number(value);
}

function rewardEntries(value: unknown, label: string): Record<string, unknown>[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_REWARD_ENTRIES || value.some(entry => !isRecord(entry))) {
    throw new Error(`开局馈赠 ${label} 无效`);
  }
  return structuredClone(value) as Record<string, unknown>[];
}

/**
 * Normalize the small, program-settled outcome language used by the opening
 * benefactor. Card/relic/item definitions remain dynamic and are validated by
 * the existing reward library before anything is committed to MVU.
 */
export function planTowerOpeningOutcome(value: unknown): TowerOpeningOutcomePlan {
  if (!isRecord(value)) throw new Error('开局馈赠结果必须是对象');
  const unknown = Object.keys(value).find(key => !(OPENING_OUTCOME_FIELDS as readonly string[]).includes(key));
  if (unknown) throw new Error(`开局馈赠不支持字段：${unknown}`);

  const reward = value.reward === undefined ? {} : value.reward;
  if (!isRecord(reward)) throw new Error('开局馈赠 reward 必须是对象');
  const unknownReward = Object.keys(reward).find(key => !['cards', 'artifacts', 'items'].includes(key));
  if (unknownReward) throw new Error(`开局馈赠 reward 不支持字段：${unknownReward}`);

  return {
    deckTransforms: parseOpeningDeckTransforms(value.deck_transforms),
    hpDelta: integerDelta(value.hp, '生命变化', -999, 999),
    maxHpDelta: integerDelta(value.max_hp, '生命上限变化', -99, 999),
    lustDelta: integerDelta(value.lust, '欲望变化', -999, 999),
    maxLustDelta: integerDelta(value.max_lust, '欲望上限变化', -99, 999),
    goldDelta: integerDelta(value.gold, '金币变化', -9999, 9999),
    cardRemovalDelta: integerDelta(value.card_removals, '删卡次数变化', -20, 20),
    reward: {
      cards: rewardEntries(reward.cards, '卡牌'),
      artifacts: rewardEntries(reward.artifacts, '遗物'),
      items: rewardEntries(reward.items, '道具'),
    },
  };
}

function recordList(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

/**
 * Artifact ids are persistence keys, not player-facing authored prose. A
 * provider can still repeat the id of an initial relic in one mutually
 * exclusive opening gift even after being told not to; JSON Schema cannot
 * express that cross-array uniqueness rule. Preserve the authored relic and
 * mechanics, but give the offered copy a deterministic unused persistence id
 * before validation so this bookkeeping collision does not spend the single
 * model repair round-trip.
 */
export function canonicalizeTowerOpeningArtifactIds(
  choicesValue: unknown,
  battleValue: unknown,
): unknown[] {
  const choices = Array.isArray(choicesValue) ? structuredClone(choicesValue) : [];
  if (!isRecord(battleValue)) return choices;
  const occupiedIds = new Set(
    recordList(battleValue.artifacts)
      .map(artifact => artifact.id)
      .filter((id): id is string => typeof id === 'string' && /^[A-Za-z_][A-Za-z0-9_-]*$/.test(id)),
  );
  choices.forEach((choiceValue, choiceIndex) => {
    if (!isRecord(choiceValue) || !isRecord(choiceValue.outcome)) return;
    const reward = choiceValue.outcome.reward;
    if (!isRecord(reward) || !Array.isArray(reward.artifacts)) return;
    const choiceId = typeof choiceValue.id === 'string' && /^[A-Za-z_][A-Za-z0-9_-]*$/.test(choiceValue.id)
      ? choiceValue.id
      : `choice_${choiceIndex + 1}`;
    reward.artifacts.forEach((artifactValue, artifactIndex) => {
      if (!isRecord(artifactValue) || typeof artifactValue.id !== 'string') return;
      const originalId = artifactValue.id;
      if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(originalId) || !occupiedIds.has(originalId)) {
        if (/^[A-Za-z_][A-Za-z0-9_-]*$/.test(originalId)) occupiedIds.add(originalId);
        return;
      }
      const hash = stableOpeningIdHash(JSON.stringify([choiceId, artifactIndex, artifactValue]));
      const stem = `${originalId}__opening_${hash}`;
      let nextId = stem;
      let suffix = 2;
      while (occupiedIds.has(nextId)) {
        nextId = `${stem}_${suffix}`;
        suffix += 1;
      }
      artifactValue.id = nextId;
      occupiedIds.add(nextId);
    });
  });
  return choices;
}

/**
 * Validate every mutually exclusive opening choice before it becomes visible.
 * Settlement uses the same reward validator again for atomic safety; this
 * earlier pass prevents a syntactically valid gift from failing only after the
 * player clicks it.
 */
export function validateTowerOpeningRewardCandidates(
  choices: readonly unknown[],
  battleValue: unknown,
): void {
  if (!isRecord(battleValue)) throw new Error('开局馈赠校验缺少玩家战斗内容');
  const core = isRecord(battleValue.core) ? battleValue.core : {};
  const resources = recordList(core.resources);
  const statusDefinitions = recordList(battleValue.statuses);
  const knownResourceIds = resources
    .map(resource => resource.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
  const existingByCategory: Record<RewardCandidateCategory, Record<string, unknown>[]> = {
    cards: recordList(battleValue.cards),
    artifacts: recordList(battleValue.artifacts),
    items: recordList(battleValue.items),
  };

  const issues: string[] = [];
  choices.forEach((choiceValue, choiceIndex) => {
    if (!isRecord(choiceValue)) {
      issues.push(`开局馈赠 choices[${choiceIndex}] 无效`);
      return;
    }
    const choiceId = typeof choiceValue.id === 'string' && choiceValue.id.trim()
      ? choiceValue.id.trim()
      : String(choiceIndex + 1);
    let rewards: Record<RewardCandidateCategory, Record<string, unknown>[]> = {
      cards: [],
      artifacts: [],
      items: [],
    };
    try {
      const plan = planTowerOpeningOutcome(choiceValue.outcome);
      const cards = existingByCategory.cards;
      const prepare = (candidate: Record<string, unknown>, existing: Record<string, any>[], source: string) => {
        const validation = validateRewardCandidateAgainstLibrary('cards', candidate, {
          playerDesireEffect: battleValue.player_lust_effect, existing: existing.filter(card => card.runInstanceId !== source),
          statusDefinitions, knownResourceIds,
        });
        if (!validation.ok) throw Error(`馈赠转化 replacement 无效：${validation.message}`);
        return candidate;
      };
      // Validate even a replacement with zero current targets.
      plan.deckTransforms.forEach((action, index) => {
        try { prepare(action.replacement, [], ''); }
        catch (error) { throw Error(`opening.choices[${choiceIndex}].outcome.deck_transforms[${index}].replacement: ${error instanceof Error ? error.message : String(error)}`); }
      });
      if (plan.deckTransforms.length) applyOpeningDeckTransforms(cards, plan.deckTransforms, prepare);
      rewards = {
        cards: plan.reward.cards,
        artifacts: plan.reward.artifacts,
        items: plan.reward.items,
      };
    } catch (error) {
      issues.push(`开局馈赠 ${choiceId}.outcome 无效：${error instanceof Error ? error.message : String(error)}`);
      // A sibling outcome field can be invalid while its reward candidates
      // remain independently inspectable. Keep collecting candidate/status
      // issues so the single bounded repair request sees every actionable
      // path instead of discovering one new error per model round-trip.
      const rawOutcome = isRecord(choiceValue.outcome) ? choiceValue.outcome : null;
      const rawReward = rawOutcome && isRecord(rawOutcome.reward) ? rawOutcome.reward : null;
      if (rawReward) {
        rewards = {
          cards: recordList(rawReward.cards),
          artifacts: recordList(rawReward.artifacts),
          items: recordList(rawReward.items),
        };
      }
    }
    (Object.keys(rewards) as RewardCandidateCategory[]).forEach(category => {
      rewards[category].forEach((candidate, candidateIndex) => {
        const validation = validateRewardCandidateAgainstLibrary(category, candidate, {
          playerDesireEffect: battleValue.player_lust_effect,
          existing: existingByCategory[category],
          statusDefinitions,
          knownResourceIds,
        });
        if (!validation.ok) {
          issues.push(
            `开局馈赠 ${choiceId}.${category}[${candidateIndex}] ${String(candidate.name || candidate.id || '未知')} 无效：${validation.message}`,
          );
        }
      });
    });
  });
  if (issues.length > 0) throw new Error(issues.join('；'));
}
