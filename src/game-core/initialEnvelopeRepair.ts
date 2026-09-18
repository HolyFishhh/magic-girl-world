import { collectInitialDraftEnvelopeIssues } from './initialDraftEnvelope';
import { compileInitialDraftToMvu, type DraftPath } from './initialDraft';

export interface InitialEnvelopeRepairPlan {
  original: Record<string, any>;
  /** Only the joint caller may defer references to its exact addition slots. */
  deferMissingReferences?: true;
  slots: Array<{ token: string; path: DraftPath; diagnostic: string; valueType: 'array' | 'object' | 'number' | 'string'; definitionId?: string }>;
}
const record = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const allowed = new Set(['player', 'player.core', 'player.cards', 'opening', 'opening.choices', 'registry']);
const resourceFieldTypes = new Map<string, 'number' | 'string'>([
  ['start', 'number'], ['current', 'number'], ['max', 'number'],
  ['name', 'string'], ['emoji', 'string'], ['description', 'string'], ['refresh', 'string'],
]);

/** Structural locations come from the shared envelope contract, not model text.
 * Invalid/missing containers and precisely diagnosed definition fields share
 * one response. Identity and every non-target sibling remain locked.
 */
export function planInitialEnvelopeRepair(input: unknown, deferMissingReferences = false): InitialEnvelopeRepairPlan | null {
  if (!record(input)) return null;
  const issues = collectInitialDraftEnvelopeIssues(input);
  if (issues.some(i => !allowed.has(i.path.join('.')))) return null;
  const slots: InitialEnvelopeRepairPlan['slots'] = issues.map((issue, i) => ({
    token: `e${i}`, path: [...issue.path], diagnostic: issue.message,
    valueType: ['cards', 'choices'].includes(issue.path.at(-1)!) ? 'array' : 'object',
  }));
  const compilation = compileInitialDraftToMvu(input);
  const additions = new Map<string, number>();
  for (const diagnostic of compilation.diagnostics) {
    if (diagnostic.code === 'INVALID_DRAFT') {
      if (!issues.some(issue => JSON.stringify(issue.path) === JSON.stringify(diagnostic.path))) return null;
      continue;
    }
    if (deferMissingReferences && diagnostic.repairRegistry && diagnostic.ref
      && ['UNKNOWN_STATUS_REF', 'UNKNOWN_RESOURCE_REF', 'UNKNOWN_TEMPLATE_REF'].includes(diagnostic.code)) continue;
    if (!deferMissingReferences && issues.length && diagnostic.repairRegistry && diagnostic.ref
      && ['UNKNOWN_STATUS_REF', 'UNKNOWN_RESOURCE_REF', 'UNKNOWN_TEMPLATE_REF'].includes(diagnostic.code)) {
      const kind = diagnostic.repairRegistry, id = diagnostic.ref;
      const definitions = input.registry?.[kind];
      if (!Array.isArray(definitions) || !(kind === 'templates' ? /^[A-Za-z_][A-Za-z0-9_-]*$/ : /^[A-Za-z_][A-Za-z0-9_]*$/).test(id)
        || definitions.some(d => record(d) && d.id === id)) return null;
      const key = `${kind}:${id}`;
      if (additions.has(key)) continue;
      const index = definitions.length + [...additions.keys()].filter(k => k.startsWith(`${kind}:`)).length;
      if (additions.size >= 32 || index >= (kind === 'resources' ? 16 : 128)) return null;
      additions.set(key, index);
      slots.push({token:`e${slots.length}`,path:['registry',kind,index],diagnostic:diagnostic.message,valueType:'object',definitionId:id});
      continue;
    }
    const path = diagnostic.path;
    // Never silently repair a subset of known compiler errors. Missing refs,
    // duplicate IDs and unknown fields belong to the full joint planner.
    if (diagnostic.code !== 'INVALID_REGISTRY' || path.length !== 4
      || path[0] !== 'registry' || path[1] !== 'resources'
      || typeof path[2] !== 'number' || typeof path[3] !== 'string'
      || !resourceFieldTypes.has(path[3])) return null;
    if (slots.some(s => JSON.stringify(s.path) === JSON.stringify(path))) continue;
    slots.push({token: `e${slots.length}`, path: [...path], diagnostic: diagnostic.message,
      valueType: resourceFieldTypes.get(path[3])!});
  }
  return slots.length ? { original: structuredClone(input), slots,
    ...(deferMissingReferences ? { deferMissingReferences: true as const } : {}) } : null;
}

/** Merge only; callers MUST compile and validate the entire draft afterwards. */
export function applyInitialEnvelopeRepair(plan: InitialEnvelopeRepairPlan, response: unknown): Record<string, any> {
  const canonical = planInitialEnvelopeRepair(plan.original, plan.deferMissingReferences === true);
  if (!canonical || JSON.stringify(canonical.slots) !== JSON.stringify(plan.slots))
    throw new Error('结构修复计划与原始诊断不一致');
  if (!record(response) || Object.keys(response).some(k => k !== 'replacements') || !record(response.replacements))
    throw new Error('结构修复只允许replacements对象');
  const keys = Object.keys(response.replacements);
  if (keys.length !== plan.slots.length || keys.some(k => !plan.slots.some(s => s.token === k)))
    throw new Error('结构修复必须恰好覆盖程序指定槽位');
  const result = structuredClone(plan.original);
  for (const slot of plan.slots) {
    // Defend the merge boundary even if a caller accidentally supplies a forged plan.
    let parent = result;
    for (const key of slot.path.slice(0, -1)) {
      if (!Object.hasOwn(parent, key) || (!record(parent[key]) && !Array.isArray(parent[key]))) throw new Error('结构修复父对象不存在');
      parent = parent[key];
    }
    const value = response.replacements[slot.token];
    const key = slot.path.at(-1)!;
    const valid = slot.valueType === 'array' ? Array.isArray(value)
      : slot.valueType === 'object' ? record(value)
      : slot.valueType === 'number' ? typeof value === 'number' && Number.isFinite(value)
      : typeof value === 'string';
    if (!valid) throw new Error(`结构修复${slot.token}值类型错误`);
    if (slot.definitionId !== undefined && (!record(value) || value.id !== slot.definitionId
      || !Array.isArray(parent) || key !== parent.length)) throw new Error(`结构修复${slot.token}只能追加指定ID的缺失定义`);
    if (Array.isArray(parent)) {
      if (typeof key !== 'number') throw new Error('结构修复数组索引无效');
      parent[key] = structuredClone(value);
    } else parent[key] = structuredClone(value);
  }
  return result;
}
