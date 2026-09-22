import { createBattleRandomState, stableHash32, startBattleSession, analyzeEffectProgram, summarizeEffectProgram, shuffleCards, type GameState, type Card } from '../game-core';
import { summarizeEncounterEvaluation, type EncounterEvaluation, type EncounterPolicy, type EncounterTrial } from '../game-core/encounterEvaluation';
import { GameStateManager } from '../fish/core/gameStateManager';
import { BattleSessionHost } from '../fish/core/battleSessionHost';
import { createBattleRequestFromMvu } from '../fish/core/battleContractAdapter';
import { BattleManager } from '../fish/combat/battleManager';
import { CardSystem } from '../fish/combat/cardSystem';
import { UnifiedEffectExecutor } from '../fish/combat/unifiedEffectExecutor';
import { DynamicStatusManager } from '../fish/combat/dynamicStatusManager';
import { installIsolatedBattlePresentation, isolatedBattlePresentation } from '../fish/core/isolatedBattlePresentation';

export interface EncounterEvaluationInput {
  battle: Record<string, any>;
  seed?: number;
  seeds?: number;
  policies?: EncounterPolicy[];
  maxTurns?: number;
  maxDecisions?: number;
  /** After this many expensive decisions, continue the real fight with a public rollout. */
  maxSearchDecisions?: number;
  /** Public, deterministic branch cap. Reaching it reports limited coverage. */
  maxCandidateBranches?: number;
  /** Full-encounter continuations are reserved for the best public candidates. */
  maxForecastCandidates?: number;
  maxForecastTurns?: number;
  /** Total real-engine continuations allowed for one trial (two weights per candidate). */
  maxForecastBranches?: number;
  /** Throughput probes can use cheaper policy search; outcomes always use real rules. */
  search?: 'one_turn' | 'full_encounter' | 'rollout';
  /** Actual cards allowed per simulated turn; rollout probes use this instead of branching. */
  maxPlaysPerTurn?: number;
}
let busy = false;
let currentPolicy: EncounterPolicy = 'engine';
let fullSearch = true;
let limitations = new Set<string>();
let decisionLimited = false;
let recoveredFailure = false;
let referenceMaxHp = 80, referenceMaxLust = 100;
let forecastBranchesRemaining = 0;
const noop = () => undefined;
function presentation(methods: string[], extras: Record<string, unknown> = {}): object {
  return Object.fromEntries([...methods.map(name => [name, noop]), ...Object.entries(extras)]);
}
function install(): void {
  if (isolatedBattlePresentation()) return;
  const logs = ['addLog', 'logStatusEffect', 'logLustOverflow'];
  installIsolatedBattlePresentation({ terminal: noop, presenters: {
    effects: presentation([...logs, 'showBlockAbsorption', 'showBlockChange', 'showEnergyChange', 'showResourceChange',
      'showSummonAction', 'showHealthChange', 'showLustChange', 'showLustOverflow', 'refreshPlayerEnergy', 'showBattleEndDialog'],
      { hasBattleEndDialog: () => false }),
    cards: presentation([...logs, 'animateCardPlay', 'animateCardDeparture', 'showCardBlockedNotification',
      'logDiscardCardDetail', 'clearCardInteractionStates', 'animateTriggeredCard'], {
      selectCards: async (cards: readonly Card[], request: { minimum: number; maximum: number; title: string }) => {
        limitations.add('交互选牌采用公开候选排序；未穷举全部选择组合');
        decisionLimited = true;
        const discard = /弃|消耗|销毁|移除/.test(request.title);
        const score = (card: Card) => (card.type === 'Power' ? 3 : card.type === 'Attack' ? 2 : 1) * (discard ? -1 : 1);
        return [...cards].sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id))
          .slice(0, request.maximum).map(card => card.id);
      },
    }),
    relics: presentation(['showTriggered', 'addTriggeredLog', 'addLog']),
    intent: presentation(['addLog', 'showStunned', 'showAction', 'logAction', 'render']),
    effect_choice: { choose: async (choice: { count?: number; options: { id: string }[] }) => {
      limitations.add('选择效果采用固定候选策略；未穷举全部分支');
      decisionLimited = true;
      const count = choice.count ?? 1;
      const ordered = currentPolicy === 'survival' && choice.options.length > 1
        ? [choice.options[1], choice.options[0], ...choice.options.slice(2)]
        : choice.options;
      const selected = ordered.slice(0, count).map(option => option.id);
      return count === 1 ? selected[0] ?? null : selected.length === count ? selected : null;
    } },
    summon_choice: { choose: async (units: { instanceId: string; currentHp?: number }[], amount: number) => {
      limitations.add('交互召唤物选择采用生命排序；未穷举全部选择组合');
      decisionLimited = true;
      return [...units].sort((a, b) => (a.currentHp || 0) - (b.currentHp || 0)).slice(0, amount).map(unit => unit.instanceId);
    } },
  } });
}
function living(state: GameState) { return (state.enemies || []).filter(enemy => enemy.currentHp > 0); }
function metrics(state: GameState) {
  const events = state.eventJournal?.events || [];
  let damage = 0, lustDealt = 0, lost = 0, blocked = 0, cards = 0, summonHpLost = 0, summonBlocked = 0;
  const playerIds = new Set(['player', ...(state.summons?.living || []).filter(unit => unit.owner === 'player').map(unit => unit.instanceId)]);
  for (const event of events) if (event.kind === 'summon_spawned' && event.ownerId === 'player') playerIds.add(event.summonId);
  for (const event of events) {
    if (event.kind === 'damage_resolved') {
      if (event.targetId === 'player') { lost += event.hpLost; blocked += event.blocked; }
      else if (!playerIds.has(event.targetId)) damage += event.hpLost;
    }
    if (event.kind === 'lust_increased' && !playerIds.has(event.targetId)) lustDealt += event.amount;
    if (event.kind === 'summon_intercepted' && event.targetId === 'player') {
      summonHpLost += event.hpLost; summonBlocked += event.blocked;
    }
    if (event.kind === 'card_played' && event.phase === 'before' && event.replayIndex === 0) cards++;
  }
  return { damage, lustDealt, lost, blocked, cards, summonHpLost, summonBlocked,
    summonHpRemaining: (state.summons?.living || []).filter(unit => unit.owner === 'player')
      .reduce((sum, unit) => sum + Math.max(0, unit.currentHp || 0), 0) };
}
function engineValue(state: GameState): number {
  const player = state.player;
  // Only a policy heuristic. Effects are always executed by the real engine.
  // Held buffs/resources are only bounded setup hints, never added to measured damage.
  return (player.abilities?.length || 0) * 2 + (player.orbs?.orbs?.length || 0)
    + (state.summons?.living || []).filter(unit => unit.owner === 'player').length * 2
    + player.statusEffects.reduce((sum, held) => sum + (DynamicStatusManager.getInstance().getStatusDefinition(held.id)?.type === 'buff' && held.stacks > 0 ? 3 + Math.min(10, [...player.hand, ...player.drawPile, ...player.discardPile].filter(card => JSON.stringify(card.effectProgram).includes('self.status.' + held.id)).length * 2) : 0), 0)
    + Object.values(player.resources || {}).reduce((sum, resource) => sum + Math.min(12, Math.max(0, resource.current)) * 0.75, 0);
}
type Candidate = { cardId?: string; targetId?: string; score: number; defended: boolean };
const DEFAULT_CANDIDATE_BRANCHES = 16;
const DEFAULT_FORECAST_CANDIDATES = 2;
const DEFAULT_FORECAST_TURNS = 2;
const DEFAULT_FORECAST_BRANCHES = 4;
const candidateProfile = (card: Card) => {
  const key = JSON.stringify(card.effectProgram);
  let profile = rolloutProfiles.get(key);
  if (!profile) { profile = analyzeEffectProgram(card.effectProgram); if (profile) rolloutProfiles.set(key, profile); }
  return profile;
};
/**
 * Changing activeEnemy only matters when the immediate program can read or act
 * on an opponent. Unknown, deferred, random and conditional programs remain
 * target-sensitive deliberately: collapsing them would change real semantics.
 */
export function needsEnemyTarget(program: Card['effectProgram']): boolean {
  if (!program || JSON.stringify(program).includes('opponent.')) return true;
  const safeSelfOnly = new Set(['draw_cards', 'scry_cards', 'discard_cards', 'exhaust_cards', 'recover_cards', 'reduce_card_cost',
    'modify_card_value', 'copy_cards', 'double_card_effect', 'auto_play_cards', 'replay_current', 'set_card_destination', 'move_cards',
    'remove_cards', 'transform_cards', 'apply_card_patch', 'apply_card_attachment', 'upgrade_cards', 'persistent_growth']);
  const knownOps = new Set([...safeSelfOnly, 'damage', 'execute', 'kill', 'heal', 'gain_block', 'gain_energy', 'gain_resource',
    'set_resource', 'gain_lust', 'set_stat', 'apply_status', 'remove_status', 'spawn_summon', 'spawn_enemy', 'damage_summons',
    'heal_summons', 'modify_summons', 'modify_summon_effects', 'gain_summon_resource', 'set_summon_resource', 'apply_summon_status',
    'remove_summon_status', 'activate_summons', 'dismiss_summons', 'copy_summons', 'summoner_effects', 'modify', 'card_play_rule',
    'set_stance', 'channel_orb', 'evoke_orbs']);
  const inspect = (nodes: readonly any[]): boolean => nodes.some(node => {
    if (!node || typeof node !== 'object') return true;
    if (node.target === 'opponent') return true;
    if (['register_trigger', 'add_card', 'ensure_card', 'choose_one', 'random', 'schedule'].includes(node.op)) return true;
    if (typeof node.op !== 'string' || !knownOps.has(node.op) || (!safeSelfOnly.has(node.op) && node.target !== 'self')) return true;
    return inspect(node.then || []) || inspect(node.else || []) || inspect(node.effects || []);
  });
  return inspect(program.steps);
}
/** Public diagnostic seam for candidate construction; does not inspect battle state. */
export function candidateTargetsForCard(program: Card['effectProgram'], enemyIds: readonly string[]): Array<string | undefined> {
  return needsEnemyTarget(program) ? (enemyIds.length ? [...enemyIds] : [undefined]) : [undefined];
}
function publicCandidateScore(candidate: Candidate, cards: CardSystem, state: GameState): number {
  if (!candidate.cardId) return -Infinity;
  const card = cards.getPlayableCards().find(entry => entry.id === candidate.cardId);
  if (!card) return -Infinity;
  const profile = candidateProfile(card);
  const target = (state.enemies || []).find(enemy => enemy.id === candidate.targetId);
  const damage = profile?.damage || 0, defense = profile?.metrics.defense || 0;
  return Math.min(damage, (target?.currentHp || 0) + (target?.block || 0)) + defense * 1.5
    + (profile?.metrics.sustain || 0) * 2 + (profile?.metrics.draw || 0) * 2 + (card.type === 'Power' ? 3 : 0);
}
/** Deterministic second-stage selection keeps an end-turn candidate when its first-stage result earns it. */
export function selectForecastShortlist<T extends { score: number }>(candidates: readonly T[], count: number): T[] {
  return [...candidates].sort((a, b) => b.score - a.score).slice(0, Math.max(0, count));
}
function boundedCandidates(playable: readonly Card[], targets: readonly string[], cards: CardSystem, state: GameState,
  limit: number, preserveTargets: boolean): Candidate[] {
  const candidates: Candidate[] = [{ score: -Infinity, defended: false }];
  for (const card of playable.slice(0, 16)) {
    const cardTargets = preserveTargets ? (targets.length ? [...targets] : [undefined]) : candidateTargetsForCard(card.effectProgram, targets);
    for (const targetId of cardTargets) candidates.push({ cardId: card.id, targetId, score: -Infinity, defended: false });
  }
  const scored = candidates.map(candidate => ({ candidate, publicScore: publicCandidateScore(candidate, cards, state) }));
  const cap = Math.max(1, limit);
  if (scored.length > cap) {
    decisionLimited = true; limitations.add(`公开策略仅评估${cap}/${scored.length}个动作分支`);
    const idle = scored.find(entry => !entry.candidate.cardId)!;
    const ranked = scored.filter(entry => entry.candidate.cardId).sort((a, b) => b.publicScore - a.publicScore || String(a.candidate.cardId || '').localeCompare(String(b.candidate.cardId || ''))
      || String(a.candidate.targetId || '').localeCompare(String(b.candidate.targetId || '')));
    scored.splice(0, scored.length, idle, ...ranked.slice(0, Math.max(0, cap - 1)));
  }
  return scored.map(entry => entry.candidate);
}
/** Cheap rollout policy, still executing every chosen card through the production
 * runtime. Its heuristic chooses actions; it never substitutes for damage rules.
 */
const rolloutProfiles = new Map<string, ReturnType<typeof analyzeEffectProgram>>();
async function rolloutAction(defenseWeight: number): Promise<Candidate> {
  const store = GameStateManager.getInstance(), cards = CardSystem.getInstance();
  const before = structuredClone(store.getGameState()), p = before.player;
  const enemies = living(before);
  const incoming = (enemy: typeof enemies[number]) => enemy.nextAction
    ? Math.max(0, summarizeEffectProgram(enemy.nextAction.effectProgram).damage || 0) : 0;
  const threat = enemies.reduce((sum, enemy) => sum + incoming(enemy), 0);
  let best: Candidate = { score: 0, defended: false };
  // Score real one-card state transitions, not a second interpreter of formulas.
  // Branch RNG/draw hypotheses never reuse the hidden live draw order.
  for (const card of cards.getPlayableCards().slice(0, 16)) {
    for (const targetId of candidateTargetsForCard(card.effectProgram, enemies.map(e => e.id))) {
      const token = BattleSessionHost.getInstance().beginScopedTransaction('evaluation_rollout_candidate');
      try {
        store.setRandomState(createBattleRandomState(stableHash32(['rollout-public-v2'])));
        store.updatePlayer({ drawPile: shuffleCards([...p.drawPile].sort((a, b) => a.id.localeCompare(b.id)), () => store.nextRandom()) });
        if (targetId) store.setActiveEnemy(targetId);
        if (!await cards.playCard(card.id)) continue;
        const after = store.getGameState();
        const damage = Math.max(0, enemies.reduce((n, e) => n + e.currentHp, 0) - living(after).reduce((n, e) => n + e.currentHp, 0));
        const lust = enemies.reduce((n, e) => n + Math.max(0, (after.enemies?.find(a => a.id === e.id)?.currentLust ?? e.currentLust) - e.currentLust), 0);
        const block = Math.min(Math.max(0, after.player.block - p.block), Math.max(0, threat - p.block));
        const prevented = enemies.filter(e => !living(after).some(a => a.id === e.id)).reduce((n, e) => n + incoming(e), 0);
        const score = (after.battleResult === 'victory' ? 10000 : 0) - (after.battleResult === 'defeat' ? 10000 : 0)
          + damage + lust * 0.5 + (prevented + block) * defenseWeight
          + Math.max(0, after.player.currentHp - p.currentHp) * 3 - Math.max(0, p.currentHp - after.player.currentHp) * defenseWeight
          + Math.max(0, after.player.hand.length - p.hand.length + 1) * 3
          + (engineValue(after) - engineValue(before)) * (defenseWeight === 1.1 ? 2 : 1) + 0.05;
        if (score > best.score) best = { cardId: card.id, targetId, score, defended: block > 0 };
      } finally { BattleSessionHost.getInstance().rollbackTransaction(token); }
    }
  }
  return best;
}
async function forecastFight(defenseWeight: number, horizon: number): Promise<number> {
  const store = GameStateManager.getInstance(), cards = CardSystem.getInstance(), manager = BattleManager.getInstance();
  const startingLust = store.getGameState().player.currentLust;
  let rounds = 0;
  for (; rounds < horizon && !store.isGameOver(); rounds++) {
    let play = 0;
    for (; play < 12 && !store.isGameOver(); play++) {
      const choice = await rolloutAction(defenseWeight);
      if (!choice.cardId) break;
      if (choice.targetId) store.setActiveEnemy(choice.targetId);
      if (!await cards.playCard(choice.cardId)) throw new Error('预测路径的合法动作执行失败');
    }
    if (play >= 12 && !store.isGameOver() && cards.getPlayableCards().length) {
      decisionLimited = true; limitations.add('预测续局达到每回合出牌上限，未覆盖长连招');
    }
    if (!store.isGameOver()) await manager.endPlayerTurn();
  }
  const result = store.getGameState();
  // Final retained condition is the objective. Speed breaks equal-condition ties.
  // A local block gain cannot outweigh a later loss caused by enemy strengthening.
  if (result.battleResult === 'victory') return 1000000
    + (result.player.currentHp / referenceMaxHp - result.player.currentLust / referenceMaxLust) * 10000 - rounds * 0.01;
  if (result.battleResult === 'defeat') return -1000000;
  return -10000 + result.player.currentHp - living(result).reduce((sum, enemy) => sum + enemy.currentHp, 0)
    - Math.max(0, result.player.currentLust - startingLust) * referenceMaxHp / referenceMaxLust;
}
async function chooseAction(policy: EncounterPolicy, turn: number, decision: number, input: Partial<EncounterEvaluationInput>): Promise<Candidate> {
  const store = GameStateManager.getInstance(), cards = CardSystem.getInstance(), manager = BattleManager.getInstance();
  const before = structuredClone(store.getGameState());
  const playable = cards.getPlayableCards();
  const targets = living(before).map(enemy => enemy.id);
  const useFullForecast = policy === 'engine' && fullSearch && forecastBranchesRemaining >= 4;
  if (policy === 'engine' && fullSearch && !useFullForecast) {
    decisionLimited = true; limitations.add('整场续局预算已用尽，后续动作仅作单回合公开评估');
  }
  // A card can wake abilities, statuses, relics, or summons whose later effects
  // resolve through activeEnemy. Only a completely plain battlefield may safely
  // collapse a self-only card's otherwise equivalent enemy choices.
  const hasReactiveCombatContext = Boolean(before.player.abilities?.length || before.player.statusEffects?.length
    || before.player.relics?.length || before.summons?.living?.length
    || (before.enemies || []).some(enemy => enemy.abilities?.length || enemy.statusEffects?.length));
  const candidates = boundedCandidates(playable, targets, cards, before, input.maxCandidateBranches ?? DEFAULT_CANDIDATE_BRANCHES,
    hasReactiveCombatContext);
  if (playable.length > 16) { decisionLimited = true; limitations.add('每次决策最多评估16张可用牌，其余牌仍保留在正式手牌中'); }
  const baseHp = before.player.currentHp;
  const beforeEnemies = living({ ...before, enemies: before.enemies || [] });
  const hpTotal = beforeEnemies.reduce((sum, enemy) => sum + enemy.currentHp, 0);
  for (const candidate of candidates) {
    const token = BattleSessionHost.getInstance().beginScopedTransaction('evaluation_branch');
    try {
      // Policy branches must not inspect or reuse the actual hidden combat RNG cursor.
      // All candidates see the same independent public decision sample.
      store.setRandomState(createBattleRandomState(stableHash32(['policy-sample-v1', turn, decision])));
      // The persisted draw pile already has its true hidden order. Merely replacing
      // the RNG cursor would still leak that order through future draw execution.
      // Canonicalize the known multiset first, then sample a hypothesis independent
      // of the actual order. Currently we conservatively do not exploit scry memory.
      store.updatePlayer({ drawPile: shuffleCards([...before.player.drawPile].sort((a, b) => a.id.localeCompare(b.id)), () => store.nextRandom()) });
      if (candidate.targetId) store.setActiveEnemy(candidate.targetId);
      if (candidate.cardId && !await cards.playCard(candidate.cardId)) continue;
      const afterCard = structuredClone(store.getGameState());
      const removed = beforeEnemies.length - living(afterCard).length;
      const dealt = Math.max(0, hpTotal - living(afterCard).reduce((sum, enemy) => sum + enemy.currentHp, 0));
      const resources = afterCard.player.energy - before.player.energy;
      const extraCards = Math.max(0, afterCard.player.hand.length - before.player.hand.length + (candidate.cardId ? 1 : 0));
      candidate.defended = afterCard.player.block > before.player.block || afterCard.player.currentHp > baseHp;
      if (!store.isGameOver()) await manager.endPlayerTurn();
      let projected = store.getGameState();
      const firstHp = projected.player.currentHp;
      // Revealed future hand/order never participates in the score. Waiting a second
      // round samples only the already-installed engine, e.g. summon/status payoffs.
      projected = store.getGameState();
      const loss = Math.max(0, baseHp - projected.player.currentHp);
      const lustLoss = Math.max(0, projected.player.currentLust - before.player.currentLust);
      const totalDealt = Math.max(0, hpTotal - living(projected).reduce((sum, enemy) => sum + enemy.currentHp, 0));
      const defenseWeight = policy === 'tempo' ? 0.15 : policy === 'survival' ? 2.4 : 1.1;
      const lethal = afterCard.battleResult === 'victory';
      const risk = projected.battleResult === 'defeat' ? (policy === 'tempo' ? 40 : 1000) : 0;
      candidate.score = (lethal ? 10000 : 0) - risk + dealt + removed * 5
        - (loss + lustLoss * referenceMaxHp / referenceMaxLust) * defenseWeight + Math.max(0, projected.player.currentHp - baseHp)
        + Math.max(0, totalDealt - dealt) * 0.7 + (policy === 'engine' ? engineValue(afterCard) - engineValue(before) : 0)
        + extraCards * 1.5 + resources * 0.2
        + (policy === 'survival' ? (firstHp - baseHp) : 0) + (candidate.cardId ? 0.05 : 0);
    } finally {
      BattleSessionHost.getInstance().rollbackTransaction(token);
    }
  }
  if (!useFullForecast || candidates.length < 2) return candidates.reduce((best, candidate) => candidate.score > best.score ? candidate : best);
  const forecastCount = Math.min(input.maxForecastCandidates ?? DEFAULT_FORECAST_CANDIDATES, Math.floor(forecastBranchesRemaining / 2), candidates.length);
  const shortlist = selectForecastShortlist(candidates, forecastCount);
  if (shortlist.length < 2) return candidates.reduce((best, candidate) => candidate.score > best.score ? candidate : best);
  if (shortlist.length < candidates.length) { decisionLimited = true; limitations.add(`整场续局仅复测单回合评分前${shortlist.length}/${candidates.length}个候选`); }
  for (const candidate of shortlist) {
    const token = BattleSessionHost.getInstance().beginScopedTransaction('full_encounter_forecast');
    try {
      store.setRandomState(createBattleRandomState(stableHash32(['policy-sample-v1', turn, decision])));
      store.updatePlayer({ drawPile: shuffleCards([...before.player.drawPile].sort((a, b) => a.id.localeCompare(b.id)), () => store.nextRandom()) });
      if (candidate.targetId) store.setActiveEnemy(candidate.targetId);
      if (candidate.cardId && !await cards.playCard(candidate.cardId)) continue;
      let score = -Infinity;
      for (const weight of [0.6, 2.4]) {
        const continuation = BattleSessionHost.getInstance().beginScopedTransaction('full_encounter_weight');
        try {
          forecastBranchesRemaining--;
          if (!candidate.cardId && !store.isGameOver()) await manager.endPlayerTurn();
          score = Math.max(score, await forecastFight(weight, Math.min(input.maxForecastTurns ?? DEFAULT_FORECAST_TURNS, Math.max(3, 9 - turn))));
        } finally { BattleSessionHost.getInstance().rollbackTransaction(continuation); }
      }
      candidate.score = score;
    } finally { BattleSessionHost.getInstance().rollbackTransaction(token); }
  }
  if (forecastBranchesRemaining < 4) { decisionLimited = true; limitations.add('整场续局预算已用尽，后续动作仅作单回合公开评估'); }
  return shortlist.reduce((best, candidate) => candidate.score > best.score ? candidate : best);
}
/** Public diagnostic seam; returns an action without mutating state or its random cursor. */
export async function planIsolatedEncounterAction(policy: EncounterPolicy, turn: number, decision = 0): Promise<Candidate> {
  if (!isolatedBattlePresentation()) throw new Error('An isolated battle host is required');
  return chooseAction(policy, turn, decision, {});
}
async function trial(input: EncounterEvaluationInput, policy: EncounterPolicy, seed: number): Promise<EncounterTrial> {
  const store = GameStateManager.getInstance(), cards = CardSystem.getInstance(), manager = BattleManager.getInstance();
  const session = BattleSessionHost.getInstance();
  currentPolicy = policy; limitations = new Set(['有限策略搜索仅证明已找到的完整路线，不保证最优；续局以真实单牌分支评分选牌，实际结果均由正式引擎结算']);
  decisionLimited = false; recoveredFailure = false;
  referenceMaxHp = Math.max(1, Number(input.battle.core?.max_hp) || 80);
  referenceMaxLust = Math.max(1, Number(input.battle.core?.max_lust) || 100);
  session.observeRecoveredTriggerFailures(({ scope, error }) => {
    recoveredFailure = true;
    limitations.add(`触发器已回滚但本次评估不完整 (${scope}): ${error instanceof Error ? error.message : String(error)}`);
  });
  if ((input.battle.items || []).length) {
    decisionLimited = true; limitations.add('未搜索消耗道具的使用路线，不能据此判定构筑缺少解法');
  }
  fullSearch = input.search !== 'one_turn' && input.search !== 'rollout';
  forecastBranchesRemaining = Math.max(0, Math.trunc(input.maxForecastBranches ?? DEFAULT_FORECAST_BRANCHES));
  if (rolloutProfiles.size > 1024) rolloutProfiles.clear();
  let turns = 1, deadTurns = 0, decisions = 0, defensiveChoices = 0;
  const horizons: EncounterTrial['horizons'] = [];
  const statusUptime = new Map<string, { id: string; name: string; turns: number }>();
  let outcome: EncounterTrial['outcome'] = 'horizon';
  try {
    const request = createBattleRequestFromMvu({ stat_data: { battle: input.battle } }, input.battle);
    request.seed = seed;
    store.loadIsolatedBattleRequest(request);
    DynamicStatusManager.getInstance().replaceDefinitions(input.battle.statuses || []);
    UnifiedEffectExecutor.getInstance();
    await startBattleSession({ gate: session.gate, beginTransaction: action => session.beginTransaction(action),
      commitTransaction: token => session.commitTransaction(token), rollbackTransaction: token => session.rollbackTransaction(token),
      restored: false, isTerminal: () => store.isGameOver(), executeStartStep: step => manager.executeBattleStartFlowStep(step) });
    const maxTurns = Math.min(16, Math.max(1, input.maxTurns ?? 10));
    for (turns = 1; turns <= maxTurns && !store.isGameOver(); turns++) {
      let plays = 0;
      const playLimit = Math.min(24, Math.max(1, input.maxPlaysPerTurn ?? 24));
      if (input.search === 'rollout') { decisionLimited = true; limitations.add('构筑探针采用公开启发式选牌，未穷举分支'); }
      for (let step = 0; step < playLimit && !store.isGameOver(); step++) {
        if (input.search === 'rollout' || (input.maxSearchDecisions !== undefined && decisions >= input.maxSearchDecisions)) {
          decisionLimited = true;
          if (input.search !== 'rollout') limitations.add('分支搜索预算已用尽，使用公开策略继续完整战斗；不代表最优路线');
          const action = await rolloutAction(policy === 'tempo' ? 0.15 : policy === 'survival' ? 2.4 : 1.1);
          if (!action.cardId) break;
          if (action.targetId) store.setActiveEnemy(action.targetId);
          if (!await cards.playCard(action.cardId)) throw new Error('公开启发式选择的动作执行失败');
          plays++; if (action.defended) defensiveChoices++;
          continue;
        }
        if (++decisions > (input.maxDecisions ?? 160)) { limitations.add('达到决策预算，未证明胜负'); outcome = 'inconclusive'; break; }
        const action = await chooseAction(policy, turns, step, input);
        if (!action.cardId) break;
        if (action.targetId) store.setActiveEnemy(action.targetId);
        if (!await cards.playCard(action.cardId)) throw new Error('已验证可用的动作执行失败');
        plays++; if (action.defended) defensiveChoices++;
      }
      for (const held of store.getGameState().player.statusEffects) {
        const definition = DynamicStatusManager.getInstance().getStatusDefinition(held.id);
        if (held.stacks > 0 && definition?.type === 'buff' && definition.maxStacks === 1) {
          const observed = statusUptime.get(held.id) || { id: held.id, name: definition.name, turns: 0 };
          observed.turns++; statusUptime.set(held.id, observed);
        }
      }
      if (!plays) deadTurns++;
      if (plays >= playLimit && !store.isGameOver() && cards.getPlayableCards().length) {
        outcome = 'inconclusive'; limitations.add('本回合达到出牌预算，尚有合法动作，不能按主动结束回合评估');
      }
      if (outcome === 'inconclusive') break;
      if (!store.isGameOver()) await manager.endPlayerTurn();
      const measured = metrics(store.getGameState());
      horizons.push({ turn: turns, damage: measured.damage, hpLost: measured.lost, blocked: measured.blocked,
        hpRemaining: store.getGameState().player.currentHp, summonHpLost: measured.summonHpLost,
        summonBlocked: measured.summonBlocked, summonHpRemaining: measured.summonHpRemaining });
      if (store.isGameOver()) break;
    }
    if (store.isGameOver()) outcome = store.getGameState().battleResult as EncounterTrial['outcome'];
    turns = Math.min(turns, maxTurns);
    if (outcome === 'terminated') limitations.add('剧情终止不等同于胜利或失败');
    if (recoveredFailure) outcome = 'inconclusive';
  } catch (error) {
    outcome = 'inconclusive'; limitations.add(error instanceof Error ? error.message : String(error));
  }
  const state = store.getGameState(), measured = metrics(state);
  const netHpLost = Math.max(0, Number(input.battle.core?.hp ?? input.battle.core?.max_hp ?? 80) - state.player.currentHp);
  const netLustGained = Math.max(0, state.player.currentLust - Number(input.battle.core?.lust || 0));
  return { seed, policy, outcome, turns, hpRemaining: state.player.currentHp, lustRemaining: state.player.currentLust,
    netHpLost, netLustGained, conditionLoss: netHpLost / referenceMaxHp + netLustGained / referenceMaxLust, hpLost: measured.lost,
    damageDealt: measured.damage, lustDealt: measured.lustDealt, blocked: measured.blocked, summonHpLost: measured.summonHpLost,
    enemyHpRemaining: (state.enemies || (state.enemy ? [state.enemy] : [])).reduce((sum, enemy) => sum + Math.max(0, enemy.currentHp), 0),
    summonBlocked: measured.summonBlocked, summonHpRemaining: measured.summonHpRemaining, cardsPlayed: measured.cards,
    deadTurns, decisions, defensiveChoices, killOrder: (state.defeatedEnemies || []).map(enemy => enemy.id),
    horizons, statusUptime: [...statusUptime.values()], limitations: [...limitations], decisionCoverage: decisionLimited ? 'limited' : 'bounded' };
}
/** Called only inside the isolated worker. Calls are serialized because each realm owns a runtime. */
export async function evaluateIsolatedEncounter(input: EncounterEvaluationInput): Promise<EncounterEvaluation> {
  install();
  if (busy) throw new Error('Concurrent simulations in one runtime are forbidden');
  busy = true;
  try {
    const count = Math.min(24, Math.max(1, Math.trunc(input.seeds ?? 4)));
    const seeds = Array.from({ length: count }, (_, index) => stableHash32(['encounter-evaluation-v1', input.seed ?? 0, index]));
    const trials: EncounterTrial[] = [];
    for (const policy of input.policies ?? ['tempo', 'survival', 'engine']) for (const seed of seeds)
      trials.push(await trial(input, policy, seed));
    return summarizeEncounterEvaluation(trials, seeds);
  } finally { BattleSessionHost.getInstance().observeRecoveredTriggerFailures(); busy = false; }
}
