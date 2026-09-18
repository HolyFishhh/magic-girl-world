/** Shared facts for compact and compiled stance rules. Fragments come only
 * from actual effects; authored descriptions never supply missing mechanics.
 */
export function describeStanceLifecycle(details: {
  enter?: string; passive?: string; events?: string; exit?: string;
}): string {
  return [
    details.enter ? `进入时：${details.enter}` : '',
    details.passive ? `持续：${details.passive}` : '',
    details.events ? `仅此姿态生效期间：${details.events}` : '',
    details.exit ? `退出时：${details.exit}` : '',
    '重复进入同一姿态不触发进入或退出效果',
  ].filter(Boolean).join('；');
}
