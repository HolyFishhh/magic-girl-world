import { renderBattleRewardsMenu, type BattleRewardMenuClaim } from '../../src/common/battleRewardsMenu';
import { applyRewardSelectionsToStat } from '../../src/common/rewardTransactions';
import { bindTowerArchetypePicker } from '../../src/shared/towerArchetypePicker';
import { renderCardFace } from '../../src/shared/cardFace';
import { renderSupportDetails } from '../../src/shared/supportPresentation';
import { renderRulePills } from '../../src/shared/rulePills';
import { createRunState, enterRunNode, presentCompactContent } from '../../src/game-core';
import { mountTowerApp } from '../../src/tower/towerApp';
import '../../src/common/index.scss';
import '../../src/tower/index.scss';

const card = (id: string, name: string, emoji: string, damage: number, rarity = 'Common') => ({
  id, name, emoji, type: 'Attack', rarity, cost: 1, quantity: 1,
  description: `造成 ${damage} 点伤害。`, effects: { damage },
});

const offeredCards = [
  card('fixture_moon', '月华斩', '🌙', 7),
  card('fixture_star', '星屑突刺', '✨', 6, 'Uncommon'),
  card('fixture_guard', '辉光守势', '🛡️', 4),
  card('fixture_tide', '潮汐冲击', '🌊', 8),
  card('fixture_bloom', '花冠连击', '🌸', 5, 'Rare'),
  card('fixture_spark', '雷光弹', '⚡', 9),
];

const freshStat = () => ({
  battle: {
    core: { hp: 64, max_hp: 80 }, cards: [], artifacts: [], items: [], statuses: [],
  },
  reward: {
    card: structuredClone(offeredCards),
    card_choice_groups: [
      { id: 'base', indices: [0, 1, 2], pick: 1 },
      { id: 'defeat:fixture-lantern', indices: [3, 4, 5], pick: 1 },
    ],
    artifact: [{
      id: 'fixture_lantern', name: '月灯护符', emoji: '🏮', rarity: 'Uncommon',
      description: '战斗开始时获得 3 点格挡。', trigger: { on: 'battle_start', effects: { block: 3 } },
    }],
    item: [
      { id: 'fixture_moonwater', name: '月露', emoji: '⚗️', count: 1, description: '回复 12 点生命。', effects: { heal: 12 } },
      { id: 'fixture_lightning', name: '闪电瓶', emoji: '⚡', count: 1, description: '造成 15 点伤害。', effects: { damage: 15 } },
    ],
    limits: { cards: 2, artifacts: 1, items: 2 }, gold: 0, gold_claimed: true, pool_revision: 0,
  },
});

let stat = freshStat();
const rewardRoot = document.querySelector<HTMLElement>('#fixture-rewards')!;
const stateOutput = document.querySelector<HTMLElement>('#fixture-reward-state')!;

function rules(value: any): string {
  return renderRulePills(presentCompactContent(value, value.type ? 'card' : 'content').rulesGroups);
}

function renderRewardState(): void {
  const reward = stat.reward;
  stateOutput.textContent = `剩余：${reward.card.length} 张卡牌、${reward.artifact.length} 件遗物、${reward.item.length} 瓶药水；已领取：${stat.battle.cards.length} 张卡牌、${stat.battle.artifacts.length} 件遗物、${stat.battle.items.length} 瓶药水；修订 ${reward.pool_revision}`;
}

async function claimReward(request: BattleRewardMenuClaim): Promise<void> {
  if (request.kind === 'discard') {
    applyRewardSelectionsToStat(stat, { cards: [], artifacts: [], items: [] });
  } else if (request.kind === 'gold') {
    throw new Error('此夹具没有金币奖励。');
  } else {
    applyRewardSelectionsToStat(stat, {
      cards: request.kind === 'cards' ? request.indexes || [] : [],
      artifacts: request.kind === 'artifacts' ? request.indexes || [] : [],
      items: request.kind === 'items' ? request.indexes || [] : [],
    }, { partial: true, cardGroupId: request.cardGroupId });
  }
  renderRewards();
}

function renderRewards(): void {
  renderRewardState();
  renderBattleRewardsMenu({
    root: rewardRoot,
    stat,
    enabled: true,
    renderCard: value => renderCardFace(value, {
      costLabel: `${value.cost} ⚡`, rarityLabel: ({ Common: '普通', Uncommon: '罕见', Rare: '稀有' } as Record<string, string>)[value.rarity] || value.rarity,
      typeLabel: value.type === 'Attack' ? '攻击' : value.type, rulesHtml: rules(value), quantity: value.quantity || 1,
    }),
    renderSupport: (value, kind) => renderSupportDetails(value, { kind, rulesHtml: rules(value) }),
    claim: claimReward,
  });
}

let mapRun = createRunState({ seed: 442, startingGold: 77 });
mapRun = {
  ...mapRun,
  nodeContent: Object.fromEntries(Object.entries(mapRun.nodeContent).map(([id, envelope]) => [id, {
    ...envelope,
    phase: mapRun.choices.some(choice => choice.id === id) ? 'ready' : envelope.phase,
    content: mapRun.choices.some(choice => choice.id === id)
      ? { title: '已准备的入口', narrative: `独立入口 ${id.slice(-1)}，仅供夹具内存演示。` }
      : envelope.content,
  }])),
};
const mapState = document.querySelector<HTMLElement>('#fixture-map-state')!;
const mapRoot = document.querySelector<HTMLElement>('#fixture-map')!;
const updateMapState = () => {
  mapState.textContent = `内存路线：${mapRun.phase}；楼层 ${mapRun.floor}；金币 ${mapRun.gold}；可选入口 ${mapRun.choices.map(choice => choice.id).join('、') || '无'}`;
};
const mapApp = mountTowerApp({
  root: mapRoot,
  snapshot: mapRun,
  title: '固定 seed 442 · 三个独立入口',
  difficultyPercent: 80,
  playerHp: 57,
  playerMaxHp: 80,
  callbacks: {
    onNodeSelect: node => {
      mapRun = enterRunNode(mapRun, node.id);
      updateMapState();
      mapApp.update(mapRun, { difficultyPercent: 80, playerHp: 57, playerMaxHp: 80 });
    },
  },
});
updateMapState();

bindTowerArchetypePicker(
  document.querySelector<HTMLElement>('#tower-archetype-picker'),
  document.querySelector<HTMLTextAreaElement>('#tower-start-card'),
);
document.querySelector('#fixture-reset')?.addEventListener('click', () => { stat = freshStat(); renderRewards(); });
document.querySelector('#fixture-clear')?.addEventListener('click', () => { void claimReward({ kind: 'discard' }); });
document.querySelector('#tower-start-card')?.addEventListener('input', event => {
  document.querySelector('#fixture-deck-value')!.textContent = (event.currentTarget as HTMLTextAreaElement).value || '（空）';
});

renderRewards();
