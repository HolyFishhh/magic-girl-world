import { applyNonCombatSettlementInStat, type NonCombatAnswers } from './nonCombatSettlementTransactions';
import { applyFixedRewardGrant } from './rewardTransactions';
import { flattenMvuArray } from '../runtime/mvuArrays';

export const INITIAL_ARTIFACT_ACQUISITION_KEY = 'initial_artifact_acquisition';
export const INITIAL_ARTIFACT_ACQUISITION_SPEC = 'mwg.initial-artifact-acquisition/v1' as const;

export interface InitialArtifactAcquisitionReceipt {
  spec: typeof INITIAL_ARTIFACT_ACQUISITION_SPEC;
  generationId: string;
  createdAtRevision: number;
  phase: 'pending' | 'settled';
  artifacts: Record<string, any>[];
}

export type InitialArtifactAcquisitionAnswers = Record<string, NonCombatAnswers>;

function record(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stableKey(value: unknown): string {
  return JSON.stringify(value, (_key, child) => child && typeof child === 'object' && !Array.isArray(child)
    ? Object.fromEntries(Object.keys(child).sort().map(key => [key, child[key]])) : child);
}

function clone<T>(value: T): T { return structuredClone(value); }

function requireReceipt(stat: Record<string, any>): InitialArtifactAcquisitionReceipt | null {
  if (!Object.hasOwn(stat, INITIAL_ARTIFACT_ACQUISITION_KEY)) return null;
  const value = stat[INITIAL_ARTIFACT_ACQUISITION_KEY];
  if (!record(value)
    || value.spec !== INITIAL_ARTIFACT_ACQUISITION_SPEC
    || typeof value.generationId !== 'string' || !value.generationId
    || !Number.isInteger(value.createdAtRevision) || value.createdAtRevision < 0
    || !['pending', 'settled'].includes(value.phase)
    || !Array.isArray(value.artifacts)) {
    throw new Error('初始遗物领取凭据损坏，不能跳过未完成的获得时结算');
  }
  const ids = new Set<string>();
  for (const artifact of value.artifacts) {
    if (!record(artifact) || typeof artifact.id !== 'string' || !artifact.id || artifact.on_acquire === undefined || ids.has(artifact.id)) {
      throw new Error('初始遗物领取凭据包含无效遗物');
    }
    ids.add(artifact.id);
  }
  return clone(value) as InitialArtifactAcquisitionReceipt;
}

function assertReceiptArtifactsCurrent(stat: Record<string, any>, receipt: InitialArtifactAcquisitionReceipt): void {
  const artifacts = flattenMvuArray<Record<string, any>>(stat.battle?.artifacts);
  for (const source of receipt.artifacts) {
    const current = artifacts.find((entry: unknown) => record(entry) && entry.id === source.id);
    if (!current || stableKey(current) !== stableKey(source)) {
      throw new Error(`初始遗物 ${source.id} 与领取凭据不一致，不能执行可能过期的获得时效果`);
    }
  }
}

/** Stamp only a newly generated initial player inventory. Never call this while loading a save. */
export function createInitialArtifactAcquisitionReceipt(
  artifacts: unknown,
  generationId: string,
  createdAtRevision: number,
): InitialArtifactAcquisitionReceipt | null {
  if (typeof generationId !== 'string' || !generationId || !Number.isInteger(createdAtRevision) || createdAtRevision < 0) {
    throw new Error('初始遗物领取凭据缺少生成身份');
  }
  const pending = (Array.isArray(artifacts) ? artifacts : [])
    .filter((artifact): artifact is Record<string, any> => record(artifact) && artifact.on_acquire !== undefined)
    .map(clone);
  if (!pending.length) return null;
  const ids = new Set<string>();
  for (const artifact of pending) {
    if (typeof artifact.id !== 'string' || !artifact.id || ids.has(artifact.id)) {
      throw new Error('初始获得时遗物需要唯一稳定 ID');
    }
    ids.add(artifact.id);
  }
  return { spec: INITIAL_ARTIFACT_ACQUISITION_SPEC, generationId, createdAtRevision, phase: 'pending', artifacts: pending };
}

export function readPendingInitialArtifactAcquisition(statValue: unknown): InitialArtifactAcquisitionReceipt | null {
  if (!record(statValue)) throw new Error('stat_data 不存在');
  const receipt = requireReceipt(statValue);
  if (!receipt || receipt.phase === 'settled') return null;
  assertReceiptArtifactsCurrent(statValue, receipt);
  return receipt;
}

export function hasPendingInitialArtifactAcquisition(statValue: unknown): boolean {
  return readPendingInitialArtifactAcquisition(statValue) !== null;
}

/** Execute every initial acquisition in one private draft. The reward pool is never repurposed. */
export function settleInitialArtifactAcquisitionInStat(
  statValue: unknown,
  answers: InitialArtifactAcquisitionAnswers,
): InitialArtifactAcquisitionReceipt | null {
  if (!record(statValue)) throw new Error('stat_data 不存在');
  const receipt = readPendingInitialArtifactAcquisition(statValue);
  if (!receipt) return null;
  if (!record(answers)) throw new Error('初始遗物领取答案无效');
  if (Object.keys(answers).some(id => !receipt.artifacts.some(artifact => artifact.id === id))) {
    throw new Error('初始遗物领取答案包含无效遗物');
  }
  const draft = clone(statValue);
  for (const artifact of receipt.artifacts) {
    applyNonCombatSettlementInStat(draft, artifact.on_acquire, answers[artifact.id] ?? {}, {
      seed: JSON.stringify([draft.run?.seed ?? 0, 'acquisition', artifact.id]),
      grant: applyFixedRewardGrant,
    });
  }
  const settled: InitialArtifactAcquisitionReceipt = { ...receipt, phase: 'settled' };
  draft[INITIAL_ARTIFACT_ACQUISITION_KEY] = settled;
  for (const key of Object.keys(statValue)) delete statValue[key];
  Object.assign(statValue, draft);
  return clone(settled);
}
