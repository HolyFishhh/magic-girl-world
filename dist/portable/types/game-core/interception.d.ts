import { type CoreEffectState, type EffectExecutionContext, type EffectProgram } from './effectDsl';
export interface InterceptionRule {
    id: string;
    window: 'before_damage' | 'before_card_play';
    subject?: 'self' | 'opponent';
    priority?: number;
    when?: string;
    card_type?: 'Attack' | 'Skill' | 'Power' | 'Curse' | 'Status';
    damage_kind?: 'attack' | 'effect' | 'damage_over_time' | 'hp_loss' | 'retaliation';
    cancel?: true;
    amount?: number | string;
    replace?: unknown;
    consume_stacks?: number;
    uses_per_turn?: number;
    uses_per_battle?: number;
}
export type InterceptionUsage = Record<string, {
    turn: number;
    turnUses: number;
    battleUses: number;
}>;
export declare const INTERCEPTION_SCHEMA: {
    type: string;
    minItems: number;
    maxItems: number;
    items: {
        type: string;
        additionalProperties: boolean;
        required: string[];
        properties: {
            id: {
                type: string;
                pattern: string;
            };
            window: {
                enum: string[];
            };
            subject: {
                enum: string[];
            };
            priority: {
                type: string;
                minimum: number;
                maximum: number;
            };
            when: {
                type: string;
                minLength: number;
            };
            card_type: {
                enum: string[];
            };
            damage_kind: {
                enum: string[];
            };
            cancel: {
                const: boolean;
            };
            amount: {
                anyOf: ({
                    type: string;
                    minimum: number;
                    minLength?: undefined;
                } | {
                    type: string;
                    minLength: number;
                    minimum?: undefined;
                })[];
            };
            replace: {
                $ref: string;
            };
            consume_stacks: {
                type: string;
                minimum: number;
                maximum: number;
            };
            uses_per_turn: {
                type: string;
                minimum: number;
                maximum: number;
            };
            uses_per_battle: {
                type: string;
                minimum: number;
                maximum: number;
            };
        };
        oneOf: {
            required: string[];
        }[];
        allOf: ({
            if: {
                properties: {
                    window: {
                        const: string;
                    };
                };
            };
            then: {
                not: {
                    anyOf: {
                        required: string[];
                    }[];
                    required?: undefined;
                };
            };
        } | {
            if: {
                properties: {
                    window: {
                        const: string;
                    };
                };
            };
            then: {
                not: {
                    required: string[];
                    anyOf?: undefined;
                };
            };
        })[];
    };
};
export declare function validateInterceptions(value: unknown, creates?: unknown): string | null;
export interface PendingResolution {
    window: InterceptionRule['window'];
    subjectId: string;
    subjectSide: 'player' | 'enemy';
    amount: number;
    turn: number;
    damageKind?: string;
    cardType?: string;
    context?: Partial<EffectExecutionContext>;
}
export interface InterceptionSource {
    key: string;
    holderId: string;
    side: 'player' | 'enemy';
    rule: InterceptionRule;
    read(): {
        stacks: number;
        usage?: InterceptionUsage;
    } | undefined;
    state(): CoreEffectState;
    saveUsage(usage: InterceptionUsage): void;
    consume(stacks: number): Promise<void>;
    execute(program: EffectProgram, context: EffectExecutionContext): Promise<void>;
    creates?: unknown;
    present(): void;
}
/** One bounded window; nested replacement effects cannot re-enter an active rule. */
export declare function resolveInterceptions(pending: PendingResolution, sources: InterceptionSource[], active?: Set<string>): Promise<{
    amount: number;
    cancelled: boolean;
}>;
export declare function describeInterceptions(value: unknown, describe: {
    formula(v: unknown): string;
    condition(v: unknown): string;
    effects(v: unknown): string;
}): string[];
export declare const INTERCEPTION_CONTRACT = "\u72B6\u6001\u6839\u90E8 intercepts:[{id,window:\"before_damage\"\u6216\"before_card_play\",subject?:\"self\"(\u9ED8\u8BA4)\u6216\"opponent\",priority?:\u6574\u6570,when?:\u901A\u7528\u6761\u4EF6,card_type?:Attack/Skill/Power/Curse/Status,damage_kind?:attack/effect/damage_over_time/hp_loss/retaliation,cancel?:true,amount?:\u6570\u503C\u6216\u7B97\u672F\u516C\u5F0F,replace?:\u6D45\u5C42effects,consume_stacks?:\u6B63\u6574\u6570,uses_per_turn?:\u6B63\u6574\u6570,uses_per_battle?:\u6B63\u6574\u6570}]\u3002cancel/amount/replace \u6070\u9009\u4E00\u9879\u3002\u51FA\u724C\u7A97\u53E3\u53EA\u652F\u6301 cancel/replace \u548C card_type\uFF1B\u4F24\u5BB3\u7A97\u53E3\u53EA\u652F\u6301 damage_kind \u548C\u4E09\u79CD\u7ED3\u679C\u3002\u9AD8\u4F18\u5148\u7EA7\u5148\uFF0C\u540C\u4F18\u5148\u7EA7\u6309\u6301\u6709\u8005/\u72B6\u6001/\u89C4\u5219ID\u6392\u5E8F\uFF0C\u53D6\u6D88/\u66FF\u6362\u505C\u6B62\u8BE5\u6B21\u7A97\u53E3\u3002pending_amount \u662F\u5F53\u524D\u5305\u4F24\u5BB3\uFF1B\u51FA\u724C\u7A97\u53E3\u53EF\u8BFB event_paid_energy/total/resource\u53CAevent_paid_hp/discard/sacrifices\uFF0C\u91CD\u653E\u8FD9\u4E9B\u652F\u4ED8\u91CF\u4E3A0\u3002self/opponent/stacks \u4EE5\u72B6\u6001\u6301\u6709\u8005\u4E3A\u57FA\u51C6\uFF1Bsubject:opponent\u4F5C\u7528\u4E8E\u53E6\u4E00\u9635\u8425\u3002\u654C\u4EBA\u7684\u88AB\u52A8\u53CD\u5236\u53EF\u7528\u5F00\u573A\u8D4B\u4E88\u6B64\u72B6\u6001\uFF1B\u53EC\u5524\u7269\u6301\u6709\u65F6 self \u4EC5\u7CBE\u786E\u53EC\u5524\u5B9E\u4F8B\u3002\u4F24\u5BB3\u7A97\u53E3\u5728\u4FDD\u62A4/\u53EC\u5524\u62E6\u622A\u53CA\u51CF\u4F24\u4E4B\u540E\u3001\u65E0\u5B9E\u4F53/\u683C\u6321/\u7F13\u51B2\u4E4B\u524D\uFF0C\u5305\u542B\u751F\u547D\u6D41\u5931\u4F46\u4E0D\u5305\u542B\u652F\u4ED8\u751F\u547D\u8D39\u7528\uFF1B\u66FF\u6362\u7A0B\u5E8F\u5148\u6267\u884C\uFF0C\u539F\u4F24\u5BB3\u5F52\u96F6\u3002\u51FA\u724C\u7A97\u53E3\u5728\u4ED8\u8D39\u548C\u8D39\u7528\u89E6\u53D1\u4E4B\u540E\u3001\u6BCF\u6B21\u5361\u724C\u6548\u679C\u4E4B\u524D\uFF1B\u53D6\u6D88\u4E0D\u9000\u8D39\u3001\u4E0D\u53D6\u6D88\u51FA\u724C\u4E8B\u4EF6/\u79BB\u624B\uFF0C\u4E0D\u7B49\u4E8E\u53D6\u6D88\u73A9\u5BB6\u9009\u724C\u3002\u53EA\u6709\u73A9\u5BB6\u6253\u51FA\u7684\u5361\uFF08\u542B\u81EA\u52A8/\u91CD\u653E\uFF09\u6709\u51FA\u724C\u7A97\u53E3\uFF0C\u654C\u65B9\u610F\u56FE\u4E0D\u662F\u5361\u724C\u3002\u6B21\u6570\u6309\u7CBE\u786E\u6301\u6709\u72B6\u6001\u5B9E\u4F8B\u8BB0\u5F55\uFF0C\u79FB\u9664\u540E\u91CD\u65B0\u8D4B\u4E88\u91CD\u65B0\u8BA1\u6570\uFF0C\u590D\u5236/\u8F6C\u79FB\u4E0D\u590D\u5236\u4F7F\u7528\u8BB0\u5F55\uFF1B\u65E0\u9700\u5F3A\u5236\u6B21\u6570\u4E0A\u9650\uFF0C\u6309\u8BBE\u8BA1\u5E73\u8861\u51B3\u5B9A\u3002\u6D3B\u8DC3\u89C4\u5219\u7981\u6B62\u81EA\u9012\u5F52\uFF0C\u6574\u4E2A\u7A97\u53E3\u5D4C\u5957\u81F3\u591A32\u5C42\u3002";
