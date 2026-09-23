/** Holder-local declarative defenses; no status id is special-cased at runtime. */
export interface StatusDefenseRule {
    negate_debuff?: true;
    damage_cap?: number;
    prevent_hp_loss?: true;
    retaliate_attack?: number | 'stacks';
}
export declare function normalizeStatusDefenseRule(value: unknown): StatusDefenseRule | null;
export declare function statusDefenseRuleDescription(rule: StatusDefenseRule): string[];
/** One field table for generation and bounded value-slot repair. */
export declare const STATUS_DEFENSE_SCHEMA: {
    type: string;
    additionalProperties: boolean;
    minProperties: number;
    properties: {
        negate_debuff: {
            const: boolean;
        };
        damage_cap: {
            type: string;
            minimum: number;
        };
        prevent_hp_loss: {
            const: boolean;
        };
        retaliate_attack: {
            anyOf: ({
                type: string;
                minimum: number;
                const?: undefined;
            } | {
                const: string;
                type?: undefined;
                minimum?: undefined;
            })[];
        };
    };
};
