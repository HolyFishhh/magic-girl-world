/** Minimal timing contrasts, compiled and exercised by the contract tests.
 * Examples illustrate syntax, not mandatory content or balance defaults. */
export const EFFECT_PROTOCOL_TIMING_EXAMPLES = {
  firstAttackDiscard: { on: 'on_discard', scope: 'turn', ordinal: 'first', card_type: 'Attack', effects: { energy: 2 } },
  firstSkill: { on: 'skill_played', scope: 'turn', ordinal: 'first', effects: { block: 2, to: 'self' } },
  localDiscardResult: [{ discard: 1, from: 'hand', pick: 'choose' }, { energy: 2, when: "discarded_card_type('Attack')" }],
} as const;
