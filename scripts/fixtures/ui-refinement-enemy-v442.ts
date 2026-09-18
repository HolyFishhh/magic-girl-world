import $ from 'jquery';
import { BattleUI } from '../../src/fish/ui/battleUI';
import { convertMvuEnemies } from '../../src/fish/core/mvuBattleAdapter';
import '../../src/fish/index.scss';

// Fish receives Tavern's global jQuery in production. This isolated document
// supplies it before the real BattleUI is asked to paint the runtime enemies.
(window as any).$ = $;
(window as any).jQuery = $;

const authoredEnemies = [
  {
    id: 'fixture_sentinel', name: '月影守卫', emoji: '🛡️', hp: 38, max_hp: 44, lust: 4, max_lust: 30, block: 5,
    actions: [{ name: '盾击', emoji: '🛡️', description: '造成 6 点伤害并获得格挡。', effects: { damage: 6, block: 4 } }],
    status_effects: [], abilities: [], resources: [], orb_slots: 0, orbs: [], stance: null,
  },
  {
    id: 'fixture_lantern', name: '灯火妖精', emoji: '🏮', hp: 29, max_hp: 35, lust: 9, max_lust: 30, block: 0,
    actions: [{ name: '流光弹', emoji: '✨', description: '造成 8 点伤害。', effects: { damage: 8 } }],
    status_effects: [], abilities: [], resources: [],
    stance: { id: 'fixture_glow', name: '辉光姿态', emoji: '🌟', description: '进入时获得 1 点格挡。', enter: { block: 1 } },
    orb_slots: 2, orbs: [{ id: 'fixture_lumen', name: '流明姿态', emoji: '💡', value: 3, description: '激发时造成 3 点伤害。', evoke: { damage: 3 } }],
  },
];
const enemies = convertMvuEnemies(authoredEnemies, () => 0);
if (enemies.length !== 2 || !enemies.every(enemy => enemy.nextAction)) throw new Error('敌人夹具必须经正式适配器得到两个可显示的下一步行动。');
const player = { currentHp: 64, maxHp: 80, currentLust: 3, maxLust: 30, energy: 3, maxEnergy: 3, block: 0, emoji: '✨', resources: {}, relics: [], statusEffects: [], abilities: [], hand: [], deck: [], drawPile: [], discardPile: [], exhaustPile: [], stance: null, orbs: { slots: 0, orbs: [] } };
void BattleUI.refreshBattleUI({ enemies, activeEnemyId: 'fixture_lantern', player, summons: { living: [] }, phase: 'player_turn', currentTurn: 1, isGameOver: false });
