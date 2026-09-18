import jsep from 'jsep';

/** Display-only shorthand: collapse a half only when it reads the resource being assigned. */
export function describeResourceHalf(value: unknown, owner: string, id: string): string | undefined {
  const path = `${owner}.resource.${id}.current`;
  const memberPath = (node: any): string | undefined => {
    if (node?.type === 'Identifier') return node.name;
    if (node?.type === 'MemberExpression' && !node.computed) {
      const parent = memberPath(node.object);
      return parent ? `${parent}.${node.property.name}` : undefined;
    }
    return undefined;
  };
  let half = false;
  if (typeof value === 'string') {
    try {
      const node: any = jsep(value);
      if (node.type !== 'CallExpression' || node.callee?.name !== 'floor' || node.arguments.length !== 1) return;
      const inner = node.arguments[0];
      const number = (n: any, expected: number) => n?.type === 'Literal' && n.value === expected;
      half = inner.type === 'BinaryExpression' && (
        inner.operator === '/' && memberPath(inner.left) === path && number(inner.right, 2)
        || inner.operator === '*' && (
          memberPath(inner.left) === path && number(inner.right, 0.5)
          || memberPath(inner.right) === path && number(inner.left, 0.5)));
    } catch { return; }
  } else if (value && typeof value === 'object') {
    const node = value as any;
    if (node.op !== 'floor') return;
    const inner = node.value;
    const same = (n: any) => n?.op === 'var' && n.path === path;
    half = inner?.op === 'divide' && same(inner.left) && inner.right === 2
      || inner?.op === 'multiply' && (same(inner.left) && inner.right === 0.5 || same(inner.right) && inner.left === 0.5);
  }
  return half ? '一半（向下取整）' : undefined;
}
