export const MVU_INITIALIZATION_SCAN_ID = 'mwg-initialization-worldbook-scan';

/** Activation is based on actual state, never on a phrase in narrative text. */
export function needsMvuInitializationRules(variables: unknown, firstAssistantFloor: boolean): boolean {
  if (!firstAssistantFloor || !variables || typeof variables !== 'object') return false;
  const stat = (variables as Record<string, any>).stat_data;
  const battle = stat?.battle;
  if (!battle || typeof battle !== 'object' || Array.isArray(battle)) return false;
  // Nonempty or malformed existing content belongs to repair, not initialization.
  return battle.cards == null || Array.isArray(battle.cards) && battle.cards.length === 0;
}

export function createMvuInitializationScanPrompt(filter: () => boolean) {
  return {
    id: MVU_INITIALIZATION_SCAN_ID,
    position: 'none' as const,
    depth: 0,
    role: 'system' as const,
    content: '<CHARACTER_INIT_PENDING>',
    should_scan: true,
    filter,
  };
}
