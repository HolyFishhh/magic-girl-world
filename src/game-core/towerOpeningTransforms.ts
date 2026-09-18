import { migratePersistentRunDeck, applyPersistentDeckMutation } from './cardProgression';

export const OPENING_TRANSFORM_FILTER_FIELDS = ['ids', 'names', 'name_contains', 'types'] as const;
export const OPENING_OUTCOME_FIELDS = [
  'hp',
  'max_hp',
  'lust',
  'max_lust',
  'gold',
  'card_removals',
  'reward',
  'deck_transforms',
] as const;
export interface OpeningDeckTransform {
  filter: Partial<Record<(typeof OPENING_TRANSFORM_FILTER_FIELDS)[number], string[]>>;
  replacement: Record<string, unknown>;
}
const record = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
export function parseOpeningDeckTransforms(value: unknown): OpeningDeckTransform[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 16) throw Error('馈赠 deck_transforms 必须是最多16项的数组');
  return value.map(raw => {
    if (
      !record(raw) ||
      Object.keys(raw).some(k => !['filter', 'replacement'].includes(k)) ||
      !record(raw.filter) ||
      !Object.keys(raw.filter).length ||
      Object.keys(raw.filter).some(k => !(OPENING_TRANSFORM_FILTER_FIELDS as readonly string[]).includes(k))
    )
      throw Error('馈赠转化必须包含非空 filter 和完整 replacement');
    for (const entries of Object.values(raw.filter))
      if (
        !Array.isArray(entries) ||
        !entries.length ||
        entries.length > 64 ||
        entries.some(v => typeof v !== 'string' || !v.trim())
      )
        throw Error('馈赠转化筛选值必须是非空字符串数组');
    if (!record(raw.replacement) || ('quantity' in raw.replacement && raw.replacement.quantity !== 1))
      throw Error('馈赠转化 replacement 必须是单张完整卡牌，quantity只能为1');
    return structuredClone(raw) as OpeningDeckTransform;
  });
}
export function openingTransformMatches(card: Record<string, any>, filter: OpeningDeckTransform['filter']): boolean {
  return (
    (!filter.ids || filter.ids.some(id => id === card.id || id === card.templateId)) &&
    (!filter.names || filter.names.includes(String(card.name || ''))) &&
    (!filter.name_contains || filter.name_contains.some(part => String(card.name || '').includes(part))) &&
    (!filter.types || filter.types.includes(String(card.type || '')))
  );
}
/** All selections are frozen against the pre-gift deck; replacements never cascade. */
export function applyOpeningDeckTransforms(
  cards: readonly Record<string, any>[],
  value: unknown,
  prepare: (
    replacement: Record<string, unknown>,
    cards: Record<string, any>[],
    source: string,
  ) => Record<string, unknown>,
): Record<string, any>[] {
  const actions = parseOpeningDeckTransforms(value);
  let next = migratePersistentRunDeck(cards);
  const selected = actions.map(action =>
    next.filter(card => openingTransformMatches(card, action.filter)).map(card => card.runInstanceId),
  );
  const used = new Set<string>();
  for (const group of selected)
    for (const id of group) {
      if (used.has(id)) throw Error('馈赠转化筛选重叠，同一持有实例不能转化两次');
      used.add(id);
    }
  actions.forEach((action, index) => {
    for (const source of selected[index]) {
      const replacement = prepare(action.replacement, next, source);
      next = applyPersistentDeckMutation(next, { kind: 'transform', runInstanceId: source, replacement }).cards;
      // This boundary stores compact MVU cards, not runtime-only patch arrays.
      // Persistent progression is already carried by the mutation's $meta.
      const transformed = next.find(card => card.runInstanceId === source)!;
      delete transformed.patches;
      delete transformed.attachments;
    }
  });
  return next;
}
export function createOpeningDeckTransformsSchema(card: Record<string, unknown>): Record<string, unknown> {
  return {
    type: 'array',
    maxItems: 16,
    items: {
      type: 'object',
      additionalProperties: false,
      required: ['filter', 'replacement'],
      properties: {
        filter: {
          type: 'object',
          additionalProperties: false,
          minProperties: 1,
          properties: Object.fromEntries(
            OPENING_TRANSFORM_FILTER_FIELDS.map(key => [
              key,
              { type: 'array', minItems: 1, maxItems: 64, items: { type: 'string', minLength: 1 } },
            ]),
          ),
        },
        replacement: { allOf: [card, { not: { required: ['card_ref'] }, properties: { quantity: { const: 1 } } }] },
      },
    },
  };
}
export const OPENING_TRANSFORM_GUIDANCE =
  '馈赠也可使用 outcome.deck_transforms:[{filter:{names:["打击","防御"]},replacement:完整单张卡牌}] 将当前持久牌组中所有匹配副本逐张永久转化。filter 支持 ids（模板ID）、names（精确卡名）、name_contains（卡名包含文字）、types（Attack/Skill等类型）；同字段任一匹配，不同字段同时满足。替换牌必须完整预生成且 quantity 为1，不使用 card_ref；新状态按该候选的 statuses 闭包提供。各项按领取前牌组筛选，不连锁转化，不能让同一实例命中多项。没有匹配牌时转化0张，不补发，不影响将来获得的牌；每张保持持有实例身份，唯一性冲突或规则无效时整体失败。不能把只有描述、删除额度或未来奖励说成已完成转化。';
export function describeOpeningDeckTransforms(value: unknown, cards: readonly Record<string, any>[] = []): string[] {
  const types: Record<string, string> = {
    Attack: '攻击牌',
    Skill: '技能牌',
    Power: '能力牌',
    Event: '事件牌',
    Curse: '诅咒牌',
  };
  return parseOpeningDeckTransforms(value).map(action => {
    const f = action.filter;
    const scope = [
      f.ids
        ?.map(id => cards.find(c => c.id === id || c.templateId === id)?.name || id)
        .map(name => `“${name}”`)
        .join('或'),
      f.names?.map(name => `“${name}”`).join('或'),
      f.name_contains?.map(name => `卡名含“${name}”`).join('或'),
      f.types?.map(type => types[type] || type).join('或'),
    ]
      .filter(Boolean)
      .join('且');
    const count = cards
      .filter(card => openingTransformMatches(card, f))
      .reduce((n, c) => n + (Number.isInteger(c.quantity) ? c.quantity : 1), 0);
    return `将当前牌组中全部${scope}（当前${count}张）逐张永久转化为“${action.replacement.name || action.replacement.id}”；仅本次持有副本，保留实例身份，不影响未来副本`;
  });
}
