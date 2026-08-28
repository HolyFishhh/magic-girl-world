import { settleCurrentMessageBattle } from '../../runtime/battleSettlementAdapter';
import { getCurrentMessageVariables, replaceCurrentMessageVariables } from '../../runtime/messageVariables';
import { TavernContinuationHost } from '../../runtime/tavernContinuation';
import {
  formatBattleEndPrompt,
  effectProgramToDisplayTags,
  formatBuildGuidance,
  readBattleEndResult,
  recommendBattleRewardBudget,
  recommendBuildGuidance,
  summarizeBuildBudget,
  triggeredEffectProgramToDisplayTags,
  type BattleEndResult,
  type EffectProgram,
} from '../../game-core';
import type { GameState } from '../../game-core';
import { TavernBattleEffectPresenter, type BattleEndDialogRequest } from '../ui/battleEffectPresenter';
import { DynamicStatusManager } from '../combat/dynamicStatusManager';
import { GameStateManager } from './gameStateManager';
import { BattleLog } from '../modules/battleLog';

export interface TavernBattleEndPorts {
  getState(): GameState;
  clearBattleSession(): Promise<void>;
  reloadBattleState(): Promise<boolean>;
  readVariables(): Record<string, any>;
  replaceVariables(variables: Record<string, any>): Promise<unknown>;
  settleBattle(input: Parameters<typeof settleCurrentMessageBattle>[0]): Promise<void>;
  reloadPage(): void;
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

/** Tavern-only continuation boundary for leaving a completed battle message. */
export class TavernBattleEndHost {
  private static instance: TavernBattleEndHost;

  public constructor(
    private readonly continuationHost = TavernContinuationHost.getInstance(),
    private readonly ports: TavernBattleEndPorts = (() => {
      const gameStateManager = GameStateManager.getInstance();
      return {
        getState: () => gameStateManager.getGameState(),
        clearBattleSession: () => gameStateManager.clearBattleSession(),
        reloadBattleState: () => gameStateManager.loadFromSillyTavern(),
        readVariables: () => getCurrentMessageVariables(),
        replaceVariables: variables => Promise.resolve(replaceCurrentMessageVariables(variables)),
        settleBattle: input => settleCurrentMessageBattle(input),
        reloadPage: () => location.reload(),
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
    const settlement = {
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
        const snapshot = cloneVariables(this.ports.readVariables());
        try {
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

  public async presentBattleEnd(result: BattleEndResult, narrativeText?: string): Promise<void> {
    try {
      const gameState = this.ports.getState();
      const player = gameState.player;
      const enemy = gameState.enemy;
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
      const guidance = request && budget ? formatBuildGuidance(recommendBuildGuidance(request.content, budget)) : '';
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
              enemy: enemy ? { name: enemy.name } : null,
            };
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
        enemy: enemy
          ? {
              name: enemy.name,
              hp: enemy.currentHp,
              maxHp: enemy.maxHp,
              lust: enemy.currentLust,
              maxLust: enemy.maxLust,
              energy: enemy.energy,
              maxEnergy: enemy.maxEnergy,
              block: enemy.block,
              statuses: enemy.statusEffects,
              actions: compactNamedAssets(enemy.actions, false, resolveStatusName),
              abilities: compactNamedAssets(enemy.abilities, false, resolveStatusName),
              desireEffect: compactNamedEffect(enemy.lustEffect, resolveStatusName),
            }
          : null,
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
        onConfirm: playerContinuation => {
          const continuationPrompt = formatBattleEndPrompt({ ...promptInput, playerContinuation });
          return this.confirmBattleEnd(result, continuationPrompt.promptedBattleSummary, rewardRequest);
        },
        onRestart: () => this.restartBattle(),
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
