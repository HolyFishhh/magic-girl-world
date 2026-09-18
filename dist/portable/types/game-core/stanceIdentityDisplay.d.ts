/** Resolve labels from actual compact/compiled stance definitions, never prose. */
export declare function collectStanceNames(...roots: unknown[]): Record<string, string>;
/** Collect executable stance definitions from the whole visible content scope. */
export declare function collectStanceDefinitions(...roots: unknown[]): Record<string, Record<string, unknown>>;
export declare function describeStanceIdentity(holder: string, relation: 'eq' | 'neq', id: string | null, names?: Readonly<Record<string, string>>): string;
/** Parentheses and reversed operands must not bypass identity-label rendering. */
export declare function describeStanceFormula(source: string, names?: Readonly<Record<string, string>>, labels?: {
    selfLabel?: string;
    opponentLabel?: string;
}): string;
