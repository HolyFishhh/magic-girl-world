import { compileCompactEffectList } from './compactEffectDsl';

type Operation = 'damage' | 'block' | 'heal' | 'draw' | 'energy';
type Literal = { operation: Operation; amount: number; to: 'self' | 'opponent'; delay: number; phase: 'immediate' | 'turn_start' | 'turn_end' };
export interface AuthoredLiteralEffectIssue { code: 'EXPLICIT_LITERAL_EFFECT_MISMATCH' | 'EXPLICIT_FIRST_CARD_EVENT_MISMATCH' | 'LITERAL_EFFECT_AUDIT_LIMIT'; path: string; message: string }
const record = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const operations: Operation[] = ['damage', 'block', 'heal', 'draw', 'energy'];
const number = '(0|[1-9]\\d{0,5})';
const patterns: Array<[Operation, RegExp]> = [
  ['damage', new RegExp(`^(?:对(该敌人|敌人|敌方|自身|自己))?(?:再)?造成${number}点(?:生命)?伤害$`)],
  ['block', new RegExp(`^(?:你|自身|自己)?(?:再)?(?:获得|得到)${number}点格挡$`)],
  ['heal', new RegExp(`^(?:你|自身|自己)?(?:再)?(?:回复|恢复)${number}点生命$`)],
  ['draw', new RegExp(`^(?:你|自身|自己)?(?:再)?抽(?:取)?${number}张牌$`)],
  ['energy', new RegExp(`^(?:你|自身|自己)?(?:再)?(?:获得|恢复|回复)${number}点能量$`)],
];

/** A complete small literal language, not extraction from arbitrary prose.
 * Quotes, conditions, flavor, status references and unsupported clauses return
 * null: they are not proof of either correctness or a contradiction.
 */
function readClaims(description: unknown): Literal[] | null {
  if (typeof description !== 'string' || !description.trim() || description.length > 2048) return null;
  const clauses = description.trim().replace(/[。.]$/, '').split(/[；;。]/);
  if (!clauses.length || clauses.length > 8 || clauses.some(v => !v.trim())) return null;
  const claims: Literal[] = [];
  for (const clause of clauses) {
    let text = clause.trim();
    const timing = text.match(/^(?:下一|下)(?:个)?回合(开始|结束)(?:时)?[，,:：]?\s*/);
    if (timing) text = text.slice(timing[0].length);
    let claim: Literal | undefined;
    for (const [operation, pattern] of patterns) {
      const match = text.match(pattern);
      if (!match) continue;
      claim = { operation, amount: Number(match[operation === 'damage' ? 2 : 1]),
        to: operation === 'damage' && !['自身', '自己'].includes(match[1]) ? 'opponent' : 'self',
        delay: timing ? 1 : 0, phase: timing ? timing[1] === '开始' ? 'turn_start' : 'turn_end' : 'immediate' };
      break;
    }
    if (!claim) return null;
    // Do not interpret prose that jumps between temporal scopes. One future
    // block follows the immediate block; mixed/switching scopes need review.
    const previous = claims.at(-1);
    if (previous && previous.phase !== 'immediate' && claim.phase !== previous.phase) return null;
    claims.push(claim);
  }
  return claims;
}

/** No reference expansion, formulas, conditions, bundling or hidden operations.
 * Only this completely understood effects subset can contradict readClaims.
 */
function readLiteralEffects(value: unknown, delay = 0, phase: Literal['phase'] = 'immediate'): Literal[] | null {
  const entries = Array.isArray(value) ? value : record(value) ? [value] : [];
  if (!entries.length || entries.length > 32) return null;
  const result: Literal[] = [];
  let scheduled = false;
  for (const entry of entries) {
    if (!record(entry)) return null;
    if (Object.hasOwn(entry, 'schedule')) {
      if (scheduled || phase !== 'immediate' || Object.keys(entry).some(k => !['schedule', 'phase', 'effects'].includes(k))
        || !Number.isInteger(entry.schedule) || entry.schedule < 1 || entry.schedule > 99
        || !['turn_start', 'turn_end'].includes(entry.phase ?? 'turn_start')) return null;
      const nested = readLiteralEffects(entry.effects, entry.schedule, entry.phase ?? 'turn_start');
      if (!nested) return null;
      result.push(...nested);
      scheduled = true;
      continue;
    }
    if (scheduled) return null;
    const keys = operations.filter(k => Object.hasOwn(entry, k));
    if (keys.length !== 1 || Object.keys(entry).some(k => k !== keys[0] && k !== 'to')) return null;
    const operation = keys[0], amount = entry[operation], to = entry.to ?? (operation === 'damage' ? 'opponent' : 'self');
    if (!Number.isInteger(amount) || amount < 0 || amount > 999999 || !['self', 'opponent'].includes(to)) return null;
    result.push({ operation, amount, to, delay, phase });
  }
  return result;
}

function comparison(value: unknown): { expected: Literal[]; actual: Literal[] } | null {
  if (!record(value) || value.trigger != null || value.triggers != null) return null;
  const expected = readClaims(value.description), actual = readLiteralEffects(value.effects);
  return expected && actual ? { expected, actual } : null;
}

/** A closed, fully understood status sentence and one immediate self benefit.
 * No keyword extraction from flavor, mixed triggers, formulas or conditions.
 */
export function inspectFirstCardEventMismatch(value: unknown): { event: string; condition: string } | null {
  if (!record(value) || typeof value.description !== 'string' || !record(value.triggers)) return null;
  const match = value.description.trim().match(/^每回合首次打出(技能|攻击)牌时[，,]\s*(.+)$/);
  if (!match) return null;
  const event = match[1] === '技能' ? 'skill_played' : 'attack_played';
  const counter = match[1] === '技能' ? 'skills_played_this_turn' : 'attacks_played_this_turn';
  if (Object.keys(value.triggers).length !== 1 || !record(value.triggers[event])) return null;
  const effect = value.triggers[event];
  if (typeof effect.when !== 'string') return null;
  const actualCounter = effect.when.trim().match(/^(cards_played_this_turn|skills_played_this_turn|attacks_played_this_turn)\s*==\s*1$/)?.[1];
  if (!actualCounter || actualCounter === counter) return null;
  const expected = readClaims(match[2]);
  const { when: _when, ...unconditional } = effect;
  const actual = readLiteralEffects(unconditional);
  if (!expected || expected.length !== 1 || expected[0].amount <= 0 || expected[0].phase !== 'immediate'
    || expected[0].to !== 'self' || expected[0].operation === 'damage'
    || !actual || JSON.stringify(actual) !== JSON.stringify(expected)) return null;
  return { event, condition: `${counter} == 1` };
}

export function diagnoseAuthoredLiteralEffects(value: unknown, path: string): AuthoredLiteralEffectIssue[] {
  const compared = comparison(value);
  if (!compared || JSON.stringify(compared.expected) === JSON.stringify(compared.actual)) return [];
  return [{ code: 'EXPLICIT_LITERAL_EFFECT_MISMATCH', path: `${path}.effects`,
    message: 'description 的完整字面规则与 effects 的数值、目标、时机或次数不一致，需由 AI 补齐或修正 effects；保留原说明和其他字段，不能用删除说明、改成空效果或占位数值掩盖矛盾' }];
}

/** Fresh generation validation only. Never call as a migration of saved state. */
export function collectAuthoredLiteralEffectIssues(value: unknown, path = ''): AuthoredLiteralEffectIssue[] {
  const issues: AuthoredLiteralEffectIssue[] = [], ancestors = new Set<object>();
  let visited = 0, exhausted = false;
  const visit = (item: unknown, at: string, depth: number): void => {
    if (exhausted || !item || typeof item !== 'object') return;
    if (++visited > 40000 || depth > 64 || ancestors.has(item)) {
      exhausted = true;
      issues.push({ code: 'LITERAL_EFFECT_AUDIT_LIMIT', path: at, message: '字面效果审查超过大小或深度限制，或出现循环，未完成校验' });
      return;
    }
    ancestors.add(item);
    if (Array.isArray(item)) item.forEach((v, i) => visit(v, `${at}[${i}]`, depth + 1));
    else {
      issues.push(...diagnoseAuthoredLiteralEffects(item, at));
      const first = inspectFirstCardEventMismatch(item);
      if (first) issues.push({ code: 'EXPLICIT_FIRST_CARD_EVENT_MISMATCH', path: `${at}.triggers.${first.event}.when`,
        message: '完整字面说明要求每回合首次该类牌，但条件使用了另一种出牌计数；由 AI 修正该 when，保留说明、事件、收益、目标和状态寿命' });
      for (const [key, v] of Object.entries(item)) if (key !== '$meta') visit(v, at ? `${at}.${key}` : key, depth + 1);
    }
    ancestors.delete(item);
  };
  visit(value, path, 0);
  return issues;
}

/** AI supplies the complete small replacement. This function validates it;
 * it never builds mechanics from prose or overwrites the author's description.
 */
export function assertAuthoredLiteralEffectRepair(original: unknown, effects: unknown): void {
  const compared = comparison(original), replacement = readLiteralEffects(effects);
  if (!compared || !replacement || JSON.stringify(compared.expected) !== JSON.stringify(replacement)
    || !compileCompactEffectList(effects).ok) throw new Error('字面规则修复必须完整实现原说明的效果、数值、目标、顺序和时机');
}

function sameData(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((v, i) => sameData(v, b[i]));
  if (!record(a) || !record(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(k => Object.hasOwn(b, k) && sameData(a[k], b[k]));
}

/** Repair cannot evade a known literal contradiction by deleting/rewording the
 * original claim or switching to an uninspected effect language. Other content
 * keeps the surrounding controller's existing repair ownership policy.
 */
export function assertAuthoredLiteralRepairPreservation(original: unknown, repaired: unknown): void {
  const ancestors = new Set<object>();
  let visited = 0;
  const visit = (before: unknown, after: unknown, path: string, depth: number): void => {
    if (!before || typeof before !== 'object') return;
    if (++visited > 40000 || depth > 64 || ancestors.has(before)) throw new Error('字面效果修复保留检查超过安全限制');
    ancestors.add(before);
    if (Array.isArray(before)) before.forEach((v, i) => visit(v, Array.isArray(after) ? after[i] : undefined, `${path}[${i}]`, depth + 1));
    else {
      const first = inspectFirstCardEventMismatch(before);
      if (first && record(before)) {
        if (!record(after) || !record(after.triggers) || !record(after.triggers[first.event])) throw new Error(`${path}：首次出牌规则不得删除`);
        const expected = { ...before, triggers: { ...before.triggers, [first.event]: { ...before.triggers[first.event], when: first.condition } } };
        if (!sameData(after, expected)) throw new Error(`${path}：首次出牌修复只能修改已证明错误的计数条件`);
      }
      if (diagnoseAuthoredLiteralEffects(before, path).length) {
        if (!record(after)) throw new Error(`${path}：字面效果修复不得删除原内容`);
        const originalFields: Record<string, unknown> = { ...before }, newFields: Record<string, unknown> = { ...after };
        delete originalFields.effects; delete newFields.effects;
        if (!sameData(originalFields, newFields)) throw new Error(`${path}：字面效果修复只能修改 effects，原说明、身份和其他字段锁定`);
        try { assertAuthoredLiteralEffectRepair(before, after.effects); }
        catch (error) { throw new Error(`${path}.effects：${error instanceof Error ? error.message : String(error)}`); }
      }
      for (const [key, v] of Object.entries(before)) if (key !== '$meta') {
        visit(v, record(after) && Object.hasOwn(after, key) ? after[key] : undefined, path ? `${path}.${key}` : key, depth + 1);
      }
    }
    ancestors.delete(before);
  };
  visit(original, repaired, '', 0);
}

export function createLiteralEffectSequenceSchema(): Record<string, unknown> {
  const primitive = { oneOf: operations.map(operation => ({ type: 'object', additionalProperties: false,
    required: [operation], properties: { [operation]: { type: 'integer', minimum: 0, maximum: 999999 },
      to: { enum: ['self', 'opponent'] } } })) };
  return { type: 'array', minItems: 1, maxItems: 32,
    contains: { type: 'object', required: ['schedule'] }, minContains: 0, maxContains: 1,
    items: { oneOf: [primitive, {
    type: 'object', additionalProperties: false, required: ['schedule', 'phase', 'effects'], properties: {
      schedule: { type: 'integer', minimum: 1, maximum: 99 }, phase: { enum: ['turn_start', 'turn_end'] },
      effects: { oneOf: [primitive, { type: 'array', minItems: 1, maxItems: 32, items: primitive }] },
    },
  }] } };
}
