import type { SummonUnit } from '../../game-core';
import { roundBattleDisplayValue } from '../../game-core';
import { escapeHtml, escapeHtmlAttribute } from '../shared/html';

/** Interactive summon selector shared by every summon-targeting operation. */
export class TavernSummonChoicePresenter {
  private static instance: TavernSummonChoicePresenter;

  public static getInstance(): TavernSummonChoicePresenter {
    if (!TavernSummonChoicePresenter.instance) {
      TavernSummonChoicePresenter.instance = new TavernSummonChoicePresenter();
    }
    return TavernSummonChoicePresenter.instance;
  }

  public choose(candidates: readonly SummonUnit[], required: number): Promise<string[] | null> {
    return new Promise(resolve => {
      $('.summon-choice-dialog').remove();
      const amount = Math.min(candidates.length, Math.max(1, Math.floor(required)));
      const options = candidates.map(unit => {
        const hp = unit.hasHp === false
          ? '无生命'
          : `生命 ${roundBattleDisplayValue(unit.currentHp)}/${roundBattleDisplayValue(unit.maxHp)}`;
        const statuses = (unit.statusEffects || [])
          .map(status => `${status.emoji || ''}${status.name} ${roundBattleDisplayValue(status.stacks)}`)
          .join(' · ');
        return `<button class="summon-choice-option" type="button"
          data-summon-id="${escapeHtmlAttribute(unit.instanceId)}" aria-pressed="false">
          <span class="summon-choice-emoji">${escapeHtml(unit.emoji)}</span>
          <span class="summon-choice-copy">
            <strong>${escapeHtml(unit.name)}</strong>
            <small>${escapeHtml(hp)}${Number(unit.block) > 0 ? ` · 格挡 ${escapeHtml(String(roundBattleDisplayValue(unit.block || 0)))}` : ''}</small>
            ${statuses ? `<small>${escapeHtml(statuses)}</small>` : ''}
          </span>
        </button>`;
      }).join('');
      const dialog = $(`<div class="summon-choice-dialog effect-choice-dialog" role="dialog" aria-modal="true" aria-label="选择召唤物">
        <div class="modal-backdrop"></div>
        <section class="modal-content effect-choice-content summon-choice-content">
          <header class="modal-header">
            <h3>选择召唤物</h3>
            <p>请选择 ${amount} 个目标</p>
          </header>
          <div class="modal-body summon-choice-options">${options}</div>
          <footer class="modal-footer">
            <span class="summon-choice-count">已选择 0/${amount}</span>
            <button class="summon-choice-confirm" type="button" disabled>确认</button>
            <button class="summon-choice-cancel" type="button">取消</button>
          </footer>
        </section>
      </div>`);
      const selected = new Set<string>();
      const refresh = (): void => {
        dialog.find('.summon-choice-count').text(`已选择 ${selected.size}/${amount}`);
        dialog.find<HTMLButtonElement>('.summon-choice-confirm').prop('disabled', selected.size !== amount);
      };
      const finish = (value: string[] | null): void => {
        dialog.remove();
        resolve(value);
      };
      dialog.on('click', '.summon-choice-option', event => {
        const button = $(event.currentTarget);
        const id = String(button.attr('data-summon-id') || '');
        if (!id) return;
        if (selected.has(id)) selected.delete(id);
        else {
          if (selected.size >= amount) return;
          selected.add(id);
        }
        const active = selected.has(id);
        button.toggleClass('is-selected', active).attr('aria-pressed', active ? 'true' : 'false');
        refresh();
      });
      dialog.on('click', '.summon-choice-confirm', () => {
        if (selected.size === amount) finish([...selected]);
      });
      dialog.on('click', '.summon-choice-cancel, .modal-backdrop', () => finish(null));
      $('body').append(dialog);
      dialog.find<HTMLElement>('.summon-choice-option').first().trigger('focus');
      refresh();
    });
  }
}
