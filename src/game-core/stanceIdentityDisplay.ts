import jsep from 'jsep';

/** Resolve labels from actual compact/compiled stance definitions, never prose. */
export function collectStanceNames(...roots: unknown[]): Record<string, string> {
  const names: Record<string, string> = Object.create(null);
  const conflicts = new Set<string>();
  const seen = new WeakSet<object>();
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    const stance = (value as Record<string, any>).stance;
    if (stance && typeof stance.id === 'string' && typeof stance.name === 'string' && stance.name.trim()) {
      const name = stance.name.trim();
      if (names[stance.id] && names[stance.id] !== name) conflicts.add(stance.id);
      if (!conflicts.has(stance.id)) names[stance.id] = name;
      else delete names[stance.id];
    }
    Object.values(value).forEach(visit);
  };
  roots.forEach(visit);
  return names;
}

/** Collect executable stance definitions from the whole visible content scope. */
export function collectStanceDefinitions(...roots: unknown[]): Record<string, Record<string, unknown>> {
  const definitions: Record<string, Record<string, unknown>> = Object.create(null);
  const conflicts = new Set<string>();
  const seen = new WeakSet<object>();
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    const stance = (value as Record<string, unknown>).stance;
    if (stance && typeof stance === 'object' && !Array.isArray(stance)) {
      const definition = stance as Record<string, unknown>;
      const id = typeof definition.id === 'string' ? definition.id : '';
      if (id) {
        if (definitions[id] && JSON.stringify(definitions[id]) !== JSON.stringify(definition)) conflicts.add(id);
        if (!conflicts.has(id)) definitions[id] = definition;
        else delete definitions[id];
      }
    }
    Object.values(value).forEach(visit);
  };
  roots.forEach(visit);
  return definitions;
}

export function describeStanceIdentity(
  holder: string, relation: 'eq' | 'neq', id: string | null, names?: Readonly<Record<string, string>>,
): string {
  if (id === null) return `${holder}${relation === 'eq' ? '没有' : '具有'}当前姿态`;
  const name = names && Object.prototype.hasOwnProperty.call(names, id) ? names[id] : undefined;
  return `${holder}${relation === 'eq' ? '处于' : '不处于'}${name || '指定姿态（名称未解析）'}`;
}

/** Parentheses and reversed operands must not bypass identity-label rendering. */
export function describeStanceFormula(
  source: string, names?: Readonly<Record<string, string>>,
  labels: { selfLabel?: string; opponentLabel?: string } = {},
): string {
  if (!source.includes('.stance')) return source;
  let found = false;
  const target = (node: jsep.Expression): string | null => {
    if (node.type !== 'MemberExpression') return null;
    const member = node as jsep.MemberExpression;
    return !member.computed && member.object.type === 'Identifier' && member.property.type === 'Identifier' &&
      ['self', 'opponent'].includes((member.object as jsep.Identifier).name) &&
      (member.property as jsep.Identifier).name === 'stance' ? (member.object as jsep.Identifier).name : null;
  };
  const render = (node: jsep.Expression): string => {
    if (node.type === 'BinaryExpression') {
      const binary = node as jsep.BinaryExpression;
      const holder = target(binary.left) || target(binary.right);
      const literal = target(binary.left) ? binary.right : binary.left;
      const id = literal.type === 'Literal' ? (literal as jsep.Literal).value : undefined;
      if (holder && ['==', '!='].includes(binary.operator) &&
        (id === null || (typeof id === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(id)))) {
        found = true;
        return describeStanceIdentity(holder === 'self' ? (labels.selfLabel || '自身') : (labels.opponentLabel || '对方'),
          binary.operator === '==' ? 'eq' : 'neq', id as string | null, names);
      }
      return `(${render(binary.left)} ${binary.operator} ${render(binary.right)})`;
    }
    if (node.type === 'ConditionalExpression') {
      const ternary = node as jsep.ConditionalExpression;
      return `（${render(ternary.test)}时为${render(ternary.consequent)}，否则为${render(ternary.alternate)}）`;
    }
    if (node.type === 'UnaryExpression') {
      const unary = node as jsep.UnaryExpression;
      return unary.operator === '!' ? `不满足“${render(unary.argument)}”` : `${unary.operator}(${render(unary.argument)})`;
    }
    if (node.type === 'Literal') return JSON.stringify((node as jsep.Literal).value);
    if (node.type === 'Identifier') return (node as jsep.Identifier).name;
    if (node.type === 'MemberExpression') {
      const member = node as jsep.MemberExpression;
      if (!member.computed) return `${render(member.object)}.${render(member.property)}`;
    }
    if (node.type === 'CallExpression') {
      const call = node as jsep.CallExpression;
      return `${render(call.callee)}(${call.arguments.map(render).join(', ')})`;
    }
    throw new Error('Unsupported display expression');
  };
  try { const rendered = render(jsep(source)); return found ? rendered : source; }
  catch { return source; }
}
