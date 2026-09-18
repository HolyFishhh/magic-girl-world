/** Mechanism predicates inspect related executable fields on the same node. */
export interface FoundationEvidence {
    kind: string;
    text: string;
    operations: Set<string>;
    triggers: Set<string>;
}
export declare function matchTowerFoundation(id: string, entry: FoundationEvidence): boolean | undefined;
