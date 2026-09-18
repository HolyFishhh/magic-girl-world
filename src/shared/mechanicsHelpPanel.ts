import { TRIGGER_MECHANICS_HELP, DESIRE_MECHANICS_HELP } from '../game-core/mechanicsHelp';
import { escapeHtml } from '../fish/shared/html';

/** One accessible help entry in the status area, never repeated on card faces. */
export function renderMechanicsHelp(): string {
  const paragraphs = (text: string) => text.split('\n\n').map(line => `<p>${escapeHtml(line)}</p>`).join('');
  return `<details class="mwg-mechanics-help"><summary>规则帮助</summary><h3>欲望</h3>${paragraphs(DESIRE_MECHANICS_HELP)}<h3>触发与计数</h3>${paragraphs(TRIGGER_MECHANICS_HELP)}</details>`;
}

/** Open on the host viewport, not halfway down a tall message iframe. */
export function openMechanicsHelp(anchor: HTMLElement): void {
  let doc = anchor.ownerDocument;
  try { if (window.parent.document.body) doc = window.parent.document; } catch { /* isolated frame */ }
  if (doc.querySelector('#mwg-rules-dialog')) return;
  const dialog = doc.createElement('dialog');
  dialog.id = 'mwg-rules-dialog';
  dialog.setAttribute('aria-labelledby', 'mwg-rules-title');
  dialog.style.cssText = 'box-sizing:border-box;width:min(620px,calc(100% - 24px));max-height:min(80vh,640px);padding:24px;border:1px solid #72759c;border-radius:16px;background:#191d34;color:#eef0ff;font:14px/1.8 system-ui;overflow:auto;box-shadow:0 20px 60px #0008;color-scheme:dark';
  const paragraphs = (text: string) => text.split('\n\n').map(line => `<p>${escapeHtml(line)}</p>`).join('');
  dialog.innerHTML = `<header style="display:flex;justify-content:space-between;align-items:center;gap:16px"><h2 id="mwg-rules-title" style="margin:0;color:#fff;font-size:20px">规则帮助</h2><button type="button" aria-label="关闭规则帮助" style="padding:8px 14px;border:1px solid #858cad;border-radius:8px;background:#2b3150;color:#fff;font:inherit;cursor:pointer">关闭</button></header><h3 style="color:#e4c5ec">欲望</h3>${paragraphs(DESIRE_MECHANICS_HELP)}<h3 style="color:#c5dafa">触发与计数</h3>${paragraphs(TRIGGER_MECHANICS_HELP)}`;
  doc.body.append(dialog);
  // Same-origin parent handles the usual Tavern iframe. Standalone/opaque
  // fallback opens next to the clicked control within its own viewport.
  if (doc === anchor.ownerDocument && window.parent !== window) {
    dialog.style.margin = '0 auto';
    dialog.style.top = `${Math.max(12, anchor.getBoundingClientRect().top - 100)}px`;
    dialog.style.maxHeight = '560px';
  }
  dialog.querySelector('button')!.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close(); } });
  dialog.addEventListener('close', () => { dialog.remove(); if (anchor.isConnected) anchor.focus({ preventScroll: true }); });
  dialog.showModal();
}
