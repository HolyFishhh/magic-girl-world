export type DamageProtectionMode = 'intercept' | 'share_damage';
export type DamageProtectionScope = 'specific' | 'all_allies';
/** Continuous protection granted by an ability or a status. Exact IDs never resolve through active-enemy aliases. */
export interface DamageProtectionRule {
    mode: DamageProtectionMode;
    scope: DamageProtectionScope;
    targetId?: string;
    priority?: number;
}
export declare function normalizeDamageProtectionRule(value: unknown): DamageProtectionRule | null;
export interface DamageProtectionDescriptionOptions {
    /** Resolve a stable runtime target ID to its scoped visible name when available. */
    resolveTargetName?: (targetId: string) => string | undefined;
}
export declare function damageProtectionRuleDescription(rule: DamageProtectionRule, options?: DamageProtectionDescriptionOptions): string;
/** Shared public-contract clauses. The protocol assembler owns placement in the full prompt. */
export declare const DAMAGE_PROTECTION_AUTHORING_CLAUSES: readonly ["protection 仅对敌方同队成员生效，只能写在敌人能力或供敌人持有的状态定义上：{mode:\"intercept\"|\"share_damage\",scope:\"specific\"|\"all_allies\",target_id?,priority?}。specific 必须给敌方运行时实例 ID；all_allies 不得带 target_id。", "protection 仅处理攻击伤害。intercept 按 priority、再持有者稳定 ID 转交给存活保护者，倒下后的余伤继续转交，最后才落到原目标；share_damage 保留总伤害：specific 在原目标与匹配持有者间均分，all_allies 在该队所有存活成员间均分；不会把当前生命值设为平均。", "敌方指定保护始终按 target_id 精确绑定；目标离场或 ID 不存在时该规则不生效，绝不回退到 active enemy、位置或名称。"];
/** Inline schema shared by generation projections and finite repair slots. */
export declare const DAMAGE_PROTECTION_SCHEMA: {
    readonly type: "object";
    readonly additionalProperties: false;
    readonly required: readonly ["mode", "scope"];
    readonly properties: {
        readonly mode: {
            readonly enum: readonly ["intercept", "share_damage"];
        };
        readonly scope: {
            readonly enum: readonly ["specific", "all_allies"];
        };
        readonly target_id: {
            readonly type: "string";
            readonly pattern: "^[A-Za-z_][A-Za-z0-9_]*$";
        };
        readonly priority: {
            readonly type: "integer";
        };
    };
    readonly allOf: readonly [{
        readonly if: {
            readonly properties: {
                readonly scope: {
                    readonly const: "specific";
                };
            };
            readonly required: readonly ["scope"];
        };
        readonly then: {
            readonly required: readonly ["target_id"];
        };
    }, {
        readonly if: {
            readonly properties: {
                readonly scope: {
                    readonly const: "all_allies";
                };
            };
            readonly required: readonly ["scope"];
        };
        readonly then: {
            readonly not: {
                readonly required: readonly ["target_id"];
            };
        };
    }];
};
export declare function isEmptyProtectionEffect(value: unknown): boolean;
