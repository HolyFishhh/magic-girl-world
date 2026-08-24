import { normalizeCompactEffectEntries } from './compactEffectContract';

export interface DescriptionEffectDiagnostic {
  field: string;
  described: number;
  actual: number;
  message: string;
}

interface MetricRule {
  field: string;
  label: string;
  pattern: RegExp;
}

const METRICS: MetricRule[] = [
  { field: 'damage', label: '伤害', pattern: /造成\s*(\d+(?:\.\d+)?)\s*点?(?:生命)?伤害/gi },
  { field: 'block', label: '格挡', pattern: /(?:获得|得到)\s*(\d+(?:\.\d+)?)\s*点?格挡/gi },
  { field: 'heal', label: '治疗', pattern: /(?:恢复|回复|治疗)\s*(\d+(?:\.\d+)?)\s*点?(?:生命(?:值)?|HP)?/gi },
  { field: 'draw', label: '抽牌', pattern: /抽(?:取)?\s*(\d+(?:\.\d+)?)\s*张(?:牌)?/gi },
  { field: 'energy', label: '能量', pattern: /(?:获得|恢复|回复)\s*(\d+(?:\.\d+)?)\s*点?能量/gi },
  { field: 'lust_damage', label: '欲望增加', pattern: /(?:增加|造成)\s*(\d+(?:\.\d+)?)\s*点?欲望/gi },
  { field: 'lust_heal', label: '欲望降低', pattern: /(?:降低|减少)\s*(\d+(?:\.\d+)?)\s*点?欲望/gi },
  { field: 'discard', label: '弃牌', pattern: /弃(?:掉|置)?\s*(\d+(?:\.\d+)?)\s*张(?:牌)?/gi },
  { field: 'exhaust', label: '消耗牌', pattern: /消耗\s*(\d+(?:\.\d+)?)\s*张(?:牌)?/gi },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Check only unambiguous literals; complex prose, formulas and repeated operations are skipped. */
export function diagnoseDescriptionEffects(value: unknown): DescriptionEffectDiagnostic[] {
  if (!isRecord(value) || typeof value.description !== 'string') return [];
  const entries = normalizeCompactEffectEntries(value.effects);
  if (!entries) return [];
  const description = value.description.trim();
  if (!description) return [];
  const effects = entries.filter(isRecord);
  const diagnostics: DescriptionEffectDiagnostic[] = [];

  for (const metric of METRICS) {
    const claims = Array.from(description.matchAll(metric.pattern), match => Number(match[1])).filter(Number.isFinite);
    const operations = effects.filter(effect => Object.prototype.hasOwnProperty.call(effect, metric.field));
    if (claims.length !== 1 || operations.length !== 1) continue;
    const actual = operations[0][metric.field];
    if (typeof actual !== 'number' || !Number.isFinite(actual) || actual === claims[0]) continue;
    diagnostics.push({
      field: metric.field,
      described: claims[0],
      actual,
      message: `描述写${claims[0]}点${metric.label}，但 effects.${metric.field} 为 ${actual}`,
    });
  }
  return diagnostics;
}
