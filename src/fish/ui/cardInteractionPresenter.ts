import type { Card, CombatResourceState } from '../../game-core';
import { BattleLog } from '../modules/battleLog';
import { escapeHtml, escapeHtmlAttribute } from '../shared/html';
import { describeCardCost } from '../../game-core';
import { AnimationManager, resolveCombatAnimationTarget } from './animationManager';
import { EffectProgramDisplay } from './effectProgramDisplay';

export interface CardSelectionModalRequest {
  title: string;
  minimum: number;
  maximum: number;
  allowCancel: boolean;
  resources?: Readonly<Record<string, Pick<CombatResourceState, 'name' | 'emoji'>>>;
}

/** Owns card interaction DOM and animation inside the Tavern battle iframe. */
export class TavernCardInteractionPresenter {
  private static instance: TavernCardInteractionPresenter;
  private readonly animationManager = AnimationManager.getInstance();
  private readonly effectDisplay = EffectProgramDisplay.getInstance();

  public static getInstance(): TavernCardInteractionPresenter {
    if (!TavernCardInteractionPresenter.instance) {
      TavernCardInteractionPresenter.instance = new TavernCardInteractionPresenter();
    }
    return TavernCardInteractionPresenter.instance;
  }

  public async animateCardPlay(cardId: string, card?: Card): Promise<void> {
    const cardElement = $(`.card[data-card-id="${cardId}"], .enhanced-card[data-card-id="${cardId}"]`);
    if (cardElement.length > 0) await this.animationManager.animateCardPlay(cardElement, card);
  }

  public showCardBlockedNotification(cardName: string, reason: string): void {
    this.animationManager.showCardBlockedNotification(cardName, reason);
  }

  public addLog(
    message: string,
    type: 'info' | 'damage' | 'heal' | 'action' | 'system' = 'info',
    source?: { type: 'card' | 'relic' | 'ability' | 'status'; name: string; details?: string },
  ): void {
    BattleLog.addLog(message, type, source);
  }

  public logDiscardCardDetail(cardName: string, costText: string, description: string): void {
    BattleLog.logDiscardCardDetail(cardName, costText, description);
  }

  public clearCardInteractionStates(): void {
    $('.card').removeClass('card-hover selected');
    $('.card-tooltip').stop(true, true).remove();
  }

  public async animateTriggeredCard(card: Card): Promise<void> {
    await this.animationManager.playCombatAction(
      'player',
      'curse',
      card.emoji || '🕸️',
      card.name,
      resolveCombatAnimationTarget(card.effectProgram, 'curse'),
    );
  }

  public async selectCards(
    availableCards: readonly Card[],
    request: CardSelectionModalRequest,
  ): Promise<string[] | null> {
    return new Promise(resolve => {
      const selectedIds: string[] = [];
      const { title, minimum, maximum, allowCancel, resources } = request;
      const modal = $(`
        <div class="card-selection-modal">
          <div class="modal-backdrop"></div>
          <div class="modal-content">
            <div class="modal-header">
              <h3>${escapeHtml(title)}</h3>
              <p>${minimum === maximum ? `请选择 ${maximum} 张卡牌` : `可选择 ${minimum}-${maximum} 张卡牌`}</p>
              <div class="selection-counter">已选择: <span class="selected-count">0</span> / ${maximum}</div>
            </div>
            <div class="modal-body">
              <div class="selection-cards-container">
                ${availableCards
                  .map(card => {
                    const effectTags = this.effectDisplay.createWrappedEffectTagsHTML(
                      this.effectDisplay.programToTags(card.effectProgram),
                    );
                    const attachmentTags = this.effectDisplay.createWrappedEffectTagsHTML(
                      this.effectDisplay.attachmentToTags(card.attachments),
                    );
                    return `
                  <div class="selection-card" data-card-id="${escapeHtmlAttribute(card.id)}">
                    <div class="card-emoji">${escapeHtml(card.emoji)}</div>
                    <div class="card-name">${escapeHtml(card.name)}</div>
                    <div class="card-cost">${escapeHtml(describeCardCost(card.cost, resources))}</div>
                    ${effectTags}
                    ${attachmentTags}
                    <div class="card-description">${escapeHtml(card.description || '')}</div>
                  </div>
                `;
                  })
                  .join('')}
              </div>
            </div>
            <div class="modal-footer">
              ${allowCancel ? '<button class="btn btn-secondary cancel-selection">取消</button>' : ''}
              <button class="btn btn-primary confirm-selection" ${minimum > 0 ? 'disabled' : ''}>确认选择</button>
            </div>
          </div>
        </div>
      `);

      $('body').append(modal);
      modal.fadeIn(200);
      modal.on('click', '.selection-card', function () {
        const cardId = String($(this).data('card-id'));
        const card = availableCards.find(candidate => candidate.id === cardId);
        if (!card) return;

        if ($(this).hasClass('selected')) {
          $(this).removeClass('selected');
          const index = selectedIds.indexOf(cardId);
          if (index >= 0) selectedIds.splice(index, 1);
        } else if (selectedIds.length < maximum) {
          $(this).addClass('selected');
          selectedIds.push(cardId);
        }

        modal.find('.selected-count').text(selectedIds.length);
        modal
          .find('.confirm-selection')
          .prop('disabled', selectedIds.length < minimum || selectedIds.length > maximum);
      });
      modal.on('click', '.confirm-selection', () => {
        modal.fadeOut(200, () => modal.remove());
        resolve([...selectedIds]);
      });
      modal.on('click', '.cancel-selection, .modal-backdrop', () => {
        if (!allowCancel) return;
        modal.fadeOut(200, () => modal.remove());
        resolve(null);
      });
    });
  }
}
