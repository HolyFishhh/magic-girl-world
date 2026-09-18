/** Presentation is derived from held executable statuses, never persisted over the base portrait.
 * Existing array order is acquisition order; re-stacking does not steal priority.
 * A Power/ability can grant an appearance status through its ordinary apply_status effect.
 */
export declare function resolveCharacterEmoji(entity: {
    emoji?: string;
    statusEffects?: readonly {
        id: string;
        stacks: number;
    }[];
}, definition: (id: string) => {
    character_emoji?: string;
} | undefined, fallback?: string): string;
export declare const CHARACTER_EMOJI_SCHEMA: {
    readonly type: "string";
    readonly minLength: 1;
    readonly maxLength: 32;
};
