/** Shared field names only. Validation and lifecycle semantics remain in the
 * compiler/runtime. Legacy spellings are not advertised to content authors. */
export const SUMMON_AUTHORING_FIELDS = [
  'id', 'name', 'emoji', 'description', 'has_hp', 'max_hp', 'block', 'tags',
  'resources', 'modifiers', 'actions', 'abilities', 'actions_per_activation',
  'action_priority', 'speed', 'intercept', 'slot', 'on_existing', 'on_defeated',
  'retain_corpse', 'capabilities', 'count', 'capacity', 'overflow', 'on_existing_effects',
] as const;
export const SUMMON_ACTION_AUTHORING_FIELDS = [
  'id', 'name', 'emoji', 'description', 'dialogue', 'weight', 'fixed', 'effects', 'creates', 'when',
] as const;
export const SUMMON_ABILITY_AUTHORING_FIELDS = [
  'id', 'name', 'emoji', 'description', 'trigger', 'fixed', 'creates',
] as const;

export function summonAuthoringShape(placement: 'runtime' | 'initial-draft'): string {
  const shape = (fields: readonly string[], required: readonly string[]) => '{' + fields
    .filter(field => placement !== 'initial-draft' || field !== 'creates')
    .map(field => field + (required.includes(field) ? '' : '?')).join(',') + '}';
  return `spawn_summon:${shape(SUMMON_AUTHORING_FIELDS, ['id', 'name', 'emoji'])}；actions:[${shape(SUMMON_ACTION_AUTHORING_FIELDS, ['id', 'name', 'effects'])}]；abilities:[${shape(SUMMON_ABILITY_AUTHORING_FIELDS, ['id', 'name', 'trigger'])}]。唯一性由 slot 明确：有 slot 为同一召唤者同槽唯一，无 slot 为非唯一且每次创建独立实例。模板 id 不是场上实例 id，不能写入 selector.id；按类型手选使用 {pick:"choose",template_id:"模板ID"}，唯一目标使用 slot 筛选。唯一召唤可写 on_existing:"reinforce" 与 on_existing_effects：已有单位时不新增，执行这些效果而不再默认增加基础生命；self 指该召唤物，pick:"source" 指该实例，作用于召唤者须用 summoner_effects。首次召唤不执行 on_existing_effects。通用 activate_summon 立即行动；若要命令所选单位单次执行新行动，写 activate_summon:{selector,action:{id,name,effects}}，该行动来源永远是被选召唤物；trigger_summon_death 仅触发所选单位的 defeated 能力，不使其退场；dismiss_summon 实际退场并触发死亡能力。三者均使用 {selector:{...}}，不要仅在说明中承诺。`;
}
