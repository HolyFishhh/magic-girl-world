import { parseNonCombatSettlement } from './nonCombatSettlement';

export type ArtifactAcquisitionCandidateCategory = 'cards' | 'items';

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function artifactAcquisitionCandidateEntries(value: Record<string, unknown>): Array<{ category: ArtifactAcquisitionCandidateCategory; value: unknown }> {
  if (!record(value.on_acquire)) return [];
  const settlement = value.on_acquire;
  const entries: Array<{ category: ArtifactAcquisitionCandidateCategory; value: unknown }> = [];
  if (Array.isArray(settlement.gain_cards)) entries.push(...settlement.gain_cards.map(value => ({ category: 'cards' as const, value })));
  if (record(settlement.grant)) {
    if (Array.isArray(settlement.grant.cards)) entries.push(...settlement.grant.cards.map(value => ({ category: 'cards' as const, value })));
    if (Array.isArray(settlement.grant.items)) entries.push(...settlement.grant.items.map(value => ({ category: 'items' as const, value })));
  }
  if (Array.isArray(settlement.deck_actions)) for (const action of settlement.deck_actions) {
    if (record(action) && action.kind === 'transform' && action.replacement !== undefined)
      entries.push({ category: 'cards', value: action.replacement });
  }
  return entries;
}

/** Shared structural/resource boundary for every owned relic acquisition. */
export function validateArtifactAcquisitionContract(
  value: Record<string, unknown>,
  options: { knownResourceIds?: Iterable<string>; validateCandidate?: (category: ArtifactAcquisitionCandidateCategory, value: unknown) => string | null } = {},
): string | null {
  if (value.on_acquire === undefined) return null;
  try { parseNonCombatSettlement(value.on_acquire); }
  catch (error) { return `on_acquire: ${error instanceof Error ? error.message : '无效获得时结算'}`; }
  const settlement = value.on_acquire as Record<string, unknown>;
  if (record(settlement.grant) && Object.hasOwn(settlement.grant, 'artifacts')) return 'on_acquire.grant 不允许 artifacts，避免遗物获得递归';
  if (options.knownResourceIds) {
    const known = new Set(['energy', ...options.knownResourceIds]);
    const referenced = [
      ...(record(settlement.resources) ? Object.keys(settlement.resources) : []),
      ...(record(settlement.cost) && record(settlement.cost.resources) ? Object.keys(settlement.cost.resources) : []),
    ];
    const missing = referenced.filter(id => !known.has(id));
    if (missing.length) return `on_acquire 引用了未注册资源: ${[...new Set(missing)].sort().join(', ')}`;
  }
  for (const entry of artifactAcquisitionCandidateEntries(value)) {
    const message = options.validateCandidate?.(entry.category, entry.value);
    if (message) return `on_acquire.${entry.category}: ${message}`;
  }
  return null;
}
