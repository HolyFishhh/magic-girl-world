import { EFFECT_PROGRAM_SPEC, type EffectNode } from '../../game-core';
import { escapeHtml, escapeHtmlAttribute } from '../shared/html';
import { EffectProgramDisplay } from './effectProgramDisplay';

type ChoiceNode = Extract<EffectNode, { op: 'choose_one' }>;

/** Transaction-safe modal used by cards, relics, statuses and enemy effects alike. */
export class TavernEffectChoicePresenter {
  private static instance: TavernEffectChoicePresenter;
  private readonly display = EffectProgramDisplay.getInstance();

  public static getInstance(): TavernEffectChoicePresenter {
    if (!TavernEffectChoicePresenter.instance) TavernEffectChoicePresenter.instance = new TavernEffectChoicePresenter();
    return TavernEffectChoicePresenter.instance;
  }

  public choose(choice: ChoiceNode): Promise<string | null> {
    return new Promise(resolve => {
      $('.effect-choice-dialog').remove();
      const options = choice.options.map(option => {
        const tags = this.display.programToTags({ spec: EFFECT_PROGRAM_SPEC, steps: option.effects });
        return `<button class="effect-choice-option" type="button" data-option-id="${escapeHtmlAttribute(option.id)}">
          <span class="effect-choice-label">${escapeHtml(option.label)}</span>
          ${this.display.createWrappedEffectTagsHTML(tags)}
        </button>`;
      }).join('');
      const dialog = $(`<div class="effect-choice-dialog" role="dialog" aria-modal="true" aria-label="选择效果">
        <div class="modal-backdrop"></div>
        <section class="modal-content effect-choice-content">
          <header class="modal-header"><h3>选择一项效果</h3></header>
          <div class="modal-body effect-choice-options">${options}</div>
          <footer class="modal-footer"><button class="effect-choice-cancel" type="button">取消</button></footer>
        </section>
      </div>`);
      const finish = (value: string | null): void => {
        dialog.remove();
        resolve(value);
      };
      dialog.on('click', '.effect-choice-option', event =>
        finish(String($(event.currentTarget).attr('data-option-id') || '') || null));
      dialog.on('click', '.effect-choice-cancel, .modal-backdrop', () => finish(null));
      $('body').append(dialog);
      dialog.find<HTMLElement>('.effect-choice-option').first().trigger('focus');
    });
  }
}
