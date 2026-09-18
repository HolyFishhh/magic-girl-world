/** Authoring shorthand only. Saved rewards always contain executable cards. */
export const INITIAL_CARD_REFERENCE_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['card_ref', 'quantity'],
  description: '引用本次 player.cards 中唯一完整的非唯一卡定义；quantity 是奖励副本数，不允许覆盖原卡规则。',
  properties: {
    card_ref: { type: 'string', pattern: '^[A-Za-z_][A-Za-z0-9_-]*$' },
    quantity: { type: 'integer', minimum: 1, maximum: 100 },
  },
};

const record = (value: unknown): value is Record<string, any> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/** No inferred identity, chained references, overrides, or mutation of the library. */
export function resolveInitialCardReference(reference: Record<string, any>, cards: unknown[]): Record<string, any> | null {
  const sources = cards.filter(card => record(card) && card.id === reference.card_ref);
  if (typeof reference.card_ref !== 'string' || !/^[A-Za-z_][A-Za-z0-9_-]*$/.test(reference.card_ref)
    || Object.keys(reference).some(key => key !== 'card_ref' && key !== 'quantity')
    || !Number.isInteger(reference.quantity) || reference.quantity < 1 || reference.quantity > 100
    || sources.length !== 1 || Object.hasOwn(sources[0] as object, 'card_ref')) return null;
  return { ...structuredClone(sources[0] as Record<string, any>), quantity: reference.quantity };
}

/** Compile the single-response route before gameplay validation or repair planning. */
export function expandInitialOpeningCardReferences<T>(opening: T, player: Record<string, any>): T {
  const result = structuredClone(opening);
  if (!record(result) || !Array.isArray(result.choices)) return result;
  result.choices.forEach((choice, choiceIndex) => {
    const cards = choice?.outcome?.reward?.cards;
    if (!Array.isArray(cards)) return;
    cards.forEach((card, index) => {
      if (!record(card) || !Object.hasOwn(card, 'card_ref')) return;
      const resolved = Array.isArray(player.cards) ? resolveInitialCardReference(card, player.cards) : null;
      if (!resolved) throw new Error(`opening.choices[${choiceIndex}].outcome.reward.cards[${index}].card_ref: INVALID_REFERENCE：馈赠引用必须仅含 card_ref 和 1..100 整数 quantity，并指向本次 player.cards 中唯一完整定义`);
      cards[index] = resolved;
    });
  });
  return result;
}
