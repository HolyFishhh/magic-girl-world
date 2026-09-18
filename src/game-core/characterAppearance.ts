/** Presentation is derived from held executable statuses, never persisted over the base portrait.
 * Existing array order is acquisition order; re-stacking does not steal priority.
 * A Power/ability can grant an appearance status through its ordinary apply_status effect.
 */
export function resolveCharacterEmoji(
  entity: { emoji?: string; statusEffects?: readonly { id: string; stacks: number }[] },
  definition: (id: string) => { character_emoji?: string } | undefined,
  fallback = '✨',
): string {
  const held = entity.statusEffects || [];
  for (let index = held.length - 1; index >= 0; index--) {
    if (!(held[index].stacks > 0)) continue;
    const emoji = definition(held[index].id)?.character_emoji;
    if (typeof emoji === 'string' && emoji.trim()) return emoji.trim();
  }
  return entity.emoji?.trim() || fallback;
}
export const CHARACTER_EMOJI_SCHEMA = { type: 'string', minLength: 1, maxLength: 32 } as const;
