import { renderShopMarket } from '../../src/common/shopMarket';
import { TavernRunActionHost, createShopPurchaseQuote } from '../../src/common/runActionHost';
import { createRunState, enterRunNode, completeRunNode, presentCompactContent } from '../../src/game-core';
import { renderCardFace } from '../../src/shared/cardFace';
import { renderSupportDetails } from '../../src/shared/supportPresentation';
import { renderRulePills } from '../../src/shared/rulePills';

let run = createRunState({ seed: 3, floorsPerAct: 8 });
for (let i = 0; i < 80; i++) {
  const choice = run.choices.find(c => c.kind === 'shop');
  if (choice) {
    run = enterRunNode(run, choice.id);
    break;
  }
  run = completeRunNode(enterRunNode(run, run.choices[0].id), { outcome: 'cleared' });
}
run.gold = 350;
const cards = [
  {
    id: 'strike',
    name: '打击',
    emoji: '⚔️',
    type: 'Attack',
    rarity: 'Common',
    cost: 1,
    quantity: 1,
    effects: { damage: 6 },
  },
  {
    id: 'guard',
    name: '坚守',
    emoji: '🛡️',
    type: 'Skill',
    rarity: 'Common',
    cost: 1,
    quantity: 1,
    effects: { block: 7 },
  },
  {
    id: 'echo',
    name: '回响斩',
    emoji: '🌙',
    type: 'Attack',
    rarity: 'Uncommon',
    cost: 1,
    quantity: 1,
    effects: { damage: 4, hits: 2 },
  },
  { id: 'draw', name: '灵感', emoji: '🔮', type: 'Skill', rarity: 'Rare', cost: 1, quantity: 1, effects: { draw: 2 } },
  {
    id: 'strike',
    name: '打击',
    emoji: '⚔️',
    type: 'Attack',
    rarity: 'Common',
    cost: 1,
    quantity: 1,
    effects: { damage: 6 },
  },
];
const initial = {
  stat_data: {
    run,
    battle: { core: { hp: 60, max_hp: 80 }, cards: [cards[0], cards[1]], artifacts: [], items: [], statuses: [] },
    reward: {
      card: cards,
      artifact: [
        {
          id: 'seal',
          name: '旅人护符',
          emoji: '🧿',
          rarity: 'Uncommon',
          trigger: { on: 'battle_start', effects: { block: 3 } },
        },
      ],
      item: [
        { id: 'tonic', name: '月露', emoji: '⚗️', count: 1, effects: { heal: 10 } },
        { id: 'bottle', name: '闪电瓶', emoji: '⚡', count: 1, effects: { damage: 12 } },
      ],
      limits: { cards: 5, artifacts: 1, items: 2 },
    },
  },
};
let variables = structuredClone(initial),
  purchases = 0;
const host = new TavernRunActionHost({
  isLatest: () => true,
  updateVariablesWith: async updater => {
    const next = await updater(structuredClone(variables));
    variables = next;
    return next;
  },
  continueWithPrompt: async () => {
    throw Error('fixture prohibits AI');
  },
  scheduleTowerGeneration: () => true,
});
const root = document.querySelector<HTMLElement>('#choice-card')!;
const layout = document.createElement('output');
layout.id = 'qa-layout';
document.body.append(layout);
function measure() {
  const dialog = root.querySelector('.shop-detail')?.getBoundingClientRect();
  const frame = window.frameElement?.getBoundingClientRect();
  const card = root.querySelector('.mwg-card')?.getBoundingClientRect();
  layout.textContent = JSON.stringify({
    viewport: innerWidth,
    content: document.documentElement.scrollWidth,
    cardWidth: card?.width,
    dialogTop: dialog ? dialog.top + (frame?.top || 0) : null,
    frameTop: frame?.top,
    dialogLocalTop: dialog?.top,
    rootScroll: root.scrollTop,
    hostScroll: root.querySelector('.shop-detail-host')?.scrollTop,
  });
}
new MutationObserver(() => requestAnimationFrame(measure)).observe(root, { childList: true, subtree: true });
window.addEventListener('resize', measure);
window.addEventListener('scroll', measure);
window.parent.addEventListener('scroll', measure);
const rules = (value: any) =>
  renderRulePills(presentCompactContent(value, value.type ? 'card' : 'content').rulesGroups);
function render() {
  const stat = variables.stat_data;
  document.querySelector('#qa-state')!.textContent = JSON.stringify({
    gold: stat.run.gold,
    stock: stat.reward.card.length + stat.reward.artifact.length + stat.reward.item.length,
    cards: stat.battle.cards.length,
    phase: stat.run.phase,
    purchases,
  });
  if (stat.run.phase !== 'in_node') {
    root.className = 'shop-market';
    root.innerHTML = '<h2>已离开商店</h2><p>路线图已解锁，未购买商品不会触发奖励选择。</p>';
    return;
  }
  const quote = createShopPurchaseQuote(stat);
  renderShopMarket({
    root,
    stat,
    run: stat.run,
    enabled: true,
    renderCard: card =>
      renderCardFace(card, {
        costLabel: String(card.cost) + ' ⚡',
        rarityLabel: ({ Common: '普通', Uncommon: '罕见', Rare: '稀有' } as any)[card.rarity],
        typeLabel: card.type === 'Attack' ? '攻击' : '技能',
        rulesHtml: rules(card),
        quantity: 1,
      }),
    renderSupport: (value, kind) => renderSupportDetails(value, { kind, rulesHtml: rules(value) }),
    purchase: async (category, index) => {
      await host.purchaseShopItem(category, index, quote);
      purchases++;
      render();
    },
    removeCard: async id => {
      await host.removeCardAtShop(id);
      render();
    },
    leave: async () => {
      await host.leaveShop();
      render();
    },
  });
}
document.querySelector('#qa-reset')?.addEventListener('click', () => {
  variables = structuredClone(initial);
  purchases = 0;
  render();
});
document.querySelector('#qa-poor')?.addEventListener('click', () => {
  variables = structuredClone(initial);
  variables.stat_data.run.gold = 0;
  render();
});
document.querySelector('#qa-empty')?.addEventListener('click', () => {
  variables = structuredClone(initial);
  variables.stat_data.reward.card = [];
  variables.stat_data.reward.artifact = [];
  variables.stat_data.reward.item = [];
  render();
});
render();
