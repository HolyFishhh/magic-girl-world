/** Minimal timing contrasts, compiled and exercised by the contract tests.
 * Examples illustrate syntax, not mandatory content or balance defaults. */
export declare const EFFECT_PROTOCOL_TIMING_EXAMPLES: {
    readonly firstAttackDiscard: {
        readonly on: "on_discard";
        readonly scope: "turn";
        readonly ordinal: "first";
        readonly card_type: "Attack";
        readonly effects: {
            readonly energy: 2;
        };
    };
    readonly firstSkill: {
        readonly on: "skill_played";
        readonly scope: "turn";
        readonly ordinal: "first";
        readonly effects: {
            readonly block: 2;
            readonly to: "self";
        };
    };
    readonly localDiscardResult: readonly [{
        readonly discard: 1;
        readonly from: "hand";
        readonly pick: "choose";
    }, {
        readonly energy: 2;
        readonly when: "discarded_card_type('Attack')";
    }];
};
