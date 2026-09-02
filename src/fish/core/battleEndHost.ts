import { settleCurrentMessageBattle } from '../../runtime/battleSettlementAdapter';
import { getCurrentMessageVariables, replaceCurrentMessageVariables } from '../../runtime/messageVariables';
import { TavernContinuationHost } from '../../runtime/tavernContinuation';
import {
  cleanupCardProgression,
  completeRunNode,
  formatBattleEndPrompt,
  effectProgramToDisplayTags,
  assessContentDesign,
  readBattleEndResult,
  recommendBattleRewardBudget,
  summarizeBuildBudget,
  triggeredEffectProgramToDisplayTags,
  type BattleEndResult,
  type EffectProgram,
  readGameMode,
} from '../../game-core';
import type { GameState } from '../../game-core';
import { TavernBattleEffectPresenter, type BattleEndDialogRequest } from '../ui/battleEffectPresenter';
import { DynamicStatusManager } from '../combat/dynamicStatusManager';
import { GameStateManager } from './gameStateManager';
import { BattleLog } from '../modules/battleLog';
import { readRunState } from '../../runtime/runStateAdapter';
import { writeBackMvuCardProgression } from './mvuBattleAdapter';
import { switchRuntimeView } from '../../runtime/runtimeViewSwitcher';

export interface TavernBattleEndPorts {
  getState(): GameState;
  saveBattleSession?(): Promise<void>;
  finalizeCardProgression?(runEnded: boolean): Record<string, any>[];
  clearBattleSession(): Promise<void>;
  reloadBattleState(): Promise<boolean>;
  readVariables(): Record<string, any>;
  replaceVariables(variables: Record<string, any>): Promise<unknown>;
  settleBattle(input: Parameters<typeof settleCurrentMessageBattle>[0]): Promise<void>;
  reloadPage(): void;
  openCommonView?(): void;
}

function battleEndsRun(variables: Record<string, any>, result: BattleEndResult): boolean {
  const run = readRunState(variables.stat_data);
  if (!run || run.phase !== 'in_node' || !run.currentNode) return false;
  const outcome = result === 'victory' ? 'cleared' : result === 'defeat' ? 'failed' : 'escaped';
  const next = completeRunNode(run, { outcome });
  return next.phase === 'won' || next.phase === 'lost';
}

function finalizeRuntimeCardProgression(
  gameStateManager: GameStateManager,
  variables: Record<string, any>,
  runEnded: boolean,
): Record<string, any>[] {
  gameStateManager.cleanupOwnedCardProgression('combat_end');
  if (runEnded) gameStateManager.cleanupOwnedCardProgression('run_end');

  let runCards = gameStateManager.getPlayer().deck.map(card => cleanupCardProgression(card, 'combat_end'));
  if (runEnded) runCards = runCards.map(card => cleanupCardProgression(card, 'run_end'));
  gameStateManager.updatePlayer({ deck: runCards });
  const zones = gameStateManager.readCardZoneState();
  const combatCards = [...zones.hand, ...zones.drawPile, ...zones.discardPile, ...zones.exhaustPile];
  const mvuCards = variables.stat_data?.battle?.cards;
  return writeBackMvuCardProgression(mvuCards, runCards, combatCards).cards;
}

export interface TavernBattleEndPresentationPorts {
  hasBattleEndDialog(): boolean;
  showBattleEndDialog(request: BattleEndDialogRequest): void;
  addLog(message: string, type: 'system'): void;
}

function cloneVariables(value: Record<string, any>): Record<string, any> {
  return JSON.parse(JSON.stringify(value));
}

type NamedBattleAsset = {
  id?: string;
  name?: string;
  description?: string;
  count?: number;
  effectProgram?: EffectProgram;
  trigger?: string;
  source?: string;
};

function compactText(value: unknown, maximum = 96): string {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > maximum ? `${text.slice(0, maximum - 1)}…` : text;
}

function describeNamedAsset(entry: NamedBattleAsset, resolveStatusName: (statusId: string) => string | undefined): string {
  const trigger = String(entry.trigger || '').trim();
  const tags = trigger
    ? triggeredEffectProgramToDisplayTags(trigger, entry.effectProgram, { resolveStatusName })
    : effectProgramToDisplayTags(entry.effectProgram, { resolveStatusName });
  const mechanics = [...new Set(tags.map(tag => tag.text.trim()).filter(Boolean))].join('；');
  const source = compactText(entry.source, 64);
  const narrative = compactText(entry.description);
  return [source ? `来源：${source}` : '', mechanics ? `效果：${mechanics}` : '', narrative ? `说明：${narrative}` : '']
    .filter(Boolean)
    .join('；');
}

function compactNamedAssets(
  entries: ReadonlyArray<NamedBattleAsset> | undefined,
  useStoredCount = false,
  resolveStatusName: (statusId: string) => string | undefined = () => undefined,
): Array<{ name: string; count: number; description?: string }> {
  const grouped = new Map<string, { name: string; count: number; description?: string }>();
  for (const entry of entries || []) {
    const name = String(entry?.name || entry?.source || entry?.id || '').trim();
    if (!name) continue;
    const description = describeNamedAsset(entry, resolveStatusName);
    const key = `${name}\u0000${description}`;
    const current = grouped.get(key) || {
      name,
      count: 0,
      description: description || undefined,
    };
    current.count += useStoredCount ? Math.max(0, Math.floor(Number(entry.count) || 0)) : 1;
    grouped.set(key, current);
  }
  return [...grouped.values()].filter(entry => entry.count > 0);
}

function compactNamedEffect(
  entry: NamedBattleAsset | null | undefined,
  resolveStatusName: (statusId: string) => string | undefined,
): string {
  const asset = compactNamedAssets(entry ? [entry] : [], false, resolveStatusName)[0];
  return asset ? `${asset.name}${asset.description ? `（${asset.description}）` : ''}` : '';
}

function compactResources(value: unknown): Array<{ name: string; emoji?: string; current: number; max: number }> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.values(value as Record<string, any>).flatMap(resource => {
    if (!resource || typeof resource !== 'object') return [];
    const name = String(resource.name || resource.id || '').trim();
    const current = Number(resource.current);
    const max = Number(resource.max);
    if (!name || !Number.isFinite(current) || !Number.isFinite(max)) return [];
    return [{ name, emoji: String(resource.emoji || '').trim() || undefined, current, max }];
  });
}

/** Tavern-only continuation boundary for leaving a completed battle message. */
export class TavernBattleEndHost {
  private static instance: TavernBattleEndHost;
  private towerSettlementPending = false;

  public constructor(
    private readonly continuationHost = TavernContinuationHost.getInstance(),
    private readonly ports: TavernBattleEndPorts = (() => {
      const gameStateManager = GameStateManager.getInstance();
      return {
        getState: () => gameStateManager.getGameState(),
        saveBattleSession: () => gameStateManager.saveToSillyTavern(),
        finalizeCardProgression: runEnded =>
          finalizeRuntimeCardProgression(gameStateManager, getCurrentMessageVariables(), runEnded),
        clearBattleSession: () => gameStateManager.clearBattleSession(),
        reloadBattleState: () => gameStateManager.loadFromSillyTavern(),
        readVariables: () => getCurrentMessageVariables(),
        replaceVariables: variables => Promise.resolve(replaceCurrentMessageVariables(variables)),
        settleBattle: input => settleCurrentMessageBattle(input),
        reloadPage: () => location.reload(),
        openCommonView: () => switchRuntimeView('common'),
      };
    })(),
    private readonly injectedPresentation?: TavernBattleEndPresentationPorts,
  ) {}

  public static getInstance(): TavernBattleEndHost {
    if (!TavernBattleEndHost.instance) TavernBattleEndHost.instance = new TavernBattleEndHost();
    return TavernBattleEndHost.instance;
  }

  public async confirmBattleEnd(
    result: BattleEndResult,
    battleSummary: string,
    rewardRequest?: Record<string, unknown> | null,
  ): Promise<void> {
    const gameState = this.ports.getState();
    const settlement: Parameters<TavernBattleEndPorts['settleBattle']>[0] = {
      result,
      request: gameState.battleRequest,
      player: gameState.player,
      items: gameState.player.items || [],
      turns: gameState.currentTurn,
      rewardRequest,
    };

    await this.continuationHost.continueWithPrompt({
      prompt: battleSummary,
      prepare: async () => {
        await this.ports.saveBattleSession?.();
        const snapshot = cloneVariables(this.ports.readVariables());
        try {
          const persistentCards = this.ports.finalizeCardProgression?.(battleEndsRun(snapshot, result));
          if (persistentCards) settlement.persistentCards = persistentCards;
          // Clear the private session before settling MUV so the next assistant
          // floor cannot inherit a terminal runtime snapshot.
          await this.ports.clearBattleSession();
          await this.ports.settleBattle(settlement);
          return snapshot;
        } catch (prepareError) {
          try {
            await this.restoreBeforeSend(snapshot);
          } catch (rollbackError) {
            throw new AggregateError([prepareError, rollbackError], '战斗结算准备失败且回滚失败');
          }
          throw prepareError;
        }
      },
      rollbackBeforeSend: snapshot => this.restoreBeforeSend(snapshot),
    });
  }

  /** Settle a tower fight in-place without creating or triggering a chat floor. */
  public async confirmTowerBattleEnd(result: BattleEndResult): Promise<void> {
    if (this.towerSettlementPending) return;
    this.towerSettlementPending = true;
    const gameState = this.ports.getState();
    const settlement: Parameters<TavernBattleEndPorts['settleBattle']>[0] = {
      result,
      request: gameState.battleRequest,
      player: gameState.player,
      items: gameState.player.items || [],
      turns: gameState.currentTurn,
      rewardRequest: null,
    };
    await this.ports.saveBattleSession?.();
    const snapshot = cloneVariables(this.ports.readVariables());
    try {
      const persistentCards = this.ports.finalizeCardProgression?.(battleEndsRun(snapshot, result));
      if (persistentCards) settlement.persistentCards = persistentCards;
      await this.ports.clearBattleSession();
      await this.ports.settleBattle(settlement);
      this.ports.openCommonView?.();
    } catch (error) {
      try {
        await this.restoreBeforeSend(snapshot);
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], '爬塔战斗结算失败，且完整状态回滚失败');
      } finally {
        this.towerSettlementPending = false;
      }
      throw error;
    }
  }

  private isActiveTowerBattle(): boolean {
    const stat = this.ports.readVariables()?.stat_data;
    const run = readRunState(stat);
    return (
      readGameMode(stat) === 'tower' &&
      run?.schemaVersion === 3 &&
      run.routeMode === 'map' &&
      run.phase === 'in_node' &&
      !!run.currentNode &&
      ['battle', 'elite', 'boss'].includes(run.currentNode.kind)
    );
  }

  public async presentBattleEnd(result: BattleEndResult, narrativeText?: string): Promise<void> {
    try {
      const gameState = this.ports.getState();
      const towerMode = this.isActiveTowerBattle();
      const player = gameState.player;
      const enemy = gameState.enemy;
      const enemies = [
        ...(gameState.defeatedEnemies || []),
        ...(gameState.enemies?.length ? gameState.enemies : enemy ? [enemy] : []),
      ];
      const statusManager = DynamicStatusManager.getInstance();
      const resolveStatusName = (statusId: string): string | undefined =>
        statusManager.getStatusDefinition(statusId)?.name?.trim() || undefined;
      const narrativeCards = (player.discardPile ?? []).filter(card => card.type === 'Event');
      const request = gameState.battleRequest;
      const budget =
        result === 'victory' && request
          ? summarizeBuildBudget(request.content, { hp: player.currentHp, maxHp: player.maxHp })
          : null;
      const rewardBudget = result === 'victory' ? recommendBattleRewardBudget(request?.route || null) : null;
      const previousDesignContext = this.ports.readVariables()?.stat_data?.battle?.design_context;
      const outcomeMaxHp = Math.max(1, Number(request?.player?.maxHp) || Number(player.maxHp) || 1);
      const outcomeMaxLust = Math.max(1, Number(request?.player?.maxLust) || Number(player.maxLust) || 100);
      const outcomeFeedback = request
        ? {
            outcome: result,
            turns: Math.max(0, Math.floor(Number(gameState.currentTurn) || 0)),
            hpRatio: player.currentHp / outcomeMaxHp,
            lustRatio: player.currentLust / outcomeMaxLust,
          }
        : undefined;
      const guidance =
        request && budget
          ? assessContentDesign({
              pack: request.content,
              budget,
              player: {
                hp: player.currentHp,
                maxHp: player.maxHp,
                lust: player.currentLust,
                maxLust: player.maxLust,
              },
              danger: request.route?.danger ?? 1,
              act: request.route?.act ?? 1,
              previous: previousDesignContext,
              outcome: outcomeFeedback,
            }).context.brief
          : '';
      const limits: Record<string, number> = {};
      if (rewardBudget) {
        limits.cards = rewardBudget.cards.pick;
        if (rewardBudget.artifacts) limits.artifacts = rewardBudget.artifacts.pick;
        if (rewardBudget.items) limits.items = rewardBudget.items.pick;
      }
      const rewardRequest: Record<string, unknown> =
        result === 'victory' && rewardBudget
          ? {
              marker: '[MVU_BATTLE_SETTLEMENT]',
              result,
              cards: rewardBudget.cards,
              artifacts: rewardBudget.artifacts,
              items: rewardBudget.items,
              limits,
              build: guidance,
            }
          : {
              marker: '[MVU_BATTLE_SETTLEMENT]',
              result,
              penalty: true,
              enemy: enemies.length ? { names: enemies.map(entry => entry.name) } : null,
            };
      const promptEnemies = enemies.map(entry => ({
        name: entry.name,
        hp: entry.currentHp,
        maxHp: entry.maxHp,
        lust: entry.currentLust,
        maxLust: entry.maxLust,
        energy: entry.energy,
        maxEnergy: entry.maxEnergy,
        resources: compactResources(entry.resources),
        block: entry.block,
        statuses: entry.statusEffects,
        actions: compactNamedAssets(entry.actions, false, resolveStatusName),
        abilities: compactNamedAssets(entry.abilities, false, resolveStatusName),
        desireEffect: compactNamedEffect(entry.lustEffect, resolveStatusName),
      }));
      const promptInput = {
        result,
        continuation: request?.route ? 'run' : 'ordinary',
        narrativeText,
        player: {
          hp: player.currentHp,
          maxHp: player.maxHp,
          lust: player.currentLust,
          maxLust: player.maxLust,
          energy: player.energy,
          maxEnergy: player.maxEnergy,
          resources: compactResources(player.resources),
          drawPerTurn: player.drawPerTurn,
          block: player.block,
          statuses: player.statusEffects,
          handCount: player.hand?.length ?? 0,
          drawPileCount: player.drawPile?.length ?? 0,
          discardPileCount: player.discardPile?.length ?? 0,
          exhaustPileCount: player.exhaustPile?.length ?? 0,
          cards: compactNamedAssets(player.deck, false, resolveStatusName),
          relics: compactNamedAssets(player.relics, false, resolveStatusName),
          abilities: compactNamedAssets(player.abilities, false, resolveStatusName),
          items: compactNamedAssets(player.items, true, resolveStatusName),
          desireEffect: compactNamedEffect(gameState.battle?.player_lust_effect, resolveStatusName),
        },
        enemy: promptEnemies[0] || null,
        enemies: promptEnemies,
        turns: gameState.currentTurn,
        battleLog: BattleLog.buildTurnSummaryReport(),
        narrativeCards,
      } as const;
      const prompt = formatBattleEndPrompt(promptInput);

      const presentation = this.presentation();
      presentation.showBattleEndDialog({
        result,
        battleSummary: prompt.promptedBattleSummary,
        narrativeText,
        mode: towerMode ? 'tower' : 'story',
        onConfirm: playerContinuation => {
          if (towerMode) return this.confirmTowerBattleEnd(result);
          const continuationPrompt = formatBattleEndPrompt({ ...promptInput, playerContinuation });
          return this.confirmBattleEnd(result, continuationPrompt.promptedBattleSummary, rewardRequest);
        },
        ...(towerMode ? {} : { onRestart: () => this.restartBattle() }),
      });
      presentation.addLog(`战斗结束：${prompt.resultText}`, 'system');
    } catch (error) {
      console.error('❌ 触发战斗结束叙事失败:', error);
      throw error;
    }
  }

  /** Recreate the actionable end dialog when a completed message session is restored. */
  public resumeBattleEndDialog(): void {
    const state = this.ports.getState();
    const presentation = this.presentation();
    if (!state.isGameOver || state.phase !== 'game_over' || presentation.hasBattleEndDialog()) return;

    const result = readBattleEndResult(state);
    if (!result) return;
    void this.presentBattleEnd(result, state.battleNarrative || undefined);
  }

  public async restartBattle(): Promise<void> {
    await this.ports.clearBattleSession();
    this.ports.reloadPage();
  }

  private async restoreBeforeSend(snapshot: Record<string, any>): Promise<void> {
    await this.ports.replaceVariables(cloneVariables(snapshot));
    if (!(await this.ports.reloadBattleState())) throw new Error('恢复战斗消息快照失败');
  }

  private presentation(): TavernBattleEndPresentationPorts {
    return this.injectedPresentation || TavernBattleEffectPresenter.getInstance();
  }
}
