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
import { planTowerEventOutcome } from '../game-core/towerEventOutcome';
import {
  validateRewardCandidateAgainstLibrary,
  type RewardCandidateCategory,
} from '../game-core/rewardCandidateValidation';
import { createContentPackFromMvuBattle } from './contentPackAdapter';
import { flattenMvuArray, normalizeMvuStatusDefinitions } from './mvuArrays';
import { buildTowerAdjacency, readTowerRunState } from './towerStateAdapter';

export const TOWER_ACTIVE_NODE_SCHEMA_VERSION = 1 as const;
export const TOWER_STAGED_REWARD_SCHEMA_VERSION = 1 as const;

export interface TowerActiveNodeState {
  schemaVersion: typeof TOWER_ACTIVE_NODE_SCHEMA_VERSION;
  node_id: string;
  kind: RunNodeKind;
  title: string;
  narrative: string;
  narrative_source?: 'fallback' | 'preset';
  narrative_phase?: 'pending' | 'generating' | 'ready' | 'failed';
  narrative_request_id?: string;
  narrative_error?: string;
  program_balance?: {
    playerDeckScore: number;
    finalEnemyScore: number;
    [key: string]: unknown;
  };
}

export interface TowerStagedRewardState {
  schemaVersion: typeof TOWER_STAGED_REWARD_SCHEMA_VERSION;
  node_id: string;
  kind: RunNodeKind;
  reward: Record<string, any>;
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
]);
const NODE_TEMP_FIELDS = ['run_event', 'run_shop', 'run_treasure', 'run_rest', 'run_node_reward'] as const;
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

function uniqueTowerRewardCardId(candidate: JsonRecord, library: readonly unknown[]): string {
  const original = String(candidate.id || 'tower_card');
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
  const sourceEnemies = Array.isArray(battle.enemies) && battle.enemies.length > 0
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
  const generated = requireRecord(generatedValue, 'tower battle content is unavailable');
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
    throw new Error(`tower battle content is invalid: ${formatContentContractIssues(contract.issues)}`);
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
  route?: Pick<RunNodeChoice, 'id' | 'kind' | 'act' | 'floor'>,
): void {
  const prepared = prepareTowerBattleForActivation(existingBattle, generatedBattle);
  const budget = route && BATTLE_NODE_KINDS.has(route.kind)
    ? recommendTowerBattleRewardBudget({
      nodeId: route.id,
      kind: route.kind as 'battle' | 'elite' | 'boss',
      act: route.act,
      floor: route.floor,
    })
    : undefined;
  normalizeTowerReward(reward, prepared, budget);
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

function reconciledRewardLimit(
  limits: JsonRecord,
  category: RewardCandidateCategory,
  candidateCount: number,
  removedCount: number,
): number {
  const value = limits[category];
  if (value === undefined) return candidateCount > 0 ? 1 : 0;
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`tower reward limit ${category} is invalid`);
  }
  if (value <= candidateCount) return value;
  // A future node may have been prepared before the player obtained one of
  // its relics. Removing that stale candidate also shrinks the selectable
  // amount, but must not make an otherwise valid route impossible to enter.
  if (removedCount > 0 && value <= candidateCount + removedCount) return candidateCount;
  throw new Error(`tower reward limit ${category} is invalid`);
}

export function normalizeTowerReward(
  rewardValue: unknown,
  battleValue: unknown,
  battleBudget?: BattleRewardBudget,
): JsonRecord {
  let source = clone(requireRecord(rewardValue, 'tower node reward is unavailable'));
  // These fields belong to the live reward transaction UI. Older prompts and
  // some providers may echo them from the current MVU snapshot. They carry no
  // authored reward meaning, so remove only this explicit allowlist while
  // continuing to reject every other unknown creative field.
  for (const field of TOWER_REWARD_RUNTIME_FIELDS) delete source[field];
  if (battleBudget) source = enforceBattleRewardBudget(source, battleBudget) as JsonRecord;
  const allowed = new Set(['card', 'artifact', 'item', 'cards', 'artifacts', 'items', 'limits']);
  const unknown = Object.keys(source).find(key => !allowed.has(key));
  if (unknown) throw new Error(`tower reward contains unsupported field: ${unknown}`);
  const battle = requireRecord(battleValue, 'battle data is unavailable');
  const pools: RewardPools = {
    cards: rewardSourceList(source, 'cards'),
    artifacts: rewardSourceList(source, 'artifacts'),
    items: rewardSourceList(source, 'items'),
  };
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
  const removedCounts: Record<RewardCandidateCategory, number> = {
    cards: 0,
    artifacts: 0,
    items: 0,
  };
  const statusDefinitions = normalizeMvuStatusDefinitions(battle.statuses);
  const knownResourceIds = flattenMvuArray<JsonRecord>(battle.core?.resources, { objectsOnly: true })
    .map(resource => String(resource.id || ''))
    .filter(Boolean);

  for (const category of Object.keys(pools) as RewardCandidateCategory[]) {
    const accepted: unknown[] = [];
    for (const candidate of pools[category]) {
      let validation = validateRewardCandidateAgainstLibrary(category, candidate, {
        existing: libraries[category],
        statusDefinitions,
        knownResourceIds,
      });
      // A long run may acquire a card after a future node was generated. If
      // that node used the same ID for different rules, preserve the authored
      // card under a deterministic new ID instead of blocking the route. Other
      // validation failures and duplicate relic ownership remain strict.
      if (
        category === 'cards'
        && !validation.ok
        && isRecord(candidate)
        && typeof candidate.id === 'string'
        && libraries.cards.some(entry => isRecord(entry) && entry.id === candidate.id)
        && validation.message.includes('规则不同')
      ) {
        candidate.id = uniqueTowerRewardCardId(candidate, libraries.cards);
        validation = validateRewardCandidateAgainstLibrary(category, candidate, {
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
        category === 'artifacts'
        && !validation.ok
        && isRecord(candidate)
        && typeof candidate.id === 'string'
        && ownedArtifactIds.has(candidate.id)
        && validation.message.startsWith('遗物已持有:')
      ) {
        removedCounts.artifacts += 1;
        continue;
      }
      if (!validation.ok) throw new Error(`tower reward ${category} is invalid: ${validation.message}`);
      libraries[category].push(clone(candidate));
      accepted.push(candidate);
    }
    pools[category] = accepted;
  }
  const limits =
    source.limits === undefined ? {} : requireRecord(source.limits, 'tower reward limits must be an object');
  const unknownLimit = Object.keys(limits).find(key => !['cards', 'artifacts', 'items'].includes(key));
  if (unknownLimit) throw new Error(`tower reward limit is unsupported: ${unknownLimit}`);
  return {
    card: pools.cards,
    artifact: pools.artifacts,
    item: pools.items,
    limits: {
      cards: reconciledRewardLimit(limits, 'cards', pools.cards.length, removedCounts.cards),
      artifacts: reconciledRewardLimit(limits, 'artifacts', pools.artifacts.length, removedCounts.artifacts),
      items: reconciledRewardLimit(limits, 'items', pools.items.length, removedCounts.items),
    },
    disabled_categories: [],
    pool_revision: 0,
    reroll_count: 0,
  };
}

function emptyReward(): JsonRecord {
  return {
    card: [],
    artifact: [],
    item: [],
    limits: {},
    disabled_categories: [],
    pool_revision: 0,
    reroll_count: 0,
  };
}

function validateEvent(value: unknown): JsonRecord {
  const event = requireRecord(value, 'tower event content is unavailable');
  if (!Array.isArray(event.choices) || event.choices.length < 2 || event.choices.length > 6) {
    throw new Error('tower event choices must contain two to six entries');
  }
  const ids = new Set<string>();
  for (const choice of event.choices) {
    if (!isRecord(choice)) throw new Error('tower event choice must be an object');
    const id = text(choice.id, 64);
    const label = text(choice.label, 120);
    if (!id || !label || !isRecord(choice.outcome)) throw new Error('tower event choice is invalid');
    planTowerEventOutcome(choice.outcome);
    if (ids.has(id)) throw new Error(`tower event choice id is duplicated: ${id}`);
    ids.add(id);
  }
  return clone(event);
}

function prepareEvent(value: unknown, battle: unknown): JsonRecord {
  const event = validateEvent(value);
  event.choices = event.choices.map((choice: JsonRecord) => {
    const outcome = clone(choice.outcome);
    if (outcome.reward !== undefined) outcome.reward = normalizeTowerReward(outcome.reward, battle);
    return { ...choice, outcome };
  });
  return event;
}

/**
 * Validate every optional event reward against the player's current content
 * library before a generated event is committed as ready. This keeps an
 * invalid lookahead payload inside the bounded model-repair loop instead of
 * discovering it only when the player clicks the node several floors later.
 */
export function validateTowerEventNodeForActivation(
  battleValue: unknown,
  eventValue: unknown,
): void {
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

  const rewardValue = envelope.reward ?? unpacked.embeddedReward;
  const rewardRequired = BATTLE_NODE_KINDS.has(choice.kind) || choice.kind === 'shop' || choice.kind === 'treasure';
  if (rewardRequired && rewardValue === undefined) throw new Error(`tower ${choice.kind} reward is not ready`);
  const battleBudget = BATTLE_NODE_KINDS.has(choice.kind)
    ? recommendTowerBattleRewardBudget({
      nodeId: choice.id,
      kind: choice.kind as 'battle' | 'elite' | 'boss',
      act: choice.act,
      floor: choice.floor,
      floorsPerAct: previous.floorsPerAct,
    })
    : undefined;
  const reward = rewardValue === undefined ? null : normalizeTowerReward(rewardValue, battle, battleBudget);

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
      } satisfies TowerStagedRewardState;
    }
  }

  const activeNode: TowerActiveNodeState = {
    schemaVersion: TOWER_ACTIVE_NODE_SCHEMA_VERSION,
    node_id: choice.id,
    kind: choice.kind,
    title: unpacked.title,
    narrative: unpacked.narrative,
    narrative_source: 'fallback',
    narrative_phase: 'pending',
    narrative_request_id: `${envelope.requestId || choice.id}__narrative`,
  };
  const programBalance = isRecord((envelope.content as JsonRecord).program_balance)
    ? (envelope.content as JsonRecord).program_balance
    : null;
  if (
    programBalance
    && Number.isFinite(Number(programBalance.playerDeckScore))
    && Number.isFinite(Number(programBalance.finalEnemyScore))
  ) {
    activeNode.program_balance = clone(programBalance) as TowerActiveNodeState['program_balance'];
  }
  draft.run_node = activeNode;

  const previousForEntry = persistedContent === envelope.content
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
  const run = consumeEnteredNode(entered);
  draft.run = run;
  replaceRecord(stat, draft);
  return { previous, run, node: activeNode, rewardStaged };
}
