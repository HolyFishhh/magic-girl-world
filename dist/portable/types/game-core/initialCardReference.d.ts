/** Authoring shorthand only. Saved rewards always contain executable cards. */
export declare const INITIAL_CARD_REFERENCE_SCHEMA: {
    type: string;
    additionalProperties: boolean;
    required: string[];
    description: string;
    properties: {
        card_ref: {
            type: string;
            pattern: string;
        };
        quantity: {
            type: string;
            minimum: number;
            maximum: number;
        };
    };
};
/** No inferred identity, chained references, overrides, or mutation of the library. */
export declare function resolveInitialCardReference(reference: Record<string, any>, cards: unknown[]): Record<string, any> | null;
/** Compile the single-response route before gameplay validation or repair planning. */
export declare function expandInitialOpeningCardReferences<T>(opening: T, player: Record<string, any>): T;
