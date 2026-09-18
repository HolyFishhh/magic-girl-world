import { markTowerShopCardsShown, readTowerCardMemory, recoverTowerCardMemory } from '../game-core/towerCardMemory';
import { formatContentContractIssues, validateContentPackContract } from '../game-core/contentContract';
import {
  enforceBattleRewardBudget,
  recommendTowerBattleRewardBudget,
  type BattleRewardBudget,
} from '../game-core/contentBudget';
import { CANONICAL_ENEMY_ACTION_MODES, normalizeEnemyActionSelectionInput } from '../game-core/enemyActionSelector';
import { consumeTowerNodeContent, abandonTowerContent } from '../game-core/towerContentState';
import {
  enterRunNode,
  validateRunState,
  type RunNodeChoice,
  type RunNodeKind,
  type RunState,
} from '../game-core/runState';
import { planTowerEventOutcome, planTowerEventResourceSettlement } from '../game-core/towerEventOutcome';
import { parseTowerEventFlow, type TowerEventFlow } from '../game-core/towerEventFlow';
import {
  validateRewardCandidateAgainstLibrary,
  type RewardCandidateCategory,
} from '../game-core/rewardCandidateValidation';
import { createContentPackFromMvuBattle } from './contentPackAdapter';
import { flattenMvuArray, normalizeMvuStatusDefinitions } from './mvuArrays';
import { normalizeMvuPlayerAuthoredContent, normalizeMvuBattleContent } from './mvuBattleContentNormalizer';
import { buildTowerAdjacency, readTowerRunState } from './towerStateAdapter';
import { applyDesireEffectGrowth } from './desireEffectGrowth';
import { readRewardCardGroups } from '../game-core/rewardCardGroups';
import { materializeTowerEventStageInStat } from './towerEventState';

export const TOWER_ACTIVE_NODE_SCHEMA_VERSION = 1 as const;
export const TOWER_STAGED_REWARD_SCHEMA_VERSION = 1 as const;

export interface TowerActiveNodeState {
  schemaVersion: typeof TOWER_ACTIVE_NODE_SCHEMA_VERSION;
  node_id: string;
  kind: RunNodeKind;
  title: string;
  narrative: string;
  narrative_source?: 'fallback' | 'preset' | 'program';
  narrative_phase?: 'pending' | 'generating' | 'ready' | 'failed';
  narrative_request_id?: string;
  narrative_error?: string;
  program_balance?: {
    playerDeckScore?: number;
    finalEnemyScore?: number;
    [key: string]: unknown;
  };
}

export interface TowerStagedRewardState {
  schemaVersion: typeof TOWER_STAGED_REWARD_SCHEMA_VERSION;
  node_id: string;
  kind: RunNodeKind;
  reward: Record<string, any>;
  desire_growth?: Record<string, any>;
}

export interface TowerNodeActivationResult {
  previous: RunState;
  run: RunState;
  node: TowerActiveNodeState;
  rewardStaged: boolean;
}

type JsonRecord = Record<string, any>;
type RewardPools = Record<RewardCandidateCategory, unknown[]>;

const BATTLE_NODE_KINDS = new Set<RunNodeKind>(['battle', 'elite', 'boss']);
const REWARD_KEYS: Readonly<Record<RewardCandidateCategory, 'card' | 'artifact' | 'item'>> = {
  cards: 'card',
  artifacts: 'artifact',
  items: 'item',
};
const REWARD_ALIASES: Readonly<Record<RewardCandidateCategory, 'cards' | 'artifacts' | 'items'>> = {
  cards: 'cards',
  artifacts: 'artifacts',
  items: 'items',
};
const TOWER_REWARD_RUNTIME_FIELDS = new Set([
  'request',
  'disabled_categories',
  'pool_revision',
  'reroll_count',
  'card_choice_groups',
]);
const NODE_TEMP_FIELDS = [
  'run_event',
  'run_event_state',
  'run_shop',
  'run_treasure',
  'run_rest',
  'run_node_reward',
] as const;
const GENERATED_BATTLE_FIELDS = new Set(['enemy', 'enemies', 'statuses', 'player_abilities', 'player_status_effects']);

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireRecord(value: unknown, message: string): JsonRecord {
  if (!isRecord(value)) throw new Error(message);
  return value;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function finalizedEnemyCount(battleValue: unknown): number {
  if (!isRecord(battleValue)) return 1;
  if (Array.isArray(battleValue.enemies) && battleValue.enemies.length > 0) {
    return battleValue.enemies.length;
  }
  return isRecord(battleValue.enemy) ? 1 : 1;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (!isRecord(value)) return JSON.stringify(value);
  return `{${Object.keys(value)
    .sort()
    .map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`)
    .join(',')}}`;
}

function shortStableHash(value: unknown): string {
  const source = stableJson(value);
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function rewardCrossCategoryFingerprint(value: unknown): string | null {
  if (!isRecord(value)) return null;
  const comparable = clone(value);
  delete comparable.id;
  delete comparable.type;
  return stableJson(comparable);
}

function uniqueTowerRewardContentId(candidate: JsonRecord, library: readonly unknown[], fallback: string): string {
  const original = String(candidate.id || fallback);
  const stem = `${original}__tower_${shortStableHash(candidate)}`;
  const ids = new Set(
    library
      .filter(isRecord)
      .map(entry => entry.id)
      .filter((id): id is string => typeof id === 'string'),
  );
  if (!ids.has(stem)) return stem;
  let suffix = 2;
  while (ids.has(`${stem}_${suffix}`)) suffix += 1;
  return `${stem}_${suffix}`;
}

function replaceRecord(target: JsonRecord, source: JsonRecord): void {
  for (const key of Object.keys(target)) delete target[key];
  Object.assign(target, source);
}

function text(value: unknown, maximum?: number): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return maximum === undefined ? normalized : normalized.slice(0, maximum);
}

function unpackContent(value: unknown): {
  payload: JsonRecord;
  title: string;
  narrative: string;
  embeddedReward: unknown;
} {
  const content = requireRecord(value, 'tower node content must be an object');
  const payload = isRecord(content.payload) ? content.payload : content;
  return {
    payload,
    title: text(content.title, 120),
    narrative: text(content.narrative),
    embeddedReward: content.reward,
  };
}

function replaceTowerNodeBattlePayload(contentValue: unknown, battleValue: JsonRecord): JsonRecord {
  const content = clone(requireRecord(contentValue, 'tower node content must be an object'));
  if (isRecord(content.payload)) {
    content.payload = {
      ...clone(content.payload),
      battle: clone(battleValue),
    };
  } else {
    content.battle = clone(battleValue);
  }
  return content;
}

function mergeDefinitions(existingValue: unknown, generatedValue: unknown): unknown[] {
  const merged = flattenMvuArray(existingValue).map(clone);
  const generated = flattenMvuArray(generatedValue).map(clone);
  for (const definition of generated) {
    const id = isRecord(definition) && typeof definition.id === 'string' ? definition.id : '';
    const index = id ? merged.findIndex(entry => isRecord(entry) && entry.id === id) : -1;
    if (index >= 0) merged[index] = definition;
    else merged.push(definition);
  }
  return merged;
}

function normalizeTowerCoreResources(value: unknown): JsonRecord {
  const core = clone(isRecord(value) ? value : {});
  for (const key of ['hp', 'max_hp', 'lust', 'max_lust', 'block', 'energy', 'max_energy'] as const) {
    const amount = Number(core[key]);
    if (Number.isFinite(amount)) core[key] = Math.max(0, Math.round(amount));
  }
  if (Number.isFinite(Number(core.max_hp)) && Number.isFinite(Number(core.hp))) {
    core.hp = Math.min(Number(core.hp), Number(core.max_hp));
  }
  if (Number.isFinite(Number(core.max_lust)) && Number.isFinite(Number(core.lust))) {
    core.lust = Math.min(Number(core.lust), Number(core.max_lust));
  }
  return core;
}

function canonicalizeEnemyActionSelection(value: unknown): JsonRecord {
  const enemy = clone(requireRecord(value, 'tower enemy must be an object'));
  const normalized = normalizeEnemyActionSelectionInput(enemy);
  if (!CANONICAL_ENEMY_ACTION_MODES.has(normalized.actionMode)) {
    throw new Error(`tower enemy action mode is unsupported: ${normalized.actionMode}`);
  }
  enemy.action_mode = normalized.actionMode;
  enemy.action_config = clone(normalized.actionConfig);
  return enemy;
}

function stableTowerEnemyId(value: unknown, index: number): string {
  const raw = typeof value === 'string' ? value.trim() : '';
  let normalized = raw
    .replace(/[^A-Za-z0-9_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!normalized) normalized = `tower_enemy_${index + 1}`;
  if (!/^[A-Za-z_]/.test(normalized)) normalized = `enemy_${normalized}`;
  return normalized;
}

function rewriteTowerEnemyReferences(value: unknown, replacements: ReadonlyMap<string, string>): unknown {
  if (typeof value === 'string') return replacements.get(value) ?? value;
  if (Array.isArray(value)) return value.map(entry => rewriteTowerEnemyReferences(entry, replacements));
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, rewriteTowerEnemyReferences(entry, replacements)]),
  );
}

/**
 * Tower providers sometimes return readable namespaced IDs such as
 * `machine:front:1`. The battle runtime deliberately accepts only stable
 * identifier characters. Normalize that transport-only spelling at the tower
 * boundary and keep every exact by-id reference aligned with the new value.
 *
 * This also assigns the otherwise optional single-enemy ID before the tower
 * mirrors it into `battle.enemies`, where roster IDs are mandatory.
 */
export function normalizeTowerBattleEnemyIdentifiers(value: unknown): JsonRecord {
  const battle = clone(requireRecord(value, 'battle data is unavailable'));
  const sourceEnemies =
    Array.isArray(battle.enemies) && battle.enemies.length > 0
      ? battle.enemies
      : isRecord(battle.enemy)
        ? [battle.enemy]
        : [];
  if (sourceEnemies.length === 0) return battle;

  const authoredIds = new Set<string>();
  const usedIds = new Set<string>();
  const replacements = new Map<string, string>();
  const enemies = sourceEnemies.map((value, index) => {
    const enemy = clone(requireRecord(value, 'tower enemy must be an object'));
    const authored = typeof enemy.id === 'string' ? enemy.id.trim() : '';
    if (authored && authoredIds.has(authored)) {
      throw new Error(`tower enemy id is duplicated: ${authored}`);
    }
    if (authored) authoredIds.add(authored);

    const stem = stableTowerEnemyId(authored, index);
    let id = stem;
    let suffix = 2;
    while (usedIds.has(id)) {
      id = `${stem}_${suffix}`;
      suffix += 1;
    }
    usedIds.add(id);
    enemy.id = id;
    if (authored && authored !== id) replacements.set(authored, id);
    return enemy;
  });

  battle.enemies = enemies;
  battle.enemy = clone(enemies[0]);
  for (const field of ['enemy', 'enemies', 'statuses', 'player_abilities', 'player_status_effects'] as const) {
    if (battle[field] !== undefined) {
      battle[field] = rewriteTowerEnemyReferences(battle[field], replacements);
    }
  }
  return battle;
}

export function prepareTowerBattleForActivation(existingValue: unknown, generatedValue: unknown): JsonRecord {
  const existing = requireRecord(existingValue, 'battle data is unavailable');
  const generated = normalizeMvuBattleContent(requireRecord(generatedValue, 'tower battle content is unavailable'));
  const unsupported = Object.keys(generated).find(key => !GENERATED_BATTLE_FIELDS.has(key));
  if (unsupported) throw new Error(`tower battle content cannot replace persistent field: ${unsupported}`);

  const battle = clone(existing);
  battle.core = normalizeTowerCoreResources(battle.core);
  // A consumable that reached zero in the previous room is no longer owned.
  // Older saves kept the depleted record until the next settlement, which
  // made an otherwise valid prepared encounter fail its entry preflight.
  if (Array.isArray(battle.items)) {
    battle.items = battle.items.filter(item => !isRecord(item) || item.count === undefined || Number(item.count) > 0);
  }
  if (generated.statuses !== undefined) battle.statuses = mergeDefinitions(existing.statuses, generated.statuses);
  if (generated.player_abilities !== undefined) battle.player_abilities = clone(generated.player_abilities);
  if (generated.player_status_effects !== undefined) {
    battle.player_status_effects = clone(generated.player_status_effects);
  }
  if (generated.enemies !== undefined) {
    if (!Array.isArray(generated.enemies) || generated.enemies.length === 0) {
      throw new Error('tower battle enemies must be a non-empty array');
    }
    battle.enemies = generated.enemies.map(canonicalizeEnemyActionSelection);
    battle.enemy = canonicalizeEnemyActionSelection(generated.enemy ?? generated.enemies[0]);
  } else if (generated.enemy !== undefined) {
    battle.enemy = canonicalizeEnemyActionSelection(generated.enemy);
    battle.enemies = [clone(battle.enemy)];
  } else {
    throw new Error('tower battle content must contain enemy or enemies');
  }

  const normalizedBattle = normalizeTowerBattleEnemyIdentifiers(battle);
  const contract = validateContentPackContract(createContentPackFromMvuBattle(normalizedBattle), {
    requireEnemy: true,
    requireExecutable: true,
  });
  if (!contract.ok) {
    // A batch receives only one bounded structure-repair request. Preserve a
    // generous set of concrete paths so an early malformed branch cannot hide
    // independent errors that would otherwise surface only after the repair.
    throw new Error(`tower battle content is invalid: ${formatContentContractIssues(contract.issues, 40)}`);
  }
  return normalizedBattle;
}

/**
 * Preflight the exact contracts used when a prepared battle node is entered.
 * The background controller calls this before committing a ready envelope so
 * a malformed node is repaired/failed while still offscreen rather than when
 * the player clicks it.
 */
export function validateTowerBattleNodeForActivation(
  existingBattle: unknown,
  generatedBattle: unknown,
  reward: unknown,
  route?: Pick<RunNodeChoice, 'id' | 'kind' | 'act' | 'floor'> & { rewardSeed?: number },
): void {
  const budgetFor = (battle: unknown) =>
    route && BATTLE_NODE_KINDS.has(route.kind)
      ? recommendTowerBattleRewardBudget({
          nodeId: route.id,
          kind: route.kind as 'battle' | 'elite' | 'boss',
          act: route.act,
          floor: route.floor,
          rewardSeed: route.rewardSeed,
          enemyCount: finalizedEnemyCount(battle),
        })
      : undefined;
  const issues: string[] = [];
  let rewardContext: unknown = existingBattle;
  let budget: BattleRewardBudget | undefined;
  try {
    rewardContext = prepareTowerBattleForActivation(existingBattle, generatedBattle);
    budget = budgetFor(rewardContext);
  } catch (error) {
    issues.push(error instanceof Error ? error.message : String(error));
    // Reward candidates may legitimately reference a status definition authored
    // by this encounter. Preserve only that library branch for the independent
    // reward probe, even when some unrelated enemy/action field is malformed.
    // This lets one bounded repair request see both encounter and reward errors
    // without falsely reporting a valid node-local status as unregistered.
    try {
      const fallback = clone(requireRecord(existingBattle, 'battle data is unavailable'));
      if (isRecord(generatedBattle) && generatedBattle.statuses !== undefined) {
        fallback.statuses = mergeDefinitions(fallback.statuses, generatedBattle.statuses);
      }
      rewardContext = fallback;
    } catch {
      rewardContext = existingBattle;
    }
    budget = budgetFor(generatedBattle);
  }
  try {
    normalizeTowerReward(reward, rewardContext, budget);
  } catch (error) {
    issues.push(error instanceof Error ? error.message : String(error));
  }
  if (issues.length > 0) {
    throw new Error(`tower battle node is invalid: ${issues.join('; ')}`);
  }
}

function rewardSourceList(source: JsonRecord, category: RewardCandidateCategory): unknown[] {
  const key = REWARD_KEYS[category];
  const alias = REWARD_ALIASES[category];
  if (source[key] !== undefined && source[alias] !== undefined) {
    throw new Error(`tower reward cannot contain both ${key} and ${alias}`);
  }
  const value = source[key] ?? source[alias] ?? [];
  if (!Array.isArray(value)) throw new Error(`tower reward ${key} must be an array`);
  return value.map(clone);
}

function reconciledRewardLimit(limits: JsonRecord, category: RewardCandidateCategory, candidateCount: number): number {
  const value = limits[category];
  if (value === undefined) return candidateCount > 0 ? 1 : 0;
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`tower reward limit ${category} is invalid`);
  }
  if (value <= candidateCount) return value;
  // Selection limits are program/UI metadata, not authored gameplay. Clamp an
  // overlarge value to the candidates that actually survived validation (or
  // became stale during lookahead) instead of spending an AI repair request.
  return candidateCount;
}

export function normalizeTowerReward(
  rewardValue: unknown,
  battleValue: unknown,
  battleBudget?: BattleRewardBudget,
): JsonRecord {
  let source = clone(requireRecord(rewardValue, 'tower node reward is unavailable'));
  const cardGroups = source.card_choice_groups;
  // These fields belong to the live reward transaction UI. Older prompts and
  // some providers may echo them from the current MVU snapshot. They carry no
  // authored reward meaning, so remove only this explicit allowlist while
  // continuing to reject every other unknown creative field.
  for (const field of TOWER_REWARD_RUNTIME_FIELDS) delete source[field];
  if (battleBudget)
    source = enforceBattleRewardBudget(source, battleBudget, { allowProgramCurrency: true }) as JsonRecord;
  if (!battleBudget && (source.gold !== undefined || source.gold_claimed !== undefined)) {
    throw new Error('tower reward gold is program-owned');
  }
  const allowed = new Set([
    'card',
    'artifact',
    'item',
    'cards',
    'artifacts',
    'items',
    'limits',
    'gold',
    'gold_claimed',
  ]);
  const unknown = Object.keys(source).find(key => !allowed.has(key));
  if (unknown) throw new Error(`tower reward contains unsupported field: ${unknown}`);
  const battle = requireRecord(battleValue, 'battle data is unavailable');
  const pools: RewardPools = {
    cards: rewardSourceList(source, 'cards').map(entry => normalizeMvuPlayerAuthoredContent(entry)),
    artifacts: rewardSourceList(source, 'artifacts').map(entry => normalizeMvuPlayerAuthoredContent(entry)),
    items: rewardSourceList(source, 'items').map(entry => normalizeMvuPlayerAuthoredContent(entry)),
  };
  // Some providers duplicate one otherwise identical relic into both the card
  // and artifact arrays while labeling the card copy `type:"Relic"`. Keep the
  // correctly categorized artifact and drop only that exact duplicate. A lone
  // or mechanically different Relic-shaped card still fails validation.
  const artifactFingerprints = new Set(
    pools.artifacts.map(rewardCrossCategoryFingerprint).filter((value): value is string => Boolean(value)),
  );
  pools.cards = pools.cards.filter(
    candidate =>
      !(
        isRecord(candidate) &&
        candidate.type === 'Relic' &&
        artifactFingerprints.has(rewardCrossCategoryFingerprint(candidate) || '')
      ),
  );
  const libraries: RewardPools = {
    cards: flattenMvuArray(battle.cards).map(clone),
    artifacts: flattenMvuArray(battle.artifacts).map(clone),
    items: flattenMvuArray(battle.items).map(clone),
  };
  const ownedArtifactIds = new Set(
    libraries.artifacts
      .filter(isRecord)
      .map(entry => entry.id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0),
  );
  const statusDefinitions = normalizeMvuStatusDefinitions(battle.statuses);
  const knownResourceIds = flattenMvuArray<JsonRecord>(battle.core?.resources, { objectsOnly: true })
    .map(resource => String(resource.id || ''))
    .filter(Boolean);
  const candidateIssues: string[] = [];

  for (const category of Object.keys(pools) as RewardCandidateCategory[]) {
    const accepted: unknown[] = [];
    for (const [candidateIndex, candidate] of pools[category].entries()) {
      let validation = validateRewardCandidateAgainstLibrary(category, candidate, {
        playerDesireEffect: battle.player_lust_effect,
        existing: libraries[category],
        statusDefinitions,
        knownResourceIds,
      });
      // A long run may acquire a card or consumable after a future node was
      // generated. If that node used the same technical ID for different
      // rules, preserve the authored reward under a deterministic new ID
      // instead of spending a model repair on identity bookkeeping. Other
      // validation failures and duplicate relic ownership remain strict.
      if (
        (category === 'cards' || category === 'items') &&
        !validation.ok &&
        isRecord(candidate) &&
        typeof candidate.id === 'string' &&
        libraries[category].some(entry => isRecord(entry) && entry.id === candidate.id) &&
        validation.message.includes('规则不同')
      ) {
        candidate.id = uniqueTowerRewardContentId(
          candidate,
          libraries[category],
          category === 'cards' ? 'tower_card' : 'tower_item',
        );
        validation = validateRewardCandidateAgainstLibrary(category, candidate, {
          playerDesireEffect: battle.player_lust_effect,
          existing: libraries[category],
          statusDefinitions,
          knownResourceIds,
        });
      }
      // Lookahead content is intentionally generated before the player
      // finishes the current node. If they obtain this exact relic in the
      // meantime, the future offer is simply obsolete. The validator reaches
      // this branch only after the candidate's own structure and references
      // have passed, so malformed relics remain hard failures. Restricting the
      // check to the pre-activation library also keeps duplicate IDs inside a
      // newly generated pool strict.
      if (
        category === 'artifacts' &&
        !validation.ok &&
        isRecord(candidate) &&
        typeof candidate.id === 'string' &&
        ownedArtifactIds.has(candidate.id) &&
        validation.message.startsWith('遗物已持有:')
      ) {
        continue;
      }
      if (!validation.ok) {
        const identity =
          isRecord(candidate) && typeof candidate.id === 'string' && candidate.id ? ` (${candidate.id})` : '';
        candidateIssues.push(
          `tower reward ${category} is invalid at ${category}[${candidateIndex}]${identity}: ${validation.message}`,
        );
        continue;
      }
      libraries[category].push(clone(candidate));
      accepted.push(candidate);
    }
    pools[category] = accepted;
  }
  if (candidateIssues.length > 0) throw new Error(candidateIssues.join('；'));
  const limits =
    source.limits === undefined ? {} : requireRecord(source.limits, 'tower reward limits must be an object');
  const unknownLimit = Object.keys(limits).find(key => !['cards', 'artifacts', 'items'].includes(key));
  if (unknownLimit) throw new Error(`tower reward limit is unsupported: ${unknownLimit}`);
  const normalized = {
    card: pools.cards,
    artifact: pools.artifacts,
    item: pools.items,
    limits: {
      cards: reconciledRewardLimit(limits, 'cards', pools.cards.length),
      artifacts: reconciledRewardLimit(limits, 'artifacts', pools.artifacts.length),
      items: reconciledRewardLimit(limits, 'items', pools.items.length),
    },
    disabled_categories: [],
    pool_revision: 0,
    reroll_count: 0,
    gold: battleBudget?.gold ?? 0,
    gold_claimed: battleBudget?.gold === undefined,
  };
  if (cardGroups != null)
    return {
      ...normalized,
      card_choice_groups: readRewardCardGroups({ ...normalized, card_choice_groups: cardGroups }, pools.cards.length),
    };
  return normalized;
}

function emptyReward(): JsonRecord {
  return {
    card: [],
    artifact: [],
    item: [],
    limits: {},
    gold: 0,
    gold_claimed: true,
    disabled_categories: [],
    pool_revision: 0,
    reroll_count: 0,
  };
}

function validateEvent(value: unknown): JsonRecord {
  const event = requireRecord(value, 'tower event content is unavailable');
  const flow = parseTowerEventFlow(event, planTowerEventOutcome);
  if (flow.version === 1 && flow.stages[0].choices.length > 6) {
    throw new Error('tower legacy event choices must contain two to six entries');
  }
  return clone(event);
}

function normalizeEventOutcome(outcomeValue: unknown, battle: unknown, core: JsonRecord): JsonRecord {
  const outcome = clone(requireRecord(outcomeValue, 'tower event outcome is unavailable'));
  const outcomePlan = planTowerEventOutcome(outcome);
  // Unknown resource IDs are an authoring error and should enter the bounded
  // repair loop. Unaffordable costs remain authored content and are checked
  // again by the transaction against the click-time state.
  planTowerEventResourceSettlement(outcomePlan.resourceDeltas, core.resources);
  // Costs use the same player resource namespace as deltas. Planning them as
  // positive changes is validation-only here; click-time settlement still
  // checks affordability before applying any authored gains.
  planTowerEventResourceSettlement(outcomePlan.cost.resources, core.resources);
  if (outcome.reward !== undefined) outcome.reward = normalizeTowerReward(outcome.reward, battle);
  if (outcome.gain_cards !== undefined) {
    outcome.gain_cards = normalizeTowerReward(
      {
        cards: outcome.gain_cards,
        artifacts: [],
        items: [],
        limits: { cards: outcome.gain_cards.length, artifacts: 0, items: 0 },
      },
      battle,
    ).card;
  }
  if (isRecord(outcome.grant)) {
    const grant = clone(outcome.grant);
    if (Array.isArray(grant.cards)) {
      grant.cards = normalizeTowerReward(
        {
          cards: grant.cards,
          artifacts: [],
          items: [],
          limits: { cards: grant.cards.length, artifacts: 0, items: 0 },
        },
        battle,
      ).card;
    }
    if (Array.isArray(grant.items)) {
      grant.items = normalizeTowerReward(
        {
          cards: [],
          artifacts: [],
          items: grant.items,
          limits: { cards: 0, artifacts: 0, items: grant.items.length },
        },
        battle,
      ).item;
    }
    outcome.grant = grant;
  }
  if (Array.isArray(outcome.deck_actions)) {
    outcome.deck_actions = outcome.deck_actions.map(action => {
      if (!isRecord(action) || !isRecord(action.replacement)) return action;
      return {
        ...action,
        replacement: normalizeTowerReward(
          {
            cards: [action.replacement],
            artifacts: [],
            items: [],
            limits: { cards: 1, artifacts: 0, items: 0 },
          },
          battle,
        ).card[0],
      };
    });
  }
  return outcome;
}

function normalizedEventFromFlow(flow: TowerEventFlow, battle: unknown, core: JsonRecord): JsonRecord {
  const normalizeChoice = (choice: TowerEventFlow['stages'][number]['choices'][number]): JsonRecord => ({
    id: choice.id,
    label: choice.label,
    ...(choice.description === undefined ? {} : { description: choice.description }),
    outcome: normalizeEventOutcome(choice.outcome, battle, core),
    ...(choice.next_stage === undefined ? {} : { next_stage: choice.next_stage }),
  });
  if (flow.version === 1) return { choices: flow.stages[0].choices.map(normalizeChoice) };
  return {
    spec: 'mwg.tower-event/v2',
    start_stage: flow.startStage,
    stages: flow.stages.map(stage => ({
      id: stage.id,
      ...(stage.narrative === undefined ? {} : { narrative: stage.narrative }),
      choices: stage.choices.map(normalizeChoice),
    })),
  };
}

function prepareEvent(value: unknown, battle: unknown): JsonRecord {
  const event = validateEvent(value);
  const battleRecord = requireRecord(battle, 'tower event player battle content is unavailable');
  const core = requireRecord(battleRecord.core, 'tower event player core is unavailable');
  return normalizedEventFromFlow(parseTowerEventFlow(event, planTowerEventOutcome), battle, core);
}
/**
 * Validate every optional event reward against the player's current content
 * library before a generated event is committed as ready. This keeps an
 * invalid lookahead payload inside the bounded model-repair loop instead of
 * discovering it only when the player clicks the node several floors later.
 */
export function validateTowerEventNodeForActivation(battleValue: unknown, eventValue: unknown): void {
  prepareEvent(eventValue, battleValue);
}

function requireNodePayload(payload: JsonRecord, kind: RunNodeKind): JsonRecord {
  if (BATTLE_NODE_KINDS.has(kind)) {
    return requireRecord(payload.battle, 'tower battle payload is unavailable');
  }
  if (kind === 'event') return validateEvent(payload.event);
  return requireRecord(payload[kind], `tower ${kind} payload is unavailable`);
}

function abandonDiscardedBranches(entered: RunState): RunState {
  const adjacency = buildTowerAdjacency(entered);
  const reachable = new Set<string>();
  const queue = [entered.currentNode!.id];
  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    if (reachable.has(nodeId)) continue;
    reachable.add(nodeId);
    queue.push(...(adjacency[nodeId] || []));
  }
  const targets = entered
    .map!.nodes.filter(
      node => node.act === entered.act && !reachable.has(node.id) && !entered.visitedNodeIds.includes(node.id),
    )
    .map(node => node.id);
  const nodeContent = abandonTowerContent(entered.nodeContent, targets);
  return nodeContent === entered.nodeContent ? entered : { ...entered, nodeContent };
}

function consumeEnteredNode(entered: RunState): RunState {
  const nodeId = entered.currentNode!.id;
  const consumed = consumeTowerNodeContent(entered.nodeContent, nodeId);
  const candidate = consumed.store === entered.nodeContent ? entered : { ...entered, nodeContent: consumed.store };
  const validation = validateRunState(candidate);
  if (!validation.ok) throw new Error(`activated tower run is invalid: ${validation.message}`);
  return validation.value;
}

/**
 * Atomically activate one ready, currently reachable map node. Generated data
 * is validated on a cloned stat root; no field is written when any check fails.
 */
export function activateTowerNodeInStat(statValue: unknown, nodeId: string): TowerNodeActivationResult {
  const stat = requireRecord(statValue, 'stat_data is unavailable');
  const previous = readTowerRunState(stat);
  const choice = previous.choices.find(entry => entry.id === nodeId);
  if (!choice) throw new Error('tower node is not currently reachable');
  const envelope = previous.nodeContent[nodeId];
  if (!envelope || envelope.phase !== 'ready' || envelope.content === undefined) {
    throw new Error('tower node content is not ready');
  }
  if (envelope.kind !== choice.kind) throw new Error('tower node content kind is mismatched');

  const unpacked = unpackContent(envelope.content);
  const payload = unpacked.payload;
  const nodePayload = requireNodePayload(payload, choice.kind);
  const draft = clone(stat);
  for (const field of NODE_TEMP_FIELDS) draft[field] = null;
  delete draft.run_event_reveal;
  draft.reward = emptyReward();

  let battle = draft.battle;
  let persistedContent = envelope.content;
  if (BATTLE_NODE_KINDS.has(choice.kind)) {
    const normalizedNodePayload = normalizeTowerBattleEnemyIdentifiers(nodePayload);
    battle = prepareTowerBattleForActivation(draft.battle, normalizedNodePayload);
    draft.battle = battle;
    // Persist the same stable IDs that the live battle uses.  Otherwise a
    // consumed lookahead envelope keeps the provider's transport-only IDs
    // (for example `machine:front:1`) and every reload has to repair them
    // again before restoring the active encounter.
    persistedContent = replaceTowerNodeBattlePayload(envelope.content, normalizedNodePayload);
  }

  let rewardValue = envelope.reward ?? unpacked.embeddedReward;
  if (choice.kind === 'shop' && isRecord(rewardValue)) {
    const memory = readTowerCardMemory(
      recoverTowerCardMemory(previous, flattenMvuArray(draft.battle?.cards, { objectsOnly: true })),
    );
    const excluded = new Set([...memory.shopShownIds, ...memory.acquiredIds]);
    rewardValue = clone(rewardValue);
    const key = Array.isArray((rewardValue as JsonRecord).cards) ? 'cards' : 'card';
    (rewardValue as JsonRecord)[key] = ((rewardValue as JsonRecord)[key] || []).filter(
      (card: JsonRecord) => !excluded.has(card.id),
    );
  }
  const rewardRequired = BATTLE_NODE_KINDS.has(choice.kind) || choice.kind === 'shop' || choice.kind === 'treasure';
  if (rewardRequired && rewardValue === undefined) throw new Error(`tower ${choice.kind} reward is not ready`);
  const battleBudget = BATTLE_NODE_KINDS.has(choice.kind)
    ? recommendTowerBattleRewardBudget({
        nodeId: choice.id,
        kind: choice.kind as 'battle' | 'elite' | 'boss',
        act: choice.act,
        floor: choice.floor,
        floorsPerAct: previous.floorsPerAct,
        rewardSeed:
          isRecord(envelope.content) && typeof envelope.content.program_reward_seed === 'number'
            ? envelope.content.program_reward_seed
            : undefined,
        enemyCount: finalizedEnemyCount(battle),
      })
    : undefined;
  const reward = rewardValue === undefined ? null : normalizeTowerReward(rewardValue, battle, battleBudget);
  if (payload.desire_growth !== undefined) {
    if (!BATTLE_NODE_KINDS.has(choice.kind)) throw new Error('欲望成长仅支持战斗胜利奖励');
    // Validation only: never grant the payoff before the battle is won.
    applyDesireEffectGrowth(battle, payload.desire_growth);
  }

  if (choice.kind === 'event') draft.run_event = prepareEvent(nodePayload, battle);
  else if (choice.kind === 'shop') draft.run_shop = clone(nodePayload);
  else if (choice.kind === 'treasure') draft.run_treasure = clone(nodePayload);
  else if (choice.kind === 'rest') draft.run_rest = clone(nodePayload);

  // Battle rewards remain hidden until victory. Shops and treasure need their
  // candidate pools immediately; optional event rewards stay staged until an
  // event outcome selects them.
  const rewardStaged = Boolean(reward && (BATTLE_NODE_KINDS.has(choice.kind) || choice.kind === 'event'));
  if (reward) {
    if (choice.kind === 'shop' || choice.kind === 'treasure') draft.reward = reward;
    else {
      draft.run_node_reward = {
        schemaVersion: TOWER_STAGED_REWARD_SCHEMA_VERSION,
        node_id: choice.id,
        kind: choice.kind,
        reward,
        ...(payload.desire_growth !== undefined ? { desire_growth: clone(payload.desire_growth) } : {}),
      } satisfies TowerStagedRewardState;
    }
  }

  const activeNode: TowerActiveNodeState = {
    schemaVersion: TOWER_ACTIVE_NODE_SCHEMA_VERSION,
    node_id: choice.id,
    kind: choice.kind,
    title: unpacked.title,
    narrative: unpacked.narrative,
    narrative_source: choice.kind === 'rest' ? 'program' : 'fallback',
    narrative_phase: choice.kind === 'rest' ? 'ready' : 'pending',
    narrative_request_id: `${envelope.requestId || choice.id}__narrative`,
  };
  const programBalance = isRecord((envelope.content as JsonRecord).program_balance)
    ? (envelope.content as JsonRecord).program_balance
    : null;
  if (
    programBalance &&
    (programBalance.spec === 'mwg.tower-enemy-balance/v2' ||
      (Number.isFinite(Number(programBalance.playerDeckScore)) &&
        Number.isFinite(Number(programBalance.finalEnemyScore))))
  ) {
    activeNode.program_balance = clone(programBalance) as TowerActiveNodeState['program_balance'];
  }
  draft.run_node = activeNode;

  const previousForEntry =
    persistedContent === envelope.content
      ? previous
      : {
          ...previous,
          nodeContent: {
            ...previous.nodeContent,
            [nodeId]: {
              ...envelope,
              content: persistedContent,
            },
          },
        };
  const entered = abandonDiscardedBranches(enterRunNode(previousForEntry, nodeId));
  let run = consumeEnteredNode(entered);
  if (choice.kind === 'shop' && reward) {
    run = recoverTowerCardMemory(run, flattenMvuArray(draft.battle?.cards, { objectsOnly: true }));
    run = markTowerShopCardsShown(run, flattenMvuArray(reward.card, { objectsOnly: true }));
  }
  draft.run = run;
  if (choice.kind === 'event') materializeTowerEventStageInStat(draft);
  replaceRecord(stat, draft);
  return { previous, run, node: activeNode, rewardStaged };
}
