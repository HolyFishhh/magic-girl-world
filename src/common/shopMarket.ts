import type { RunState } from '../game-core';
import { canPermanentlyRemoveCard } from '../game-core/cardLifecycle';
import { migratePersistentRunDeck, recommendShopPrice, towerShopRemovalPrice } from '../game-core';
import { inspectRewardCandidates, normalizeMvuList, readRewardLimits, type RewardCategory } from './rewardTransactions';
import { pinSelectionToVisibleViewport } from './fixedSelectionViewport';
import './shopMarket.scss';

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

export interface ShopMarketOptions {
  root: HTMLElement;
  stat: Record<string, any>;
  run: RunState;
  enabled: boolean;
  renderCard(card: any): string;
  renderSupport(content: any, type: '遗物' | '道具'): string;
  purchase(category: RewardCategory, index: number): Promise<void>;
  removeCard(id: string): Promise<void>;
  leave(): Promise<void>;
}

/** Original inline SVG; all merchandise and prices below remain real DOM controls. */
const MERCHANT = `<svg viewBox="0 0 260 340" role="img" aria-label="坐在行囊旁的旅途商人" xmlns="http://www.w3.org/2000/svg">
<title>旅途商人</title><desc>戴着宽大兜帽的商人坐在织毯上，身旁摆着木箱、零钱和一盏灯。</desc>
<defs><linearGradient id="shop-robe" x2=".8" y2="1"><stop stop-color="#587577"/><stop offset="1" stop-color="#243842"/></linearGradient><radialGradient id="shop-glow"><stop stop-color="#ffe2a0" stop-opacity=".65"/><stop offset="1" stop-color="#eeb059" stop-opacity="0"/></radialGradient></defs>
<ellipse cx="130" cy="310" rx="123" ry="24" fill="#30251d" opacity=".24"/>
<path d="M25 283 207 272 244 314 51 330 8 305Z" fill="#687d78" stroke="#344c4d" stroke-width="4"/><path d="m35 288 166-9 29 27-177 13Z" fill="none" stroke="#c4aa73" stroke-width="3"/>
<g stroke="#29414b" stroke-width="4" stroke-linejoin="round"><path d="M76 177Q76 104 129 88q58 28 64 87l-7 77 29 45q-88 32-165-2l27-42Z" fill="url(#shop-robe)"/><path d="M81 161q-6-96 61-117 55 36 50 129l-29 44-52-13Z" fill="#527078"/><path d="M105 158q0-50 39-79 34 32 34 87l-28 32-41-14Z" fill="#192d35"/></g>
<path d="m126 148 12 3m12-3 12-2" stroke="#f7d994" stroke-width="4" stroke-linecap="round"/><path d="m82 178 37 56 56-20m-56 20-15 62m62-61 18 53" fill="none" stroke="#9bac9c" stroke-opacity=".4" stroke-width="3"/>
<path d="M68 205q-17 37 27 51l40-20-11-16-34 9 2-23M181 205q24 19 39 2l6 13q-15 32-54 16" fill="#527078" stroke="#29414b" stroke-width="4"/>
<path d="m128 221 18-8 13 4-19 10 12 3-8 9-15-4M215 207l5-17 5 4 2 10 9-4 2 8-14 12" fill="#bdb990" stroke="#514e3f" stroke-width="3"/>
<path d="m45 269 35-4 13 45-55 2Z" fill="#9e7651" stroke="#513e31" stroke-width="3"/><path d="m47 269 26 1m-20 8 12 19" stroke="#d9b37b" stroke-width="3"/>
<path d="m160 278 71-4 9 39-77 5Z" fill="#795338" stroke="#402f28" stroke-width="4"/><path d="m160 278 12-14 56 0 3 10" fill="#9e7551" stroke="#402f28" stroke-width="3"/><path d="m173 278 4 39m43-42 6 38" stroke="#c2a16a" stroke-width="6"/><rect x="191" y="288" width="13" height="11" rx="2" fill="#e0bb70"/>
<g fill="#e4bd65" stroke="#9d733c" stroke-width="2"><ellipse cx="117" cy="299" rx="10" ry="4"/><ellipse cx="111" cy="307" rx="10" ry="4"/><ellipse cx="134" cy="310" rx="10" ry="4"/></g>
<circle cx="31" cy="213" r="43" fill="url(#shop-glow)"/><path d="m20 194 21 0 3 43-27 0Z" fill="#d59c4d" stroke="#493e32" stroke-width="3"/><path d="M22 194v-8q9-13 16 0v8m-22 43h30m-18-38-3 32m10-32 3 32" fill="none" stroke="#58442e" stroke-width="3"/>
</svg>`;

const REMOVAL = `<svg viewBox="0 0 100 90" aria-hidden="true"><path d="m22 13 48 3 9 61-49-1Z" fill="#efe0b5" stroke="#755539" stroke-width="3"/><path d="m32 29 27 26m3-26L36 55" stroke="#a55e4b" stroke-width="5"/><path d="m76 7 8 8-49 61-9 4 2-12Z" fill="#b6bdaf" stroke="#4d534c" stroke-width="3"/><path d="m72 18 12 10" stroke="#866944" stroke-width="6"/></svg>`;

export function renderShopMarket(options: ShopMarketOptions): void {
  const { root, stat, run, enabled } = options;
  const reward = stat.reward || {};
  const candidates = {
    cards: normalizeMvuList<any>(reward.card),
    artifacts: normalizeMvuList<any>(reward.artifact),
    items: normalizeMvuList<any>(reward.item),
  };
  const inspections = inspectRewardCandidates(stat),
    limits = readRewardLimits(stat);
  const removalPrice = towerShopRemovalPrice(run);
  const deck = migratePersistentRunDeck(normalizeMvuList<Record<string, any>>(stat.battle?.cards)).filter(canPermanentlyRemoveCard);
  const names = { cards: '卡牌', artifacts: '遗物', items: '药水与道具' };
  const row = (category: RewardCategory) => {
    const goods = candidates[category]
      .map((item, index) => {
        const price = recommendShopPrice(category, item, run.act);
        const valid = inspections[category][index]?.ok === true;
        const available = valid && limits[category] > 0;
        const canBuy = enabled && available && run.gold >= price;
        const reason = !valid
          ? '商品暂不可售'
          : limits[category] <= 0
            ? '携带空间不足'
            : run.gold < price
              ? '金币不足'
              : '';
        const face =
          category === 'cards'
            ? `<div class="shop-card-inspect" data-shop-inspect="${category}:${index}" role="button" tabindex="0" aria-label="查看${escapeHtml(String(item.name || '卡牌'))}详情">${options.renderCard(item)}</div>`
            : `<button type="button" class="shop-curio" data-shop-inspect="${category}:${index}" aria-label="查看${escapeHtml(String(item.name || '商品'))}"><span class="shop-curio-icon">${escapeHtml(String(item.emoji || '◇'))}</span><span class="shop-curio-name">${escapeHtml(String(item.name || '未命名商品'))}</span><small>查看详情</small></button>`;
        return `<article class="shop-product" data-stock="${category}:${index}"><div class="shop-product-face">${face}</div><button type="button" class="shop-price" data-shop-buy="${category}:${index}" ${canBuy ? '' : 'disabled'} aria-label="购买${escapeHtml(String(item.name || '商品'))}，${price}金币"><span aria-hidden="true">●</span> ${price}<small>${reason || '购买'}</small></button></article>`;
      })
      .join('');
    return `<section class="shop-stock shop-stock-${category}" aria-label="${names[category]}"><h3>${names[category]}</h3><div class="shop-goods">${goods || '<p class="shop-empty">这一栏已经售罄</p>'}</div></section>`;
  };
  root.classList.add('shop-market');
  root.innerHTML = `<header class="shop-heading"><div><small>旅 途 中 的 歇 脚 处</small><h2>行囊商店</h2></div><div class="shop-purse" aria-label="当前金币"><span aria-hidden="true">●</span> <strong>${run.gold}</strong><small>金币</small></div></header>
  <div class="shop-scene"><aside class="shop-merchant"><p class="shop-speech">挑件趁手的吧。<br>前面的路还很长。</p>${MERCHANT}<span class="shop-merchant-sign">童叟无欺 · 概不赊账</span></aside>
  <div class="shop-blanket">${row('cards')}<div class="shop-sundries">${row('artifacts')}${row('items')}</div>
  <section class="shop-removal"><div class="shop-removal-art">${REMOVAL}</div><div><h3>删牌服务</h3><p>从牌组永久移除一张牌</p><button type="button" class="shop-price" data-shop-remove ${enabled && !stat.run_shop?.removal_used && deck.length && run.gold >= removalPrice ? '' : 'disabled'}>${stat.run_shop?.removal_used ? '本店已使用' : `<span aria-hidden="true">●</span> ${removalPrice}<small>选择卡牌</small>`}</button></div></section></div></div>
  <footer class="shop-footer"><p class="shop-message" role="status" aria-live="polite">每件商品单独购买，买好即可离开。</p><button type="button" class="shop-leave" ${enabled ? '' : 'disabled'}>离开商店 <span aria-hidden="true">➜</span></button></footer><div class="shop-detail-host"></div>`;
  let busy = false;
  const message = root.querySelector<HTMLElement>('.shop-message')!;
  const host = root.querySelector<HTMLElement>('.shop-detail-host')!;
  const perform = async (action: () => Promise<void>) => {
    if (busy || !enabled) return;
    busy = true;
    const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>('button'));
    const disabled = buttons.map(button => button.disabled);
    buttons.forEach(button => (button.disabled = true));
    try {
      await action();
    } catch (error) {
      message.textContent = error instanceof Error ? error.message : '交易失败，请重试';
      message.classList.add('is-error');
      const dialog = host.querySelector('.shop-detail-body');
      if (dialog) {
        let alert = dialog.querySelector<HTMLElement>('[role="alert"]');
        if (!alert) {
          alert = root.ownerDocument.createElement('p');
          alert.setAttribute('role', 'alert');
          dialog.prepend(alert);
        }
        alert.textContent = message.textContent;
      }
    } finally {
      busy = false;
      buttons.forEach((button, index) => (button.disabled = disabled[index]));
    }
  };
  const detail = (title: string, markup: string, anchor?: HTMLElement) => {
    const opener = anchor || root.ownerDocument.activeElement as HTMLElement | null;
    host.classList.toggle('is-product-detail', !!anchor);
    host.classList.toggle('is-removal-detail', !anchor);
    const background = Array.from(root.children).filter(child => child !== host) as HTMLElement[];
    background.forEach(child => (child.inert = true));
    const tag = anchor ? 'section' : 'dialog';
    host.innerHTML = `<${tag} class="shop-detail" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}"><header><h3>${escapeHtml(title)}</h3><button type="button" class="shop-detail-close" aria-label="关闭详情">✕</button></header><div class="shop-detail-body">${markup}</div></${tag}>`;
    let unpin = () => {};
    const removalDialog = !anchor ? host.querySelector<HTMLDialogElement>('dialog') : null;
    const removalObserver = new MutationObserver(() => {
      if (!host.isConnected || !root.contains(host)) { unpin(); removalObserver.disconnect(); }
    });
    const close = () => {
      unpin(); removalObserver.disconnect();
      if (removalDialog?.open) removalDialog.close();
      host.replaceChildren();
      background.forEach(child => (child.inert = false));
      opener?.focus({ preventScroll: true });

    };
    host.querySelector('.shop-detail-close')?.addEventListener('click', close);
    removalDialog?.addEventListener('cancel', event => { event.preventDefault(); close(); });
    host.onkeydown = event => {
      if (event.key === 'Escape') close();
      if (event.key === 'Tab') {
        const controls = Array.from(host.querySelectorAll<HTMLElement>('button:not(:disabled),[tabindex="0"]'));
        const next = event.shiftKey ? controls.at(-1) : controls[0],
          edge = event.shiftKey ? controls[0] : controls.at(-1);
        if (root.ownerDocument.activeElement === edge) {
          event.preventDefault();
          next?.focus({ preventScroll: true });
        }
      }
    };
    const closeButton = host.querySelector<HTMLButtonElement>('.shop-detail-close');
    const dialog = host.querySelector<HTMLElement>('.shop-detail')!;
    if (anchor) {
      // Product previews alone follow the clicked merchandise.
      const rect = anchor.getBoundingClientRect(), origin = root.getBoundingClientRect();
      const left = Math.min(root.clientWidth - dialog.offsetWidth - 8, rect.right - origin.left + 8);
      dialog.style.marginLeft = `${Math.max(8, left)}px`;
      dialog.style.marginTop = `${Math.max(8, rect.top - origin.top)}px`;
    } else if (removalDialog) {
      // Native top layer escapes the shop's clipping/stacking context. Its
      // bounds follow the visible host viewport, not a tall iframe's center.
      removalDialog.showModal();
      unpin = pinSelectionToVisibleViewport(removalDialog);
      removalObserver.observe(root, { childList: true });
    }
    closeButton?.focus({ preventScroll: true });
  };
  root.querySelectorAll<HTMLButtonElement>('[data-shop-buy]').forEach(button =>
    button.addEventListener('click', () => {
      const [category, index] = button.dataset.shopBuy!.split(':');
      void perform(() => options.purchase(category as RewardCategory, Number(index)));
    }),
  );
  root.querySelectorAll<HTMLElement>('[data-shop-inspect]').forEach(button => {
    const inspect = () => {
      const [category, index] = button.dataset.shopInspect!.split(':');
      const item = candidates[category as RewardCategory][Number(index)];
      detail(String(item.name || '商品'), category === 'cards' ? options.renderCard(item) : options.renderSupport(item, category === 'artifacts' ? '遗物' : '道具'), button);
    };
    button.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); inspect(); });
    button.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); inspect(); } });
  });
  root.querySelector('[data-shop-remove]')?.addEventListener('click', () => {
    detail(
      '选择要移除的卡牌',
      `<p class="shop-removal-notice">点选一张卡牌，再确认花费 ${removalPrice} 金币永久移除。本店仅可使用一次。</p><div class="shop-remove-list">${deck.map((card, index) => `<article class="mwg-card-choice" role="button" tabindex="0" aria-pressed="false" aria-label="选择移除${escapeHtml(String(card.name || '卡牌'))}" data-remove-index="${index}">${options.renderCard(card)}</article>`).join('')}</div>`,
    );
    let selected: number | null = null;
    const confirm = root.ownerDocument.createElement('button');confirm.type='button';confirm.className='shop-price shop-remove-confirm';confirm.textContent=`确认删除 · ${removalPrice} 金币`;confirm.disabled=true;
    host.querySelector('.shop-detail > header')!.insertBefore(confirm,host.querySelector('.shop-detail-close'));
    const select = (card: HTMLElement) => {
      if (busy) return;
      selected=Number(card.dataset.removeIndex);
      host.querySelectorAll<HTMLElement>('[data-remove-index]').forEach(el=>{const active=el===card;el.classList.toggle('is-selected',active);el.setAttribute('aria-pressed',String(active));});
      confirm.disabled=!enabled || run.gold<removalPrice;
    };
    host.querySelectorAll<HTMLElement>('[data-remove-index]').forEach(card=>{
      card.addEventListener('click',()=>select(card));
      card.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();select(card);}});
    });
    confirm.addEventListener('click',()=>{if(selected!==null)void perform(()=>options.removeCard(String(deck[selected!].runInstanceId)));});
  });
  root.querySelector('.shop-leave')?.addEventListener('click', () => void perform(options.leave));
}
