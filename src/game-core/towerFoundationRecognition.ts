import { type ContentDefinition, type ContentPack } from './contentPack';
import { matchTowerFoundation } from './towerFoundationPredicates';
import { extractContentMechanicFeatures, isPlainLowValueStarterDefinition } from './contentMechanicFeatures';
import { TOWER_ARCHETYPE_PRESETS, type TowerArchetypePreset } from './towerArchetypeCatalog';

/**
 * Read-only evidence for the independently selectable tower foundations.  This is
 * deliberately separate from the (broader) archetype graph: a graph family can
 * describe a deck, while a foundation must be supported by the exact executable
 * distinction selected by the player (for example, a plain damage step is not
 * evidence of piercing, lifesteal, or multi-hit).
 */
export type TowerFoundationRecognitionState = 'detected' | 'absent' | 'uncertain';
export interface TowerFoundationRecognition {
  id: string;
  detected: boolean;
  state: TowerFoundationRecognitionState;
  supportingIds: string[];
  evidence: string[];
}

interface DefinitionEvidence {
  id: string;
  kind: string;
  operations: Set<string>;
  triggers: Set<string>;
  text: string;
  summons?: string[];
  supportingIds?: string[];
}

const COMPILED_ALIASES: Readonly<Record<string, string>> = {
  gain_block: 'block', gain_energy: 'energy', gain_resource: 'resource', gain_lust: 'lust',
  draw_cards: 'draw', scry_cards: 'scry', discard_cards: 'discard', exhaust_cards: 'exhaust', recover_cards: 'recover',
  reduce_card_cost: 'reduce_cost', modify_card_value: 'modify_card', copy_cards: 'copy', double_card_effect: 'double',
  auto_play_cards: 'auto_play', set_card_destination: 'card_destination', move_cards: 'move_card', remove_cards: 'remove_card',
  transform_cards: 'transform_card', apply_card_patch: 'patch_card', apply_card_attachment: 'attach_card', upgrade_cards: 'upgrade_card',
  damage_summons: 'damage_summon', heal_summons: 'heal_summon', modify_summons: 'modify_summon',
  modify_summon_effects: 'modify_summon_effect', gain_summon_resource: 'summon_resource',
  activate_summons: 'activate_summon', dismiss_summons: 'dismiss_summon', copy_summons: 'copy_summon',
  register_trigger: 'trigger', schedule_effect: 'schedule', choose_one: 'choose', grant_extra_turn: 'extra_turn', force_end_turn: 'end_turn',
};

/** Registered but unused child templates are not an existing engine. */
function reachableDefinition(value: any): any {
  if (Array.isArray(value)) return value.map(reachableDefinition);
  if (!value || typeof value !== 'object') return value;
  const result: Record<string, any> = {};
  for (const [key,child] of Object.entries(value)) {
    if (['name','description','emoji','flavor','flavorText','metadata','creates'].includes(key)) continue;
    result[key]=reachableDefinition(child);
  }
  if (Array.isArray(value.creates)) {
    const ids=new Set<string>();
    const collect=(node:any):void=>{
      if (Array.isArray(node)) { node.forEach(collect); return; }
      if (!node || typeof node!=='object') return;
      for(const key of ['add_card','ensure_card','transform_card']) if(typeof node[key]==='string')ids.add(node[key]);
      Object.entries(node).filter(([key])=>key!=='creates').forEach(([,child])=>collect(child));
    };
    collect(result);
    const templates=new Map(value.creates.filter((v:any)=>v&&typeof v.id==='string').map((v:any)=>[v.id,v]));
    const used:any[]=[];
    for(const id of ids){const template=templates.get(id);if(template){const cleaned=reachableDefinition(template);used.push(cleaned);collect(cleaned);}}
    if(used.length) result.creates=used;
  }
  return result;
}

function records(pack: ContentPack): DefinitionEvidence[] {
  const roots: Array<[string, readonly ContentDefinition[]]> = ([
    ['card', pack.cards], ['relic', pack.relics], ['item', pack.items], ['ability', pack.abilities],
    ['active-status', pack.activeStatuses], ['resource', pack.playerResources || []], ['stance', pack.playerStance ? [pack.playerStance] : []], ['orb', pack.playerOrbs || []],
    ['desire', pack.desireEffects.player ? [pack.desireEffects.player] : []],
    ['growth', pack.playerSummonGrowth || []], ['patch', pack.playerCardPatches || []],
  ] as Array<[string, readonly ContentDefinition[]]>).map(([kind,values])=>[kind,values.map(reachableDefinition)]);
  const reachableStatusIds = new Set<string>();
  const seen = new Set<unknown>();
  const collectStatusReferences = (value: unknown): void => {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) { value.forEach(collectStatusReferences); return; }
    const record = value as Record<string, unknown>;
    // Compiled EffectProgram status references.
    if (['apply_status','remove_status','apply_summon_status','remove_summon_status'].includes(String(record.op)) && typeof record.status === 'string') reachableStatusIds.add(record.status);
    if (record.op === 'event_status_is' && typeof record.statusId === 'string') reachableStatusIds.add(record.statusId);
    // Compact effect references. `all`/`buffs`/`debuffs` are selectors, not IDs.
    for (const key of ['apply_status', 'remove_status', 'apply_summon_status', 'remove_summon_status']) {
      const target = record[key];
      if (typeof target === 'string' && !['all', 'buffs', 'debuffs'].includes(target)) reachableStatusIds.add(target);
      if (target && typeof target === 'object' && !Array.isArray(target) && typeof (target as Record<string, unknown>).id === 'string') reachableStatusIds.add((target as Record<string, string>).id);
    }
    if (typeof record.statusId === 'string') reachableStatusIds.add(record.statusId);
    // This visits nested `creates`, generated card definitions, and summon
    // actions/abilities only after they are reachable from a player root.
    Object.entries(record).filter(([key]) => !['name','description','emoji','metadata','flavor','flavorText'].includes(key)).forEach(([, value]) => collectStatusReferences(value));
  };
  roots.forEach(([kind, values]) => values.forEach(value => {
    if (kind === 'active-status' && typeof value.id === 'string') reachableStatusIds.add(value.id);
    collectStatusReferences(value);
  }));
  const statusById = new Map(pack.statuses.filter(status => typeof status.id === 'string').map(status => [String(status.id), reachableDefinition(status)]));
  const reachableStatuses: ContentDefinition[] = [];
  for (const id of reachableStatusIds) {
    const status = statusById.get(id);
    if (!status) continue;
    reachableStatuses.push(status);
    collectStatusReferences(status);
  }
  // Status definitions can reference other status definitions, so close the
  // graph after processing each newly reached definition.
  for (const id of reachableStatusIds) {
    const status = statusById.get(id);
    if (status && !reachableStatuses.includes(status)) reachableStatuses.push(status);
  }
  const entries = [...roots, ['status', reachableStatuses] as [string, readonly ContentDefinition[]]];
  return entries.flatMap(([kind, values]) => values
    .filter(value => kind !== 'card' || !isPlainLowValueStarterDefinition(value))
    .map((value, index) => {
    // Presentation and extension metadata are intentionally not mechanism
    // evidence.  Keep the executable shape while retaining selectors, formulae,
    // lifecycle and trigger fields.
    const text = JSON.stringify(value, (key, child) => ['name', 'description', 'emoji', 'flavor', 'flavorText', 'metadata'].includes(key) ? undefined : child);
    const features = extractContentMechanicFeatures(JSON.parse(text));
    const operations = new Set(features.operations);
    for (const match of text.matchAll(/"op"\s*:\s*"([^"]+)"/g)) operations.add(COMPILED_ALIASES[match[1]] || match[1]);
    return {
      id: typeof value.id === 'string' && value.id ? value.id : `${kind}:${index + 1}`,
      kind,
      operations,
      triggers: new Set(features.triggers),
      text,
      summons: features.summons,
    };
  }));
}

const exactMatch = matchTowerFoundation;

function recognitionFor(preset: TowerArchetypePreset, entries: readonly DefinitionEvidence[]): TowerFoundationRecognition {
  let candidates = entries;
  if (preset.id === 'summon-self-destruct') {
    const groups = new Map<string, DefinitionEvidence[]>();
    entries.forEach(entry => entry.summons?.forEach(id => groups.set(id, [...(groups.get(id) || []),entry])));
    candidates = [...entries, ...[...groups].filter(([,group])=>group.length>1).map(([id,group])=>({
      id:`summon:${id}`, kind:'combination', operations:new Set(group.flatMap(e=>[...e.operations])),
      triggers:new Set(group.flatMap(e=>[...e.triggers])), text:JSON.stringify(group.map(e=>JSON.parse(e.text))),
      supportingIds:group.map(e=>e.id),
    }))];
  }
  const exact = candidates.filter(entry => exactMatch(preset.id, entry) === true);
  const operationMatches = entries.filter(entry => preset.operations.length > 0 && preset.operations.every(operation => entry.operations.has(operation)));
  const empty: DefinitionEvidence = { id: '', kind: '', operations: new Set(), triggers: new Set(), text: '' };
  const matches = exact.length ? exact : exactMatch(preset.id, entries[0] || empty) === undefined ? operationMatches : [];
  const needsExactEvidence = exactMatch(preset.id, entries[0] || empty) !== undefined;
  const detected = matches.length > 0;
  const uncertain = !detected && (needsExactEvidence || preset.operations.length === 0);
  const rule = needsExactEvidence ? '需专属结构字段，普通同类操作不计入。' : preset.operations.length ? `需执行操作：${preset.operations.join(' + ')}。` : '需可执行公式、条件、触发或定义字段。';
  const supportingIds=[...new Set(matches.flatMap(entry=>entry.supportingIds||[entry.id]))];
  return { id: preset.id, detected, state: detected ? 'detected' : uncertain ? 'uncertain' : 'absent', supportingIds, evidence: detected ? [`${rule}证据：${supportingIds.join('、')}`] : [rule, uncertain ? '当前输入没有足够结构可判定；保留为不确定，不从名称或普通操作猜测。' : '当前输入不存在所需执行操作。'] };
}

/** Analyze authored compact definitions and compiled effect programs without mutation or model calls. */
export function recognizeTowerFoundations(pack: ContentPack): TowerFoundationRecognition[] {
  const entries = records(pack);
  return TOWER_ARCHETYPE_PRESETS.map(preset => recognitionFor(preset, entries));
}

/** Lets tests and catalog maintenance assert that every selectable foundation has a recognition rule. */
export function towerFoundationRecognitionRuleIds(): string[] {
  const empty: DefinitionEvidence = { id: '', kind: '', operations: new Set(), triggers: new Set(), text: '{}' };
  // One catalog owns names, requirements, and basic operation mappings. Only
  // distinctions that operations cannot express need a dedicated predicate.
  return TOWER_ARCHETYPE_PRESETS.filter(preset => preset.operations.length > 0 || exactMatch(preset.id, empty) !== undefined).map(preset => preset.id);
}
