export type TowerEventTone = 'good' | 'risk' | 'bad';
export interface TowerMysteryRoll {
    version: 1;
    roomRoll: number;
    eventRoll: number;
    kind: 'event' | 'battle' | 'shop';
    tone: TowerEventTone;
}
export declare function mysteryKindFromRoll(roll: number): TowerMysteryRoll['kind'];
export declare function eventToneFromRoll(roll: number): TowerEventTone;
/** Independent, room-stable streams: requests, retries and reloads never reroll. */
export declare function rollTowerMystery(contentSeed: number, rewardSeed: number): TowerMysteryRoll;
export declare function towerEventToneGuidance(rewardSeed: number): string;
