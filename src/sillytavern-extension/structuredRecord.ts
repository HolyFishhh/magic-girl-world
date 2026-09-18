import { jsonrepair } from 'jsonrepair';
import { removeImpossibleJsonClosers } from '../game-core/towerRequest';
import { assertNoInventedJsonValues, assertUnambiguousObjectJson } from '../game-core/jsonObjectIntegrity';

const isRecord = (value: unknown): value is Record<string, any> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

function decodeCandidate(source: string): Record<string, any> | undefined {
  let parsed: unknown;
  try { parsed = JSON.parse(source); } catch { return; }
  if (!isRecord(parsed)) return;
  // Outside the syntax catch: ambiguity must reach the caller's one recovery
  // budget, not fall through to a different candidate that hides data loss.
  assertUnambiguousObjectJson(source);
  return parsed;
}

/** The existing structured-response parser, shared by text and tool arguments.
 * Syntax recovery never replaces the caller's full gameplay/commit validation.
 */
export function parseStructuredRecord(value: string | Record<string, any>): Record<string, any> {
  if (isRecord(value)) return value;
  const source = String(value || '').trim();
  const unfenced = source.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1]?.trim() || source;
  const candidates = [unfenced];
  const firstBrace = unfenced.indexOf('{');
  const lastBrace = unfenced.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) candidates.push(unfenced.slice(firstBrace, lastBrace + 1));
  for (const source of Array.from(new Set(candidates))) {
    const repairCandidates = Array.from(new Set([source, removeImpossibleJsonClosers(source)]));
    for (const candidate of repairCandidates) {
      const parsed = decodeCandidate(candidate);
      if (parsed) return parsed;
    }
    for (const candidate of repairCandidates) {
      let repaired: string;
      try { repaired = jsonrepair(candidate); } catch { continue; }
      const parsed = decodeCandidate(repaired);
      if (parsed) {
        assertNoInventedJsonValues(candidate, repaired);
        return parsed;
      }
    }
  }
  const shape = !source ? '空响应，0 字符'
    : Array.isArray(value) ? '数组响应，不是对象'
      : `文本 ${source.length} 字符${firstBrace < 0 ? '，没有 JSON 对象起始符' : ''}`;
  throw new Error(`结构化后台没有返回合法 JSON（${shape}）`);
}
