/** Frontline membership is execution state, not merely a rendering limit. */
export const ENEMY_FRONTLINE_SLOTS = 5;

export interface FormationMember { id: string; currentHp: number; stageSlot?: number; nextAction?: unknown }

export function arrangeEnemyFrontline<T extends FormationMember>(members: readonly T[], reserves: readonly T[] = []): { frontline: T[]; reserves: T[] } {
  const frontline: T[] = [];
  const waiting = structuredClone([...reserves]);
  const occupied = new Set<number>();
  const initial = !members.some(member => Number.isInteger(member.stageSlot));
  const start = initial ? Math.max(0, ENEMY_FRONTLINE_SLOTS - members.length) : 0;
  for (const original of members) {
    const member = structuredClone(original);
    let slot = member.stageSlot;
    if (!Number.isInteger(slot) || slot! < 0 || slot! >= ENEMY_FRONTLINE_SLOTS || occupied.has(slot!)) {
      slot = Array.from({ length: ENEMY_FRONTLINE_SLOTS }, (_, i) => i).find(i => i >= start && !occupied.has(i));
    }
    if (slot === undefined) {
      if (!waiting.some(entry => entry.id === member.id)) waiting.push({ ...member, stageSlot: undefined, nextAction: null });
    } else {
      occupied.add(slot);
      frontline.push({ ...member, stageSlot: slot });
    }
  }
  const activeIds = new Set(frontline.map(member => member.id));
  return { frontline: frontline.sort((a, b) => a.stageSlot! - b.stageSlot!), reserves: waiting.filter(member => !activeIds.has(member.id)) };
}

export function admitEnemyReserves<T extends FormationMember>(frontline: readonly T[], reserves: readonly T[]): { frontline: T[]; reserves: T[]; admitted: T[] } {
  const next = structuredClone([...frontline]);
  const waiting = structuredClone([...reserves]);
  const admitted: T[] = [];
  for (let slot = 0; slot < ENEMY_FRONTLINE_SLOTS; slot++) {
    if (next.some(member => member.stageSlot === slot)) continue;
    const index = waiting.findIndex(member => member.currentHp > 0);
    if (index < 0) break;
    const [member] = waiting.splice(index, 1);
    const entry = { ...member, stageSlot: slot, nextAction: null };
    next.push(entry);
    admitted.push(entry);
  }
  return { frontline: next.sort((a, b) => a.stageSlot! - b.stageSlot!), reserves: waiting, admitted };
}
