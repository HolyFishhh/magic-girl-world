export interface ContentRepairIssueInput {
  path: string;
  code?: string;
}

const MARKER_PATTERN = /^\[[\u3400-\u9fffA-Za-z0-9_-]{1,32}\]$/;
const STABLE_PATH_PREFIX = /^[A-Za-z_][A-Za-z0-9_-]*(?:\[\d+\])?(?:\.[A-Za-z_][A-Za-z0-9_-]*(?:\[\d+\])?)*/;
const STABLE_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;
const REPAIR_PATH_ROOTS = new Set([
  'battle',
  'variables',
  'content',
  'cards',
  'statuses',
  'relics',
  'items',
  'abilities',
  'activeStatuses',
  'enemy',
  'desireEffects',
]);

function stableRepairPath(value: unknown): string | null {
  const path = typeof value === 'string' ? value.trim() : '';
  const match = path.match(STABLE_PATH_PREFIX)?.[0] || '';
  const root = match.split(/[.[]/, 1)[0];
  return match.length > 0 && REPAIR_PATH_ROOTS.has(root) ? match : null;
}

function stableRepairCode(value: unknown): string | null {
  const code = typeof value === 'string' ? value.trim() : '';
  return STABLE_CODE_PATTERN.test(code) ? code : null;
}

function boundedRepairEntries(
  issues: readonly ContentRepairIssueInput[],
  limit: number,
): {
  shown: string[];
  hidden: number;
} {
  const maximum = Number.isInteger(limit) ? Math.max(1, Math.min(8, limit)) : 4;
  const entries: string[] = [];
  for (const issue of issues) {
    const path = stableRepairPath(issue.path);
    if (!path) continue;
    const code = stableRepairCode(issue.code);
    const entry = code ? `${path}(${code})` : path;
    if (!entries.includes(entry)) entries.push(entry);
  }
  return { shown: entries.slice(0, maximum), hidden: Math.max(0, entries.length - maximum) };
}

/** Format a user-visible diagnostic without echoing AI-controlled names or text. */
export function formatBoundedContentIssueSummary(issues: readonly ContentRepairIssueInput[], limit = 4): string {
  const { shown, hidden } = boundedRepairEntries(issues, limit);
  if (shown.length === 0) return '内容不符合战斗契约';
  return `${shown.join('；')}${hidden > 0 ? `；另有 ${hidden} 项` : ''}`;
}

/** Build a bounded repair marker without echoing AI-controlled names or text. */
export function formatBoundedContentRepairPrompt(
  marker: string,
  issues: readonly ContentRepairIssueInput[],
  limit = 4,
): string {
  if (!MARKER_PATTERN.test(marker)) throw new Error('repair marker is invalid');
  const { shown, hidden } = boundedRepairEntries(issues, limit);
  if (shown.length === 0) return marker;
  const remainder = hidden > 0 ? `,+${hidden}` : '';
  return `${marker}\n问题=${shown.join(',')}${remainder}`;
}
