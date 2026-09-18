import { escapeHtml } from '../fish/shared/html';

/** Text is escaped here; rulesHtml must come from the shared effect renderer. */
export function renderSupportDetails(value: Record<string, any>, options: {
  kind: string; rulesHtml: string; extraHtml?: string;
}): string {
  return `<div class="support-details-heading">
    <span>${escapeHtml(value.emoji || '✦')}</span>
    <strong>${escapeHtml(value.name || value.id || options.kind)}</strong>
    <small>${escapeHtml(options.kind)}</small>
    ${value.rarity ? `<small class="support-rarity rarity-${escapeHtml(value.rarity)}">${escapeHtml(({Common:"普通",Uncommon:"罕见",Rare:"稀有",Epic:"史诗",Legendary:"传说",Boss:"首领",ENS:"特殊"} as Record<string,string>)[value.rarity] || value.rarity)}</small>` : ''}
    ${value.count != null ? `<small>×${escapeHtml(value.count)}</small>` : ''}
  </div>
  <div class="support-details-effects content-rules">${options.rulesHtml}</div>
  ${options.extraHtml || ''}
  ${value.description ? `<div class="support-details-description content-flavor">${escapeHtml(value.description)}</div>` : ''}
  ${value.source ? `<div class="support-details-source">来源：${escapeHtml(value.source)}</div>` : ''}`;
}
