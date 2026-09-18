/** Expand authored duplicates once; never rewrite valid content for quality. */
export function expandEnemyQuantities<T extends Record<string, any>>(definitions: readonly T[]): T[] {
  const used = new Set(definitions.map(enemy => enemy.id));
  return definitions.flatMap(enemy => {
    const quantity = Number.isSafeInteger(enemy.quantity) && enemy.quantity >= 1 && enemy.quantity <= 100 ? enemy.quantity : 1;
    const first = { ...structuredClone(enemy), quantity: 1 };
    const copies = [first];
    let suffix = 2;
    for (let i = 1; i < quantity; i++) {
      let id = `${enemy.id}_copy_${suffix++}`;
      while (used.has(id)) id = `${enemy.id}_copy_${suffix++}`;
      used.add(id);
      copies.push({ ...structuredClone(first), id });
    }
    return copies;
  });
}
