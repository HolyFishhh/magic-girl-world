import {
  assessContentDesign,
  createDeckPowerProfileFingerprint,
  createContentMechanicsFingerprint,
  normalizeDifficultyPercent,
  profileDeckPower,
  summarizeBuildBudget,
  type BattleOutcomeFeedback,
  type BattleRequest,
  type ContentDesignAssessment,
  type DeckPowerProfile,
} from '../game-core';
import { createContentPackFromMvuBattle } from './contentPackAdapter';
import { flattenMvuArray } from './mvuArrays';

export interface ContentDesignContextRefreshOptions {
  request?: BattleRequest | null;
  outcome?: BattleOutcomeFeedback;
  player?: { hp: number; maxHp: number; lust?: number; maxLust?: number };
  difficultyPercent?: number;
  autoCalibration?: boolean;
  simulationSeeds?: number;
  deckPowerProfile?: DeckPowerProfile;
}

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function stableJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

/** Build the next compact, program-owned MVU context without mutating variables. */
export function assessMvuContentDesign(
  variables: unknown,
  options: ContentDesignContextRefreshOptions = {},
): ContentDesignAssessment | null {
  if (!isRecord(variables) || !isRecord(variables.stat_data) || !isRecord(variables.stat_data.battle)) return null;
  const battle = variables.stat_data.battle;
  const reward = isRecord(variables.stat_data.reward) ? variables.stat_data.reward : {};
  const pack = options.request?.content || createContentPackFromMvuBattle(battle);
  if (pack.cards.length === 0) return null;
  const core = isRecord(battle.core) ? battle.core : {};
  const requestPlayer = options.request?.player;
  const player = options.player || {
    hp: finite(core.hp, finite(requestPlayer?.hp, 0)),
    maxHp: Math.max(1, finite(core.max_hp, finite(requestPlayer?.maxHp, 1))),
    lust: finite(core.lust, finite(requestPlayer?.lust, 0)),
    maxLust: Math.max(1, finite(core.max_lust, finite(requestPlayer?.maxLust, 100))),
  };
  const budget = summarizeBuildBudget(pack, { hp: player.maxHp, maxHp: player.maxHp });
  const previousContext = isRecord(battle.design_context)
    ? {
        ...battle.design_context,
        lineage: isRecord(battle.lineage_memory) ? battle.lineage_memory : battle.design_context.lineage,
      }
    : battle.design_context;
  return assessContentDesign({
    pack,
    budget,
    player,
    danger: options.request?.route?.danger ?? 1,
    act: options.request?.route?.act ?? 1,
    previous: previousContext,
    outcome: options.outcome,
    rewardCandidates: flattenMvuArray(reward.card, { objectsOnly: true }),
    difficultyPercent: options.difficultyPercent,
    autoCalibration: options.autoCalibration,
    simulationSeeds: options.simulationSeeds,
    deckPowerProfile: options.deckPowerProfile,
  });
}

/**
 * Run the expensive program simulation outside the MVU write transaction.  Hosts
 * should schedule this after rendering or during an idle window, then pass the
 * result back to refreshMvuContentDesignContext.
 */
export function profileMvuDeckPower(
  variables: unknown,
  options: Pick<ContentDesignContextRefreshOptions, 'simulationSeeds'> = {},
): DeckPowerProfile | null {
  if (!isRecord(variables) || !isRecord(variables.stat_data) || !isRecord(variables.stat_data.battle)) return null;
  const battle = variables.stat_data.battle;
  const pack = createContentPackFromMvuBattle(battle);
  if (pack.cards.length === 0) return null;
  const core = isRecord(battle.core) ? battle.core : {};
  return profileDeckPower({
    pack,
    maxHp: Math.max(1, finite(core.max_hp, 1)),
    maxLust: Math.max(1, finite(core.max_lust, 100)),
    seeds: options.simulationSeeds ?? 8,
  });
}

export function isMvuDeckPowerProfileCurrent(
  variables: unknown,
  profile: DeckPowerProfile,
  options: Pick<ContentDesignContextRefreshOptions, 'simulationSeeds'> = {},
): boolean {
  if (!isRecord(variables) || !isRecord(variables.stat_data) || !isRecord(variables.stat_data.battle)) return false;
  const battle = variables.stat_data.battle;
  const pack = createContentPackFromMvuBattle(battle);
  const core = isRecord(battle.core) ? battle.core : {};
  return profile.fingerprint === createDeckPowerProfileFingerprint({
    pack,
    maxHp: Math.max(1, finite(core.max_hp, 1)),
    maxLust: Math.max(1, finite(core.max_lust, 100)),
    seeds: options.simulationSeeds ?? 8,
  });
}

/** Mutate one Tavern variables snapshot only when the derived context actually changed. */
export function refreshMvuContentDesignContext(
  variables: Record<string, any>,
  options: ContentDesignContextRefreshOptions = {},
): { changed: boolean; assessment: ContentDesignAssessment | null } {
  const battle = variables?.stat_data?.battle;
  if (isRecord(battle) && !options.outcome && isRecord(battle.design_context)) {
    const context = battle.design_context;
    const reward = isRecord(variables?.stat_data?.reward) ? variables.stat_data.reward : {};
    const rewardCandidates = flattenMvuArray(reward.card, { objectsOnly: true });
    const pack = options.request?.content || createContentPackFromMvuBattle(battle);
    const core = isRecord(battle.core) ? battle.core : {};
    const difficulty = normalizeDifficultyPercent(options.difficultyPercent ?? context.settings?.difficultyPercent ?? 80);
    const autoCalibration = options.autoCalibration ?? context.settings?.autoCalibration ?? false;
    const requestedDeckProfile = options.deckPowerProfile;
    const currentDeckProfile = context.balance?.deckProfile;
    const deckProfileAlreadyApplied = !requestedDeckProfile
      || currentDeckProfile?.fingerprint === requestedDeckProfile.fingerprint;
    const currentHp = finite(options.player?.hp, finite(core.hp, 0));
    const currentLust = finite(options.player?.lust, finite(core.lust, 0));
    const maxHp = Math.max(1, finite(options.player?.maxHp, finite(core.max_hp, 1)));
    const maxLust = Math.max(1, finite(options.player?.maxLust, finite(core.max_lust, 100)));
    const persistedDeckProfileIsCurrent = !currentDeckProfile || currentDeckProfile.fingerprint === createDeckPowerProfileFingerprint({
      pack,
      maxHp,
      maxLust,
      seeds: currentDeckProfile.seeds || 8,
    });
    const feasibility = context.balance?.target?.feasibility;
    if (
      context.spec === 'mwg.content-design/v3' &&
      context.fingerprint === createContentMechanicsFingerprint(pack) &&
      context.settings?.difficultyPercent === difficulty &&
      context.settings?.autoCalibration === autoCalibration &&
      context.balance?.deck?.maxHp === maxHp &&
      feasibility?.currentHp === currentHp &&
      feasibility?.currentLust === currentLust &&
      deckProfileAlreadyApplied &&
      persistedDeckProfileIsCurrent &&
      rewardCandidates.length === 0 &&
      context.rewardReview === undefined
    ) {
      return { changed: false, assessment: null };
    }
  }
  const assessment = assessMvuContentDesign(variables, options);
  if (!assessment || !isRecord(battle)) return { changed: false, assessment };
  const lineageChanged = stableJson(battle.lineage_memory) !== stableJson(assessment.lineage);
  if (lineageChanged) battle.lineage_memory = assessment.lineage;
  if (stableJson(battle.design_context) === stableJson(assessment.context)) {
    return { changed: lineageChanged, assessment };
  }
  battle.design_context = assessment.context;
  return { changed: true, assessment };
}
