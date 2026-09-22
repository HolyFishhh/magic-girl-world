import type { Card } from '../../game-core';
import { escapeHtml } from '../shared/html';

/** Cosmetic, non-blocking, and driven only by an actual committed departure. */
export function animateCardDeparture(card: Card, kind: 'exhaust' | 'remove' | 'purge'): void {
  if (kind === 'exhaust' && document.querySelector('.battle-pile-dock')) return;
  const stage = document.getElementById('battle-stage');
  if (!stage) return;
  [...document.querySelectorAll('.card-departure')].slice(0, -7).forEach(node => node.remove());
  const source = [...document.querySelectorAll<HTMLElement>('#hand-cards .mwg-card')].find(x => x.dataset.cardId === card.id);
  const anchor = (source || stage).getBoundingClientRect();
  const effect = document.createElement('div');
  effect.className = `card-departure departure-${kind}`;
  effect.setAttribute('aria-hidden', 'true');
  effect.style.left = `${source ? anchor.left : anchor.left + anchor.width / 2 - 75}px`;
  effect.style.top = `${source ? anchor.top : anchor.top + Math.max(0, anchor.height / 2 - 90)}px`;
  const face = source?.cloneNode(true) as HTMLElement | undefined;
  if (face) { face.removeAttribute('style'); face.classList.remove('selected', 'card-playing'); }
  const html = face?.outerHTML || `<div class="departure-face"><span>${escapeHtml(card.emoji || '🃏')}</span><b>${escapeHtml(card.name)}</b></div>`;
  if (kind === 'purge') {
    for(let i=0;i<6;i++) { const shard=document.createElement('div'); shard.className='card-shard'; shard.style.setProperty('--piece',String(i)); shard.innerHTML=html; effect.append(shard); }
  } else effect.innerHTML=html;
  document.body.append(effect);
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  window.setTimeout(()=>effect.remove(),reduced ? 160 : 900);
}
