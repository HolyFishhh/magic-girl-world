export const MAX_TOWER_ITEM_SLOTS = 3 as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function entries(value: unknown): unknown[] {
  if (Array.isArray(value)) return value.flatMap(entry => Array.isArray(entry) ? entries(entry) : [entry]);
  if (isRecord(value)) return Object.values(value).flatMap(entry => Array.isArray(entry) ? entries(entry) : [entry]);
  return [];
}

function itemCount(value: unknown): number {
  if (!isRecord(value)) return 0;
  const count = Number(value.count ?? 1);
  return Number.isInteger(count) && count > 0 ? count : 1;
}

/** Potions/items consume physical slots; stacked counts consume one slot each. */
export function towerItemSlotsUsed(itemsValue: unknown): number {
  return entries(itemsValue).reduce<number>((total, item) => total + itemCount(item), 0);
}

export function towerItemSlotsRemaining(battleValue: unknown): number {
  const battle = isRecord(battleValue) ? battleValue : {};
  return Math.max(0, MAX_TOWER_ITEM_SLOTS - towerItemSlotsUsed(battle.items));
}

export function towerRewardItemSlots(itemsValue: unknown): number {
  return entries(itemsValue).reduce<number>((total, item) => total + itemCount(item), 0);
}

export function fitTowerRewardItems<T>(itemsValue: readonly T[], battleValue: unknown): T[] {
  let remaining = towerItemSlotsRemaining(battleValue);
  const accepted: T[] = [];
  for (const item of itemsValue) {
    const slots = towerRewardItemSlots([item]);
    if (slots > remaining) continue;
    accepted.push(structuredClone(item));
    remaining -= slots;
  }
  return accepted;
}

export function normalizeTowerItemInventory(itemsValue: unknown): Record<string, unknown>[] {
  let remaining = MAX_TOWER_ITEM_SLOTS;
  const normalized: Record<string, unknown>[] = [];
  for (const raw of entries(itemsValue)) {
    if (!isRecord(raw) || remaining <= 0) continue;
    const count = Math.min(itemCount(raw), remaining);
    normalized.push({ ...structuredClone(raw), count });
    remaining -= count;
  }
  return normalized;
}
