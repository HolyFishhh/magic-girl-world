const MAX_LOCATION_LENGTH = 48;
const MAX_ACTION_LENGTH = 48;
const MAX_TRACKED_NPCS = 2;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function compactText(value: unknown, maximum: number): string {
  const text = String(value ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= maximum) return text;
  return `${text.slice(0, Math.max(0, maximum - 1))}…`;
}

function booleanValue(value: unknown): boolean {
  return value === true || value === 'true' || value === 1;
}

export interface WorldContinuitySummary {
  location: string | null;
  invasion: number | null;
  trackedNpcs: Array<{ id: string; name: string; currentAction: string }>;
}

/** Read a bounded host-neutral continuity summary from an existing stat root. */
export function summarizeWorldContinuity(value: unknown): WorldContinuitySummary {
  const stat = isRecord(value) ? value : {};
  const status = isRecord(stat.status) ? stat.status : {};
  const factions = isRecord(stat.factions) ? stat.factions : {};
  const npcs = isRecord(stat.npcs) ? stat.npcs : {};
  const rawInvasion = Number(factions.invasion);
  const invasion = Number.isInteger(rawInvasion) && rawInvasion >= 0 && rawInvasion <= 7 ? rawInvasion : null;
  const trackedNpcs = Object.entries(npcs)
    .filter(([id, npc]) => id !== '$meta' && isRecord(npc) && booleanValue(npc.tracking))
    .map(([id, npc]) => {
      const entry = npc as Record<string, unknown>;
      return {
        id: compactText(id, 32),
        name: compactText(entry.name, 24),
        currentAction: compactText(entry.current_action, MAX_ACTION_LENGTH),
      };
    })
    .filter(npc => npc.id && npc.name)
    .sort((left, right) => left.id.localeCompare(right.id))
    .slice(0, MAX_TRACKED_NPCS);
  return {
    location: compactText(status.location, MAX_LOCATION_LENGTH) || null,
    invasion,
    trackedNpcs,
  };
}

/** Give node generation only the most actionable existing world facts. */
export function formatWorldContinuityHint(value: unknown): string | null {
  const summary = summarizeWorldContinuity(value);
  const parts: string[] = [];
  if (summary.location) parts.push(`地点“${summary.location}”`);
  if (summary.invasion !== null) parts.push(`长期威胁${summary.invasion}/7`);
  if (summary.trackedNpcs.length > 0) {
    const npcs = summary.trackedNpcs
      .map(npc => `${npc.name}[${npc.id}]${npc.currentAction ? `：${npc.currentAction}` : ''}`)
      .join('；');
    parts.push(`承接人物 ${npcs}`);
  }
  return parts.length > 0 ? `[世界连续性] ${parts.join('；')}` : null;
}
