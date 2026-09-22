import { escapeHtml, escapeHtmlAttribute } from '../fish/shared/html';
import { bindCardPreview } from './cardPreview';
import { renderCardTraits, type CardDisplayMetadata, type CardTraitContext } from './cardTraits';
import { renderRulePills } from './rulePills';

/** Shared battle card face. Runtime cost/playability stays with the caller. */
export function renderCardFace(cardData: CardDisplayMetadata & {
  id?: string; name?: string; rarity?: string; type?: string; emoji?: string; description?: string;
  innate?: boolean; retain?: boolean; exhaust?: boolean; ethereal?: boolean; sly?: boolean;
  lifecycle?: import('../game-core/cardLifecycle').CardLifecycle;
}, options: {
  costLabel: string; costHtml?: string; rarityLabel: string; typeLabel: string;
  interactionClass?: string; compositeCost?: boolean; insufficient?: boolean;
  rules?: string; rulesHtml?: string; rulesGroups?: readonly string[]; quantity?: number;
  traitContext?: CardTraitContext;
}): string {
  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') bindCardPreview(document);
  return `
      <div class="card enhanced-card mwg-card rarity-${escapeHtmlAttribute(cardData.type === 'Curse' ? 'Curse' : cardData.rarity)} card-type-${escapeHtmlAttribute(cardData.type)} ${
        options.interactionClass || ''
      }"
           data-card-id="${escapeHtmlAttribute(cardData.id)}">
        <div class="card-header">
          <div class="card-cost ${options.compositeCost ? 'composite-card-cost' : ''} ${options.insufficient ? 'insufficient-cost' : ''}" aria-label="${escapeHtmlAttribute(options.costLabel)}">${options.costHtml ?? escapeHtml(options.costLabel)}</div>
          <div class="card-rarity-badge"><span class="card-rarity-gem"></span>${escapeHtml(cardData.type === 'Curse' ? '诅咒' : options.rarityLabel)}</div>
        </div>
        <div class="card-artwork">
          <div class="card-emoji">${escapeHtml(cardData.emoji)}</div>
          <div class="card-keywords">
          </div>
        </div>
        <div class="card-body">
          <div class="card-title-row">
            <div class="card-name">${escapeHtml(cardData.name)}</div>
          </div>
          <div class="card-type-row">
            <div class="card-type-indicator">${escapeHtml(options.typeLabel)}</div>
            <div class="card-traits">${renderCardTraits(cardData, { ...options.traitContext, compact: false })}</div>
          </div>
        </div>
        ${options.rules || options.rulesHtml || options.rulesGroups?.length ? `<div class="card-rules content-rules" tabindex="0" aria-label="卡牌规则">${options.rulesHtml ?? renderRulePills(options.rulesGroups ?? [options.rules || ''])}</div>` : ''}
        ${cardData.description ? `<div class="card-flavor-footer" aria-label="卡牌描述"><div class="card-description card-flavor-text content-flavor">${escapeHtml(cardData.description)}</div></div>` : ''}
        ${options.quantity ? `<div class="card-quantity">×${escapeHtml(String(options.quantity))}</div>` : ''}
        <button type="button" class="card-preview-trigger" aria-label="查看${escapeHtmlAttribute(cardData.name || '卡牌')}完整详情">详情</button>
        <div class="card-glow"></div>
      </div>
    `;
}
