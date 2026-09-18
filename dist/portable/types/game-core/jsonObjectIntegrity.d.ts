/** Inspect already valid JSON before object decoding can hide duplicate keys.
 * Strings are data, including escaped property names. No gameplay inference.
 */
export declare function assertUnambiguousObjectJson(source: string): void;
export declare function assertNoInventedJsonValues(source: string, repaired: string): void;
