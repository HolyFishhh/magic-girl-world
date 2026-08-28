import {
  isCurrentMessageLatest,
  rerenderHistoricalMessageForDepth,
  watchCurrentMessageUntilHistorical,
} from '../../runtime/messageVariables';
import type { BattleContentIssue } from '../core/battleContentPreflight';
import { GameStateManager } from '../core/gameStateManager';
import { BattleLog } from '../modules/battleLog';
import { escapeHtml, escapeHtmlAttribute } from '../shared/html';
import type { GameState, Item } from '../../game-core';
import { BattleUI } from './battleUI';
import { Card3DEffects } from './card3DEffects';
import { CardPlayMode } from './cardPlayMode';
import { LustOverflowDisplay } from './lustOverflowDisplay';
import { ModifierDisplay } from './modifierDisplay';
import { PileViewer } from './pileViewer';
import { EffectProgramDisplay } from './effectProgramDisplay';
import { StatusDetailViewer } from './statusDetailViewer';
import { BattleFullscreenController } from './battleFullscreenController';

type MaybePromise = void | Promise<void>;

export type BattleShellHandlers = Readonly<{
  onPlayCard: (cardId: string) => MaybePromise;
  onEndTurn: () => MaybePromise;
  onExitBattle: () => MaybePromise;
  onShowItems: () => MaybePromise;
  onUseItem: (itemId: string) => MaybePromise;
  onResetBattle: () => MaybePromise;
}>;

/** Owns the DOM shell and message-floor presentation for the Tavern battle view. */
export class TavernBattleShellPresenter {
  private static instance: TavernBattleShellPresenter;
  private readonly gameStateManager = GameStateManager.getInstance();
  private readonly pileViewer = PileViewer.getInstance();
  private readonly effectDisplay = EffectProgramDisplay.getInstance();
  private readonly statusDetailViewer = StatusDetailViewer.getInstance();
  private readonly lustOverflowDisplay = LustOverflowDisplay.getInstance();
  private readonly modifierDisplay = new ModifierDisplay(this.gameStateManager);
  private readonly cardPlayMode = CardPlayMode.getInstance();
  private readonly fullscreenController = new BattleFullscreenController();
  private initialized = false;
  private stopLatestMessageGuard: (() => void) | null = null;
  private readonly detailListeners: Array<readonly [string, EventListener]> = [];

  public static getInstance(): TavernBattleShellPresenter {
    if (!TavernBattleShellPresenter.instance) {
      TavernBattleShellPresenter.instance = new TavernBattleShellPresenter();
    }
    return TavernBattleShellPresenter.instance;
  }

  public initialize(handlers: BattleShellHandlers): void {
    if (this.initialized) return;
    this.initialized = true;

    BattleLog.init();
    this.statusDetailViewer.initializeStatusDetailSystem();
    Card3DEffects.getInstance();
    this.cardPlayMode.init();
    this.fullscreenController.initialize();
    this.bindControls(handlers);
    this.pileViewer.setupPileClickEvents();
    this.statusDetailViewer.setupStatusClickEvents();
    this.bindDetailRequests();
    this.applyMessageScope();
    this.startLatestMessageGuard();
  }

  public async refresh(gameState: GameState): Promise<void> {
    await BattleUI.refreshBattleUI(gameState);
    this.applyMessageScope();
    this.modifierDisplay.refresh();
  }

  public initializeAfterFirstRender(): void {
    this.lustOverflowDisplay.initializeLustOverflowSystem();
  }

  public showBattleUnavailable(
    message: string,
    repairIssues: readonly BattleContentIssue[] = [],
    onRepair?: () => MaybePromise,
  ): void {
    const dialog = document.getElementById('no-enemy-dialog') as HTMLElement | null;
    const messageElement = document.getElementById('no-enemy-message') as HTMLElement | null;
    if (messageElement) messageElement.textContent = message;
    if (dialog) dialog.style.display = 'block';

    const refreshButton = document.getElementById('no-enemy-refresh') as HTMLButtonElement | null;
    if (refreshButton) refreshButton.onclick = () => location.reload();

    const repairButton = document.getElementById('battle-content-repair') as HTMLButtonElement | null;
    const canRepair = repairIssues.length > 0 && isCurrentMessageLatest() && typeof onRepair === 'function';
    if (repairButton) {
      repairButton.style.display = canRepair ? '' : 'none';
      repairButton.disabled = !canRepair;
      repairButton.onclick = canRepair ? () => void onRepair?.() : null;
    }
    if (canRepair) this.startLatestMessageGuard();
  }

  public setRepairPending(pending: boolean): void {
    const repairButton = document.getElementById('battle-content-repair') as HTMLButtonElement | null;
    if (repairButton) repairButton.disabled = pending || !isCurrentMessageLatest();
  }

  public showRepairFailure(error: unknown): void {
    const message = error instanceof Error ? error.message : '请求 AI 修复战斗场景失败';
    const messageElement = document.getElementById('no-enemy-message') as HTMLElement | null;
    if (messageElement) messageElement.textContent = `请求 AI 修复失败：${message}`;
  }

  public showItems(items: readonly Item[]): void {
    const availableItems = items.filter(item => item.count > 0);
    if (availableItems.length === 0) {
      if (typeof toastr !== 'undefined') toastr.info('当前没有可用的道具', '提示');
      else alert('当前没有可用的道具');
      return;
    }

    const itemHtml = availableItems
      .map(item => {
        const effectTags = this.effectDisplay.createCompactEffectTagsHTML(
          this.effectDisplay.programToTags(item.effectProgram),
        );
        return `
          <div class="item-entry">
            <div class="item-info">
              <div class="item-header">
                <span class="item-emoji">${escapeHtml(item.emoji || '🧪')}</span>
                <span class="item-name">${escapeHtml(item.name)}</span>
                <span class="item-count">x${escapeHtml(item.count)}</span>
              </div>
              ${effectTags}
              ${item.description ? `<div class="item-description">${escapeHtml(item.description)}</div>` : ''}
            </div>
            <button class="item-use-btn" data-item-id="${escapeHtmlAttribute(item.id)}">使用</button>
          </div>
        `;
      })
      .join('');

    $('#item-use-modal .item-list').html(itemHtml);
    $('#item-use-modal').show();
  }

  public hideItems(): void {
    $('#item-use-modal').hide();
  }

  public logPlayerAction(actionType: string, description: string): void {
    BattleLog.logPlayerAction(actionType, description);
  }

  public canMutateCurrentMessage(): boolean {
    if (isCurrentMessageLatest()) return true;
    this.applyMessageScope();
    return false;
  }

  public applyMessageScope(): boolean {
    const historical = !isCurrentMessageLatest();
    document.documentElement.classList.toggle('is-history', historical);
    if (!historical) return false;

    if (!document.querySelector('.history-battle-label')) {
      const label = document.createElement('div');
      label.className = 'history-battle-label';
      label.textContent = '历史战斗记录';
      document.querySelector('.top-info-bar')?.prepend(label);
    }
    document
      .querySelectorAll<HTMLButtonElement>(
        '.end-turn-button, #use-item-btn, .item-use-btn, .restart-btn, .return-setup-btn, .no-enemy-refresh-btn, .repair-battle-btn, .skip-reward-btn, .confirm-selection',
      )
      .forEach(button => {
        button.disabled = true;
        button.setAttribute('aria-disabled', 'true');
      });
    document.querySelectorAll<HTMLElement>('.card.clickable, .enhanced-card.clickable').forEach(card => {
      card.classList.remove('clickable');
      card.classList.add('disabled');
      card.setAttribute('aria-disabled', 'true');
    });
    document
      .querySelectorAll<HTMLElement>('.card-selection-modal, .discard-selection-modal')
      .forEach(modal => modal.remove());
    this.hideItems();
    return true;
  }

  private bindControls(handlers: BattleShellHandlers): void {
    const root = $(document);
    root.off('.mwgBattleShell');
    root.on(
      'mwg:play-card.mwgBattleShell',
      '.card:not(.disabled), .enhanced-card:not(.disabled)',
      event => {
        event.preventDefault();
        event.stopPropagation();
        const card = $(event.currentTarget);
        const cardId = String(card.data('card-id') || '');
        if (cardId) void handlers.onPlayCard(cardId);
      },
    );
    root.on('click.mwgBattleShell', '.end-turn-button', () => void handlers.onEndTurn());
    root.on('click.mwgBattleShell', '#exit-battle-btn', () => void handlers.onExitBattle());
    root.on('click.mwgBattleShell', '#battle-log-btn', () => $('#battle-log').fadeToggle(200));
    root.on('click.mwgBattleShell', '#use-item-btn', () => void handlers.onShowItems());
    root.on('click.mwgBattleShell', '.item-use-btn', event => {
      const itemId = String($(event.currentTarget).data('item-id') || '');
      if (itemId) void handlers.onUseItem(itemId);
    });
    root.on('click.mwgBattleShell', '#close-item-modal', () => this.hideItems());
    root.on('click.mwgBattleShell', '.restart-btn, .return-setup-btn', () => void handlers.onResetBattle());
  }

  private bindDetailRequests(): void {
    const pileListener: EventListener = event => {
      const pileType = (event as CustomEvent<{ pileType?: string }>).detail?.pileType;
      if (pileType === 'deck' || pileType === 'draw' || pileType === 'discard' || pileType === 'exhaust') {
        this.pileViewer.showPileByType(pileType, this.gameStateManager);
      }
    };
    const statusListener: EventListener = event => {
      const statType = (event as CustomEvent<{ statType?: string }>).detail?.statType;
      if (typeof statType === 'string') this.statusDetailViewer.showStatusByType(statType, this.gameStateManager);
    };
    document.addEventListener('requestPileData', pileListener);
    document.addEventListener('requestStatusDetail', statusListener);
    this.detailListeners.push(['requestPileData', pileListener], ['requestStatusDetail', statusListener]);
  }

  public destroy(): void {
    this.stopLatestMessageGuard?.();
    this.stopLatestMessageGuard = null;
    this.fullscreenController.destroy();
    for (const [type, listener] of this.detailListeners.splice(0)) document.removeEventListener(type, listener);
    $(document).off('.mwgBattleShell');
  }

  private startLatestMessageGuard(): void {
    if (this.stopLatestMessageGuard !== null || !isCurrentMessageLatest()) return;
    this.stopLatestMessageGuard = watchCurrentMessageUntilHistorical(() => {
      this.applyMessageScope();
      void rerenderHistoricalMessageForDepth().catch(error => {
        console.warn('[MagicGirlWorld] 历史战斗页按楼层卸载失败，保留只读兜底', error);
      });
      this.stopLatestMessageGuard = null;
    });
  }
}
