import { showBattleDialogue } from './battleDialogue';
import { isolatedPresenter } from '../core/isolatedBattlePresentation';
import type { Card, CombatResourceState } from '../../game-core';
import { BattleLog } from '../modules/battleLog';
import { escapeHtml, escapeHtmlAttribute } from '../shared/html';
import { describeCardCost } from '../../game-core';
import { AnimationManager, resolveCombatAnimationTarget } from './animationManager';
import { EffectProgramDisplay } from './effectProgramDisplay';
import { animateCardDeparture } from './cardLifecycleAnimation';
import { renderCardFace } from '../../shared/cardFace';
import { isCardFaceDetailInteraction } from '../../shared/cardChoice';

const CARD_RARITY_LABELS: Readonly<Record<string, string>> = {
  Common: '普通', Uncommon: '罕见', Rare: '稀有', Epic: '史诗', Legendary: '传说', Corrupt: '腐化',
};
const CARD_TYPE_LABELS: Readonly<Record<string, string>> = {
  Attack: '攻击', Skill: '技能', Power: '能力', Event: '事件', Curse: '诅咒',
};

export interface CardSelectionModalRequest {
  title: string;
  minimum: number;
  maximum: number;
  allowCancel: boolean;
  resources?: Readonly<Record<string, Pick<CombatResourceState, 'name' | 'emoji'>>>;
}

/** Owns card interaction DOM and animation inside the Tavern battle iframe. */
export class TavernCardInteractionPresenter {
  public animateCardDeparture(card: Card, kind: 'exhaust' | 'remove' | 'purge'): void { animateCardDeparture(card, kind); }
  private static instance: TavernCardInteractionPresenter;
  private readonly animationManager = AnimationManager.getInstance();
  private readonly effectDisplay = EffectProgramDisplay.getInstance();

  public static getInstance(): TavernCardInteractionPresenter {
    const isolated = isolatedPresenter<TavernCardInteractionPresenter>('cards');
    if (isolated) return isolated;
    if (!TavernCardInteractionPresenter.instance) {
      TavernCardInteractionPresenter.instance = new TavernCardInteractionPresenter();
    }
    return TavernCardInteractionPresenter.instance;
  }

  public async animateCardPlay(cardId: string, card?: Card): Promise<void> {
    const cardElement = $(`.card[data-card-id="${cardId}"], .enhanced-card[data-card-id="${cardId}"]`);
    if (cardElement.data('visualPlayStarted')) {
      await cardElement.data('visualPlayReady');
      // The card's flight and the attack token are different visual phases.
      // Skip only a duplicate card flight, not the token's contact gate.
    }
    if (cardElement.length > 0) await this.animationManager.animateCardPlay(cardElement, card);
  }

  public showCardBlockedNotification(cardName: string, reason: string): void {
    this.animationManager.showCardBlockedNotification(cardName, reason);
  }

  public showDialogue(text: string, speaker?: string): void { showBattleDialogue(text, speaker); }

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
      let finished = false;
      const selectedIds: string[] = [];
      const { title, minimum, maximum, allowCancel, resources } = request;
      const modal = $(`
        <div class="card-selection-modal" role="dialog" aria-modal="true" aria-label="${escapeHtmlAttribute(title)}">
          <div class="modal-backdrop"></div>
          <div class="modal-content">
            <div class="modal-header">
              <h3>${escapeHtml(title)}</h3>
              <p>${minimum === maximum ? `请选择 ${maximum} 张卡牌` : `可选择 ${minimum}-${maximum} 张卡牌`}</p>
              <div class="selection-counter">已选择: <span class="selected-count">0</span> / ${maximum}</div>
            </div>
            <div class="modal-body">
              <div class="selection-cards-container mwg-card-choice-list">
                ${availableCards
                  .map(card => {
                    const effectTags = this.effectDisplay.createWrappedEffectTagsHTML(
                      this.effectDisplay.cardToTags(card),
                    );
                    const attachmentTags = this.effectDisplay.createWrappedEffectTagsHTML(
                      this.effectDisplay.attachmentToTags(card.attachments),
                    );
                    const discardTags = this.effectDisplay.createWrappedEffectTagsHTML(
                      this.effectDisplay.programToTags(card.discardEffectProgram),
                    );
                    const rulesHtml = effectTags
                      + (discardTags ? `<div class="card-discard-rules"><strong>此牌被战斗效果弃掉后：</strong>${discardTags}</div>` : '')
                      + attachmentTags;
                    return `<div class="selection-card mwg-card-choice" role="button" tabindex="0" aria-pressed="false" data-card-id="${escapeHtmlAttribute(card.id)}">
                      ${renderCardFace(card, {
                        costLabel: card.type === 'Curse' ? '—' : describeCardCost(card.cost, resources),
                        rarityLabel: CARD_RARITY_LABELS[card.rarity] || card.rarity,
                        typeLabel: CARD_TYPE_LABELS[card.type] || card.type,
                        rulesHtml,
                      })}
                    </div>`;
                  })
                  .join('')}
              </div>
            </div>
            <div class="modal-footer">
              ${allowCancel ? '<button class="btn btn-secondary cancel-selection">返回上一级</button>' : ''}
              <button class="btn btn-primary confirm-selection" ${minimum > 0 ? 'disabled' : ''}>确认选择</button>
            </div>
          </div>
        </div>
      `);

      // Mount the selector in the bounded battle scene so its center follows
      // the visible combat area inside a long story iframe.
      const host = $('#battle-scene');
      (host.length ? host : $('body')).append(modal);
      modal.fadeIn(200);
      const toggleCard = (element: JQuery<HTMLElement>): void => {
        const cardId = String(element.data('card-id'));
        const card = availableCards.find(candidate => candidate.id === cardId);
        if (!card) return;

        if (element.hasClass('selected')) {
          element.removeClass('selected').attr('aria-pressed', 'false');
          const index = selectedIds.indexOf(cardId);
          if (index >= 0) selectedIds.splice(index, 1);
        } else if (selectedIds.length < maximum) {
          element.addClass('selected').attr('aria-pressed', 'true');
          selectedIds.push(cardId);
        }

        modal.find('.selected-count').text(selectedIds.length);
        modal
          .find('.confirm-selection')
          .prop('disabled', selectedIds.length < minimum || selectedIds.length > maximum);
      };
      modal.on('click', '.selection-card', function (event) {
        if (isCardFaceDetailInteraction(event.target)) return;
        toggleCard($(this));
      });
      modal.on('keydown', '.selection-card', function (event) {
        if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return;
        event.preventDefault();
        toggleCard($(this));
      });
      modal.on('click', '.confirm-selection', () => {
        if (finished || selectedIds.length < minimum || selectedIds.length > maximum) return;
        finished = true;
        modal.fadeOut(200, () => modal.remove());
        resolve([...selectedIds]);
      });
      modal.on('click', '.cancel-selection, .modal-backdrop', () => {
        if (!allowCancel || finished) return;
        finished = true;
        modal.fadeOut(200, () => modal.remove());
        resolve(null);
      });
    });
  }
}
