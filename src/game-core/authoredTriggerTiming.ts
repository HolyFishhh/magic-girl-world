import { ABILITY_TRIGGER_SET, type AbilityTrigger } from './battleTriggers';
import { normalizeCompactEffectEntries } from './compactEffectContract';

export interface AuthoredTriggerTimingIssue {
  code: 'EXPLICIT_TRIGGER_TIMING_MISMATCH' | 'TRIGGER_CLAIM_AUDIT_LIMIT';
  path: string;
  describedTrigger?: AbilityTrigger;
  actualTrigger?: AbilityTrigger;
  claim?: string;
  message: string;
}

// This is a deliberately small literal language, not a natural-language
// compiler. Only a leading, standalone timing claim is actionable. A quote,
// negation, comparison, multiple timings, or an unspecified narrator is not.
const TIMINGS: ReadonlyArray<{ on: AbilityTrigger; prefix: RegExp }> = [
  { on: 'turn_start', prefix: /^(?:在)?每(?:个)?(?:己方|我方)?回合开始(?:时)?(?=[，,:：\s]|获得|得到|造成|恢复|回复|抽|施加)/ },
  { on: 'turn_end', prefix: /^(?:在)?每(?:个)?(?:己方|我方)?回合结束(?:时)?(?=[，,:：\s]|获得|得到|造成|恢复|回复|抽|施加)/ },
  { on: 'battle_start', prefix: /^(?:在)?(?:本场)?战斗开始(?:时)?(?=[，,:：\s]|获得|得到|造成|恢复|回复|抽|施加)/ },
];
const ANOTHER_TIMING = /(?:每(?:个)?(?:己方|我方|敌方)?回合(?:开始|结束)|(?:本场)?战斗(?:开始|结束))/;
const isRecord = (value: unknown): value is Record<string, any> => value !== null && typeof value === 'object' && !Array.isArray(value);
const LITERAL_EFFECT_CLAIMS: ReadonlyArray<{ key: string; pattern: RegExp }> = [
  { key: 'block', pattern: /(?:^|[，,。；;])\s*(?:获得|得到)\s*(\d+(?:\.\d+)?)\s*点?格挡/g },
  { key: 'damage', pattern: /(?:^|[，,。；;])\s*造成\s*(\d+(?:\.\d+)?)\s*点?(?:生命)?伤害/g },
  { key: 'heal', pattern: /(?:^|[，,。；;])\s*(?:恢复|回复)\s*(\d+(?:\.\d+)?)\s*点?生命/g },
  { key: 'draw', pattern: /(?:^|[，,。；;])\s*抽(?:取)?\s*(\d+(?:\.\d+)?)\s*张牌/g },
  { key: 'energy', pattern: /(?:^|[，,。；;])\s*(?:获得|恢复|回复)\s*(\d+(?:\.\d+)?)\s*点?能量/g },
];

function hasMatchingLiteralEffectClaim(value: Record<string, any>, remainder: string): boolean {
  if (/[“”「」『』"‘’]/.test(remainder)
    || /据说|传闻|传说|也许|可能|并非|不会|并不|假象|幻想|回忆|例如|假设/.test(remainder)) return false;
  const entries = normalizeCompactEffectEntries(value.trigger.effects)?.filter(isRecord) || [];
  return LITERAL_EFFECT_CLAIMS.some(rule => {
    const operations = entries.filter(effect => Object.hasOwn(effect, rule.key));
    const claims = [...remainder.matchAll(rule.pattern)];
    return operations.length === 1 && claims.length === 1
      && typeof operations[0][rule.key] === 'number' && Number.isFinite(operations[0][rule.key])
      && operations[0][rule.key] === Number(claims[0][1]);
  });
}

/** Evidence of a contradiction only. Never mutates or synthesizes a trigger. */
export function diagnoseExplicitTriggerTiming(value: unknown, path: string): AuthoredTriggerTimingIssue[] {
  if (!isRecord(value) || typeof value.description !== 'string' || !isRecord(value.trigger)) return [];
  const actual = value.trigger.on;
  if (typeof actual !== 'string' || !ABILITY_TRIGGER_SET.has(actual) || actual === 'passive') return [];
  // An immediate effect plus a future trigger can have a multi-part summary.
  // Leave that case to a richer semantic review rather than selecting a clause.
  if (value.effects !== undefined && value.effects !== null
    && !(Array.isArray(value.effects) && value.effects.length === 0)
    && !(isRecord(value.effects) && Object.keys(value.effects).length === 0)) return [];
  const description = value.description.trim();
  if (!description || description.length > 4096) return [];
  for (const timing of TIMINGS) {
    const matched = description.match(timing.prefix);
    if (!matched || ANOTHER_TIMING.test(description.slice(matched[0].length))) continue;
    if (!hasMatchingLiteralEffectClaim(value, description.slice(matched[0].length))) continue;
    if (actual === timing.on) return [];
    return [{ code: 'EXPLICIT_TRIGGER_TIMING_MISMATCH', path: `${path}.trigger.on`,
      actualTrigger: actual as AbilityTrigger, describedTrigger: timing.on, claim: matched[0],
      message: `description 明确写“${matched[0]}”，但 trigger.on 为 ${actual}；需由 AI 明确修正触发时机为 ${timing.on}，不能改写说明、删除原效果或添加占位来掩盖冲突` }];
  }
  return [];
}

/** Fresh generated content only; this audit is not a migration of old saves. */
export function collectInitialTriggerTimingIssues(input: { player: unknown; opening: unknown }): AuthoredTriggerTimingIssue[] {
  const issues: AuthoredTriggerTimingIssue[] = [];
  const ancestors = new Set<object>();
  let visited = 0;
  let exhausted = false;
  const visit = (value: unknown, path: string, depth: number): void => {
    if (exhausted || value === null || typeof value !== 'object') return;
    if (++visited > 40_000 || depth > 64 || ancestors.has(value)) {
      exhausted = true;
      issues.push({ code: 'TRIGGER_CLAIM_AUDIT_LIMIT', path, message: '生成内容的触发说明审查超过安全大小、深度或出现循环，未完成校验' });
      return;
    }
    ancestors.add(value);
    if (Array.isArray(value)) value.forEach((entry, index) => visit(entry, `${path}[${index}]`, depth + 1));
    else {
      issues.push(...diagnoseExplicitTriggerTiming(value, path));
      for (const [key, child] of Object.entries(value)) {
        if (key !== '$meta') visit(child, `${path}.${key}`, depth + 1);
      }
    }
    ancestors.delete(value);
  };
  visit(input.player, 'player', 0);
  visit(input.opening, 'opening', 0);
  return issues;
}

export function formatAuthoredMechanicDescriptionContract(): string {
  return '卡牌、遗物、道具、状态与能力的实际数值、对象、条件、触发时机及次数由 effects/trigger 等结构字段定义，界面会由程序生成规则说明。可选 description 可省略；若写，优先保留主题与演出，不必再复制一遍数值规则。若明确描述了机械效果，必须与实际结构逐项一致，例如“每回合开始”是 turn_start，“战斗开始”是 battle_start，二者绝不等价。不要用空 triggers、0 数值或名称伪造已实现的机制；无自身效果的状态仅可作为有明确读取者/触发关联的标记，不能凭空承诺增援、掉落率或其他未实现能力。这不适用于人物 time/location/profession、形象与生命等剧情字段，它们仍须由 AI 按剧情完整输出。';
}
