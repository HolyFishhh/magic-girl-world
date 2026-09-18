import { renderStatusReferences, type StatusReference } from './statusReference';

/** Groups come from executable structure, never punctuation in authored prose. */
export function renderRulePills(groups: readonly string[], references: readonly StatusReference[] = []): string {
  const rules = groups.filter(text => text.trim());
  if (!rules.length) return '';
  return `<div class="mwg-rule-pills">${rules.map(text => `<span class="mwg-rule-pill">${renderStatusReferences(text, references)}</span>`).join('')}</div>`;
}
