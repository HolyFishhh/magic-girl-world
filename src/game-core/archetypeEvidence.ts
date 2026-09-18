import type { ContentDefinition, ContentPack } from './contentPack';
import { extractContentMechanicFeatures, mergeContentMechanicFeatures, type ContentMechanicFeatures } from './contentMechanicFeatures';
import { matchTowerFoundation } from './towerFoundationPredicates';

const record = (value: any): value is Record<string, any> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const presentation = new Set(['name', 'description', 'emoji', 'flavor', 'flavorText', 'metadata', 'label']);

/** Keep executable ownership: a familiar's attack is summon output, not a player attack. */
export function extractArchetypeEvidence(definition: ContentDefinition, pack?: ContentPack): ContentMechanicFeatures {
  const derived = new Set<string>();
  const summonIds = new Set<string>();
  const usedStatuses = new Set<string>();
  const project = (value: any): any => {
    if (Array.isArray(value)) return value.map(project);
    if (!record(value)) return value;
    const result: Record<string, any> = {};
    const compiled = typeof value.op === 'string';
    if (value.op === 'count_statuses' && value.target === 'opponent') derived.add('exact_enemy_status_payoff');
    for (const [key, child] of Object.entries(value)) {
      if (presentation.has(key) || key === 'creates' || key === 'effects' && value.effectProgram) continue;
      if ((key === 'spawn_summon' || key === 'summon' && value.op === 'spawn_summon') && record(child)) {
        const features = extractContentMechanicFeatures(child);
        if (child.id) summonIds.add(child.id);
        if (child.slot) derived.add('summon_single');
        if (Number(value.count ?? child.count ?? 1) > 1 && !child.slot) derived.add('summon_multiple');
        if (Array.isArray(child.abilities) && child.abilities.length) derived.add('summon_passive');
        if (features.operations.some(op => ['damage', 'block', 'heal', 'lust', 'apply_status', 'resource', 'summoner_effects'].includes(op))) derived.add('summon_output');
        const nested = { kind: 'card', text: JSON.stringify({ effects: { spawn_summon: child } }), operations: new Set(features.operations), triggers: new Set(features.triggers) };
        if (matchTowerFoundation('summon-hp-scaling', nested)) derived.add('summon_hp_damage');
        if (matchTowerFoundation('summon-self-destruct', nested)) derived.add('summon_death_output');
        result[key] = { id: child.id, slot: child.slot, count: child.count };
        // Re-summoning reinforcement belongs to the summon engine too.
        if (child.on_existing_effects || child.onExistingEffects) derived.add('summon_reinforce');
        continue;
      }
      // Card lifecycle fields describe destinations, not active discard/exhaust operations.
      if (key === 'lifecycle') continue;
      if (key === 'summon_template' || key === 'summonTemplateId' || key === 'summon_template_id'
        || key === 'requires_summon' || key === 'requiresSummonTemplateId') {
        if (typeof child === 'string') { summonIds.add(child); derived.add('summon_support'); }
      }
      if ((key === 'apply_status' || key === 'apply_summon_status') && !compiled) {
        const id = typeof child === 'string' ? child : child?.id;
        if (id) usedStatuses.add(id);
      }
      if (key === 'status' && ['apply_status', 'apply_summon_status'].includes(value.op) && typeof child === 'string') usedStatuses.add(child);
      result[key] = project(child);
    }
    if (Array.isArray(value.creates)) {
      const referenced = new Set<string>();
      const scan = (node: any): void => {
        if (Array.isArray(node)) { node.forEach(scan); return; }
        if (!record(node)) return;
        for (const key of ['add_card', 'ensure_card', 'transform_card']) if (typeof node[key] === 'string') referenced.add(node[key]);
        Object.values(node).forEach(scan);
      };
      scan(result);
      const templates = new Map(value.creates.map((card: any) => [card.id, card]));
      const visited = new Set<string>();
      const children: any[] = [];
      for (const id of referenced) {
        if (visited.has(id)) continue;
        visited.add(id);
        const template = templates.get(id);
        if (!template) continue;
        const projected = project(template);
        children.push(projected);
        scan(projected);
      }
      if (children.length) result.creates = children;
    }
    return result;
  };
  const root = project(definition);
  const roots = [root];
  const statuses = new Map(pack?.statuses.map(status => [String(status.id), status]) || []);
  const visited = new Set<string>();
  for (const id of usedStatuses) {
    if (visited.has(id)) continue;
    visited.add(id);
    const status = statuses.get(id);
    if (status) roots.push(project(status));
  }
  const features = mergeContentMechanicFeatures(roots.map(extractContentMechanicFeatures));
  // Distinguish an accumulating stack from a binary transformation. A shared
  // status ID is a relationship, not proof of every status archetype.
  for (const id of usedStatuses) {
    const status = statuses.get(id);
    if (status && Number(status.maxStacks) !== 1 && /\bstacks\b/.test(JSON.stringify(status.triggers))) derived.add('exact_stackable_status');
  }
  const rootText = JSON.stringify(root);
  if ([...rootText.matchAll(/self\.status\.([a-z_][a-z0-9_]*)/gi)].some(match => Number(statuses.get(match[1])?.maxStacks) === 1)) derived.add('exact_self_status_payoff');
  if (/(?:opponent|enemy)\.(?:status\.|has_(?:buff|debuff|neutral|status)\b)/.test(rootText)) derived.add('exact_enemy_status_payoff');
  if (/enemy_(?:gain|lose)_(?:buff|debuff)/.test(rootText)) derived.add('exact_enemy_status_payoff');
  // Removal inside a status's own expiration trigger is NOT a cashout.
  if (/remove_status/.test(rootText) && /(?:damage|gain_block|block|heal|gain_lust|lust)/.test(rootText)) derived.add('exact_status_cashout');
  if (/(?:self|opponent|enemy)\.status\.[a-z_]+/.test(rootText)) {
    const numerical = (node: any): void => {
      if (Array.isArray(node)) { node.forEach(numerical); return; }
      if (!record(node)) return;
      const amount = node.op && ['damage', 'gain_block', 'heal', 'gain_lust', 'gain_resource'].includes(node.op)
        ? node.amount : node.damage ?? node.block ?? node.heal ?? node.lust ?? node.resource?.amount;
      const numericText = typeof amount === 'string' && amount.includes('?') ? amount.slice(amount.indexOf('?') + 1) : JSON.stringify(amount) || '';
      if (/\.status\./.test(numericText)) derived.add('exact_status_conversion');
      Object.values(node).forEach(numerical);
    };
    numerical(root);
  }
  const evidence = { kind: definition.type === 'Power' ? 'ability' : 'card', text: JSON.stringify(roots), operations: new Set(features.operations), triggers: new Set(features.triggers) };
  const exact: Record<string, string[]> = {
    exact_multi_hit: ['multi-hit'], exact_block_retain: ['block-retain'], exact_retaliation: ['retaliation'],
    exact_self_damage: ['self-damage'], exact_low_hp: ['missing-hp', 'low-hp'],
    exact_block_value: ['block-value'], exact_on_hit: ['on-hit'], exact_on_play: ['on-play'],
    exact_discard_payoff: ['on-discard'], exact_exhaust_payoff: ['on-exhaust'],
    exact_cost_change: ['cost-patch', 'free-play'], exact_retain: ['retain'],
    exact_enchantment: ['enchantment'], exact_affliction: ['affliction'],
  };
  for (const [feature, ids] of Object.entries(exact)) if (ids.some(id => matchTowerFoundation(id, evidence))) derived.add(feature);
  // Compact arrays represent consecutive effects; separate choice options do not.
  const walk = (value: any): void => {
    if (Array.isArray(value)) { value.forEach(walk); return; }
    if (!record(value)) return;
    if (Array.isArray(value.effects) && value.effects.filter((step: any) => record(step) && Object.hasOwn(step, 'damage')).length > 1) derived.add('exact_multi_hit');
    if (value.discard_effects) derived.add('exact_discard_payoff');
    if (value.exhaust_effects) derived.add('exact_exhaust_payoff');
    // Resource thresholds on utility cards are not resource cashout. The
    // resource must participate in payment or the actual numerical payoff.
    if ((value.op === 'damage' || Object.hasOwn(value, 'damage')) && (value.target ?? value.to ?? 'opponent') !== 'self') derived.add('exact_opponent_damage');
    const payoff = value.op && ['damage', 'gain_block', 'heal', 'gain_lust'].includes(value.op)
      ? value.amount : value.damage ?? value.block ?? value.heal ?? value.lust;
    if (/\b(?:self\.resource|x_resource)\./.test(JSON.stringify(payoff) || '')) derived.add('resource_payoff');
    if (record(value.triggers)) Object.keys(value.triggers).forEach(name => features.triggers.push(name));
    Object.entries(value).forEach(([key, child]) => {
      if (typeof child === 'string') {
        if (/\bcards_discarded(?:_[a-z_]+)?\b/.test(child) || key === 'metric' && child === 'cards_discarded') derived.add('exact_discard_payoff');
        if (/\bcards_exhausted(?:_[a-z_]+)?\b/.test(child) || key === 'metric' && child === 'cards_exhausted') derived.add('exact_exhaust_payoff');
        if (/\b(?:cards_played|attacks_played|skills_played)(?:_[a-z_]+)?\b/.test(child)) derived.add('exact_on_play');
        if (/\b(?:opponent|enemy)\.intent\b|\benemy_intent\b/.test(child)) derived.add('exact_intent');
      }
      walk(child);
    });
  };
  roots.forEach(walk);
  if (pack?.playerResources?.some(resource => resource.refresh === 'retain' && features.resources.includes(String(resource.id)))) derived.add('resource_retained');
  if (features.operations.includes('reduce_cost')) derived.add('exact_cost_change');
  if (definition.retain === true) derived.add('exact_retain');
  if (features.operations.includes('summon_condition')) derived.add('summon_support');
  features.operations = [...new Set([...features.operations, ...derived])].sort();
  features.summons = [...new Set([...features.summons, ...summonIds])].sort();
  features.triggers = [...new Set(features.triggers)].sort();
  return features;
}
