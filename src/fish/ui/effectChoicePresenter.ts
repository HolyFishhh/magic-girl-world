import { isolatedPresenter } from '../core/isolatedBattlePresentation';
import { EFFECT_PROGRAM_SPEC, describeCardCost, type GeneratedCardDefinition, type EffectNode } from '../../game-core';
import { escapeHtml, escapeHtmlAttribute } from '../shared/html';
import { EffectProgramDisplay } from './effectProgramDisplay';
import { renderCardFace } from '../../shared/cardFace';
import { isCardFaceDetailInteraction } from '../../shared/cardChoice';

type ChoiceNode = Extract<EffectNode, { op: 'choose_one' }>;

/** Transaction-safe modal used by cards, relics, statuses and enemy effects alike. */
export class TavernEffectChoicePresenter {
  private static instance: TavernEffectChoicePresenter;
  private readonly display = EffectProgramDisplay.getInstance();

  public static getInstance(): TavernEffectChoicePresenter {
    const isolated = isolatedPresenter<TavernEffectChoicePresenter>('effect_choice');
    if (isolated) return isolated;
    if (!TavernEffectChoicePresenter.instance) TavernEffectChoicePresenter.instance = new TavernEffectChoicePresenter();
    return TavernEffectChoicePresenter.instance;
  }

  public choose(choice: ChoiceNode): Promise<string | string[] | null> {
    return new Promise(resolve => {
      $('.effect-choice-dialog').remove();
      const required = choice.count ?? 1;
      const selectedIds = new Set<string>();
      const options = choice.options.map(option => {
        const tags = this.display.programToTags({ spec: EFFECT_PROGRAM_SPEC, steps: option.effects });
        const generated: GeneratedCardDefinition[] = option.effects.flatMap(node =>
          node.op === 'transform_cards' ? [node.replacement] : node.op === 'add_card' || node.op === 'ensure_card' ? [node.card] : []);
        const faces = generated.map(card => {
          const rules = this.display.createWrappedEffectTagsHTML(this.display.cardToTags(card));
          const discard = this.display.createWrappedEffectTagsHTML(this.display.programToTags(card.discardProgram));
          return renderCardFace(card, {
            costLabel: card.type === 'Curse' ? '—' : describeCardCost(card.cost ?? 0),
            rarityLabel: ({ Common: '普通', Uncommon: '罕见', Rare: '稀有', Epic: '史诗', Legendary: '传说', Corrupt: '腐化' })[card.rarity],
            typeLabel: ({ Attack: '攻击', Skill: '技能', Power: '能力', Event: '事件', Curse: '诅咒' })[card.type],
            rulesHtml: rules + (discard ? `<strong>被效果弃掉后：</strong>${discard}` : ''),
          });
        }).join('');
        return `<div class="effect-choice-option mwg-card-choice" role="button" tabindex="0" aria-pressed="false" data-option-id="${escapeHtmlAttribute(option.id)}">
          ${faces ? `<div class="effect-choice-operation"><strong>${escapeHtml(option.label)}</strong>${this.display.createWrappedEffectTagsHTML(tags)}</div>${faces}` : renderCardFace({ id: `effect-choice-${option.id}`, name: option.label, type: 'Option', rarity: 'Common', emoji: '✦' }, {
            costLabel: '—', rarityLabel: '选项', typeLabel: '选项',
            rulesHtml: this.display.createWrappedEffectTagsHTML(tags),
          })}
        </div>`;
      }).join('');
      const dialog = $(`<div class="effect-choice-dialog" role="dialog" aria-modal="true" aria-label="选择效果">
        <div class="modal-backdrop"></div>
        <section class="modal-content effect-choice-content">
          <header class="modal-header"><h3>选择效果 · ${choice.options.length}选${required}</h3></header>
          <div class="modal-body effect-choice-options mwg-card-choice-list" style="--choice-count:${choice.options.length}">${options}</div>
        <footer class="modal-footer"><span class="effect-choice-count" role="status">已选 0/${required}</span><button type="button" class="btn btn-primary confirm-effect-choice" disabled>确认选择</button></footer></section>
      </div>`);
      const finish = (value: string | string[] | null): void => {
        dialog.remove();
        resolve(value);
      };
      const select = (element: HTMLElement) => {
        const id = element.dataset.optionId;
        if (!id || !choice.options.some(option => option.id === id)) return;
        if (selectedIds.has(id)) selectedIds.delete(id);
        else {
          if (required === 1) selectedIds.clear();
          if (selectedIds.size >= required) return;
          selectedIds.add(id);
        }
        dialog.find('.effect-choice-option').each((_, item) => {
          $(item).toggleClass('is-selected', selectedIds.has(item.dataset.optionId || ''))
            .attr('aria-pressed', String(selectedIds.has(item.dataset.optionId || '')));
        });
        dialog.find('.effect-choice-count').text(`已选 ${selectedIds.size}/${required}`);
        dialog.find('.confirm-effect-choice').prop('disabled', selectedIds.size !== required);
      };
      dialog.on('click', '.effect-choice-option', event => {
        if (isCardFaceDetailInteraction(event.target)) return;
        select(event.currentTarget);
      });
      dialog.on('keydown', '.effect-choice-option', event => {
        if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return;
        event.preventDefault();
        select(event.currentTarget);
      });
      dialog.on('click', '.confirm-effect-choice', () => {
        if (selectedIds.size !== required) return;
        const ids = choice.options.filter(option => selectedIds.has(option.id)).map(option => option.id);
        finish(required === 1 ? ids[0] : ids);
      });
      const host = $('#battle-scene');
      (host.length ? host : $('body')).append(dialog);
      dialog.find<HTMLElement>('.effect-choice-option').first().get(0)?.focus({ preventScroll: true });
    });
  }
}

