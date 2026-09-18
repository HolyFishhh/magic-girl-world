type RecordValue = Record<string, any>;
const record = (value: unknown): value is RecordValue => !!value && typeof value === 'object' && !Array.isArray(value);
const equal = (a: any, b: any): boolean => {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && equal(a[key], b[key]));
};

/** Apply only the UI transaction's delta to the latest snapshot. Node content
 * completion does not increment route revision, so revision checks alone lose it.
 * Conflicting leaves/arrays reject atomically; never replay an effectful updater. */
export function mergeMessageVariableUpdate(base: RecordValue, next: RecordValue, latest: RecordValue): RecordValue {
  function merge(before: any, after: any, current: any, path: string): any {
    if (equal(before, after)) return structuredClone(current);
    if (equal(before, current) || equal(after, current)) return structuredClone(after);
    if (record(before) && record(after) && record(current)) {
      const result = structuredClone(current);
      for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
        const had = Object.hasOwn(before, key), has = Object.hasOwn(after, key), now = Object.hasOwn(current, key);
        if (had === has && equal(before[key], after[key])) continue;
        if (!has) {
          if (now && !equal(before[key], current[key])) throw new Error(`后台已更新 ${path}.${key}，本次操作未保存，请重试`);
          delete result[key];
        } else if (!had) {
          if (now && !equal(after[key], current[key])) throw new Error(`后台已更新 ${path}.${key}，本次操作未保存，请重试`);
          result[key] = structuredClone(after[key]);
        } else {
          if (!now) throw new Error(`后台已移除 ${path}.${key}，本次操作未保存，请重试`);
          result[key] = merge(before[key], after[key], current[key], `${path}.${key}`);
        }
      }
      return result;
    }
    throw new Error(`后台已更新 ${path}，本次操作未保存，请重试`);
  }
  return merge(base, next, latest, '变量');
}
