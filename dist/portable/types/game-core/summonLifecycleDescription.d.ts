/** modifySummonEffectPrograms rewrites current programs; it installs no expiry. */
export declare const SUMMON_EFFECT_REWRITE_LIFETIME = "\u6539\u5199\u73B0\u6709\u884C\u52A8\u4E0E\u80FD\u529B\uFF0C\u653B\u51FB\u540E\u6216\u56DE\u5408\u7ED3\u675F\u4E0D\u4F1A\u81EA\u52A8\u6062\u590D\uFF1B\u56FA\u5B9A\u6548\u679C\u9664\u5916";
export interface SummonSlotLifecycleDescriptionInput {
    slot?: string;
    hasHp?: boolean;
    maxHp?: number;
    onExisting?: string;
    onDefeated?: string;
    customRepeat?: boolean;
}
/** Program rules only: shared by compact authoring and compiled effect tags. */
export declare function describeSummonSlotLifecycle(input: SummonSlotLifecycleDescriptionInput): string;
