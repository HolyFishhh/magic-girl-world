import { auditInitialSemanticStructure, type InitialSemanticFact } from './initialSemanticAudit';

/** Request-owned necessary conditions, never inferred from generated descriptions.
 * This first layer detects missing structural candidates; it cannot prove timing,
 * availability, effect magnitude, loops, or complete free-text satisfaction. */
export interface InitialRequirementProbe {
  id: string;
  kind: 'stance_entry' | 'resource_accumulate' | 'resource_consume' | 'card_generation' | 'discard' | 'recover' | 'discard_or_recover' | 'status_lifecycle';
  actor: string;
  resourceId?: string;
  /** An explicitly requested status-local entry, not a ban on equivalent
   * artifact/ability listeners. Do not infer this probe from arbitrary prose. */
  statusId?: string;
  lifecycle?: 'apply' | 'stack' | 'tick' | 'remove';
}
export interface InitialRequirementEvidence {
  id: string;
  status: 'missing_candidate' | 'candidate_present_unverified' | 'unverified';
  candidates: InitialSemanticFact[];
}

/** No writes, model calls, guessed implementation, or readiness verdict. */
export function inspectInitialRequirementCandidates(input: unknown, probes: readonly InitialRequirementProbe[]) {
  const report = auditInitialSemanticStructure(input);
  const validKinds = new Set(['stance_entry', 'resource_accumulate', 'resource_consume', 'card_generation', 'discard', 'recover', 'discard_or_recover', 'status_lifecycle']);
  const results: InitialRequirementEvidence[] = probes.map(probe => {
    if (!report.inspected || report.truncated || report.references.length || !validKinds.has(probe.kind))
      return { id: probe.id, status: 'unverified', candidates: [] };
    if (probe.kind === 'status_lifecycle' && (typeof probe.statusId !== 'string' || !probe.statusId.trim()
      || !['apply', 'stack', 'tick', 'remove'].includes(probe.lifecycle || '')))
      return { id: probe.id, status: 'unverified', candidates: [] };
    const candidates = report.facts.filter(fact => {
      if (fact.actor !== probe.actor) return false;
      if (probe.kind === 'status_lifecycle') return fact.kind === 'status_listener'
        && fact.statusId === probe.statusId && fact.id === probe.lifecycle;
      if (probe.kind === 'stance_entry' || probe.kind === 'card_generation' || probe.kind === 'discard' || probe.kind === 'recover') return fact.kind === probe.kind;
      if (probe.kind === 'discard_or_recover') return fact.kind === 'discard' || fact.kind === 'recover';
      if (probe.resourceId !== undefined && fact.id !== probe.resourceId) return false;
      // Assignments and formulas may or may not consume/accumulate. Keep them
      // as candidates, never evaluate or promote them to confirmed behavior.
      if (fact.kind === 'resource_set') return true;
      if (fact.kind === 'resource_delta') return typeof fact.value === 'string'
        || (typeof fact.value === 'number' && (probe.kind === 'resource_consume' ? fact.value < 0 : fact.value > 0));
      return probe.kind === 'resource_consume' && fact.kind === 'resource_payment'
        && (typeof fact.value === 'string' || (typeof fact.value === 'number' && fact.value > 0));
    });
    return { id: probe.id, status: candidates.length ? 'candidate_present_unverified'
      : report.unexpandedPaths.length ? 'unverified' : 'missing_candidate', candidates };
  });
  // A report without facts can also mean an invalid envelope, not absent mechanics.
  // The compiler owns shape validation; a successful inspection is required.
  return { results, structurallyTruncated: report.truncated, unexpandedPaths: report.unexpandedPaths, overallVerified: false as const };
}
