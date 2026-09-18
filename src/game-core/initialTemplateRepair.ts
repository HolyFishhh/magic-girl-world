import { compileInitialDraftToMvu, type InitialDraft } from './initialDraft';
import { createInitialDraftJsonSchema } from './initialDraftSchema';
import type { TowerJsonSchema } from './towerRequest';

export const INITIAL_TEMPLATE_REPAIR_SPEC = 'mwg.initial-template-repair/v1';
type Slot = { token: string; index: number; id: string; fields: string[] };
export interface InitialTemplateRepairPlan { original: InitialDraft; slots: Slot[] }
const record = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const referenceOps = new Set(['add_card', 'ensure_card', 'transform_card', 'apply_status', 'remove_status']);

/** No prose matching or whole-draft rewrite. Initially cover a single malformed
 * root reference operation; mixed sequences and other diagnostics fail closed. */
export function planInitialTemplateRepair(input: unknown): InitialTemplateRepairPlan | null {
  const compilation = compileInitialDraftToMvu(input);
  if (compilation.ok) return null;
  const draft = input as InitialDraft, indexes = new Set<number>();
  for (const issue of compilation.diagnostics) {
    const [root, collection, index, field, operation] = issue.path;
    if (issue.code !== 'INVALID_REFERENCE' || issue.path.length !== 5 || root !== 'registry' || collection !== 'templates'
      || !Number.isInteger(index) || field !== 'effects' || !referenceOps.has(String(operation))) return null;
    const template = draft.registry.templates[index as number];
    if (!record(template) || typeof template.id !== 'string' || !record(template.effects)
      || Object.keys(template.effects).length !== 1 || !Object.hasOwn(template.effects, operation)) return null;
    indexes.add(index as number);
  }
  if (!indexes.size || indexes.size > 16) return null;
  return { original: structuredClone(draft), slots: [...indexes].sort((a,b)=>a-b).map((index, i) => ({
    token: `t${i}`, index, id: draft.registry.templates[index].id,
    fields: draft.registry.templates[index].type === 'Curse' ? ['effects', 'cost'] : ['effects'],
  })) };
}

export function createInitialTemplateRepairSchema(plan: InitialTemplateRepairPlan): TowerJsonSchema {
  const source = createInitialDraftJsonSchema();
  return { name: 'mwg_initial_draft_template_repair', description: '修正指定模板的非法根效果，保留其余创作', strict: false,
    value: { type: 'object', additionalProperties: false, required: ['spec', 'replacements'], $defs: source.value.$defs,
      properties: { spec: { const: INITIAL_TEMPLATE_REPAIR_SPEC }, replacements: {
        type: 'object', additionalProperties: false, required: plan.slots.map(slot=>slot.token),
        properties: Object.fromEntries(plan.slots.map(slot=>[slot.token, { allOf: [
          { $ref: '#/$defs/cardTemplate' }, { type: 'object',
            required: Object.keys(plan.original.registry.templates[slot.index]).filter(k=>!slot.fields.includes(k)),
            properties: Object.fromEntries(Object.entries(plan.original.registry.templates[slot.index])
              .filter(([key])=>!slot.fields.includes(key)).map(([key,value])=>[key,{const:structuredClone(value)}])),
          },
        ] }])),
      } },
    } };
}

/** Merge only. The caller must recompile AND validate the whole candidate. */
export function applyInitialTemplateRepair(plan: InitialTemplateRepairPlan, response: unknown): InitialDraft {
  if (!record(response) || response.spec !== INITIAL_TEMPLATE_REPAIR_SPEC || !record(response.replacements)
    || Object.keys(response).sort().join(',') !== 'replacements,spec'
    || Object.keys(response.replacements).sort().join(',') !== plan.slots.map(s=>s.token).sort().join(',')) throw Error('模板修正必须恰好覆盖指定槽位');
  const result = structuredClone(plan.original);
  const canonical = (value: any): any => Array.isArray(value) ? value.map(canonical)
    : record(value) ? Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])) : value;
  const locked = (value: Record<string, any>, fields: string[]) => JSON.stringify(Object.keys(value).filter(k=>!fields.includes(k)).sort().map(k=>[k,canonical(value[k])]));
  for (const slot of plan.slots) {
    const old = plan.original.registry.templates[slot.index], next = response.replacements[slot.token];
    if (!record(next) || locked(old,slot.fields) !== locked(next,slot.fields)) throw Error('模板修正改动了锁定身份、说明或未报错规则');
    if (old.type === 'Curse' && Object.hasOwn(next,'cost')) throw Error('诅咒模板必须省略费用，不接受空值');
    result.registry.templates[slot.index] = structuredClone(next);
  }
  return result;
}
