/** Read the same authoritative battle used by activation validation. Never
 * reconstruct definitions from a rejected response, especially malformed JSON.
 * No gameplay defaults, truncation, registry mutation, or acceptance changes.
 */
export declare function formatTowerRepairDefinitionContext(battle: unknown): string;
