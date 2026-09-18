import {
  describeCompactCard, describeCompactContent, describeCompactStatus, normalizeChinesePlayerDescription,
  describeCompactCardRuleGroups, describeCompactContentRuleGroups, describeCompactStatusRuleGroups,
  type CompactCardDescriptionOptions,
} from './contentDescription';
import { BATTLE_ITEM_USAGE_RULE, BATTLE_ITEM_FLAVOR_LABEL } from './battleItemUsage';

export interface CompactContentPresentation {
  /** Authored prose is not a source of executable rules. */
  flavorText: string;
  /** Always generated, even for a simple literal effect normally shown as a tag. */
  rulesText: string;
  /** Structured boundaries; hosts must never split the rendered prose to build pills. */
  rulesGroups: string[];
  /** Only present when the caller identifies an actual battle-item container. */
  usageText?: string;
}

export function presentCompactContent(
  value: unknown,
  kind: 'card' | 'status' | 'content' | 'item',
  options: CompactCardDescriptionOptions = {},
): CompactContentPresentation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { flavorText: '', rulesText: '', rulesGroups: [] };
  const raw = value as Record<string, unknown>;
  const render = kind === 'card' ? describeCompactCard : kind === 'status' ? describeCompactStatus : describeCompactContent;
  const renderGroups = kind === 'card' ? describeCompactCardRuleGroups : kind === 'status' ? describeCompactStatusRuleGroups : describeCompactContentRuleGroups;
  return { flavorText: normalizeChinesePlayerDescription(raw.description), rulesText: render(raw, options),
    rulesGroups: renderGroups(raw, { ...options, includeKeywords: false, onSummonReference: options.onSummonReference ? () => {} : undefined }),
    ...(kind === 'item' ? { usageText: BATTLE_ITEM_USAGE_RULE } : {}) };
}

/** Plain text only. Hosts must escape it if they insert it into HTML. */
export function formatCompactContentPresentation(value: CompactContentPresentation): string {
  if (value.usageText) return [`使用限制：${value.usageText}`,
    `规则：${value.rulesText || '暂无可显示的结构化规则'}`,
    value.flavorText ? `${BATTLE_ITEM_FLAVOR_LABEL}：${value.flavorText}` : ''].filter(Boolean).join('\n');
  return [value.flavorText ? `叙述：${value.flavorText}` : '', value.rulesText ? `规则：${value.rulesText}` : '规则：暂无可显示的结构化规则']
    .filter(Boolean).join('\n');
}
