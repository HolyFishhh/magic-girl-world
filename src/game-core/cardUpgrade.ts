import { validateRewardCandidate, validateRewardCandidateAgainstLibrary } from './rewardCandidateValidation';
import { isCompactEffectList } from './compactEffectContract';

export interface CardUpgradePatch {
  /** Optional route binding for node-scoped upgrades. */
  node_id: string;
  card_id: string;
  description?: string;
  name?: string;
  cost?: number | 'energy';
  effects?: unknown;
  discard_effects?: unknown;
  trigger?: string;
  creates?: unknown[];
  retain?: boolean;
  exhaust?: boolean;
  ethereal?: boolean;
  innate?: boolean;
}

export interface CardUpgradeOptions {
  maxLevel?: number;
  knownStatusIds?: Iterable<string>;
  statusDefinitions?: readonly unknown[];
}

export type CardUpgradeResult =
  | { ok: true; card: Record<string, unknown>; level: number }
  | { ok: false; message: string };

const PATCH_KEYS = new Set([
  'node_id',
  'card_id',
  'description',
  'name',
  'cost',
  'effects',
  'discard_effects',
  'trigger',
  'creates',
  'retain',
  'exhaust',
  'ethereal',
  'innate',
]);
const GAMEPLAY_PATCH_KEYS = [
  'cost',
  'effects',
  'discard_effects',
  'trigger',
  'creates',
  'retain',
  'exhaust',
  'ethereal',
  'innate',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function equalValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function upgradedName(name: string, level: number): string {
  const base = name.replace(/\+(?:\d+)?$/, '').trim() || name;
  return `${base}+${level > 1 ? level : ''}`;
}

/** Apply one small AI-authored patch while preserving card identity and ownership fields. */
export function applyCardUpgrade(
  cardValue: unknown,
  patchValue: unknown,
  options: CardUpgradeOptions = {},
): CardUpgradeResult {
  if (!isRecord(cardValue)) return { ok: false, message: 'card must be an object' };
  if (!isRecord(patchValue)) return { ok: false, message: 'upgrade patch must be an object' };
  const unknownKey = Object.keys(patchValue).find(key => !PATCH_KEYS.has(key));
  if (unknownKey) return { ok: false, message: `upgrade field is not allowed: ${unknownKey}` };
  if (typeof patchValue.node_id !== 'string' || !patchValue.node_id.trim()) {
    return { ok: false, message: 'upgrade node_id must be a non-empty string' };
  }
  if (typeof patchValue.card_id !== 'string' || patchValue.card_id !== cardValue.id) {
    return { ok: false, message: 'upgrade card_id must match the selected card' };
  }
  if (
    patchValue.description !== undefined &&
    (typeof patchValue.description !== 'string' || !patchValue.description.trim())
  ) {
    return { ok: false, message: 'upgrade description must be a non-empty string when provided' };
  }
  if (patchValue.name !== undefined && (typeof patchValue.name !== 'string' || !patchValue.name.trim())) {
    return { ok: false, message: 'upgrade name must be a non-empty string' };
  }
  const changedKeys = GAMEPLAY_PATCH_KEYS.filter(
    key => Object.hasOwn(patchValue, key) && !equalValue(patchValue[key], cardValue[key]),
  );
  if (changedKeys.length === 0) return { ok: false, message: 'upgrade patch does not change card rules' };

  const currentLevel = Number(cardValue.upgrade_level ?? 0);
  const maxLevel = options.maxLevel ?? 1;
  if (!Number.isInteger(currentLevel) || currentLevel < 0) return { ok: false, message: 'card upgrade_level is invalid' };
  if (!Number.isInteger(maxLevel) || maxLevel < 1 || maxLevel > 9) return { ok: false, message: 'maxLevel is invalid' };
  if (currentLevel >= maxLevel) return { ok: false, message: 'card has reached its upgrade limit' };

  const next = clone(cardValue);
  for (const key of GAMEPLAY_PATCH_KEYS) {
    if (Object.hasOwn(patchValue, key)) next[key] = clone(patchValue[key]);
  }
  next.name = patchValue.name?.trim() || upgradedName(String(cardValue.name || cardValue.id), currentLevel + 1);
  if (typeof patchValue.description === 'string') next.description = patchValue.description.trim();
  else if (isCompactEffectList(next.effects)) delete next.description;
  next.upgrade_level = currentLevel + 1;

  const validation = validateRewardCandidate('cards', next);
  if (!validation.ok) return { ok: false, message: validation.message };
  if (options.knownStatusIds || options.statusDefinitions) {
    const libraryValidation = validateRewardCandidateAgainstLibrary('cards', next, {
      knownStatusIds: options.knownStatusIds,
      statusDefinitions: options.statusDefinitions,
    });
    if (!libraryValidation.ok) return { ok: false, message: libraryValidation.message };
  }
  return { ok: true, card: next, level: currentLevel + 1 };
}

/** Return a new persistent deck; malformed patches never partially mutate the source array. */
export function applyCardUpgradeToDeck(
  cardsValue: unknown,
  patchValue: unknown,
  options: CardUpgradeOptions = {},
): CardUpgradeResult & { cards?: Record<string, unknown>[] } {
  if (!Array.isArray(cardsValue)) return { ok: false, message: 'card deck must be an array' };
  if (!isRecord(patchValue) || typeof patchValue.card_id !== 'string') {
    return { ok: false, message: 'upgrade patch must include card_id' };
  }
  const matches = cardsValue
    .map((card, index) => ({ card, index }))
    .filter(entry => isRecord(entry.card) && entry.card.id === patchValue.card_id);
  if (matches.length !== 1) {
    return { ok: false, message: matches.length === 0 ? 'selected card was not found' : 'selected card id is ambiguous' };
  }
  const upgraded = applyCardUpgrade(matches[0].card, patchValue, options);
  if (!upgraded.ok) return upgraded;
  const cards = clone(cardsValue) as Record<string, unknown>[];
  cards[matches[0].index] = upgraded.card;
  return { ...upgraded, cards };
}
