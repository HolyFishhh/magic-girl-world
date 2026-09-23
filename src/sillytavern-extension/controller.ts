import { commitMvuUpdate, withMvuWriteLock } from '../runtime/mvuWriteCoordinator';
import { redactDiagnosticText } from '../runtime/diagnosticRedaction';
import { normalizeStatusDefenseRule } from '../game-core/statusDefense';
import { towerBattleStories, towerBattleNarrativePrompt } from './towerBattleNarrative';
import { OPENING_TRANSFORM_GUIDANCE } from '../game-core/towerOpeningTransforms';
import { normalizeDamageProtectionRule } from '../game-core/damageProtection';
import { RUN_NODE_KINDS, isBattleRunNode, validateRunState, type RunNodeKind, type RunState } from '../game-core/runState';
import { selectInitialSlotRepairGuidance } from './initialSlotRepairGuidance';
import { parseStructuredRecord } from './structuredRecord';
import { parseStructuredRecordWithRecovery, structuredRecordRecoveryPrompt } from './structuredRecordRecovery';
import { planInitialEnvelopeRepair, applyInitialEnvelopeRepair } from '../game-core/initialEnvelopeRepair';
import { GenerationTransportError } from './generationTransportError';
import { decodeInitialDraftContainers, normalizeInitialDraftAbsentCurseCost, normalizeInitialDraftEmptyLustCondition } from './initialDraftDecoding';
import { INITIAL_GENERATION_EVIDENCE_METADATA_KEY, InitialGenerationEvidence, type InitialEvidenceStage } from './initialGenerationEvidence';
import { TOWER_GENERATION_EVIDENCE_METADATA_KEY, TowerGenerationEvidence } from './towerGenerationEvidence';
import { createTavernEvidenceFilePorts, EvidenceFileStore } from './evidenceFileStore';
import { auditInitialSemanticStructure } from '../game-core/initialSemanticAudit';
import { buildInitialPlayerBattle } from './initialPlayerBattle';
import { expandInitialOpeningCardReferences } from '../game-core/initialCardReference';
import {
  assessInitialPlayerContent,
  formatPlayerContentReadiness,
} from '../game-core/playerContentReadiness';
import { createContentPackFromMvuBattle } from '../runtime/contentPackAdapter';
import { buildTowerFoundationGuidance } from '../game-core/towerFoundationGuidance';
import {
  normalizeMvuPlayerAuthoredContent,
  normalizeMvuVariablesBattleInPlace,
} from '../runtime/mvuBattleContentNormalizer';
import { aiSchemaRef, withAiContentDefinitions } from '../game-core/aiContentJsonSchema';
import { compileInitialDraftToMvu, inspectInitialDraftFragments, INITIAL_DRAFT_SPEC, type CompiledInitialDraft, type InitialDraftFragments } from '../game-core/initialDraft';
import { applyInitialDraftPreviewEdits, initialDraftSourcePath } from '../game-core/initialDraftSourcePath';
import { collectRewardCandidateTypedContractIssues } from '../game-core/rewardCandidateValidation';
import { createInitialDraftJsonSchema } from '../game-core/initialDraftSchema';
import {
  planInitialDraftRegistryRepair, applyInitialDraftRegistryRepair, createInitialDraftRegistryRepairJsonSchema,
} from '../game-core/initialDraftRepair';
import { initialDraftNarrativePrompt, initialDraftAuthoringPrompt, initialDraftRegistryRepairPrompt, initialDraftTemplateRepairPrompt } from './initialDraftPrompt';
import { parseTowerPlannedNarrative, towerDungeonPlanningPrompt, type TowerDungeonPlan } from '../game-core/towerDungeonPlan';
import { runMapContentKind } from '../game-core/runMap';
import { planInitialTemplateRepair, createInitialTemplateRepairSchema, applyInitialTemplateRepair } from '../game-core/initialTemplateRepair';
import { deriveRunSeed, ensureRunStateInStat } from '../runtime/runStateAdapter';
import { compactCardForUpgrade } from '../game-core/runPrompt';
import { ABILITY_TRIGGERS, STATUS_TRIGGERS } from '../game-core/battleTriggers';
import { compileCompactEffectList } from '../game-core/compactEffectDsl';
import { collectInitialTriggerTimingIssues } from '../game-core/authoredTriggerTiming';
import { TowerGenerationDiagnostics } from './towerGenerationDiagnostics';
import { assertAuthoredLiteralEffectRepair, assertAuthoredLiteralRepairPreservation, collectAuthoredLiteralEffectIssues, diagnoseAuthoredLiteralEffects, inspectFirstCardEventMismatch } from '../game-core/authoredLiteralEffects';
import { COMPACT_CARD_SELECTOR_FILTER_KEYS, COMPACT_CARD_SELECTOR_INPUT_KEYS, COMPACT_EFFECT_BUNDLE_OPERATION_SET, COMPACT_EFFECT_META_KEY_SET } from '../game-core/compactEffectContract';
import { validateEffectProgramPolicy } from '../game-core/effectProgramPolicy';
import { collectCompactStatusDefinitionIssues } from '../game-core/statusDefinitionValidation';
import { validateCombatResourceDefinitions } from '../game-core/combatResource';
import { migratePersistentRunDeck } from '../game-core/cardProgression';
import { commitTowerOpening, failTowerOpening } from '../game-core/towerOpeningState';
import {
  canonicalizeTowerOpeningArtifactIds,
  validateTowerOpeningRewardCandidates,
} from '../game-core/towerOpeningOutcome';
import { executeUnifiedRunTransactionInStat } from '../common/runTransactions';
import { normalizeMvuList } from '../common/rewardTransactions';
import { createInitialArtifactAcquisitionReceipt, INITIAL_ARTIFACT_ACQUISITION_KEY } from '../common/initialArtifactAcquisition';
import {
  TOWER_OPENING_RESULT_SPEC,
  TOWER_INITIAL_ROOT_REPAIR_SPEC,
  TOWER_INITIAL_SLOT_REPAIR_SPEC,
  createTowerInitialContentJsonSchema,
  createTowerInitialRootRepairJsonSchema,
  createTowerInitialSlotRepairJsonSchema,
  createTowerNodeBatchJsonSchema,
  createTowerNodeJsonSchema,
  createTowerOpeningJsonSchema,
  formatCompactEffectAuthoringContract,
  formatCompactEffectRepairContract,
  formatTowerNodeBatchStructureRepairPrompt,
  formatTowerNodeStructureRepairPrompt,
  formatTowerOpeningStructureRepairPrompt,
  inspectTowerNodeBatchResult,
  parseTowerNodeResult,
  parseTowerOpeningResult,
  collectTowerOpeningEnvelopeIssues,
  type TowerGenerationJobDescriptor,
  type TowerInitialRepairRootKind,
  type TowerInitialRepairSchemaTarget,
  type TowerInitialRepairSlotAction,
  type TowerInitialRepairSlotKind,
  type TowerInitialRepairSlotRootSchemaTarget,
  type TowerInitialRepairSlotSchemaTarget,
  type TowerNodeBatchInspection,
  type TowerNodeResult,
} from '../game-core/towerRequest';
import {
  commitTowerGenerationInStat,
  failTowerGenerationInStat,
} from '../runtime/towerStateAdapter';
import {
  normalizeTowerReward,
  validateTowerBattleNodeForActivation,
  validateTowerEventNodeForActivation,
} from '../runtime/towerContentActivation';
import { DesignAssistantEngine, enemyGenerationFingerprintFromVariables, normalizeDesignAssistantChatState, normalizeDesignAssistantSettings } from './designEngine';
import { isMagicGirlWorldCharacter } from './characterScope';
import { hasDesignContext, injectDesignContext } from './promptInjection';
import { createMvuInitializationScanPrompt, needsMvuInitializationRules, MVU_INITIALIZATION_SCAN_ID } from './mvuInitializationRouting';
import { applyMvuRequestPolicy } from './mvuRequestPolicy';
import { applyRepairSchemaFactoring, applySchemaPromptTransport } from './schemaPromptTransport';
import {
  TOWER_INITIAL_COMMIT_KEY, TOWER_INITIAL_PUBLICATION_KEY, initialPublicationFor, hasInitialPublication,
  canRestoreInitialPresentation, hasEstablishedTowerOpening,
  readTowerInitialCommitReceipt, towerInitialStateKey, towerInitialStateDigest, type TowerInitialCommitReceipt,
} from './towerInitialCommit';
import { looksLikeMvuExtraAnalysisRequest, summarizeMvuRequest } from './mvuRequestDetection';
import { composeSecondStageMvuPrompt } from './mvuPromptContext';
import { PersistentMvuRepairHost } from './persistentMvuRepairHost';
import {
  createOfficialReasoningRecoveryRuntime,
  ReasoningFinalRecoveryHost,
} from './reasoningFinalRecovery';
import type { PersistentMvuRepairRequest } from '../runtime/mvuExtraModelRepair';
import {
  TowerLookaheadCoordinator,
  buildTowerGenerationContext,
  type TowerCoordinatorGenerationRequest,
  type TowerCoordinatorScope,
} from './towerCoordinator';
import {
  TowerGenerationHost,
  TOWER_NARRATIVE_REQUEST_MARKER,
  createGlobalTowerGenerationPorts,
  type TowerGenerationCompletedPayload,
  type TowerGenerationPorts,
  type TowerGenerationRequest,
  type TowerGenerationResult,
} from './towerGenerationHost';
import {
  TowerGenerationCancelledError,
  TowerGenerationQueue,
  towerGenerationTaskKey,
  type TowerGenerationQueueStatus,
  type TowerGenerationTaskKey,
} from './towerGenerationQueue';
import { formatTowerNodeGenerationPrompt, formatTowerNodeBatchGenerationPrompt } from '../game-core/towerRequest';
import { EncounterWorkerClient } from './encounterWorkerClient';
import { createTowerEncounterBaseline, towerBudgetFromMeasurement, validTowerEncounterBaseline, hasReliableTowerMeasurement, type TowerBuildMeasurement } from '../game-core/towerEncounterBudget';
import { compactTowerBalanceAudit } from '../runtime/towerBalanceAudit';
import { assertTowerBalanceFeedbackPreservation } from '../runtime/towerBalanceFeedback';
import {
  readPersistedMessageVariableSnapshot,
  assessPersistedTowerMvuRestore,
  readLatestPersistedMessageVariableSnapshot,
  touchCurrentTowerChatActivity,
} from './towerChatActivity';
import { createEventBridgedTavernHelper } from './tavernHelperBridge';
import { subscribeTavernHelperRequestEvent } from './tavernHelperEventSubscription';
import { DesignWorkerClient } from './workerClient';
import {
  DEFAULT_DESIGN_ASSISTANT_SETTINGS,
  DESIGN_ASSISTANT_EXTENSION_ID,
  DESIGN_ASSISTANT_METADATA_KEY,
  TOWER_ARCHIVE_METADATA_KEY,
  type DesignAssistantChatState,
  type DesignAssistantDashboard,
  type DesignAssistantHost,
  type DesignAssistantSettings,
  type DesignAssistantStatus,
  type MvuDesignSnapshot,
  type SillyTavernContext,
} from './types';

const EVENT_GENERATE_AFTER_DATA = 'generate_after_data';
const EVENT_CHAT_COMPLETION_SETTINGS_READY = 'chat_completion_settings_ready';
const EVENT_CHAT_CHANGED = 'chat_id_changed';
const EVENT_CHAT_LOADED = 'chatLoaded';
const EVENT_GENERATION_ENDED = 'generation_ended';
const EVENT_MESSAGE_RECEIVED = 'message_received';
const EVENT_MVU_INITIALIZED = 'global_Mvu_initialized';
const EVENT_CHARACTER_RUNTIME_INITIALIZED = 'global_MagicGirlWorld_initialized';
const EVENT_MVU_UPDATE_STARTED = 'mag_variable_update_started';
const EVENT_MVU_UPDATE_ENDED = 'mag_variable_update_ended';
const MVU_LIFECYCLE_PROMPT_ID = 'mwg-design-context';
const TAVERN_HELPER_REPAIR_WAIT_MS = 10_000;
const TAVERN_HELPER_REPAIR_POLL_MS = 100;
const TAVERN_HELPER_EVENT_WAIT_MS = 10_000;
const TAVERN_HELPER_EVENT_POLL_MS = 100;
const LOGICAL_MVU_INJECTION_WINDOW_MS = 2_500;
// Switching the embedded common/fish view briefly tears down MVU's selected
// message alias.  Restoring the persisted chat snapshot on the first empty
// read can therefore overwrite a node that was entered milliseconds earlier.
// A real chat reload tolerates this short delay; an in-place view switch gets
// time to expose its newer authoritative revision and wins normally.
const TOWER_MVU_EMPTY_RESTORE_GRACE_MS = 1_500;
const TAVERN_HELPER_REPAIR_FUNCTIONS = [
  'getLastMessageId',
  'getChatMessages',
  'setChatMessages',
  'getVariables',
  'replaceVariables',
  'getAllEnabledScriptButtons',
  'getScriptTrees',
] as const;

interface ChatScopeToken {
  chatId: string | null | undefined;
  metadata: Record<string, any> | null;
  messageId: number | 'latest';
}

interface ActiveMvuLifecyclePrompt {
  chatId: string;
  messageId: number | 'latest';
  uninject(): void;
}

export type TowerGenerationBridgeRequest = Omit<TowerGenerationRequest, 'chatId' | 'nodeId'> & {
  /** Ignored at the trust boundary; the active SillyTavern chat always wins. */
  chatId?: string;
  generationType?: 'node' | 'opening' | 'batch';
  nodeId?: string;
  batchId?: string;
  jobs?: Array<{
    nodeId: string;
    requestId: string;
    revision: number;
    kind: RunNodeKind;
    act: number;
    floor: number;
    contentSeed: number;
    rewardSeed: number;
    shopMemoryCards?: Record<string, any>[];
    difficultyMultiplier: number;
  }>;
  basedOnRevision?: number;
  /** Compatibility alias used by towerStateAdapter request descriptors. */
  revision?: number;
  kind?: RunNodeKind;
  /** Binds extension-owned lookahead work to the message that created it. */
  sourceMessageId?: number | 'latest';
};

export interface TowerSingleFloorStartRequest {
  spec: 'mwg.tower-single-floor-start/v1';
  sourceMessageId?: number | 'latest';
  prompt: string;
  config?: {
    mode?: string;
    name?: string;
    customDescription?: string;
    world?: string;
    profession?: string;
    opening?: string;
    card?: string;
    towerRequirements?: string;
  };
}

interface NormalizedTowerBridgeRequest {
  generationType: 'node' | 'opening' | 'batch';
  request: TowerGenerationRequest;
  basedOnRevision: number;
  batchId?: string;
  jobs?: TowerGenerationJobDescriptor[];
  kind?: RunNodeKind;
  act?: number;
  floor?: number;
  messageId: number | 'latest';
}

interface TowerGenerationBridgeFailure {
  spec: 'mwg.tower-generation-failure/v1';
  chatId: string;
  nodeId: string;
  requestId: string;
  runScope?: string;
  error: string;
  failedAt: number;
  mvuData?: unknown;
}

interface TowerGenerationMonitorBridge {
  resetForChat?(chatId: string | null): void;
  receiveTowerGenerationStatus?(status: TowerGenerationQueueStatus): void;
  receiveTowerStateChanged?(scope: { chatId: string; messageId: number | 'latest' }): void;
  receiveTowerGenerationCompleted?(payload: TowerGenerationCompletedPayload): void;
  receiveTowerGenerationFailed?(payload: TowerGenerationBridgeFailure): void;
  beginStructuredOperation?(input: { generationId: string; detail: string; rawOutput?: string; autoOpen?: boolean }): void;
  applyStructuredOperation?(input: { generationId: string; detail: string; rawOutput?: string }): void;
  completeStructuredOperation?(input: { generationId: string; summary: string; rawOutput?: string }): void;
  captureMvuRequest?(input: { source?: string; payload: unknown }): void;
  fail?(error: unknown, generationId?: string): void;
}

interface RestMutationBridgeRequest {
  spec: 'mwg.rest-mutation-request/v1';
  kind: 'upgrade' | 'transform';
  nodeId: string;
  runInstanceId?: string;
  cardId?: string;
}

export interface DesignAssistantControllerOptions {
  towerCoordinator?: boolean;
}

function clone<T>(value: T): T {
  return value === undefined ? value : structuredClone(value);
}

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasStaticTowerBudgetViolation(result: { generatedBattle?: unknown }, budget: { durability?: { hp?: { max?: unknown } } }): boolean {
  const battle = isRecord(result.generatedBattle) ? result.generatedBattle : null;
  const roster = Array.isArray(battle?.enemies) ? battle.enemies : isRecord(battle?.enemy) ? [battle.enemy] : [];
  const maximum = Number(budget.durability?.hp?.max);
  if (!Number.isFinite(maximum) || maximum <= 0 || roster.length === 0) return false;
  const totalHp = roster.reduce((sum, enemy) => (
    sum + (isRecord(enemy) ? Math.max(0, Number(enemy.hp ?? enemy.max_hp) || 0) : 0)
  ), 0);
  // This is a roster fact against the program-owned total durability ceiling;
  // it does not infer a human outcome from a short simulated sample.
  return totalHp > maximum * 4;
}

function balanceFeedbackAuthorization(
  result: { generatedBattle?: unknown; evaluation?: any },
  budget: { numericAuthority?: string; durability?: { hp?: { max?: unknown } } },
): { allowed: boolean; warning?: string } {
  const evaluation = result.evaluation;
  if (budget.numericAuthority !== 'runtime-reference') {
    return { allowed: false, warning: '本节点预算来自维护先验，不能授权 AI 平衡反馈。' };
  }
  if (evaluation?.status !== 'measured' || evaluation?.decisionCoverage !== 'bounded') {
    return { allowed: false, warning: '正式评估未完整覆盖受限决策，本次仅保留复核提示，不请求 AI 改写机制。' };
  }
  if (hasStaticTowerBudgetViolation(result, budget)) return { allowed: true };
  const seeds = Array.isArray(evaluation.seeds) ? new Set(evaluation.seeds).size : 0;
  if (seeds < 6) {
    return { allowed: false, warning: `仅有 ${seeds} 个配对种子预筛，未达到 AI 平衡反馈所需的 6 个样本。` };
  }
  const policies = Array.isArray(evaluation.policies) ? evaluation.policies : [];
  const statisticallyGrounded = policies.length > 0 && policies.every((policy: any) => {
    const interval = policy?.winRateInterval;
    return Number.isFinite(policy?.completed) && policy.completed >= 6
      && Number.isFinite(policy?.winRate)
      && Array.isArray(interval) && interval.length === 2
      && interval.every(Number.isFinite) && interval[0] >= 0 && interval[1] <= 1
      && interval[0] <= policy.winRate && policy.winRate <= interval[1];
  });
  return statisticallyGrounded
    ? { allowed: true }
    : { allowed: false, warning: '配对种子缺少每种策略的完整统计区间，本次仅保留复核提示，不请求 AI 改写机制。' };
}

/**
 * A structure repair is not a second authoring pass. When validation names the
 * exact failed batch members, preserve every other authored node byte-for-byte
 * at the JSON value level so the repair model cannot introduce a new error in
 * an unrelated, already valid reward or encounter.
 */
export function preserveUnreportedTowerBatchResults(
  originalResponse: string,
  repairedResponse: string,
  jobs: readonly TowerGenerationJobDescriptor[],
  error: unknown,
): string {
  const detail = error instanceof Error ? error.message : String(error || '');
  const affected = new Set(jobs
    .filter(job => detail.includes(`${job.nodeId}:`))
    .map(job => job.nodeId));
  if (affected.size === 0) return repairedResponse;
  try {
    const original = parseStructuredRecord(originalResponse);
    const repaired = parseStructuredRecord(repairedResponse);
    if (!Array.isArray(original.results) || !Array.isArray(repaired.results)) return repairedResponse;
    const originalByNode = new Map(original.results
      .filter(isRecord)
      .map(result => [String(result.node_id || ''), result]));
    const repairedByNode = new Map(repaired.results
      .filter(isRecord)
      .map(result => [String(result.node_id || ''), result]));
    const nodeErrorSegment = (nodeId: string): string => {
      const occurrences: Array<{ index: number; nodeId: string; markerLength: number }> = [];
      for (const job of jobs) {
        const marker = `${job.nodeId}:`;
        let cursor = 0;
        for (;;) {
          const index = detail.indexOf(marker, cursor);
          if (index < 0) break;
          occurrences.push({ index, nodeId: job.nodeId, markerLength: marker.length });
          cursor = index + marker.length;
        }
      }
      occurrences.sort((left, right) => left.index - right.index);
      return occurrences
        .map((occurrence, index) => ({
          ...occurrence,
          end: occurrences[index + 1]?.index ?? detail.length,
        }))
        .filter(occurrence => occurrence.nodeId === nodeId)
        .map(occurrence => detail.slice(occurrence.index + occurrence.markerLength, occurrence.end))
        .join('；');
    };
    const results = jobs.map(job => {
      const originalResult = originalByNode.get(job.nodeId);
      const repairedResult = repairedByNode.get(job.nodeId);
      if (!affected.has(job.nodeId)) return clone(originalResult);
      if (!isRecord(originalResult) || !isRecord(repairedResult)) return clone(repairedResult);
      const segment = nodeErrorSegment(job.nodeId);
      const nestedEventRewardFailed = job.kind === 'event' && /reward|event/i.test(segment);
      const payloadFailed = nestedEventRewardFailed
        || /payload|battle content|enemy\.|enemies\.|status_effects|player_status_effects/i.test(segment);
      const rewardFailed = !nestedEventRewardFailed && /reward/i.test(segment);
      if (!payloadFailed && !rewardFailed) return clone(repairedResult);
      const merged = clone(originalResult);
      if (payloadFailed) {
        if ('payload' in repairedResult) merged.payload = clone(repairedResult.payload);
        else delete merged.payload;
      }
      if (rewardFailed) {
        if ('reward' in repairedResult) merged.reward = clone(repairedResult.reward);
        else delete merged.reward;
      }
      return merged;
    });
    if (results.some(result => !isRecord(result))) return repairedResponse;
    return JSON.stringify({ ...repaired, results });
  } catch {
    return repairedResponse;
  }
}

/**
 * A shallow node-shape failure can occur before activation validation reaches
 * the reward. Probe that independent branch as well so one repair request sees
 * every structural error already discoverable from the same authored node.
 */
export function collectTowerBatchUnreportedValidationIssues(
  response: string,
  jobs: readonly TowerGenerationJobDescriptor[],
  existingBattle: unknown,
): string[] {
  let batch: Record<string, any>;
  try {
    batch = parseStructuredRecord(response);
  } catch {
    return [];
  }
  if (!Array.isArray(batch.results)) return [];
  const byNodeId = new Map(batch.results
    .filter(isRecord)
    .map(result => [String(result.node_id || ''), result]));
  const issues: string[] = [];
  for (const job of jobs) {
    const result = byNodeId.get(job.nodeId);
    if (!result) continue;
    const jobIssues: string[] = [];
    if (isBattleRunNode(job.kind)) {
      try {
        validateTowerBattleNodeForActivation(
          existingBattle,
          result.payload?.battle,
          result.reward,
          { id: job.nodeId, kind: job.kind, act: job.act, floor: job.floor, rewardSeed: job.rewardSeed },
        );
      } catch (error) {
        jobIssues.push(error instanceof Error ? error.message : String(error));
      }
      // The budget check can fail before candidate validation. Probe the same
      // reward once without the route budget so malformed candidate effects
      // are still reported in this one bounded repair request.
      if (result.reward !== undefined) {
        try {
          normalizeTowerReward(result.reward, existingBattle);
        } catch (error) {
          jobIssues.push(error instanceof Error ? error.message : String(error));
        }
      }
    } else {
      try {
        if (job.kind === 'event') {
        validateTowerEventNodeForActivation(existingBattle, result.payload?.event);
        } else if (job.kind === 'shop' || job.kind === 'treasure') {
          normalizeTowerReward(result.reward, existingBattle);
        }
      } catch (error) {
        jobIssues.push(error instanceof Error ? error.message : String(error));
      }
    }
    if (jobIssues.length > 0) issues.push(`${job.nodeId}: ${Array.from(new Set(jobIssues)).join('; ')}`);
  }
  return issues;
}

/**
 * Structured-output adapters and models do not agree on whether the schema
 * result is returned directly or under stat_data/data/result. Accept those
 * transport wrappers without weakening the actual player-content gate.
 */
function unwrapTowerInitialContent(value: string | Record<string, any>): {
  narrative: string;
  status: Record<string, any>;
  player: Record<string, any> | null;
  opening: Record<string, any> | null;
} {
  const root = parseStructuredRecord(value);
  const queue: Record<string, any>[] = [root];
  const visited = new Set<Record<string, any>>();
  for (let depth = 0; depth < 3 && queue.length > 0; depth += 1) {
    const layer = queue.splice(0);
    for (const candidate of layer) {
      if (visited.has(candidate)) continue;
      visited.add(candidate);
      if (isRecord(candidate.player)) {
        const player = candidate.player;
        const playerContent = isRecord(player.battle)
          ? player.battle
          : isRecord(player.core) && Array.isArray(player.cards)
            ? {
              core: player.core,
              cards: player.cards,
              artifacts: player.artifacts,
              items: player.items,
              statuses: player.statuses,
              player_abilities: player.player_abilities,
              player_status_effects: player.player_status_effects,
              player_lust_effect: player.player_lust_effect,
              level: player.level,
              exp: player.exp,
            }
            : null;
        if (playerContent) {
          return {
            narrative: String(candidate.narrative || '').trim(),
            status: isRecord(player.status) ? player.status : {},
            player: playerContent,
            opening: isRecord(candidate.opening) ? expandInitialOpeningCardReferences(candidate.opening, playerContent) : null,
          };
        }
      }
      if (isRecord(candidate.battle)) {
        return {
          narrative: String(candidate.narrative || '').trim(),
          status: isRecord(candidate.status) ? candidate.status : {},
          player: candidate.battle,
          opening: isRecord(candidate.opening) ? expandInitialOpeningCardReferences(candidate.opening, candidate.battle) : null,
        };
      }
      if (isRecord(candidate.core) && Array.isArray(candidate.cards)) {
        return { narrative: '', status: {}, player: candidate, opening: null };
      }
      for (const key of ['stat_data', 'variables', 'data', 'result', 'output', 'content']) {
        const nested = candidate[key];
        if (isRecord(nested)) queue.push(nested);
        else if (typeof nested === 'string' && nested.trim()) {
          try {
            queue.push(parseStructuredRecord(nested));
          } catch {
            // Non-JSON explanatory fields are irrelevant to the payload.
          }
        }
      }
    }
  }
  return {
    narrative: String(root.narrative || '').trim(),
    status: isRecord(root.status) ? root.status : {},
    player: null,
    opening: isRecord(root.opening) ? root.opening : null,
  };
}

function collectInitialRepairStatusReferences(value: unknown, references: Set<string>): void {
  if (typeof value === 'string') {
    for (const match of value.matchAll(/(?:self|opponent)\.status\.([A-Za-z_][A-Za-z0-9_]*)(?:\.|\b)/g)) {
      references.add(match[1]);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach(entry => collectInitialRepairStatusReferences(entry, references));
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, entry] of Object.entries(value)) {
    if (['id', 'name', 'emoji', 'description', 'dialogue', 'source', 'narrate', '$meta'].includes(key)) continue;
    if ((key === 'apply_status' || key === 'remove_status') && typeof entry === 'string') {
      if (!['all', 'buffs', 'debuffs'].includes(entry)) references.add(entry);
      continue;
    }
    if (
      ['apply_status', 'remove_status', 'apply_summon_status', 'remove_summon_status'].includes(key)
      && isRecord(entry)
      && typeof entry.id === 'string'
    ) references.add(entry.id);
    collectInitialRepairStatusReferences(entry, references);
  }
}

export interface TowerInitialRepairTarget extends TowerInitialRepairSchemaTarget {
  path: string;
  index?: number;
  original: unknown;
  errors: string[];
}

export interface TowerInitialRootRepairResponse {
  roots: Record<string, unknown>;
  supportStatuses: Record<string, any>[];
  supportResources: Record<string, any>[];
}

const INITIAL_REPAIR_ARRAY_KIND = {
  cards: ['player_card', 'player_cards'],
  artifacts: ['player_artifact', 'player_artifacts'],
  items: ['player_item', 'player_items'],
  statuses: ['player_status_definition', 'player_statuses'],
  player_abilities: ['player_ability', 'player_abilities'],
  player_status_effects: ['player_active_status', 'player_active_statuses'],
} as const satisfies Record<string, readonly [TowerInitialRepairRootKind, TowerInitialRepairRootKind]>;

function initialRepairErrorSegments(detail: string): string[] {
  const segments = detail
    .split(/[；\n]+/)
    .map(segment => segment.trim())
    .filter(Boolean);
  return segments.length > 0 ? segments : [detail];
}

function initialRepairErrorsFor(detail: string, markers: readonly string[]): string[] {
  const lowered = markers.map(marker => marker.toLowerCase());
  const segments = initialRepairErrorSegments(detail);
  const matched: string[] = [];
  let continuingMatchedRoot = false;
  for (const segment of segments) {
    const value = segment.toLowerCase();
    const direct = lowered.some(marker => value.includes(marker));
    const continuation = /^(?:候选\s+statuses\[\d+\]|(?:cards|artifacts|relics|items)\[\d+\]|triggers\.[A-Za-z_])/i.test(segment);
    if (direct || (continuingMatchedRoot && continuation)) matched.push(segment);
    if (direct) continuingMatchedRoot = true;
    else if (!continuation) continuingMatchedRoot = false;
  }
  return matched.length > 0 ? Array.from(new Set(matched)) : [detail];
}

function validStableRepairId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
}

function missingInitialRepairStatusIds(error: string): string[] {
  return Array.from(new Set([
    ...error.matchAll(/(?:状态未注册|未注册状态|缺少状态定义)\s*[:：]\s*([A-Za-z_][A-Za-z0-9_]*)/gi),
    ...error.matchAll(/(?:status[^；;\n]*(?:not registered|missing definition))\s*[:：]?\s*([A-Za-z_][A-Za-z0-9_]*)/gi),
  ].map(match => match[1])));
}

function missingInitialRepairResourceIds(error: string): string[] {
  return Array.from(new Set([
    ...error.matchAll(/(?:资源未注册|未注册资源|缺少资源定义)\s*[:：]\s*([A-Za-z_][A-Za-z0-9_]*)/gi),
    ...error.matchAll(/(?:resource[^；;\n]*(?:not registered|missing definition))\s*[:：]?\s*([A-Za-z_][A-Za-z0-9_]*)/gi),
  ].map(match => match[1])));
}

function mentionsMissingInitialRepairStatus(error: string): boolean {
  return /状态未注册|未注册状态|缺少状态定义|status[^；;\n]*(?:not registered|missing definition)/i.test(error);
}

function mentionsMissingInitialRepairResource(error: string): boolean {
  return /资源未注册|未注册资源|缺少资源定义|resource[^；;\n]*(?:not registered|missing definition)/i.test(error);
}

function initialRepairContainsStatusDefinition(value: unknown, id: string): boolean {
  if (Array.isArray(value)) return value.some(entry => initialRepairContainsStatusDefinition(entry, id));
  if (!isRecord(value)) return false;
  if (Array.isArray(value.statuses) && value.statuses.some(entry => isRecord(entry) && entry.id === id)) return true;
  return Object.values(value).some(entry => initialRepairContainsStatusDefinition(entry, id));
}

function initialRepairHasPlayerResource(
  original: ReturnType<typeof unwrapTowerInitialContent>,
  id: string,
): boolean {
  const player = isRecord(original.player) ? original.player : null;
  const core = player && isRecord(player.core) ? player.core : null;
  return !!core && Array.isArray(core.resources)
    && core.resources.some(entry => isRecord(entry) && entry.id === id);
}

/**
 * Convert validator paths into the smallest independently replaceable roots.
 * The model never selects these paths; it receives fixed rN tokens only.
 */
export function extractTowerInitialRepairTargets(
  original: ReturnType<typeof unwrapTowerInitialContent>,
  validationError: unknown,
): TowerInitialRepairTarget[] {
  const detail = validationError instanceof Error
    ? validationError.message
    : String(validationError || '');
  const pending = new Map<string, Omit<TowerInitialRepairTarget, 'token'>>();
  const addTarget = (input: {
    kind: TowerInitialRepairRootKind;
    path: string;
    original: unknown;
    markers: string[];
    index?: number;
    nullable?: boolean;
    errorDetail?: string;
  }): void => {
    const key = `${input.kind}:${input.path}`;
    const errors = initialRepairErrorsFor(input.errorDetail ?? detail, input.markers);
    const existing = pending.get(key);
    if (existing) {
      existing.errors = Array.from(new Set([...existing.errors, ...errors]));
      return;
    }
    const sourceId = isRecord(input.original) ? input.original.id : undefined;
    const idWasReported = errors.some(error => /(?:invalid|duplicate)[ _-]?id|id\s*(?:格式错误|重复|不合法)/i.test(error));
    pending.set(key, {
      kind: input.kind,
      path: input.path,
      index: input.index,
      original: clone(input.original),
      errors,
      nullable: input.nullable,
      preserveId: validStableRepairId(sourceId) && !idWasReported ? sourceId : undefined,
    });
  };

  if (/初始化结果缺少玩家可读的引导剧情|(?:^|[；;\n])\s*narrative(?:\.|[：:]|$)/i.test(detail)) {
    addTarget({ kind: 'narrative', path: 'narrative', original: original.narrative, markers: ['narrative', '引导剧情'] });
  }

  const player = isRecord(original.player) ? original.player : null;
  // Reward candidates borrow their player's overflow payoff. The candidate
  // validator reports that owner as desireEffects.player, which is not a
  // writable reward subtree in the initial-draft protocol.
  const ownerDesireSegments = initialRepairErrorSegments(detail);
  const isRewardOwnerDesireSegment = (segment: string): boolean =>
    /desireEffects\.player(?:\.|[：:]|$)[^；;\n]*(?:MISSING_LUST_OVERFLOW_EFFECT|player content can increase lust)/i.test(segment);
  const missingRewardOwnerDesire = ownerDesireSegments.some(isRewardOwnerDesireSegment);
  const openingDetail = ownerDesireSegments.filter(segment => !isRewardOwnerDesireSegment(segment)).join('；');
  const ownerDesireOnly = openingDetail.length === 0;
  if (/初始化结果缺少可执行 player\.cards|缺少可用初始牌组/i.test(detail) && !player) {
    addTarget({
      kind: 'player',
      path: 'player',
      original: { status: clone(original.status) },
      markers: ['player', '初始牌组'],
    });
  }
  if (player) {
    if (/(?:battle|player)\.core(?:\.|[：:]|$)/i.test(detail)) {
      addTarget({ kind: 'player_core', path: 'player.core', original: player.core, markers: ['battle.core', 'player.core'] });
    }
    if (/(?:battle|player)\.status(?:\.|[：:]|$)/i.test(detail)) {
      addTarget({ kind: 'player_status', path: 'player.status', original: original.status, markers: ['battle.status', 'player.status'] });
    }
    if (missingRewardOwnerDesire || /(?:battle|player)\.player_lust_effect(?:\.|[：:]|$)/i.test(detail)) {
      addTarget({
        kind: 'player_lust_effect',
        path: 'player.player_lust_effect',
        original: player.player_lust_effect,
        markers: ['battle.player_lust_effect', 'player.player_lust_effect', 'desireEffects.player'],
        nullable: true,
      });
    }
    if (/(?:battle|player)\.level(?:\.|[：:]|$)/i.test(detail)) {
      addTarget({ kind: 'player_level', path: 'player.level', original: player.level, markers: ['battle.level', 'player.level'] });
    }
    if (/(?:battle|player)\.exp(?:\.|[：:]|$)/i.test(detail)) {
      addTarget({ kind: 'player_exp', path: 'player.exp', original: player.exp, markers: ['battle.exp', 'player.exp'] });
    }

    const indexed = /(?:battle|player)\.(cards|artifacts|items|statuses|player_abilities|player_status_effects)\[(\d+)\]/gi;
    for (const match of detail.matchAll(indexed)) {
      const field = match[1] as keyof typeof INITIAL_REPAIR_ARRAY_KIND;
      const index = Number(match[2]);
      const list = Array.isArray(player[field]) ? player[field] : [];
      const [itemKind] = INITIAL_REPAIR_ARRAY_KIND[field];
      addTarget({
        kind: itemKind,
        path: `player.${field}[${index}]`,
        original: list[index],
        markers: [`battle.${field}[${index}]`, `player.${field}[${index}]`],
        index,
        nullable: ['artifacts', 'items', 'player_abilities', 'player_status_effects'].includes(field),
      });
    }

    for (const [field, [, collectionKind]] of Object.entries(INITIAL_REPAIR_ARRAY_KIND) as Array<
      [keyof typeof INITIAL_REPAIR_ARRAY_KIND, readonly [TowerInitialRepairRootKind, TowerInitialRepairRootKind]]
    >) {
      const indexedAlready = [...pending.values()].some(target => target.path.startsWith(`player.${field}[`));
      const broadPath = new RegExp(`(?:battle|player)\\.${field}(?!\\[)(?:[：:]|\\s|$)`, 'i');
      if (!indexedAlready && broadPath.test(detail)) {
        addTarget({
          kind: collectionKind,
          path: `player.${field}`,
          original: player[field],
          markers: [`battle.${field}`, `player.${field}`],
        });
      }
    }
  }

  const opening = isRecord(original.opening) ? original.opening : null;
  const choices = opening && Array.isArray(opening.choices) ? opening.choices : [];
  // A short ID such as "a" is not a marker inside arbitrary error prose:
  // "cards" or "damage" must not make an unrelated choice writable.
  const choiceMarkers = (id: string): string[] => [
    `开局馈赠 ${id}.`, `开局馈赠 ${id} `, `开局馈赠 ${id}：`, `开局馈赠 ${id}:`,
    `opening ${id}.`, `opening ${id} `,
  ];
  for (const match of openingDetail.matchAll(/(?:opening\.)?choices\[(\d+)\]/gi)) {
    const index = Number(match[1]);
    const choice = choices[index];
    const id = isRecord(choice) && typeof choice.id === 'string' ? choice.id : '';
    addTarget({
      kind: 'opening_choice',
      path: `opening.choices[${index}]`,
      original: choice,
      markers: [`opening.choices[${index}]`, `choices[${index}]`, ...(id ? choiceMarkers(id) : [])],
      index,
      errorDetail: openingDetail,
    });
  }
  if (!ownerDesireOnly) choices.forEach((choice, index) => {
    const id = isRecord(choice) && typeof choice.id === 'string' ? choice.id.trim() : '';
    if (!id || !new RegExp(`(?:开局馈赠|opening)\\s+${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=[.\\s：:]|$)`, 'i').test(openingDetail)) return;
    addTarget({
      kind: 'opening_choice',
      path: `opening.choices[${index}]`,
      original: choice,
      markers: [...choiceMarkers(id), `opening.choices[${index}]`, `choices[${index}]`],
      index,
      errorDetail: openingDetail,
    });
  });
  const hasOpeningChoiceTarget = [...pending.values()].some(target => target.kind === 'opening_choice');
  if (!ownerDesireOnly && (/初始化结果缺少启程馈赠|(?:^|[；;\n])\s*opening(?:\.|[：:]|$)|开局馈赠/i.test(openingDetail)) && !hasOpeningChoiceTarget) {
    if (!opening || /初始化结果缺少启程馈赠/i.test(openingDetail)) {
      addTarget({ kind: 'opening', path: 'opening', original: opening, markers: ['opening', '启程馈赠'], errorDetail: openingDetail });
    } else if (/opening\.title|开局馈赠[^；;\n]*title/i.test(openingDetail)) {
      addTarget({ kind: 'opening_title', path: 'opening.title', original: opening.title, markers: ['opening.title', 'title'], errorDetail: openingDetail });
    } else if (/opening\.narrative|开局馈赠[^；;\n]*narrative/i.test(openingDetail)) {
      addTarget({ kind: 'opening_narrative', path: 'opening.narrative', original: opening.narrative, markers: ['opening.narrative', 'narrative'], errorDetail: openingDetail });
    } else {
      addTarget({ kind: 'opening', path: 'opening', original: opening, markers: ['opening', '开局馈赠'], errorDetail: openingDetail });
    }
  }

  if (pending.size === 0 && player && /(?:battle|player|初始牌组|卡组数据)/i.test(detail)) {
    addTarget({
      kind: 'player',
      path: 'player',
      original: { status: clone(original.status), ...clone(player) },
      markers: ['battle', 'player', '初始牌组', '卡组数据'],
    });
  }
  return [...pending.values()]
    .sort((left, right) => left.path.localeCompare(right.path))
    .map((target, index) => ({ ...target, token: `r${index}` }));
}

export function parseTowerInitialRootRepairResponse(
  value: string | Record<string, any>,
  targets: readonly TowerInitialRepairTarget[],
): TowerInitialRootRepairResponse {
  const parsed = parseStructuredRecord(value);
  const allowedTop = new Set(['spec', 'roots', 'support_statuses', 'support_resources']);
  const extraTop = Object.keys(parsed).filter(key => !allowedTop.has(key));
  if (extraTop.length > 0) throw new Error(`结构修复返回了未请求的顶层字段：${extraTop.join(', ')}`);
  if (parsed.spec !== TOWER_INITIAL_ROOT_REPAIR_SPEC) throw new Error('结构修复 spec 不匹配');
  if (!isRecord(parsed.roots)) throw new Error('结构修复缺少 roots');
  const expected = new Set(targets.map(target => target.token));
  const missing = targets.filter(target => !Object.hasOwn(parsed.roots, target.token)).map(target => target.token);
  const extra = Object.keys(parsed.roots).filter(token => !expected.has(token));
  if (missing.length > 0) throw new Error(`结构修复漏掉必需根：${missing.join(', ')}`);
  if (extra.length > 0) throw new Error(`结构修复返回未请求根：${extra.join(', ')}`);
  for (const target of targets) {
    const replacement = parsed.roots[target.token];
    if (replacement === null && !target.nullable) throw new Error(`结构修复根 ${target.token} 不允许删除`);
    if (replacement !== null && target.preserveId && (!isRecord(replacement) || replacement.id !== target.preserveId)) {
      throw new Error(`结构修复根 ${target.token} 必须保留 id=${target.preserveId}`);
    }
  }
  if (!Array.isArray(parsed.support_statuses)) throw new Error('结构修复 support_statuses 必须是数组');
  if (!Array.isArray(parsed.support_resources)) throw new Error('结构修复 support_resources 必须是数组');
  return {
    roots: parsed.roots,
    supportStatuses: parsed.support_statuses.filter(isRecord),
    supportResources: parsed.support_resources.filter(isRecord),
  };
}

function collectInitialRepairResourceReferences(value: unknown, references: Set<string>): void {
  if (typeof value === 'string') {
    for (const match of value.matchAll(/(?:self|opponent)\.resource\.([A-Za-z_][A-Za-z0-9_]*)(?:\.|\b)/g)) references.add(match[1]);
    for (const match of value.matchAll(/(?:spent_resource|x_resource)\.([A-Za-z_][A-Za-z0-9_]*)(?:\.|\b)/g)) references.add(match[1]);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach(entry => collectInitialRepairResourceReferences(entry, references));
    return;
  }
  if (!isRecord(value)) return;
  if (isRecord(value.cost)) {
    Object.keys(value.cost).filter(id => id !== 'energy').forEach(id => references.add(id));
  }
  for (const [key, entry] of Object.entries(value)) {
    if ((key === 'resource' || key === 'set_resource') && isRecord(entry) && typeof entry.id === 'string') {
      references.add(entry.id);
    }
    collectInitialRepairResourceReferences(entry, references);
  }
}

function appendReferencedRepairResources(
  preserved: unknown[],
  repairedDefinitions: unknown[],
  acceptedRepairRoots: unknown[],
): unknown[] {
  const result = clone(preserved);
  const existingIds = new Set(result.filter(isRecord).map(entry => String(entry.id || '')).filter(Boolean));
  const required = new Set<string>();
  acceptedRepairRoots.forEach(root => collectInitialRepairResourceReferences(root, required));
  for (const entry of repairedDefinitions) {
    if (!isRecord(entry) || typeof entry.id !== 'string') continue;
    if (!required.has(entry.id) || existingIds.has(entry.id)) continue;
    result.push(clone(entry));
    existingIds.add(entry.id);
  }
  return result;
}

/** Merge only the roots mapped before generation; the response cannot pick paths. */
export function mergeTowerInitialRootRepair(
  original: ReturnType<typeof unwrapTowerInitialContent>,
  targets: readonly TowerInitialRepairTarget[],
  repair: TowerInitialRootRepairResponse,
): ReturnType<typeof unwrapTowerInitialContent> {
  const result = clone(original);
  const player = isRecord(result.player) ? result.player : {};
  result.player = player;
  const ordered = [...targets].sort((left, right) => {
    const leftParent = left.path.replace(/\[\d+\]$/, '');
    const rightParent = right.path.replace(/\[\d+\]$/, '');
    if (leftParent === rightParent && left.index !== undefined && right.index !== undefined) return right.index - left.index;
    return left.path.localeCompare(right.path);
  });
  const acceptedPlayerRoots: unknown[] = [];
  for (const target of ordered) {
    const replacement = clone(repair.roots[target.token]);
    if (target.kind === 'narrative') result.narrative = String(replacement || '');
    else if (target.kind === 'player') {
      const fullPlayer = isRecord(replacement) ? replacement : {};
      result.status = isRecord(fullPlayer.status) ? clone(fullPlayer.status) : {};
      const { status: _status, ...battlePlayer } = fullPlayer;
      result.player = clone(battlePlayer);
      acceptedPlayerRoots.push(result.player);
    } else if (target.kind === 'player_status') result.status = isRecord(replacement) ? replacement : {};
    else if (target.kind === 'player_core') {
      player.core = replacement;
      acceptedPlayerRoots.push(replacement);
    } else if (target.kind === 'player_lust_effect') {
      if (replacement === null) delete player.player_lust_effect;
      else {
        player.player_lust_effect = replacement;
        acceptedPlayerRoots.push(replacement);
      }
    } else if (target.kind === 'player_level') player.level = replacement;
    else if (target.kind === 'player_exp') player.exp = replacement;
    else if (target.kind === 'opening') result.opening = isRecord(replacement) ? replacement : null;
    else if (target.kind === 'opening_title' && isRecord(result.opening)) result.opening.title = replacement;
    else if (target.kind === 'opening_narrative' && isRecord(result.opening)) result.opening.narrative = replacement;
    else if (target.kind === 'opening_choices' && isRecord(result.opening)) result.opening.choices = replacement;
    else if (target.kind === 'opening_choice' && isRecord(result.opening) && Array.isArray(result.opening.choices)) {
      result.opening.choices.splice(target.index!, 1, replacement);
    } else {
      const fieldByKind: Partial<Record<TowerInitialRepairRootKind, string>> = {
        player_card: 'cards',
        player_cards: 'cards',
        player_artifact: 'artifacts',
        player_artifacts: 'artifacts',
        player_item: 'items',
        player_items: 'items',
        player_status_definition: 'statuses',
        player_statuses: 'statuses',
        player_ability: 'player_abilities',
        player_abilities: 'player_abilities',
        player_active_status: 'player_status_effects',
        player_active_statuses: 'player_status_effects',
      };
      const field = fieldByKind[target.kind];
      if (!field) continue;
      if (target.index === undefined) player[field] = replacement;
      else {
        const list = Array.isArray(player[field]) ? player[field] : [];
        player[field] = list;
        if (replacement === null) list.splice(target.index, 1);
        else list.splice(target.index, 1, replacement);
      }
      if (replacement !== null) acceptedPlayerRoots.push(replacement);
    }
  }
  if (isRecord(result.player)) {
    const statuses = Array.isArray(result.player.statuses) ? result.player.statuses : [];
    result.player.statuses = appendReferencedRepairStatusClosure(
      statuses,
      repair.supportStatuses,
      acceptedPlayerRoots,
    );
    const core = isRecord(result.player.core) ? result.player.core : {};
    const resources = Array.isArray(core.resources) ? core.resources : [];
    core.resources = appendReferencedRepairResources(resources, repair.supportResources, acceptedPlayerRoots);
    result.player.core = core;
  }
  return result;
}

function appendReferencedRepairStatusClosure(
  preserved: unknown[],
  repairedDefinitions: unknown[],
  acceptedRepairRoots: unknown[],
): unknown[] {
  const result = clone(preserved);
  const existingIds = new Set(result
    .filter(isRecord)
    .map(entry => String(entry.id || ''))
    .filter(Boolean));
  const repairedById = new Map<string, Record<string, any>>();
  for (const entry of repairedDefinitions) {
    if (!isRecord(entry) || typeof entry.id !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(entry.id)) continue;
    if (!repairedById.has(entry.id)) repairedById.set(entry.id, entry);
  }
  const required = new Set<string>();
  acceptedRepairRoots.forEach(root => collectInitialRepairStatusReferences(root, required));
  const pending = [...required];
  while (pending.length > 0) {
    const id = pending.pop()!;
    const definition = repairedById.get(id);
    if (!definition) continue;
    const dependencies = new Set<string>();
    collectInitialRepairStatusReferences(definition, dependencies);
    for (const dependency of dependencies) {
      if (required.has(dependency)) continue;
      required.add(dependency);
      pending.push(dependency);
    }
  }
  for (const entry of repairedDefinitions) {
    if (!isRecord(entry) || typeof entry.id !== 'string') continue;
    if (!required.has(entry.id) || existingIds.has(entry.id)) continue;
    result.push(clone(entry));
    existingIds.add(entry.id);
  }
  return result;
}

export interface TowerInitialRepairSlotTarget extends TowerInitialRepairSlotSchemaTarget {
  path: string;
  relativePath: string;
  original: unknown;
  errors: string[];
  resourceReferencePaths?: string[];
  costPath?: string;
  statusHoldPath?: string;
  additionalWritePaths?: string[];
  whenPath?: string;
  whenConditionPath?: string;
  cardCollectionPath?: string;
  cardIndex?: number;
}

export interface TowerInitialRepairSlotRootTarget extends TowerInitialRepairSlotRootSchemaTarget {
  path: string;
  original: unknown;
  errors: string[];
  slots: TowerInitialRepairSlotTarget[];
}

export interface TowerInitialSlotRepairResponse {
  roots: Record<string, { slots: Record<string, { action: TowerInitialRepairSlotAction; value?: unknown }> }>;
  supportStatuses: Record<string, any>[];
  supportResources: Record<string, any>[];
}

function initialRepairPathParts(path: string): Array<string | number> {
  const parts: Array<string | number> = [];
  for (const match of path.matchAll(/([^.\[\]]+)|\[(\d+)\]/g)) {
    parts.push(match[2] === undefined ? match[1] : Number(match[2]));
  }
  return parts;
}

function initialRepairValueAtPath(value: unknown, path: string): unknown {
  let current = value as any;
  for (const part of initialRepairPathParts(path)) {
    if (current == null) return undefined;
    current = current[part as any];
  }
  return current;
}

function setInitialRepairValueAtPath(value: unknown, path: string, replacement: unknown): void {
  const parts = initialRepairPathParts(path);
  if (parts.length === 0) throw new Error('锁定修复槽路径为空');
  let current = value as any;
  for (let index = 0; index < parts.length - 1; index += 1) {
    current = current?.[parts[index] as any];
    if (current == null) throw new Error(`锁定修复槽路径不存在：${path}`);
  }
  current[parts.at(-1) as any] = clone(replacement);
}

function deleteInitialRepairValueAtPath(value: unknown, path: string): void {
  const parts = initialRepairPathParts(path);
  if (parts.length === 0) throw new Error('锁定修复槽路径为空');
  let current = value as any;
  for (let index = 0; index < parts.length - 1; index += 1) {
    current = current?.[parts[index] as any];
    if (current == null) throw new Error(`锁定修复槽路径不存在：${path}`);
  }
  const leaf = parts.at(-1)!;
  if (Array.isArray(current) && typeof leaf === 'number') current.splice(leaf, 1);
  else delete current[leaf as any];
}

function canonicalInitialRepairValidationPaths(error: string): string[] {
  const paths = [...error.matchAll(/\b(?:battle|player|opening)\.[A-Za-z_][A-Za-z0-9_]*(?:\[\d+\])?(?:\.[A-Za-z_][A-Za-z0-9_]*(?:\[\d+\])?)*/g)]
    .map(match => match[0].replace(/^battle\./, 'player.'));
  return Array.from(new Set(paths));
}

function openingRewardOwnerPath(
  root: TowerInitialRepairTarget,
  error: string,
): { ownerPath: string; validationPath: string } | null {
  if (root.kind !== 'opening_choice' || !isRecord(root.original)) return null;
  const transformPaths = canonicalInitialRepairValidationPaths(error).filter(path => path.startsWith(`${root.path}.outcome.deck_transforms[`));
  if (transformPaths.length === 1) {
    const match = transformPaths[0].match(/\.deck_transforms\[(\d+)\]\.replacement(?:\.|$)/);
    const action = match && root.original.outcome?.deck_transforms?.[Number(match[1])];
    if (match && isRecord(action?.replacement)) return {
      ownerPath: `${root.path}.outcome.deck_transforms[${Number(match[1])}].replacement`, validationPath: transformPaths[0],
    };
  }
  const canonical = canonicalInitialRepairValidationPaths(error).filter(path => path.startsWith(`${root.path}.outcome.reward.`));
  if (canonical.length === 1) {
    const suffix = canonical[0].slice(`${root.path}.outcome.reward.`.length);
    const match = suffix.match(/^(cards|artifacts|items)\[(\d+)\](?:\.|$)/);
    const reward = root.original.outcome?.reward;
    if (match && isRecord(reward) && Array.isArray(reward[match[1]]) && isRecord(reward[match[1]][Number(match[2])]))
      return { ownerPath: `${root.path}.outcome.reward.${match[1]}[${Number(match[2])}]`, validationPath: canonical[0] };
  }
  const id = typeof root.original.id === 'string' ? root.original.id : '';
  if (!id) return null;
  const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const owner = error.match(new RegExp(`${escapedId}\\.(cards|artifacts|items)\\[(\\d+)\\]`, 'i'));
  const localOwner = owner || error.match(/(?:^|[：:]\s*)(cards|artifacts|relics|items)\[(\d+)\]/i);
  if (localOwner) {
    const category = localOwner[1].toLowerCase() === 'relics' ? 'artifacts' : localOwner[1].toLowerCase();
    const ownerPath = `${root.path}.outcome.reward.${category}[${Number(localOwner[2])}]`;
    const tailMatches = [...error.matchAll(/(?:cards|artifacts|relics|items)\[\d+\]((?:\.[A-Za-z_][A-Za-z0-9_]*(?:\[\d+\])?)*)/gi)];
    const tail = [...tailMatches].reverse().find(match => match[1]) || tailMatches.at(-1);
    return { ownerPath, validationPath: `${ownerPath}${tail?.[1] || ''}` };
  }
  const candidateStatusIndex = error.match(/候选\s+statuses\[(\d+)\]\s+无效/i)?.[1];
  if (candidateStatusIndex !== undefined) {
    const reward = isRecord(root.original.outcome) && isRecord(root.original.outcome.reward)
      ? root.original.outcome.reward
      : null;
    const candidates: string[] = [];
    for (const category of ['cards', 'artifacts', 'items']) {
      const entries = reward && Array.isArray(reward[category]) ? reward[category] : [];
      entries.forEach((entry: unknown, index: number) => {
        if (isRecord(entry) && Array.isArray(entry.statuses) && entry.statuses[Number(candidateStatusIndex)] !== undefined) {
          candidates.push(`${root.path}.outcome.reward.${category}[${index}]`);
        }
      });
    }
    if (candidates.length === 1) return { ownerPath: candidates[0], validationPath: candidates[0] };
  }
  return null;
}

function initialRepairOwnerAndValidationPath(
  root: TowerInitialRepairTarget,
  error: string,
): { ownerPath: string; validationPath: string } | null {
  const reward = openingRewardOwnerPath(root, error);
  if (reward) return reward;
  const paths = canonicalInitialRepairValidationPaths(error)
    .filter(path => path === root.path || path.startsWith(`${root.path}.`) || path.startsWith(`${root.path}[`))
    .sort((left, right) => right.length - left.length);
  if (paths.length === 0) return null;
  let validationPath = paths[0];
  if (validationPath === root.path) {
    const nested = error.match(/具体原因[：:]\s*([A-Za-z_][A-Za-z0-9_]*(?:\[\d+\])?(?:\.[A-Za-z_][A-Za-z0-9_]*(?:\[\d+\])?)*)\s*[:：]/i);
    if (nested) validationPath = `${root.path}.${nested[1]}`;
  }
  return { ownerPath: root.path, validationPath };
}

function nearestInitialEffectSequencePath(
  source: ReturnType<typeof unwrapTowerInitialContent>,
  validationPath: string,
): { path: string; passive: boolean } | null {
  const candidates: Array<{ path: string; passive: boolean }> = [];
  for (const match of validationPath.matchAll(/\.(effects|discard_effects)(?=\.|\[|$)/g)) {
    const path = validationPath.slice(0, match.index! + match[0].length);
    const triggerPath = path.endsWith('.trigger.effects') ? path.slice(0, -'.effects'.length) : null;
    candidates.push({
      path,
      passive: !!triggerPath && initialRepairValueAtPath(source, `${triggerPath}.on`) === 'passive',
    });
  }
  for (const match of validationPath.matchAll(/\.triggers\.([A-Za-z_][A-Za-z0-9_]*)(?=\.|\[|$)/g)) {
    candidates.push({
      path: validationPath.slice(0, match.index! + match[0].length),
      passive: match[1] === 'hold',
    });
  }
  return candidates
    .sort((left, right) => right.path.length - left.path.length)
    .find(candidate => initialRepairValueAtPath(source, candidate.path) !== undefined) || null;
}

function initialRepairDescriptionPath(
  source: ReturnType<typeof unwrapTowerInitialContent>,
  ownerPath: string,
): string | null {
  const path = `${ownerPath}.description`;
  return typeof initialRepairValueAtPath(source, path) === 'string' ? path : null;
}

function unpaidInitialRepairResourceId(error: string): string | null {
  const explicit = error.match(/(?:当前卡牌不会支付资源|当前卡牌没有资源)\s+([A-Za-z_][A-Za-z0-9_]*)/i)?.[1];
  if (explicit) return explicit;
  if (!/(?:SPENT_RESOURCE_NOT_ALLOWED|X_RESOURCE_NOT_ALLOWED)/i.test(error)) return null;
  return error.match(/(?:spent_resource|x_resource)\.([A-Za-z_][A-Za-z0-9_]*)/i)?.[1] || null;
}

function initialRepairResourceFormulaPaths(
  value: unknown,
  basePath: string,
  resourceId: string,
  result: string[] = [],
): string[] {
  if (typeof value === 'string') {
    const escapedId = resourceId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`\\b(?:spent_resource|x_resource)\\.${escapedId}\\b`).test(value)) result.push(basePath);
    return result;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => initialRepairResourceFormulaPaths(entry, `${basePath}[${index}]`, resourceId, result));
    return result;
  }
  if (!isRecord(value)) return result;
  Object.entries(value).forEach(([key, entry]) => {
    initialRepairResourceFormulaPaths(entry, basePath ? `${basePath}.${key}` : key, resourceId, result);
  });
  return result;
}

function initialRepairStatusHoldModifier(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value) || value.modify !== 'damage') return null;
  const allowed = new Set(['modify', 'add', 'subtract', 'multiply', 'divide', 'set', 'to', 'when']);
  if (Object.keys(value).some(key => !allowed.has(key))) return null;
  if (value.to !== undefined && value.to !== 'self') return null;
  if (value.when !== undefined && value.when !== false && value.when !== 'false') return null;
  const operations = ['add', 'subtract', 'multiply', 'divide', 'set'].filter(key => Object.hasOwn(value, key));
  if (operations.length !== 1) return null;
  const modifier: Record<string, unknown> = { modify: 'damage', [operations[0]]: clone(value[operations[0]]) };
  const compiled = compileCompactEffectList(modifier);
  if (!compiled.ok) return null;
  const policy = validateEffectProgramPolicy(compiled.value, {
    triggerPolicy: 'forbid', modifierPolicy: 'only', allowStatusStacks: true,
  });
  return policy.ok ? modifier : null;
}

function initialRepairConditionIsValid(value: unknown): boolean {
  if (typeof value !== 'string' || !value.trim()) return false;
  const compiled = compileCompactEffectList({ damage: 1, when: value });
  if (!compiled.ok) return false;
  return validateEffectProgramPolicy(compiled.value, {
    triggerPolicy: 'forbid', modifierPolicy: 'forbid', allowCardDestination: true,
  }).ok;
}

function initialRepairSkillTriggerCanPromote(content: unknown): boolean {
  if (!isRecord(content) || content.type !== 'Skill' || !isRecord(content.trigger)) return false;
  if (['discard_effects', 'retain', 'exhaust', 'ethereal', 'innate'].some(key => content[key] !== undefined)) return false;
  if (typeof content.description !== 'string' || !/(?:每|当|本场战斗|回合|持续|after|whenever|each)/i.test(content.description)) {
    return false;
  }
  const immediate = compileCompactEffectList(content.effects);
  if (!immediate.ok || !validateEffectProgramPolicy(immediate.value, {
    triggerPolicy: 'forbid', modifierPolicy: 'forbid', allowCardDestination: true,
  }).ok) return false;
  const trigger = content.trigger;
  const allowedKeys = new Set([
    'on', 'effects', 'scope', 'ordinal', 'n', 'event', 'phase', 'reason', 'source_kind', 'source_id',
    'damage_type', 'card_type', 'template_id', 'card_instance_id', 'actor_id', 'target_id',
  ]);
  if (Object.keys(trigger).some(key => !allowedKeys.has(key))) return false;
  if (typeof trigger.on !== 'string' || trigger.on === 'passive' || !ABILITY_TRIGGERS.includes(trigger.on as any)) return false;
  if (trigger.ordinal !== undefined && !['first', 'nth', 'every_n'].includes(String(trigger.ordinal))) return false;
  if (trigger.ordinal === 'first' && trigger.n !== undefined) return false;
  if (['nth', 'every_n'].includes(String(trigger.ordinal)) && (!Number.isInteger(trigger.n) || Number(trigger.n) < 1)) return false;
  const triggered = compileCompactEffectList(trigger.effects);
  return triggered.ok && validateEffectProgramPolicy(triggered.value, {
    triggerPolicy: 'forbid', modifierPolicy: 'forbid', allowCardDestination: true,
  }).ok;
}

function initialRepairPlayerCardHasExternalReference(
  original: ReturnType<typeof unwrapTowerInitialContent>,
  cardIndex: number,
  cardId: string,
): boolean {
  if (!isRecord(original.player)) return true;
  const scan = (value: unknown, parentKey = ''): boolean => {
    if (typeof value === 'string') {
      return parentKey !== 'id'
        && !['name', 'description', 'label', 'title', 'narrative', 'emoji', 'source', 'ability'].includes(parentKey)
        && value === cardId;
    }
    if (Array.isArray(value)) return value.some(entry => scan(entry, parentKey));
    if (!isRecord(value)) return false;
    return Object.entries(value).some(([key, entry]) => scan(entry, key));
  };
  return Object.entries(original.player).some(([key, value]) => {
    if (key !== 'cards') return scan(value, key);
    if (!Array.isArray(value)) return true;
    return value.some((entry, index) => index !== cardIndex && scan(entry, 'cards'));
  });
}

function canCompileDiscardStrategy(value: unknown): boolean {
  const effects = Array.isArray(value) ? value : [value];
  const candidates = effects.filter(entry => isRecord(entry) && Object.hasOwn(entry, 'discard'));
  if (candidates.length !== 1) return false;
  const allowed = new Set([
    'discard', 'draw', ...COMPACT_CARD_SELECTOR_INPUT_KEYS, 'when',
  ]);
  return Object.keys(candidates[0]).every(key => allowed.has(key));
}

function canCompileCardCopyStrategy(value: unknown): boolean {
  const effects = Array.isArray(value) ? value : [value];
  const candidates = effects.filter(entry => isRecord(entry) && Object.hasOwn(entry, 'copy'));
  if (candidates.length !== 1) return false;
  const allowed = new Set([
    'copy', 'to', ...COMPACT_CARD_SELECTOR_INPUT_KEYS, 'when', 'card_rule', 'target_rule', 'to_modify',
  ]);
  return Object.keys(candidates[0]).every(key => allowed.has(key));
}

const INITIAL_SIMPLE_REPAIR_EFFECT_KEYS = new Set([
  'status_action',
  'damage', 'heal', 'block', 'energy', 'lust', 'set_hp', 'set_lust', 'set_energy', 'set_block',
  'draw', 'apply_status', 'remove_status', 'resource', 'set_resource', 'discard', 'exhaust', 'recover',
  'move_card', 'remove_card', 'transform_card', 'copy', 'double',
  'reduce_cost',
  'choose',
]);

function initialEffectSequenceHasFiniteOperation(value: unknown): boolean {
  const effects = Array.isArray(value) ? value : [value];
  return effects.length > 0 && effects.every(entry => (
    isRecord(entry) && Object.keys(entry).some(key => INITIAL_SIMPLE_REPAIR_EFFECT_KEYS.has(key))
  ));
}

function initialPassiveEffectSequenceHasFiniteOperation(value: unknown): boolean {
  const effects = Array.isArray(value) ? value : [value];
  return effects.length > 0 && effects.every(entry => (
    isRecord(entry) && (Object.hasOwn(entry, 'modify') || Object.hasOwn(entry, 'card_rule'))
  ));
}

/**
 * Map validation paths to a fixed write set. Returning no targets is
 * intentional when even one reported defect cannot be represented by the
 * finite slot families; production must fail visibly instead of widening to a
 * whole-card or whole-opening rewrite.
 */
export function extractTowerInitialRepairSlotTargets(
  original: ReturnType<typeof unwrapTowerInitialContent>,
  validationError: unknown,
): TowerInitialRepairSlotRootTarget[] {
  const roots = extractTowerInitialRepairTargets(original, validationError);
  const result: TowerInitialRepairSlotRootTarget[] = [];
  for (const root of roots) {
    const isPlayerRoot = root.path === 'player' || root.path.startsWith('player.');
    const pending = new Map<string, Omit<TowerInitialRepairSlotTarget, 'token'>>();
    const addSlot = (input: Omit<TowerInitialRepairSlotTarget, 'token' | 'errors'>, error: string): void => {
      const key = `${input.action}:${input.kind}:${input.path}`;
      const existing = pending.get(key);
      if (existing) {
        existing.errors = Array.from(new Set([...existing.errors, error]));
        return;
      }
      pending.set(key, { ...input, errors: [error] });
    };
    const consumedTriggerCompanions = new Set<string>();
    // A nested condition can produce both its precise diagnostic and a
    // reasonless parent summary. Prove that it is the only compiler fault
    // before consuming the summary; otherwise it would open the entire effect
    // for replacement as well as its child condition. This never edits input.
    for (const candidate of root.errors) {
      if (!/[：:]\s*规则字段不符合浅层 effects 契约\s*$/.test(candidate)) continue;
      const paths = canonicalInitialRepairValidationPaths(candidate);
      if (paths.length !== 1) continue;
      const parentPath = paths[0];
      const parent = initialRepairValueAtPath(original, parentPath);
      if (!isRecord(parent) || typeof parent.when !== 'string') continue;
      const conditionPath = `${parentPath}.when`;
      if (!root.errors.some(error => error !== candidate
        && canonicalInitialRepairValidationPaths(error).includes(conditionPath))) continue;
      const broken = compileCompactEffectList(parent);
      if (broken.ok || !broken.issues.length || broken.issues.some(issue => issue.path !== '$.when')) continue;
      const withoutCondition = { ...parent };
      delete withoutCondition.when;
      if (compileCompactEffectList(withoutCondition).ok) consumedTriggerCompanions.add(candidate);
    }
    for (const candidate of root.errors) {
      const companionPath = canonicalInitialRepairValidationPaths(candidate)
        .find(path => path.endsWith('.trigger.trigger'));
      if (!companionPath || !/(?:trigger\s*不受支持|unsupported\s+trigger)/i.test(candidate)) continue;
      const triggerPath = companionPath.slice(0, -'.trigger'.length);
      const trigger = initialRepairValueAtPath(original, triggerPath);
      if (
        !isRecord(trigger)
        || typeof trigger.on !== 'string'
        || ABILITY_TRIGGERS.includes(trigger.on as any)
        || trigger.trigger !== undefined
      ) continue;
      const onPath = `${triggerPath}.on`;
      const hasMatchingOn = root.errors.some(error => (
        error !== candidate
        && /(?:trigger\s*不受支持|unsupported\s+trigger)/i.test(error)
        && canonicalInitialRepairValidationPaths(error).includes(onPath)
      ));
      const onlyCascadePaths = root.errors.every(error => {
        const paths = canonicalInitialRepairValidationPaths(error)
          .filter(path => path.startsWith(`${triggerPath}.`));
        return paths.every(path => path === onPath || path === companionPath);
      });
      if (hasMatchingOn && onlyCascadePaths) consumedTriggerCompanions.add(candidate);
    }
    let unhandled = false;
    for (const error of root.errors) {
      if (consumedTriggerCompanions.has(error)) continue;
      if (
        root.kind === 'player_lust_effect'
        && /desireEffects\.player(?:\.|[：:]|$)[^；;\n]*(?:MISSING_LUST_OVERFLOW_EFFECT|player content can increase lust)/i.test(error)
      ) {
        addSlot({
          kind: 'missing_lust_effect', action: 'replace_value', path: root.path,
          relativePath: '', original: clone(root.original),
        }, error);
        continue;
      }
      const missingStatusIds = missingInitialRepairStatusIds(error);
      const missingResourceIds = missingInitialRepairResourceIds(error);
      // A missing referenced definition is itself a complete repair target.
      // The model authors the constrained definition in the support array;
      // no surrounding card/opening subtree needs to be opened for writes.
      if (missingResourceIds.length > 0) {
        if (missingResourceIds.every(id => initialRepairHasPlayerResource(original, id))) continue;
        if (!isPlayerRoot) unhandled = true;
        continue;
      }
      if (missingStatusIds.length > 0) {
        const alreadyDefined = missingStatusIds.every(id => (
          initialRepairContainsStatusDefinition(root.original, id)
          || initialRepairContainsStatusDefinition(original.player, id)
        ));
        if (alreadyDefined) continue;
        if (isPlayerRoot) continue;
      }
      if (mentionsMissingInitialRepairResource(error) || mentionsMissingInitialRepairStatus(error)) {
        unhandled = true;
        continue;
      }
      const located = initialRepairOwnerAndValidationPath(root, error);
      if (!located) {
        unhandled = true;
        continue;
      }
      const { ownerPath, validationPath } = located;
      // This semantic omission has no existing carrier to repair.  Open only
      // the nullable player_lust_effect root; the pressure source remains
      // locked, so the model cannot satisfy the contract by deleting it.
      if (root.kind === 'player_lust_effect'
        && validationPath === root.path
        && /MISSING_LUST_OVERFLOW_EFFECT|缺少对应欲望满溢效果/i.test(error)) {
        addSlot({
          kind: 'missing_lust_effect', action: 'replace_value', path: root.path,
          relativePath: '', original: clone(root.original),
        }, error);
        continue;
      }
      if (root.kind === 'player_status_definition' && error.includes('EXPLICIT_FIRST_CARD_EVENT_MISMATCH')) {
        const definition = initialRepairValueAtPath(original, root.path);
        const mismatch = inspectFirstCardEventMismatch(definition);
        if (mismatch && isRecord(definition) && validationPath === `${root.path}.triggers.${mismatch.event}.when`) {
          addSlot({kind:'first_card_event_condition',action:'replace_value',path:validationPath,
            relativePath:`triggers.${mismatch.event}.when`,original:clone(definition.triggers[mismatch.event].when),
            allowedModes:[mismatch.condition]},error);
          continue;
        }
      }
      // Overflow compilation projects a carrier-level condition onto effects.
      // Formula diagnostics may point below that leaf (for example .left).
      // Resolve the projected condition only if the actual nested when is absent.
      if (root.kind === 'player_lust_effect'
        && (validationPath === `${root.path}.when`
          || validationPath.startsWith(`${root.path}.when.`)
          || ((validationPath === `${root.path}.effects.when`
            || validationPath.startsWith(`${root.path}.effects.when.`))
            && initialRepairValueAtPath(original, `${root.path}.effects.when`) === undefined))
        && typeof initialRepairValueAtPath(original, `${root.path}.when`) === 'string') {
        const path = `${root.path}.when`;
        addSlot({kind: 'lust_condition', action: 'replace_value', path, relativePath: 'when',
          original: clone(initialRepairValueAtPath(original, path))}, error);
        continue;
      }
      const existingConditionAlias = [...pending.values()].find(slot => (
        slot.kind === 'condition_alias_strategy'
        && slot.whenConditionPath
        && (
          validationPath === slot.whenConditionPath.slice(0, -'.when_condition'.length)
          || validationPath.startsWith(`${slot.whenConditionPath.slice(0, -'.when_condition'.length)}.`)
        )
      ));
      if (
        existingConditionAlias
        && /(?:该操作必须单独占一个 effects 数组项|This operation must remain a separate effect object|Only common numeric[^；;\n]*share one object)/i.test(error)
      ) {
        existingConditionAlias.errors = Array.from(new Set([...existingConditionAlias.errors, error]));
        continue;
      }
      const unpaidResourceId = unpaidInitialRepairResourceId(error);
      if (unpaidResourceId) {
        const content = initialRepairValueAtPath(original, ownerPath);
        const effectsPath = `${ownerPath}.effects`;
        const costPath = `${ownerPath}.cost`;
        const cost = initialRepairValueAtPath(original, costPath);
        const references = Array.from(new Set(initialRepairResourceFormulaPaths(
          initialRepairValueAtPath(original, effectsPath), effectsPath, unpaidResourceId,
        ))).sort();
        const costCanBePreserved = (Number.isInteger(cost) && Number(cost) >= 0)
          || (isRecord(cost) && Object.keys(cost).length > 0 && Object.entries(cost).every(([id, amount]) => (
            validStableRepairId(id)
            && ((Number.isInteger(amount) && Number(amount) >= 0) || amount === 'all')
          )));
        if (
          root.kind !== 'player_card'
          || ownerPath !== root.path
          || !isRecord(content)
          || !validStableRepairId(content.id)
          || !initialRepairHasPlayerResource(original, unpaidResourceId)
          || !costCanBePreserved
          || references.length === 0
        ) {
          unhandled = true;
          continue;
        }
        addSlot({
          kind: 'resource_payment_strategy', action: 'replace_value',
          path: `${costPath}.${unpaidResourceId}`,
          relativePath: `cost.${unpaidResourceId}`,
          preserveId: unpaidResourceId,
          original: {
            cost: clone(cost),
            formulas: Object.fromEntries(references.map(path => [
              path.slice(`${ownerPath}.`.length), clone(initialRepairValueAtPath(original, path)),
            ])),
          },
          resourceReferencePaths: references,
          costPath,
          additionalWritePaths: [costPath, ...references],
        }, error);
        const descriptionPath = initialRepairDescriptionPath(original, ownerPath);
        if (!descriptionPath) {
          unhandled = true;
          continue;
        }
        addSlot({
          kind: 'description', action: 'replace_value', path: descriptionPath,
          relativePath: descriptionPath.slice(root.path.length + 1),
          original: clone(initialRepairValueAtPath(original, descriptionPath)),
        }, error);
        continue;
      }
      if (
        root.kind === 'player_card'
        && validationPath === `${ownerPath}.quantity`
        && /(?:数量必须是\s*1\s*到\s*100\s*的整数|quantity[^；;\n]*(?:1\s*(?:to|\.\.)\s*100|integer))/i.test(error)
      ) {
        const card = initialRepairValueAtPath(original, ownerPath);
        const match = ownerPath.match(/^(player\.cards)\[(\d+)\]$/);
        if (!isRecord(card) || !validStableRepairId(card.id) || !match) {
          unhandled = true;
          continue;
        }
        const cardIndex = Number(match[2]);
        const playerCards = isRecord(original.player) && Array.isArray(original.player.cards)
          ? original.player.cards
          : [];
        const allowedModes = ['set_owned_quantity'];
        if (
          playerCards.length > 1
          && !initialRepairPlayerCardHasExternalReference(original, cardIndex, card.id)
        ) allowedModes.push('remove_unowned_card');
        addSlot({
          kind: 'card_quantity_strategy', action: 'replace_value', path: validationPath,
          relativePath: 'quantity', preserveId: card.id, original: clone(card.quantity),
          allowedModes, cardCollectionPath: match[1], cardIndex,
        }, error);
        continue;
      }
      const candidateStatusIndex = error.match(/候选\s+statuses\[(\d+)\]\s+无效/i)?.[1];
      const statusPath = candidateStatusIndex !== undefined
        ? `${ownerPath}.statuses[${Number(candidateStatusIndex)}]`
        : root.kind === 'player_status_definition'
          ? root.path
          : null;
      if (statusPath) {
        const definition = initialRepairValueAtPath(original, statusPath);
        if (!isRecord(definition) || !validStableRepairId(definition.id)) {
          unhandled = true;
          continue;
        }
        const addStatusValueSlot = (
          kind: Extract<TowerInitialRepairSlotKind,
            'status_type' | 'status_stacks_change' | 'status_tick_timing' | 'status_max_stacks' | 'status_stun' | 'status_character_emoji' | 'status_protection' | 'status_defense' | 'description'>,
          field: string,
        ): void => {
          const path = `${statusPath}.${field}`;
          addSlot({
            kind, action: 'replace_value', path,
            relativePath: path.slice(root.path.length + 1),
            original: clone(initialRepairValueAtPath(original, path)),
          }, error);
        };
        if (/defense/i.test(error)) { addStatusValueSlot('status_defense', 'defense'); continue; }
        if (/protection/i.test(error)) { addStatusValueSlot('status_protection', 'protection'); continue; }
        if (/character_emoji/i.test(error)) { addStatusValueSlot('status_character_emoji', 'character_emoji'); continue; }
        if (/tick_timing/i.test(error)) {
          addStatusValueSlot('status_tick_timing', 'tick_timing');
          continue;
        }
        if (/stacks_change/i.test(error)) {
          addStatusValueSlot('status_stacks_change', 'stacks_change');
          continue;
        }
        if (/maxStacks/i.test(error)) {
          addStatusValueSlot('status_max_stacks', 'maxStacks');
          continue;
        }
        if (/\bstun\b/i.test(error)) {
          addStatusValueSlot('status_stun', 'stun');
          continue;
        }
        if (/(?:状态\s+type|\.type|type\s+无效)/i.test(error)) {
          addStatusValueSlot('status_type', 'type');
          continue;
        }
        if (/(?:状态\s+description|\.description)/i.test(error)) {
          addStatusValueSlot('description', 'description');
          continue;
        }
        const triggerName = error.match(/triggers\.([A-Za-z_][A-Za-z0-9_]*)/i)?.[1]
          || error.match(/状态\s+([A-Za-z_][A-Za-z0-9_]*)\s+不能包含/i)?.[1];
        if (triggerName) {
          const triggerPath = `${statusPath}.triggers.${triggerName}`;
          const triggerValue = initialRepairValueAtPath(original, triggerPath);
          // These slots can replace effects, not move a filtered listener to
          // another owner/carrier. An illegal placement does not make its
          // authored event filter disposable. Do not spend an AI retry on a
          // generic slot incapable of preserving that relationship.
          if (initialStatusRepairHasEventFilterEnvelope(triggerValue)) {
            unhandled = true;
            continue;
          }
          if (triggerValue === undefined) {
            unhandled = true;
            continue;
          }
          // A compiler-proven condition-only fault opens the condition leaf,
          // not the whole effect or its description. This lets the AI select
          // an equivalent public predicate without losing the locked payoff.
          const statusOwner = initialRepairValueAtPath(original, statusPath);
          const conditionCompilation = compileCompactEffectList(triggerValue, {
            implicitTarget: 'self', creates: isRecord(statusOwner) ? statusOwner.creates : undefined,
          });
          // A card-zone destination is not a combat target. Preserve the
          // authored template/count/condition instead of sending add_card to
          // the simple-effect repair grammar, which cannot express it.
          if (!conditionCompilation.ok && conditionCompilation.issues.length && isRecord(statusOwner)) {
            const destinationPaths = new Set<string>();
            const probe = clone(triggerValue);
            const onlyDestinations = conditionCompilation.issues.every(issue => {
              const match = issue.path.match(/^\$(?:\[(\d+)\])?\.to$/);
              if (!match || !/add_card to must be hand, deck, or discard/.test(issue.message)) return false;
              const index = match[1] === undefined ? null : Number(match[1]);
              const item = index === null ? probe : Array.isArray(probe) ? probe[index] : null;
              if (!isRecord(item) || typeof item.add_card !== 'string') return false;
              destinationPaths.add(`${triggerPath}${index === null ? '' : `[${index}]`}.to`);
              item.to = 'hand'; // Diagnostic probe only; never published or used as an AI answer.
              return true;
            });
            if (onlyDestinations && collectCompactStatusDefinitionIssues({
              ...statusOwner, triggers: { [triggerName]: probe },
            }).length === 0) {
              for (const path of destinationPaths) addSlot({
                kind: 'add_card_destination', action: 'replace_value', path,
                relativePath: path.slice(root.path.length + 1), original: clone(initialRepairValueAtPath(original, path)),
              }, error);
              addStatusValueSlot('description', 'description');
              continue;
            }
          }
          if (!conditionCompilation.ok && conditionCompilation.issues.length) {
            const conditionPaths = new Set<string>();
            const withoutConditions = clone(triggerValue);
            const onlyConditions = conditionCompilation.issues.every(issue => {
              const match = issue.path.match(/^\$(?:\[(\d+)\])?\.when(?:\.|$)/);
              if (!match) return false;
              const index = match[1] === undefined ? null : Number(match[1]);
              const item = index === null ? triggerValue : Array.isArray(triggerValue) ? triggerValue[index] : null;
              if (!isRecord(item) || typeof item.when !== 'string') return false;
              conditionPaths.add(`${triggerPath}${index === null ? '' : `[${index}]`}.when`);
              const copy = index === null ? withoutConditions : Array.isArray(withoutConditions) ? withoutConditions[index] : null;
              if (!isRecord(copy)) return false;
              delete copy.when;
              return true;
            });
            if (onlyConditions && isRecord(statusOwner)
              && collectCompactStatusDefinitionIssues({ ...statusOwner, triggers: { [triggerName]: withoutConditions } }).length === 0
              && compileCompactEffectList(withoutConditions, {
              implicitTarget: 'self', creates: isRecord(statusOwner) ? statusOwner.creates : undefined,
            }).ok) {
              for (const path of conditionPaths) addSlot({ kind: 'condition', action: 'replace_value', path,
                relativePath: path.slice(root.path.length + 1), original: clone(initialRepairValueAtPath(original, path)),
              }, error);
              continue;
            }
          }
          const escapedTriggerPath = triggerPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const canonicalItemIndex = validationPath.match(new RegExp(`^${escapedTriggerPath}\\[(\\d+)\\]`))?.[1];
          const rawIndexedTrigger = canonicalItemIndex === undefined
            ? error.match(/triggers\s*\.\s*([A-Za-z_][A-Za-z0-9_]*)\s*\[(\d+)\]/i)
            : null;
          if (
            rawIndexedTrigger
            && (
              rawIndexedTrigger[1] !== triggerName
              || !STATUS_TRIGGERS.includes(triggerName as any)
              || !Array.isArray(triggerValue)
              || !isRecord(triggerValue[Number(rawIndexedTrigger[2])])
            )
          ) {
            unhandled = true;
            continue;
          }
          const rawItemIndex = rawIndexedTrigger?.[2];
          const itemIndex = canonicalItemIndex ?? rawItemIndex;
          const canReplaceOne = itemIndex !== undefined
            && Array.isArray(triggerValue)
            && isRecord(triggerValue[Number(itemIndex)]);
          const singleExistingItem = Array.isArray(triggerValue)
            ? triggerValue.length === 1 && isRecord(triggerValue[0])
            : isRecord(triggerValue);
          const nextAttackItem = canReplaceOne
            ? triggerValue[Number(itemIndex)]
            : singleExistingItem ? (Array.isArray(triggerValue) ? triggerValue[0] : triggerValue) : undefined;
          const nextAttackModifier = triggerName === 'attack_played'
            ? initialRepairStatusHoldModifier(nextAttackItem)
            : null;
          const description = initialRepairValueAtPath(original, `${statusPath}.description`);
          const statusDefinition = initialRepairValueAtPath(original, statusPath);
          const holdPath = `${statusPath}.triggers.hold`;
          if (
            nextAttackModifier
            && isRecord(statusDefinition)
            && validStableRepairId(statusDefinition.id)
            && statusDefinition.stacks_change === -1
            && initialRepairValueAtPath(original, holdPath) === undefined
            && typeof description === 'string'
            && /(?:下一次[^。；;\n]{0,16}攻击|next\s+(?:played\s+)?attack)/i.test(description)
          ) {
            const path = canReplaceOne ? `${triggerPath}[${Number(itemIndex)}]` : triggerPath;
            addSlot({
              kind: 'status_next_attack_modifier_strategy', action: 'replace_trigger', path,
              relativePath: path.slice(root.path.length + 1),
              preserveId: statusDefinition.id,
              original: clone(nextAttackItem),
              statusHoldPath: holdPath,
              additionalWritePaths: [holdPath],
            }, error);
            continue;
          }
          if (nextAttackModifier) {
            unhandled = true;
            continue;
          }
          if ((itemIndex !== undefined && !canReplaceOne) || (!canReplaceOne && !singleExistingItem)) {
            unhandled = true;
            continue;
          }
          const path = canReplaceOne ? `${triggerPath}[${Number(itemIndex)}]` : triggerPath;
          addSlot({
            kind: canReplaceOne
              ? triggerName === 'hold' ? 'status_hold_effect_item' : 'status_trigger_effect_item'
              : triggerName === 'hold' ? 'status_hold_sequence' : 'status_trigger_effect_sequence',
            action: canReplaceOne ? 'replace_effect' : 'replace_effect_sequence',
            path,
            relativePath: path.slice(root.path.length + 1),
            original: clone(canReplaceOne ? triggerValue[Number(itemIndex)] : triggerValue),
          }, error);
          const descriptionPath = initialRepairDescriptionPath(original, statusPath);
          if (descriptionPath) addSlot({
            kind: 'description', action: 'replace_value', path: descriptionPath,
            relativePath: descriptionPath.slice(root.path.length + 1),
            original: clone(initialRepairValueAtPath(original, descriptionPath)),
          }, error);
          continue;
        }
        unhandled = true;
        continue;
      }
      if (
        root.kind === 'player_card'
        && validationPath === `${ownerPath}.trigger`
        && /(?:规则字段不符合浅层 effects 契约|trigger[^；;\n]*(?:not allowed|unsupported|invalid))/i.test(error)
      ) {
        const content = initialRepairValueAtPath(original, ownerPath);
        if (!initialRepairSkillTriggerCanPromote(content)) {
          unhandled = true;
          continue;
        }
        const typePath = `${ownerPath}.type`;
        addSlot({
          kind: 'skill_trigger_classification_strategy', action: 'replace_value', path: typePath,
          relativePath: typePath.slice(root.path.length + 1), original: 'Skill',
          preserveId: isRecord(content) && validStableRepairId(content.id) ? content.id : undefined,
        }, error);
        continue;
      }
      if (/缺少\s*effects|missing required[^；;\n]*effects/i.test(error)) {
        const owner = initialRepairValueAtPath(original, ownerPath);
        const effectsPath = `${ownerPath}.effects`;
        if (isRecord(owner) && owner.effects === undefined) {
          addSlot({
            kind: 'effect_sequence', action: 'replace_effect_sequence', path: effectsPath,
            relativePath: effectsPath.slice(root.path.length + 1), original: undefined,
          }, error);
          continue;
        }
      }
      if (root.kind === 'player_card' && validationPath === `${ownerPath}.effects`
        && /SINGLE_NARRATE_REQUIRED|Event 主效果必须且只能包含一个顶层 narrate/.test(error)) {
        const content = initialRepairValueAtPath(original, ownerPath);
        const compiled = isRecord(content) ? compileCompactEffectList(content.effects, { creates: content.creates, when: content.when }) : null;
        const policy = compiled?.ok ? validateEffectProgramPolicy(compiled.value, {
          triggerPolicy: 'forbid', modifierPolicy: 'forbid', allowNarrate: false,
          allowCardDestination: true, allowCurrentCardReplay: true, allowPersistentGrowth: true,
        }) : null;
        // Only a type mismatch is open for repair. Narrative/mixed/invalid effects cannot use this route.
        if (isRecord(content) && content.type === 'Event' && content.trigger === undefined
          && compiled?.ok && compiled.value.steps.length > 0 && policy?.ok) {
          const typePath = `${ownerPath}.type`;
          addSlot({ kind: 'card_type', action: 'replace_value', path: typePath,
            relativePath: typePath.slice(root.path.length + 1), original: 'Event' }, error);
          continue;
        }
        unhandled = true;
        continue;
      }
      if (/Power 必须至少包含真实触发能力|Power 必须至少注册一个触发器/i.test(error)) {
        const content = initialRepairValueAtPath(original, ownerPath);
        const typePath = `${ownerPath}.type`;
        const compiledImmediate = isRecord(content) ? compileCompactEffectList(content.effects) : null;
        const immediatePolicy = compiledImmediate?.ok
          ? validateEffectProgramPolicy(compiledImmediate.value, {
            triggerPolicy: 'forbid', modifierPolicy: 'forbid', allowCardDestination: true,
          })
          : null;
        if (
          isRecord(content)
          && content.type === 'Power'
          && content.trigger === undefined
          && compiledImmediate?.ok
          && immediatePolicy?.ok
          && initialRepairValueAtPath(original, typePath) === 'Power'
        ) {
          addSlot({
            kind: 'card_type', action: 'replace_value', path: typePath,
            relativePath: typePath.slice(root.path.length + 1), original: 'Power',
          }, error);
          if (typeof content.description === 'string' && /每(?:回合|场)|战斗开始|当.+时|持续|被动|触发/.test(content.description)) {
            const descriptionPath = `${ownerPath}.description`;
            addSlot({
              kind: 'description', action: 'replace_value', path: descriptionPath,
              relativePath: descriptionPath.slice(root.path.length + 1), original: clone(content.description),
            }, error);
          }
          continue;
        }
        unhandled = true;
        continue;
      }
      const trigger2Match = validationPath.match(/^(.*)\.trigger2(?:\.|$)/);
      if (trigger2Match) {
        // Combining two authored triggers into one requires a semantic choice
        // across multiple timings/effect lists. Keep it unmappable until a
        // dedicated finite strategy exists.
        unhandled = true;
        continue;
      }
      const summonLifecycleMatch = validationPath.match(/^(.*\.spawn_summon)\.on_destroyed$/);
      if (summonLifecycleMatch && /(?:on_destroyed|不允许字段|unsupported content field)/i.test(error)) {
        const summonPath = summonLifecycleMatch[1];
        const lifecycleFields = new Set(['slot', 'on_existing', 'on_defeated', 'retain_corpse', 'overflow', 'on_destroyed']);
        const lifecycleErrorPaths = new Set<string>();
        for (const candidateError of root.errors) {
          const paths = canonicalInitialRepairValidationPaths(candidateError);
          paths.forEach(path => {
            if (!path.startsWith(`${summonPath}.`)) return;
            const field = path.slice(summonPath.length + 1).split(/[.\[]/, 1)[0];
            if (lifecycleFields.has(field)) lifecycleErrorPaths.add(path);
          });
          if (
            paths.includes(summonPath)
            && /(?:MISSING_SUMMON_SLOT|unique summon policies require slot|唯一召唤策略必须提供\s*slot|(?:缺少|需要|必须)[^；;\n]{0,24}(?:召唤)?(?:槽|slot))/i.test(candidateError)
          ) {
            lifecycleErrorPaths.add(`${summonPath}#lifecycle_invariant`);
          }
        }
        if (
          initialRepairValueAtPath(original, validationPath) === 'default'
          && lifecycleErrorPaths.size === 1
          && lifecycleErrorPaths.has(validationPath)
        ) {
          addSlot({
            kind: 'summon_lifecycle_default', action: 'replace_value', path: validationPath,
            relativePath: validationPath.slice(root.path.length + 1), original: 'default',
          }, error);
          continue;
        }
        unhandled = true;
        continue;
      }
      const conditionAliasMatch = validationPath.match(/^(.*)\.when_condition(?:\.|$)/);
      if (conditionAliasMatch) {
        const effectPath = conditionAliasMatch[1];
        const effect = initialRepairValueAtPath(original, effectPath);
        const whenPath = `${effectPath}.when`;
        const whenConditionPath = `${effectPath}.when_condition`;
        const when = initialRepairValueAtPath(original, whenPath);
        const whenCondition = initialRepairValueAtPath(original, whenConditionPath);
        const whenValid = initialRepairConditionIsValid(when);
        const aliasValid = initialRepairConditionIsValid(whenCondition);
        const allowedModes = [
          ...(whenValid ? ['use_when'] : []),
          ...(aliasValid ? ['use_when_condition'] : []),
          ...(whenValid && aliasValid ? ['combine_and'] : []),
        ];
        if (!isRecord(effect) || allowedModes.length === 0) {
          unhandled = true;
          continue;
        }
        addSlot({
          kind: 'condition_alias_strategy', action: 'replace_value', path: whenConditionPath,
          relativePath: whenConditionPath.slice(root.path.length + 1),
          original: { when: clone(when), when_condition: clone(whenCondition) },
          allowedModes, whenPath, whenConditionPath,
          additionalWritePaths: [whenPath, whenConditionPath],
        }, error);
        if (whenValid && aliasValid) {
          const descriptionPath = initialRepairDescriptionPath(original, ownerPath);
          if (!descriptionPath) {
            unhandled = true;
            continue;
          }
          addSlot({
            kind: 'description', action: 'replace_value', path: descriptionPath,
            relativePath: descriptionPath.slice(root.path.length + 1),
            original: clone(initialRepairValueAtPath(original, descriptionPath)),
          }, error);
        }
        continue;
      }
      if (
        /(?:add_card[^；;\n]*to must be hand, deck, or discard|add_card[^；;\n]*目标|\.add_card\.to)/i.test(error)
        && validationPath.endsWith('.to')
      ) {
        const effectPath = validationPath.slice(0, -'.to'.length);
        const effect = initialRepairValueAtPath(original, effectPath);
        if (!isRecord(effect) || typeof effect.add_card !== 'string') {
          unhandled = true;
          continue;
        }
        addSlot({
          kind: 'add_card_destination', action: 'replace_value', path: validationPath,
          relativePath: validationPath.slice(root.path.length + 1), original: clone(effect.to),
        }, error);
        const descriptionPath = initialRepairDescriptionPath(original, ownerPath);
        if (descriptionPath) addSlot({
          kind: 'description', action: 'replace_value', path: descriptionPath,
          relativePath: descriptionPath.slice(root.path.length + 1),
          original: clone(initialRepairValueAtPath(original, descriptionPath)),
        }, error);
        continue;
      }
      if (/unsupported content field/i.test(error) && initialRepairValueAtPath(original, validationPath) !== undefined) {
        addSlot({
          kind: 'remove_field', action: 'remove_invalid_field', path: validationPath,
          relativePath: validationPath.slice(root.path.length + 1),
          original: clone(initialRepairValueAtPath(original, validationPath)),
        }, error);
        const descriptionPath = initialRepairDescriptionPath(original, ownerPath);
        if (descriptionPath) addSlot({
          kind: 'description', action: 'replace_value', path: descriptionPath,
          relativePath: descriptionPath.slice(root.path.length + 1),
          original: clone(initialRepairValueAtPath(original, descriptionPath)),
        }, error);
        continue;
      }

      if (error.includes('[EXPLICIT_LITERAL_EFFECT_MISMATCH]') && validationPath.endsWith('.effects')) {
        const contentPath = validationPath.slice(0, -'.effects'.length);
        const owner = initialRepairValueAtPath(original, contentPath);
        if (!isRecord(owner) || diagnoseAuthoredLiteralEffects(owner, contentPath).length !== 1) {
          unhandled = true;
          continue;
        }
        addSlot({ kind: 'literal_effect_sequence', action: 'replace_effect_sequence', path: validationPath,
          relativePath: validationPath.slice(root.path.length + 1),
          original: { description: clone(owner.description), effects: clone(owner.effects) } }, error);
        continue;
      }
      const effectSequence = nearestInitialEffectSequencePath(original, validationPath);
      const triggerPathMatch = validationPath.match(/^(.*\.trigger)(?:\.|$)/);
      const needsTriggerMode = !!triggerPathMatch && /(?:非\s*passive|passive[^；;\n]*(?:不允许|只能)|持续规则[^；;\n]*passive|CURRENT_CARD_REPLAY_NOT_ALLOWED|replay_current)/i.test(error);
      if (needsTriggerMode) {
        const triggerPath = triggerPathMatch![1];
        const trigger = initialRepairValueAtPath(original, triggerPath);
        if (!isRecord(trigger)) {
          unhandled = true;
          continue;
        }
        addSlot({
          kind: 'trigger_mode_strategy', action: 'replace_trigger', path: triggerPath,
          relativePath: triggerPath.slice(root.path.length + 1), original: clone(trigger),
        }, error);
        const descriptionPath = initialRepairDescriptionPath(original, triggerPath.replace(/\.trigger$/, ''));
        if (descriptionPath) addSlot({
          kind: 'description', action: 'replace_value', path: descriptionPath,
          relativePath: descriptionPath.slice(root.path.length + 1),
          original: clone(initialRepairValueAtPath(original, descriptionPath)),
        }, error);
        continue;
      }

      if (/\.trigger\.on(?:\.|$)/.test(validationPath)) {
        const path = validationPath.slice(0, validationPath.indexOf('.trigger.on') + '.trigger.on'.length);
        addSlot({
          kind: 'trigger_on', action: 'replace_value', path,
          relativePath: path.slice(root.path.length + 1), original: clone(initialRepairValueAtPath(original, path)),
        }, error);
        continue;
      }

      const actualCondition = validationPath.match(/^(.*\.(?:when|guard))(?:\.|$)/)?.[1];
      const conditionIsMisnested = /\.(?:amount|resource|set_resource)\.when(?:\.|$)/.test(validationPath)
        || /resource\.amount\.when|amount\.equals/i.test(error);
      if (actualCondition && !conditionIsMisnested && typeof initialRepairValueAtPath(original, actualCondition) === 'string') {
        addSlot({
          kind: 'condition', action: 'replace_value', path: actualCondition,
          relativePath: actualCondition.slice(root.path.length + 1),
          original: clone(initialRepairValueAtPath(original, actualCondition)),
        }, error);
        continue;
      }

      if (effectSequence) {
        const originalEffects = initialRepairValueAtPath(original, effectSequence.path);
        const isEmpty = (Array.isArray(originalEffects) && originalEffects.length === 0)
          || (isRecord(originalEffects) && Object.keys(originalEffects).length === 0);
        if (isEmpty && effectSequence.path.endsWith('.trigger.effects')) {
          const triggerPath = effectSequence.path.slice(0, -'.effects'.length);
          const contentPath = triggerPath.slice(0, -'.trigger'.length);
          const content = initialRepairValueAtPath(original, contentPath);
          if (isRecord(content) && content.type === 'Power' && initialEffectSequenceHasFiniteOperation(content.effects)) {
            addSlot({
              kind: 'remove_field', action: 'remove_invalid_field', path: triggerPath,
              relativePath: triggerPath.slice(root.path.length + 1),
              original: clone(initialRepairValueAtPath(original, triggerPath)),
            }, error);
            continue;
          }
          const trigger = initialRepairValueAtPath(original, triggerPath);
          const descriptionPath = initialRepairDescriptionPath(original, contentPath);
          if (
            !isRecord(trigger)
            || typeof trigger.on !== 'string'
            || !ABILITY_TRIGGERS.includes(trigger.on as any)
            || !descriptionPath
          ) {
            unhandled = true;
            continue;
          }
          addSlot({
            kind: trigger.on === 'passive' ? 'passive_effect_sequence' : 'effect_sequence',
            action: 'replace_effect_sequence', path: effectSequence.path,
            relativePath: effectSequence.path.slice(root.path.length + 1),
            original: clone(originalEffects),
          }, error);
          addSlot({
            kind: 'description', action: 'replace_value', path: descriptionPath,
            relativePath: descriptionPath.slice(root.path.length + 1),
            original: clone(initialRepairValueAtPath(original, descriptionPath)),
          }, error);
          continue;
        }
        const escapedUnknownSequencePath = effectSequence.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const unknownItemIndex = validationPath.match(new RegExp(`^${escapedUnknownSequencePath}\\[(\\d+)\\]`))?.[1];
        const unknownItem = !effectSequence.passive
          && unknownItemIndex !== undefined
          && Array.isArray(originalEffects)
          ? originalEffects[Number(unknownItemIndex)]
          : undefined;
        const mixedItem = unknownItem || (isRecord(originalEffects) ? originalEffects
          : Array.isArray(originalEffects) && originalEffects.length === 1 ? originalEffects[0] : undefined);
        if (isRecord(mixedItem)
          && !canCompileDiscardStrategy(originalEffects) && !canCompileCardCopyStrategy(originalEffects)
          && /(?:该操作必须单独占一个 effects 数组项|This operation must remain a separate effect object|Only common numeric[^；;\n]*share one object)/i.test(error)) {
          const operations = Object.keys(mixedItem).filter(key => !COMPACT_EFFECT_META_KEY_SET.has(key));
          if (operations.length > 1) {
            // Never force a complex/unknown operation into the simple grammar:
            // that could make deleting the actual mechanic the only valid answer.
            if (operations.some(key => !INITIAL_SIMPLE_REPAIR_EFFECT_KEYS.has(key))) {
              const operationNames = initialRepairOrderableOperations(mixedItem);
              if (operationNames.length) {
                const path = Array.isArray(originalEffects)
                  ? `${effectSequence.path}[${Number(unknownItemIndex ?? 0)}]` : effectSequence.path;
                addSlot({ kind: 'effect_order_strategy', action: 'replace_effect', path,
                  relativePath: path.slice(root.path.length + 1), original: clone(mixedItem), operationNames }, error);
                continue;
              }
              unhandled = true;
              continue;
            }
            const path = Array.isArray(originalEffects)
              ? `${effectSequence.path}[${Number(unknownItemIndex ?? 0)}]` : effectSequence.path;
            addSlot({ kind: 'effect_item_sequence', action: 'replace_effect', path,
              relativePath: path.slice(root.path.length + 1), original: clone(mixedItem) }, error);
            continue;
          }
        }
        if (
          isRecord(unknownItem)
          && Object.keys(unknownItem).length > 0
          && !Object.keys(unknownItem).some(key => INITIAL_SIMPLE_REPAIR_EFFECT_KEYS.has(key))
        ) {
          const descriptionPath = initialRepairDescriptionPath(original, ownerPath);
          if (!descriptionPath) {
            unhandled = true;
            continue;
          }
          const path = `${effectSequence.path}[${Number(unknownItemIndex)}]`;
          addSlot({
            kind: 'unknown_effect_item_strategy', action: 'replace_effect', path,
            relativePath: path.slice(root.path.length + 1), original: clone(unknownItem),
          }, error);
          addSlot({
            kind: 'description', action: 'replace_value', path: descriptionPath,
            relativePath: descriptionPath.slice(root.path.length + 1),
            original: clone(initialRepairValueAtPath(original, descriptionPath)),
          }, error);
          continue;
        }
        const discardConflict = /(?:discard[^；;\n]*(?:separate effect|单独占|pick)|pick[^；;\n]*(?:all|discard)|Only common numeric)/i.test(error)
          && canCompileDiscardStrategy(originalEffects);
        if (discardConflict) {
          addSlot({
            kind: 'discard_strategy', action: 'replace_effect_sequence', path: effectSequence.path,
            relativePath: effectSequence.path.slice(root.path.length + 1), original: clone(originalEffects),
          }, error);
          const descriptionPath = initialRepairDescriptionPath(original, ownerPath);
          if (descriptionPath) addSlot({
            kind: 'description', action: 'replace_value', path: descriptionPath,
            relativePath: descriptionPath.slice(root.path.length + 1),
            original: clone(initialRepairValueAtPath(original, descriptionPath)),
          }, error);
        } else if (
          /(?:\bcopy\b|\bdouble\b|card_rule|to_modify|target_rule)/i.test(error)
          && canCompileCardCopyStrategy(originalEffects)
        ) {
          addSlot({
            kind: 'card_copy_strategy', action: 'replace_effect_sequence', path: effectSequence.path,
            relativePath: effectSequence.path.slice(root.path.length + 1), original: clone(originalEffects),
          }, error);
          const descriptionPath = initialRepairDescriptionPath(original, ownerPath);
          if (descriptionPath) addSlot({
            kind: 'description', action: 'replace_value', path: descriptionPath,
            relativePath: descriptionPath.slice(root.path.length + 1),
            original: clone(initialRepairValueAtPath(original, descriptionPath)),
          }, error);
        } else if (
          effectSequence.passive
            ? !initialPassiveEffectSequenceHasFiniteOperation(originalEffects)
            : !initialEffectSequenceHasFiniteOperation(originalEffects)
        ) {
          unhandled = true;
        } else {
          const escapedSequencePath = effectSequence.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const itemIndex = validationPath.match(new RegExp(`^${escapedSequencePath}\\[(\\d+)\\]`))?.[1];
          const canReplaceOne = !effectSequence.passive
            && itemIndex !== undefined
            && Array.isArray(originalEffects)
            && isRecord(originalEffects[Number(itemIndex)]);
          const singleExistingItem = Array.isArray(originalEffects)
            ? originalEffects.length === 1 && isRecord(originalEffects[0])
            : isRecord(originalEffects);
          if (!canReplaceOne && !singleExistingItem) {
            unhandled = true;
            continue;
          }
          const useOnlyArrayItem = !effectSequence.passive && !canReplaceOne && Array.isArray(originalEffects);
          const path = canReplaceOne || useOnlyArrayItem
            ? `${effectSequence.path}[${Number(canReplaceOne ? itemIndex : 0)}]`
            : effectSequence.path;
          addSlot({
            kind: canReplaceOne || useOnlyArrayItem
              ? 'effect_item'
              : effectSequence.passive ? 'passive_effect_sequence' : 'effect_sequence',
            action: canReplaceOne || useOnlyArrayItem ? 'replace_effect' : 'replace_effect_sequence', path,
            relativePath: path.slice(root.path.length + 1),
            original: clone(canReplaceOne || useOnlyArrayItem
              ? originalEffects[Number(canReplaceOne ? itemIndex : 0)]
              : originalEffects),
          }, error);
          if (canReplaceOne && /\.hits(?:\.|[：:]|$)/i.test(error)) {
            const descriptionPath = initialRepairDescriptionPath(original, ownerPath);
            if (descriptionPath) addSlot({
              kind: 'description', action: 'replace_value', path: descriptionPath,
              relativePath: descriptionPath.slice(root.path.length + 1),
              original: clone(initialRepairValueAtPath(original, descriptionPath)),
            }, error);
          }
        }
        continue;
      }

      unhandled = true;
    }
    const supportStatusIds = [...new Set(root.errors.flatMap(missingInitialRepairStatusIds))]
      .filter(id => !initialRepairContainsStatusDefinition(root.original, id)
        && !initialRepairContainsStatusDefinition(original.player, id));
    const supportResourceIds = isPlayerRoot
      ? [...new Set(root.errors.flatMap(missingInitialRepairResourceIds))]
        .filter(id => !initialRepairHasPlayerResource(original, id))
      : [];
    const supportOnly = pending.size === 0
      && isPlayerRoot
      && (supportResourceIds.length > 0 || supportStatusIds.length > 0);
    if (unhandled || (pending.size === 0 && !supportOnly)) return [];
    const slots = [...pending.values()]
      .sort((left, right) => left.path.localeCompare(right.path) || left.kind.localeCompare(right.kind))
      .map((slot, index) => ({ ...slot, token: `s${index}` }));
    // Ambiguous overlapping writes must not depend on model/merge ordering.
    if (slots.some((slot, index) => slots.some((other, otherIndex) => otherIndex !== index
      && (other.path === slot.path || other.path.startsWith(`${slot.path}.`) || other.path.startsWith(`${slot.path}[`))))) return [];
    result.push({
      token: root.token,
      path: root.path,
      original: clone(root.original),
      errors: clone(root.errors),
      slots,
      allowSupportStatuses: isPlayerRoot && supportStatusIds.length > 0,
      allowSupportResources: isPlayerRoot && supportResourceIds.length > 0,
      supportStatusIds,
      supportResourceIds,
    });
  }
  return result;
}

function canonicalizeInitialRepairSlotValue(slot: TowerInitialRepairSlotTarget, value: unknown): unknown {
  if (
    slot.kind === 'effect_sequence'
    || slot.kind === 'passive_effect_sequence'
    || slot.kind === 'status_trigger_effect_sequence'
    || slot.kind === 'status_hold_sequence'
  ) {
    return Array.isArray(value) ? value : isRecord(value) ? [value] : value;
  }
  if (slot.kind === 'trigger_mode_strategy' && isRecord(value) && isRecord(value.effects)) {
    return { ...value, effects: [value.effects] };
  }
  return value;
}

function assertInitialSimpleRepairEffect(value: unknown, label: string): void {
  if (!isRecord(value)) throw new Error(`${label} 必须是效果对象`);
  const primary = Object.keys(value).filter(key => INITIAL_SIMPLE_REPAIR_EFFECT_KEYS.has(key));
  if (primary.length !== 1) throw new Error(`${label} 必须恰好包含一个有限白名单主操作`);
  const operation = primary[0];
  const selection = COMPACT_CARD_SELECTOR_INPUT_KEYS;
  const allowedByOperation: Record<string, Set<string>> = {
    damage: new Set(['damage', 'hits', 'damage_type', 'bypass_block', 'lifesteal', 'to', 'targets', 'when']),
    heal: new Set(['heal', 'to', 'targets', 'when']),
    block: new Set(['block', 'to', 'targets', 'when']),
    energy: new Set(['energy', 'to', 'targets', 'when']),
    lust: new Set(['lust', 'to', 'targets', 'when']),
    set_hp: new Set(['set_hp', 'to', 'targets', 'when']),
    set_lust: new Set(['set_lust', 'to', 'targets', 'when']),
    set_energy: new Set(['set_energy', 'to', 'targets', 'when']),
    set_block: new Set(['set_block', 'to', 'targets', 'when']),
    draw: new Set(['draw', 'when']),
    apply_status: new Set(['apply_status', 'stacks', 'to', 'targets', 'when']),
    remove_status: new Set(['remove_status', 'to', 'targets', 'when']),
    status_action: new Set(['status_action', 'when']),
    resource: new Set(['resource', 'to', 'targets', 'when']),
    set_resource: new Set(['set_resource', 'to', 'targets', 'when']),
    choose: new Set(['choose', 'count', 'options', 'when']),
  };
  const cardZone = new Set([operation, ...selection, 'destination', 'position', 'count', 'to', 'when']);
  const allowed = allowedByOperation[operation] || cardZone;
  const extra = Object.keys(value).filter(key => !allowed.has(key));
  if (extra.length > 0) throw new Error(`${label} 含有限槽不允许的字段：${extra.join(', ')}`);
  if (operation === 'resource') {
    if (!isRecord(value.resource) || Object.keys(value.resource).some(key => !['id', 'amount'].includes(key))) {
      throw new Error(`${label}.resource 只允许 id/amount`);
    }
  }
  if (operation === 'set_resource') {
    if (!isRecord(value.set_resource) || Object.keys(value.set_resource).some(key => !['id', 'value'].includes(key))) {
      throw new Error(`${label}.set_resource 只允许 id/value`);
    }
  }
  const compiled = compileCompactEffectList(value);
  if (!compiled.ok) {
    const detail = compiled.issues.slice(0, 4).map(issue => `${issue.path}: ${issue.message}`).join('；');
    throw new Error(`${label} 未通过权威 effects 校验：${detail}`);
  }
}

/** Only a metadata-free bundle of independently valid operations is orderable.
 * AI selects the missing order; program copies exact authored payloads. */
function initialRepairOrderableOperations(value: unknown): string[] {
  if (!isRecord(value)) return [];
  const keys = Object.keys(value);
  if (keys.length < 2 || keys.length > 8 || keys.some(key => COMPACT_EFFECT_META_KEY_SET.has(key))) return [];
  return keys.every(key => compileCompactEffectList({ [key]: value[key] }).ok) ? keys : [];
}

function initialStatusRepairHasEventFilterEnvelope(value: unknown): boolean {
  const items = Array.isArray(value) ? value : [value];
  return items.some(item => isRecord(item)
    && ['on', 'scope', 'ordinal', 'n', 'event', 'phase', 'reason', 'source_kind', 'source_id',
      'damage_type', 'card_type', 'template_id', 'card_instance_id', 'actor_id', 'target_id']
      .some(key => Object.hasOwn(item, key))
    && !compileCompactEffectList(item).ok);
}

function assertInitialRepairSlotValue(slot: TowerInitialRepairSlotTarget, value: unknown, label: string): void {
  if (slot.kind === 'effect_order_strategy') {
    const keys = initialRepairOrderableOperations(slot.original);
    if (!keys.length || !Array.isArray(value) || value.length !== keys.length
      || new Set(value).size !== keys.length || value.some(key => typeof key !== 'string' || !keys.includes(key))
      || towerInitialStateKey(slot.operationNames) !== towerInitialStateKey(keys)) {
      throw new Error(`${label} 必须仅给出全部原操作的唯一执行顺序，不得改动、遗漏或重复操作`);
    }
    return;
  }
  if (['status_trigger_effect_item', 'status_trigger_effect_sequence'].includes(slot.kind)
    && initialStatusRepairHasEventFilterEnvelope(slot.original)) {
    throw new Error(`${label} 含原有事件筛选语义；通用效果槽不能迁移其持有者、事件与次数限制，禁止删掉筛选后接受裸效果`);
  }
  if (slot.kind === 'literal_effect_sequence') {
    if (!Array.isArray(value)) throw new Error(`${label} 必须是完整的有限字面效果数组`);
    assertAuthoredLiteralEffectRepair(slot.original, value);
    return;
  }
  const originalItem = isRecord(slot.original) ? slot.original
    : Array.isArray(slot.original) && slot.original.length === 1 && isRecord(slot.original[0]) ? slot.original[0] : null;
  // Whitespace on a metadata key is a field error, not a second mechanic.
  // Legal numeric/status bundles are also outside this mixed-operation guard.
  const originalOperations = originalItem
    ? Object.keys(originalItem).filter(key => !COMPACT_EFFECT_META_KEY_SET.has(key.trim())) : [];
  if (originalItem && ['effect_item', 'effect_sequence', 'status_trigger_effect_item', 'status_trigger_effect_sequence'].includes(slot.kind)
    && originalOperations.length > 1
    && originalOperations.some(key => !COMPACT_EFFECT_BUNDLE_OPERATION_SET.has(key))) {
    // Legacy generic slots must not solve an illegal bundle by deleting one
    // of its mechanics either. A dedicated semantic strategy, or an exact
    // operation-preserving sequence, is needed; unsupported cases stay failed.
    assertInitialRepairSlotValue({ ...slot, kind: 'effect_item_sequence', original: originalItem },
      Array.isArray(value) ? value : [value], label);
  }
  if (slot.kind === 'effect_item_sequence') {
    if (!isRecord(slot.original) || !Array.isArray(value) || !value.length || value.length > 32)
      throw new Error(`${label} 必须是保留原操作的有限效果数组`);
    const original = slot.original;
    const operations = Object.keys(original).filter(key => !COMPACT_EFFECT_META_KEY_SET.has(key));
    if (operations.length < 2 || operations.some(key => !INITIAL_SIMPLE_REPAIR_EFFECT_KEYS.has(key))
      || value.length !== operations.length) throw new Error(`${label} 不得删除或新增原主操作`);
    value.forEach((entry, index) => assertInitialSimpleRepairEffect(entry, `${label}[${index}]`));
    for (const operation of operations) {
      const matches = value.filter(entry => Object.hasOwn(entry, operation));
      if (matches.length !== 1 || towerInitialStateKey(matches[0][operation]) !== towerInitialStateKey(original[operation]))
        throw new Error(`${label} 必须保留主操作 ${operation} 的原值与定义引用`);
    }
    for (const entry of value) {
      if (towerInitialStateKey(entry.when) !== towerInitialStateKey(original.when))
        throw new Error(`${label} 必须保留原条件，不能移除或发明 when`);
      for (const key of Object.keys(entry).filter(key => !operations.includes(key) && !['to', 'targets', 'when'].includes(key))) {
        if (!Object.hasOwn(original, key) || towerInitialStateKey(entry[key]) !== towerInitialStateKey(original[key]))
          throw new Error(`${label} 不得新增或修改原参数 ${key}`);
      }
    }
    // Shared targets may be ambiguous in an illegal bundle; the AI chooses
    // per-operation targets and order. Other authored parameters cannot vanish.
    for (const key of Object.keys(original).filter(key => COMPACT_EFFECT_META_KEY_SET.has(key)
      && !['to', 'targets', 'when'].includes(key))) {
      if (!value.some(entry => towerInitialStateKey(entry[key]) === towerInitialStateKey(original[key])))
        throw new Error(`${label} 不得丢失原参数 ${key}`);
    }
    return;
  }
  if (
    slot.kind === 'effect_item'
    || slot.kind === 'status_trigger_effect_item'
    || slot.kind === 'unknown_effect_item_strategy'
  ) {
    assertInitialSimpleRepairEffect(value, label);
    return;
  }
  if (slot.kind === 'effect_sequence' || slot.kind === 'status_trigger_effect_sequence') {
    if (!Array.isArray(value) || value.length === 0 || value.length > 32) throw new Error(`${label} 必须是非空有限效果数组`);
    value.forEach((entry, index) => assertInitialSimpleRepairEffect(entry, `${label}[${index}]`));
    return;
  }
  if (slot.kind === 'passive_effect_sequence' || slot.kind === 'status_hold_sequence') {
    if (!Array.isArray(value) || value.length === 0 || value.length > 16) throw new Error(`${label} 必须是非空持续效果数组`);
    value.forEach((entry, index) => {
      if (!isRecord(entry)) throw new Error(`${label}[${index}] 必须是效果对象`);
      const primary = ['modify', 'card_rule'].filter(key => Object.hasOwn(entry, key));
      if (primary.length !== 1) throw new Error(`${label}[${index}] 只允许一个 modify/card_rule`);
      if (Object.keys(entry).some(key => ['on', 'ordinal', 'n', 'event', 'phase', 'reason', 'source_kind', 'source_id'].includes(key))) {
        throw new Error(`${label}[${index}] 含事件触发字段`);
      }
      const compiled = compileCompactEffectList(entry);
      if (!compiled.ok) {
        const detail = compiled.issues.slice(0, 4).map(issue => `${issue.path}: ${issue.message}`).join('；');
        throw new Error(`${label}[${index}] 未通过权威 effects 校验：${detail}`);
      }
      const policy = validateEffectProgramPolicy(compiled.value, {
        triggerPolicy: 'forbid',
        modifierPolicy: 'only',
        allowStatusStacks: slot.kind === 'status_hold_sequence',
      });
      if (!policy.ok) {
        const detail = policy.issues.slice(0, 4).map(issue => `${issue.path}: ${issue.message}`).join('；');
        throw new Error(`${label}[${index}] 不是合法持续规则：${detail}`);
      }
    });
    return;
  }
  if (slot.kind === 'status_hold_effect_item') {
    assertInitialRepairSlotValue({ ...slot, kind: 'status_hold_sequence' }, [value], label);
    return;
  }
  if (slot.kind === 'trigger_mode_strategy') {
    if (!isRecord(value) || !['event', 'passive'].includes(String(value.mode || '')) || !Array.isArray(value.effects)) {
      throw new Error(`${label} 必须是合法 trigger 模式策略并包含效果数组`);
    }
    if (value.mode === 'event' && (!ABILITY_TRIGGERS.includes(value.on as any) || value.on === 'passive')) {
      throw new Error(`${label}.on 必须是合法事件 trigger`);
    }
    if (value.mode === 'passive' && Object.hasOwn(value, 'on')) throw new Error(`${label} passive 策略不得返回 on`);
    const nested: TowerInitialRepairSlotTarget = {
      ...slot,
      kind: value.mode === 'passive' ? 'passive_effect_sequence' : 'effect_sequence',
    };
    assertInitialRepairSlotValue(nested, value.effects, `${label}.effects`);
    return;
  }
  if (slot.kind === 'trigger_on') {
    if (typeof value !== 'string' || !ABILITY_TRIGGERS.includes(value as any)) throw new Error(`${label} 不是公开 trigger.on`);
    return;
  }
  if (slot.kind === 'condition') {
    // Check syntax here; the final carrier validation owns local contexts such
    // as status stacks. A generic root policy would reject valid status repairs.
    if (typeof value !== 'string' || !value.trim() || !compileCompactEffectList({ damage: 1, when: value }).ok)
      throw new Error(`${label} 必须保留合法布尔条件，不能返回 null 或删除原限制`);
    return;
  }
  if (slot.kind === 'lust_condition') {
    if (!initialRepairConditionIsValid(value)) throw new Error(`${label} 必须保留为合法布尔公式，不能删除或用自然语言替代条件`);
    return;
  }
  if (slot.kind === 'first_card_event_condition') {
    if (typeof value !== 'string' || !slot.allowedModes?.includes(value) || !initialRepairConditionIsValid(value))
      throw new Error(`${label} 必须兑现原首次该类牌条件，不能删除或保留错误计数`);
    return;
  }
  if (slot.kind === 'description') {
    if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} 必须是非空说明`);
    return;
  }
  if (slot.kind === 'card_type') {
    if (value !== 'Attack' && value !== 'Skill') throw new Error(`${label} 必须是 Attack 或 Skill`);
    return;
  }
  if (slot.kind === 'status_type') {
    if (!['buff', 'debuff', 'neutral'].includes(String(value))) throw new Error(`${label} 不是合法状态 type`);
    return;
  }
  if (slot.kind === 'status_tick_timing') {
    if (value !== null && value !== 'before_action' && value !== 'after_action') throw new Error(`${label} 不是合法 tick_timing`);
    return;
  }
  if (slot.kind === 'status_stacks_change') {
    if (!(typeof value === 'number' && Number.isFinite(value))
      && !['keep', 'reset'].includes(String(value))
      && !(typeof value === 'string' && /^x(?:\d+(?:\.\d+)?|\.\d+)$/.test(value))) {
      throw new Error(`${label} 不是合法 stacks_change`);
    }
    return;
  }
  if (slot.kind === 'status_max_stacks') {
    if (value !== null && (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 999)) {
      throw new Error(`${label} 不是合法 maxStacks`);
    }
    return;
  }
  if (slot.kind === 'status_defense') {
    if (value !== null && !normalizeStatusDefenseRule(value)) throw new Error(`${label} 不是合法状态防御规则`);
    return;
  }
  if (slot.kind === 'status_protection') {
    if (value !== null && !normalizeDamageProtectionRule(value)) throw new Error(`${label} 不是合法保护规则`);
    return;
  }
  if (slot.kind === 'status_character_emoji') {
    if (value !== null && (typeof value !== 'string' || !value.trim() || [...value].length > 32)) throw new Error(`${label} 不是合法人物外观`);
    return;
  }
  if (slot.kind === 'status_stun') {
    if (value !== null && typeof value !== 'boolean') throw new Error(`${label} 不是合法 stun`);
    return;
  }
  if (slot.kind === 'discard_strategy') {
    if (!isRecord(value) || !['discard_all', 'discard_selected'].includes(String(value.mode || ''))) {
      throw new Error(`${label} 不是有效弃牌策略`);
    }
    if (value.mode === 'discard_selected' && (!Number.isInteger(value.count) || Number(value.count) < 1)) {
      throw new Error(`${label} 缺少正整数 count`);
    }
    return;
  }
  if (slot.kind === 'card_copy_strategy') {
    if (!isRecord(value) || value.mode !== 'copy_at_original_cost' || Object.keys(value).some(key => key !== 'mode')) {
      throw new Error(`${label} 不是有效复制策略`);
    }
    return;
  }
  if (slot.kind === 'summon_lifecycle_default') {
    if (
      slot.original !== 'default'
      || !isRecord(value)
      || value.mode !== 'use_runtime_default'
      || Object.keys(value).some(key => key !== 'mode')
    ) {
      throw new Error(`${label} 不是有效的召唤运行时默认生命周期策略`);
    }
    return;
  }
  if (slot.kind === 'resource_payment_strategy') {
    if (!isRecord(value) || !slot.preserveId) throw new Error(`${label} 不是有效的资源支付策略`);
    if (value.mode === 'pay_resource') {
      const amountValid = value.amount === 'all'
        || (Number.isInteger(value.amount) && Number(value.amount) >= 1 && Number(value.amount) <= 999);
      if (
        value.resource_id !== slot.preserveId
        || !amountValid
        || Object.keys(value).some(key => !['mode', 'resource_id', 'amount'].includes(key))
      ) throw new Error(`${label} 不是程序锁定资源 ID 的支付策略`);
      if (
        value.amount !== 'all'
        && isRecord(slot.original)
        && isRecord(slot.original.formulas)
        && Object.values(slot.original.formulas).some(formula => (
          typeof formula === 'string' && formula.includes(`x_resource.${slot.preserveId}`)
        ))
      ) throw new Error(`${label} 使用 x_resource 时必须选择支付全部资源`);
      return;
    }
    if (value.mode !== 'read_current_resource' || Object.keys(value).some(key => key !== 'mode')) {
      throw new Error(`${label} 不是有效的当前资源读取策略`);
    }
    return;
  }
  if (slot.kind === 'status_next_attack_modifier_strategy') {
    if (
      !isRecord(value)
      || value.mode !== 'hold_until_next_attack'
      || Object.keys(value).some(key => key !== 'mode')
      || !slot.preserveId
      || !slot.statusHoldPath
      || !initialRepairStatusHoldModifier(slot.original)
    ) throw new Error(`${label} 不是有效的下一次攻击持续修饰策略`);
    return;
  }
  if (slot.kind === 'card_quantity_strategy') {
    if (!isRecord(value) || !(slot.allowedModes || []).includes(String(value.mode || ''))) {
      throw new Error(`${label} 不是有效的持有卡数量策略`);
    }
    if (value.mode === 'set_owned_quantity') {
      if (
        !Number.isInteger(value.quantity)
        || Number(value.quantity) < 1
        || Number(value.quantity) > 100
        || Object.keys(value).some(key => !['mode', 'quantity'].includes(key))
      ) throw new Error(`${label} 必须设置 1 到 100 的整数 quantity`);
      return;
    }
    if (value.mode !== 'remove_unowned_card' || Object.keys(value).some(key => key !== 'mode')) {
      throw new Error(`${label} 不是有效的移除未持有卡策略`);
    }
    return;
  }
  if (slot.kind === 'skill_trigger_classification_strategy') {
    if (!isRecord(value) || value.mode !== 'promote_to_power' || Object.keys(value).some(key => key !== 'mode')) {
      throw new Error(`${label} 不是有效的 Skill 持续触发分类策略`);
    }
    return;
  }
  if (slot.kind === 'condition_alias_strategy') {
    if (
      !isRecord(value)
      || !(slot.allowedModes || []).includes(String(value.mode || ''))
      || Object.keys(value).some(key => key !== 'mode')
    ) throw new Error(`${label} 不是程序验证过的条件别名策略`);
    return;
  }
  if (slot.kind === 'add_card_destination') {
    if (!['hand', 'deck', 'discard'].includes(String(value))) throw new Error(`${label} 不是合法 add_card 目标牌区`);
  }
}

export function parseTowerInitialSlotRepairResponse(
  value: string | Record<string, any>,
  targets: readonly TowerInitialRepairSlotRootTarget[],
): TowerInitialSlotRepairResponse {
  if (targets.some(root => root.allowSupportStatuses && !(root.supportStatusIds?.length))) {
    throw new Error('槽位修复缺少程序锁定的状态 ID');
  }
  if (targets.some(root => root.allowSupportResources && !(root.supportResourceIds?.length))) {
    throw new Error('槽位修复缺少程序锁定的资源 ID');
  }
  const parsed = parseStructuredRecord(value);
  const allowedTop = new Set(['spec', 'roots', 'support_statuses', 'support_resources']);
  const extraTop = Object.keys(parsed).filter(key => !allowedTop.has(key));
  if (extraTop.length > 0) throw new Error(`槽位修复返回了未请求的顶层字段：${extraTop.join(', ')}`);
  if (parsed.spec !== TOWER_INITIAL_SLOT_REPAIR_SPEC) throw new Error('槽位修复 spec 不匹配');
  if (!isRecord(parsed.roots)) throw new Error('槽位修复缺少 roots');
  const expectedRoots = new Set(targets.map(target => target.token));
  const missingRoots = targets.filter(target => !Object.hasOwn(parsed.roots, target.token)).map(target => target.token);
  const extraRoots = Object.keys(parsed.roots).filter(token => !expectedRoots.has(token));
  if (missingRoots.length > 0) throw new Error(`槽位修复漏掉必需根：${missingRoots.join(', ')}`);
  if (extraRoots.length > 0) throw new Error(`槽位修复返回未请求根：${extraRoots.join(', ')}`);
  for (const root of targets) {
    const payload = parsed.roots[root.token];
    if (!isRecord(payload) || Object.keys(payload).some(key => key !== 'slots') || !isRecord(payload.slots)) {
      throw new Error(`槽位修复根 ${root.token} 必须只包含 slots`);
    }
    const expectedSlots = new Set(root.slots.map(slot => slot.token));
    const missingSlots = root.slots.filter(slot => !Object.hasOwn(payload.slots, slot.token)).map(slot => slot.token);
    const extraSlots = Object.keys(payload.slots).filter(token => !expectedSlots.has(token));
    if (missingSlots.length > 0) throw new Error(`槽位修复根 ${root.token} 漏掉必需槽：${missingSlots.join(', ')}`);
    if (extraSlots.length > 0) throw new Error(`槽位修复根 ${root.token} 返回未请求槽：${extraSlots.join(', ')}`);
    for (const slot of root.slots) {
      const repair = payload.slots[slot.token];
      if (!isRecord(repair) || repair.action !== slot.action) {
        throw new Error(`槽位修复 ${root.token}.${slot.token} action 不匹配`);
      }
      const allowed = slot.action === 'remove_invalid_field' ? new Set(['action']) : new Set(['action', 'value']);
      const extra = Object.keys(repair).filter(key => !allowed.has(key));
      if (extra.length > 0) throw new Error(`槽位修复 ${root.token}.${slot.token} 返回未请求字段：${extra.join(', ')}`);
      if (slot.action !== 'remove_invalid_field' && !Object.hasOwn(repair, 'value')) {
        throw new Error(`槽位修复 ${root.token}.${slot.token} 缺少 value`);
      }
      if (slot.action !== 'remove_invalid_field') {
        repair.value = canonicalizeInitialRepairSlotValue(slot, repair.value);
        assertInitialRepairSlotValue(slot, repair.value, `槽位修复 ${root.token}.${slot.token}`);
      }
    }
  }
  if (!Array.isArray(parsed.support_statuses) || parsed.support_statuses.some((entry: unknown) => !isRecord(entry))) {
    throw new Error('槽位修复 support_statuses 必须是对象数组');
  }
  if (!Array.isArray(parsed.support_resources) || parsed.support_resources.some((entry: unknown) => !isRecord(entry))) {
    throw new Error('槽位修复 support_resources 必须是对象数组');
  }
  if (parsed.support_statuses.length > 0 && !targets.some(root => root.allowSupportStatuses)) {
    throw new Error('槽位修复未请求 support_statuses');
  }
  if (parsed.support_resources.length > 0 && !targets.some(root => root.allowSupportResources)) {
    throw new Error('槽位修复未请求 support_resources');
  }
  const allowedStatusIds = new Set(targets.flatMap(root => root.supportStatusIds || []));
  const returnedStatusIds = parsed.support_statuses.map((entry: Record<string, any>) => String(entry.id || ''));
  const extraStatusIds = parsed.support_statuses
    .map((entry: Record<string, any>) => String(entry.id || ''))
    .filter((id: string) => allowedStatusIds.size > 0 && !allowedStatusIds.has(id));
  if (extraStatusIds.length > 0) throw new Error(`槽位修复返回未请求状态：${extraStatusIds.join(', ')}`);
  const missingStatusIds = [...allowedStatusIds].filter(id => !returnedStatusIds.includes(id));
  if (missingStatusIds.length > 0) throw new Error(`槽位修复漏掉必需状态定义：${missingStatusIds.join(', ')}`);
  if (new Set(returnedStatusIds).size !== returnedStatusIds.length) throw new Error('槽位修复返回了重复状态定义');
  parsed.support_statuses.forEach((entry: Record<string, any>, index: number) => {
    const issues = collectCompactStatusDefinitionIssues(entry);
    if (issues.length > 0) throw new Error(`槽位修复 support_statuses[${index}] 无效：${issues.slice(0, 6).join('；')}`);
  });
  const allowedResourceIds = new Set(targets.flatMap(root => root.supportResourceIds || []));
  const returnedResourceIds = parsed.support_resources.map((entry: Record<string, any>) => String(entry.id || ''));
  const extraResourceIds = parsed.support_resources
    .map((entry: Record<string, any>) => String(entry.id || ''))
    .filter((id: string) => allowedResourceIds.size > 0 && !allowedResourceIds.has(id));
  if (extraResourceIds.length > 0) throw new Error(`槽位修复返回未请求资源：${extraResourceIds.join(', ')}`);
  const missingResourceIds = [...allowedResourceIds].filter(id => !returnedResourceIds.includes(id));
  if (missingResourceIds.length > 0) throw new Error(`槽位修复漏掉必需资源定义：${missingResourceIds.join(', ')}`);
  const resourceIssues = validateCombatResourceDefinitions(parsed.support_resources, 'support_resources');
  if (resourceIssues.length > 0) {
    throw new Error(`槽位修复资源定义无效：${resourceIssues.slice(0, 6).map(issue => `${issue.path}: ${issue.message}`).join('；')}`);
  }
  return {
    roots: parsed.roots as TowerInitialSlotRepairResponse['roots'],
    supportStatuses: parsed.support_statuses,
    supportResources: parsed.support_resources,
  };
}

function compileInitialDiscardStrategy(original: unknown, strategy: unknown): unknown[] {
  if (!isRecord(strategy) || !['discard_all', 'discard_selected'].includes(String(strategy.mode || ''))) {
    throw new Error('弃牌语义槽返回了无效策略');
  }
  const effects = Array.isArray(original) ? clone(original) : [clone(original)];
  const index = effects.findIndex(entry => isRecord(entry) && Object.hasOwn(entry, 'discard'));
  if (index < 0 || !isRecord(effects[index])) throw new Error('弃牌语义槽找不到原始弃牌操作');
  const source = effects[index] as Record<string, any>;
  const selectionKeys = COMPACT_CARD_SELECTOR_FILTER_KEYS;
  const discard: Record<string, any> = {
    discard: strategy.mode === 'discard_all' ? 'all' : Number(strategy.count),
    from: typeof source.from === 'string' ? source.from : 'hand',
    pick: strategy.mode === 'discard_all' ? 'all' : 'choose',
  };
  selectionKeys.forEach(key => {
    if (source[key] !== undefined) discard[key] = clone(source[key]);
  });
  if (source.when !== undefined) discard.when = clone(source.when);
  const replacement: unknown[] = [discard];
  if (source.draw !== undefined) {
    replacement.push({ draw: clone(source.draw), ...(source.when === undefined ? {} : { when: clone(source.when) }) });
  }
  effects.splice(index, 1, ...replacement);
  return effects;
}

function compileInitialCardCopyStrategy(original: unknown, strategy: unknown): unknown[] {
  if (!isRecord(strategy) || strategy.mode !== 'copy_at_original_cost') {
    throw new Error('复制语义槽返回了无效策略');
  }
  if (!canCompileCardCopyStrategy(original)) throw new Error('复制语义槽只能用于唯一 copy 操作，不能用于 double');
  const effects = Array.isArray(original) ? clone(original) : [clone(original)];
  const index = effects.findIndex(entry => isRecord(entry) && Object.hasOwn(entry, 'copy'));
  if (index < 0 || !isRecord(effects[index])) throw new Error('复制语义槽找不到原始复制操作');
  const source = effects[index] as Record<string, any>;
  const operation = 'copy';
  const allowed = [
    operation, ...COMPACT_CARD_SELECTOR_INPUT_KEYS, 'when',
  ];
  const replacement: Record<string, any> = {};
  allowed.forEach(key => {
    if (source[key] !== undefined) replacement[key] = clone(source[key]);
  });
  if (operation === 'copy') replacement.to = 'hand';
  effects.splice(index, 1, replacement);
  return effects;
}

function compileInitialTriggerModeStrategy(original: unknown, strategy: unknown): Record<string, unknown> {
  if (!isRecord(original) || !isRecord(strategy) || !['event', 'passive'].includes(String(strategy.mode || ''))) {
    throw new Error('触发模式语义槽返回了无效策略');
  }
  if (strategy.mode === 'passive') {
    return { on: 'passive', effects: clone(strategy.effects) };
  }
  const preservedFilterKeys = [
    'scope', 'ordinal', 'n', 'event', 'phase', 'reason', 'source_kind', 'source_id', 'damage_type',
    'card_type', 'template_id', 'card_instance_id', 'actor_id', 'target_id',
  ];
  const result: Record<string, unknown> = { on: clone(strategy.on), effects: clone(strategy.effects) };
  preservedFilterKeys.forEach(key => {
    if (original[key] !== undefined) result[key] = clone(original[key]);
  });
  return result;
}

function applyInitialResourcePaymentStrategy(
  result: ReturnType<typeof unwrapTowerInitialContent>,
  slot: TowerInitialRepairSlotTarget,
  strategy: unknown,
): void {
  if (!isRecord(strategy) || !slot.preserveId || !slot.costPath) throw new Error('资源支付策略缺少锁定上下文');
  if (strategy.mode === 'pay_resource') {
    const originalCost = initialRepairValueAtPath(result, slot.costPath);
    const cost: Record<string, any> | null = isRecord(originalCost)
      ? { ...clone(originalCost) }
      : Number.isInteger(originalCost) && Number(originalCost) >= 0
        ? { energy: Number(originalCost) }
        : null;
    if (!cost) throw new Error('资源支付策略无法保留原卡费用');
    cost[slot.preserveId] = clone(strategy.amount);
    setInitialRepairValueAtPath(result, slot.costPath, cost);
    return;
  }
  if (strategy.mode !== 'read_current_resource') throw new Error('未知资源支付策略');
  const escapedId = slot.preserveId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const reference = new RegExp(`\\b(?:spent_resource|x_resource)\\.${escapedId}\\b`, 'g');
  for (const path of slot.resourceReferencePaths || []) {
    const formula = initialRepairValueAtPath(result, path);
    if (typeof formula !== 'string' || !reference.test(formula)) throw new Error(`资源支付策略锁定公式已变化：${path}`);
    reference.lastIndex = 0;
    setInitialRepairValueAtPath(result, path, formula.replace(reference, `self.resource.${slot.preserveId}.current`));
    reference.lastIndex = 0;
  }
}

function applyInitialStatusNextAttackModifierStrategy(
  result: ReturnType<typeof unwrapTowerInitialContent>,
  slot: TowerInitialRepairSlotTarget,
): void {
  if (!slot.preserveId || !slot.statusHoldPath) throw new Error('下一次攻击修饰策略缺少锁定上下文');
  if (initialRepairValueAtPath(result, slot.statusHoldPath) !== undefined) throw new Error('下一次攻击修饰策略不得覆盖已有 hold');
  const modifier = initialRepairStatusHoldModifier(slot.original);
  if (!modifier) throw new Error('下一次攻击修饰策略的原始 modifier 已变化');
  setInitialRepairValueAtPath(result, slot.path, { remove_status: slot.preserveId, to: 'self' });
  const triggerPath = slot.statusHoldPath.slice(0, -'.hold'.length);
  const triggers = initialRepairValueAtPath(result, triggerPath);
  if (!isRecord(triggers)) throw new Error('下一次攻击修饰策略找不到状态 triggers');
  triggers.hold = clone(modifier);
}

function applyInitialConditionAliasStrategy(
  result: ReturnType<typeof unwrapTowerInitialContent>,
  slot: TowerInitialRepairSlotTarget,
  strategy: unknown,
): void {
  if (!isRecord(strategy) || !slot.whenPath || !slot.whenConditionPath) throw new Error('条件别名策略缺少锁定上下文');
  const when = initialRepairValueAtPath(result, slot.whenPath);
  const alias = initialRepairValueAtPath(result, slot.whenConditionPath);
  if (strategy.mode === 'use_when') {
    if (!initialRepairConditionIsValid(when)) throw new Error('条件别名策略锁定的 when 已变化');
  } else if (strategy.mode === 'use_when_condition') {
    if (!initialRepairConditionIsValid(alias)) throw new Error('条件别名策略锁定的 when_condition 已变化');
    setInitialRepairValueAtPath(result, slot.whenPath, alias);
  } else if (strategy.mode === 'combine_and') {
    if (!initialRepairConditionIsValid(when) || !initialRepairConditionIsValid(alias)) {
      throw new Error('条件别名策略不能合并非法条件');
    }
    setInitialRepairValueAtPath(result, slot.whenPath, `(${when}) && (${alias})`);
  } else {
    throw new Error('未知条件别名策略');
  }
  deleteInitialRepairValueAtPath(result, slot.whenConditionPath);
}

function collectInitialRepairDiffPaths(before: unknown, after: unknown, path = ''): string[] {
  if (Object.is(before, after)) return [];
  if (Array.isArray(before) && Array.isArray(after)) {
    const paths: string[] = [];
    const length = Math.max(before.length, after.length);
    for (let index = 0; index < length; index += 1) {
      const child = `${path}[${index}]`;
      if (index >= before.length || index >= after.length) paths.push(child);
      else paths.push(...collectInitialRepairDiffPaths(before[index], after[index], child));
    }
    return paths;
  }
  if (isRecord(before) && isRecord(after)) {
    const paths: string[] = [];
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      const child = path ? `${path}.${key}` : key;
      if (!Object.hasOwn(before, key) || !Object.hasOwn(after, key)) paths.push(child);
      else paths.push(...collectInitialRepairDiffPaths(before[key], after[key], child));
    }
    return paths;
  }
  return [path || '$'];
}

function initialRepairDiffIsAllowed(path: string, allowed: readonly string[]): boolean {
  return allowed.some(prefix => path === prefix || path.startsWith(`${prefix}.`) || path.startsWith(`${prefix}[`));
}

/** Apply only pre-selected slots, then prove the structural diff stayed inside the write set. */
export function mergeTowerInitialSlotRepair(
  original: ReturnType<typeof unwrapTowerInitialContent>,
  targets: readonly TowerInitialRepairSlotRootTarget[],
  repair: TowerInitialSlotRepairResponse,
): ReturnType<typeof unwrapTowerInitialContent> {
  const result = clone(original);
  const allowedPaths: string[] = [];
  const pendingCardRemovals: Array<{ collectionPath: string; index: number; id: string }> = [];
  const splices: Array<{ collectionPath: string; index: number; original: unknown; replacement: unknown[] }> = [];
  const allSlots = targets.flatMap(root => root.slots);
  for (const slot of allSlots) {
    if (allSlots.some(other => other !== slot && (other.path === slot.path
      || other.path.startsWith(`${slot.path}.`) || other.path.startsWith(`${slot.path}[`)
      || slot.path.startsWith(`${other.path}.`) || slot.path.startsWith(`${other.path}[`))))
      throw new Error('修复槽与其他锁定槽重叠，已停止合并');
  }
  for (const root of targets) {
    const payload = repair.roots[root.token];
    for (const slot of root.slots) {
      const operation = payload.slots[slot.token];
      if (slot.kind === 'condition') assertInitialRepairSlotValue(slot, operation.value, `${root.token}.${slot.token}`);
      allowedPaths.push(slot.path);
      allowedPaths.push(...(slot.additionalWritePaths || []));
      if (slot.kind === 'literal_effect_sequence') {
        assertInitialRepairSlotValue(slot, operation.value, `${root.token}.${slot.token}`);
        const owner = initialRepairValueAtPath(result, slot.path.slice(0, -'.effects'.length));
        if (!isRecord(owner) || !isRecord(slot.original)
          || towerInitialStateKey({ description: owner.description, effects: owner.effects }) !== towerInitialStateKey(slot.original)) {
          throw new Error('字面效果修复的锁定说明或效果已变化');
        }
        setInitialRepairValueAtPath(result, slot.path, operation.value);
        continue;
      }
      if (slot.kind === 'effect_item_sequence' || slot.kind === 'effect_order_strategy') {
        assertInitialRepairSlotValue(slot, operation.value, `${root.token}.${slot.token}`);
        const replacement = slot.kind === 'effect_order_strategy'
          ? (operation.value as string[]).map(key => ({ [key]: clone((slot.original as Record<string, unknown>)[key]) }))
          : operation.value;
        const match = slot.path.match(/^(.*)\[(\d+)\]$/);
        if (towerInitialStateKey(initialRepairValueAtPath(result, slot.path)) !== towerInitialStateKey(slot.original))
          throw new Error('效果序列修复的原始锁定项已变化');
        if (!match) {
          // A single object-valued effects field has no array siblings to
          // shift. Its exact field remains the only allowed replacement path.
          setInitialRepairValueAtPath(result, slot.path, replacement);
          continue;
        }
        splices.push({ collectionPath: match[1], index: Number(match[2]), original: clone(slot.original),
          replacement: clone(replacement as unknown[]) });
        continue;
      }
      if (slot.kind === 'resource_payment_strategy') {
        applyInitialResourcePaymentStrategy(result, slot, operation.value);
        continue;
      }
      if (slot.kind === 'status_next_attack_modifier_strategy') {
        applyInitialStatusNextAttackModifierStrategy(result, slot);
        continue;
      }
      if (slot.kind === 'condition_alias_strategy') {
        applyInitialConditionAliasStrategy(result, slot, operation.value);
        continue;
      }
      if (slot.kind === 'card_quantity_strategy') {
        if (!isRecord(operation.value) || !slot.cardCollectionPath || slot.cardIndex === undefined || !slot.preserveId) {
          throw new Error('持有卡数量策略缺少锁定上下文');
        }
        const cardPath = `${slot.cardCollectionPath}[${slot.cardIndex}]`;
        const card = initialRepairValueAtPath(result, cardPath);
        if (!isRecord(card) || card.id !== slot.preserveId) throw new Error('持有卡数量策略锁定卡牌已变化');
        if (operation.value.mode === 'remove_unowned_card') {
          pendingCardRemovals.push({ collectionPath: slot.cardCollectionPath, index: slot.cardIndex, id: slot.preserveId });
          allowedPaths.push(slot.cardCollectionPath);
        } else {
          setInitialRepairValueAtPath(result, slot.path, operation.value.quantity);
        }
        continue;
      }
      if (slot.kind === 'summon_lifecycle_default') {
        deleteInitialRepairValueAtPath(result, slot.path);
        continue;
      }
      if (slot.action === 'remove_invalid_field') {
        deleteInitialRepairValueAtPath(result, slot.path);
        continue;
      }
      if (
        (slot.kind === 'status_max_stacks' || slot.kind === 'status_stun' || slot.kind === 'status_character_emoji' || slot.kind === 'status_protection' || slot.kind === 'status_defense' || slot.kind === 'status_tick_timing')
        && operation.value === null
      ) {
        deleteInitialRepairValueAtPath(result, slot.path);
        continue;
      }
      const replacement = slot.kind === 'discard_strategy'
        ? compileInitialDiscardStrategy(slot.original, operation.value)
        : slot.kind === 'card_copy_strategy'
          ? compileInitialCardCopyStrategy(slot.original, operation.value)
          : slot.kind === 'trigger_mode_strategy'
            ? compileInitialTriggerModeStrategy(slot.original, operation.value)
            : slot.kind === 'skill_trigger_classification_strategy'
              ? 'Power'
            : operation.value;
      setInitialRepairValueAtPath(result, slot.path, replacement);
    }
  }
  if (splices.length && pendingCardRemovals.length) throw new Error('不能在同次修复中同时展开效果项并移除卡牌');
  // Descending indices keep every slot bound to its original sibling. We later
  // undo only these exact splices in an audit copy to check the remaining diff;
  // the whole effects array is never added to the permitted write set.
  splices.sort((left, right) => right.index - left.index).forEach(splice => {
    const effects = initialRepairValueAtPath(result, splice.collectionPath);
    if (!Array.isArray(effects) || towerInitialStateKey(effects[splice.index]) !== towerInitialStateKey(splice.original))
      throw new Error('展开效果项时锁定数组已变化');
    effects.splice(splice.index, 1, ...clone(splice.replacement));
  });
  pendingCardRemovals
    .sort((left, right) => right.index - left.index)
    .forEach(({ collectionPath, index, id }) => {
      const cards = initialRepairValueAtPath(result, collectionPath);
      if (!Array.isArray(cards) || !isRecord(cards[index]) || cards[index].id !== id) {
        throw new Error('移除未持有卡时锁定牌组已变化');
      }
      cards.splice(index, 1);
    });
  if (pendingCardRemovals.length > 0) {
    const cards = isRecord(result.player) && Array.isArray(result.player.cards) ? result.player.cards : [];
    if (!cards.some(card => isRecord(card) && Number.isInteger(card.quantity) && Number(card.quantity) >= 1)) {
      throw new Error('移除未持有卡后牌组不再可执行');
    }
  }
  const acceptedPlayerRoots = targets
    .filter(root => root.path === 'player' || root.path.startsWith('player.'))
    .map(root => initialRepairValueAtPath(result, root.path));
  const acceptedResourceRoots = targets
    .map(root => initialRepairValueAtPath(result, root.path));
  if (isRecord(result.player)) {
    if (repair.supportStatuses.length > 0) {
      const statuses = Array.isArray(result.player.statuses) ? result.player.statuses : [];
      result.player.statuses = appendReferencedRepairStatusClosure(statuses, repair.supportStatuses, acceptedPlayerRoots);
      allowedPaths.push('player.statuses');
    }
    if (repair.supportResources.length > 0) {
      const core = isRecord(result.player.core) ? result.player.core : {};
      const resources = Array.isArray(core.resources) ? core.resources : [];
      core.resources = appendReferencedRepairResources(resources, repair.supportResources, acceptedResourceRoots);
      result.player.core = core;
      allowedPaths.push('player.core.resources');
    }
  }
  const audit = clone(result);
  [...splices].sort((left, right) => left.index - right.index).forEach(splice => {
    const effects = initialRepairValueAtPath(audit, splice.collectionPath);
    if (!Array.isArray(effects)
      || towerInitialStateKey(effects.slice(splice.index, splice.index + splice.replacement.length)) !== towerInitialStateKey(splice.replacement))
      throw new Error('效果序列修复无法核对精确写集');
    effects.splice(splice.index, splice.replacement.length, clone(splice.original));
  });
  const escaped = collectInitialRepairDiffPaths(original, audit)
    .filter(path => !initialRepairDiffIsAllowed(path, allowedPaths));
  if (escaped.length > 0) {
    throw new Error(`槽位修复越过程序锁定写集：${escaped.slice(0, 8).join(', ')}`);
  }
  return result;
}

/**
 * A bounded structure repair may only replace the top-level branches named by
 * the previous validation report. This is especially important for opening
 * gifts: repairing one card effect must not turn an already valid gift into a
 * new unsupported `max_energy` (or any other) outcome.
 */
export function preserveUnreportedTowerInitialContent(
  original: ReturnType<typeof unwrapTowerInitialContent>,
  repaired: ReturnType<typeof unwrapTowerInitialContent>,
  validationError: unknown,
): ReturnType<typeof unwrapTowerInitialContent> {
  const detail = validationError instanceof Error
    ? validationError.message
    : String(validationError || '');
  const result = clone(repaired);
  const narrativeWasReported = /(?:初始化结果缺少玩家可读的引导剧情|\bnarrative\b)/i.test(detail);
  const openingWasReported = /(?:初始化结果缺少启程馈赠|(?:^|[；;\n])\s*opening(?:\.|：|:)|opening\.choices)/i.test(detail);
  const playerWasReported = /(?:初始化结果缺少可执行 player\.cards|(?:^|[；;\n])\s*(?:battle|player)(?:\.|：|:)|初始牌组|卡组数据)/i.test(detail);

  if (!narrativeWasReported) result.narrative = original.narrative;
  if (!openingWasReported) {
    result.opening = clone(original.opening);
  } else if (
    isRecord(original.opening) && isRecord(repaired.opening)
    && Array.isArray(original.opening.choices) && Array.isArray(repaired.opening.choices)
    && !/opening\.choices[^；;\n]*需要恰好\s*3\s*项/i.test(detail)
  ) {
    const originalChoices = original.opening.choices;
    const repairedChoices = repaired.opening.choices;
    const affected = new Set(
      [...detail.matchAll(/opening\.choices\[(\d+)\]/gi)]
        .map(match => Number(match[1]))
        .filter(Number.isInteger),
    );
    originalChoices.forEach((choice, index) => {
      const id = isRecord(choice) ? String(choice.id || '') : '';
      if (id && detail.includes(id)) affected.add(index);
    });
    if (affected.size > 0) {
      const repairedById = new Map(repairedChoices
        .filter(isRecord)
        .map(choice => [String(choice.id || ''), choice]));
      const choices = originalChoices.map((choice, index) => {
        if (!affected.has(index)) return clone(choice);
        const id = isRecord(choice) ? String(choice.id || '') : '';
        return clone((id && repairedById.get(id)) || repairedChoices[index] || choice);
      });
      result.opening = { ...clone(original.opening), choices };
    }
  }
  if (!playerWasReported) {
    result.player = clone(original.player);
    result.status = clone(original.status);
  } else if (isRecord(original.player) && isRecord(repaired.player)) {
    const originalPlayer = original.player;
    const repairedPlayer = repaired.player;
    const mergedPlayer = clone(originalPlayer);
    const acceptedRepairRoots: unknown[] = [];
    const fieldWasReported = (field: string): boolean => (
      new RegExp(`(?:battle|player)\\.${field}(?:\\[|\\.|[：:；;\\n]|$)`, 'i').test(detail)
    );
    const reportedIndexes = (field: string): number[] => (
      [...detail.matchAll(new RegExp(`(?:battle|player)\\.${field}\\[(\\d+)\\]`, 'gi'))]
        .map(match => Number(match[1]))
        .filter(Number.isInteger)
    );
    const mergeReportedCollection = (field: string): void => {
      const before = Array.isArray(originalPlayer[field]) ? originalPlayer[field] : [];
      const after = Array.isArray(repairedPlayer[field]) ? repairedPlayer[field] : [];
      if (!fieldWasReported(field)) {
        mergedPlayer[field] = clone(before);
        return;
      }
      const indexes = reportedIndexes(field);
      if (indexes.length === 0) {
        mergedPlayer[field] = clone(after);
        acceptedRepairRoots.push(...after);
        return;
      }
      const affected = new Set(indexes);
      const repairedById = new Map(after
        .filter(isRecord)
        .map(entry => [String(entry.id || ''), entry]));
      const merged: unknown[] = [];
      before.forEach((entry, index) => {
        if (!affected.has(index)) {
          merged.push(clone(entry));
          return;
        }
        const id = isRecord(entry) ? String(entry.id || '') : '';
        const replacement = (id && repairedById.get(id)) || after[index];
        if (replacement !== undefined) {
          merged.push(clone(replacement));
          acceptedRepairRoots.push(replacement);
        }
      });
      mergedPlayer[field] = merged;
    };

    for (const field of ['cards', 'artifacts', 'items', 'player_abilities', 'player_status_effects']) {
      mergeReportedCollection(field);
    }
    const originalStatuses = Array.isArray(originalPlayer.statuses) ? originalPlayer.statuses : [];
    const repairedStatuses = Array.isArray(repairedPlayer.statuses) ? repairedPlayer.statuses : [];
    let preservedStatuses = clone(originalStatuses);
    if (fieldWasReported('statuses')) {
      const indexes = reportedIndexes('statuses');
      const affected = indexes.length > 0
        ? new Set(indexes)
        : new Set(originalStatuses.map((_, index) => index));
      const repairedById = new Map(repairedStatuses
        .filter(isRecord)
        .map(entry => [String(entry.id || ''), entry]));
      preservedStatuses = [];
      originalStatuses.forEach((entry, index) => {
        if (!affected.has(index)) {
          preservedStatuses.push(clone(entry));
          return;
        }
        const id = isRecord(entry) ? String(entry.id || '') : '';
        const replacement = (id && repairedById.get(id)) || repairedStatuses[index];
        if (replacement !== undefined) {
          preservedStatuses.push(clone(replacement));
          acceptedRepairRoots.push(replacement);
        }
      });
    }
    for (const field of ['core', 'player_lust_effect', 'level', 'exp']) {
      if (fieldWasReported(field)) {
        if (repairedPlayer[field] === undefined) delete mergedPlayer[field];
        else {
          mergedPlayer[field] = clone(repairedPlayer[field]);
          if (field === 'player_lust_effect') acceptedRepairRoots.push(repairedPlayer[field]);
        }
      }
    }
    // A repaired card/ability/lust effect may require new status support.
    // Preserve every pre-existing definition, then add only the transitive
    // closure reachable from the repaired branches we actually accepted.
    mergedPlayer.statuses = appendReferencedRepairStatusClosure(
      preservedStatuses,
      repairedStatuses,
      acceptedRepairRoots,
    );
    result.player = mergedPlayer;
    if (!/(?:^|[；;\n])\s*(?:player\.)?status(?:\.|[：:]|$)/i.test(detail)) {
      result.status = clone(original.status);
    }
  }
  return result;
}

function sanitizeTowerStartConfig(value: unknown): Record<string, string> {
  if (!isRecord(value)) return { mode: 'tower' };
  const result: Record<string, string> = { mode: 'tower' };
  for (const key of [
    'name',
    'customDescription',
    'world',
    'profession',
    'opening',
    'card',
    'towerRequirements',
    'selectedMechanics',
  ]) {
    const text = typeof value[key] === 'string' ? value[key].trim() : '';
    if (text) result[key] = text;
  }
  return result;
}

function towerSingleFloorInitialContentPrompt(input: {
  startPrompt: string;
  config: Record<string, string>;
  currentStat: Record<string, any>;
  designGuidance?: string | null;
  validationError?: string;
  rejectedCandidate?: string;
}): string {
  const current = {
    game_mode: input.currentStat.game_mode,
    tower_requirements: input.currentStat.tower_requirements,
    status: input.currentStat.status,
  };
  return [
    '[爬塔模式单层初始化数据]',
    '你是魔法少女世界爬塔模式的单次开局生成器。本次请求同时建立引导剧情、启程馈赠、玩家信息与初始牌组；不要生成敌人或开场战斗。',
    '下面提供的是完成本次内容所需的完整玩法、生成方法与 DSL 契约，不是关键词提示。必须逐项理解后再设计；不得因为请求较长而省略机制实现、只改描述，或自行改用另一套字段。',
    `START_REQUEST=${JSON.stringify(input.startPrompt)}`,
    `PLAYER_CONFIG=${JSON.stringify(input.config)}`,
    `CURRENT_START_STATE=${JSON.stringify(current)}`,
    input.designGuidance || '',
    '只返回 {"narrative":引导剧情,"player":玩家与卡组,"opening":馈赠事件}，不得返回 battle、敌人、地图或其他顶层键。',
    'narrative 承接玩家设定，说明角色为何进入必须不断前进并连续面对战斗与节点的境地，在可以接受馈赠的位置结束。它是玩家可读正文，不包含变量、系统说明或战斗结果。',
    towerDungeonPlanningPrompt(),
    '本模式将上述规划块和正文一起编码进 narrative 字符串（正确转义内部JSON），不要增加顶层字段；程序会拆出规划并仅向玩家展示正文。',
    'player.status 只保留 time、location、profession；profession 含 name 与 ability。player 还包含 core、cards、artifacts、items、statuses、player_abilities、player_status_effects、player_lust_effect、level、exp。player.cards/artifacts/items 是初始化后已经持有的内容，不能像奖励候选一样携带 status/statuses 外壳；它们以及 player_abilities/player_lust_effect 引用的所有完整状态定义统一放入 player.statuses。不要生成 NPC、势力、倾向、关系或普通剧情背包。',
    'opening 包含 title、narrative、choices；choices 必须恰好生成三项彼此独立的馈赠，不能缩成一项，也不能把三种选择合并到一个 choice。每项含唯一 id、label、可选 description 与 outcome。outcome 是开局节点的一次性持久结算，只可使用 hp、max_hp、lust、max_lust、gold、card_removals、reward、deck_transforms；其中 lust 是玩家当前欲望的相对变化，会限制在 0 与 max_lust 之间。它不是战斗 effects，绝不能直接写 block、energy、status 或 effects。战斗内收益必须做成 reward 中结构完整的卡牌、遗物或道具；reward 对象自身只含 cards、artifacts、items 数组，不写 description、name、effects、limits 或其他元数据，选项说明放在 choice.description，每个奖励内容自己的说明放在该内容的 description。馈赠可以无代价，也可以用合理代价换取更好收益。奖励与本次 player.cards 中已有非唯一卡完全相同时，仅写 {card_ref:"已有卡ID",quantity:份数}，复用完整定义；每份是独立持有实例。新卡、改进版、遗物和道具才使用新的稳定英文内容 ID，规则不同不能伪装成已有卡副本。已有状态仍直接引用 player.statuses 中已有状态 ID；某张奖励卡、遗物或道具确实引入一个或多个新状态时，在该具体候选内容同级写 statuses:[全部完整定义]。从候选效果的直接状态引用开始，沿定义内的引用继续展开，数组必须闭合且每项真实可达；领取时程序才会一次登记这些状态。不要把三个尚未选择的候选状态提前塞进全局状态表。',
    OPENING_TRANSFORM_GUIDANCE,
    'opening.reward 的候选没有引入并引用新状态时必须完全省略 statuses，绝不能为了字段齐全输出 status:null、statuses:null、空对象、空数组或未被引用的占位状态；旧单个 status 仅兼容读取，新输出统一使用 statuses。普通伤害、格挡、抽牌、资源和牌区卡不需要附带状态定义。',
    '每个 opening choice 都必须产生至少一项真实变化：至少一个允许的直接数值字段为非零，或 reward 中至少有一张完整卡牌、一个完整遗物或一个完整道具，或 deck_transforms 中有当前牌组可匹配的永久转化。不得输出全零直接字段加全空 reward，也不得在 label/description 承诺资源、状态、格挡、能量等收益却让 outcome 为空。若想给自定义战斗资源，必须把它做成可领取且能在战斗中执行该资源效果的卡牌、遗物或道具；outcome 不存在 resource/set_resource 字段。',
    '初始牌组必须至少包含一张真实持有的卡牌。player.cards 中每种完全相同的非唯一卡只定义一次，复用同一稳定英文 id、名称与完整规则，并以 unique:false 和 1-100 的整数 quantity 表达份数；每份是独立持有实例。quantity:0 表示玩家实际没有这张牌，绝不能作为候选、占位或未解锁条目输出。规则、费用或效果不同才必须使用新 id；unique:true 的牌只能 quantity:1。同一种卡的多份复制绝不能重复输出多个同 id 卡牌对象。卡牌种类、总 quantity、攻防恢复比例、是否具备传统胜利手段都属于自由设计，只作为后续评分建议，不作为结构报错。',
    '卡牌 type 只能是 Attack、Skill、Power、Event、Curse；rarity 只能是 Common、Uncommon、Rare、Epic、Legendary、Corrupt；Curse 省略 cost。其他卡 cost 可为非负整数、"energy"，或资源费用对象，例如 {energy:1,资源ID:2}；对象中的值只能是非负整数或 "all"，"all" 表示使用该资源的全部当前值。',
    '[高频硬约束]player.cards 中每项 quantity 必须是 1-100 整数；不想让玩家持有的牌必须整项省略，绝不能用 quantity:0 占位。rarity 绝不能写 Starter；只能写 hits，不能写 hit，且 hits 只能是字面正整数；状态操作只用 apply_status，绝无 add_status；spawn_summon/add_card/resource/modify_summon 等复杂操作各自独占一个 effects 数组项。状态持续规则只能写在状态 triggers.hold，状态根部绝不能另写 hold。普通召唤完全省略 slot/on_existing/on_defeated，不存在 on_destroyed；只有明确设计固定槽复活或替换机制时才写稳定 slot，并从公开 on_existing/on_defeated 枚举选择。trigger.on 不存在 summon_spawned；召唤能力监听主人攻击直接用 attack_played，绝不能写 owner_attack_played 或用 event.card_type 伪造筛选。卡牌根 trigger 只属于 Power；Attack/Skill/Event/Curse 绝不能写根 trigger。trigger 只能位于 Power/遗物/能力根部，绝不能嵌入 effects。modify/card_rule 持续规则只能位于 on:"passive" 的根 trigger 或状态 triggers.hold，绝不能放进普通卡根 effects 或 card_played/battle_start 等事件 trigger。只有立即 spawn_summon 等一次性根 effects、又没有持续状态或根 trigger 的卡必须是 Skill/Attack，不能是 Power。spent_resource.ID 仅当同一卡 cost 实际包含该 ID 时可用；所有状态与资源引用必须分别存在于 player.statuses 与 player.core.resources。牌区 from 只能是 hand/draw/discard/exhaust/all/combat，add_card 的 to 只能是 hand/deck/discard，top/bottom 是 pick 而绝不是 from/to。条件字段只有 when，绝无 when_condition；同一效果只能有一个 when。opening choice 的 status/statuses 不能放在 outcome 或 reward 容器；新状态定义只能放在 reward 内实际引用它的具体 card/artifact/item 候选对象同级。',
    formatCompactEffectAuthoringContract(),
    '输出前还要逐项扫描 player.cards 及所有 cards/artifacts/items/player_abilities/player_lust_effect 的 creates：每张临时牌模板的 rarity 也只能是 Common、Uncommon、Rare、Epic、Legendary、Corrupt，绝不能写 Special 或 Token；auto_play 是即时 effects 操作，绝不是 card_rule 的取值。',
    '逐项扫描所有直接 effects：draw/scry/seek 只操作玩家牌区，只写操作值与可选 when，绝不能附加 to、targets、from、pick、count 或 amount；敌人来源要干扰玩家牌区时也不加 opponent。逐项扫描所有 creates：只有 type:"Power" 的模板可以写根 trigger，Attack/Skill/Event/Curse 模板不写 trigger；模板绝不嵌套 creates，也不能通过 add_card/ensure_card 生成自己。',
    '逐项区分两种“选择”：choose/options 用于任意数量的预先定义效果分支，每项有唯一 id、非空 label 与非空 effects；count 省略为 1，写出时必须是 1 到 options 数量的整数，并按 options 书写顺序结算所选分支。从手牌或其他牌区选择卡牌时，必须在 discard/recover/modify_card/copy/double/auto_play 等真实操作同级写 pick:"choose"、from 与筛选条件，绝不能为选牌另造 options。',
    '若玩家明确指定流派，必须用真实 effects、trigger、状态、资源、牌区、召唤或选择机制形成“启动→运转→收益”；只有名称、emoji 和描述符合主题视为未实现。召唤流必须真实使用 spawn_summon 并让召唤物参与收益循环。',
    '若流派需要“临时状态在持有期间监听出牌、受伤、格挡或其他战斗事件”，必须使用完整契约中的状态事件键，直接写 triggers.attack_played/triggers.take_damage/triggers.gain_block 等非空浅层效果。禁止把 {on, effects} 塞进 triggers.hold；hold 只放持续 modify/card_rule。事件状态必须通过真实 apply_status 获得，并用 stacks_change 或 remove_status 明确其寿命；不能只在描述里声称触发。',
    '状态事件键的值只放一次性浅层效果，不接受 scope/ordinal/n/event/phase/reason/source_kind/source_id 等根 trigger 筛选字段；需要首次、第 N 次或来源筛选时，改用 Power、遗物、独立能力或召唤 ability 的根 trigger。history.event 只使用底层事件名：伤害 damage_resolved、治疗 heal_resolved、出牌 card_played、状态变化 status_applied/status_removed，绝不能把 deal_damage/take_damage/attack_played 等 trigger.on 名字照抄进去。',
    '遗物、道具、状态、独立能力和玩家欲望满溢效果均为可选内容；生成时必须使用可执行结构，不生成时返回空数组或省略可选对象即可。不要为了把职业说明机械地变成独立能力而强行生成无法执行的 player_abilities。所有 id 使用以字母或下划线开头的稳定英文标识。地图由程序在本次结果通过后生成，绝对不要输出地图结构。',
    '[输出前结构自检]逐项核对所有 effects、trigger、状态引用、公式变量、召唤 selector 与 Power：每项只用完整语法允许的字段；任何已经输出的 player_lust_effect、卡牌、道具、行动或触发 effects 都必须非空，不想设计的可选内容应整个省略，绝不能输出 effects:[]/{}；普通状态操作必须逐项写成 {apply_status:"状态ID",stacks?:层数,to?:"self"|"opponent"} 或 {remove_status:"状态ID",to?:目标}，apply_status/remove_status 的值绝不能是对象或 {状态ID:层数} 映射。逐项搜索每个 card_rule：它的值必须直接是公开规则字符串，limit/extra/筛选字段与它同级，绝不能写成 {rule,limit,extra} 对象；draw/energy/block/heal 等按事件结算的收益使用真实 trigger，不得猜成 limit_draw 等限制规则。replay_current 只能位于当前非 Power、非 Event 卡牌的直接根 effects，遗物、能力、Power、状态或 trigger 要让后续牌额外结算必须使用 passive/hold 的 card_rule:"replay"。根 trigger 使用 ordinal:"first" 时必须省略 n，只有 nth/every_n 才填写正整数 n。player.cards/artifacts/items/abilities/player_lust_effect 的状态引用必须在本次 player.statuses 中登记；opening 奖励候选引用的新状态则由该候选同级 statuses:[全部完整定义] 沿依赖链闭合，已有同机制状态只复用，reward 容器本身只含 cards/artifacts/items 数组。每个 player_abilities 项只能用 {id,name,source?,emoji?,description?,creates?,trigger:{on,effects}}，trigger.effects 必须非空，passive 只能含 modify/card_rule。逐个扫描公式：hp/max_hp/lust/max_lust/energy/max_energy/block/hand_size/draw_pile_size/discard_pile_size/exhaust_pile_size/summon_count/ally_count/status/resource 和状态统计必须写 self. 或 opponent. 前缀，绝不能裸写；召唤存在性条件只用 self.has_summon/opponent.has_summon，存活非召唤队友条件只用 self.has_ally/opponent.has_ally，它们不是函数；只有 spent_energy、x_value、turn_number 与三种本回合出牌计数器不加角色前缀，只有状态触发器中的 stacks 可裸写。when 不能用三元式，也不能发明 slot_count/enemy_summon_count 等近义变量；历史统计只能在数值位置写 {history:{metric,...}}，绝不能写 self.history.xxx 点链；x_resource.资源ID 只有同一张卡的 cost 对象把该资源写成 "all" 时才可用。给召唤施加状态必须使用 apply_summon_status:{selector,id,stacks?}，不能把 targets 嵌入普通 apply_status。召唤 action 攻击敌人使用普通 damage/lust，damage_summon/heal_summon 只用于外部效果直接伤害或治疗召唤单位；给召唤获得格挡使用 modify_summon 的 stat:"block" 与 add，不存在 block_summon；passive/hold 内也绝不能放 modify_summon 或 modify_summon_effect。逐个扫描 player.statuses 的 triggers.hold，若其中出现任何召唤操作，必须在输出前改为真实的一次性触发结构或换成当前 DSL 能完整执行的设计，绝不能保留持续召唤光环，也不能删成描述仍承诺效果的空 triggers。不得用 0 数值、空效果或空状态伪装运行时计数。只修结构，不因评分、牌数或攻防偏好改变自由设计。',
    input.validationError ? `上一份结果未通过程序校验：${input.validationError}` : '',
    input.rejectedCandidate ? `REJECTED_CANDIDATE=${input.rejectedCandidate}` : '',
    '提交前做最后一次逐字扫描：不得存在 effects:[]、effects:{}、trigger:null、空 trigger.effects 或只有描述没有执行结构的 Power/遗物/能力；没使用的可选字段必须整个省略。逐个扫描所有 passive 与状态 triggers.hold：每个 card_rule 的值必须是字符串而不是对象；只要 card_rule 是 replay，就必须同层同时填写 limit 与正整数 extra；card_rule 是 free 时必须填写 limit 且绝不能填写 extra。再搜索裸写的 hp、lust、energy、block、hand_size、draw_pile_size、discard_pile_size、exhaust_pile_size，并按实际阵营补全 self. 或 opponent.；玩家卡牌、遗物、能力和玩家欲望效果读取玩家自己的牌区时固定使用 self.。每个 opening 奖励候选引用的新状态必须由该候选自己的 statuses 沿完整依赖链闭合。发现空效果时按描述改成真实可执行效果；若可选内容没有唯一可恢复的机制就整个省略，绝不能留下空壳或零值占位。',
    'card_rule 不接受 ordinal/n/scope/event/phase/reason/source_kind/source_id/damage_type，“每回合第一张”由 limit:1 表达。逐项扫描 add_card/ensure_card/transform_card：被引用模板必须存在于同一卡牌、遗物、道具、能力或行动对象自己的 creates 中，不能只在同一奖励或玩家牌库的其他对象中出现。',
    '最后单独复核 Power：字段名始终是复数 effects；绝不能输出单数 effect，也绝不能把 {trigger:{on,effects}} 塞进 effects 数组。持续或事件能力把唯一 trigger 直接放在卡牌根部；只有打出时立即结算的操作才放根 effects。尤其逐张检查 trigger.on="passive"：其 trigger.effects 的每一项主操作只能是 modify 或 card_rule，绝不能出现 apply_status、damage、block、energy、draw、resource、召唤或牌区操作；Power 打出时获得持续状态应把 apply_status 放在该卡根 effects，并把状态的持续 modify/card_rule 留在 player.statuses 对应定义的 triggers.hold。',
    '公式不支持 random()、chance() 或任何概率函数。牌区随机选择只能使用对应操作的 pick:"random"，敌人随机行动只能使用 action_mode；玩家卡牌、Power、遗物、状态、能力和欲望效果不得声称百分比触发后再用随机公式伪装。若没有公开机制能表达概率，就改成确定且可执行的相邻设计。',
    '玩家 player_abilities 不能用 source_kind:"summon" 监听召唤物自身事件；需要“召唤命中后让主人获益”时，把 trigger 写进该召唤的 abilities，并用 summoner_effects 把收益交给主人。也不存在 modify:"summon_damage"：强化当前召唤行动使用一次性的 modify_summon_effect，生成时固有强化写进 spawn_summon.modifiers 或行动数值；不要制造无法执行的全局召唤伤害光环。',
    '最后扫描 player_lust_effect 以及所有初始持有内容：每个 apply_status/remove_status 和状态公式引用都必须在 player.statuses 中有同 ID 的完整定义；不想设计该可选内容时整个省略，绝不能留下只在 description 中存在的随机状态或未登记状态。',
    '所有可见说明字段只使用完整字段名 description，绝不能缩写成 desc。player.cards/artifacts/items 是已经持有的内容，绝不能携带 status/statuses；它们引用的完整定义只在全局 player.statuses 登记一次。',
    '最后逐项搜索 pick:"all"：若同一效果的 discard/exhaust/recover/copy/double/remove_card 操作值是数字，必须把 pick 改成符合描述的 random/choose/left/right/top/bottom，描述没有明确方式时使用 choose；只有操作值也逐字是 "all" 时才能保留 pick:"all"。不要把“数量 N”和“全部选择”写在同一效果项。',
    '最后逐项检查所有筛选字段：card_type 只能使用 Attack/Skill/Power/Event/Curse；若规则适用于所有牌，必须完全省略 card_type，绝不能写 Card/Any/All。name、rarity、tag、origin 等筛选不需要时整个省略，禁止空字符串、空数组、racial 等自造字段。',
    '最后逐项检查召唤目标：普通 damage/heal/block 的 targets 只选择敌我战斗实体，绝不能选择召唤物，也不能写 id:"summon" 这种类别占位。直接伤害或治疗召唤物必须使用 damage_summon/heal_summon，并在其对象内使用 summon selector；未指定具体召唤时用 owner 与 choose/lowest_hp 等真实选择方式。',
    '任何名称或 description 声称“生成、获得、召来一个召唤物”的内容，都必须在同一内容的真实 effects 中执行 spawn_summon；只有 apply_status、普通 damage/block 或召唤措辞不算召唤。若实际只施加状态，就把说明改成该状态效果，不能让叙述假装已经召唤。',
    '最后扫描全部 when 字符串：禁止 self.is_xxx/opponent.is_xxx、self.target.xxx、self.summon.xxx 等未公开成员。判断某个已登记状态必须逐字使用 self.status.状态ID.stacks > 0 或 opponent.status.状态ID.stacks > 0；判断任意召唤是否存在才使用 self.has_summon/opponent.has_summon。',
    '最后逐个检查三个 opening.choices 的 outcome：只允许 hp、max_hp、lust、max_lust、gold、card_removals、reward、deck_transforms；绝不能出现 energy、max_energy、block、status、resource、set_resource 或 effects。若馈赠主体是战斗内能量、格挡、状态或自定义资源收益，必须放进 reward 的完整卡牌、遗物或道具中执行，不能直接塞进 outcome。',
    OPENING_TRANSFORM_GUIDANCE,
    '提交前在内部建立状态 ID 对照（不要输出对照表）：收集 player.cards/artifacts/items/player_abilities/player_lust_effect 中每个 apply_status、remove_status 和 self/opponent.status.ID 引用，再逐项确认其 ID 属于预设白名单或已存在于 player.statuses；收集每个 opening 奖励候选的同类引用，再确认它属于预设白名单、复用 player.statuses，或由该候选自己的非空 statuses 完整定义。任一差集非空都必须先补齐真实定义或删除整个无法唯一实现的可选机制，绝不能带着未注册状态提交。',
    '根 trigger.on 只能使用完整契约列出的公开名字；resource_changed/damage_resolved/card_moved/status_applied 等底层事件名只属于 event/history.event，绝不能写进 on。当前没有资源变化触发器；若想按资源变化响应，改用现有可执行触发时机并同步说明，不得发明 event.metric。',
    '修复时保留已经合法且符合剧情的设计，只改程序指出的结构；优先用单个JSON对象表达修复数据，不输出UpdateVariable、battle包装或思考过程。',
    '最终返回前只做一次状态闭包复核，尤其检查 player_lust_effect：它引用的每个非预设状态 ID 都必须已在 player.statuses 完整定义。若不想定义，就把该项改成同一欲望主题下无需状态、但真实可执行的直接效果并同步 description；绝不能留下仅凭“易伤/中毒/强化”等名称自动生效的未注册状态。',
    '状态不能按中文名称自动生效；白名单内置 ID 可直接引用并自动展开，其余状态必须拥有对应稳定 ID 和完整 triggers 定义。player_lust_effect 是可选内容：能用直接伤害、治疗、欲望、能量、资源或牌区效果完整表达时优先使用直接效果；只有确实需要持续规则时才引用状态，并先完成上一条闭包复核。',
  ].filter(Boolean).join('\n');
}

function towerInitialRepairContext(
  original: ReturnType<typeof unwrapTowerInitialContent>,
  targets: readonly Pick<TowerInitialRepairTarget, 'original'>[],
): Record<string, unknown> {
  const player = isRecord(original.player) ? original.player : {};
  const statusDefinitions = Array.isArray(player.statuses) ? player.statuses.filter(isRecord) : [];
  const resourceDefinitions = isRecord(player.core) && Array.isArray(player.core.resources)
    ? player.core.resources.filter(isRecord)
    : [];
  const statusById = new Map(statusDefinitions
    .filter(definition => typeof definition.id === 'string')
    .map(definition => [definition.id as string, definition]));
  const statusIds = new Set<string>();
  const resourceIds = new Set<string>();
  targets.forEach(target => {
    collectInitialRepairStatusReferences(target.original, statusIds);
    collectInitialRepairResourceReferences(target.original, resourceIds);
  });
  const pending = [...statusIds];
  while (pending.length > 0) {
    const definition = statusById.get(pending.pop()!);
    if (!definition) continue;
    const dependencies = new Set<string>();
    collectInitialRepairStatusReferences(definition, dependencies);
    for (const dependency of dependencies) {
      if (statusIds.has(dependency)) continue;
      statusIds.add(dependency);
      pending.push(dependency);
    }
  }
  const contentIds = (field: string): string[] => (
    Array.isArray(player[field])
      ? player[field].filter(isRecord).map(entry => String(entry.id || '')).filter(Boolean)
      : []
  );
  return {
    existing_ids: {
      cards: contentIds('cards'),
      artifacts: contentIds('artifacts'),
      items: contentIds('items'),
      statuses: contentIds('statuses'),
      abilities: contentIds('player_abilities'),
      opening_choices: isRecord(original.opening) && Array.isArray(original.opening.choices)
        ? original.opening.choices.filter(isRecord).map(choice => String(choice.id || '')).filter(Boolean)
        : [],
    },
    referenced_status_definitions: statusDefinitions.filter(definition => statusIds.has(String(definition.id || ''))),
    referenced_resource_definitions: resourceDefinitions.filter(definition => resourceIds.has(String(definition.id || ''))),
  };
}

/** A compact repair request containing only program-selected invalid roots. */
function towerSingleFloorInitialRootRepairPrompt(input: {
  validationError: string;
  original: ReturnType<typeof unwrapTowerInitialContent>;
  targets: readonly TowerInitialRepairTarget[];
}): string {
  const projection = Object.fromEntries(input.targets.map(target => [target.token, {
    kind: target.kind,
    path: target.path,
    errors: target.errors,
    original: target.original,
    nullable: !!target.nullable,
    preserve_id: target.preserveId || undefined,
  }]));
  return [
    '[爬塔模式固定错误根修复]',
    '这不是重新创作。程序已把全部已知错误分组为最小可合并根，并为每个根固定了 rN token；你只负责按原剧情与机制语义修好每个根。',
    `SPEC=${TOWER_INITIAL_ROOT_REPAIR_SPEC}`,
    `ALL_VALIDATION_ERRORS=${String(input.validationError || '')}`,
    `REPAIR_TARGETS=${JSON.stringify(projection)}`,
    `REPAIR_CONTEXT=${JSON.stringify(towerInitialRepairContext(input.original, input.targets))}`,
    '返回顶层固定为 {spec,roots,support_statuses,support_resources}。roots 必须恰好包含 REPAIR_TARGETS 的每个 token，不能漏掉任何一个，也不能增加 token；每个值是该 token 原对象的完整替换，不是局部字段补丁。',
    '不得返回 JSON Pointer、path/op/value、完整 narrative/player/opening 候选或未请求内容。程序只会把 rN 合并回生成前已经锁定的路径，随后重新执行完整权威校验。',
    'preserve_id 存在时必须逐字保留该 id。只有 nullable:true 的根允许返回 null；卡牌、状态定义、core 与 opening choice 不允许用删除逃避错误。',
    '玩家已持有内容的修复根若确实新增并引用状态，把完整定义放在 support_statuses；程序只接受被已修根引用的传递闭包，未引用定义会被丢弃。opening choice 的奖励新状态仍必须放在该 choice 内实际引用它的 card/artifact/item 候选同级 statuses，不能放进全局 support_statuses。',
    '玩家修复根若确实新增并引用 core 资源，把完整定义放在 support_resources；不得加入未被修复根引用的资源。opening 奖励不能引入玩家 core 中不存在的新资源。没有新增支持定义时两个数组都返回 []。',
    '[按报错根最终复核；下面的重点修复要求必须逐条落实]',
    formatCompactEffectRepairContract(input.validationError),
    '只修改每个 original 中错误所必需的字段，保留其主题、说明、数值和合法机制。若修正改变了实际执行语义，必须同步修正同一根内的 description，不能留下错误承诺。',
    '返回本次指定修复数据，优先用单个JSON对象表达；保留字段约束，不输出思考过程或变量命令。',
  ].join('\n');
}

/** Compact production prompt for program-selected repair slots. */
function towerSingleFloorInitialSlotRepairPrompt(input: {
  validationError: string;
  original: ReturnType<typeof unwrapTowerInitialContent>;
  targets: readonly TowerInitialRepairSlotRootTarget[];
}): string {
  const projection = Object.fromEntries(input.targets.map(root => [root.token, {
    path: root.path,
    errors: root.errors,
    locked_context: root.original,
    allow_support_statuses: !!root.allowSupportStatuses,
    allow_support_resources: !!root.allowSupportResources,
    support_status_ids: root.supportStatusIds || [],
    support_resource_ids: root.supportResourceIds || [],
    slots: Object.fromEntries(root.slots.map(slot => [slot.token, {
      kind: slot.kind,
      action: slot.action,
      path: slot.relativePath,
      preserve_id: slot.preserveId,
      allowed_modes: slot.allowedModes || [],
      locked_formula_paths: (slot.resourceReferencePaths || []).map(path => path.slice(`${root.path}.`.length)),
      additional_write_paths: (slot.additionalWritePaths || []).map(path => path.slice(`${root.path}.`.length)),
      errors: slot.errors,
      original: slot.original,
    }])),
  }]));
  return [
    '[爬塔模式锁定槽位修复]',
    '这不是重新创作。程序已经锁定全部允许写入的 rN.sN 槽位；槽外的剧情、名称、ID、费用、数量、稀有度和其他合法机制均不可改变。',
    `SPEC=${TOWER_INITIAL_SLOT_REPAIR_SPEC}`,
    `ALL_VALIDATION_ERRORS=${String(input.validationError || '')}`,
    `REPAIR_SLOTS=${JSON.stringify(projection)}`,
    `REPAIR_CONTEXT=${JSON.stringify(towerInitialRepairContext(input.original, input.targets))}`,
    '只返回 {spec,roots,support_statuses,support_resources}。每个 roots.rN 只含 slots；每个 slots.sN 必须恰好使用 schema 固定的 action，并返回 value（remove_invalid_field 除外）。所有根和槽都必须出现一次，不得增加、漏掉或自选 path。只补依赖定义的根会明确给出 slots:{}；此时不得改该根，只需在指定 support 数组中返回每个固定 ID 的完整定义。',
    ...selectInitialSlotRepairGuidance(input.targets),
    '只有单独提供的 description 槽允许更新说明；若同一根的修复改变了执行语义，description 必须准确描述修复后的实际机制。没有 description 槽时不得改说明。',
    '修复槽新增并引用玩家状态或资源时，才分别在 support_statuses/support_resources 提供完整定义；程序只合并从已修玩家根可达的闭包。opening 奖励的新状态仍属于候选自身，不得放进全局支持数组；opening 奖励引用但 player.core 缺少的资源不可在修复时提前注册，必须停止而不是改动玩家全局状态。没有新增定义时返回 []。',
    formatCompactEffectRepairContract(input.validationError),
    '返回本次指定修复数据，优先用单个JSON对象表达；不重发完整 player/opening，不输出思考过程或变量命令。',
  ].join('\n');
}

function restMutationJsonSchema(kind: RestMutationBridgeRequest['kind']): Record<string, any> {
  if (kind === 'upgrade') {
    return {
      name: 'mwg_rest_card_upgrade',
      description: '魔法少女世界营火卡牌升级补丁',
      strict: false,
      value: withAiContentDefinitions({
        type: 'object',
        properties: {
          patch: {
            type: 'object',
            properties: {
              node_id: { type: 'string' },
              card_id: { type: 'string' },
              id: { type: 'string' },
              name: { type: 'string' },
              cost: aiSchemaRef('cardCost'),
              effects: aiSchemaRef('mwgCardEffectList'),
              discard_effects: aiSchemaRef('effectList'),
              trigger: aiSchemaRef('mwgCardTrigger'),
              creates: { type: 'array', maxItems: 32, items: aiSchemaRef('cardTemplate') },
              retain: { type: 'boolean' },
              exhaust: { type: 'boolean' },
              ethereal: { type: 'boolean' },
              innate: { type: 'boolean' },
            },
            required: ['node_id', 'card_id'],
            additionalProperties: false,
          },
        },
        required: ['patch'],
        additionalProperties: false,
      }),
    };
  }
  return {
    name: 'mwg_rest_card_transform',
    description: '魔法少女世界营火卡牌变形结果',
    strict: false,
    value: withAiContentDefinitions({
      type: 'object',
      properties: { card: aiSchemaRef('mwgCard') },
      required: ['card'],
      additionalProperties: false,
    }),
  };
}

/**
 * Tavern Helper stores one variable object per swipe, so raw chat JSON uses an
 * array. `Mvu.getMvuData` should already return the selected object, but older
 * bridges and interrupted reloads can leak either `[data]` or `{ "0": data }`
 * across the boundary. Unwrap only that exact single-entry shape; accepting a
 * general numeric-key object would hide real corruption.
 */
export function normalizeLatestMvuRoot(value: unknown): Record<string, any> | null {
  let current: unknown = value;
  for (let depth = 0; depth < 2; depth += 1) {
    if (isRecord(current) && isRecord(current.stat_data)) return current;
    if (Array.isArray(current) && current.length === 1) {
      current = current[0];
      continue;
    }
    if (isRecord(current) && Object.keys(current).length === 1 && Object.hasOwn(current, '0')) {
      current = current['0'];
      continue;
    }
    break;
  }
  return isRecord(current) && isRecord(current.stat_data) ? current : null;
}

function hasRepairHelperCapabilities(value: Record<string, any> | null): value is Record<string, any> {
  return Boolean(value) && TAVERN_HELPER_REPAIR_FUNCTIONS.every(name => typeof value![name] === 'function');
}

function hasPendingBattleSettlement(value: unknown): boolean {
  const root = normalizeLatestMvuRoot(value);
  const request = root?.stat_data?.reward?.request;
  return isRecord(request) && request.marker === '[MVU_BATTLE_SETTLEMENT]';
}

function cleanTowerNarrative(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/<(?:UpdateVariable|VariableUpdate|Update)>[\s\S]*?<\/(?:UpdateVariable|VariableUpdate|Update)>/gi, '')
    .replace(/<\/?(?:StatusPlaceHolderImpl|BATTLE_START|BATTLE_PENDING|CONTENT_PENDING|CHARACTER_INIT_PENDING)\s*\/?\s*>/gi, '')
    .trim();
}

function towerNarrativePrompt(stat: Record<string, any>, activeNode: Record<string, any>): string {
  const kind = String(activeNode.kind || 'event');
  const facts: Record<string, unknown> = {
    node: {
      id: activeNode.node_id,
      kind,
      title: activeNode.title,
      prepared_context: activeNode.narrative,
    },
    player: {
      profession: stat.status?.profession,
      core: stat.battle?.core,
    },
    tower_progress: {
      act: stat.run?.act,
      floor: stat.run?.floor,
      previous_node: stat.run?.lastNodeKind,
    },
    custom_requirements: stat.tower_requirements,
  };
  if (isBattleRunNode(kind as RunNodeKind)) {
    facts.encounter = {
      enemy: stat.battle?.enemy,
      enemies: stat.battle?.enemies,
    };
  } else {
    const content = stat[`run_${kind}`];
    facts.node_content = kind === 'event' && isRecord(content) ? {
      description: content.description,
      choices: Array.isArray(content.choices) ? content.choices.map((choice: any) => ({ id: choice.id, label: choice.label, description: choice.description })) : [],
    } : content;
  }
  const serializedFacts = JSON.stringify(facts);
  return [
    '[爬塔节点剧情]',
    stat.run?.dungeonPlan ? `[私有副本设计指导，按当前幕与层数承接，不向玩家复述未来内容]\n${JSON.stringify(stat.run.dungeonPlan)}` : '',
    '玩家已经在单页爬塔界面进入了以下节点。请使用当前角色卡、聊天记录、玩家要求和当前启用的原预设，自然续写这个节点的剧情正文。',
    '不要规定或解释正文长度、段落数量、节奏、文风；按当前预设正常发挥。',
    '下面的节点类型、人物和已准备内容是已经确定的事实，请保持一致；不要提前替玩家结算尚未进行的战斗、事件选择、购买、领奖或营火操作。',
    '只返回供玩家阅读的剧情正文，不输出 JSON、UpdateVariable、变量命令、系统说明或后台分析。',
    `[当前节点事实]\n${serializedFacts}`,
  ].join('\n');
}

function towerOpeningNarrativePrompt(stat: Record<string, any>, openingContent: Record<string, any>): string {
  const choices = Array.isArray(openingContent.choices)
    ? openingContent.choices.map(choice => isRecord(choice) ? {
      id: choice.id,
      label: choice.label,
      description: choice.description,
    } : choice)
    : [];
  const facts = {
    opening: {
      title: openingContent.title,
      prepared_context: openingContent.narrative,
      choices,
    },
    player: {
      profession: stat.status?.profession,
      core: stat.battle?.core,
    },
    custom_requirements: stat.tower_requirements,
  };
  const serializedFacts = JSON.stringify(facts);
  return [
    `[爬塔第 ${Number(stat.run?.act) || 1} 幕开幕馈赠剧情]`,
    stat.run?.dungeonPlan ? `[私有副本设计指导，正文不泄露未来内容]\n${JSON.stringify(stat.run.dungeonPlan)}` : '',
    '玩家正在单页爬塔界面进入这一幕。请使用当前角色卡、聊天记录、玩家要求和当前启用的原预设，自然生成这次开幕馈赠事件的独立剧情正文。',
    '叙事必须承接已建立的处境或上一幕首领之后的过渡，并进一步明确玩家接下来会不断前进、连续面对战斗与节点；原因和表现完全服从当前题材。',
    Number(stat.run?.act) > 1
      ? '这是独立的新幕开场，必须说明本幕馈赠来自谁、为何在此时出现、与上一幕首领或新幕目标有什么关系；不得复用第一幕或上一幕的原文。'
      : '也必须在正文中交代第一幕馈赠的来源或馈赠者，让玩家知道这份力量为何出现。',
    '下列事件框架与可选行动已经确定；正文可以自由发挥表现方式，但不要改变选择的身份或暗示不存在的选项，也不要替玩家选择。',
    '只返回玩家可阅读的剧情正文，不要输出 JSON、Markdown 代码块、UpdateVariable、变量命令或运行标记。',
    '正文长度、段落、节奏、文风和推进速度完全交给当前原预设决定。',
    serializedFacts,
  ].join('\n');
}

/**
 * Recover the nearest failed request from the saved route after a page reload.
 * The route graph is used instead of scanning every failed envelope so an
 * abandoned branch can never be retried by the generic settings button.
 */
function nearestReachableFailedTowerNode(run: RunState): string {
  if (run.routeMode !== 'map' || !run.map || run.phase === 'won' || run.phase === 'lost') return '';
  const nodeById = new Map(run.map.nodes.map(node => [node.id, node]));
  const outgoing = new Map<string, string[]>();
  for (const edge of run.map.edges) {
    const children = outgoing.get(edge.from) || [];
    children.push(edge.to);
    outgoing.set(edge.from, children);
  }
  const compareNodeId = (leftId: string, rightId: string): number => {
    const left = nodeById.get(leftId);
    const right = nodeById.get(rightId);
    return (Number(left?.floor) - Number(right?.floor))
      || (Number(left?.column) - Number(right?.column))
      || leftId.localeCompare(rightId);
  };
  for (const children of outgoing.values()) children.sort(compareNodeId);

  const roots = run.phase === 'in_node' && run.currentNode
    ? [run.currentNode.id]
    : run.choices.map(choice => choice.id).sort(compareNodeId);
  const queue = [...roots];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    if (visited.has(nodeId)) continue;
    visited.add(nodeId);
    const node = nodeById.get(nodeId);
    if (!node || node.act !== run.act) continue;
    if (run.nodeContent[nodeId]?.phase === 'failed') return nodeId;
    for (const childId of outgoing.get(nodeId) || []) {
      if (!visited.has(childId)) queue.push(childId);
    }
  }
  return '';
}

/** Keep one source-level repair budget even when reference and rule faults coexist. */
export function planTowerInitialJointRepair(input: unknown, onUnsupported?: (reason: string) => void) {
  const source = planInitialEnvelopeRepair(input, true);
  const registry = planInitialDraftRegistryRepair(input, source?.slots.map(slot => slot.path) || []);
  if (registry.kind !== 'repair') return null;
  type RepairFragments = InitialDraftFragments & { narrative: string };
  let preview: RepairFragments | null = null;
  const inspection = inspectInitialDraftFragments(input, candidate => {
    // Preserve missing/non-object roots verbatim. Independent real peers may
    // still have rule slots; only the source response may replace a bad root.
    if (typeof candidate.narrative !== 'string') return [];
    preview = { narrative: candidate.narrative, player: clone(candidate.player), opening: clone(candidate.opening) };
    const readiness = assessInitialTowerContent({ battle: candidate.player });
    return readiness?.issues || [];
  });
  if (!preview || !inspection.inspected) return null;
  const content = preview as RepairFragments;
  // Legacy slot helpers already inspect roots with isRecord. This adapter
  // retains their original values; it must not coerce undefined/arrays to null.
  const original = { ...content, status: isRecord(content.player) ? content.player.status || {} : {} } as ReturnType<typeof unwrapTowerInitialContent>;
  if (isRecord(content.opening) && Array.isArray(content.opening.choices)) content.opening.choices.forEach((choice: any, choiceIndex: number) => {
    const reward = choice?.outcome?.reward;
    if (!isRecord(reward)) return;
    for (const category of ['cards', 'artifacts', 'items'] as const) {
      if (!Array.isArray(reward[category])) continue;
      reward[category].forEach((value: unknown, index: number) => {
        const prefix = `opening.choices[${choiceIndex}].outcome.reward.${category}[${index}]`;
        const issues = collectRewardCandidateTypedContractIssues(category, value, {
          playerDesireEffect: isRecord(content.player) ? content.player.player_lust_effect : undefined,
          statusDefinitions: isRecord(content.player) ? content.player.statuses : undefined,
          // Declared missing IDs have fixed addition slots, not placeholder
          // definitions. Their rules are validated only after the AI supplies them.
          knownStatusIds: registry.plan.slots.filter(slot => slot.kind === 'statuses').map(slot => slot.id),
        });
        for (const issue of issues) {
          if (issue.path.startsWith('desireEffects.player')) {
            inspection.rules.push({
              ...issue,
              path: `player.player_lust_effect${issue.path.slice('desireEffects.player'.length)}`,
            });
            continue;
          }
          const categoryRoot = category === 'artifacts' ? 'relics' : category;
          const path = issue.path.startsWith(`${categoryRoot}[0]`)
            ? `${prefix}${issue.path.slice(`${categoryRoot}[0]`.length)}` : `${prefix}.${issue.path}`;
          inspection.rules.push({ ...issue, path });
        }
      });
    }
  });
  const covered = (path: Array<string | number>): boolean => !!source?.slots.some(slot =>
    slot.path.length <= path.length && slot.path.every((key, i) => key === path[i]));
  const errors: string[] = collectTowerOpeningEnvelopeIssues(content.opening).filter(error => {
    const path = error.match(/^(opening(?:\.[A-Za-z_]+|\[\d+\])*)[：:]/)?.[1];
    return !path || !covered(initialRepairPathParts(path));
  });
  const storyStatus = isRecord(content.player) ? content.player.status : undefined;
  if (!covered(['player']) && (!isRecord(storyStatus) || ![storyStatus.time, storyStatus.location, storyStatus.profession?.name, storyStatus.profession?.ability]
    .every(value => typeof value === 'string' && value.trim().length > 0))) {
    errors.push('机制草稿缺少剧情决定的时间、位置或职业信息；程序不会用默认值替代');
  }
  for (const issue of inspection.rules) {
    // Only skip precisely identified missing definitions already assigned to
    // registry additions. Other unknown-reference errors remain blocking.
    if (issue.code === 'UNKNOWN_STATUS' && registry.plan.slots.some(slot => slot.kind === 'statuses'
      && issue.message.endsWith(`: ${slot.id}）`))) continue;
    let path = issue.path.replace(/^battle\./, 'player.');
    if (covered(initialRepairPathParts(path))) continue;
    const sourcePath = initialDraftSourcePath(registry.plan.original, content, initialRepairPathParts(path));
    // A missing template's exact reference is already owned by an addition
    // slot. Do not mistake its expected validation echo for an independent
    // malformed effect; unrelated errors at the same owner remain blocking.
    if (sourcePath && registry.plan.slots.some(slot => slot.kind === 'templates'
      && slot.references.some(reference => JSON.stringify(reference) === JSON.stringify(sourcePath))
      && issue.message.endsWith(`具体原因：Unknown card template: ${slot.id}）`))) continue;
    if (sourcePath && source?.slots.some(slot => JSON.stringify(slot.path) === JSON.stringify(sourcePath))) continue;
    const template = path.match(/^(.*)\.template\(([A-Za-z_][A-Za-z0-9_-]*)\)(\..*)$/);
    if (template) {
      let owner = template[1];
      let resolved = false;
      while (owner.includes('.')) {
        const value = initialRepairValueAtPath(original, owner);
        const creates = isRecord(value) && Array.isArray(value.creates) ? value.creates : [];
        const matches = creates.map((value: any, index: number) => ({ value, index }))
          .filter(({ value }: { value: any }) => isRecord(value) && value.id === template[2]);
        if (matches.length === 1) {
          path = `${owner}.creates[${matches[0].index}]${template[3]}`;
          resolved = true;
          break;
        }
        owner = owner.replace(/(?:\.[^.\[\]]+|\[\d+\])$/, '');
      }
      if (!resolved) { onUnsupported?.(`模板诊断无法定位：${path}`); return null; }
    }
    // Reward diagnostics use an English message. Retain the typed omission
    // code after remapping its owner so joint repair can select the same
    // fixed player slot as the ordinary readiness path.
    const code = issue.code === 'MISSING_LUST_OVERFLOW_EFFECT' ? `[${issue.code}] ` : '';
    errors.push(`${path.replace(/^player\./, 'battle.')}：${code}${issue.message}`);
  }
  errors.push(...collectInitialTriggerTimingIssues({ player: content.player, opening: content.opening })
    .map(issue => `${issue.path}：[${issue.code}] ${issue.message.replaceAll('；', '，')}`));
  errors.push(...collectAuthoredLiteralEffectIssues({ player: content.player, opening: content.opening })
    .map(issue => `${issue.path}：[${issue.code}] ${issue.message.replaceAll('；', '，')}`));
  const validationError = [...new Set(errors)].join('；');
  // A nonempty combined target list does not prove that every independent
  // diagnostic was mapped: an unrelated valid slot can hide an unsupported
  // envelope/story error. Require coverage before spending the sole repair.
  for (const error of new Set(errors)) {
    if (!extractTowerInitialRepairSlotTargets(original, error).length) {
      onUnsupported?.(`独立问题没有安全修正槽：${error}`);
      return null;
    }
  }
  const targets = validationError ? extractTowerInitialRepairSlotTargets(original, validationError) : [];
  if (validationError && !targets.length) { onUnsupported?.(`无法提取全部有限槽：${validationError}`); return null; }
  // Definitions are authored only in the registry additions, never in compiled
  // support arrays. Compiled slots cannot allocate new source identities.
  for (const root of targets) {
    root.allowSupportStatuses = false; root.allowSupportResources = false;
    root.supportStatusIds = []; root.supportResourceIds = [];
    for (const slot of root.slots) {
      if (!initialDraftSourcePath(registry.plan.original, content, initialRepairPathParts(slot.path))
        || slot.additionalWritePaths?.length) { onUnsupported?.(`槽位无法回映：${slot.path}`); return null; }
    }
  }
  return { registry: registry.plan, source, preview: content, original, targets, validationError };
}

export function applyTowerInitialJointRepair(plan: NonNullable<ReturnType<typeof planTowerInitialJointRepair>>, response: unknown) {
  if (!isRecord(response) || response.spec !== 'mwg.initial-joint-repair/v1'
    || Object.keys(response).sort().join(',') !== (plan.source ? 'registry,rules,source,spec' : 'registry,rules,spec')) throw new Error('联合修正格式无效');
  const parsed = parseTowerInitialSlotRepairResponse(response.rules, plan.targets);
  // A whole-effect repair cannot discard an original condition. Precise
  // condition slots remain responsible for changing a condition expression.
  for (const root of plan.targets) for (const slot of root.slots) {
    const value = parsed.roots[root.token].slots[slot.token].value;
    if (slot.kind === 'condition' && value === null) throw new Error('联合修正不能删除原条件');
    const oldItems = Array.isArray(slot.original) ? slot.original : [slot.original];
    const newItems = Array.isArray(value) ? value : [value];
    for (const item of oldItems) if (isRecord(item) && typeof item.when === 'string'
      && !newItems.some(next => isRecord(next) && next.when === item.when))
      throw new Error('联合修正不能通过替换整个效果删除或改变原条件');
  }
  const merged = mergeTowerInitialSlotRepair(plan.original, plan.targets, parsed);
  const authored = applyInitialDraftPreviewEdits(plan.registry.original, plan.preview,
    { narrative: merged.narrative, player: merged.player!, opening: merged.opening! });
  const additions = applyInitialDraftRegistryRepair({ ...plan.registry, original: authored }, response.registry);
  if (!additions.ok) throw new Error(additions.message);
  if (!plan.source) return additions.draft;
  // Source and projected rule edits must be disjoint. Validate source edits
  // against their ORIGINAL diagnosis, then copy only those exact leaf values.
  const sourceResult = applyInitialEnvelopeRepair(plan.source, response.source);
  for (const slot of plan.source.slots) {
    let originalValue: any = plan.source.original, target: any = additions.draft, repairedValue: any = sourceResult;
    for (const key of slot.path.slice(0, -1)) { originalValue = originalValue[key]; target = target[key]; repairedValue = repairedValue[key]; }
    const key = slot.path.at(-1)!;
    if (towerInitialStateKey(target[key]) !== towerInitialStateKey(originalValue[key])) throw new Error('联合修正的源字段与规则写入重叠');
    target[key] = clone(repairedValue[key]);
  }
  return additions.draft;
}

export function createTowerInitialJointRepairJsonSchema(plan: NonNullable<ReturnType<typeof planTowerInitialJointRepair>>) {
  const registry = createInitialDraftRegistryRepairJsonSchema(plan.registry).value;
  const rules = createTowerInitialSlotRepairJsonSchema(plan.targets).value;
  const registryDefs = (registry.$defs || {}) as Record<string, unknown>;
  const ruleDefs = (rules.$defs || {}) as Record<string, unknown>;
  // Registry definitions forbid inline templates; compiled rule slots can
  // describe their carriers. Keep both grammars under distinct root refs
  // rather than replacing either definition when a new slot needs both.
  const renamed = new Map<string, string>();
  // Namespace the full rule dependency graph: a textually identical shared
  // definition may itself reference a definition whose grammar differs.
  for (const key of Object.keys(ruleDefs)) {
    const name = `jointRule_${key}`;
    if (Object.hasOwn(registryDefs, name) || Object.hasOwn(ruleDefs, name)) throw new Error(`联合修正 schema 定义冲突：${name}`);
    renamed.set(`#/$defs/${key}`, `#/$defs/${name}`);
    ruleDefs[name] = ruleDefs[key];
    delete ruleDefs[key];
  }
  const rewriteRuleRefs = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(rewriteRuleRefs); return; }
    if (!isRecord(value)) return;
    if (typeof value.$ref === 'string' && renamed.has(value.$ref)) value.$ref = renamed.get(value.$ref);
    Object.values(value).forEach(rewriteRuleRefs);
  };
  rewriteRuleRefs(rules);
  delete registry.$defs;
  delete rules.$defs;
  return { name: 'mwg_initial_joint_repair', strict: false,
    value: { type: 'object', additionalProperties: false, required: ['spec', 'registry', 'rules', ...(plan.source ? ['source'] : [])],
      properties: { spec: { const: 'mwg.initial-joint-repair/v1' }, registry, rules,
        ...(plan.source ? {source: {type:'object', additionalProperties:false, required:['replacements'], properties:{replacements:{
          type:'object', additionalProperties:false, required:plan.source.slots.map(s=>s.token),
          properties:Object.fromEntries(plan.source.slots.map(s=>[s.token,{type:s.valueType}])),
        }}}} : {}),
      },
      $defs: { ...registryDefs, ...ruleDefs },
    },
  };
}

function assessInitialTowerContent(variables: unknown) {
  if (!isRecord(variables)) return null;
  const stat = isRecord(variables.stat_data) ? variables.stat_data : variables;
  const battle = stat.battle;
  if (!isRecord(battle)) return null;
  const core = isRecord(battle.core) ? battle.core : {};
  return assessInitialPlayerContent(createContentPackFromMvuBattle(battle), {
    emoji: core.emoji,
    hp: core.hp,
    maxHp: core.max_hp,
    lust: core.lust,
    maxLust: core.max_lust,
    level: battle.level,
    exp: battle.exp,
  });
}

const PLAYER_CONTENT_DISPLAY_KEYS = new Set([
  'id', 'name', 'description', 'label', 'title', 'narrative', 'emoji', 'source',
]);

function containsStatusMachineReference(value: unknown, statusId: string, parentKey = ''): boolean {
  if (typeof value === 'string') {
    if (PLAYER_CONTENT_DISPLAY_KEYS.has(parentKey)) return false;
    return value === statusId || value.includes(`.status.${statusId}.`);
  }
  if (Array.isArray(value)) {
    return value.some(entry => containsStatusMachineReference(entry, statusId, parentKey));
  }
  if (!isRecord(value)) return false;
  return Object.entries(value).some(([key, entry]) => containsStatusMachineReference(entry, statusId, key));
}

/**
 * Last-resort cleanup after the bounded model repair is exhausted. Only invalid
 * status definitions which are unreachable from every executable player-owned
 * root may be removed. Cards, relics, items, abilities, active effects and all
 * referenced status definitions remain authored content and are never deleted
 * to make a candidate pass.
 */
export function salvageInvalidInitialPlayerContent(variables: unknown): Record<string, any> | null {
  if (!isRecord(variables)) return null;
  const draft = clone(variables);
  const stat = isRecord(draft.stat_data) ? draft.stat_data : draft;
  if (!isRecord(stat.battle)) return null;
  const readiness = assessInitialTowerContent(draft);
  if (!readiness || readiness.ok) return readiness?.ok ? draft : null;
  const invalidStatusIndexes = new Set<number>();
  for (const issue of readiness.issues) {
    const match = issue.path.match(/^battle\.statuses\[(\d+)\]/);
    if (match) invalidStatusIndexes.add(Number(match[1]));
  }
  if (invalidStatusIndexes.size === 0 || !Array.isArray(stat.battle.statuses)) return null;

  const statusDefinitions = stat.battle.statuses.filter(isRecord);
  const statusIds = statusDefinitions
    .map(status => typeof status.id === 'string' ? status.id : '')
    .filter(Boolean);
  const executableRoots = {
    ...stat.battle,
    statuses: [],
  };
  const reachableStatusIds = new Set<string>(
    statusIds.filter(id => containsStatusMachineReference(executableRoots, id)),
  );
  let changed = true;
  while (changed) {
    changed = false;
    for (const definition of statusDefinitions) {
      if (typeof definition.id !== 'string' || !reachableStatusIds.has(definition.id)) continue;
      for (const id of statusIds) {
        if (!reachableStatusIds.has(id) && containsStatusMachineReference(definition, id)) {
          reachableStatusIds.add(id);
          changed = true;
        }
      }
    }
  }

  const removableIndexes = new Set(
    [...invalidStatusIndexes].filter(index => {
      const status = stat.battle.statuses[index];
      return isRecord(status)
        && typeof status.id === 'string'
        && !reachableStatusIds.has(status.id);
    }),
  );
  if (removableIndexes.size === 0) return null;
  stat.battle.statuses = stat.battle.statuses.filter(
    (_entry: unknown, index: number) => !removableIndexes.has(index),
  );
  normalizeMvuVariablesBattleInPlace(draft);
  const salvagedReadiness = assessInitialTowerContent(draft);
  return salvagedReadiness?.ok ? draft : null;
}

function settingRoot(context: SillyTavernContext): Record<string, any> {
  const existing = context.extensionSettings[DESIGN_ASSISTANT_EXTENSION_ID];
  const normalized = normalizeDesignAssistantSettings(existing);
  context.extensionSettings[DESIGN_ASSISTANT_EXTENSION_ID] = normalized;
  return normalized;
}

export class DesignAssistantController {
  private readonly encounterEvaluator = new EncounterWorkerClient();
  private towerMeasuredBuild: TowerBuildMeasurement | null = null;
  private readonly towerEvaluationReports = new Map<string, unknown>();

  public getTowerEvaluationReport(auditId: string): unknown {
    const report = this.towerEvaluationReports.get(auditId);
    return report ? clone(report) : undefined;
  }

  private readonly engine: DesignAssistantEngine;
  private active = false;
  private mvuRepairScopeGeneration = 0;
  private warming: Promise<MvuDesignSnapshot | null> | null = null;
  private warmupScheduled = false;
  private warmupRerunRequested = false;
  private listenerContext: SillyTavernContext | null = null;
  private latestSnapshot: MvuDesignSnapshot | null = null;
  private status: DesignAssistantStatus = { phase: 'idle', message: '等待 MVU 数据', updatedAt: 0 };
  private readonly workerClient: DesignWorkerClient;
  private readonly towerGenerationHost: TowerGenerationHost;
  private readonly initialGenerationEvidence = new InitialGenerationEvidence(() => this.host.now());
  private readonly towerGenerationEvidence = new TowerGenerationEvidence(new EvidenceFileStore(
    createTavernEvidenceFilePorts(() => this.host.context()?.getRequestHeaders?.() || {}),
  ));
  private readonly structuredGenerate: TowerGenerationPorts['generate'];
  private readonly initialDeliveryDiagnostics: TowerGenerationDiagnostics;
  private readonly initialDeliveryCancels = new Map<string, () => void>();
  private readonly stopInitialGeneration: TowerGenerationPorts['stopGenerationById'];
  private initialStartSequence = 0;
  private readonly initialStartOperations = new Map<string, {
    generationId: string; cancelled: boolean; committing: boolean;
    reject: (error: Error) => void; activeIds: Set<string>;
  }>();
  private readonly persistentMvuRepairHost: PersistentMvuRepairHost;
  private readonly automaticSettlementAttempts = new Set<string>();
  private settlementRecoveryWatchGeneration = 0;
  private initialContentRecoveryWatchGeneration = 0;
  private readonly reasoningFinalRecoveryHost = new ReasoningFinalRecoveryHost();
  private reasoningRecoveryWatchGeneration = 0;
  private readonly towerCoordinator: TowerLookaheadCoordinator | null;
  private readonly towerWriteBases = new WeakMap<Record<string, any>, Record<string, any>>();
  private towerChatId: string | null = null;
  private readonly publishedTowerTerminals = new Set<string>();
  /** Child balance-feedback queue ids are displayed under their parent request. */
  private readonly towerProgressParentRequestIds = new Map<string, string>();
  private readonly towerEvidenceParents = new Map<string, string>();
  private readonly towerRequestPromises = new Map<string, Promise<TowerGenerationResult>>();
  /** Parent batch/opening request currently responsible for a visible monitor operation. */
  private readonly towerActiveRequests = new Map<string, NormalizedTowerBridgeRequest>();
  /** Exact queue keys that may be children of a visible parent repair/review. */
  private readonly towerActiveAttemptKeys = new Map<string, TowerGenerationTaskKey>();
  private readonly towerNarrativePromises = new Map<string, Promise<void>>();
  private readonly towerPreGenerationSnapshots = new Map<string, Record<string, any>>();
  private readonly singleFloorStartPromises = new Map<string, Promise<Record<string, unknown>>>();
  private towerArchivePromise: Promise<number> | null = null;
  private readonly archivedTowerRuns = new Set<string>();
  private readonly towerActivityTouches = new Map<string, { revision: number; touchedAt: number }>();
  private readonly rerenderedTowerRestoreSnapshots = new Set<string>();
  private towerActivitySavePromise: Promise<void> = Promise.resolve();
  private towerActivityWatchGeneration = 0;
  private readonly handledMvuRequestPayloads = new WeakSet<object>();
  private tavernHelperRequestUnsubscribe: (() => void) | null = null;
  private tavernHelperEventWatchGeneration = 0;
  private activeMvuLifecyclePrompt: ActiveMvuLifecyclePrompt | null = null;
  private readonly restMutationPromises = new Map<string, Promise<unknown>>();

  constructor(
    private readonly host: DesignAssistantHost,
    engine = new DesignAssistantEngine(),
    towerGenerationPorts: TowerGenerationPorts = createGlobalTowerGenerationPorts(),
    options: DesignAssistantControllerOptions = {},
  ) {
    this.engine = engine;
    this.workerClient = new DesignWorkerClient(engine);
    this.initialDeliveryDiagnostics = new TowerGenerationDiagnostics(() => this.host.now());
    this.stopInitialGeneration = id => {
      this.initialDeliveryCancels.get(id)?.();
      return towerGenerationPorts.stopGenerationById(id);
    };
    this.structuredGenerate = async config => {
      const id = String(config.generation_id || '');
      const operation = [...this.initialStartOperations.values()].find(op =>
        id === op.generationId || id.startsWith(`${op.generationId}__`));
      if (operation?.cancelled) throw new TowerGenerationCancelledError('已取消本次开局');
      operation?.activeIds.add(id);
      const chatId = this.currentChatId();
      if (chatId) this.initialDeliveryDiagnostics.retainChat(chatId);
      const diagnostic = operation && chatId ? this.initialDeliveryDiagnostics.begin({
        chatId, nodeId: '__initial_mechanism', requestId: id,
      }, 'structured', 1, id, config.empty_json_fallback === true) : undefined;
      let observation: ReturnType<NonNullable<TowerGenerationPorts['observeStructuredDelivery']>> | undefined;
      try { if (diagnostic) observation = towerGenerationPorts.observeStructuredDelivery?.(id); } catch { /* Optional metadata. */ }
      const recordDelivery = () => {
        try { if (observation) diagnostic?.observedStructured(observation.snapshot()); } catch { /* Optional metadata. */ }
      };
      const close = () => { try { observation?.close(); } catch { /* Diagnostics never affect generation. */ } };
      const cancel = () => {
        recordDelivery(); close();
        diagnostic?.failed(new TowerGenerationCancelledError('已取消本次开局'), true);
      };
      if (diagnostic) this.initialDeliveryCancels.set(id, cancel);
      try {
        const result = await towerGenerationPorts.generate(config);
        recordDelivery(); diagnostic?.returned(result);
        return result;
      } catch (error) {
        recordDelivery(); diagnostic?.failed(error, operation?.cancelled === true);
        throw error;
      } finally {
        close();
        if (this.initialDeliveryCancels.get(id) === cancel) this.initialDeliveryCancels.delete(id);
        operation?.activeIds.delete(id);
      }
    };
    this.persistentMvuRepairHost = new PersistentMvuRepairHost({
      generate: towerGenerationPorts.generate,
      now: () => this.host.now(),
      onStructuredProgress: event => this.onStructuredRepairProgress(event),
      onEvidence: event => {
        const owner = this.manualRepairEvidenceOwners.get(event.generationId);
        if (!owner || owner !== this.currentChatId()) return;
        this.towerGenerationEvidence.append({ ...event, chatId: owner, nodeId: 'manual-variable-repair', recordedAt: this.host.now() });
        this.persistTowerGenerationEvidence(owner);
      },
    });
    const queue = new TowerGenerationQueue({ onStatus: this.onTowerGenerationStatus });
    this.towerGenerationHost = new TowerGenerationHost(towerGenerationPorts, {
      queue,
      now: () => this.host.now(),
      onAttemptLifecycle: this.onTowerGenerationAttemptLifecycle,
      onGenerationRequested: request => this.captureTowerGenerationRequest(request),
      onGenerationCompleted: (request, result) => this.captureTowerGenerationResponse(request, result),
      onGenerationFailed: (request, error) => this.captureTowerGenerationFailure(request, error),
    });
    this.towerCoordinator = options.towerCoordinator === false
      ? null
      : new TowerLookaheadCoordinator({
        snapshot: () => this.towerCoordinatorScope(),
        prepareDesignSnapshot: async () => { await this.warmup(); },
        replaceLatest: (data, chatId, messageId, base) => this.replaceLatestMvuData(data, chatId, messageId, base),
        requestGeneration: request => this.requestTowerGeneration(
          request as TowerCoordinatorGenerationRequest & TowerGenerationBridgeRequest,
        ),
        cancelGeneration: (request, reason) => this.cancelTowerGeneration(request, reason),
        onError: (message, error) => this.debug(message, error),
      });
  }

  activate(): void {
    if (this.active) return;
    const context = this.host.context();
    if (!context) {
      this.setStatus('error', 'SillyTavern 扩展上下文不可用');
      return;
    }
    this.active = true;
    this.listenerContext = context;
    settingRoot(context);
    this.towerChatId = this.currentChatId();
    this.debug('controller activated', {
      chatId: this.towerChatId,
      characterId: context.characterId,
      groupId: context.groupId,
      cardScoped: isMagicGirlWorldCharacter(context),
      tavernHelperReady: Boolean((globalThis as Record<string, any>).TavernHelper),
    });
    if (this.towerChatId) {
      this.retainInitialGenerationEvidence(this.towerChatId);
      this.retainTowerGenerationEvidence(this.towerChatId);
      this.towerGenerationHost.activateChat(this.towerChatId);
      this.restoreTowerArchiveMetadata(this.towerChatId);
    }
    this.towerCoordinator?.activateChat(this.towerChatId);
    context.eventSource.on(context.eventTypes.GENERATE_AFTER_DATA || EVENT_GENERATE_AFTER_DATA, this.onOfficialGenerateAfterData);
    context.eventSource.on(
      context.eventTypes.CHAT_COMPLETION_SETTINGS_READY || EVENT_CHAT_COMPLETION_SETTINGS_READY,
      this.onOfficialGenerateAfterData,
    );
    context.eventSource.on(context.eventTypes.CHAT_CHANGED || EVENT_CHAT_CHANGED, this.onChatChanged);
    context.eventSource.on(context.eventTypes.MESSAGE_SWIPED || 'message_swiped', this.invalidatePersistentMvuRepairs);
    context.eventSource.on(context.eventTypes.CHAT_LOADED || EVENT_CHAT_LOADED, this.onChatLoaded);
    context.eventSource.on(context.eventTypes.GENERATION_ENDED || EVENT_GENERATION_ENDED, this.onGenerationEnded);
    context.eventSource.on(EVENT_MVU_INITIALIZED, this.onMvuInitialized);
    context.eventSource.on(EVENT_CHARACTER_RUNTIME_INITIALIZED, this.onCharacterRuntimeInitialized);
    context.eventSource.on(EVENT_MVU_UPDATE_STARTED, this.onMvuUpdateStarted);
    context.eventSource.on(EVENT_MVU_UPDATE_ENDED, this.onMvuUpdateEnded);
    this.publishDashboard();
    void this.engine.initializeKnowledgeGraph().catch(error => {
      this.fail('流派知识图谱持久化失败，已继续使用内存图谱', error, false);
    });
    this.scheduleReasoningFinalRecovery('extension-activate', Boolean(this.host.mvu()));
    this.scheduleTowerChatActivityRecovery('extension-activate');
    this.scheduleInitialTowerContentRecovery('extension-activate');
    this.scheduleBattleSettlementRecovery('extension-activate');
    this.scheduleTavernHelperEventSubscription();
    this.scheduleWarmup();
  }

  deactivate(): void {
    if (!this.active) return;
    this.towerGenerationEvidence.retainChat(null);
    // The official context object can be replaced while a chat is loading.
    // Always unsubscribe from the exact event source used during activation.
    const context = this.listenerContext || this.host.context();
    const remove = context?.eventSource.removeListener?.bind(context.eventSource);
    if (remove && context) {
      remove(context.eventTypes.GENERATE_AFTER_DATA || EVENT_GENERATE_AFTER_DATA, this.onOfficialGenerateAfterData);
      remove(
        context.eventTypes.CHAT_COMPLETION_SETTINGS_READY || EVENT_CHAT_COMPLETION_SETTINGS_READY,
        this.onOfficialGenerateAfterData,
      );
      remove(context.eventTypes.CHAT_CHANGED || EVENT_CHAT_CHANGED, this.onChatChanged);
      remove(context.eventTypes.MESSAGE_SWIPED || 'message_swiped', this.invalidatePersistentMvuRepairs);
      remove(context.eventTypes.CHAT_LOADED || EVENT_CHAT_LOADED, this.onChatLoaded);
      remove(context.eventTypes.GENERATION_ENDED || EVENT_GENERATION_ENDED, this.onGenerationEnded);
      remove(EVENT_MVU_INITIALIZED, this.onMvuInitialized);
      remove(EVENT_CHARACTER_RUNTIME_INITIALIZED, this.onCharacterRuntimeInitialized);
      remove(EVENT_MVU_UPDATE_STARTED, this.onMvuUpdateStarted);
      remove(EVENT_MVU_UPDATE_ENDED, this.onMvuUpdateEnded);
    }
    const monitor = (globalThis as any).MagicGirlWorldMvuMonitor;
    monitor?.setDesignAssistant?.(null);
    this.active = false;
    this.invalidatePersistentMvuRepairs();
    this.listenerContext = null;
    this.warmupScheduled = false;
    this.warmupRerunRequested = false;
    this.latestSnapshot = null;
    if (this.towerChatId) {
      this.towerGenerationHost.queue.cancelChat(this.towerChatId, '设计辅助器已停止');
      this.towerGenerationHost.battleNarrativeQueue.cancelChat(this.towerChatId, '设计辅助器已停止');
    }
    this.towerChatId = null;
    this.publishedTowerTerminals.clear();
    this.towerRequestPromises.clear();
    this.towerActiveRequests.clear();
    this.towerActiveAttemptKeys.clear();
    this.towerNarrativePromises.clear();
    this.towerPreGenerationSnapshots.clear();
    this.singleFloorStartPromises.clear();
    this.persistentMvuRepairHost.clear();
    this.automaticSettlementAttempts.clear();
    this.settlementRecoveryWatchGeneration += 1;
    this.initialContentRecoveryWatchGeneration += 1;
    this.reasoningFinalRecoveryHost.clear();
    this.reasoningRecoveryWatchGeneration += 1;
    this.towerActivityWatchGeneration += 1;
    this.tavernHelperEventWatchGeneration += 1;
    this.tavernHelperRequestUnsubscribe?.();
    this.tavernHelperRequestUnsubscribe = null;
    this.clearMvuLifecyclePrompt('controller-deactivated');
    this.towerArchivePromise = null;
    this.archivedTowerRuns.clear();
    this.towerActivityTouches.clear();
    this.rerenderedTowerRestoreSnapshots.clear();
    this.towerActivitySavePromise = Promise.resolve();
    this.towerCoordinator?.deactivate();
    this.workerClient.dispose();
  }

  getSettings(): DesignAssistantSettings {
    const context = this.host.context();
    return context ? normalizeDesignAssistantSettings(settingRoot(context)) : clone(DEFAULT_DESIGN_ASSISTANT_SETTINGS);
  }

  getState(): DesignAssistantChatState {
    const context = this.host.context();
    return normalizeDesignAssistantChatState(context?.chatMetadata?.[DESIGN_ASSISTANT_METADATA_KEY]);
  }

  getStatus(): DesignAssistantStatus {
    return clone(this.status);
  }

  getCapabilities() {
    return {
      spec: 'mwg.design-assistant/v1' as const,
      version: '1.0.3' as const,
      towerGeneration: true as const,
      towerCoordinator: true as const,
      towerArchive: true as const,
      persistentMvuRepair: true as const,
      singleFloorStart: true as const,
      initialStartCancellation: true as const,
    };
  }

  /**
   * Start tower mode inside the existing greeting floor. One structured,
   * silent request creates the prose, player deck and opening gift together;
   * no user or assistant message is appended to SillyTavern's chat array.
   */
  async startTowerSingleFloor(input: TowerSingleFloorStartRequest): Promise<Record<string, unknown> | null> {
    const context = this.host.context();
    const chatId = this.currentChatId();
    const messageId = this.latestMessageId();
    if (!this.active || !context || !chatId || !isMagicGirlWorldCharacter(context)) return null;
    if (!input || input.spec !== 'mwg.tower-single-floor-start/v1') {
      throw new Error('爬塔单层启动请求版本无效');
    }
    if (messageId === 'latest' || input.sourceMessageId !== undefined && input.sourceMessageId !== messageId) {
      throw new Error('爬塔开场已经变化，请在最新开场页重新开始');
    }
    if (!this.isFirstAssistantFloor()) {
      throw new Error('爬塔模式只能在第一条助手开场楼层启动');
    }
    if (!this.isTowerLockedScope(chatId, messageId)) {
      throw new Error('当前存档尚未锁定为爬塔模式');
    }
    const startPrompt = String(input.prompt || '').trim();
    if (!startPrompt) throw new Error('爬塔开局请求不能为空');
    const key = `${chatId}:${messageId}`;
    const duplicate = this.singleFloorStartPromises.get(key);
    if (duplicate) return duplicate;
    const generationId = `mwg-single-floor-start-${messageId}-${this.host.now()}-${++this.initialStartSequence}`;
    let rejectCancellation!: (error: Error) => void;
    const cancellation = new Promise<never>((_, reject) => { rejectCancellation = reject; });
    const operation = { generationId, cancelled: false, committing: false,
      reject: rejectCancellation, activeIds: new Set<string>() };
    this.initialStartOperations.set(key, operation);
    const floorCountBefore = Array.isArray(context.chat) ? context.chat.length : 0;
    const promise = Promise.race([cancellation, this.executeTowerSingleFloorStart({
      chatId,
      messageId,
      generationId,
      floorCountBefore,
      startPrompt,
      config: sanitizeTowerStartConfig(input.config),
      operation,
    })]);
    this.singleFloorStartPromises.set(key, promise);
    try {
      return await promise;
    } catch (error) {
      this.onStructuredRepairProgress({
        phase: 'error',
        generationId,
        detail: error instanceof Error ? error.message : String(error),
        error,
      });
      throw error;
    } finally {
      if (this.singleFloorStartPromises.get(key) === promise) {
        this.singleFloorStartPromises.delete(key);
        if (this.initialStartOperations.get(key) === operation) this.initialStartOperations.delete(key);
        // Release only after the publication attempt has settled. A saved
        // confirmation is still required by towerCoordinatorScope on failure.
        this.towerCoordinator?.schedule('initial-publication-settled');
        (globalThis as any).MagicGirlWorldMvuMonitor?.receiveTowerGenerationStatus?.({
          spec: 'mwg.initial-publication-status/v1', ...this.getTowerInitialPublicationStatus(),
        });
      }
    }
  }

  cancelTowerInitialStart(input: { sourceMessageId: number; generationId?: string }): boolean {
    const chatId = this.currentChatId();
    const messageId = this.latestMessageId();
    if (!this.active || !chatId || messageId === 'latest' || input?.sourceMessageId !== messageId) return false;
    const operation = this.initialStartOperations.get(`${chatId}:${messageId}`);
    if (!operation || operation.cancelled || operation.committing) return false;
    if (input.generationId !== undefined && input.generationId !== operation.generationId) return false;
    // Tombstone first: even a transport that ignores stop cannot publish late output.
    operation.cancelled = true;
    const reason = '已取消本次开局，未保存生成结果；不会自动重试';
    operation.reject(new TowerGenerationCancelledError(reason));
    this.cancelTowerGeneration({ nodeId: '__initial_preset_story', requestId: `${operation.generationId}__story`, prompt: '' }, reason);
    for (const id of operation.activeIds) {
      try { this.stopInitialGeneration(id); } catch { /* Cancellation ownership does not depend on transport cooperation. */ }
    }
    return true;
  }

  getTowerInitialPublicationStatus(): { ready: boolean; busy: boolean; message: string } {
    const chatId = this.currentChatId();
    const messageId = this.latestMessageId();
    if (!chatId || messageId === 'latest' || !this.isTowerLockedScope(chatId, messageId)) {
      return { ready: true, busy: false, message: '' };
    }
    const busy = this.singleFloorStartPromises.has(`${chatId}:${messageId}`);
    if (busy) return { ready: false, busy: true, message: '正在确认开局保存，请稍候' };
    try {
      const root = this.readLatestMvuData(messageId);
      const receipt = readTowerInitialCommitReceipt(root, chatId, messageId);
      if (!receipt || !canRestoreInitialPresentation(root, receipt)
        || hasInitialPublication(this.host.context()?.chatMetadata, receipt,
          Number(this.host.context()?.chat?.[messageId]?.swipe_id ?? 0))) {
        return { ready: true, busy: false, message: '' };
      }
      return { ready: false, busy: false, message: '开局内容已生成，请先完成保存确认；不会重新生成卡组' };
    } catch (error) {
      return { ready: false, busy: false, message: error instanceof Error ? error.message : '开局凭据尚未就绪' };
    }
  }

  async resumeTowerInitialCommit(): Promise<Record<string, unknown> | null> {
    const chatId = this.currentChatId();
    const messageId = this.latestMessageId();
    if (!chatId || messageId === 'latest'
      || !readTowerInitialCommitReceipt(this.readLatestMvuData(messageId), chatId, messageId)) {
      throw new Error('当前楼层没有已提交开局，恢复保存不会调用模型新建卡组');
    }
    return this.startTowerSingleFloor({ spec: 'mwg.tower-single-floor-start/v1', sourceMessageId: messageId,
      prompt: '恢复当前已提交开局的保存与展示，不生成新内容。' });
  }

  private async executeTowerSingleFloorStart(input: {
    chatId: string;
    messageId: number;
    generationId: string;
    floorCountBefore: number;
    startPrompt: string;
    config: Record<string, string>;
    operation: { cancelled: boolean; committing: boolean };
  }): Promise<Record<string, unknown>> {
    const generationId = input.generationId;
    const scope = this.captureChatScope();
    const watchGeneration = this.initialContentRecoveryWatchGeneration;
    const sourceSwipe = this.host.context()?.chat?.[input.messageId]?.swipe_id;
    const assertScope = (): void => {
      if (input.operation.cancelled || !this.isCurrentChatScope(scope) || this.initialContentRecoveryWatchGeneration !== watchGeneration
        || !this.isTowerLockedScope(input.chatId, input.messageId)
        || this.host.context()?.chat?.[input.messageId]?.swipe_id !== sourceSwipe
        || this.host.context()?.chat?.length !== input.floorCountBefore) {
        throw new TowerGenerationCancelledError('开局期间聊天、楼层或运行状态已变化，已停止旧结果');
      }
    };
    assertScope();
    this.retainInitialGenerationEvidence(input.chatId);
    try {
    const baseline = this.readLatestMvuData(input.messageId);
    const previousReceipt = readTowerInitialCommitReceipt(baseline, input.chatId, input.messageId);
    if (previousReceipt) {
      input.operation.committing = true;
      return this.publishTowerInitialCommit(input, previousReceipt, assertScope, true);
    }
    if (hasEstablishedTowerOpening(baseline)) {
      throw new Error('当前存档已经建立开局，请继续现有旅程；重新开局需要新建存档');
    }
    const baselineKey = towerInitialStateKey(baseline);
    const initialMessage = this.host.context()?.chat?.[input.messageId]?.mes;
    const assertUnchanged = (): void => {
      assertScope();
      if (towerInitialStateKey(this.readLatestMvuData(input.messageId)) !== baselineKey
        || this.host.context()?.chat?.[input.messageId]?.mes !== initialMessage) {
        throw new TowerGenerationCancelledError('生成期间当前楼层的变量或正文已变化，未覆盖现有状态');
      }
    };
    const registryProtocol = this.getSettings().initialAuthoringProtocol === 'registry-draft';
    this.onStructuredRepairProgress({
      phase: 'begin',
      generationId,
      detail: registryProtocol ? '正在使用当前酒馆 preset 生成引导剧情' : '正在一次生成引导剧情、玩家卡组与启程馈赠',
    });
    let narrative = '';
    let openingContent: Record<string, any> | null = null;
    let lastRawOutput = '';
    let lastRejectedContent: ReturnType<typeof unwrapTowerInitialContent> | null = null;
    let initialRepairTargets: TowerInitialRepairSlotRootTarget[] = [];
    let draft = clone(baseline);
    if (!this.isTowerLockedScope(input.chatId, input.messageId)) {
      throw new TowerGenerationCancelledError('开场生成期间聊天或游戏模式已经变化');
    }
    normalizeMvuVariablesBattleInPlace(draft);
    let readiness = assessInitialTowerContent(draft);
    // This endpoint is reachable only from the first assistant greeting. Always
    // author the initial deck here, even if a stale/template snapshot happens
    // to contain playable cards; later floors never call this endpoint.
    // The alternate greeting may contain compatibility defaults. They are not
    // the player's authored deck. The legacy route needs its general guide;
    // registry drafts already carry the shared worldbook review and full DSL.
    const designGuidance = registryProtocol ? null : this.engine.createInitializationPrompt({ stat_data: { battle: { cards: [] } } });
    let registryContent: Awaited<ReturnType<DesignAssistantController['generateTowerInitialRegistryContent']>> | null = null;
    let dungeonPlan: TowerDungeonPlan | undefined;
    if (registryProtocol) {
      try { registryContent = await this.generateTowerInitialRegistryContent(input, baseline.stat_data, null, assertUnchanged); }
      catch (error) { throw error; }
    }
    let lastError = readiness?.ok
      ? '首次爬塔必须按本次玩家设定重新生成完整初始牌组'
      : readiness ? formatPlayerContentReadiness(readiness, 12) : '缺少可用的玩家初始牌组资料';
    // One authoring request followed by at most one path-scoped structural
    // repair. Unreported branches are preserved below so the repair cannot
    // become a second story/deck authoring pass.
    const maximumInitialContentAttempts = registryContent?.repairAvailable === false ? 1 : 2;
    for (let attempt = 0; attempt < maximumInitialContentAttempts; attempt += 1) {
        if (attempt > 0) {
          if (!lastRejectedContent) throw new Error('初始候选无法提取固定错误槽，已停止自动修复');
          initialRepairTargets = extractTowerInitialRepairSlotTargets(lastRejectedContent, lastError);
          if (initialRepairTargets.length === 0) {
            throw new Error(`${registryProtocol ? '开局草稿未通过完整运行校验；' : ''}程序无法把全部校验错误映射到有限安全修复槽，已停止自动修复（尚未发出本次修复请求，未写入候选内容）：${lastError}`);
          }
          this.captureInitialGenerationEvidence(input.chatId, generationId, 'repair-slot-plan', JSON.stringify({
            kind: 'tower-initial-slot-repair', targets: initialRepairTargets,
          }));
          this.onStructuredRepairProgress({phase:'begin',generationId,
            detail:`已定位 ${initialRepairTargets.reduce((sum, target) => sum + target.slots.length, 0)} 个安全修复槽，正在请求一次 AI 修复`,rawOutput:lastRawOutput});
        }
        const prompt = attempt === 0
          ? towerSingleFloorInitialContentPrompt({
              startPrompt: input.startPrompt,
              config: input.config,
              currentStat: draft.stat_data,
              designGuidance,
            })
          : towerSingleFloorInitialSlotRepairPrompt({
              validationError: lastError,
              original: lastRejectedContent!,
              targets: initialRepairTargets,
            });
        assertUnchanged();
        const generated = attempt === 0 && registryContent ? registryContent.content : await this.structuredGenerate({
          ...(registryContent?.mechanismPolicy || { structured_delivery: 'text-json' as const }),
          generation_id: `${generationId}__variables_${attempt + 1}`,
          user_input: prompt,
          should_stream: true,
          should_silence: true,
          max_chat_history: 0,
          json_schema: attempt === 0
            ? createTowerInitialContentJsonSchema({ allowCardReferences: true })
            : createTowerInitialSlotRepairJsonSchema(initialRepairTargets),
        });
        assertUnchanged();
        lastRawOutput = typeof generated === 'string' ? generated : JSON.stringify(generated, null, 2);
        if (attempt === 0 && !registryContent) this.captureInitialGenerationEvidence(input.chatId, generationId, 'provider-final', lastRawOutput);
        if (attempt > 0) this.captureInitialGenerationEvidence(input.chatId, generationId, 'repair-final', lastRawOutput);
        this.onStructuredRepairProgress({
          phase: 'applying',
          generationId,
          detail: attempt === 0 ? '开局内容已返回，正在校验卡组与馈赠' : `第 ${attempt + 1} 份修正结果已返回，正在复核`,
          rawOutput: lastRawOutput,
        });
        try {
          let parsed = attempt === 0
            ? unwrapTowerInitialContent(generated as string | Record<string, any>)
            : mergeTowerInitialSlotRepair(
                lastRejectedContent!,
                initialRepairTargets,
                parseTowerInitialSlotRepairResponse(
                  generated as string | Record<string, any>,
                  initialRepairTargets,
                ),
              );
          if (parsed.opening) parsed.opening = normalizeMvuPlayerAuthoredContent(parsed.opening);
          if (!parsed.player) throw new Error('初始化结果缺少可执行 player.cards');
          if (parsed.opening && Array.isArray(parsed.opening.choices)) {
            parsed.opening.choices = canonicalizeTowerOpeningArtifactIds(
              parsed.opening.choices,
              parsed.player,
            );
          }
          const planned = registryContent ? { narrative: parsed.narrative, dungeonPlan: registryContent.dungeonPlan }
            : parseTowerPlannedNarrative(String(parsed.narrative || ''));
          dungeonPlan = planned.dungeonPlan;
          narrative = cleanTowerNarrative(planned.narrative);
          const validationErrors: string[] = [];
          if (!narrative) validationErrors.push('初始化结果缺少玩家可读的引导剧情');
          const openingRequestId = `${generationId}__opening`;
          let parsedOpening: ReturnType<typeof parseTowerOpeningResult> | null = null;
          const openingChoicesForValidation = isRecord(parsed.opening) && Array.isArray(parsed.opening.choices)
            ? parsed.opening.choices
            : null;
          if (!parsed.opening) {
            validationErrors.push('初始化结果缺少启程馈赠 opening');
          } else {
            try {
              parsedOpening = parseTowerOpeningResult(JSON.stringify({
                spec: TOWER_OPENING_RESULT_SPEC,
                request_id: openingRequestId,
                based_on_revision: 0,
                ...clone(parsed.opening),
              }), { requestId: openingRequestId, basedOnRevision: 0 });
            } catch (error) {
              validationErrors.push(`opening：${error instanceof Error ? error.message : String(error)}`);
            }
          }
          const candidate = clone(draft);
          const previousBattle = isRecord(candidate.stat_data.battle) ? candidate.stat_data.battle : {};
          candidate.stat_data.status = isRecord(parsed.status) ? clone(parsed.status) : {};
          // Established saves were rejected above; project only this new tower opening.
          delete candidate.stat_data.npcs;
          delete candidate.stat_data.factions;
          candidate.stat_data.battle = buildInitialPlayerBattle(previousBattle, parsed.player);
          normalizeMvuVariablesBattleInPlace(candidate);
          if (attempt > 0) {
            this.captureInitialGenerationEvidence(input.chatId, generationId, 'merged-draft', JSON.stringify(parsed));
            this.captureInitialGenerationEvidence(input.chatId, generationId, 'compiled-result', JSON.stringify({ battle: candidate.stat_data.battle }));
          }
          readiness = assessInitialTowerContent(candidate);
          if (!readiness?.ok) {
            validationErrors.push(readiness ? formatPlayerContentReadiness(readiness, 14) : '缺少可用初始牌组');
          }
          // Collect alongside structural faults, not after spending the one
          // shared repair attempt. The model owns the timing change; the
          // existing exact trigger.on slot locks description/effects/siblings.
          validationErrors.push(...collectInitialTriggerTimingIssues({
            player: candidate.stat_data.battle, opening: parsed.opening,
          }).map(issue => `${issue.path}：[${issue.code}] ${issue.message.replaceAll('；', '，')}`));
          validationErrors.push(...collectAuthoredLiteralEffectIssues({
            player: candidate.stat_data.battle, opening: parsed.opening,
          }).map(issue => `${issue.path}：[${issue.code}] ${issue.message.replaceAll('；', '，')}`));
          if (openingChoicesForValidation) {
            try {
              // Reward definitions are independently inspectable even when a
              // sibling outcome field makes the opening envelope invalid. Do
              // not let that first parser error hide candidate/status errors
              // from the current bounded repair request.
              validateTowerOpeningRewardCandidates(openingChoicesForValidation, candidate.stat_data.battle);
            } catch (error) {
              validationErrors.push(`opening.choices 奖励：${error instanceof Error ? error.message : String(error)}`);
            }
          }
          if (validationErrors.length > 0) {
            this.captureInitialGenerationValidationText(input.chatId, generationId, validationErrors);
            throw new Error(validationErrors.join('；'));
          }
          if (!parsedOpening) throw new Error('初始化结果缺少可执行 opening');
          openingContent = {
            title: parsedOpening.title,
            narrative: parsedOpening.narrative,
            choices: clone(parsedOpening.choices),
          };
          draft = candidate;
          this.captureInitialGenerationEvidence(input.chatId, generationId, 'merged-draft', JSON.stringify({
            status: candidate.stat_data.status, player: candidate.stat_data.battle, opening: openingContent,
          }));
          break;
        } catch (error) {
          if (attempt === 0) {
            try {
              lastRejectedContent = unwrapTowerInitialContent(generated as string | Record<string, any>);
              if (lastRejectedContent.player) {
                lastRejectedContent.player = normalizeMvuPlayerAuthoredContent(lastRejectedContent.player);
              }
              if (lastRejectedContent.opening) {
                lastRejectedContent.opening = normalizeMvuPlayerAuthoredContent(lastRejectedContent.opening);
              }
            } catch {
              lastRejectedContent = null;
            }
          }
          lastError = error instanceof Error ? error.message : String(error);
          this.captureInitialGenerationValidationText(input.chatId, generationId, [lastError]);
          if (attempt >= maximumInitialContentAttempts - 1) {
            throw new Error(registryProtocol
              ? `开局草稿未通过完整运行校验，已停止写入：${lastError}`
              : `初始牌组经过一次快速结构修复后仍不可用：${lastError}`);
          }
          this.onStructuredRepairProgress({
            phase: 'begin',
            generationId,
            detail: `初始变量未通过校验，正在定位安全修复范围：${lastError}`,
            rawOutput: lastRawOutput,
          });
        }
    }

    readiness = assessInitialTowerContent(draft);
    if (!readiness?.ok) {
      throw new Error(`初始牌组不可用：${readiness ? formatPlayerContentReadiness(readiness, 14) : '缺少卡组数据'}`);
    }
    if (!openingContent || !narrative) throw new Error('开局剧情或启程馈赠没有通过校验');
    if (draft.stat_data.run == null) {
      ensureRunStateInStat(draft.stat_data, deriveRunSeed(draft.stat_data));
    }
    const run = validateRunState(draft.stat_data.run);
    if (!run.ok) throw new Error(`程序地图初始化失败：${run.message}`);
    const openingRequestId = `${generationId}__opening`;
    const readyRun = validateRunState({
      ...run.value,
      dungeonPlan,
      opening: {
        phase: 'ready',
        requestId: openingRequestId,
        basedOnRevision: run.value.stateRevision,
        attempts: 1,
        content: clone(openingContent),
        narrativePhase: 'ready',
        narrativeRequestId: `${openingRequestId}__narrative`,
      },
    });
    if (!readyRun.ok) throw new Error(`启程馈赠写入失败：${readyRun.message}`);
    draft.stat_data.run = readyRun.value;
    // This is stamped only while authoring a brand-new player inventory. Load
    // and publication recovery paths reuse the committed root and never scan
    // old artifacts, so an existing save cannot replay an acquisition effect.
    const initialAcquisition = createInitialArtifactAcquisitionReceipt(
      draft.stat_data.battle?.artifacts,
      generationId,
      readyRun.value.stateRevision,
    );
    if (initialAcquisition) draft.stat_data[INITIAL_ARTIFACT_ACQUISITION_KEY] = initialAcquisition;
    draft.stat_data.selected_mechanics = input.config.selectedMechanics?.trim() || '';
    const receipt: TowerInitialCommitReceipt = {
      spec: 'mwg.tower-initial-commit/v1', chatId: input.chatId, messageId: input.messageId,
      generationId, narrative, openingRequestId, runSeed: readyRun.value.seed,
      revision: readyRun.value.stateRevision, cardQuantity: readiness.deck.deckQuantity,
      stateDigest: await towerInitialStateDigest(draft.stat_data),
    };
    // One authoritative write contains BOTH the content and its recovery receipt.
    // Cache/UI writes below are derived publication, not a multi-store transaction.
    draft[TOWER_INITIAL_COMMIT_KEY] = receipt;
    assertUnchanged();
    const beforeCommit = this.readLatestMvuData(input.messageId);
    if (towerInitialStateKey(beforeCommit) !== baselineKey
      || Object.hasOwn(beforeCommit, TOWER_INITIAL_COMMIT_KEY)) {
      throw new TowerGenerationCancelledError('开局提交前变量已变化，未覆盖现有状态');
    }
    input.operation.committing = true;
    await this.replaceLatestMvuData(draft, input.chatId, input.messageId, baseline);
    assertScope();
    const committed = this.readLatestMvuData(input.messageId);
    const committedReceipt = readTowerInitialCommitReceipt(committed, input.chatId, input.messageId);
    if (!committedReceipt || towerInitialStateKey(committedReceipt) !== towerInitialStateKey(receipt)
      || towerInitialStateKey(committed.stat_data) !== towerInitialStateKey(draft.stat_data)) {
      throw new Error('开局写入后的完整状态未得到确认，已停止发布；重试将先核对现有提交，不会重建卡组');
    }
    const published = await this.publishTowerInitialCommit(input, receipt, assertScope, false, lastRawOutput);
    this.finishInitialGenerationEvidence(input.chatId, generationId, 'completed');
    this.archiveInitialGenerationEvidence(input.chatId, generationId);
    return published;
    } catch (error) {
      const history = this.initialGenerationEvidence.snapshot(input.chatId);
      if (history?.runs.some(run => run.generationId === generationId)) {
        const message = error instanceof Error ? error.message : String(error);
        this.captureInitialGenerationValidationText(input.chatId, generationId, [message]);
        this.finishInitialGenerationEvidence(input.chatId, generationId, 'failed');
        this.archiveInitialGenerationEvidence(input.chatId, generationId);
      }
      throw error;
    }
  }

  private async generateTowerInitialRegistryContent(
    input: { chatId: string; messageId: number; generationId: string; startPrompt: string; config: Record<string, string> },
    currentStat: Record<string, any>, designGuidance: string | null, assertUnchanged: () => void,
  ): Promise<{ content: CompiledInitialDraft; dungeonPlan: TowerDungeonPlan; repairAvailable: boolean; mechanismPolicy: { structured_delivery: 'text-json' } }> {
    assertUnchanged();
    this.retainInitialGenerationEvidence(input.chatId);
    const story = await this.towerGenerationHost.generateNarrative({
      chatId: input.chatId, nodeId: '__initial_preset_story', requestId: `${input.generationId}__story`,
      prompt: initialDraftNarrativePrompt(input), maxAttempts: 1,
      recoverEmptyNarrative: true,
      onEmptyNarrativeRecovery: reason => {
        assertUnchanged();
        this.onStructuredRepairProgress({ phase: 'begin', generationId: input.generationId,
          detail: `剧情首轮没有正文${reason ? `（${reason}）` : ''}，正在使用原 preset 和原模型设置重试一次；不修改思考参数` });
      },
      onNarrativeTransportRecovery: () => {
        assertUnchanged();
        this.onStructuredRepairProgress({ phase: 'begin', generationId: input.generationId,
          detail: '剧情接口发生可重试的传输错误，正在用原 preset 和原模型设置重试一次；与空正文恢复共享额度' });
      },
    });
    assertUnchanged();
    const planned = parseTowerPlannedNarrative(story.response);
    const narrative = cleanTowerNarrative(planned.narrative);
    if (!narrative) throw new Error('酒馆 preset 未返回可用引导剧情，未开始机制生成');
    this.onStructuredRepairProgress({ phase: 'begin', generationId: input.generationId, detail: '剧情已生成，正在按剧情编写精简机制草稿' });
    const mechanismPolicy = { structured_delivery: 'text-json' as const };
    const draftConfig = {
      ...mechanismPolicy,
      generation_id: `${input.generationId}__draft`, should_stream: true, should_silence: true, max_chat_history: 0,
      user_input: initialDraftAuthoringPrompt({ ...input, currentStat, designGuidance, narrative }) + `\n[私有副本规划，承接此设计但不输出规划字段]\n${JSON.stringify(planned.dungeonPlan)}`,
      json_schema: createInitialDraftJsonSchema({ includeNarrative: false }),
    } as const;
    assertUnchanged();
    // Typed transient delivery errors, empty delivery and authored content
    // repair share ONE extra mechanism request. Retry the same ordinary-text
    // request; the transport never retries or switches model parameters itself.
    let repairAvailable = true;
    let generated: string | Record<string, any>;
    try {
      generated = await this.structuredGenerate(draftConfig);
    } catch (error) {
      assertUnchanged();
      if (!(error instanceof GenerationTransportError) || !error.failure.retryable
        || !['server', 'rate_limit'].includes(error.failure.kind)) throw error;
      repairAvailable = false;
      this.onStructuredRepairProgress({ phase: 'begin', generationId: input.generationId,
        detail: '机制接口发生暂时性传输错误，正在按原参数重试一次；保留原剧情，与内容修复共享唯一额度' });
      assertUnchanged();
      generated = await this.structuredGenerate({ ...draftConfig, generation_id: `${input.generationId}__draft_transport_retry` });
    }
    assertUnchanged();
    // Keep a count even for an empty/plain-text response. Only an object-shaped
    // final payload is shown as a draft; provider reasoning is never requested
    // or copied into this diagnostic. Do this before parsing so failures do not
    // erase the distinction between no output and an invalid effects payload.
    const reportDraft = (value: unknown): void => {
      const draftOutput = typeof value === 'string' ? value : JSON.stringify(value);
      this.captureInitialGenerationEvidence(input.chatId, input.generationId, 'provider-final', draftOutput || '');
      this.onStructuredRepairProgress({ phase: 'applying', generationId: input.generationId,
        detail: `开局草稿已返回（${draftOutput?.trim().length || 0} 字符），正在解析与校验`,
        rawOutput: /^\s*(?:\{|```json\s*\{)/i.test(draftOutput || '') ? draftOutput : '',
      });
    };
    reportDraft(generated);
    // Empty finals and missing-definition repairs share that same extra request.
    // Never reauthor a nonempty draft or the established preset narrative.
    if (repairAvailable && typeof generated === 'string' && !generated.trim()) {
      repairAvailable = false;
      this.onStructuredRepairProgress({ phase: 'begin', generationId: input.generationId,
        detail: '机制草稿为空，正在用同一普通文本请求重试一次；保留原剧情与完整规则，本次不再追加定义修正' });
      assertUnchanged();
      generated = await this.structuredGenerate({
        ...draftConfig, generation_id: `${input.generationId}__draft_empty_retry`, empty_json_fallback: true,
      });
      assertUnchanged();
      reportDraft(generated);
    }
    const raw = await parseStructuredRecordWithRecovery(generated, {
      reserveRepair: () => {
        assertUnchanged();
        if (!repairAvailable) return false;
        repairAvailable = false;
        return true;
      },
      repair: async (rejected, diagnostic) => {
        this.onStructuredRepairProgress({ phase: 'begin', generationId: input.generationId,
          detail: '机制输出无法解析，正在按原契约修复一次；保留preset剧情，仍需完整校验' });
        assertUnchanged();
        const repaired = await this.structuredGenerate({
          ...draftConfig, generation_id: `${input.generationId}__draft_format_repair`,
          user_input: structuredRecordRecoveryPrompt(draftConfig.user_input, rejected, diagnostic),
        });
        assertUnchanged();
        this.captureInitialGenerationEvidence(input.chatId, input.generationId, 'repair-final',
          typeof repaired === 'string' ? repaired : JSON.stringify(repaired));
        return repaired;
      },
    });
    if (Object.hasOwn(raw, 'narrative')) throw new Error('机制草稿试图重写已成立的 preset 剧情，已停止写入');
    // The selected request route already fixes this protocol version. Supplying
    // an omitted constant is technical completion, not AI story/mechanic repair.
    // An explicitly different/null version must still fail the strict compiler.
    const versioned = Object.hasOwn(raw, 'spec') ? raw : { ...raw, spec: INITIAL_DRAFT_SPEC };
    // Some final tool arguments double-encode these object containers. Decode
    // only those exact boundaries, after raw diagnostics and before the same
    // strict compiler/semantic gates; no authored mechanism is reconstructed.
    const decoded = decodeInitialDraftContainers(versioned);
    const absentFields = normalizeInitialDraftEmptyLustCondition(normalizeInitialDraftAbsentCurseCost(decoded));
    let draft = normalizeMvuPlayerAuthoredContent({ ...absentFields, narrative });
    const envelopePlan = planInitialEnvelopeRepair(draft);
    if (envelopePlan) this.captureInitialGenerationEvidence(input.chatId, input.generationId, 'repair-slot-plan',
      JSON.stringify({ kind: 'envelope', slots: envelopePlan.slots }));
    let earlyJointUnsupported = '';
    const earlyJoint = envelopePlan && repairAvailable
      ? planTowerInitialJointRepair(draft, reason => { earlyJointUnsupported = reason; }) : null;
    if (earlyJointUnsupported) throw new Error(`开局存在无法一并修正的问题，未消耗额外请求：${earlyJointUnsupported}`);
    // Do not spend the only retry on source fields when independent rule
    // faults have already been assigned to the same joint response below.
    if (envelopePlan && repairAvailable && !earlyJoint?.targets.length) {
      repairAvailable = false;
      assertUnchanged();
      const repaired = await this.structuredGenerate({
        ...mechanismPolicy,
        generation_id: `${input.generationId}__envelope_repair`, should_stream: true, should_silence: true, max_chat_history: 0,
        user_input: [draftConfig.user_input,
          '[一次源数据修复；不重新创作已有效内容]',
          `SLOTS=${JSON.stringify(envelopePlan.slots)}`,
          `ORIGINAL_DRAFT=${JSON.stringify(envelopePlan.original)}`,
          '只返回 {replacements:{e0:修正值,...}}，恰好覆盖指定槽位并遵守valueType。容器槽返回完整容器，字段槽只返回字段值；其余字段、定义身份和正文逐值锁定。依据原剧情与原稿修复，保留可识别的机制意图，不补空占位。相互关联的值应一起满足规则，能保留原值就保留。修复后完整编译和校验，不再追加请求。',
          '带definitionId的槽是缺失定义：返回符合原契约的完整定义对象，id必须等于definitionId。程序只追加到指定定义库，不能覆盖已有定义；完整修复中的引用必须闭合。',
        ].join('\n'),
        json_schema: { name: 'mwg_initial_draft_envelope_repair', strict: false, value: {
          type: 'object', additionalProperties: false, required: ['replacements'], properties: {
            replacements: { type: 'object', additionalProperties: false, required: envelopePlan.slots.map(s => s.token),
              properties: Object.fromEntries(envelopePlan.slots.map(s => [s.token, { type: s.valueType,
                ...(s.definitionId !== undefined ? {required:['id'],properties:{id:{const:s.definitionId}}} : {}),
              }])) },
          },
        } },
      });
      assertUnchanged();
      this.captureInitialGenerationEvidence(input.chatId, input.generationId, 'repair-final', typeof repaired === 'string' ? repaired : JSON.stringify(repaired));
      draft = normalizeMvuPlayerAuthoredContent({ ...applyInitialEnvelopeRepair(envelopePlan, parseStructuredRecord(repaired)), narrative });
    }
    this.captureInitialGenerationEvidence(input.chatId, input.generationId, 'merged-draft', JSON.stringify(draft));
    let compiled = compileInitialDraftToMvu(draft);
    if (!compiled.ok) this.captureInitialGenerationValidation(input.chatId, input.generationId, compiled.diagnostics);
    if (!compiled.ok && repairAvailable) {
      const planning = planInitialDraftRegistryRepair(draft);
      let unsupportedReason = '';
      const joint = planTowerInitialJointRepair(draft, reason => { unsupportedReason = reason; });
      if (planning.kind === 'repair' || joint) {
        if (!joint) throw new Error(`开局存在无法一并修正的问题，未消耗额外请求：${unsupportedReason || '无法建立完整安全修正计划'}`);
        const registryPlan = joint.registry;
        this.captureInitialGenerationEvidence(input.chatId, input.generationId, 'repair-slot-plan',
          JSON.stringify({ kind: 'registry-and-rules', registrySlots: registryPlan.slots, ruleTargets: joint.targets, source: joint.source?.slots || [] }));
        repairAvailable = false;
        this.onStructuredRepairProgress({ phase: 'begin', generationId: input.generationId,
          detail: joint?.targets.length
            ? `正在一次修正中补齐 ${registryPlan.slots.length} 个定义和 ${joint.targets.reduce((n, root) => n + root.slots.length, 0)} 个规则槽；其余内容锁定`
            : `正在补齐 ${registryPlan.slots.length} 个缺失定义，已有剧情、卡组和馈赠保持不变` });
        assertUnchanged();
        const registrySchema = createInitialDraftRegistryRepairJsonSchema(registryPlan);
        const jointSchema = joint.targets.length || joint.source ? createTowerInitialJointRepairJsonSchema(joint) : null;
        const repaired = await this.structuredGenerate({
          ...mechanismPolicy,
          generation_id: `${input.generationId}__${jointSchema ? 'joint_repair' : 'registry_repair'}`, should_stream: true, should_silence: true, max_chat_history: 0,
          user_input: jointSchema && joint ? [
            '[一次联合修正：下述两个协议分别作为 registry 与 rules 的嵌套值，不是两次请求]',
            initialDraftRegistryRepairPrompt(registryPlan),
            towerSingleFloorInitialSlotRepairPrompt(joint),
            ...(joint.source ? [`SOURCE_SLOTS=${JSON.stringify(joint.source.slots)}`,
              '本次顶层还必须包含 source:{replacements:{e0:修正值,...}}，恰好覆盖SOURCE_SLOTS，遵守valueType；不得改变定义ID、未指定字段或卡牌规则。'] : []),
            `最终只返回 {spec:"mwg.initial-joint-repair/v1",registry:定义补齐协议对象,rules:槽位修正协议对象${joint.source ? ',source:源字段修正对象' : ''}}。rules.support_statuses/support_resources 固定为空数组。已有 when 不可在整个效果替换中删除或改变；不可通过改写说明掩盖丢失的条件或收益。没有等价合法实现时停止，不返回占位机制。`,
          ].join('\n') : initialDraftRegistryRepairPrompt(registryPlan),
          json_schema: jointSchema || registrySchema,
        });
        assertUnchanged();
        if (jointSchema && joint) {
          this.captureInitialGenerationEvidence(input.chatId, input.generationId, 'repair-final', typeof repaired === 'string' ? repaired : JSON.stringify(repaired));
          draft = normalizeMvuPlayerAuthoredContent(applyTowerInitialJointRepair(joint, parseStructuredRecord(repaired)));
          compiled = compileInitialDraftToMvu(draft);
        } else {
        this.captureInitialGenerationEvidence(input.chatId, input.generationId, 'repair-final', typeof repaired === 'string' ? repaired : JSON.stringify(repaired));
        const merged = applyInitialDraftRegistryRepair(registryPlan, parseStructuredRecord(repaired));
        if (!merged.ok) throw new Error(merged.message);
        draft = normalizeMvuPlayerAuthoredContent(merged.draft);
        compiled = compileInitialDraftToMvu(draft);
        }
      }
    }
    if (!compiled.ok && repairAvailable) {
      const plan = planInitialTemplateRepair(draft);
      if (plan) {
        repairAvailable = false;
        this.onStructuredRepairProgress({ phase: 'begin', generationId: input.generationId,
          detail: `正在修正 ${plan.slots.length} 个模板的非法根效果；身份、说明及其它规则保持不变` });
        assertUnchanged();
        const repaired = await this.structuredGenerate({ ...mechanismPolicy,
          generation_id: `${input.generationId}__template_repair`, should_stream: true, should_silence: true, max_chat_history: 0,
          user_input: initialDraftTemplateRepairPrompt(plan), json_schema: createInitialTemplateRepairSchema(plan),
        });
        assertUnchanged();
        this.captureInitialGenerationEvidence(input.chatId, input.generationId, 'repair-final', typeof repaired === 'string' ? repaired : JSON.stringify(repaired));
        draft = normalizeMvuPlayerAuthoredContent(applyInitialTemplateRepair(plan, parseStructuredRecord(repaired)));
        compiled = compileInitialDraftToMvu(draft);
      }
    }
    // Observation only: missing local producers are not global impossibility.
    try {
      this.captureInitialGenerationEvidence(input.chatId, input.generationId, 'semantic-observation',
        JSON.stringify({ status: 'reported', report: auditInitialSemanticStructure(draft) }));
    } catch {
      this.captureInitialGenerationEvidence(input.chatId, input.generationId, 'semantic-observation',
        JSON.stringify({ status: 'unavailable', reason: 'semantic diagnostic failed; no reachability conclusion' }));
    }
    if (!compiled.ok) {
      this.captureInitialGenerationValidation(input.chatId, input.generationId, compiled.diagnostics);
      throw new Error(`开局定义引用未闭合，未写入任何变量：${compiled.diagnostics.slice(0, 12)
      .map(issue => `${issue.code} ${issue.path.join('.')}: ${issue.message}`).join('；')}`);
    }
    const status = compiled.value.player.status;
    if (!isRecord(status) || ![status.time, status.location, status.profession?.name, status.profession?.ability]
      .every(value => typeof value === 'string' && value.trim().length > 0)) {
      throw new Error('机制草稿缺少剧情决定的时间、位置或职业信息；程序不会用默认值替代');
    }
    this.captureInitialGenerationEvidence(input.chatId, input.generationId, 'compiled-result', JSON.stringify(compiled.value));
    return { content: compiled.value, dungeonPlan: planned.dungeonPlan, repairAvailable, mechanismPolicy };
  }

  private async publishTowerInitialCommit(
    input: { chatId: string; messageId: number; floorCountBefore: number; generationId: string },
    receipt: TowerInitialCommitReceipt,
    assertScope: () => void,
    resumed: boolean,
    lastRawOutput = '',
  ): Promise<Record<string, unknown>> {
    assertScope();
    const draft = this.readLatestMvuData(input.messageId);
    const currentReceipt = readTowerInitialCommitReceipt(draft, input.chatId, input.messageId);
    if (towerInitialStateKey(currentReceipt) !== towerInitialStateKey(receipt)) {
      throw new Error('开局凭据已经变化，已停止展示恢复');
    }
    const run = validateRunState(draft.stat_data.run);
    if (!run.ok) throw new Error(`已提交开局的地图状态异常：${run.message}`);
    let persistenceVerified = false;
    // Once play has advanced, retry acknowledges the old initialization but
    // must not replace a newer story or replay initial inventory/resource state.
    const context = this.host.context();
    const swipeId = Number(context?.chat?.[input.messageId]?.swipe_id ?? 0);
    if (canRestoreInitialPresentation(draft, receipt)
      && !hasInitialPublication(context?.chatMetadata, receipt, swipeId)) {
      if (await towerInitialStateDigest(draft.stat_data) !== receipt.stateDigest) {
        throw new Error('已提交开局的数据摘要不匹配，未重新生成或覆盖当前内容；请检查 MVU 写入是否完整');
      }
      assertScope();
      const publicationKey = towerInitialStateKey(draft);
      const assertPublication = (): void => {
        assertScope();
        if (towerInitialStateKey(this.readLatestMvuData(input.messageId)) !== publicationKey) {
          throw new TowerGenerationCancelledError('开场展示恢复期间游戏进度已变化，已停止后续展示写入');
        }
      };
      assertPublication();
      // The complete MVU state is already committed to this message/swipe.
      // Chat variables belong to preset/user scripts, not this publisher.
      // Replacing that dictionary both erases unrelated data and creates an
      // MVU mirror which MVU removes on reload when compatibility is disabled.
      const metadata = context?.chatMetadata;
      const publication = this.host.verifyTowerInitialPersistence ? initialPublicationFor(receipt, swipeId) : undefined;
      const previousPublication = metadata?.[TOWER_INITIAL_PUBLICATION_KEY];
      const hadPreviousPublication = !!metadata && Object.hasOwn(metadata, TOWER_INITIAL_PUBLICATION_KEY);
      // The one chat save contains story + variables + this confirmation.
      // The in-flight gate prevents observers from treating it as confirmed
      // before the exact disk readback below succeeds.
      if (publication && metadata) metadata[TOWER_INITIAL_PUBLICATION_KEY] = publication;
      try {
        await this.replaceTowerGreetingWithSingleFloor(receipt.narrative, input.chatId, input.messageId, assertPublication);
        if (this.host.verifyTowerInitialPersistence) {
          assertPublication();
          await this.host.verifyTowerInitialPersistence({
            chatId: input.chatId, messageId: input.messageId, swipeId,
            message: `${receipt.narrative.trim()}\n\n<TOWER_STATUS/>`,
            variables: clone(draft), requireChatCache: false, publication,
          });
          assertPublication();
          persistenceVerified = true;
        }
      } catch (error) {
        // Undo only this attempt's in-memory confirmation. Do not rewrite a
        // switched chat, erase newer metadata, or touch the committed deck.
        if (publication && metadata
          && towerInitialStateKey(metadata[TOWER_INITIAL_PUBLICATION_KEY]) === towerInitialStateKey(publication)) {
          if (hadPreviousPublication) metadata[TOWER_INITIAL_PUBLICATION_KEY] = previousPublication;
          else delete metadata[TOWER_INITIAL_PUBLICATION_KEY];
        }
        throw error;
      }
    }
    assertScope();
    const floorCountAfter = this.host.context()?.chat?.length ?? 0;
    if (floorCountAfter !== input.floorCountBefore) {
      throw new TowerGenerationCancelledError('单层启动期间酒馆楼层发生变化，已停止继续写入');
    }
    this.saveTowerArchiveMetadata(input.chatId);
    this.scheduleTowerChatActivityTouch(draft);
    this.towerCoordinator?.schedule('single-floor-start');
    this.scheduleWarmup();
    this.onStructuredRepairProgress({
      phase: 'complete',
      generationId: input.generationId,
      detail: resumed ? '已恢复此前提交的开局，没有重新生成卡组' : '单层爬塔开场已经写回原始楼层',
      summary: `当前开局已建立 ${receipt.cardQuantity} 张起始卡牌、程序地图与启程馈赠`,
      rawOutput: lastRawOutput,
    });
    return {
      spec: 'mwg.tower-single-floor-start-result/v1',
      chatId: input.chatId,
      messageId: input.messageId,
      cardQuantity: receipt.cardQuantity,
      resumed,
      persistenceVerified,
      floorCountBefore: input.floorCountBefore,
      floorCountAfter,
    };
  }

  private async replaceTowerGreetingWithSingleFloor(
    narrative: string,
    expectedChatId: string,
    expectedMessageId: number,
    assertPublication?: () => void,
  ): Promise<void> {
    assertPublication?.();
    if (this.currentChatId() !== expectedChatId || this.latestMessageId() !== expectedMessageId) {
      throw new TowerGenerationCancelledError('写回开场前聊天楼层已经变化');
    }
    const context = this.host.context();
    const message = context?.chat?.[expectedMessageId];
    if (!context || !message || message.is_user === true || message.is_system === true) {
      throw new Error('原始助手开场楼层不可写入');
    }
    const nextMessage = `${narrative.trim()}\n\n<TOWER_STATUS/>`;
    if (typeof context.updateMessageBlock === 'function') {
      message.mes = nextMessage;
      context.updateMessageBlock(expectedMessageId, message, { rerenderMessage: true });
      await context.eventSource.emit?.(
        context.eventTypes.MESSAGE_UPDATED || 'message_updated',
        expectedMessageId,
      );
    } else {
      const helper = (globalThis as Record<string, any>).TavernHelper;
      if (typeof helper?.setChatMessages !== 'function') {
        throw new Error('当前酒馆版本不支持原楼层正文更新');
      }
      await helper.setChatMessages(
        [{ message_id: expectedMessageId, message: nextMessage }],
        { refresh: 'affected' },
      );
    }
    assertPublication?.();
    await context.saveChat?.();
    assertPublication?.();
    if (this.currentChatId() !== expectedChatId || this.latestMessageId() !== expectedMessageId) {
      throw new TowerGenerationCancelledError('写回开场时酒馆意外创建了新楼层');
    }
  }

  private runtimeMeasurement?: DesignAssistantDashboard['runtimeMeasurement'];
  private runtimeMeasurementScope = '';
  private runtimeMeasurementGeneration = 0;

  private measureDashboardBuild(variables: any, snapshot: MvuDesignSnapshot | null): void {
    if (!snapshot) return;
    const battle = variables?.stat_data?.battle;
    if (!battle) return;
    const scope = `${this.currentChatId()}:${snapshot.deckFingerprint}`;
    if (this.runtimeMeasurementScope === scope) return;
    this.runtimeMeasurementScope = scope;
    this.runtimeMeasurement = { fingerprint: snapshot.deckFingerprint, status: 'running' };
    const chatId = this.currentChatId();
    const generation = ++this.runtimeMeasurementGeneration;
    void this.encounterEvaluator.measure(battle).then(value => {
      if (generation !== this.runtimeMeasurementGeneration || !this.active || this.currentChatId() !== chatId || this.runtimeMeasurementScope !== scope
        || this.latestSnapshot?.deckFingerprint !== snapshot.deckFingerprint) return;
      this.runtimeMeasurement = { fingerprint: snapshot.deckFingerprint, status: 'ready', value };
      this.publishDashboard();
    }).catch(error => {
      if (generation !== this.runtimeMeasurementGeneration || this.currentChatId() !== chatId || this.runtimeMeasurementScope !== scope) return;
      this.runtimeMeasurement = { fingerprint: snapshot.deckFingerprint, status: 'failed',
        error: error instanceof Error ? error.message : String(error) };
      this.publishDashboard();
    });
  }

  getCharacterBuildSummary() {
    const profile = this.latestSnapshot?.deckProfile;
    return profile ? { totalScore: profile.totalScore, archetypes: profile.archetypes.map(a => ({ label: a.label })) } : null;
  }

  getDashboard(): DesignAssistantDashboard {
    const available = isMagicGirlWorldCharacter(this.host.context());
    return {
      spec: 'mwg.design-assistant-dashboard/v1',
      available,
      settings: this.getSettings(),
      status: this.getStatus(),
      threaded: this.workerClient.threaded,
      graph: this.getKnowledgeGraphStats(),
      state: this.getState(),
      snapshot: available ? clone(this.latestSnapshot) : null,
      runtimeMeasurement: available && this.runtimeMeasurementScope === `${this.currentChatId()}:${this.latestSnapshot?.deckFingerprint}`
        ? clone(this.runtimeMeasurement) : undefined,
    };
  }

  updateSettings(patch: Partial<DesignAssistantSettings>): DesignAssistantSettings {
    const next = normalizeDesignAssistantSettings({ ...this.getSettings(), ...clone(patch) });
    this.saveSettings(next);
    return clone(next);
  }

  /**
   * Persistent owner for MVU's in-place second-stage repair. It is deliberately
   * broader than tower scope so the same character's natural-language card
   * repair remains safe in story mode; unrelated character cards are no-ops.
   */
  requestMvuExtraRepair(input: PersistentMvuRepairRequest): Promise<void> | null {
    const context = this.host.context();
    const chatId = this.currentChatId();
    if (!this.active || !context || !chatId || !isMagicGirlWorldCharacter(context)) return null;
    const scopeGeneration = this.mvuRepairScopeGeneration;
    const messageId = this.latestMessageId();
    if (messageId === 'latest') return null;
    const message = context.chat?.[messageId];
    if (!message) return null;
    const swipeId = message.swipe_id ?? 0;
    const isCurrent = () => (
      this.active &&
      this.mvuRepairScopeGeneration === scopeGeneration &&
      this.currentChatId() === chatId &&
      this.latestMessageId() === messageId &&
      this.host.context()?.chat?.[messageId] === message &&
      (message.swipe_id ?? 0) === swipeId &&
      isMagicGirlWorldCharacter(this.host.context())
    );
    return (async () => {
      const deadline = Date.now() + TAVERN_HELPER_REPAIR_WAIT_MS;
      while (isCurrent() && Date.now() <= deadline) {
        const helper = createEventBridgedTavernHelper(
          (globalThis as any).TavernHelper,
          context,
        );
        if (hasRepairHelperCapabilities(helper)) {
          await this.persistentMvuRepairHost.request(helper, chatId, input, isCurrent);
          return;
        }
        await new Promise<void>(resolve => globalThis.setTimeout(resolve, TAVERN_HELPER_REPAIR_POLL_MS));
      }
      if (!isCurrent()) throw new Error('聊天已切换，已取消旧存档的 MVU 修复');
      throw new Error('Tavern Helper 额外模型修复接口尚未就绪');
    })();
  }

  private readonly manualRepairEvidenceOwners = new Map<string, string>();
  private readonly onStructuredRepairProgress = (event: {
    phase: 'begin' | 'applying' | 'complete' | 'error';
    generationId: string;
    detail: string;
    rawOutput?: string;
    summary?: string;
    error?: unknown;
  }): void => {
    // Manual patches use the same durable final-output archive as automatic
    // repairs. Bind ownership at begin so late responses cannot leak chats.
    if (event.generationId.startsWith('mwg-stat-data-repair-')) {
      const chatId = this.currentChatId();
      if (event.phase === 'begin' && chatId) this.manualRepairEvidenceOwners.set(event.generationId, chatId);
      const owner = this.manualRepairEvidenceOwners.get(event.generationId);
      if (owner && owner === chatId) {
        if (event.rawOutput) this.captureInitialGenerationEvidence(owner, event.generationId, 'repair-final', event.rawOutput);
        if (event.phase === 'error') this.captureInitialGenerationValidationText(owner, event.generationId, [event.detail]);
        if (event.phase === 'complete' || event.phase === 'error') {
          this.finishInitialGenerationEvidence(owner, event.generationId, event.phase === 'complete' ? 'completed' : 'failed');
        }
      }
      if (event.phase === 'complete' || event.phase === 'error') this.manualRepairEvidenceOwners.delete(event.generationId);
    }
    // The monitor is a display observer. Its rendering failure must not turn a
    // returned draft into a generation failure or bypass parser/validator errors.
    try {
      const monitor = this.towerMonitor();
      if (event.phase === 'begin') {
        monitor?.beginStructuredOperation?.({
          generationId: event.generationId,
          detail: event.detail,
          rawOutput: event.rawOutput,
        });
        return;
      }
      if (event.phase === 'applying') {
        monitor?.applyStructuredOperation?.({
          generationId: event.generationId,
          detail: event.detail,
          rawOutput: event.rawOutput,
        });
        return;
      }
      if (event.phase === 'complete') {
        monitor?.completeStructuredOperation?.({
          generationId: event.generationId,
          summary: event.summary || event.detail,
          rawOutput: event.rawOutput,
        });
        return;
      }
      monitor?.fail?.(event.error || new Error(event.detail), event.generationId);
    } catch (error) {
      this.debug('structured generation progress display failed', error);
    }
  };

  /**
   * The first MVU response owns initialization. The persistent extension only
   * canonicalizes mechanically equivalent field spellings and opens the map
   * after that single response is valid; it never starts a second automatic
   * initialization request.
   */
  private scheduleInitialTowerContentRecovery(reason: string): void {
    if (!this.active) return;
    const watchGeneration = ++this.initialContentRecoveryWatchGeneration;
    globalThis.queueMicrotask(() => {
      void (async () => {
        const deadline = Date.now() + 45_000;
        while (
          this.active
          && watchGeneration === this.initialContentRecoveryWatchGeneration
          && Date.now() <= deadline
        ) {
          const context = this.host.context();
          const chatId = this.currentChatId();
          const messageId = this.latestMessageId();
          if (!context || !chatId || messageId === 'latest' || !isMagicGirlWorldCharacter(context)) {
            await new Promise<void>(resolve => globalThis.setTimeout(resolve, 150));
            continue;
          }
          const message = context.chat?.[messageId];
          if (
            !message
            || message.is_user !== false
            || message.is_system === true
            || typeof message.mes !== 'string'
            || !message.mes.trim()
          ) return;
          // The dedicated first-floor tower page owns initialization. A
          // template deck may already be present in the greeting variables;
          // never mistake it for the player's generated deck before they
          // press Start.
          if (message.mes.includes('[爬塔模式开场]')) return;
          const persisted = readPersistedMessageVariableSnapshot(context, messageId);
          if (!persisted) {
            await new Promise<void>(resolve => globalThis.setTimeout(resolve, 150));
            continue;
          }
          const root = normalizeLatestMvuRoot(persisted.variables);
          if (!root) {
            await new Promise<void>(resolve => globalThis.setTimeout(resolve, 150));
            continue;
          }
          const stat = root.stat_data;
          const lock = isRecord(stat?.game_mode_lock) ? stat.game_mode_lock : null;
          if (lock?.schemaVersion !== 1 || lock.mode !== 'tower' || stat?.run != null) return;

          const draft = clone(root);
          normalizeMvuVariablesBattleInPlace(draft);
          const readiness = assessInitialTowerContent(draft);
          if (readiness?.ok) {
            ensureRunStateInStat(draft.stat_data, deriveRunSeed(draft.stat_data));
            await this.replaceLatestMvuData(draft, chatId, messageId, root);
            this.scheduleTowerChatActivityTouch(draft);
            this.scheduleTowerGeneration(`initial-content-ready:${reason}`);
            this.debug(`initialized tower run after durable player-content gate (${reason})`, {
              chatId,
              messageId,
            });
            return;
          }

          // Do not spend an attempt while the first MVU pass has not exposed a
          // battle object yet. It may still arrive on the immediately following
          // update-ended event.
          if (!readiness) {
            await new Promise<void>(resolve => globalThis.setTimeout(resolve, 250));
            continue;
          }
          this.setStatus(
            'error',
            `首轮变量没有生成可用初始牌组：${formatPlayerContentReadiness(readiness, 4)}`,
          );
          this.debug(`initial tower content gate rejected the first MVU result (${reason})`, {
            readiness: formatPlayerContentReadiness(readiness, 8),
          });
          return;
        }
        this.debug(`initial tower content recovery timed out (${reason})`);
      })().catch(error => this.debug(`initial tower content recovery failed (${reason})`, error));
    });
  }

  /**
   * Battle result variables can survive a reload even when the ordinary MVU
   * iframe that should finish rewards or penalties no longer exists. Re-read
   * the selected assistant floor and let the persistent extension finish only
   * the settlement transaction. One automatic attempt per floor prevents a
   * malformed provider response from becoming an infinite request loop.
   */
  private scheduleBattleSettlementRecovery(reason: string): void {
    if (!this.active) return;
    const watchGeneration = ++this.settlementRecoveryWatchGeneration;
    globalThis.queueMicrotask(() => {
      void (async () => {
        const deadline = Date.now() + 20_000;
        let lastObservedChatId: string | null = null;
        let lastObservedMessageId: number | 'latest' = 'latest';
        while (
          this.active
          && watchGeneration === this.settlementRecoveryWatchGeneration
          && Date.now() <= deadline
        ) {
          const expectedChatId = this.currentChatId();
          const expectedMessageId = this.latestMessageId();
          lastObservedChatId = expectedChatId;
          lastObservedMessageId = expectedMessageId;
          if (!expectedChatId) {
            await new Promise<void>(resolve => globalThis.setTimeout(resolve, 150));
            continue;
          }
          if (expectedMessageId === 'latest') {
            await new Promise<void>(resolve => globalThis.setTimeout(resolve, 150));
            continue;
          }
          const attemptKey = `${expectedChatId}:${expectedMessageId}`;
          if (this.automaticSettlementAttempts.has(attemptKey)) return;
          const context = this.host.context();
          const latestMessage = context?.chat?.[expectedMessageId];
          // A battle summary is first appended as a user floor. Message-level
          // variables are inherited there, so the unfinished settlement marker
          // can already be visible before the narrative model creates its
          // assistant floor. Starting the repair on that transient user floor
          // makes getLastMessageId() change while the structured model is still
          // running and is then (correctly, but misleadingly) rejected as a
          // chat switch. Only a persisted, non-empty assistant floor owns the
          // settlement transaction.
          if (
            !latestMessage
            || latestMessage.is_user !== false
            || latestMessage.is_system === true
            || typeof latestMessage.mes !== 'string'
            || !latestMessage.mes.trim()
          ) return;
          // Do not use Tavern Helper's inherited value as the readiness signal.
          // A streaming assistant floor can resolve the battle request that was
          // attached to the preceding user summary even though this assistant
          // has not finished its own MVU update. Starting a structured repair
          // at that point produces “current assistant floor has no MVU
          // variables” and consumes the only automatic attempt. The exact
          // message snapshot is the authoritative ownership boundary.
          const attachedSnapshot = readPersistedMessageVariableSnapshot(context, expectedMessageId);
          if (!attachedSnapshot) {
            await new Promise<void>(resolve => globalThis.setTimeout(resolve, 150));
            continue;
          }
          if (!hasPendingBattleSettlement(attachedSnapshot.variables)) return;
          const helper = createEventBridgedTavernHelper(
            (globalThis as Record<string, any>).TavernHelper,
            context,
          );
          if (context && isMagicGirlWorldCharacter(context) && hasRepairHelperCapabilities(helper)) {
            // The top-window extension can see message variables before the
            // card iframe has registered its monitor. Waiting here keeps the
            // automatic structured request visible instead of silently losing
            // its begin event during a cold chat restore.
            if (!this.towerMonitor()) {
              await new Promise<void>(resolve => globalThis.setTimeout(resolve, 150));
              continue;
            }
            this.automaticSettlementAttempts.add(attemptKey);
            const request = normalizeLatestMvuRoot(attachedSnapshot.variables)?.stat_data?.reward?.request;
            this.debug(`detected unfinished battle settlement (${reason})`, {
              chatId: expectedChatId,
              messageId: expectedMessageId,
              result: request?.result,
            });
            const repair = this.requestMvuExtraRepair({
              spec: 'mwg.mvu-repair-request/v1',
              scope: 'battle-settlement',
              prompt: [
                '[MVU_BATTLE_SETTLEMENT]',
                '自动完成当前战斗结算。只生成程序请求规定的奖励候选与剧情已经支持的持久后果；不要改写战斗结果或其他变量。',
              ].join('\n'),
            });
            if (repair) await repair;
            return;
          }
          await new Promise<void>(resolve => globalThis.setTimeout(resolve, 150));
        }
        this.debug(`battle settlement recovery prerequisites unavailable (${reason})`, {
          chatId: lastObservedChatId,
          messageId: lastObservedMessageId,
        });
      })().catch(error => {
        // Keep reward.request untouched. The player can still use the manual
        // natural-language repair button after inspecting the provider error.
        this.debug(`automatic battle settlement repair failed (${reason})`, error);
      });
    });
  }

  /**
   * Generate and commit a campfire card mutation without creating a Tavern
   * user/assistant floor. The extension owns the model request and the final
   * MVU transaction, so a story preset can neither turn the request into prose
   * nor leave a half-written `run_upgrade` marker behind.
   */
  requestRestMutation(input: RestMutationBridgeRequest): Promise<unknown> | null {
    const chatId = this.currentChatId();
    const messageId = this.latestMessageId();
    if (!this.active || !chatId || !this.isTowerLockedScope(chatId, messageId)) return null;
    if (
      !isRecord(input)
      || input.spec !== 'mwg.rest-mutation-request/v1'
      || !['upgrade', 'transform'].includes(String(input.kind))
    ) throw new Error('营火后台请求无效');
    const nodeId = String(input.nodeId || '').trim();
    const identity = String(input.runInstanceId || input.cardId || '').trim();
    if (!nodeId || !identity) throw new Error('营火后台请求缺少节点或卡牌身份');
    const key = `${chatId}:${messageId}:${nodeId}:${input.kind}:${identity}`;
    const duplicate = this.restMutationPromises.get(key);
    if (duplicate) return duplicate;

    const generationId = `mwg-rest-${input.kind}-${messageId}-${this.host.now()}`;
    const promise = (async () => {
      const monitor = this.towerMonitor();
      monitor?.beginStructuredOperation?.({
        generationId,
        detail: input.kind === 'upgrade' ? '正在为选中的卡牌生成升级方案' : '正在为选中的卡牌生成变形结果',
      });
      try {
        const before = this.readLatestMvuData(messageId);
        const stat = before.stat_data;
        const runResult = validateRunState(stat?.run);
        if (!runResult.ok) throw new Error(`爬塔状态无效：${runResult.message}`);
        const run = runResult.value;
        if (run.routeMode === 'map') throw new Error('营火只提供休息、锻炼、搜刮和回忆，请重新打开营火');
        if (run.phase !== 'in_node' || run.currentNode?.kind !== 'rest' || run.currentNode.id !== nodeId) {
          throw new Error('营火节点已经变化，请重新选择卡牌');
        }
        const cards = migratePersistentRunDeck(
          normalizeMvuList<Record<string, any>>(stat?.battle?.cards),
        );
        const selected = cards.find(card => card.runInstanceId === input.runInstanceId)
          || cards.find(card => card.id === input.cardId);
        if (!selected) throw new Error('选中的营火卡牌已经不存在');
        // The whole deck is a gameplay fact. A late card can be the build's
        // only enabler, curse, or off-archetype burden, so truncating by index
        // makes upgrade/transform advice materially wrong.
        const completeDeck = cards.map(card => ({
          id: card.id,
          name: card.name,
          type: card.type,
          rarity: card.rarity,
          cost: card.cost,
          effects: card.effects,
          trigger: card.trigger,
          upgrade_level: card.upgrade_level,
        }));
        const foundationContext = JSON.stringify(buildTowerFoundationGuidance(
          createContentPackFromMvuBattle(stat.battle || {}),
          typeof stat.selected_mechanics === 'string' ? stat.selected_mechanics : '',
        ));
        const prompt = input.kind === 'upgrade'
          ? [
              '你是魔法少女世界爬塔模式的营火卡牌升级器。只生成数据，不续写剧情。',
              `节点固定为 ${nodeId}。只升级这张牌：${JSON.stringify(compactCardForUpgrade(selected))}`,
              `当前完整牌组用于判断构筑方向：${JSON.stringify(completeDeck)}`,
              `玩家流派偏好与实际机制证据：${foundationContext}`,
              '返回 {"patch":升级补丁}。patch 必须包含原 node_id、card_id，并且只做一次有意义的规则强化。',
              '不要修改卡牌身份、来源、数量或运行实例；不要输出 description、剧情、Markdown、UpdateVariable 或解释。',
            ].join('\n')
          : [
              '你是魔法少女世界爬塔模式的营火卡牌变形器。只生成数据，不续写剧情。',
              `节点固定为 ${nodeId}。待变形卡牌：${JSON.stringify(compactCardForUpgrade(selected))}`,
              `当前完整牌组用于判断构筑方向：${JSON.stringify(completeDeck)}`,
              `玩家流派偏好与实际机制证据：${foundationContext}`,
              '返回 {"card":一张完整、合法、quantity=1 的替换卡牌}。新牌应保持相近稀有度与强度，但玩法明显不同并尽量服务当前构筑。',
              '不要写 runInstanceId、templateId、origin、parentRunInstanceId、$meta；不要输出剧情、Markdown、UpdateVariable 或解释。',
            ].join('\n');
        const generated = await this.structuredGenerate({
          generation_id: generationId,
          structured_delivery: 'text-json',
          user_input: prompt,
          should_stream: true,
          should_silence: true,
          max_chat_history: 0,
          json_schema: restMutationJsonSchema(input.kind),
        });
        const parsed = parseStructuredRecord(generated);
        const rawOutput = typeof generated === 'string' ? generated : JSON.stringify(generated, null, 2);
        monitor?.applyStructuredOperation?.({
          generationId,
          detail: '方案已返回，正在校验卡牌并写入当前楼层',
          rawOutput,
        });

        const draft = this.readLatestMvuData(messageId);
        const currentRun = validateRunState(draft.stat_data?.run);
        if (!currentRun.ok) throw new Error(`爬塔状态无效：${currentRun.message}`);
        if (
          currentRun.value.stateRevision !== run.stateRevision
          || currentRun.value.phase !== 'in_node'
          || currentRun.value.currentNode?.id !== nodeId
        ) throw new Error('营火状态在生成期间已经变化，本次结果未写入');
        const transaction = input.kind === 'upgrade'
          ? executeUnifiedRunTransactionInStat(draft.stat_data, {
              kind: 'rest_upgrade_card',
              runInstanceId: selected.runInstanceId,
              patch: parsed.patch,
              expectedRevision: run.stateRevision,
              source: { kind: 'player', id: 'tower-rest-ui' },
            })
          : executeUnifiedRunTransactionInStat(draft.stat_data, {
              kind: 'rest_transform_card',
              runInstanceId: selected.runInstanceId,
              replacement: parsed.card,
              expectedRevision: run.stateRevision,
              source: { kind: 'player', id: 'tower-rest-ui' },
            });
        await this.replaceLatestMvuData(draft, chatId, messageId);
        this.scheduleTowerChatActivityTouch(draft);
        this.towerCoordinator?.requestRecovery();
        this.scheduleWarmup();
        monitor?.completeStructuredOperation?.({
          generationId,
          summary: transaction.log.summary,
          rawOutput,
        });
        return clone(transaction.value);
      } catch (error) {
        this.towerMonitor()?.fail?.(error, generationId);
        throw error;
      }
    })().finally(() => {
      if (this.restMutationPromises.get(key) === promise) this.restMutationPromises.delete(key);
    });
    this.restMutationPromises.set(key, promise);
    return promise;
  }

  queryKnowledgeGraph(ids: string[] = [], depth = 1) {
    return this.engine.queryKnowledgeGraph(ids, this.getState().lineage, depth);
  }

  /**
   * Trusted parent-window endpoint used by the character iframe. Story mode,
   * other character cards, unlocked saves and inactive controllers are strict
   * no-ops and never touch Tavern Helper's message or generation APIs.
   */
  async requestTowerGeneration(
    input: TowerGenerationBridgeRequest,
  ): Promise<TowerGenerationResult | null> {
    const chatId = this.currentChatId();
    const messageId = this.latestMessageId();
    if (!this.active || !chatId || !this.isTowerLockedScope(chatId, messageId)) return null;
    if (!input || typeof input !== 'object') return null;
    if (input.sourceMessageId !== undefined && input.sourceMessageId !== messageId) {
      throw new TowerGenerationCancelledError('The tower request belongs to an older message floor.');
    }
    if (!this.getTowerInitialPublicationStatus().ready) {
      throw new TowerGenerationCancelledError('请先完成开局保存确认，再生成节点或馈赠。');
    }
    const normalized = this.normalizeTowerRequest(chatId, input, messageId);
    const beforeGeneration = this.readLatestMvuData(messageId);
    const currentRun = validateRunState(beforeGeneration.stat_data?.run);
    // Node ids, request ids and revision counters intentionally restart when
    // the player begins another run in the same single-floor chat. Carry the
    // durable run seed into every queue/host/controller key so a terminal job
    // from the previous run cannot shadow the new model request.
    normalized.request.runScope = currentRun.ok
      ? `tower-run-seed:${currentRun.value.seed}`
      : `tower-message:${String(messageId)}`;
    const key = towerGenerationTaskKey(normalized.request);
    const duplicate = this.towerRequestPromises.get(key);
    if (duplicate) return duplicate;

    const promise = this.executeTowerGeneration(normalized, beforeGeneration).finally(() => {
      if (this.towerActiveRequests.get(normalized.request.requestId) === normalized) {
        this.towerActiveRequests.delete(normalized.request.requestId);
      }
    });
    this.towerPreGenerationSnapshots.set(towerGenerationTaskKey(normalized.request), clone(beforeGeneration));
    this.towerRequestPromises.set(key, promise);
    this.towerActiveRequests.set(normalized.request.requestId, normalized);
    return promise;
  }

  /**
   * Low-level archive primitive. A coordinator may call it only when the run
   * is won/lost or explicitly exited; ordinary node completion is not an
   * archive boundary. Active battle sessions always return false.
   */
  async persistTowerGeneration(
    keyInput: Pick<TowerGenerationBridgeRequest, 'nodeId' | 'requestId'>,
  ): Promise<boolean | null> {
    const chatId = this.currentChatId();
    const messageId = this.latestMessageId();
    if (!this.active || !chatId || !this.isTowerLockedScope(chatId, messageId)) return null;
    const key = {
      chatId,
      nodeId: String(keyInput?.nodeId || '__tower_opening__'),
      requestId: String(keyInput?.requestId || ''),
    };
    const latestMvuData = this.readLatestMvuData(messageId);
    if (this.hasActiveBattleSession(latestMvuData)) return false;
    // The committed run state is the authoritative save. Appending hidden
    // request/response floors breaks single-floor play and duplicates the
    // full prompt and response during a long run.
    this.releaseTowerGenerationRecord(key);
    this.saveTowerArchiveMetadata(chatId);
    return true;
  }

  async retryTowerGeneration(input: { generationType?: 'node' | 'opening'; nodeId?: string }): Promise<boolean | null> {
    const chatId = this.currentChatId();
    if (!this.active || !chatId || !this.isTowerLockedScope(chatId) || !this.towerCoordinator) return null;
    const latest = this.readLatestMvuData(this.latestMessageId());
    const parsed = validateRunState(latest.stat_data?.run);
    if (!parsed.ok) throw new Error(`爬塔存档不可用：${parsed.message}`);
    if (input?.generationType === 'opening' || input?.nodeId === '__tower_opening__' || input?.nodeId === 'tower-opening') {
      if (parsed.value.opening.phase === 'failed' && parsed.value.opening.requestId) {
        this.forgetTowerGenerationRecord({
          chatId,
          nodeId: '__tower_opening__',
          requestId: parsed.value.opening.requestId,
        });
      }
      return this.towerCoordinator.retryOpening();
    }
    let nodeId = String(input?.nodeId || '').trim();
    if (!nodeId) {
      if (parsed.value.opening.phase === 'failed') {
        if (parsed.value.opening.requestId) {
          this.forgetTowerGenerationRecord({
            chatId,
            nodeId: '__tower_opening__',
            requestId: parsed.value.opening.requestId,
          });
        }
        return this.towerCoordinator.retryOpening();
      }
      nodeId = nearestReachableFailedTowerNode(parsed.value);
    }
    if (!nodeId) throw new Error('当前存档中没有可重试的爬塔节点');
    const envelope = parsed.value.nodeContent[nodeId];
    if (envelope?.phase === 'failed' && envelope.requestId) {
      this.forgetTowerGenerationRecord({ chatId, nodeId, requestId: envelope.requestId });
    }
    return this.towerCoordinator.retryNode(nodeId);
  }

  /** Wake the idempotent coordinator after a character-page program write. */
  scheduleTowerGeneration(reason = 'character-runtime'): boolean {
    const chatId = this.currentChatId();
    if (!this.active || !chatId || !this.isTowerLockedScope(chatId)) return false;
    const normalizedReason = String(reason || 'character-runtime').trim().slice(0, 80) || 'character-runtime';
    void this.scheduleTowerNarrativeForOpening(normalizedReason);
    void this.scheduleTowerNarrativeForActiveNode(normalizedReason);
    void this.scheduleTowerBattleNarrative();
    this.towerCoordinator?.schedule(`runtime:${normalizedReason}`);
    return true;
  }

  /** Independent of route/reward settlement and coordinator readiness. */
  private async scheduleTowerBattleNarrative(): Promise<void> {
    const chatId = this.currentChatId();
    const messageId = this.latestMessageId();
    if (!this.active || !chatId || !this.isTowerLockedScope(chatId, messageId)) return;
    const before = this.readLatestMvuData(messageId);
    const seed = (before.stat_data?.run || before.stat_data?.completed_expedition?.run)?.seed;
    const story = towerBattleStories(before.stat_data || {}).find(entry => entry.seed === seed && ['pending', 'generating'].includes(entry.phase));
    if (!story) return;
    const request: TowerGenerationRequest = {
      chatId, nodeId: story.nodeId, requestId: `${story.nodeId}__post_battle`,
      runScope: `tower-run-seed:${seed}`, prompt: towerBattleNarrativePrompt(story, before.stat_data), maxAttempts: 2,
      userExtra: { mwg_tower_post_battle: true }, assistantExtra: { mwg_tower_post_battle: true },
    };
    const key = towerGenerationTaskKey(request);
    if (this.towerNarrativePromises.has(key)) return;
    const update = async (phase: 'generating' | 'ready' | 'failed' | 'skipped', narrative = '', error?: string) => {
      if (this.currentChatId() !== chatId || this.latestMessageId() !== messageId || !this.active) return;
      const draft = this.readLatestMvuData(messageId);
      if ((draft.stat_data?.run || draft.stat_data?.completed_expedition?.run)?.seed !== seed) return;
      const target = towerBattleStories(draft.stat_data || {}).find(entry => entry.seed === seed && entry.nodeId === story.nodeId);
      if (!target || !['pending', 'generating'].includes(target.phase)) return;
      Object.assign(target, { phase, narrative });
      if (error) target.error = error; else delete target.error;
      await this.replaceLatestMvuData(draft, chatId, messageId);
      this.saveTowerArchiveMetadata(chatId);
    };
    const promise = (async () => {
      try {
        if (this.getSettings().towerBattleNarrative === false) { await update('skipped'); return; }
        await update('generating');
        const result = await this.towerGenerationHost.generateNarrative(request, true);
        const narrative = cleanTowerNarrative(result.response);
        if (!narrative) throw new Error('战后剧情返回为空');
        await update(this.getSettings().towerBattleNarrative === false ? 'skipped' : 'ready', narrative);
      } catch (error) {
        if (error instanceof TowerGenerationCancelledError) { await update('skipped'); } else {
          await update('failed', '', error instanceof Error ? error.message : String(error));
        }
      }
    })().catch(error => this.debug('战后剧情保存失败；不回滚结算', error)).finally(() => {
      this.towerNarrativePromises.delete(key);
      this.towerGenerationHost.forgetTerminalRecord(request);
    });
    this.towerNarrativePromises.set(key, promise);
    await promise;
    if (this.active && this.currentChatId() === chatId && this.latestMessageId() === messageId) {
      const latest = towerBattleStories(this.readLatestMvuData(messageId).stat_data || {});
      if (latest.some(entry => entry.seed === seed && entry.nodeId === story.nodeId && ['ready', 'failed', 'skipped'].includes(entry.phase))
        && latest.some(entry => entry.seed === seed && entry.nodeId !== story.nodeId && ['pending', 'generating'].includes(entry.phase))) {
        await this.scheduleTowerBattleNarrative();
      }
    }
  }

  /** Replace the structured opening's fallback summary with prose from the player's current preset. */
  private async scheduleTowerNarrativeForOpening(reason: string): Promise<void> {
    const chatId = this.currentChatId();
    const messageId = this.latestMessageId();
    if (!this.active || !chatId || !this.isTowerLockedScope(chatId, messageId)) return;
    const before = this.readLatestMvuData(messageId);
    const run = validateRunState(before.stat_data?.run);
    if (!run.ok || run.value.opening.phase !== 'ready' || !isRecord(run.value.opening.content)) return;
    const opening = run.value.opening;
    const openingContent = opening.content as Record<string, any>;
    if (opening.narrativePhase === 'ready' || opening.narrativePhase === 'failed') return;
    const openingRequestId = String(opening.requestId || '').trim();
    const requestId = String(opening.narrativeRequestId || `${openingRequestId}__narrative`).trim();
    if (!openingRequestId || !requestId) return;
    const request: TowerGenerationRequest = {
      chatId,
      nodeId: '__tower_opening__',
      requestId,
      runScope: `tower-run-seed:${run.value.seed}`,
      prompt: towerOpeningNarrativePrompt(before.stat_data, openingContent),
      maxAttempts: 2,
      userExtra: { mwg_tower_opening_narrative: true, reason },
      assistantExtra: { mwg_tower_opening_narrative: true },
    };
    const key = towerGenerationTaskKey(request);
    if (this.towerNarrativePromises.has(key)) return this.towerNarrativePromises.get(key)!;

    const promise = (async () => {
      const claimed = clone(before);
      const claimedRun = validateRunState(claimed.stat_data?.run);
      if (
        !claimedRun.ok ||
        claimedRun.value.opening.phase !== 'ready' ||
        claimedRun.value.opening.requestId !== openingRequestId ||
        !isRecord(claimedRun.value.opening.content)
      ) return;
      const claimedOpening = {
        ...claimedRun.value.opening,
        narrativePhase: 'generating' as const,
        narrativeRequestId: requestId,
        narrativeError: undefined,
      };
      const claimedCandidate = validateRunState({ ...claimedRun.value, opening: claimedOpening });
      if (!claimedCandidate.ok) throw new Error(`开局剧情生成状态无效：${claimedCandidate.message}`);
      claimed.stat_data.run = claimedCandidate.value;
      await this.replaceLatestMvuData(claimed, chatId, messageId, before);
      this.towerPreGenerationSnapshots.set(key, clone(before));

      try {
        const result = await this.towerGenerationHost.generateNarrative(request);
        const narrative = cleanTowerNarrative(result.response);
        if (!narrative) throw new Error('剧情模型返回内容在移除变量标记后为空');
        const draft = this.readLatestMvuData(messageId);
        const currentRun = validateRunState(draft.stat_data?.run);
        if (
          !currentRun.ok ||
          currentRun.value.opening.phase !== 'ready' ||
          currentRun.value.opening.requestId !== openingRequestId ||
          currentRun.value.opening.narrativeRequestId !== requestId ||
          !isRecord(currentRun.value.opening.content)
        ) {
          throw new TowerGenerationCancelledError('开局剧情返回时玩家已经离开馈赠事件');
        }
        const content = clone(currentRun.value.opening.content);
        content.narrative = narrative;
        content.narrative_source = 'preset';
        const readyOpening = {
          ...currentRun.value.opening,
          content,
          narrativePhase: 'ready' as const,
          narrativeError: undefined,
        };
        const readyCandidate = validateRunState({ ...currentRun.value, opening: readyOpening });
        if (!readyCandidate.ok) throw new Error(`开局剧情提交状态无效：${readyCandidate.message}`);
        draft.stat_data.run = readyCandidate.value;
        await this.replaceLatestMvuData(draft, chatId, messageId);
        this.saveTowerArchiveMetadata(chatId);
        const payload: TowerGenerationCompletedPayload = {
          spec: 'mwg.tower-generation/v1',
          chatId,
          nodeId: '__tower_opening__',
          requestId,
          runScope: request.runScope,
          prompt: request.prompt,
          response: result.response,
          generationId: result.generationId,
          completedAt: this.host.now(),
          parsedResult: { type: 'opening_narrative', narrative },
          mvuData: clone(draft),
        };
        await this.towerGenerationHost.dispatchCompletion(request, payload);
        this.publishTowerCompletion(payload);
        this.releaseTowerGenerationRecord(request);
      } catch (error) {
        if (error instanceof TowerGenerationCancelledError) throw error;
        try {
          const failedDraft = this.readLatestMvuData(messageId);
          const failedRun = validateRunState(failedDraft.stat_data?.run);
          if (
            failedRun.ok &&
            failedRun.value.opening.phase === 'ready' &&
            failedRun.value.opening.requestId === openingRequestId &&
            failedRun.value.opening.narrativeRequestId === requestId
          ) {
            const failedOpening = {
              ...failedRun.value.opening,
              narrativePhase: 'failed' as const,
              narrativeError: error instanceof Error ? error.message : String(error),
            };
            const failedCandidate = validateRunState({ ...failedRun.value, opening: failedOpening });
            if (!failedCandidate.ok) throw new Error(`开局剧情失败状态无效：${failedCandidate.message}`);
            failedDraft.stat_data.run = failedCandidate.value;
            await this.replaceLatestMvuData(failedDraft, chatId, messageId);
            this.publishTowerFailure({
              spec: 'mwg.tower-generation-failure/v1',
              chatId,
              nodeId: '__tower_opening__',
              requestId,
              runScope: request.runScope,
              error: failedOpening.narrativeError,
              failedAt: this.host.now(),
              mvuData: clone(failedDraft),
            });
          }
        } catch (writeError) {
          this.debug('tower opening narrative failure state could not be persisted', writeError);
        }
        throw error;
      }
    })().catch(error => {
      if (!(error instanceof TowerGenerationCancelledError)) {
        this.debug(`tower opening narrative failed (${reason})`, error);
      }
    }).finally(() => {
      this.towerNarrativePromises.delete(key);
    });
    this.towerNarrativePromises.set(key, promise);
    return promise;
  }

  /** Generate active-node prose with the player's current preset without creating a Tavern floor. */
  private async scheduleTowerNarrativeForActiveNode(reason: string): Promise<void> {
    const chatId = this.currentChatId();
    const messageId = this.latestMessageId();
    if (!this.active || !chatId || !this.isTowerLockedScope(chatId, messageId)) return;
    const before = this.readLatestMvuData(messageId);
    const stat = before.stat_data;
    const run = validateRunState(stat?.run);
    const activeNode = isRecord(stat?.run_node) ? stat.run_node : null;
    if (!run.ok || run.value.phase !== 'in_node' || !activeNode) return;
    if (activeNode.node_id !== run.value.currentNode?.id) return;
    if (activeNode.narrative_phase === 'ready' || activeNode.narrative_phase === 'failed') return;
    const nodeId = String(activeNode.node_id || '').trim();
    const requestId = String(activeNode.narrative_request_id || `${nodeId}__narrative`).trim();
    if (!nodeId || !requestId) return;
    const request: TowerGenerationRequest = {
      chatId,
      nodeId,
      requestId,
      runScope: `tower-run-seed:${run.value.seed}`,
      prompt: towerNarrativePrompt(stat, activeNode),
      maxAttempts: 2,
      userExtra: { mwg_tower_narrative: true, reason },
      assistantExtra: { mwg_tower_narrative: true },
    };
    const key = towerGenerationTaskKey(request);
    if (this.towerNarrativePromises.has(key)) return this.towerNarrativePromises.get(key)!;

    const promise = (async () => {
      const claimed = clone(before);
      const claimedNode = claimed.stat_data?.run_node;
      if (!isRecord(claimedNode) || claimedNode.node_id !== nodeId) return;
      claimedNode.narrative_phase = 'generating';
      claimedNode.narrative_request_id = requestId;
      delete claimedNode.narrative_error;
      await this.replaceLatestMvuData(claimed, chatId, messageId, before);
      this.towerPreGenerationSnapshots.set(key, clone(before));

      try {
        const result = await this.towerGenerationHost.generateNarrative(request);
        const narrative = cleanTowerNarrative(result.response);
        if (!narrative) throw new Error('剧情模型返回内容在移除变量标记后为空');
        const draft = this.readLatestMvuData(messageId);
        const currentRun = validateRunState(draft.stat_data?.run);
        const currentNode = draft.stat_data?.run_node;
        if (
          !currentRun.ok ||
          currentRun.value.phase !== 'in_node' ||
          currentRun.value.currentNode?.id !== nodeId ||
          !isRecord(currentNode) ||
          currentNode.node_id !== nodeId ||
          currentNode.narrative_request_id !== requestId
        ) {
          throw new TowerGenerationCancelledError('剧情返回时玩家已经离开该节点');
        }
        currentNode.narrative = narrative;
        currentNode.narrative_source = 'preset';
        currentNode.narrative_phase = 'ready';
        delete currentNode.narrative_error;
        // Retain the actual displayed scene after run_node is cleared by settlement.
        const envelope = draft.stat_data.run?.nodeContent?.[nodeId];
        if (isRecord(envelope?.content)) envelope.content = { ...envelope.content, narrative };
        await this.replaceLatestMvuData(draft, chatId, messageId);
        this.saveTowerArchiveMetadata(chatId);
        const payload: TowerGenerationCompletedPayload = {
          spec: 'mwg.tower-generation/v1',
          chatId,
          nodeId,
          requestId,
          runScope: request.runScope,
          prompt: request.prompt,
          response: result.response,
          generationId: result.generationId,
          completedAt: this.host.now(),
          parsedResult: { type: 'narrative', narrative },
          mvuData: clone(draft),
        };
        await this.towerGenerationHost.dispatchCompletion(request, payload);
        this.publishTowerCompletion(payload);
        this.releaseTowerGenerationRecord(request);
      } catch (error) {
        if (error instanceof TowerGenerationCancelledError) throw error;
        try {
          const failedDraft = this.readLatestMvuData(messageId);
          const failedNode = failedDraft.stat_data?.run_node;
          if (
            isRecord(failedNode) &&
            failedNode.node_id === nodeId &&
            failedNode.narrative_request_id === requestId
          ) {
            failedNode.narrative_phase = 'failed';
            failedNode.narrative_error = error instanceof Error ? error.message : String(error);
            await this.replaceLatestMvuData(failedDraft, chatId, messageId);
            this.publishTowerFailure({
              spec: 'mwg.tower-generation-failure/v1',
              chatId,
              nodeId,
              requestId,
              runScope: request.runScope,
              error: failedNode.narrative_error,
              failedAt: this.host.now(),
              mvuData: clone(failedDraft),
            });
          }
        } catch (writeError) {
          this.debug('tower narrative failure state could not be persisted', writeError);
        }
        throw error;
      }
    })().catch(error => {
      if (!(error instanceof TowerGenerationCancelledError)) {
        this.debug(`tower narrative failed (${reason})`, error);
      }
    }).finally(() => {
      this.towerNarrativePromises.delete(key);
    });
    this.towerNarrativePromises.set(key, promise);
    return promise;
  }

  getTowerCoordinatorStatus() {
    return this.towerCoordinator?.getStatus() || null;
  }

  /** Read-only, current-chat metadata; independent of debug logging and UI timing. */
  getTowerGenerationDiagnostics() {
    const chatId = this.currentChatId();
    return this.active && chatId && this.isTowerLockedScope(chatId)
      ? [...this.towerGenerationHost.getDiagnostics(), ...this.initialDeliveryDiagnostics.snapshot(chatId)]
        .sort((a, b) => a.startedAt - b.startedAt)
      : [];
  }

  /** Full current-chat mechanism evidence; metadata-backed and safe to export. */
  getInitialGenerationEvidence() {
    return this.active ? this.initialGenerationEvidence.snapshot(this.currentChatId()) : null;
  }

  getTowerGenerationEvidence() {
    return this.active ? this.towerGenerationEvidence.snapshot(this.currentChatId()) : null;
  }

  async getRecentGenerationEvidence(limit = 5) {
    const count = Math.max(1, Math.trunc(limit) || 5);
    const chatId = this.currentChatId();
    if (!this.active) return { chatId, total: 0, records: [] };
    const tower = await this.towerGenerationEvidence.recent(chatId, count);
    if (this.currentChatId() !== chatId || !this.active) throw new Error('聊天已切换，已取消旧记录列表');
    const manualIds = new Set(tower.records.filter(record => record.kind === '自然语言修改').map(record => record.generationId || record.requestId));
    const initial = this.initialGenerationEvidence.recent(chatId, count, manualIds);
    return { chatId, total: tower.total + initial.total,
      storage: this.towerGenerationEvidence.status(chatId),
      records: [...tower.records, ...initial.records].sort((a,b) => b.recordedAt - a.recordedAt).slice(0,count) };
  }

  getGenerationEvidenceStatus() {
    const chatId = this.active ? this.currentChatId() : null;
    const initial = this.initialGenerationEvidence.recent(chatId, 1, new Set());
    return { ...this.towerGenerationEvidence.status(chatId), initialTotal: initial.total, initialLatest: initial.records[0]?.key || '' };
  }

  async getGenerationEvidenceRecord(key: string) {
    const chatId = this.currentChatId();
    if (!this.active || !chatId) throw new Error('当前聊天不可用');
    const record = await this.towerGenerationEvidence.loadRecord(chatId, key);
    if (!this.active || this.currentChatId() !== chatId) throw new Error('聊天已切换，已取消旧记录读取');
    return record;
  }

  async retryGenerationEvidenceArchive() {
    const chatId = this.currentChatId();
    if (!this.active || !chatId) return;
    await this.towerGenerationEvidence.archive(chatId, () => this.persistTowerGenerationEvidence(chatId, false), true);
  }

  private retainInitialGenerationEvidence(chatId: string | null): void {
    const context = this.host.context();
    this.initialGenerationEvidence.retainChat(chatId,
      chatId && context?.chatMetadata ? context.chatMetadata[INITIAL_GENERATION_EVIDENCE_METADATA_KEY] : undefined);
  }

  private retainTowerGenerationEvidence(chatId: string | null): void {
    const context = this.host.context();
    this.towerGenerationEvidence.retainChat(chatId,
      chatId && context?.chatMetadata ? context.chatMetadata[TOWER_GENERATION_EVIDENCE_METADATA_KEY] : undefined);
  }

  private persistTowerGenerationEvidence(chatId: string, archive = true): void {
    if (!this.active) return;
    try {
      const context = this.host.context();
      const history = this.towerGenerationEvidence.metadataSnapshot(chatId);
      if (!history || !context?.chatMetadata || this.currentChatId() !== chatId) return;
      context.chatMetadata[TOWER_GENERATION_EVIDENCE_METADATA_KEY] = history;
      context.saveMetadataDebounced();
      if (archive) void this.towerGenerationEvidence.archive(chatId, () => this.persistTowerGenerationEvidence(chatId, false));
    } catch (error) { this.debug('tower generation evidence metadata save failed', error); }
  }

  private towerEvidenceParent(requestId: string): string | undefined {
    return this.towerEvidenceParents.get(requestId) || this.towerProgressParentRequestIds.get(requestId);
  }

  private captureTowerGenerationRequest(request: TowerGenerationRequest): void {
    const parentRequestId = this.towerProgressParentRequestIds.get(request.requestId);
    if (parentRequestId) this.towerEvidenceParents.set(request.requestId, parentRequestId);
    this.towerGenerationEvidence.append({
      chatId: request.chatId, nodeId: request.nodeId, requestId: request.requestId,
      ...(request.runScope ? { runScope: request.runScope } : {}),
      ...(this.towerEvidenceParent(request.requestId) ? { parentRequestId: this.towerEvidenceParent(request.requestId) } : {}),
      stage: 'request', prompt: request.prompt,
      recordedAt: this.host.now(),
    });
    this.persistTowerGenerationEvidence(request.chatId);
  }

  private captureTowerGenerationResponse(request: TowerGenerationRequest, result: TowerGenerationResult): void {
    this.towerGenerationEvidence.append({
      chatId: request.chatId, nodeId: request.nodeId, requestId: request.requestId,
      ...(request.runScope ? { runScope: request.runScope } : {}),
      ...(this.towerEvidenceParent(request.requestId) ? { parentRequestId: this.towerEvidenceParent(request.requestId) } : {}),
      stage: 'response', generationId: result.generationId, response: result.response,
      recordedAt: this.host.now(),
    });
    this.persistTowerGenerationEvidence(request.chatId);
  }

  private captureTowerGenerationFailure(request: TowerGenerationRequest, error: unknown): void {
    const message = redactDiagnosticText(error instanceof Error ? error.message : error).slice(0, 1000);
    this.towerGenerationEvidence.append({
      chatId: request.chatId, nodeId: request.nodeId, requestId: request.requestId,
      ...(request.runScope ? { runScope: request.runScope } : {}),
      ...(this.towerEvidenceParent(request.requestId) ? { parentRequestId: this.towerEvidenceParent(request.requestId) } : {}),
      stage: 'failure', error: message, recordedAt: this.host.now(),
    });
    this.persistTowerGenerationEvidence(request.chatId);
  }

  private captureTowerGenerationOutcome(
    request: TowerGenerationRequest,
    parsedResult: unknown,
    outcome: unknown,
    afterMvuData: unknown,
  ): void {
    const beforeMvuData = this.towerPreGenerationSnapshots.get(towerGenerationTaskKey(request));
    this.towerGenerationEvidence.append({
      chatId: request.chatId, nodeId: request.nodeId, requestId: request.requestId,
      ...(request.runScope ? { runScope: request.runScope } : {}),
      ...(this.towerEvidenceParent(request.requestId) ? { parentRequestId: this.towerEvidenceParent(request.requestId) } : {}),
      stage: 'outcome', parsedResult, outcome,
      ...(beforeMvuData ? { beforeMvuData } : {}),
      ...(afterMvuData ? { afterMvuData } : {}),
      recordedAt: this.host.now(),
    });
    this.persistTowerGenerationEvidence(request.chatId);
  }

  private captureInitialGenerationEvidence(chatId: string, generationId: string, stage: InitialEvidenceStage, text: string): void {
    try { this.initialGenerationEvidence.capture(chatId, generationId, stage, text); this.persistInitialGenerationEvidence(chatId); }
    catch (error) { this.debug('initial generation evidence capture failed', error); }
  }

  private captureInitialGenerationValidation(chatId: string, generationId: string, diagnostics: readonly { code: string; path: readonly (string | number)[]; message: string }[]): void {
    try { this.initialGenerationEvidence.captureValidationErrors(chatId, generationId, diagnostics.map(issue => ({
      code: issue.code, path: issue.path.join('.'), message: issue.message,
    }))); this.persistInitialGenerationEvidence(chatId); }
    catch (error) { this.debug('initial generation validation evidence capture failed', error); }
  }

  private captureInitialGenerationValidationText(chatId: string, generationId: string, messages: readonly string[]): void {
    try { this.initialGenerationEvidence.captureValidationErrors(chatId, generationId, messages.map((message, index) => ({
      code: 'INITIAL_VALIDATION', path: `validation[${index}]`, message: String(message).replace(/(authorization|api[-_ ]?key|cookie|bearer)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]'),
    }))); this.persistInitialGenerationEvidence(chatId); }
    catch (error) { this.debug('initial generation validation text capture failed', error); }
  }

  private finishInitialGenerationEvidence(chatId: string, generationId: string, outcome: 'completed' | 'failed'): void {
    try { this.initialGenerationEvidence.finish(chatId, generationId, outcome); this.persistInitialGenerationEvidence(chatId); }
    catch (error) { this.debug('initial generation evidence finish failed', error); }
  }

  private persistInitialGenerationEvidence(chatId: string): void {
    try {
      const context = this.host.context();
      const history = this.initialGenerationEvidence.snapshot(chatId);
      if (!history || !context?.chatMetadata || this.currentChatId() !== chatId) return;
      context.chatMetadata[INITIAL_GENERATION_EVIDENCE_METADATA_KEY] = history;
      context.saveMetadataDebounced();
    } catch (error) { this.debug('initial generation evidence metadata save failed', error); }
  }

  /**
   * A completed run is also written through Tavern's existing files endpoint.
   * The server's normal upload log is evidence of file persistence only; the
   * JSON content remains the authoritative mechanism diagnostic.
   */
  private archiveInitialGenerationEvidence(chatId: string, generationId: string): void {
    const history = this.initialGenerationEvidence.snapshot(chatId);
    const run = history?.runs.find(entry => entry.generationId === generationId);
    const context = this.host.context();
    if (!history || !run || !context || this.currentChatId() !== chatId || typeof fetch !== 'function') return;
    const bytes = new TextEncoder().encode(JSON.stringify({ spec: history.spec, chatId, retention: history.retention, run }));
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    const safeId = generationId.replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 96) || 'generation';
    let chatHash = 2166136261;
    for (let index = 0; index < chatId.length; index += 1) chatHash = Math.imul(chatHash ^ chatId.charCodeAt(index), 16777619);
    const filename = `mwg-initial-generation-${(chatHash >>> 0).toString(36)}-${safeId}.json`;
    const headers = { ...(context.getRequestHeaders?.() || {}), 'Content-Type': 'application/json' };
    this.initialGenerationEvidence.setArchive(chatId, generationId, { status: 'pending' });
    this.persistInitialGenerationEvidence(chatId);
    void fetch('/api/files/upload', { method: 'POST', headers, body: JSON.stringify({ name: filename, data: btoa(binary) }) })
      .then(async response => {
        if (!response.ok) throw new Error(`upload HTTP ${response.status}`);
        let path = filename;
        try { const body = await response.json(); if (body && typeof body.path === 'string') path = body.path; } catch { /* Endpoint success is sufficient. */ }
        this.initialGenerationEvidence.setArchive(chatId, generationId, { status: 'saved', path });
        this.persistInitialGenerationEvidence(chatId);
      })
      .catch(error => {
        const message = redactDiagnosticText(error instanceof Error ? error.message : error).slice(0, 240);
        this.initialGenerationEvidence.setArchive(chatId, generationId, { status: 'failed', error: message });
        this.persistInitialGenerationEvidence(chatId);
        this.debug('initial generation evidence archive upload failed', error);
      });
  }

  private cancelTowerGeneration(request: TowerCoordinatorGenerationRequest, reason: string): boolean {
    const chatId = this.currentChatId();
    const nodeId = String(request.nodeId || '').trim();
    const requestId = String(request.requestId || '').trim();
    if (!chatId || !nodeId || !requestId) return false;
    const key = this.scopeTowerGenerationKey({ chatId, nodeId, requestId });
    const cancelled = this.towerGenerationHost.battleNarrativeQueue.cancelRequest(key, reason)
      || this.towerGenerationHost.queue.cancelRequest(key, reason)
      || this.towerGenerationHost.queue.cancelRequest({ chatId, nodeId, requestId }, reason);
    if (cancelled) {
      const fingerprints = new Set([
        towerGenerationTaskKey(key),
        towerGenerationTaskKey({ chatId, nodeId, requestId }),
      ]);
      for (const promiseKey of this.towerRequestPromises.keys()) {
        if (fingerprints.has(promiseKey)) this.towerRequestPromises.delete(promiseKey);
      }
      for (const fingerprint of fingerprints) this.towerPreGenerationSnapshots.delete(fingerprint);
    }
    return cancelled;
  }

  /** Archive all silent node generations only after this run has ended. */
  async archiveTowerRun(): Promise<number | null> {
    const chatId = this.currentChatId();
    const messageId = this.latestMessageId();
    if (!this.active || !chatId || !this.isTowerLockedScope(chatId, messageId)) return null;
    if (this.towerArchivePromise) return this.towerArchivePromise;
    const latest = this.readLatestMvuData(messageId);
    const parsed = validateRunState(latest.stat_data?.run);
    if (!parsed.ok || !['won', 'lost'].includes(parsed.value.phase)) return null;
    if (this.hasActiveBattleSession(latest)) return 0;
    const signature = `${chatId}:${parsed.value.seed}:${parsed.value.phase}:${parsed.value.visitedNodeIds.join(',')}`;
    if (this.archivedTowerRuns.has(signature)) return 0;

    const archive = (async () => {
      const keys = this.towerGenerationHost.listPendingArchiveKeys(chatId);
      const archived = keys.length;
      keys.forEach(key => this.releaseTowerGenerationRecord(key));
      this.towerGenerationHost.discardCompletedRecords(chatId);
      this.saveTowerArchiveMetadata(chatId);
      this.archivedTowerRuns.add(signature);
      return archived;
    })();
    this.towerArchivePromise = archive;
    try {
      return await archive;
    } finally {
      if (this.towerArchivePromise === archive) this.towerArchivePromise = null;
    }
  }

  getKnowledgeGraphStats() {
    return this.engine.knowledgeGraphStats(this.getState().lineage);
  }

  async warmup(forceMeasurement = false): Promise<MvuDesignSnapshot | null> {
    if (forceMeasurement) { this.runtimeMeasurementScope = ''; this.runtimeMeasurementGeneration++; this.encounterEvaluator.clearMeasurementCache(); }
    if (!this.active) return null;
    if (this.warming) { if (forceMeasurement) this.warmupRerunRequested = true; return this.warming; }
    this.warming = this.runWarmup().finally(() => {
      this.warming = null;
      if (this.active && this.warmupRerunRequested) {
        this.warmupRerunRequested = false;
        this.scheduleWarmup();
      }
    });
    return this.warming;
  }

  private captureChatScope(): ChatScopeToken {
    const context = this.host.context();
    return {
      chatId: context?.chatId,
      metadata: context?.chatMetadata || null,
      messageId: this.latestMessageId(),
    };
  }

  private isCurrentChatScope(scope: ChatScopeToken): boolean {
    const context = this.host.context();
    return Boolean(context)
      && context!.chatId === scope.chatId
      && context!.chatMetadata === scope.metadata
      && this.latestMessageId() === scope.messageId;
  }

  private readonly onOfficialGenerateAfterData = async (payload: unknown): Promise<void> => {
    await this.onGenerateAfterData(payload, 'official');
  };

  private readonly onTavernHelperGenerateAfterData = async (payload: unknown): Promise<void> => {
    await this.onGenerateAfterData(payload, 'tavern-helper');
  };

  private async onGenerateAfterData(payload: unknown, source: 'official' | 'tavern-helper'): Promise<void> {
    if (!isMagicGirlWorldCharacter(this.host.context())) return;
    if (isRecord(payload)) {
      const messages = Array.isArray(payload.messages) ? payload.messages : payload.prompt;
      if (Array.isArray(messages) && messages.some(message => typeof message?.content === 'string'
        && message.content.includes(`[${TOWER_NARRATIVE_REQUEST_MARKER}]`))) {
        // Preset requests have their own purpose. Observe the actual assembled
        // prompt without applying MVU repair policy or exposing proxy secrets.
        const captured: Record<string, unknown> = { purpose: 'preset-narrative' };
        for (const key of ['messages', 'prompt', 'model', 'stream', 'max_tokens', 'max_completion_tokens',
          'temperature', 'top_p', 'frequency_penalty', 'presence_penalty', 'include_reasoning', 'reasoning_effort',
          'chat_completion_source', 'stop']) {
          if (payload[key] !== undefined) captured[key] = clone(payload[key]);
        }
        try { this.towerMonitor()?.captureMvuRequest?.({ source, payload: captured }); }
        catch (error) { this.debug('failed to expose the preset narrative request', error); }
        return;
      }
    }
    const schemaTransport = applyRepairSchemaFactoring(payload)
      || (this.getSettings().firstAuthoringSchemaTransport === 'compact-context'
        ? applySchemaPromptTransport(payload) : null);
    if (schemaTransport) {
      // Both compatibility events can expose this exact payload while MVU is
      // active. A second event must not fall through into ordinary MVU policy.
      if (payload && typeof payload === 'object') this.handledMvuRequestPayloads.add(payload);
      this.debug('shared repeated schema definitions for JSON-mode transport', schemaTransport);
      try {
        this.towerMonitor()?.captureMvuRequest?.({ source, payload });
      } catch (error) {
        this.debug('failed to expose the compact schema request', error);
      }
      return;
    }
    const mvu = this.host.mvu();
    const lifecycleFlag = mvu?.isDuringExtraAnalysis?.() === true;
    const requestFingerprint = looksLikeMvuExtraAnalysisRequest(payload);
    if (!lifecycleFlag && !requestFingerprint) return;
    if (!payload || typeof payload !== 'object') return;
    if (this.handledMvuRequestPayloads.has(payload)) {
      this.debug('skipped duplicate MVU request event', {
        source,
        lifecycleFlag,
        ...summarizeMvuRequest(payload),
      });
      return;
    }
    this.handledMvuRequestPayloads.add(payload);
    this.debug('captured MVU request', {
      source,
      lifecycleFlag,
      ...summarizeMvuRequest(payload),
    });
    // Apply synchronously before any snapshot work. The same request can be
    // exposed through two SillyTavern events; this mutation is idempotent.
    applyMvuRequestPolicy(payload);
    const captureRequest = (): void => {
      try {
        this.towerMonitor()?.captureMvuRequest?.({ source, payload });
      } catch (error) {
        this.debug('failed to expose the captured MVU request', error);
      }
    };
    const settings = this.getSettings();
    if (!mvu) {
      this.debug('captured MVU request before the MVU global became available; request policy applied without design context');
      captureRequest();
      return;
    }
    // SillyTavern and Tavern Helper can expose both the modern request event and
    // the chat-completion compatibility event for the same payload. Treat an
    // existing marker as an idempotent success instead of reporting a false
    // injection error or repeating the deck simulation.
    if (hasDesignContext(payload)) {
      this.debug('design context already present; skipped duplicate request event');
      captureRequest();
      return;
    }
    this.setStatus('injecting', '正在读取最新变量并生成设计上下文…');
    try {
      const chatScope = this.captureChatScope();
      const variables = mvu.getMvuData({ type: 'message', message_id: chatScope.messageId });
      const state = this.getState();
      if (!settings.enabled) {
        const factsPrompt = composeSecondStageMvuPrompt(variables);
        if (factsPrompt && injectDesignContext(payload, factsPrompt)) {
          this.recordInjection(state, source, chatScope.messageId);
          this.persistState(state);
          this.setStatus('ready', '已注入当前 MVU 游戏事实；设计评分已关闭');
        }
        captureRequest();
        return;
      }
      const snapshot = await this.workerClient.createSnapshot(variables, state, settings);
      if (!this.active || !this.isCurrentChatScope(chatScope)) {
        this.debug('chat changed while preparing design context; discarded stale snapshot');
        captureRequest();
        return;
      }
      if (!snapshot) {
        const initializationPrompt = this.isFirstAssistantFloor()
          ? this.engine.createInitializationPrompt(variables)
          : null;
        const prompt = composeSecondStageMvuPrompt(variables, initializationPrompt);
        if (prompt && injectDesignContext(payload, prompt)) {
          this.latestSnapshot = null;
          this.recordInjection(state, source, chatScope.messageId);
          this.persistState(state);
          this.setStatus('ready', initializationPrompt ? '已注入当前 MVU 与首轮卡组初始化约束' : '已注入当前 MVU 游戏事实');
          this.debug('injected MVU facts and optional initialization context', prompt);
          captureRequest();
          return;
        }
        this.setStatus('idle', '当前没有可评分的玩家卡组');
        captureRequest();
        return;
      }
      const combinedPrompt = composeSecondStageMvuPrompt(variables, snapshot.prompt);
      if (!combinedPrompt || !injectDesignContext(payload, combinedPrompt)) {
        // Another awaited listener may have inserted the same marker between
        // the preflight check and this mutation attempt.
        if (hasDesignContext(payload)) {
          this.setStatus(
            'ready',
            `已注入构筑与敌人设计参考`,
            snapshot,
          );
          captureRequest();
          return;
        }
        this.setStatus('error', 'Tavern Helper 请求结构无法注入，已保持原请求');
        captureRequest();
        return;
      }
      this.latestSnapshot = snapshot;
      this.measureDashboardBuild(variables, snapshot);
      state.lineage = snapshot.lineage;
      state.lastDeckFingerprint = snapshot.deckFingerprint;
      state.lastEnemyFingerprint = snapshot.enemyFingerprint || undefined;
      this.recordInjection(state, source, chatScope.messageId);
      this.persistState(state);
      this.setStatus(
        'ready',
        `已注入构筑与敌人设计参考`,
        snapshot,
      );
      this.debug('injected MVU facts and design context', combinedPrompt);
      captureRequest();
    } catch (error) {
      captureRequest();
      this.fail('第二轮设计上下文生成失败', error);
    }
  }

  private scheduleTavernHelperEventSubscription(): void {
    if (!this.active || this.tavernHelperRequestUnsubscribe || typeof window === 'undefined') return;
    const watchGeneration = ++this.tavernHelperEventWatchGeneration;
    globalThis.queueMicrotask(() => {
      void (async () => {
        const deadline = Date.now() + TAVERN_HELPER_EVENT_WAIT_MS;
        while (
          this.active
          && watchGeneration === this.tavernHelperEventWatchGeneration
          && !this.tavernHelperRequestUnsubscribe
          && Date.now() <= deadline
        ) {
          const unsubscribe = subscribeTavernHelperRequestEvent(
            (globalThis as Record<string, any>).TavernHelper,
            EVENT_GENERATE_AFTER_DATA,
            this.onTavernHelperGenerateAfterData,
          );
          if (unsubscribe) {
            this.tavernHelperRequestUnsubscribe = unsubscribe;
            this.debug('subscribed to Tavern Helper request events');
            return;
          }
          await new Promise<void>(resolve => globalThis.setTimeout(resolve, TAVERN_HELPER_EVENT_POLL_MS));
        }
        this.debug('Tavern Helper request event binding unavailable; official compatibility listener remains active');
      })().catch(error => this.debug('Tavern Helper request event subscription failed', error));
    });
  }

  /**
   * Tavern Helper can replace its internal binding facade while switching from
   * the welcome screen to a character chat. A successful early subscription
   * is therefore not proof that the listener still belongs to the active chat
   * bus. Rebind at each chat/runtime readiness boundary.
   */
  private restartTavernHelperEventSubscription(): void {
    this.tavernHelperEventWatchGeneration += 1;
    this.tavernHelperRequestUnsubscribe?.();
    this.tavernHelperRequestUnsubscribe = null;
    this.scheduleTavernHelperEventSubscription();
  }

  /**
   * Tavern Helper's `generateRaw()` path does not publish the normal
   * request-payload events. MVU does, however, announce that a variable update
   * is starting immediately before it builds that request. Install one
   * depth-zero system prompt synchronously so the exact current variables are
   * scored in time for the automatic second stage.
   */
  private readonly onMvuUpdateStarted = (variables: unknown): void => {
    this.clearMvuLifecyclePrompt('next-mvu-update');
    const context = this.host.context();
    const chatId = this.currentChatId();
    if (!this.active || !context || !chatId || !isMagicGirlWorldCharacter(context)) return;
    const messageId = this.latestMessageId();
    const latestMessage = messageId === 'latest' ? null : context.chat?.[messageId];
    // MVU also announces a parse pass when a user message enters the chat.
    // That pass does not own the automatic post-story model call and must not
    // install a prompt that the normal story request could observe. Only the
    // newly completed assistant floor is a valid second-stage boundary.
    if (!latestMessage || latestMessage.is_user !== false || latestMessage.is_system === true) {
      this.debug('skipped MVU lifecycle injection outside an assistant floor', { chatId, messageId });
      return;
    }
    const settings = this.getSettings();

    const helper = (globalThis as Record<string, any>).TavernHelper;
    if (!helper || typeof helper.injectPrompts !== 'function') {
      this.debug('MVU lifecycle prompt injection unavailable: Tavern Helper injectPrompts is missing');
      return;
    }

    try {
      const state = this.getState();
      const snapshot = settings.enabled ? this.engine.createSnapshot(variables, state, settings) : null;
      const supplemental = snapshot?.prompt || (settings.enabled && this.isFirstAssistantFloor()
        ? this.engine.createInitializationPrompt(variables)
        : null);
      const prompt = composeSecondStageMvuPrompt(variables, supplemental);
      if (!prompt) return;
      const initializationScan = needsMvuInitializationRules(variables, this.isFirstAssistantFloor())
        ? [createMvuInitializationScanPrompt(() => this.active
          && this.currentChatId() === chatId
          && this.latestMessageId() === messageId
          && this.host.mvu()?.isDuringExtraAnalysis?.() === true)]
        : [];
      const result = helper.injectPrompts([{
        id: MVU_LIFECYCLE_PROMPT_ID,
        position: 'in_chat',
        depth: 0,
        role: 'system',
        content: prompt,
      }, ...initializationScan], { once: true });
      if (!result || typeof result.uninject !== 'function') {
        helper.uninjectPrompts?.([MVU_LIFECYCLE_PROMPT_ID, MVU_INITIALIZATION_SCAN_ID]);
        this.debug('MVU lifecycle prompt injection returned no cleanup handle');
        return;
      }

      this.activeMvuLifecyclePrompt = {
        chatId,
        messageId,
        uninject: result.uninject.bind(result),
      };
      if (snapshot) {
        this.latestSnapshot = snapshot;
      this.measureDashboardBuild(variables, snapshot);
        state.lineage = snapshot.lineage;
        state.lastDeckFingerprint = snapshot.deckFingerprint;
        state.lastEnemyFingerprint = snapshot.enemyFingerprint || undefined;
      } else {
        this.latestSnapshot = null;
      }
      this.recordInjection(state, 'mvu-lifecycle', messageId);
      this.persistState(state);
      this.setStatus(
        'ready',
        snapshot
          ? `已注入自动二阶段设计参考`
          : supplemental
            ? '已注入自动二阶段的当前 MVU 与首轮卡组初始化约束'
            : '已注入自动二阶段的当前 MVU 游戏事实',
        snapshot || undefined,
      );
      this.debug('injected design context through MVU lifecycle', {
        chatId,
        messageId,
        deckScore: snapshot?.deckProfile.totalScore,
        targetScore: snapshot?.enemyEnvelope.targetScore,
      });
    } catch (error) {
      this.clearMvuLifecyclePrompt('injection-failed');
      this.fail('自动二阶段设计上下文生成失败', error, false);
    }
  };

  private clearMvuLifecyclePrompt(reason: string): void {
    const active = this.activeMvuLifecyclePrompt;
    this.activeMvuLifecyclePrompt = null;
    if (!active) return;
    try {
      active.uninject();
      this.debug('cleared MVU lifecycle prompt', {
        reason,
        chatId: active.chatId,
        messageId: active.messageId,
      });
    } catch (error) {
      this.debug(`failed to clear MVU lifecycle prompt (${reason})`, error);
    }
  }

  private readonly onMvuUpdateEnded = async (variables: unknown, before: unknown): Promise<void> => {
    this.clearMvuLifecyclePrompt('mvu-update-ended');
    if (!isMagicGirlWorldCharacter(this.host.context())) return;
    // The event payload is not always the selected swipe's final snapshot.
    // The recovery job deliberately re-reads authoritative message variables.
    this.scheduleInitialTowerContentRecovery('mvu-update-ended');
    this.scheduleBattleSettlementRecovery('mvu-update-ended');
    this.scheduleTowerChatActivityTouch(variables);
    this.towerCoordinator?.schedule('mvu-update-ended');
    void this.archiveTowerRun().catch(error => this.debug('爬塔终局归档失败，可在终局页面重试', error));
    const settings = this.getSettings();
    if (!settings.enabled) return;
    const afterFingerprint = enemyGenerationFingerprintFromVariables(variables);
    const beforeFingerprint = enemyGenerationFingerprintFromVariables(before);
    if (!afterFingerprint || afterFingerprint === beforeFingerprint) {
      this.scheduleWarmup();
      return;
    }
    this.setStatus('calibrating', settings.autoCalibration ? '正在评估新敌人…' : '正在记录新敌人谱系…');
    try {
      const chatScope = this.captureChatScope();
      const result = await this.workerClient.calibrate(variables, this.getState(), settings);
      if (!this.active || !this.isCurrentChatScope(chatScope)) {
        this.debug('chat changed while calibrating enemy; discarded stale result');
        return;
      }
      this.latestSnapshot = result.snapshot;
      this.measureDashboardBuild(variables, result.snapshot);
      this.persistState(result.state);
      const calibration = result.state.lastCalibration;
      const message = calibration?.mode === 'advisory'
        ? `敌人已评分，未自动改写：${calibration.warnings[0] || '结果仅供后续生成参考'}`
        : result.snapshot?.enemyPower
          ? `敌人设计分析已更新`
          : '敌人谱系已记录';
      this.setStatus('ready', message, result.snapshot || undefined);
    } catch (error) {
      this.fail('敌人评分或校准失败，已保留模型原始内容', error);
    }
  };

  private scheduleTowerChatActivityTouch(variables: unknown): void {
    if (!isRecord(variables) || variables.stat_data?.game_mode !== 'tower') return;
    const parsed = validateRunState(variables.stat_data?.run);
    if (!parsed.ok) return;
    const chatId = this.currentChatId();
    if (!chatId) return;
    const now = this.host.now();
    const previous = this.towerActivityTouches.get(chatId);
    if (previous?.revision === parsed.value.stateRevision && now - previous.touchedAt < 60_000) return;
    this.towerActivityTouches.set(chatId, { revision: parsed.value.stateRevision, touchedAt: now });
    this.towerActivitySavePromise = this.towerActivitySavePromise
      .catch(() => undefined)
      .then(async () => {
        if (!this.active || this.currentChatId() !== chatId) return;
        const result = await touchCurrentTowerChatActivity(() => this.host.context(), chatId, now);
        if (result.touched) this.debug('refreshed single-floor tower chat activity', result);
      })
      .catch(error => this.debug('刷新爬塔聊天活动时间失败，进度变量仍已保存', error));
  }

  private scheduleCurrentTowerChatActivityTouch(): void {
    if (!this.active || !isMagicGirlWorldCharacter(this.host.context()) || !this.host.mvu()) return;
    try {
      this.scheduleTowerChatActivityTouch(this.readLatestMvuData());
    } catch (error) {
      this.debug('当前爬塔聊天尚未完成加载，稍后由 MVU 就绪事件重试', error);
    }
  }

  /**
   * Existing chats restore their MVU snapshot several ticks after SillyTavern
   * announces the chat switch. Retry only until the current chat exposes an
   * explicit game mode, then stop immediately for story mode. This keeps the
   * activity refresh isolated to tower saves without relying on an iframe-only
   * ready event.
   */
  private scheduleTowerChatActivityRecovery(reason: string): void {
    if (!this.active) return;
    const expectedChatId = this.currentChatId();
    if (!expectedChatId) return;
    const expectedMessageId = this.latestMessageId();
    const watchGeneration = ++this.towerActivityWatchGeneration;
    globalThis.queueMicrotask(() => {
      void (async () => {
        const deadline = Date.now() + 20_000;
        let restoreCandidateSince = 0;
        let restoreCandidateRevision = -1;
        while (
          this.active &&
          watchGeneration === this.towerActivityWatchGeneration &&
          this.currentChatId() === expectedChatId &&
          this.latestMessageId() === expectedMessageId &&
          Date.now() <= deadline
        ) {
          const context = this.host.context();
          if (context && isMagicGirlWorldCharacter(context) && this.host.mvu()) {
            try {
              let current: Record<string, any> | null = null;
              try {
                current = this.readLatestMvuData(expectedMessageId);
              } catch {
                // MVU may expose only initvar, or no selected-message root, for
                // several ticks after an existing chat has visibly rendered.
              }
              const persistedSnapshot = readLatestPersistedMessageVariableSnapshot(
                context,
                expectedMessageId === 'latest' ? undefined : expectedMessageId,
              );
              if (!persistedSnapshot) throw new Error('The restored chat has not exposed message variables yet.');
              const assessment = assessPersistedTowerMvuRestore(persistedSnapshot.variables, current);
              if (assessment.action === 'ignore' || assessment.action === 'keep-current') {
                if (assessment.reason === 'current-tower-current' && current) {
                  this.scheduleTowerChatActivityTouch(current);
                  this.rerenderMessageAfterTowerMvuRestore(
                    expectedChatId,
                    expectedMessageId,
                    assessment.currentRevision ?? assessment.persistedRevision,
                  );
                }
                this.debug(`tower MVU recovery skipped (${reason})`, {
                  chatId: expectedChatId,
                  messageId: expectedMessageId,
                  persistedMessageId: persistedSnapshot.messageId,
                  ...assessment,
                });
                return;
              }

              // `persisted-tower-newer` has a concrete older MVU revision to
              // compare against and is safe to restore immediately.  The
              // generic `persisted-tower-ready` result means MVU is missing or
              // still showing initvar; require it to remain stable across the
              // whole grace window before replacing anything.
              if (assessment.reason === 'persisted-tower-ready') {
                const candidateRevision = assessment.persistedRevision ?? -1;
                if (restoreCandidateRevision !== candidateRevision) {
                  restoreCandidateRevision = candidateRevision;
                  restoreCandidateSince = Date.now();
                }
                if (Date.now() - restoreCandidateSince < TOWER_MVU_EMPTY_RESTORE_GRACE_MS) {
                  await new Promise<void>(resolve => globalThis.setTimeout(resolve, 150));
                  continue;
                }
              }

              await this.restorePersistedTowerMvu(
                persistedSnapshot.variables,
                expectedChatId,
                expectedMessageId,
                watchGeneration,
              );
              const restored = this.readLatestMvuData(expectedMessageId);
              this.scheduleTowerChatActivityTouch(restored);
              this.debug(`restored tower MVU from persisted message (${reason})`, {
                chatId: expectedChatId,
                messageId: expectedMessageId,
                persistedMessageId: persistedSnapshot.messageId,
                revision: assessment.persistedRevision,
              });
              this.towerCoordinator?.requestRecovery();
              void this.scheduleTowerNarrativeForOpening('persisted-mvu-recovery');
              void this.scheduleTowerNarrativeForActiveNode('persisted-mvu-recovery');
              this.scheduleWarmup();
              return;
            } catch {
              // The current message's MVU snapshot is still being restored.
            }
          }
          await new Promise<void>(resolve => globalThis.setTimeout(resolve, 150));
        }
        this.debug(`tower chat activity recovery timed out (${reason})`, { chatId: expectedChatId });
      })().catch(error => this.debug(`tower chat activity recovery failed (${reason})`, error));
    });
  }

  private readonly invalidatePersistentMvuRepairs = (): void => {
    this.mvuRepairScopeGeneration += 1;
    this.persistentMvuRepairHost.clear();
  };

  private readonly onChatChanged = (): void => {
    this.retainInitialGenerationEvidence(this.currentChatId());
    this.retainTowerGenerationEvidence(this.currentChatId());
    this.towerMonitor()?.resetForChat?.(this.currentChatId());
    this.invalidatePersistentMvuRepairs();
    this.clearMvuLifecyclePrompt('chat-changed');
    this.automaticSettlementAttempts.clear();
    this.settlementRecoveryWatchGeneration += 1;
    this.initialContentRecoveryWatchGeneration += 1;
    const nextChatId = this.currentChatId();
    if (nextChatId) {
      this.towerGenerationHost.activateChat(nextChatId);
      this.restoreTowerArchiveMetadata(nextChatId);
    }
    else if (this.towerChatId) {
      this.towerGenerationHost.queue.cancelChat(this.towerChatId, '聊天已关闭，后台生成已取消');
      this.towerGenerationHost.battleNarrativeQueue.cancelChat(this.towerChatId, '聊天已关闭，后台生成已取消');
    }
    this.towerChatId = nextChatId;
    this.publishedTowerTerminals.clear();
    this.towerRequestPromises.clear();
    this.towerActiveRequests.clear();
    this.towerActiveAttemptKeys.clear();
    this.towerNarrativePromises.clear();
    this.towerPreGenerationSnapshots.clear();
    this.singleFloorStartPromises.clear();
    this.towerArchivePromise = null;
    this.archivedTowerRuns.clear();
    this.rerenderedTowerRestoreSnapshots.clear();
    this.towerCoordinator?.activateChat(nextChatId);
    this.latestSnapshot = null;
    this.setStatus('idle', '聊天已切换，等待重新评估');
    this.scheduleReasoningFinalRecovery('chat-changed');
    this.scheduleTowerChatActivityRecovery('chat-changed');
    this.scheduleInitialTowerContentRecovery('chat-changed');
    // The extension often starts on SillyTavern's welcome screen, before a
    // character script has exposed TavernHelper._bind. Give each newly opened
    // chat a fresh subscription window instead of permanently relying on the
    // bounded activation-time probe.
    this.restartTavernHelperEventSubscription();
    this.scheduleBattleSettlementRecovery('chat-changed');
    this.scheduleWarmup();
  };

  private readonly onChatLoaded = (): void => {
    this.invalidatePersistentMvuRepairs();
    this.scheduleTowerChatActivityRecovery('chat-loaded');
    this.scheduleInitialTowerContentRecovery('chat-loaded');
    this.restartTavernHelperEventSubscription();
    this.scheduleBattleSettlementRecovery('chat-loaded');
  };

  private readonly onGenerationEnded = (): void => {
    // Tavern Helper may replace its request-event facade after the visible
    // story request settles but before MVU starts the extra-analysis request.
    // Rebind in the intervening microtask so the first automatic second round
    // after a reload receives the same design context as a manual retry.
    this.restartTavernHelperEventSubscription();
    this.scheduleReasoningFinalRecovery('generation-ended');
    this.scheduleInitialTowerContentRecovery('generation-ended');
    // A visible assistant floor can inherit the preceding user floor's MVU
    // data while it is still streaming. `generation_ended` is the first
    // reliable lifecycle signal that the narrative floor has finished, so it
    // is the safe place to look for a pending battle settlement that requires
    // a third, structured repair request.
    this.scheduleBattleSettlementRecovery('generation-ended');
  };

  /**
   * Some reasoning-capable providers occasionally persist a blank final answer
   * while placing the deliberately tagged opening in `extra.reasoning`. Only
   * the card-scoped persistent extension may recover that strict protocol.
   */
  private scheduleReasoningFinalRecovery(reason: string, replayAfterRuntimeReady = false): void {
    if (!this.active) return;
    const watchGeneration = ++this.reasoningRecoveryWatchGeneration;
    globalThis.queueMicrotask(() => {
      void (async () => {
        // CHAT_CHANGED, the official character context, Tavern Helper and the
        // card iframe become ready on separate ticks. Follow the active scope
        // for a short bounded window instead of snapshotting an incomplete
        // chat/character pair and permanently abandoning its blank floor.
        const deadline = Date.now() + 10_000;
        while (
          this.active &&
          watchGeneration === this.reasoningRecoveryWatchGeneration &&
          Date.now() <= deadline
        ) {
          const context = this.host.context();
          const chatId = this.currentChatId();
          const candidate = (globalThis as Record<string, any>).TavernHelper;
          const bridgedHelper = createEventBridgedTavernHelper(candidate, context);
          const officialRuntime = createOfficialReasoningRecoveryRuntime(context);
          const helperReady = bridgedHelper && [
            'getLastMessageId',
            'getChatMessages',
            'setChatMessages',
            'eventEmit',
          ].every(name => typeof bridgedHelper[name] === 'function');
          const recoveryRuntime = helperReady
            ? bridgedHelper
            : officialRuntime;
          if (
            context &&
            chatId &&
            isMagicGirlWorldCharacter(context) &&
            recoveryRuntime
          ) {
            const messageReceivedEvent = context.eventTypes.MESSAGE_RECEIVED || EVENT_MESSAGE_RECEIVED;
            const result = await this.reasoningFinalRecoveryHost.auditLatest(recoveryRuntime, {
              chatId,
              messageReceivedEvent,
              isCurrent: () => (
                this.active &&
                watchGeneration === this.reasoningRecoveryWatchGeneration &&
                this.currentChatId() === chatId &&
                isMagicGirlWorldCharacter(this.host.context())
              ),
            });
            this.debug(`empty final answer recovery audit (${reason})`, result);
            if (replayAfterRuntimeReady && result.status === 'skipped' && result.reason === 'already-recovered') {
              const replay = await this.reasoningFinalRecoveryHost.replayLatestAfterRuntimeReady(recoveryRuntime, {
                chatId,
                messageReceivedEvent,
                isCurrent: () => (
                  this.active &&
                  watchGeneration === this.reasoningRecoveryWatchGeneration &&
                  this.currentChatId() === chatId &&
                  isMagicGirlWorldCharacter(this.host.context())
                ),
              });
              this.debug(`empty final answer recovery replay (${reason})`, replay);
              return;
            }
            if (result.status === 'recovered') {
              this.debug(`recovered empty final answer from bounded reasoning (${reason})`, {
                chatId,
                messageId: result.messageId,
              });
              return;
            }
            if (result.status !== 'skipped') return;
            if (![
              'missing-latest-message',
              'not-latest-assistant',
              'missing-display-protocol',
            ].includes(result.reason)) return;
          }
          await new Promise<void>(resolve => globalThis.setTimeout(resolve, 100));
        }
        this.debug(`empty final answer recovery prerequisites unavailable (${reason})`);
      })().catch(error => this.debug(`empty final answer recovery failed (${reason})`, error));
    });
  }

  private readonly onTowerGenerationStatus = (status: TowerGenerationQueueStatus): void => {
    if (!this.isTowerLockedScope(status.chatId)) return;
    const requestId = String(status.requestId || '');
    const balanceFeedback = /__balance_feedback$/.test(requestId);
    // A balance review is an implementation detail of the already-visible
    // authoring request. Its local queue failure is deliberately recoverable:
    // balanceTowerNodeResult records the warning and publishes the parent's
    // real terminal result. Do not let that child failure close the parent
    // monitor while validation/simulation is still running.
    if (balanceFeedback && (status.phase === 'failed' || status.phase === 'cancelled')) return;
    const parentRequestId = this.towerProgressParentRequestIds.get(requestId)
      || requestId.replace(/__(?:structure_repair_\d+|balance_feedback)$/, '');
    this.towerMonitor()?.receiveTowerGenerationStatus?.(clone({
      ...status,
      requestId: parentRequestId,
    }));
    // Opening progress is already owned by onStructuredRepairProgress. Its
    // narrative/draft queue requests must not emit a second monitor lifecycle.
    if (String(status.nodeId || '').startsWith('__initial_')) return;
    if (status.phase === 'queued' || status.phase === 'running' || status.phase === 'retrying') {
      const detail = status.phase === 'queued'
        ? '正在排队等待 AI 生成内容'
        : status.phase === 'retrying'
          ? `正在重新请求 AI 生成内容（第 ${status.attempt} 次；上次为${this.towerRetryReasonText(status.retryReason)}）`
          : balanceFeedback
            ? '正在请求 AI 复核战斗强度'
            : '正在请求 AI 生成内容';
      try {
        this.towerMonitor()?.applyStructuredOperation?.({
          generationId: `tower-task:${parentRequestId}`,
          detail,
        });
      } catch (error) {
        this.debug('tower queue progress bridge failed', error);
      }
    }
  };

  /**
   * Distinguish queue scheduling from the exact point the call is handed to
   * Tavern Helper, and from a settled helper promise. These are deliberately
   * low-sensitivity markers: no prompt, response, provider body or error text
   * enters the user diagnostic timeline.
   */
  private readonly onTowerGenerationAttemptLifecycle = (event: import('./towerGenerationHost').TowerGenerationAttemptLifecycle): void => {
    if (!this.isTowerLockedScope(event.chatId)) return;
    if (event.phase === 'transport_invoked') {
      this.towerActiveAttemptKeys.set(event.requestId, {
        chatId: event.chatId, nodeId: event.nodeId, requestId: event.requestId,
        ...(event.runScope ? { runScope: event.runScope } : {}),
      });
    } else if (event.phase === 'settled') {
      this.towerActiveAttemptKeys.delete(event.requestId);
    }
    const parentRequestId = this.towerProgressParentRequestIds.get(event.requestId)
      || event.requestId.replace(/__(?:structure_repair_\d+|balance_feedback)$/, '');
    if (event.phase === 'settled') this.towerProgressParentRequestIds.delete(event.requestId);
    const detail = event.phase === 'transport_invoked'
      ? `第 ${event.attempt} 次请求已交给 Tavern Helper，等待其完成`
      : event.phase === 'transport_dispatched'
        ? `第 ${event.attempt} 次请求已发往接口，等待响应头`
      : event.phase === 'transport_response'
        ? `第 ${event.attempt} 次请求已收到响应头（HTTP ${event.transportProgress?.httpStatus ?? '未知'}；${event.transportProgress?.contentType || '未知类型'}），等待 Tavern Helper 完成`
      : event.phase === 'transport_observed_failure'
        ? `第 ${event.attempt} 次请求已观察到${event.transportFailure?.kind || '传输'}失败（HTTP ${event.transportFailure?.httpStatus ?? '未取得'}；证据 ${event.transportFailure?.evidence || '未知'}），仍等待 Tavern Helper 返回或由用户停止`
      : event.outcome === 'empty_final'
        ? `第 ${event.attempt} 次请求已结算为空文本，正在按既有次数策略处理`
        : event.outcome === 'returned'
          ? `第 ${event.attempt} 次请求已结算，正在校验游戏内容`
          : event.outcome === 'cancelled'
            ? `第 ${event.attempt} 次请求已取消`
            : `第 ${event.attempt} 次请求已结算为错误，正在按既有次数策略处理`;
    try {
      this.towerMonitor()?.applyStructuredOperation?.({
        generationId: `tower-task:${parentRequestId}`,
        detail,
      });
    } catch (error) {
      this.debug('tower generation attempt lifecycle bridge failed', error);
    }
  };

  private towerRetryReasonText(reason: TowerGenerationQueueStatus['retryReason']): string {
    switch (reason?.kind) {
      case 'transport': return '可重试的传输错误';
      case 'host': return '可重试的结构化响应错误';
      case 'timeout': return '超时';
      case 'cancelled': return '取消';
      default: return '可重试的调用错误';
    }
  }

  /** Explicit user stop for the currently visible tower batch/opening request. */
  async cancelTowerGenerationById(input: { generationId?: string }): Promise<boolean> {
    const generationId = String(input?.generationId || '').trim();
    const match = /^tower-task:(.+)$/.exec(generationId);
    const parentRequestId = match?.[1] || '';
    const normalized = this.towerActiveRequests.get(parentRequestId);
    if (!normalized || !this.isTowerGenerationScope(normalized.request, normalized.messageId)) return false;
    const reason = '玩家停止了本次后台生成，可手动重试';
    let cancelled = this.cancelTowerGeneration(normalized.request, reason);
    for (const [requestId, key] of this.towerActiveAttemptKeys) {
      const parent = this.towerProgressParentRequestIds.get(requestId) || requestId;
      if (parent !== parentRequestId) continue;
      cancelled = this.towerGenerationHost.queue.cancelRequest(key, reason) || cancelled;
      cancelled = this.towerGenerationHost.battleNarrativeQueue.cancelRequest(key, reason) || cancelled;
    }
    if (!cancelled) return false;
    await this.recordTowerGenerationFailure(normalized, new TowerGenerationCancelledError(reason), true);
    this.forgetTowerGenerationRecord(normalized.request);
    return true;
  }

  private readonly onMvuInitialized = (): void => {
    this.restartTavernHelperEventSubscription();
    this.scheduleReasoningFinalRecovery('mvu-initialized', true);
    this.scheduleTowerChatActivityRecovery('mvu-initialized');
    this.scheduleInitialTowerContentRecovery('mvu-initialized');
    this.scheduleCurrentTowerChatActivityTouch();
    this.towerCoordinator?.requestRecovery();
    void this.scheduleTowerNarrativeForOpening('mvu-recovery');
    void this.scheduleTowerNarrativeForActiveNode('mvu-recovery');
    void this.scheduleTowerBattleNarrative();
    this.scheduleWarmup();
  };

  /**
   * CHAT_CHANGED can fire before SillyTavern has finished installing the new
   * character record into its context. The card runtime's ready event is the
   * first reliable point where card scope and Tavern Helper can both exist.
   */
  private readonly onCharacterRuntimeInitialized = (): void => {
    this.restartTavernHelperEventSubscription();
    this.scheduleReasoningFinalRecovery('character-runtime-initialized', Boolean(this.host.mvu()));
    this.scheduleTowerChatActivityRecovery('character-runtime-initialized');
    this.scheduleInitialTowerContentRecovery('character-runtime-initialized');
    this.scheduleCurrentTowerChatActivityTouch();
    this.towerCoordinator?.requestRecovery();
    void this.scheduleTowerNarrativeForOpening('runtime-recovery');
    void this.scheduleTowerNarrativeForActiveNode('runtime-recovery');
    void this.scheduleTowerBattleNarrative();
    this.scheduleWarmup();
  };

  private async runWarmup(): Promise<MvuDesignSnapshot | null> {
    if (!isMagicGirlWorldCharacter(this.host.context())) {
      this.setStatus('idle', '仅在魔法少女世界角色卡中启用');
      return null;
    }
    const settings = this.getSettings();
    if (!settings.enabled) return null;
    const mvu = this.host.mvu();
    if (!mvu) {
      this.setStatus('idle', '等待 MVU 初始化');
      return null;
    }
    this.setStatus('warming', '正在预先模拟卡组…');
    try {
      const chatScope = this.captureChatScope();
      const variables = mvu.getMvuData({ type: 'message', message_id: chatScope.messageId });
      const state = this.getState();
      const snapshot = await this.workerClient.createSnapshot(variables, state, settings);
      if (!this.active || !this.isCurrentChatScope(chatScope)) {
        this.debug('chat changed during warmup; discarded stale snapshot');
        return null;
      }
      if (!snapshot) {
        this.setStatus('idle', '当前没有可评分的玩家卡组');
        return null;
      }
      this.latestSnapshot = snapshot;
      this.measureDashboardBuild(variables, snapshot);
      state.lineage = snapshot.lineage;
      state.lastDeckFingerprint = snapshot.deckFingerprint;
      state.lastEnemyFingerprint = snapshot.enemyFingerprint || undefined;
      this.persistState(state);
      this.setStatus(
        'ready',
        `构筑分析已就绪 · ${snapshot.deckProfile.archetypes[0]?.label || '未定流派'}`,
        snapshot,
      );
      return snapshot;
    } catch (error) {
      this.fail('卡组预评估失败', error, false);
      return null;
    }
  }

  private scheduleWarmup(): void {
    if (!this.active) return;
    if (this.warming) {
      this.warmupRerunRequested = true;
      return;
    }
    if (this.warmupScheduled) return;
    this.warmupScheduled = true;
    const run = () => {
      this.warmupScheduled = false;
      if (this.active) void this.warmup();
    };
    const requestIdleCallback = (globalThis as any).requestIdleCallback as undefined | ((callback: () => void, options?: { timeout: number }) => void);
    if (requestIdleCallback) requestIdleCallback(run, { timeout: 1200 });
    else globalThis.setTimeout(run, 0);
  }

  private currentChatId(): string | null {
    const value = this.host.context()?.chatId;
    if (value === null || value === undefined) return null;
    const normalized = String(value).trim();
    return normalized || null;
  }

  /**
   * Prefer SillyTavern's concrete message index over MVU's transient `latest`
   * alias. During iframe reconstruction that alias can briefly point at an old
   * assistant floor, while `context.chat` remains the authoritative ordering.
   */
  private latestMessageId(): number | 'latest' {
    const chat = this.host.context()?.chat;
    return Array.isArray(chat) && chat.length > 0 ? chat.length - 1 : 'latest';
  }

  private isFirstAssistantFloor(): boolean {
    const chat = this.host.context()?.chat;
    if (!Array.isArray(chat) || chat.length === 0) return false;
    const assistantFloors = chat.filter(message => (
      message?.is_user === false
      && message?.is_system !== true
      && typeof message?.mes === 'string'
      && message.mes.trim().length > 0
    ));
    return assistantFloors.length === 1 && assistantFloors[0] === chat.at(-1);
  }

  private towerCoordinatorScope(): TowerCoordinatorScope | null {
    const chatId = this.currentChatId();
    const messageId = this.latestMessageId();
    if (!chatId || !this.isTowerLockedScope(chatId, messageId)) return null;
    if (!this.getTowerInitialPublicationStatus().ready) return null;
    try {
      return {
        chatId,
        messageId,
        mvuData: this.readLatestMvuData(messageId),
        designSnapshot: clone(this.latestSnapshot),
        designState: this.getState(),
        settings: this.getSettings(),
      };
    } catch (error) {
      this.debug('tower coordinator snapshot unavailable', error);
      return null;
    }
  }

  private normalizeTowerRequest(
    chatId: string,
    input: TowerGenerationBridgeRequest,
    messageId: number | 'latest',
  ): NormalizedTowerBridgeRequest {
    const generationType = input.generationType === 'opening'
      ? 'opening'
      : input.generationType === 'batch'
        ? 'batch'
        : 'node';
    const requestId = String(input.requestId || '').trim();
    const prompt = String(input.prompt || '').trim();
    const basedOnRevision = input.basedOnRevision ?? input.revision;
    if (!requestId) throw new Error('爬塔生成 requestId 不能为空');
    if (!prompt) throw new Error('爬塔生成 prompt 不能为空');
    if (!Number.isInteger(basedOnRevision) || Number(basedOnRevision) < 0) {
      throw new Error('爬塔生成 revision 必须是非负整数');
    }

    const batchId = generationType === 'batch' ? String(input.batchId || requestId).trim() : undefined;
    const nodeId = generationType === 'opening'
      ? '__tower_opening__'
      : generationType === 'batch'
        ? `__tower_batch__${batchId}`
        : String(input.nodeId || '').trim();
    if (!nodeId) throw new Error('爬塔节点 nodeId 不能为空');
    if (generationType === 'node' && !RUN_NODE_KINDS.includes(input.kind as RunNodeKind)) {
      throw new Error('爬塔节点 kind 无效');
    }

    let nodeAct: number | undefined;
    let nodeFloor: number | undefined;
    let nodeRewardSeed: number | undefined;
    let nodeContentSeed: number | undefined;
    let jobs: TowerGenerationJobDescriptor[] | undefined;
    if (generationType === 'node' || generationType === 'batch') {
      const current = this.readLatestMvuData(messageId);
      const run = validateRunState(current.stat_data?.run);
      if (!run.ok) throw new Error(`爬塔状态无效：${run.message}`);
      if (generationType === 'node') {
        const node = run.value.map?.nodes.find(entry => entry.id === nodeId)
          || run.value.choices.find(entry => entry.id === nodeId)
          || (run.value.currentNode?.id === nodeId ? run.value.currentNode : null);
        if (!node) throw new Error('爬塔节点不属于当前地图');
        if (runMapContentKind(node) !== input.kind) throw new Error('爬塔节点 kind 与地图不一致');
        nodeAct = node.act;
        nodeFloor = node.floor;
        nodeRewardSeed = run.value.map?.nodes.find(entry=>entry.id===nodeId)?.rewardSeed;
        nodeContentSeed = run.value.map?.nodes.find(entry=>entry.id===nodeId)?.contentSeed;
      } else {
        if (!batchId) throw new Error('爬塔批量生成 batchId 不能为空');
        if (!Array.isArray(input.jobs) || input.jobs.length < 1 || input.jobs.length > 3) {
          throw new Error('爬塔批量生成必须包含一至三个节点');
        }
        const seen = new Set<string>();
        jobs = input.jobs.map(source => {
          const mapNode = run.value.map?.nodes.find(entry => entry.id === source.nodeId);
          if (!mapNode || seen.has(mapNode.id)) throw new Error('爬塔批量节点不属于当前地图或重复');
          if (runMapContentKind(mapNode) !== source.kind || mapNode.act !== source.act || mapNode.floor !== source.floor) {
            throw new Error('爬塔批量节点与地图不一致');
          }
          if (source.revision !== Number(basedOnRevision)) throw new Error('爬塔批量节点 revision 不一致');
          seen.add(mapNode.id);
          return {
            nodeId: mapNode.id,
            requestId: String(source.requestId || '').trim(),
            basedOnRevision: Number(source.revision),
            kind: runMapContentKind(mapNode),
            act: mapNode.act,
            floor: mapNode.floor,
            contentSeed: mapNode.contentSeed,
            rewardSeed: mapNode.rewardSeed,
            shopMemoryCards: source.shopMemoryCards,
            difficultyMultiplier: Number(source.difficultyMultiplier),
          };
        });
        if (jobs.some(job => !job.requestId)) throw new Error('爬塔批量节点 requestId 不能为空');
      }
    }

    const request: TowerGenerationRequest = {
      ...input,
      chatId,
      nodeId,
      requestId,
      prompt,
      maxAttempts: Math.min(input.maxAttempts ?? 2, 2),
      ...(nodeAct === undefined ? {} : { act: nodeAct }),
      ...(nodeFloor === undefined ? {} : { floor: nodeFloor }),
      generation: {
        ...(input.generation || {}),
        ...(!input.generation?.custom_api && !Object.hasOwn(input.generation || {}, 'tools')
          ? { structured_delivery: 'text-json' as const } : {}),
        max_chat_history: 0,
        json_schema: generationType === 'opening'
          ? createTowerOpeningJsonSchema()
          : generationType === 'batch'
            ? createTowerNodeBatchJsonSchema(batchId!, jobs!)
            : createTowerNodeJsonSchema(input.kind as RunNodeKind, {
              nodeId,
              act: nodeAct,
              floor: nodeFloor,
              rewardSeed: nodeRewardSeed,
              contentSeed: nodeContentSeed,
              shopMemoryCards: input.shopMemoryCards,
            }),
      },
    };
    return {
      generationType,
      request,
      basedOnRevision: Number(basedOnRevision),
      messageId,
      ...(generationType === 'batch' ? { batchId, jobs } : {}),
      ...(generationType === 'node' ? {
        kind: input.kind as RunNodeKind,
        act: nodeAct,
        floor: nodeFloor,
      } : {}),
    };
  }

  private readLatestMvuData(messageId: number | 'latest' = this.latestMessageId()): Record<string, any> {
    if (messageId !== 'latest' && this.latestMessageId() !== messageId) {
      throw new TowerGenerationCancelledError('The active SillyTavern message changed before MVU could be read.');
    }
    const mvu = this.host.mvu();
    if (!mvu || typeof mvu.replaceMvuData !== 'function') {
      throw new Error('MVU replaceMvuData 接口不可用，已停止后台生成以保护存档');
    }
    const data = normalizeLatestMvuRoot(mvu.getMvuData({ type: 'message', message_id: messageId }));
    if (!data) {
      throw new Error('最新楼层 MVU 数据不可用');
    }
    const draft = clone(data);
    this.towerWriteBases.set(draft, clone(data));
    return draft;
  }

  private async replaceLatestMvuData(
    data: Record<string, any>,
    expectedChatId: string,
    expectedMessageId: number | 'latest' = this.latestMessageId(),
    base: Record<string, any> | undefined = this.towerWriteBases.get(data),
  ): Promise<void> {
    if (!base) throw new Error('后台保存缺少读取基线，已停止以保护存档');
    const assertCurrent = () => {
      if (!this.isTowerLockedScope(expectedChatId, expectedMessageId))
        throw new TowerGenerationCancelledError('聊天或游戏模式已变化，拒绝写入旧爬塔结果');
    };
    const written = await commitMvuUpdate({
      base, next: data, assertCurrent,
      read: () => this.readLatestMvuData(expectedMessageId),
      write: value => this.host.mvu()!.replaceMvuData!(value, { type: 'message', message_id: expectedMessageId }),
    });
    // A caller may reuse the draft after saving. Advance both draft and base,
    // otherwise its next save would undo unrelated fields merged above.
    for (const field of Object.keys(data)) delete data[field];
    Object.defineProperties(data, Object.getOwnPropertyDescriptors(clone(written)));
    this.towerWriteBases.set(data, clone(written));
    try {
      this.towerMonitor()?.receiveTowerStateChanged?.({ chatId: expectedChatId, messageId: expectedMessageId });
    } catch (error) {
      this.debug('爬塔状态已保存，但界面刷新通知失败', error);
    }
  }

  private async restorePersistedTowerMvu(
    persisted: Record<string, any>,
    expectedChatId: string,
    expectedMessageId: number | 'latest',
    expectedWatchGeneration: number,
  ): Promise<void> {
    const isCurrent = (): boolean => (
      this.active
      && this.towerActivityWatchGeneration === expectedWatchGeneration
      && this.currentChatId() === expectedChatId
      && this.latestMessageId() === expectedMessageId
      && isMagicGirlWorldCharacter(this.host.context())
    );
    if (!isCurrent()) throw new TowerGenerationCancelledError('The chat changed before tower MVU restoration.');
    const mvu = this.host.mvu();
    if (!mvu || typeof mvu.replaceMvuData !== 'function') {
      throw new Error('MVU replaceMvuData is unavailable during persisted tower restoration.');
    }
    const restoredRevision = await withMvuWriteLock(async () => {
      if (!isCurrent()) throw new TowerGenerationCancelledError('The chat changed before restoration.');
      let current: Record<string, any> | null = null;
      try {
        current = normalizeLatestMvuRoot(
          mvu.getMvuData({ type: 'message', message_id: expectedMessageId }),
        );
      } catch {
        // A missing current root is the exact state this recovery path repairs.
      }
      const assessment = assessPersistedTowerMvuRestore(persisted, current);
      if (assessment.action !== 'restore') return undefined;
      if (!isCurrent()) throw new TowerGenerationCancelledError('The chat changed before tower MVU restoration.');
      await mvu.replaceMvuData!(clone(persisted), { type: 'message', message_id: expectedMessageId });
      if (!isCurrent()) throw new TowerGenerationCancelledError('The chat changed while tower MVU was being restored.');
      const written = normalizeLatestMvuRoot(
        mvu.getMvuData({ type: 'message', message_id: expectedMessageId }),
      );
      const writtenRun = validateRunState(written?.stat_data?.run);
      if (
        !written
        || written.stat_data?.game_mode !== 'tower'
        || !writtenRun.ok
        || writtenRun.value.stateRevision !== assessment.persistedRevision
      ) {
        throw new Error('Persisted tower MVU restoration did not retain the expected run revision.');
      }
      return assessment.persistedRevision;
    });
    if (restoredRevision === undefined) return;
    this.rerenderMessageAfterTowerMvuRestore(
      expectedChatId,
      expectedMessageId,
      restoredRevision,
    );
  }

  /**
   * Rebuild only the already-visible latest floor after MVU memory has been
   * repaired from that floor's persisted variables. This keeps the iframe in
   * sync without creating a message, saving a new floor, or touching another
   * chat that became active while the asynchronous restore was running.
   */
  private rerenderMessageAfterTowerMvuRestore(
    expectedChatId: string,
    expectedMessageId: number | 'latest',
    expectedRevision?: number,
  ): boolean {
    if (!this.active || expectedMessageId === 'latest') return false;
    if (this.currentChatId() !== expectedChatId || this.latestMessageId() !== expectedMessageId) return false;
    const context = this.host.context();
    if (!context || !isMagicGirlWorldCharacter(context)) return false;
    const message = context.chat?.[expectedMessageId];
    if (!message || typeof message !== 'object' || typeof context.updateMessageBlock !== 'function') return false;
    const revision = Number.isFinite(Number(expectedRevision)) ? Number(expectedRevision) : -1;
    const snapshotKey = `${expectedChatId}:${expectedMessageId}:${revision}`;
    if (this.rerenderedTowerRestoreSnapshots.has(snapshotKey)) return false;
    try {
      context.updateMessageBlock(expectedMessageId, message, { rerenderMessage: true });
      const rendered = context.eventSource.emit?.(
        context.eventTypes.MESSAGE_UPDATED || 'message_updated',
        expectedMessageId,
      );
      if (rendered && typeof (rendered as Promise<unknown>).catch === 'function') {
        void (rendered as Promise<unknown>).catch(error => {
          this.debug('tower MVU restored, but the Tavern Helper render event failed', error);
        });
      }
      this.rerenderedTowerRestoreSnapshots.add(snapshotKey);
      return true;
    } catch (error) {
      // The state repair is already durable. A host-side render failure must
      // not repeat the restore transaction or overwrite a newer revision.
      this.debug('tower MVU restored, but the visible message could not be rerendered', error);
      return false;
    }
  }

  private async executeTowerGeneration(
    normalized: NormalizedTowerBridgeRequest,
    _beforeGeneration: Record<string, any>,
  ): Promise<TowerGenerationResult> {
    const { request, generationType, basedOnRevision, kind, act, floor, messageId } = normalized;
    const hasBattleGeneration = generationType !== 'opening' && (normalized.jobs || [{ kind }])
      .some(job => isBattleRunNode(job.kind as RunNodeKind));
    let result: TowerGenerationResult;
    try {
      this.publishTowerGenerationProgress(normalized, 'begin', generationType === 'opening'
        ? '正在准备开局内容请求'
        : hasBattleGeneration
          ? '正在本地测量战斗强度，无需 AI'
          : '正在准备游戏内容请求');
      if (generationType !== 'opening') await this.prepareTowerRuntimeBudget(normalized, _beforeGeneration);
      this.publishTowerGenerationProgress(normalized, 'applying', '正在请求 AI 生成内容');
      result = await this.towerGenerationHost.generateNode(request);
      this.publishTowerGenerationProgress(normalized, 'applying', 'AI 内容已返回，正在校验游戏内容', result.response);
    } catch (error) {
      if (error instanceof TowerGenerationCancelledError) throw error;
      await this.recordTowerGenerationFailure(normalized, error, true);
      throw error;
    }

    let extraRequestUsed = Boolean(result.additionalRequestsUsed);
    const tryConsumeBalanceFeedback = (): boolean => {
      if (extraRequestUsed) return false;
      extraRequestUsed = true;
      return true;
    };
    let parsedResult: unknown;
    let batchOutcome: TowerGenerationCompletedPayload['batchOutcome'];
    let draft: Record<string, any>;
    try {
      draft = this.readLatestMvuData(messageId);
      if (!this.isTowerGenerationScope(request, messageId)) {
        throw new TowerGenerationCancelledError('The active message changed before tower generation could commit.');
      }
      if (generationType === 'opening') {
        const expectedOpening = {
          requestId: request.requestId,
          basedOnRevision,
        };
        let parsed: ReturnType<typeof parseTowerOpeningResult> | null = null;
        let literalOriginal: ReturnType<typeof parseTowerOpeningResult> | null = null;
        let structureError: unknown = null;
        let structureRepairRequest: TowerGenerationRequest | null = null;
        const maximumStructureRepairs = (result.additionalRequestsUsed || 0) > 0 ? 0 : 1;
        for (let repairIndex = 0; repairIndex <= maximumStructureRepairs; repairIndex += 1) {
          try {
            parsed = parseTowerOpeningResult(result.response, expectedOpening);
            if (literalOriginal) assertAuthoredLiteralRepairPreservation(literalOriginal, parsed);
            else literalOriginal = clone(parsed);
            const literalIssues = collectAuthoredLiteralEffectIssues(parsed);
            if (literalIssues.length) throw new Error(literalIssues.map(issue => `${issue.path}：[${issue.code}] ${issue.message}`).join('；'));
            break;
          } catch (error) {
            structureError = error;
            if (repairIndex >= maximumStructureRepairs) throw error;
            const repairRequest: TowerGenerationRequest = {
              ...request,
              requestId: `${request.requestId}__structure_repair_${repairIndex + 1}`,
              prompt: formatTowerOpeningStructureRepairPrompt(expectedOpening, result.response, error, draft.stat_data.battle),
              maxAttempts: 1,
              continueEmptyFinalRecovery: result.emptyJsonFallbackUsed,
              userExtra: {
                ...(request.userExtra || {}),
                mwg_tower_opening_structure_repair: true,
                mwg_tower_opening_structure_repair_attempt: repairIndex + 1,
              },
            };
            this.towerPreGenerationSnapshots.set(towerGenerationTaskKey(repairRequest), clone(draft));
            this.towerProgressParentRequestIds.set(repairRequest.requestId, request.requestId);
            structureRepairRequest = repairRequest;
            extraRequestUsed = true;
            result = await this.towerGenerationHost.generateNode(repairRequest);
          }
        }
        if (!parsed) throw structureError || new Error('爬塔开局馈赠结构修复未返回可执行结果');
        if (structureRepairRequest) {
          this.captureTowerGenerationOutcome(structureRepairRequest, parsed, { outcome: 'structure_repair_complete', parentRequestId: request.requestId }, draft);
        }
        const run = validateRunState(draft.stat_data.run);
        if (!run.ok) throw new Error(`爬塔状态无效：${run.message}`);
        const mutation = commitTowerOpening(run.value.opening, {
          requestId: parsed.request_id,
          basedOnRevision: parsed.based_on_revision,
          content: parsed,
        });
        const candidate = validateRunState({ ...run.value, opening: mutation.opening });
        if (!candidate.ok) throw new Error(`开局事件提交后状态无效：${candidate.message}`);
        draft.stat_data.run = candidate.value;
        parsedResult = parsed;
      } else if (generationType === 'batch') {
        const jobs = normalized.jobs || [];
        const batchId = normalized.batchId || request.requestId;
        const literalOriginals = new Map<string, TowerNodeResult>();
        const validateOne = (candidate: TowerNodeResult, job: TowerGenerationJobDescriptor): void => {
          const original = literalOriginals.get(job.nodeId);
          if (original) assertAuthoredLiteralRepairPreservation(original, candidate);
          else literalOriginals.set(job.nodeId, clone(candidate));
          const semanticErrors = collectAuthoredLiteralEffectIssues(candidate)
            .map(issue => `${issue.path}：[${issue.code}] ${issue.message.replaceAll('；', '，')}`);
          const route = { id: job.nodeId, kind: job.kind, act: job.act, floor: job.floor, rewardSeed: job.rewardSeed };
          try {
            if (isBattleRunNode(job.kind)) {
              validateTowerBattleNodeForActivation(
                draft.stat_data.battle,
                candidate.payload?.battle,
                candidate.reward,
                route,
              );
            } else if (job.kind === 'event') {
              validateTowerEventNodeForActivation(draft.stat_data.battle, candidate.payload?.event);
            } else if (job.kind === 'shop' || job.kind === 'treasure') {
              normalizeTowerReward(candidate.reward, draft.stat_data.battle);
            }
          } catch (error) {
            semanticErrors.unshift(error instanceof Error ? error.message : String(error));
          }
          if (semanticErrors.length) throw new Error(semanticErrors.join('；'));
        };
        const inspectBatch = (response: string): TowerNodeBatchInspection => {
          try {
            return inspectTowerNodeBatchResult(response, batchId, jobs, validateOne);
          } catch (error) {
            const extraIssues = collectTowerBatchUnreportedValidationIssues(
              response,
              jobs,
              draft.stat_data.battle,
            );
            if (extraIssues.length > 0) {
              throw new Error(
                `${error instanceof Error ? error.message : String(error)}；${extraIssues.join('；')}`,
              );
            }
            throw error;
          }
        };
        const failedDetail = (inspection: TowerNodeBatchInspection): string => inspection.entries
          .flatMap(entry => entry.ok ? [] : [`${entry.nodeId}: ${entry.error}`]).join('；');
        let inspected: TowerNodeBatchInspection | null = null;
        let structureError: unknown = null;
        let structureRepairRequest: TowerGenerationRequest | null = null;
        try {
          inspected = inspectBatch(result.response);
          if (inspected.entries.some(entry => !entry.ok)) {
            structureError = new Error(`爬塔批量内容含不可执行节点：${failedDetail(inspected)}`);
          }
        } catch (error) {
          structureError = error;
        }
        if (structureError && !(result.additionalRequestsUsed || 0)) {
          const originalInspection = inspected;
          const rejectedBatchResponse = result.response;
          const repairRequest: TowerGenerationRequest = {
            ...request,
            requestId: `${request.requestId}__structure_repair_1`,
            prompt: formatTowerNodeBatchStructureRepairPrompt(batchId, jobs, result.response, structureError, draft.stat_data.battle),
            maxAttempts: 1,
            continueEmptyFinalRecovery: result.emptyJsonFallbackUsed,
            userExtra: {
              ...(request.userExtra || {}),
              mwg_tower_batch_structure_repair: true,
              mwg_tower_batch_structure_repair_attempt: 1,
            },
          };
          this.towerPreGenerationSnapshots.set(towerGenerationTaskKey(repairRequest), clone(draft));
          this.towerProgressParentRequestIds.set(repairRequest.requestId, request.requestId);
          structureRepairRequest = repairRequest;
          try {
            extraRequestUsed = true;
            const repairedResult = await this.towerGenerationHost.generateNode(repairRequest);
            // Validate the raw repair's identities before preservation can
            // restore omitted/duplicated nodes or otherwise mask a bad scope.
            inspectTowerNodeBatchResult(repairedResult.response, batchId, jobs);
            result = {
              ...repairedResult,
              // Only an identity-verified original can supply frozen siblings.
              response: originalInspection ? preserveUnreportedTowerBatchResults(
                rejectedBatchResponse, repairedResult.response, jobs, structureError,
              ) : repairedResult.response,
            };
            inspected = inspectBatch(result.response);
            if (originalInspection) {
              // Freeze the actual scope-validated values, not a second loose
              // extraction of a response containing multiple tagged blocks.
              inspected.entries = inspected.entries.map((entry, index) => {
                const original = originalInspection.entries[index];
                return original.ok ? clone(original) : entry;
              });
            }
          } catch (error) {
            if (error instanceof TowerGenerationCancelledError) throw error;
            // A failed repair cannot erase independently validated originals.
            // Never mine usable-looking nodes from an untrusted repair scope.
            if (!originalInspection?.entries.some(entry => entry.ok)) throw error;
            inspected = originalInspection;
          }
        }
        if (!inspected) throw structureError || new Error('爬塔批量节点结构修复未返回可执行结果');
        if (structureRepairRequest) {
          this.captureTowerGenerationOutcome(structureRepairRequest, inspected, {
            outcome: 'structure_repair_complete', parentRequestId: request.requestId,
          }, draft);
        }
        if (!this.isTowerGenerationScope(request, messageId)) throw new TowerGenerationCancelledError();
        draft = this.readLatestMvuData(messageId);

        for (let index = 0; index < jobs.length; index += 1) {
          const job = jobs[index];
          const entry = inspected.entries[index];
          if (!entry.ok) continue;
          let candidate = entry.result;
          if (isBattleRunNode(job.kind)) {
            const nodeRequest: TowerGenerationRequest = {
              ...request,
              nodeId: job.nodeId,
              requestId: job.requestId,
              act: job.act,
              floor: job.floor,
              difficultyMultiplier: job.difficultyMultiplier,
              generation: {
                ...(request.generation || {}),
                json_schema: createTowerNodeJsonSchema(job.kind, {
                  rewardSeed: job.rewardSeed, contentSeed: job.contentSeed, shopMemoryCards: job.shopMemoryCards,
                  nodeId: job.nodeId,
                  act: job.act,
                  floor: job.floor,
                }),
              },
            };
            try {
              this.publishTowerGenerationProgress(normalized, 'applying',
                `正在本地复测战斗强度（第 ${index + 1}/${jobs.length} 项）`);
              candidate = await this.balanceTowerNodeResult(candidate, draft, {
                generationType: 'node', request: nodeRequest, basedOnRevision: job.basedOnRevision,
                kind: job.kind, act: job.act, floor: job.floor, messageId,
              }, tryConsumeBalanceFeedback, detail => this.publishTowerGenerationProgress(normalized, 'applying', detail), request.requestId);
              // Enemy calibration is separately authorized; the preserved player/reward content was never changed.
              literalOriginals.set(job.nodeId, clone(candidate));
              validateOne(candidate, job);
              inspected.entries[index] = { nodeId: job.nodeId, ok: true, result: candidate };
            } catch (error) {
              if (error instanceof TowerGenerationCancelledError) throw error;
              inspected.entries[index] = { nodeId: job.nodeId, ok: false, error: error instanceof Error ? error.message : String(error) };
            }
          }
        }

        // Repair/balance may yield while the player plays cards or changes
        // route. Build the one atomic write from the latest root, not the old
        // battle session, then revalidate all candidates against that root.
        if (!this.isTowerGenerationScope(request, messageId)) throw new TowerGenerationCancelledError();
        draft = this.readLatestMvuData(messageId);
        const ready: TowerNodeResult[] = [];
        const failedNodeIds: string[] = [];
        const ignoredNodeIds: string[] = [];
        for (let index = 0; index < jobs.length; index += 1) {
          const job = jobs[index];
          const currentRun = validateRunState(draft.stat_data.run);
          if (!currentRun.ok) throw new Error(`爬塔状态无效：${currentRun.message}`);
          const envelope = currentRun.value.nodeContent[job.nodeId];
          // A route can change while a batch is in flight. Results for the
          // discarded branch are intentionally ignored; still-reachable
          // siblings commit together in the one MVU replacement below.
          if (envelope?.phase !== 'generating' || envelope.requestId !== job.requestId
            || envelope.basedOnRevision !== job.basedOnRevision) {
            ignoredNodeIds.push(job.nodeId);
            continue;
          }
          let entry = inspected.entries[index];
          if (entry.ok) {
            try { validateOne(entry.result, job); }
            catch (error) { entry = { nodeId: job.nodeId, ok: false, error: error instanceof Error ? error.message : String(error) }; }
          }
          inspected.entries[index] = entry;
          if (entry.ok) {
            const candidate = entry.result;
            commitTowerGenerationInStat(draft.stat_data, {
              nodeId: job.nodeId, requestId: job.requestId, revision: job.basedOnRevision,
              content: candidate, ...(candidate.reward === undefined ? {} : { reward: candidate.reward }),
            });
            ready.push(candidate);
          } else {
            failTowerGenerationInStat(draft.stat_data, {
              nodeId: job.nodeId, requestId: job.requestId, revision: job.basedOnRevision, error: entry.error,
            });
            failedNodeIds.push(job.nodeId);
          }
        }
        if (!ready.length) {
          if (!failedNodeIds.length) throw new TowerGenerationCancelledError('All batch members are obsolete.');
          throw new Error(`爬塔批量内容含不可执行节点：${failedDetail(inspected)}`);
        }
        batchOutcome = { outcome: failedNodeIds.length || ignoredNodeIds.length ? 'partial' : 'complete',
          readyNodeIds: ready.map(entry => entry.node_id), failedNodeIds, ignoredNodeIds };
        parsedResult = {
          spec: batchOutcome.outcome === 'complete' ? 'mwg.tower-node-batch-result/v1' : 'mwg.tower-node-batch-commit/v1',
          batch_id: batchId, based_on_revision: inspected.basedOnRevision, results: ready,
          ...(batchOutcome.outcome === 'partial' ? { outcome: clone(batchOutcome) } : {}),
        };
      } else {
        const expectedNode = {
          nodeId: request.nodeId,
          requestId: request.requestId,
          basedOnRevision,
          kind: kind!,
          act,
          floor,
          contentSeed: draft.stat_data.run?.map?.nodes.find((entry: {id:string;contentSeed:number}) => entry.id === request.nodeId)?.contentSeed,
          rewardSeed: draft.stat_data.run?.map?.nodes.find((entry: {id:string;rewardSeed:number}) => entry.id === request.nodeId)?.rewardSeed,
          shopMemoryCards: request.shopMemoryCards,
        };
        const route = {
          id: request.nodeId,
          kind: kind!,
          act: act!,
          floor: floor!,
          rewardSeed: expectedNode.rewardSeed,
        };
        let literalOriginal: TowerNodeResult | null = null;
        const validateNode = (candidate: TowerNodeResult): void => {
          if (literalOriginal) assertAuthoredLiteralRepairPreservation(literalOriginal, candidate);
          else literalOriginal = clone(candidate);
          const semanticErrors = collectAuthoredLiteralEffectIssues(candidate)
            .map(issue => `${issue.path}：[${issue.code}] ${issue.message.replaceAll('；', '，')}`);
          try {
            if (isBattleRunNode(kind!)) {
              validateTowerBattleNodeForActivation(
                draft.stat_data.battle,
                candidate.payload?.battle,
                candidate.reward,
                route,
              );
            } else if (kind === 'event') {
              validateTowerEventNodeForActivation(
                draft.stat_data.battle,
                candidate.payload?.event,
              );
            } else if (kind === 'shop' || kind === 'treasure') {
              normalizeTowerReward(candidate.reward, draft.stat_data.battle);
            }
          } catch (error) {
            semanticErrors.unshift(error instanceof Error ? error.message : String(error));
          }
          if (semanticErrors.length) throw new Error(semanticErrors.join('；'));
        };
        const parseAndValidateNode = (response: string): TowerNodeResult => {
          const candidate = parseTowerNodeResult(response, expectedNode);
          validateNode(candidate);
          return candidate;
        };
        let parsed: TowerNodeResult | null = null;
        let structureError: unknown = null;
        let structureRepairRequest: TowerGenerationRequest | null = null;
        const maximumStructureRepairs = (result.additionalRequestsUsed || 0) > 0 ? 0 : 1;
        for (let repairIndex = 0; repairIndex <= maximumStructureRepairs; repairIndex += 1) {
          try {
            parsed = parseAndValidateNode(result.response);
            break;
          } catch (error) {
            structureError = error;
            if (repairIndex >= maximumStructureRepairs) throw error;
            const repairRequest: TowerGenerationRequest = {
              ...request,
              requestId: `${request.requestId}__structure_repair_${repairIndex + 1}`,
              prompt: formatTowerNodeStructureRepairPrompt(expectedNode, result.response, error, draft.stat_data.battle),
              maxAttempts: 1,
              continueEmptyFinalRecovery: result.emptyJsonFallbackUsed,
              userExtra: {
                ...(request.userExtra || {}),
                mwg_tower_structure_repair: true,
                mwg_tower_structure_repair_attempt: repairIndex + 1,
              },
            };
            this.towerPreGenerationSnapshots.set(towerGenerationTaskKey(repairRequest), clone(draft));
            this.towerProgressParentRequestIds.set(repairRequest.requestId, request.requestId);
            structureRepairRequest = repairRequest;
            extraRequestUsed = true;
            result = await this.towerGenerationHost.generateNode(repairRequest);
          }
        }
        if (!parsed) throw structureError || new Error('爬塔节点结构修复未返回可执行结果');
        if (structureRepairRequest) {
          this.captureTowerGenerationOutcome(structureRepairRequest, parsed, { outcome: 'structure_repair_complete', parentRequestId: request.requestId }, draft);
        }
        if (isBattleRunNode(kind!)) {
          this.publishTowerGenerationProgress(normalized, 'applying', '正在本地复测战斗强度');
          parsed = await this.balanceTowerNodeResult(
            parsed, draft, normalized, tryConsumeBalanceFeedback,
            detail => this.publishTowerGenerationProgress(normalized, 'applying', detail),
          );
          literalOriginal = clone(parsed);
          draft = this.readLatestMvuData(messageId);
          if (!this.isTowerGenerationScope(request, messageId)) throw new TowerGenerationCancelledError();
          validateNode(parsed);
        }
        commitTowerGenerationInStat(draft.stat_data, {
          nodeId: request.nodeId,
          requestId: request.requestId,
          revision: basedOnRevision,
          content: parsed,
          ...(parsed.reward === undefined ? {} : { reward: parsed.reward }),
        });
        parsedResult = parsed;
      }
      this.publishTowerGenerationProgress(normalized, 'applying', '校验完成，正在保存当前楼层');
      await this.replaceLatestMvuData(draft, request.chatId, messageId);
      this.saveTowerArchiveMetadata(request.chatId);
      this.publishTowerGenerationProgress(normalized, 'applying', '当前楼层已保存，正在发布结果');
      if (generationType === 'opening') {
        globalThis.setTimeout(() => {
          void this.scheduleTowerNarrativeForOpening('opening-structured-ready');
        }, 0);
      }
    } catch (error) {
      // The raw model call completed, but an unusable contract must not leave
      // the request permanently stuck in `generating`. The failure adapter is
      // scoped by requestId + revision, so stale responses still cannot mutate
      // another node generation.
      await this.recordTowerGenerationFailure(normalized, error, true);
      throw error;
    }

    this.captureTowerGenerationOutcome(request, parsedResult, batchOutcome || { outcome: 'complete' }, draft);
    const payload: TowerGenerationCompletedPayload = {
      spec: 'mwg.tower-generation/v1',
      chatId: request.chatId,
      nodeId: request.nodeId,
      requestId: request.requestId,
      runScope: request.runScope,
      prompt: request.prompt,
      response: result.response,
      generationId: result.generationId,
      completedAt: this.host.now(),
      parsedResult: clone(parsedResult),
      ...(batchOutcome ? { batchOutcome: clone(batchOutcome) } : {}),
      mvuData: clone(draft),
    };
    try {
      await this.towerGenerationHost.dispatchCompletion(request, payload, request.eventName);
      this.publishTowerCompletion(payload);
      this.releaseTowerGenerationRecord(request);
    } catch (error) {
      await this.recordTowerGenerationFailure(normalized, error, false);
      throw error;
    }
    return result;
  }

  private async prepareTowerRuntimeBudget(normalized: NormalizedTowerBridgeRequest, variables: Record<string, any>): Promise<void> {
    const jobs = normalized.jobs || [{ nodeId: normalized.request.nodeId, kind: normalized.kind, act: normalized.act, floor: normalized.floor }];
    if (!jobs.some(job => isBattleRunNode(job.kind as any))) return;
    try {
      const measurement = await this.encounterEvaluator.measure(variables.stat_data.battle);
      if (!this.isTowerGenerationScope(normalized.request, normalized.messageId)) throw new TowerGenerationCancelledError();
      this.towerMeasuredBuild = measurement;
      const latest = this.readLatestMvuData(normalized.messageId);
      const run = validateRunState(latest.stat_data?.run);
      if (!run.ok) throw new Error(run.message);
      let baseline = run.value.encounterBaseline;
      if (!baseline && hasReliableTowerMeasurement(measurement)) {
        baseline = createTowerEncounterBaseline(measurement, run.value.act);
        run.value.encounterBaseline = baseline;
        latest.stat_data.run = run.value;
        await this.replaceLatestMvuData(latest, normalized.request.chatId, normalized.messageId);
      }
      const budgets = jobs.filter(job => isBattleRunNode(job.kind as any)).map(job => ({ nodeId: job.nodeId,
        budget: towerBudgetFromMeasurement({ measurement, baseline, kind: String(job.kind), act: job.act || 1,
          floor: job.floor || 1, difficulty: this.getSettings().difficultyPercent }) }));
      const context = buildTowerGenerationContext({ chatId: normalized.request.chatId, messageId: normalized.messageId,
        mvuData: latest, designSnapshot: this.latestSnapshot, designState: this.getState(), settings: this.getSettings() });
      context.enemyBudgets = Object.fromEntries(budgets.map(entry => [entry.nodeId, entry.budget]));
      const descriptors = jobs.map(job => {
        const node = run.value.map?.nodes.find(entry => entry.id === job.nodeId);
        return { ...job, requestId: 'requestId' in job ? job.requestId : normalized.request.requestId,
          basedOnRevision: normalized.basedOnRevision, kind: job.kind!, act: job.act || 1, floor: job.floor || 1,
          contentSeed: node?.contentSeed || 0, rewardSeed: node?.rewardSeed || 0, difficultyMultiplier: 1 };
      });
      if (normalized.request.prompt.startsWith('[爬塔后台')) normalized.request.prompt = normalized.generationType === 'batch'
        ? formatTowerNodeBatchGenerationPrompt(normalized.batchId || normalized.request.requestId, descriptors, context)
        : formatTowerNodeGenerationPrompt(descriptors[0], context);
      else normalized.request.prompt += `\n[本节点唯一正式引擎预算]${JSON.stringify(budgets)}`;
    } catch (error) {
      if (error instanceof TowerGenerationCancelledError) throw error;
      this.towerMeasuredBuild = null;
      normalized.request.prompt += `
[评估状态]独立正式引擎评估暂不可用，当前数值仅为低置信度参考，不可把未覆盖的机制当作零收益。`;
      this.debug('tower runtime measurement unavailable', error);
    }
  }

  private async balanceTowerNodeResult(
    parsed: TowerNodeResult,
    draft: Record<string, any>,
    normalized: NormalizedTowerBridgeRequest,
    tryConsumeFeedback: () => boolean = () => false,
    reportProgress: (detail: string) => void = () => undefined,
    monitorRequestId = normalized.request.requestId,
  ): Promise<TowerNodeResult> {
    try {
      const measurement = await this.encounterEvaluator.measure(draft.stat_data.battle);
      if (!this.isTowerGenerationScope(normalized.request, normalized.messageId)) throw new TowerGenerationCancelledError();
      const baseline = draft.stat_data.run?.encounterBaseline;
      const budget = towerBudgetFromMeasurement({ measurement,
        baseline: validTowerEncounterBaseline(baseline) ? baseline : undefined,
        kind: String(normalized.kind), act: normalized.act || 1, floor: normalized.floor || 1,
        difficulty: this.getSettings().difficultyPercent });
      let result = await this.encounterEvaluator.balance({ persistentBattle: draft.stat_data.battle,
        generatedBattle: parsed.payload.battle as Record<string, any>, budget,
        seed: draft.stat_data.run?.map?.nodes?.find((node: any) => node.id === normalized.request.nodeId)?.contentSeed || 0 });
      if (!this.isTowerGenerationScope(normalized.request, normalized.messageId)) throw new TowerGenerationCancelledError();
      let modelRepairUsed = false;
      const feedbackAuthorization = result.needsReview ? balanceFeedbackAuthorization(result, budget) : { allowed: false };
      if (result.needsReview && !feedbackAuthorization.allowed && feedbackAuthorization.warning) {
        result.feedback.push(feedbackAuthorization.warning);
      }
      if (result.needsReview && feedbackAuthorization.allowed && tryConsumeFeedback()) {
        modelRepairUsed = true; // One shared additional request, also consumed when repair fails.
        try {
          reportProgress('本地复测需要一次额外 AI 反馈，正在请求复核');
          const mapNode = draft.stat_data.run?.map?.nodes?.find((node: any) => node.id === normalized.request.nodeId);
          const expected = { nodeId: normalized.request.nodeId, requestId: normalized.request.requestId,
            basedOnRevision: normalized.basedOnRevision, kind: normalized.kind!, act: normalized.act, floor: normalized.floor,
            contentSeed: mapNode?.contentSeed, rewardSeed: mapNode?.rewardSeed };
          const reviewNode = clone(parsed);
          reviewNode.payload.battle = result.generatedBattle;
          delete reviewNode.program_balance;
          if (reviewNode.reward) { delete reviewNode.reward.gold; delete reviewNode.reward.gold_claimed; }
          const reviewRequest: TowerGenerationRequest = { ...normalized.request,
            requestId: `${normalized.request.requestId}__balance_feedback`, maxAttempts: 1,
            prompt: `[程序战斗评估反馈]仅调整下方当前节点的敌人数值或可执行机制，保留敌人数与故事身份；玩家卡牌/资源、奖励和节点绑定一律保留。公开反制窗口要明确，不锁血强制拖回合。代理未找到胜利不代表人类必败。返回完整 mwg_tower_node_result，request_id 仍为 ${expected.requestId}。\n预算：${JSON.stringify(budget)}\n证据：${JSON.stringify(result.feedback)}\n当前节点：${JSON.stringify(reviewNode)}`,
            generation: { ...normalized.request.generation, json_schema: createTowerNodeJsonSchema(normalized.kind!, expected) },
            userExtra: { ...normalized.request.userExtra, mwg_tower_balance_feedback: true } };
          this.towerPreGenerationSnapshots.set(towerGenerationTaskKey(reviewRequest), clone(draft));
          this.towerProgressParentRequestIds.set(reviewRequest.requestId, monitorRequestId);
          let reply: TowerGenerationResult;
          try {
            reply = await this.towerGenerationHost.generateNode(reviewRequest);
          } finally {
            this.towerProgressParentRequestIds.delete(reviewRequest.requestId);
          }
          reportProgress('额外 AI 反馈已返回，正在本地复测战斗强度');
          const candidate = parseTowerNodeResult(reply.response, expected);
          assertTowerBalanceFeedbackPreservation(parsed.payload.battle, candidate.payload.battle);
          validateTowerBattleNodeForActivation(draft.stat_data.battle, candidate.payload.battle, parsed.reward,
            { id: expected.nodeId, kind: expected.kind, act: expected.act!, floor: expected.floor!, rewardSeed: mapNode?.rewardSeed });
          const reviewed = await this.encounterEvaluator.balance({ persistentBattle: draft.stat_data.battle,
            generatedBattle: candidate.payload.battle as Record<string, any>, budget, seed: mapNode?.contentSeed || 0,
            seeds: Math.max(2, result.evaluation.seeds.length) });
          if (!reviewed.needsReview && reviewed.evaluation.status === 'measured' && reviewed.evaluation.decisionCoverage === 'bounded') result = reviewed;
          else result.feedback.push('一次AI反馈未通过复测，保留此前可执行结果与待复核标记。');
        } catch (error) {
          if (error instanceof TowerGenerationCancelledError) throw error;
          result.feedback.push(`一次AI反馈未采纳：${error instanceof Error ? error.message : String(error)}`);
        }
      }
      if (!this.isTowerGenerationScope(normalized.request, normalized.messageId)) throw new TowerGenerationCancelledError();
      if (result.requiresRegeneration) throw new Error('MWG_ENCOUNTER_BUDGET: 敌人超出本节点程序预算，已保留其他节点，请重试生成。');
      parsed.payload.battle = result.generatedBattle;
      const audit = compactTowerBalanceAudit(result, measurement, this.getSettings().difficultyPercent, modelRepairUsed);
      parsed.program_balance = audit;
      this.towerEvaluationReports.set(audit.auditId, { budget, result });
      while (this.towerEvaluationReports.size > 8) this.towerEvaluationReports.delete(this.towerEvaluationReports.keys().next().value!);
      return parsed;
    } catch (error) {
      if (error instanceof TowerGenerationCancelledError || (error instanceof Error && error.message.startsWith('MWG_ENCOUNTER_BUDGET:'))) throw error;
      parsed.program_balance = { spec: 'mwg.tower-enemy-balance/v2', resourceAssessment: 'not-assessed',
        modelRepairUsed: false, assessment: 'inconclusive', needsReview: true,
        warnings: [error instanceof Error ? error.message : String(error)] };
      return parsed;
    }
  }

  private async recordTowerGenerationFailure(
    normalized: NormalizedTowerBridgeRequest,
    error: unknown,
    applyFailureState: boolean,
  ): Promise<void> {
    const { request, generationType, basedOnRevision, messageId } = normalized;
    if (!this.isTowerGenerationScope(request, messageId)) return;
    const detail = error instanceof Error ? error.message : String(error);
    let failedMvuData: Record<string, any> | undefined;

    if (applyFailureState) {
      try {
        const draft = this.readLatestMvuData(messageId);
        if (generationType === 'opening') {
          const run = validateRunState(draft.stat_data.run);
          if (!run.ok) throw new Error(`爬塔状态无效：${run.message}`);
          const mutation = failTowerOpening(run.value.opening, {
            requestId: request.requestId,
            basedOnRevision,
            error: detail,
          });
          const candidate = validateRunState({ ...run.value, opening: mutation.opening });
          if (!candidate.ok) throw new Error(`开局失败状态无效：${candidate.message}`);
          draft.stat_data.run = candidate.value;
        } else if (generationType === 'batch') {
          for (const job of normalized.jobs || []) {
            const run = validateRunState(draft.stat_data.run);
            if (!run.ok) throw new Error(`爬塔状态无效：${run.message}`);
            const envelope = run.value.nodeContent[job.nodeId];
            if (
              envelope?.phase !== 'generating'
              || envelope.requestId !== job.requestId
              || envelope.basedOnRevision !== job.basedOnRevision
            ) continue;
            failTowerGenerationInStat(draft.stat_data, {
              nodeId: job.nodeId,
              requestId: job.requestId,
              revision: job.basedOnRevision,
              error: detail,
            });
          }
        } else {
          failTowerGenerationInStat(draft.stat_data, {
            nodeId: request.nodeId,
            requestId: request.requestId,
            revision: basedOnRevision,
            error: detail,
          });
        }
        await this.replaceLatestMvuData(draft, request.chatId, messageId);
        failedMvuData = draft;
      } catch (adapterError) {
        this.debug('tower failure adapter rejected update; original MVU retained', adapterError);
      }
    }

    this.towerGenerationEvidence.append({
      chatId: request.chatId, nodeId: request.nodeId, requestId: request.requestId,
      ...(request.runScope ? { runScope: request.runScope } : {}),
      ...(this.towerEvidenceParent(request.requestId) ? { parentRequestId: this.towerEvidenceParent(request.requestId) } : {}),
      stage: 'outcome', outcome: { outcome: 'failed', error: detail },
      ...(failedMvuData ? { afterMvuData: clone(failedMvuData) } : {}),
      ...(this.towerPreGenerationSnapshots.get(towerGenerationTaskKey(request)) ? { beforeMvuData: clone(this.towerPreGenerationSnapshots.get(towerGenerationTaskKey(request))) } : {}),
      recordedAt: this.host.now(),
    });
    this.persistTowerGenerationEvidence(request.chatId);
    this.publishTowerFailure({
      spec: 'mwg.tower-generation-failure/v1',
      chatId: request.chatId,
      nodeId: request.nodeId,
      requestId: request.requestId,
      runScope: request.runScope,
      error: detail,
      failedAt: this.host.now(),
      ...(failedMvuData ? { mvuData: clone(failedMvuData) } : {}),
    });
  }

  private hasActiveBattleSession(data: Record<string, any>): boolean {
    return isRecord(data.__magic_girl_world)
      && isRecord(data.__magic_girl_world.battle_session);
  }

  private isTowerGenerationScope(request: TowerGenerationRequest, messageId: number | 'latest'): boolean {
    if (!this.isTowerLockedScope(request.chatId, messageId)) return false;
    if (!request.runScope) return true;
    try {
      const run = validateRunState(this.readLatestMvuData(messageId).stat_data?.run);
      return run.ok && request.runScope === `tower-run-seed:${run.value.seed}`;
    } catch { return false; }
  }

  private isTowerLockedScope(
    expectedChatId: string,
    expectedMessageId: number | 'latest' = this.latestMessageId(),
  ): boolean {
    if (!this.active || this.currentChatId() !== expectedChatId) return false;
    if (expectedMessageId !== 'latest' && this.latestMessageId() !== expectedMessageId) return false;
    if (!isMagicGirlWorldCharacter(this.host.context())) return false;
    try {
      const variables = this.host.mvu()?.getMvuData({ type: 'message', message_id: expectedMessageId });
      if (!isRecord(variables)) return false;
      const stat = isRecord(variables.stat_data) ? variables.stat_data : variables;
      const lock = isRecord(stat.game_mode_lock) ? stat.game_mode_lock : null;
      return lock?.schemaVersion === 1 && lock.mode === 'tower';
    } catch {
      return false;
    }
  }

  private towerMonitor(): TowerGenerationMonitorBridge | null {
    const monitor = (globalThis as any).MagicGirlWorldMvuMonitor;
    return monitor && typeof monitor === 'object' ? monitor as TowerGenerationMonitorBridge : null;
  }

  /**
   * All non-terminal tower stages share the original request id. The monitor
   * treats matching generation ids as updates, so a manually closed window is
   * never reopened by measuring, balancing, or saving progress.
   */
  private publishTowerGenerationProgress(
    normalized: NormalizedTowerBridgeRequest,
    phase: 'begin' | 'applying',
    detail: string,
    rawOutput?: string,
  ): void {
    if (!this.isTowerGenerationScope(normalized.request, normalized.messageId)) return;
    const input = {
      generationId: `tower-task:${normalized.request.requestId}`,
      autoOpen: normalized.generationType === 'opening' && (normalized.act || 1) === 1,
      detail,
      ...(typeof rawOutput === 'string' ? { rawOutput } : {}),
    };
    try {
      if (phase === 'begin') this.towerMonitor()?.beginStructuredOperation?.(input);
      else this.towerMonitor()?.applyStructuredOperation?.(input);
    } catch (error) {
      this.debug('tower progress bridge failed', error);
    }
  }

  private publishTowerCompletion(payload: TowerGenerationCompletedPayload): void {
    const terminal = towerGenerationTaskKey(payload);
    if (this.publishedTowerTerminals.has(terminal)) return;
    this.publishedTowerTerminals.add(terminal);
    try {
      this.towerMonitor()?.receiveTowerGenerationCompleted?.(clone(payload));
    } catch (error) {
      this.debug('tower completion bridge failed', error);
    }
  }

  private publishTowerFailure(payload: TowerGenerationBridgeFailure): void {
    const terminal = towerGenerationTaskKey(payload);
    if (this.publishedTowerTerminals.has(terminal)) return;
    this.publishedTowerTerminals.add(terminal);
    try {
      this.towerMonitor()?.receiveTowerGenerationFailed?.(clone(payload));
    } catch (error) {
      this.debug('tower failure bridge failed', error);
    }
  }

  private persistState(state: DesignAssistantChatState): void {
    const context = this.host.context();
    if (!context?.chatMetadata) return;
    context.chatMetadata[DESIGN_ASSISTANT_METADATA_KEY] = clone(state);
    context.saveMetadataDebounced();
  }

  private recordInjection(
    state: DesignAssistantChatState,
    source: 'official' | 'tavern-helper' | 'mvu-lifecycle',
    messageId: number | 'latest',
  ): void {
    const injectedAt = this.host.now();
    const previousAt = Number(state.lastInjectionAt);
    const sameLogicalRequest = state.lastInjectionMessageId === messageId
      && Number.isFinite(previousAt)
      && injectedAt - previousAt >= 0
      && injectedAt - previousAt <= LOGICAL_MVU_INJECTION_WINDOW_MS;
    state.lastInjectionAt = injectedAt;
    // When both compatibility paths observe one request, keep the more
    // specific Tavern Helper source even if the official clone arrives last.
    if (
      !sameLogicalRequest
      || source === 'mvu-lifecycle'
      || source === 'tavern-helper' && state.lastInjectionSource === 'official'
      || !state.lastInjectionSource
    ) {
      state.lastInjectionSource = source;
    }
    state.lastInjectionMessageId = messageId;
    if (!sameLogicalRequest) {
      state.lastInjectionCount = Math.max(0, Number(state.lastInjectionCount) || 0) + 1;
    }
  }

  /**
   * Restore only this chat's compact terminal archive queue. MVU snapshots,
   * promises and cancellation handles intentionally never enter metadata.
   */
  private restoreTowerArchiveMetadata(chatId: string): void {
    const context = this.host.context();
    if (!context?.chatMetadata || this.currentChatId() !== chatId) return;
    // Older builds duplicated every complete background prompt/response in
    // chat metadata. The committed run state already contains the resumable
    // node content, so remove the obsolete archive during migration.
    if (context.chatMetadata[TOWER_ARCHIVE_METADATA_KEY] !== undefined) {
      delete context.chatMetadata[TOWER_ARCHIVE_METADATA_KEY];
      context.saveMetadataDebounced();
    }
  }

  /** Persist completed silent calls after their MVU transaction commits. */
  private saveTowerArchiveMetadata(chatId: string): void {
    const context = this.host.context();
    if (!context?.chatMetadata || this.currentChatId() !== chatId) return;
    if (context.chatMetadata[TOWER_ARCHIVE_METADATA_KEY] !== undefined) {
      delete context.chatMetadata[TOWER_ARCHIVE_METADATA_KEY];
      context.saveMetadataDebounced();
    }
  }

  private releaseTowerGenerationRecord(key: TowerGenerationTaskKey): void {
    const scoped = this.scopeTowerGenerationKey(key);
    const keys = scoped.runScope || key.runScope
      ? [scoped, { chatId: key.chatId, nodeId: key.nodeId, requestId: key.requestId }]
      : [key];
    for (const candidate of keys) {
      this.towerGenerationHost.releaseCompletedRecord(candidate);
      this.towerPreGenerationSnapshots.delete(towerGenerationTaskKey(candidate));
    }
  }

  private forgetTowerGenerationRecord(key: TowerGenerationTaskKey): void {
    const scoped = this.scopeTowerGenerationKey(key);
    const candidates = scoped.runScope || key.runScope
      ? [scoped, { chatId: key.chatId, nodeId: key.nodeId, requestId: key.requestId }]
      : [key];
    const fingerprints = new Set(candidates.map(candidate => towerGenerationTaskKey(candidate)));
    for (const candidate of candidates) this.towerGenerationHost.forgetTerminalRecord(candidate);
    for (const fingerprint of fingerprints) {
      this.publishedTowerTerminals.delete(fingerprint);
      this.towerPreGenerationSnapshots.delete(fingerprint);
    }
    for (const promiseKey of this.towerRequestPromises.keys()) {
      if (fingerprints.has(promiseKey)) {
        this.towerRequestPromises.delete(promiseKey);
      }
    }
  }

  /** Add the durable run identity to controller-originated cancel/retry keys. */
  private scopeTowerGenerationKey(key: TowerGenerationTaskKey): TowerGenerationTaskKey {
    if (typeof key.runScope === 'string' && key.runScope.trim()) return key;
    try {
      const latest = this.readLatestMvuData(this.latestMessageId());
      const run = validateRunState(latest.stat_data?.run);
      if (run.ok) return { ...key, runScope: `tower-run-seed:${run.value.seed}` };
    } catch {
      // Compatibility fallback for records produced before run-scoped keys.
    }
    return key;
  }

  private saveSettings(settings: DesignAssistantSettings): void {
    const context = this.host.context();
    if (!context) return;
    context.extensionSettings[DESIGN_ASSISTANT_EXTENSION_ID] = normalizeDesignAssistantSettings(settings);
    context.saveSettingsDebounced();
    this.publishDashboard();
    this.scheduleWarmup();
  }

  private setStatus(
    phase: DesignAssistantStatus['phase'],
    message: string,
    snapshot?: MvuDesignSnapshot,
  ): void {
    this.status = {
      phase,
      message,
      updatedAt: this.host.now(),
      ...(snapshot ? {
        deckScore: snapshot.deckProfile.totalScore,
        targetScore: snapshot.enemyEnvelope.targetScore,
        ...(snapshot.enemyPower ? { enemyScore: snapshot.enemyPower.currentEncounterScore } : {}),
      } : {}),
    };
    this.publishDashboard();
  }

  private publishDashboard(): void {
    const monitor = (globalThis as any).MagicGirlWorldMvuMonitor;
    if (!monitor) return;
    monitor.setDesignAssistant?.(this);
    monitor.receiveDesignAssistantDashboard?.(this.getDashboard());
  }

  private fail(title: string, error: unknown, notify = true): void {
    const detail = error instanceof Error ? error.message : String(error);
    this.setStatus('error', `${title}：${detail}`);
    if (notify && this.getSettings().showNotifications) this.host.notify('warning', detail, title);
    this.debug(title, error);
  }

  private debug(...values: unknown[]): void {
    if (this.getSettings().debug) console.debug('[MagicGirlDesignAssistant]', ...values);
  }
}
