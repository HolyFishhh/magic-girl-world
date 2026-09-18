import { INITIAL_DRAFT_SPEC } from '../game-core/initialDraft';
import { assertUnambiguousObjectJson } from '../game-core/jsonObjectIntegrity';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** At this optional container boundary only, an empty string carries no
 * authored condition. Treat it as omission before validation. Never erase
 * prose, false, null, a nonempty formula or a nested effect condition; those
 * retain their existing validation/repair path. Raw evidence stays intact.
 */
export function normalizeInitialDraftEmptyLustCondition(input: Record<string, any>): Record<string, any> {
  if (input.spec !== INITIAL_DRAFT_SPEC || !isRecord(input.player)) return input;
  const effect = input.player.player_lust_effect;
  if (!isRecord(effect) || typeof effect.when !== 'string' || effect.when.trim() !== '') return input;
  const next = { ...effect };
  delete next.when;
  return { ...input, player: { ...input.player, player_lust_effect: next } };
}

/** A Curse cannot be played and has no cost. Some providers serialize the
 * absent optional cost as null. Only erase that unambiguous representation at
 * authored card boundaries, never inside effects, prose, or reference objects.
 * Raw evidence is retained by the caller; strict gameplay validation follows.
 */
export function normalizeInitialDraftAbsentCurseCost(input: Record<string, any>): Record<string, any> {
  if (input.spec !== INITIAL_DRAFT_SPEC) return input;
  const cards = (value: unknown): unknown => {
    if (!Array.isArray(value)) return value;
    let changed = false;
    const next = value.map(card => {
      if (!isRecord(card) || Object.hasOwn(card, 'card_ref') || card.type !== 'Curse' || card.cost !== null) return card;
      changed = true;
      const result = { ...card };
      delete result.cost;
      return result;
    });
    return changed ? next : value;
  };
  let result = input;
  for (const [owner, field] of [['player', 'cards'], ['registry', 'templates']] as const) {
    if (!isRecord(input[owner])) continue;
    const next = cards(input[owner][field]);
    if (next !== input[owner][field]) result = { ...result, [owner]: { ...input[owner], [field]: next } };
  }
  if (isRecord(input.opening) && Array.isArray(input.opening.choices)) {
    let changed = false;
    const choices = input.opening.choices.map((choice: unknown) => {
      if (!isRecord(choice) || !isRecord(choice.outcome) || !isRecord(choice.outcome.reward)) return choice;
      const next = cards(choice.outcome.reward.cards);
      if (next === choice.outcome.reward.cards) return choice;
      changed = true;
      return { ...choice, outcome: { ...choice.outcome, reward: { ...choice.outcome.reward, cards: next } } };
    });
    if (changed) result = { ...result, opening: { ...input.opening, choices } };
  }
  return result;
}

/** Decode one serialization layer at the three known registry-draft object
 * boundaries only. Does not repair syntax, coerce primitives, recursively parse
 * prose, invent fields, or validate gameplay. The original raw reply must be
 * reported first; unchanged compiler, readiness and commit gates run afterward.
 */
export function decodeInitialDraftContainers(input: Record<string, any>): Record<string, any> {
  if (input.spec !== INITIAL_DRAFT_SPEC) return input;
  let result = input;
  for (const key of ['player', 'opening', 'registry'] as const) {
    const value = input[key];
    if (typeof value !== 'string') continue;
    let decoded: unknown;
    try {
      if (value.length > 1_000_000) throw new Error('对象过大');
      decoded = JSON.parse(value);
      if (!isRecord(decoded)) throw new Error('不是对象');
      assertUnambiguousObjectJson(value);
    } catch {
      throw new Error(`INVALID_DRAFT ${key}: 开局草稿字段是字符串，但内部不是完整、无重复字段的有界 JSON 对象；未写入任何变量`);
    }
    result = { ...result, [key]: decoded };
  }
  return result;
}
