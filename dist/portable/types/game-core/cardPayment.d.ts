import { type CardCost, type CardResourcePayment, type CardResourceWaiver } from './combatResource';
export interface ExtraCardCost {
    hp?: number;
    discard?: {
        count: number;
        card_type?: string;
        tag?: string;
    };
    sacrifice?: {
        count: number;
        template_id?: string;
    };
}
export interface CardPaymentSpec {
    additional?: ExtraCardCost;
    alternatives?: (ExtraCardCost & {
        id: string;
        name: string;
        cost: CardCost;
    })[];
}
export interface PaymentCard {
    id: string;
    name?: string;
    type?: string;
    tags?: string[];
    cost?: CardCost;
    payment?: CardPaymentSpec;
    xValueBonus?: number;
}
export interface PaymentSummon {
    instanceId: string;
    templateId: string;
    name?: string;
    currentHp: number;
    hasHp?: boolean;
}
export interface PaymentState {
    hp?: number;
    hand: readonly PaymentCard[];
    summons?: readonly PaymentSummon[];
    resources: Readonly<Record<string, number>>;
}
export interface CardPaymentPlan {
    id: string;
    name: string;
    extra: ExtraCardCost;
    payment: CardResourcePayment;
    affordable: boolean;
    discardCandidates: PaymentCard[];
    sacrificeCandidates: PaymentSummon[];
}
export interface CardPaymentSelection {
    optionId: string;
    discardIds: string[];
    sacrificeIds: string[];
}
/** Validation coverage only: the selected option still pays exactly its own cost. */
export declare function paymentCostComponents(card: {
    cost?: CardCost;
    payment?: CardPaymentSpec;
}): Record<string, number | 'all'>;
export declare function validateCardPayment(value: unknown): string | null;
export declare function cardPaymentPlans(card: PaymentCard, state: PaymentState, waiver?: CardResourceWaiver): CardPaymentPlan[];
export declare function defaultPaymentSelection(plan: CardPaymentPlan): CardPaymentSelection;
export declare function validPaymentSelection(plan: CardPaymentPlan, selected: unknown): selected is CardPaymentSelection;
export declare function describeExtraCardCost(extra: ExtraCardCost, summonNames?: Record<string, string>): string;
export declare function describeCardPayment(value: unknown, resourceNames?: Readonly<Record<string, string>>, summonNames?: Record<string, string>, resourceEmojis?: Readonly<Record<string, string>>): string[];
export declare const CARD_PAYMENT_CONTRACT = "\u5361\u724C\u548C\u5361\u724C\u6A21\u677F\u6839\u90E8 payment \u652F\u6301 additional:{hp:\u6B63\u6574\u6570,discard:{count:\u6B63\u6574\u6570,card_type?:Attack/Skill/Power/Curse/Status,tag?:\u6807\u7B7E},sacrifice:{count:\u6B63\u6574\u6570,template_id?:\u53EC\u5524\u6A21\u677FID}}\uFF0C\u4EE5\u53CA alternatives:[{id:\u552F\u4E00ID(\u4E0D\u80FDnormal),name:\u5267\u60C5\u540D\u79F0,cost:\u6807\u51C6\u8D39\u7528,...\u989D\u5916\u8D39\u7528\u5B57\u6BB5}]\u3002additional \u52A0\u5728\u901A\u5E38\u52A8\u6001 cost \u4E0A\uFF1B\u6BCF\u4E2A alternatives \u5B8C\u6574\u66FF\u6362\u901A\u5E38\u8D44\u6E90\u548C\u989D\u5916\u8D39\u7528\uFF0C\u4E0D\u7EE7\u627F additional\u3002\u66FF\u4EE3\u65B9\u6848\u5185\u90E8\u7684\u751F\u547D\u3001\u5F03\u724C\u4E0E\u732E\u796D\u8D39\u7528\u5FC5\u987B\u76F4\u63A5\u4E0Eid/name/cost\u540C\u5C42\u5199hp/discard/sacrifice\uFF0C\u4E0D\u80FD\u5D4C\u5957additional\uFF1B\u4F8B\u5982 payment:{\"alternatives\":[{\"id\":\"magic\",\"name\":\"\u6D88\u8017\u80FD\u91CF\",\"cost\":2},{\"id\":\"blood\",\"name\":\"\u4EE5\u8840\u65BD\u6CD5\",\"cost\":1,\"hp\":6}]}\u3002\u73A9\u5BB6\u4ECE\u53EF\u652F\u4ED8\u65B9\u6848\u4E2D\u9009\u62E9\uFF0C\u518D\u9009\u7CBE\u786E\u5F03\u724C/\u732E\u796D\u5B9E\u4F8B\uFF1B\u53D6\u6D88\u6574\u6B21\u51FA\u724C\u65E0\u6D88\u8017\u3002HP\u76F4\u63A5\u6263\u9664\u4E14\u81F3\u5C11\u4FDD\u75591\u70B9\uFF0C\u4E0D\u662F\u4F24\u5BB3\uFF1B\u5F03\u724C\u4E0D\u80FD\u9009\u6B63\u6253\u51FA\u7684\u724C\uFF0C\u89E6\u53D1\u6B63\u5E38\u5F03\u724C\u542B\u7075\u5DE7/\u9057\u5F03/\u9057\u5FD8\uFF1B\u732E\u796D\u6267\u884C\u79BB\u573A/\u88AB\u51FB\u8D25\u89E6\u53D1\uFF0C\u4E0D\u7559\u5C38\u4F53\u3002\u5168\u90E8\u8D39\u7528\u5148\u540C\u65F6\u6263\u9664\u518D\u89E6\u53D1\u6536\u76CA\uFF0C\u4E0D\u5F97\u7528\u8D39\u7528\u89E6\u53D1\u6536\u76CA\u652F\u4ED8\u672C\u6B21\u8D39\u7528\u3002\u514D\u8D39\u53EA\u8C41\u514D\u8D44\u6E90\u8D39\u7528\uFF0C\u81EA\u52A8\u6253\u51FA\u9009\u62E9\u9996\u4E2A\u53EF\u652F\u4ED8\u65B9\u6848\u53CA\u7B26\u5408\u6761\u4EF6\u7684\u9996\u6279\u5B9E\u4F8B\uFF1B\u91CD\u653E\u4EC5\u9996\u6B21\u4ED8\u8D39\u3002\u5B9E\u9645\u80FD\u91CF/\u8D44\u6E90\u7EDF\u8BA1\u4E0D\u6DF7\u5165\u751F\u547D\u6216\u5B9E\u4F8B\u6570\u91CF\u3002";
