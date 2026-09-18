import {
  compileInitialDraftToMvu, type DraftPath, type DraftRegistryKind,
  type InitialDraft, type InitialDraftDiagnostic,
} from './initialDraft';
import { createInitialDraftJsonSchema } from './initialDraftSchema';
import type { TowerJsonSchema } from './towerRequest';

export const INITIAL_DRAFT_REGISTRY_REPAIR_SPEC = 'mwg.initial-draft-registry-repair/v1';
export interface InitialDraftRegistryRepairSlot {
  token: string;
  kind: DraftRegistryKind;
  id: string;
  references: DraftPath[];
}
export interface InitialDraftRegistryRepairPlan {
  /** Program-owned snapshot. Never accept a replacement plan from the model. */
  original: InitialDraft;
  slots: InitialDraftRegistryRepairSlot[];
}
export type InitialDraftRegistryRepairPlanning =
  | { kind: 'not_needed' }
  | { kind: 'unsupported'; diagnostics: InitialDraftDiagnostic[] }
  | { kind: 'repair'; plan: InitialDraftRegistryRepairPlan };

/** Typed references only. Diagnostic messages/prose never choose repair targets. */
export function planInitialDraftRegistryRepair(input: unknown, coveredSourcePaths: readonly DraftPath[] = []): InitialDraftRegistryRepairPlanning {
  const compilation = compileInitialDraftToMvu(input);
  if (compilation.ok) return { kind: 'not_needed' };
  const missingCodes = new Set(['UNKNOWN_STATUS_REF', 'UNKNOWN_RESOURCE_REF', 'UNKNOWN_TEMPLATE_REF']);
  // Joint callers may cover exact source-field diagnostics in another part of
  // the SAME response. This never suppresses reference/identity errors.
  const diagnostics = compilation.diagnostics.filter(d => !(['INVALID_REGISTRY', 'INVALID_DRAFT'].includes(d.code)
    && coveredSourcePaths.some(path => JSON.stringify(path) === JSON.stringify(d.path))));
  if (diagnostics.some(diagnostic => !missingCodes.has(diagnostic.code) || !diagnostic.repairRegistry ||
    typeof diagnostic.ref !== 'string' || !(diagnostic.repairRegistry === 'templates'
      ? /^[A-Za-z_][A-Za-z0-9_-]*$/ : /^[A-Za-z_][A-Za-z0-9_]*$/).test(diagnostic.ref))) {
    return { kind: 'unsupported', diagnostics: compilation.diagnostics };
  }
  const slots = new Map<string, InitialDraftRegistryRepairSlot>();
  for (const diagnostic of diagnostics) {
    const kind = diagnostic.repairRegistry!;
    const id = diagnostic.ref!;
    const key = `${kind}:${id}`;
    const slot = slots.get(key) || { token: '', kind, id, references: [] };
    slot.references.push([...diagnostic.path]);
    slots.set(key, slot);
  }
  const ordered = [...slots.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, slot], i) => ({ ...slot, token: `r${i}` }));
  const original = structuredClone(input as InitialDraft);
  // An invalid registry ROOT can be replaced by a source slot in the SAME
  // response. It cannot also accept inferred additions: references have not
  // been expanded, and only final compilation can validate the supplied root.
  const sourceOwnsInvalidRegistry = coveredSourcePaths.some(path => path.length === 1 && path[0] === 'registry')
    && (!original.registry || typeof original.registry !== 'object' || Array.isArray(original.registry));
  if (sourceOwnsInvalidRegistry && ordered.length === 0)
    return { kind: 'repair', plan: { original, slots: [] } };
  // An empty additions object is valid only for a joint request whose other
  // source slots cover all compiler faults. It grants no new definition IDs.
  if ((ordered.length === 0 && coveredSourcePaths.length === 0) || ordered.length > 32 || (['statuses', 'resources', 'templates'] as const).some(kind =>
    !Array.isArray(original.registry?.[kind])
    || original.registry[kind].length + ordered.filter(slot => slot.kind === kind).length > (kind === 'resources' ? 16 : 128))) {
    return { kind: 'unsupported', diagnostics: compilation.diagnostics };
  }
  return { kind: 'repair', plan: { original, slots: ordered } };
}

/** Schema preserves the existing compact definition grammar; only IDs/tokens are fixed. */
export function createInitialDraftRegistryRepairJsonSchema(plan: InitialDraftRegistryRepairPlan): TowerJsonSchema {
  const source = createInitialDraftJsonSchema();
  const definitions: Record<DraftRegistryKind, string> = { statuses: 'mwgStatusDefinition', resources: 'mwgCombatResource', templates: 'cardTemplate' };
  return {
    name: 'mwg_initial_draft_registry_repair', description: '仅补齐程序指定的缺失定义', strict: false,
    value: {
      type: 'object', additionalProperties: false, required: ['spec', 'additions'],
      properties: {
        spec: { const: INITIAL_DRAFT_REGISTRY_REPAIR_SPEC },
        additions: {
          type: 'object', additionalProperties: false, required: plan.slots.map(slot => slot.token),
          properties: Object.fromEntries(plan.slots.map(slot => [slot.token, {
            allOf: [{ $ref: `#/$defs/${definitions[slot.kind]}` }, {
              type: 'object', required: ['id'], properties: { id: { const: slot.id } },
            }],
          }])),
        },
      },
      $defs: source.value.$defs,
    },
  };
}

type RepairMerge = { ok: true; draft: InitialDraft } | { ok: false; message: string };
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * Only adds exact requested IDs; never replaces an existing definition/content.
 * This is a merge, NOT acceptance. The host must recompile and validate the
 * entire candidate, and must not start a second repair if new errors remain.
 */
export function applyInitialDraftRegistryRepair(plan: InitialDraftRegistryRepairPlan, response: unknown): RepairMerge {
  if (!isRecord(response) || response.spec !== INITIAL_DRAFT_REGISTRY_REPAIR_SPEC || !isRecord(response.additions) ||
    Object.keys(response).some(key => key !== 'spec' && key !== 'additions')) return { ok: false, message: '定义补齐响应格式无效' };
  const additions = response.additions;
  const expected = new Set(plan.slots.map(slot => slot.token));
  if (Object.keys(additions).length !== expected.size || Object.keys(additions).some(token => !expected.has(token)))
    return { ok: false, message: '定义补齐必须恰好覆盖指定槽位' };
  const draft = structuredClone(plan.original);
  for (const slot of plan.slots) {
    const value = additions[slot.token];
    if (!isRecord(value) || value.id !== slot.id) return { ok: false, message: `定义补齐 ${slot.token} 的 ID 不匹配` };
    if (draft.registry[slot.kind].some(definition => definition.id === slot.id))
      return { ok: false, message: `定义补齐 ${slot.token} 不能覆盖已有定义` };
    draft.registry[slot.kind].push(structuredClone(value));
  }
  return { ok: true, draft };
}
