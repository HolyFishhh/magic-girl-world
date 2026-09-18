/** Validate action references in their defining enemy scope, including nested reinforcements. */
export declare function validateEnemyActionReferences(enemy: Record<string, any>, path: string): {
    path: string;
    code: string;
    message: string;
}[];
