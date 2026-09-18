export declare const MAX_TOWER_ITEM_SLOTS: 3;
/** Potions/items consume physical slots; stacked counts consume one slot each. */
export declare function towerItemSlotsUsed(itemsValue: unknown): number;
export declare function towerItemSlotsRemaining(battleValue: unknown): number;
export declare function towerRewardItemSlots(itemsValue: unknown): number;
export declare function fitTowerRewardItems<T>(itemsValue: readonly T[], battleValue: unknown): T[];
export declare function normalizeTowerItemInventory(itemsValue: unknown): Record<string, unknown>[];
