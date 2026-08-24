/** Canonical content identifiers shared by contracts, rewards, and host adapters. */
export const CARD_TYPE_SET: ReadonlySet<string> = new Set(['Attack', 'Skill', 'Power', 'Event', 'Curse']);
export const CARD_RARITY_SET: ReadonlySet<string> = new Set([
  'Common',
  'Uncommon',
  'Rare',
  'Epic',
  'Legendary',
  'Corrupt',
]);
export const RELIC_RARITY_SET: ReadonlySet<string> = new Set(['Common', 'Uncommon', 'Rare', 'Boss', 'ENS']);
