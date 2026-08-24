export interface DescriptionEffectDiagnostic {
    field: string;
    described: number;
    actual: number;
    message: string;
}
/** Check only unambiguous literals; complex prose, formulas and repeated operations are skipped. */
export declare function diagnoseDescriptionEffects(value: unknown): DescriptionEffectDiagnostic[];
