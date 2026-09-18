/** Current event identity, not a query about whether a status is held. */
export function describeStatusEventIdentity(name: string, negated = false): string {
  const text = `本次获得、叠加或移除的状态为「${name}」`;
  return negated ? `不满足“${text}”` : text;
}
