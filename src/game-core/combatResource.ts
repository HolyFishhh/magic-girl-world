export type CardCostComponent = number | 'all';
export type CompositeCardCost = Readonly<Record<string, CardCostComponent>>;
export type CardCost = number | 'energy' | CompositeCardCost;

export interface CombatResourceState {
  id: string;
  name: string;
  emoji: string;
  current: number;
  max: number;
  /** reset refills at player turn start; retain preserves the previous amount. */
  refresh: 'reset' | 'retain';
}

export type CombatResourcePool = Readonly<Record<string, number>>;
export type CardResourceWaiver = 'all' | readonly string[] | undefined;

export interface CardResourcePayment {
  affordable: boolean;
  required: Record<string, number>;
  spent: Record<string, number>;
  xValues: Record<string, number>;
  waived: string[];
  shortage?: { resource: string; required: number; available: number };
  /** Compatibility projections for existing X-energy formulas and logs. */
  requiredEnergy: number;
  spentEnergy: number;
  xValue: number;
}

const RESOURCE_ID = /^[A-Za-z_][A-Za-z0-9_]*$/;
const RESOURCE_FIELDS = new Set(['id', 'name', 'emoji', 'current', 'max', 'refresh']);

export interface CombatResourceDefinitionIssue {
  path: string;
  code:
    | 'INVALID_RESOURCE_COLLECTION'
    | 'TOO_MANY_RESOURCES'
    | 'INVALID_RESOURCE_ENTRY'
    | 'UNKNOWN_RESOURCE_FIELD'
    | 'INVALID_RESOURCE_ID'
    | 'DUPLICATE_RESOURCE_ID'
    | 'INVALID_RESOURCE_NAME'
    | 'INVALID_RESOURCE_EMOJI'
    | 'INVALID_RESOURCE_VALUE'
    | 'INVALID_RESOURCE_REFRESH';
  message: string;
}

function amount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

export function isCompositeCardCost(value: unknown): value is CompositeCardCost {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function validateCardCost(value: unknown): string | null {
  if (value === undefined) return null;
  if (value === 'energy') return null;
  if (typeof value === 'number') {
    return Number.isInteger(value) && value >= 0 ? null : 'numeric card cost must be a non-negative integer';
  }
  if (!isCompositeCardCost(value)) return 'card cost must be a number, energy, or resource map';
  const entries = Object.entries(value);
  if (entries.length < 1 || entries.length > 16) return 'resource cost must contain 1..16 components';
  for (const [id, component] of entries) {
    if (!RESOURCE_ID.test(id)) return `invalid resource id: ${id}`;
    if (component !== 'all' && (!Number.isInteger(component) || component < 0))
      return `resource cost ${id} must be a non-negative integer or all`;
  }
  return null;
}

export function normalizeCardCost(value: CardCost | undefined): CompositeCardCost {
  if (value === undefined) return {};
  if (value === 'energy') return { energy: 'all' };
  if (typeof value === 'number') return { energy: Math.max(0, Math.floor(value)) };
  return Object.fromEntries(Object.entries(value).map(([id, component]) => [
    id,
    component === 'all' ? 'all' : Math.max(0, Math.floor(component)),
  ]));
}

/**
 * Convert a heterogeneous cost into one advisory scalar without coercing an
 * object through Number(). Runtime affordability must still use
 * resolveCardResourcePayment; this helper is only for sorting and balance
 * estimates where different resource channels need a stable common weight.
 */
export function estimateCardCostWeight(
  cost: CardCost | undefined,
  available: CombatResourcePool = {},
  allFallback = 3,
): number {
  const components = normalizeCardCost(cost);
  return Object.entries(components).reduce((sum, [resource, component]) => {
    if (component !== 'all') return sum + component;
    const stock = available[resource];
    return sum + (typeof stock === 'number' && Number.isFinite(stock) ? amount(stock) : amount(allFallback));
  }, 0);
}

/** Resolve all cost components once; no resource is mutated until the caller commits the complete payment. */
export function resolveCardResourcePayment(
  cost: CardCost | undefined,
  available: CombatResourcePool,
  waiver: CardResourceWaiver,
  xValueBonus = 0,
): CardResourcePayment {
  const invalid = validateCardCost(cost);
  if (invalid) throw new Error(invalid);
  const components = normalizeCardCost(cost);
  const waivedSet = waiver === 'all' ? new Set(Object.keys(components)) : new Set(waiver || []);
  const required: Record<string, number> = {};
  const spent: Record<string, number> = {};
  const xValues: Record<string, number> = {};
  let shortage: CardResourcePayment['shortage'];

  for (const [resource, component] of Object.entries(components)) {
    const stock = amount(available[resource]);
    const waived = waivedSet.has(resource);
    const payment = waived ? 0 : component === 'all' ? stock : component;
    required[resource] = component === 'all' || waived ? 0 : component;
    spent[resource] = payment;
    if (component === 'all') xValues[resource] = payment + (resource === 'energy' ? amount(xValueBonus) : 0);
    if (!waived && component !== 'all' && stock < component && !shortage) {
      shortage = { resource, required: component, available: stock };
    }
  }

  return {
    affordable: !shortage,
    required,
    spent,
    xValues,
    waived: [...waivedSet].sort(),
    ...(shortage ? { shortage } : {}),
    requiredEnergy: required.energy || 0,
    spentEnergy: spent.energy || 0,
    xValue: xValues.energy || 0,
  };
}

export function applyCardResourcePayment(
  available: CombatResourcePool,
  payment: CardResourcePayment,
): Record<string, number> {
  if (!payment.affordable) throw new Error('cannot apply an unaffordable resource payment');
  const next: Record<string, number> = { ...available };
  for (const [resource, spent] of Object.entries(payment.spent)) {
    const stock = amount(next[resource]);
    if (stock < spent) throw new Error(`resource changed before commit: ${resource}`);
    next[resource] = stock - spent;
  }
  return next;
}

export function normalizeCombatResourceStates(
  value: unknown,
): Record<string, CombatResourceState> {
  const entries = Array.isArray(value) ? value : value && typeof value === 'object' ? Object.values(value) : [];
  const result: Record<string, CombatResourceState> = {};
  for (const raw of entries) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const item = raw as Record<string, unknown>;
    const id = typeof item.id === 'string' && RESOURCE_ID.test(item.id) ? item.id : '';
    if (!id || id === 'energy' || result[id]) continue;
    const max = amount(item.max);
    result[id] = {
      id,
      name: typeof item.name === 'string' && item.name.trim() ? item.name.trim() : id,
      emoji: typeof item.emoji === 'string' && item.emoji.trim() ? item.emoji.trim() : '◆',
      current: Math.min(max, amount(item.current)),
      max,
      refresh: item.refresh === 'reset' ? 'reset' : 'retain',
    };
  }
  return result;
}

/** Strict authoring validation; normalization remains tolerant only for old saves. */
export function validateCombatResourceDefinitions(
  value: unknown,
  path = 'resources',
): CombatResourceDefinitionIssue[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    return [{ path, code: 'INVALID_RESOURCE_COLLECTION', message: '自定义资源必须是数组' }];
  }
  const issues: CombatResourceDefinitionIssue[] = [];
  if (value.length > 16) {
    issues.push({ path, code: 'TOO_MANY_RESOURCES', message: '自定义资源最多 16 项' });
  }
  const ids = new Set<string>();
  value.forEach((raw, index) => {
    const entryPath = `${path}[${index}]`;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      issues.push({ path: entryPath, code: 'INVALID_RESOURCE_ENTRY', message: '资源定义必须是对象' });
      return;
    }
    const item = raw as Record<string, unknown>;
    for (const key of Object.keys(item)) {
      if (!RESOURCE_FIELDS.has(key)) {
        issues.push({ path: `${entryPath}.${key}`, code: 'UNKNOWN_RESOURCE_FIELD', message: `不支持的资源字段: ${key}` });
      }
    }
    const id = item.id;
    if (typeof id !== 'string' || !RESOURCE_ID.test(id) || id === 'energy') {
      issues.push({ path: `${entryPath}.id`, code: 'INVALID_RESOURCE_ID', message: '资源 ID 必须是稳定英文 ID 且不能是 energy' });
    } else if (ids.has(id)) {
      issues.push({ path: `${entryPath}.id`, code: 'DUPLICATE_RESOURCE_ID', message: `资源 ID 重复: ${id}` });
    } else {
      ids.add(id);
    }
    if (typeof item.name !== 'string' || !item.name.trim()) {
      issues.push({ path: `${entryPath}.name`, code: 'INVALID_RESOURCE_NAME', message: '资源名称不能为空' });
    }
    if (typeof item.emoji !== 'string' || !item.emoji.trim()) {
      issues.push({ path: `${entryPath}.emoji`, code: 'INVALID_RESOURCE_EMOJI', message: '资源 emoji 不能为空' });
    }
    if (!Number.isInteger(item.max) || Number(item.max) <= 0) {
      issues.push({ path: `${entryPath}.max`, code: 'INVALID_RESOURCE_VALUE', message: '资源上限必须是正整数' });
    }
    if (
      !Number.isInteger(item.current) ||
      Number(item.current) < 0 ||
      (Number.isInteger(item.max) && Number(item.current) > Number(item.max))
    ) {
      issues.push({ path: `${entryPath}.current`, code: 'INVALID_RESOURCE_VALUE', message: '资源当前值必须是 0..max 内的整数' });
    }
    if (item.refresh !== 'reset' && item.refresh !== 'retain') {
      issues.push({ path: `${entryPath}.refresh`, code: 'INVALID_RESOURCE_REFRESH', message: '资源刷新方式只能是 reset 或 retain' });
    }
  });
  return issues;
}

export function resourcePoolFromCombatant(
  energy: number,
  resources?: Readonly<Record<string, CombatResourceState>>,
): Record<string, number> {
  return {
    energy: amount(energy),
    ...Object.fromEntries(Object.entries(resources || {}).map(([id, resource]) => [id, amount(resource.current)])),
  };
}

export function applyResourcePoolToStates(
  resources: Readonly<Record<string, CombatResourceState>> | undefined,
  pool: CombatResourcePool,
): Record<string, CombatResourceState> {
  return Object.fromEntries(Object.entries(resources || {}).map(([id, resource]) => [
    id,
    { ...resource, current: Math.min(resource.max, amount(pool[id])) },
  ]));
}

export function refreshCombatResourceStates(
  resources: Readonly<Record<string, CombatResourceState>> | undefined,
): Record<string, CombatResourceState> {
  return Object.fromEntries(Object.entries(resources || {}).map(([id, resource]) => [
    id,
    { ...resource, current: resource.refresh === 'reset' ? resource.max : resource.current },
  ]));
}

export function describeCardCost(
  cost: CardCost | undefined,
  resources?: Readonly<Record<string, Pick<CombatResourceState, 'name' | 'emoji'>>>,
): string {
  const components = normalizeCardCost(cost);
  if (Object.keys(components).length === 0) return '0';
  return Object.entries(components).map(([id, component]) => {
    const resource = resources?.[id];
    const label = resource ? `${resource.emoji}${resource.name}` : id === 'energy' ? '💎能量' : id;
    return `${component === 'all' ? 'X' : component}${label}`;
  }).join(' + ');
}
