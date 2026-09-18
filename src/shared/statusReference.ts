import { escapeHtml } from '../fish/shared/html';
import { renderSummonPanel } from './summonPresentation';
import { renderStancePanel } from './stancePresentation';

export interface StatusReference {
  kind?: 'resource' | 'stance';
  id: string;
  name: string;
  rules: string;
  flavor?: string;
  summon?: unknown;
  card?: unknown;
  stance?: unknown;
  stanceContext?: unknown;
  references?: StatusReference[];
}

/** Escape text once, then insert links only for known definitions. Never parse author HTML. */
export function renderStatusReferences(text: string, statuses: readonly StatusReference[]): string {
  const aliases = new Map<string, StatusReference>();
  for (const status of statuses) {
    if (status.id) aliases.set(status.id, status);
    if (status.name) aliases.set(status.name, status);
  }
  const keys = [...aliases.keys()].sort((a,b) => b.length-a.length);
  let result = '', offset = 0;
  while (offset < text.length) {
    let next = text.length, matched = '';
    for (const key of keys) {
      const at = text.indexOf(key, offset);
      if (at >= 0 && at < next) { next = at; matched = key; }
    }
    result += escapeHtml(text.slice(offset, next));
    if (!matched) break;
    const status = aliases.get(matched)!;
    const summonData = status.summon ? ` data-summon-definition="${escapeHtml(JSON.stringify(status.summon))}"` : '';
    const cardData = status.card ? ` data-card-definition="${escapeHtml(JSON.stringify(status.card))}"` : '';
    const stanceData = status.stance ? ` data-stance-definition="${escapeHtml(JSON.stringify(status.stance))}" data-stance-context="${escapeHtml(JSON.stringify(status.stanceContext || {}))}"` : '';
    const referencesData = status.references?.length ? ` data-rule-references="${escapeHtml(JSON.stringify(status.references))}"` : '';
    const kind = status.card ? '卡牌' : status.summon ? '召唤物' : status.stance ? '姿态' : status.kind === 'resource' ? '资源' : '状态';
    result += `<span class="mwg-status-reference mwg-${status.card ? 'card' : 'status'}-reference" role="button" tabindex="0" aria-label="查看${kind}：${escapeHtml(status.name || status.id)}" data-status-name="${escapeHtml(status.name || status.id)}" data-status-rules="${escapeHtml(status.rules || '未提供可执行规则')}" data-status-flavor="${escapeHtml(status.flavor || '')}"${summonData}${cardData}${stanceData}${referencesData}>${escapeHtml(status.name || status.id)}</span>`;
    offset = next + matched.length;
  }
  return result;
}

const binding = Symbol.for('mwg.status-reference.bound');
/** Capture before reward-choice handlers: reading a status must never claim the reward. */
export function bindStatusReferenceDetails(doc: Document): void {
  if ((doc as any)[binding]) return;
  (doc as any)[binding] = true;
  let popup: HTMLElement | null = null;
  let anchor: HTMLElement | null = null;
  const close = () => { popup?.remove(); popup = null; };
  const open = (target: HTMLElement) => {
    close(); anchor = target;
    popup = doc.createElement('aside');
    popup.className = 'mwg-status-popover';
    popup.setAttribute('role', 'dialog');
    popup.setAttribute('aria-label', target.dataset.statusName || '状态详情');
    const button = doc.createElement('button');
    button.type = 'button'; button.textContent = '关闭'; button.onclick = close;
    const title = doc.createElement('strong'); title.textContent = target.dataset.statusName || '';
    const rules = doc.createElement('p'); rules.textContent = target.dataset.statusRules || '';
    const flavor = doc.createElement('p'); flavor.className = 'content-flavor'; flavor.textContent = target.dataset.statusFlavor || '';
    popup.append(button);
    let summon: Record<string, any> | undefined, card: Record<string, any> | undefined;
    let stance: Record<string, any> | undefined, stanceContext: Record<string, any> = {};
    try { const value = JSON.parse(target.dataset.summonDefinition || 'null'); if (value && typeof value === 'object' && !Array.isArray(value)) summon = value; } catch { /* Old cards retain their text fallback. */ }
    try { const value = JSON.parse(target.dataset.cardDefinition || 'null'); if (value && typeof value === 'object' && !Array.isArray(value)) card = value; } catch { /* Old cards retain their text fallback. */ }
    try { const value = JSON.parse(target.dataset.stanceDefinition || 'null'); if (value && typeof value === 'object' && !Array.isArray(value)) stance = value; } catch { /* Text fallback remains available. */ }
    try { const value = JSON.parse(target.dataset.stanceContext || '{}'); if (value && typeof value === 'object' && !Array.isArray(value)) stanceContext = value; } catch { /* Default labels remain available. */ }
    if (summon) { const panel = doc.createElement('div'); panel.innerHTML = renderSummonPanel(summon); popup.append(panel); }
    else if (stance) { const panel = doc.createElement('div'); panel.innerHTML = renderStancePanel(stance, stanceContext); popup.append(panel); }
    else if (card) {
      title.textContent = `${String(card.emoji || '🃏')} ${String(card.name || target.dataset.statusName || '')}`;
      let references: StatusReference[] = [];
      try { const value = JSON.parse(target.dataset.ruleReferences || '[]'); if (Array.isArray(value)) references = value; } catch { /* Text remains available. */ }
      rules.innerHTML = renderStatusReferences(target.dataset.statusRules || '未提供可执行规则', references);
      popup.append(title, rules, flavor);
    } else popup.append(title, rules, flavor);
    doc.body.append(popup);
    const rect = target.getBoundingClientRect();
    const width = doc.documentElement.clientWidth, height = doc.documentElement.clientHeight;
    const box = popup.getBoundingClientRect();
    popup.style.left = Math.max(8, Math.min(rect.right + 8, width - box.width - 8)) + 'px';
    popup.style.top = Math.max(8, Math.min(rect.top, height - box.height - 8)) + 'px';
  };
  doc.addEventListener('click', event => {
    const el = event.target as Element | null;
    const target = el?.closest<HTMLElement>('.mwg-status-reference');
    if (target) { event.preventDefault(); event.stopPropagation(); open(target); }
    else if (popup && !popup.contains(el)) close();
  }, true);
  doc.addEventListener('keydown', event => {
    if (event.key === 'Escape' && popup) { close(); anchor?.focus({ preventScroll: true }); return; }
    const target = (event.target as Element | null)?.closest<HTMLElement>('.mwg-status-reference');
    if (target && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault(); event.stopPropagation(); open(target);
    }
  }, true);
}
