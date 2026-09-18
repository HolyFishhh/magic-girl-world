import { createBattleRandomState, drawBattleRandom, stableHash32 } from './deterministicRandom';

export type TowerEventTone = 'good' | 'risk' | 'bad';
export interface TowerMysteryRoll {
  version: 1;
  roomRoll: number;
  eventRoll: number;
  kind: 'event' | 'battle' | 'shop';
  tone: TowerEventTone;
}

export function mysteryKindFromRoll(roll: number): TowerMysteryRoll['kind'] {
  return roll < 70 ? 'event' : roll < 90 ? 'battle' : 'shop';
}

export function eventToneFromRoll(roll: number): TowerEventTone {
  return roll < 50 ? 'good' : roll < 80 ? 'risk' : 'bad';
}

/** Independent, room-stable streams: requests, retries and reloads never reroll. */
export function rollTowerMystery(contentSeed: number, rewardSeed: number): TowerMysteryRoll {
  const roll = (seed: number, stream: string) => Math.floor(drawBattleRandom(
    createBattleRandomState(stableHash32(`${stream}:${seed}`)),
  ).value * 100);
  const roomRoll = roll(contentSeed, 'mystery-room/v1');
  const eventRoll = roll(rewardSeed, 'event-tone/v1');
  return { version: 1, roomRoll, eventRoll, kind: mysteryKindFromRoll(roomRoll), tone: eventToneFromRoll(eventRoll) };
}

export function towerEventToneGuidance(rewardSeed: number): string {
  const { eventRoll, tone } = rollTowerMystery(0, rewardSeed);
  const descriptions = {
    good: '好事件：整体提供收益与可行的善意机会',
    risk: '风险与机遇并存：可用代价换取加强，或根据选择承担不同风险',
    bad: '坏事件：存在损失、诅咒或陷阱，但仍让玩家作出有意义的选择',
  };
  return `程序事件掷点=${eventRoll + 1}/100，类型=${descriptions[tone]}。分布为好事件50%、风险/代价30%、坏事件20%；按已掷定类型设计，不再自行抽取类型。结果保存在outcome；title、narrative、event.description和选项label/description只写当下可感知的情境与行动，不提前透露结果卡名、卡面、诅咒身份、数值变化或隐藏分支。三张未知牌三选一应写成三个事件choices，选中的牌放outcome.gain_cards强制获得；允许接受得到诅咒而拒绝得到好牌。普通已揭晓奖励才使用outcome.reward供后续挑选。`;
}
