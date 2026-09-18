import { bindStatusReferenceDetails } from './statusReference';
const binding = Symbol.for('mwg.card-preview.bound');
export function bindCardPreview(doc: Document): void {
  if ((doc as any)[binding]) return;
  (doc as any)[binding] = true; bindStatusReferenceDetails(doc);
  let panel: HTMLElement | null = null;
  let source: HTMLElement | null = null;
  let pinned = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const close = () => { panel?.remove(); panel = null; source = null; pinned = false; };
  const show = (card: HTMLElement, pin = false) => {
    clearTimeout(timer);
    if (card === source && panel) { pinned ||= pin; return; }
    if (pinned && !pin) return;
    close(); source = card; pinned = pin;
    panel = doc.createElement('aside'); panel.className = 'mwg-card-preview'; panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', '卡牌详情');
    const button = doc.createElement('button'); button.type = 'button'; button.textContent = '关闭'; button.onclick = close;
    const clone = card.cloneNode(true) as HTMLElement;
    clone.classList.remove('clickable', 'blocked', 'card-hover', 'dragging'); clone.removeAttribute('style');
    clone.querySelector('.card-preview-trigger')?.remove();
    panel.append(button, clone); doc.body.append(panel);
    const rect = card.getBoundingClientRect(), box = panel.getBoundingClientRect();
    panel.style.left = Math.max(8, Math.min(rect.right + 8, doc.documentElement.clientWidth - box.width - 8)) + 'px';
    panel.style.top = Math.max(8, Math.min(rect.top, doc.documentElement.clientHeight - box.height - 8)) + 'px';
  };
  doc.addEventListener('pointerout', event => {
    if (pinned) return;
    const next = event.relatedTarget as Element | null;
    if (next?.closest?.('.mwg-card,.mwg-card-preview,.mwg-status-popover')) return;
    clearTimeout(timer); timer = setTimeout(close, 350);
  });
  doc.addEventListener('pointerdown', event => {
    if ((event.target as Element)?.closest('.card-preview-trigger,.mwg-card-preview,.mwg-status-reference')) event.stopPropagation();
    const card = (event.target as Element)?.closest<HTMLElement>('.mwg-card');
    // Choices own the initial gesture. Do not start a long-press preview for
    // their reused card face: it can cover the selector before its click runs.
    if (card?.closest('.option,.battle-reward-option,.mwg-card-choice')) return;
    if (card && !card.closest('#hand-cards,.mwg-card-preview,.shop-product,.shop-detail')) {
      clearTimeout(timer); timer = setTimeout(() => show(card, true), 350);
    }
  }, true);
  doc.addEventListener('pointerup', () => clearTimeout(timer), true);
  doc.addEventListener('pointercancel', () => clearTimeout(timer), true);
  doc.addEventListener('click', event => {
    const el = event.target as Element;
    if (el.closest('.mwg-status-reference')) return;
    const card = el.closest<HTMLElement>('.mwg-card');
    // Reward faces select their owning option on a normal click. Long-press
    // remains available for reading full details without an extra checkbox.
    if (card?.closest('.option,.battle-reward-option,.mwg-card-choice')) return;
    if (card && !card.closest('#hand-cards,.mwg-card-preview,.shop-product,.shop-detail')) {
      event.preventDefault(); event.stopPropagation(); show(card, true);
    }
  }, true);
  doc.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
}
