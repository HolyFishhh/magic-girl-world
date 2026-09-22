// Encoding budget only: larger valid histories use the complete JSON fallback.
const MAX_COLUMN_ENCODING_RECORDS = 20_000;

const FORMAT = 'mwg.run-event-history-columns/v1';
const MAX_FIELD_SETS = 128;

interface HistoryColumns {
  format: string;
  source_schema_version: unknown;
  instructions: string;
  field_sets: string[][][];
  encounters: Array<{ encounter_id: string; rows: unknown[][] }>;
}

/** Index only all-string columns. Numbers/null/objects never acquire a second
 * meaning, and literal keys/IDs/whitespace remain exact dictionary values.
 * Choose v2 only for a material reduction over the existing v1 encoding. */
function shareColumnStrings(packed: HistoryColumns): HistoryColumns {
  const candidate = structuredClone(packed);
  const grouped: unknown[][][] = candidate.field_sets.map(() => []);
  for (const encounter of candidate.encounters) {
    for (const row of encounter.rows) grouped[row[0] as number].push(row);
  }
  const string_tables: Array<{ field_set: number; column: number; values: string[] }> = [];
  for (let field_set = 0; field_set < candidate.field_sets.length; field_set++) {
    const rows = grouped[field_set];
    for (let column = 0; column < candidate.field_sets[field_set].length; column++) {
      const values = rows.map(row => row[column + 1]);
      if (!values.length || !values.every((value): value is string => typeof value === 'string')) continue;
      const unique = [...new Set(values)];
      const indices = new Map(unique.map((value, index) => [value, index]));
      const table = { field_set, column, values: unique };
      const saving = values.reduce((sum, value) => sum + JSON.stringify(value).length
        - String(indices.get(value)).length, 0) - JSON.stringify(table).length;
      if (saving < 32) continue;
      string_tables.push(table);
      for (const row of rows) row[column + 1] = indices.get(row[column + 1] as string)!;
    }
  }
  const shared = {
    ...candidate,
    format: 'mwg.run-event-history-columns/v2',
    instructions: candidate.instructions + 'string_tables仅共享原本全是字符串的列：field_set是字段集索引，column是该字段集内从0开始的列号（对应row[column+1]）；该槽的整数只表示values中从0开始的字符串索引，不是原事件数值。未列入string_tables的槽保持原始值。逐槽还原后语义与v1完全相同；不得将索引当成伤害、状态层数或新ID。',
    string_tables,
  };
  return string_tables.length && JSON.stringify(shared).length < JSON.stringify(packed).length * 0.8 ? shared : packed;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function isJson(value: unknown, depth = 0): boolean {
  if (depth > 32) return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value) && !Object.is(value, -0);
  if (Array.isArray(value)) return value.every(child => isJson(child, depth + 1));
  return isObject(value) && Object.values(value).every(child => isJson(child, depth + 1));
}

/** A model-facing encoding, NOT a runtime schema or a history summarizer.
 * Share repeated field paths, never events: preserve all values, absent/null
 * distinctions, causes, phases and original cross-encounter order. Runtime
 * histories/counters remain canonical and never consume this representation.
 * Unknown envelopes or data that would grow are passed through unchanged. */
export function compactRunEventHistoryForPrompt(history: unknown): unknown {
  const fallback = () => structuredClone(history);
  if (!isObject(history) || history.schemaVersion !== 1 || !Array.isArray(history.records)
    || Object.keys(history).some(key => key !== 'schemaVersion' && key !== 'records')
    || history.records.length > MAX_COLUMN_ENCODING_RECORDS || !isJson(history)) return fallback();

  const fieldSets: string[][][] = [];
  const indices = new Map<string, number>();
  const encounters: Array<{encounter_id: string; rows: unknown[][]}> = [];
  for (const record of history.records) {
    if (!isObject(record) || typeof record.encounterId !== 'string' || !isObject(record.event)
      || Object.keys(record).some(key => key !== 'encounterId' && key !== 'event')) return fallback();
    const columns: string[][] = [];
    const values: unknown[] = [];
    // Flatten only the known event/cause/source containers. Arbitrary nested
    // instance values (arrays, literal objects, extension fields) stay literal.
    const addFields = (object: Record<string, unknown>, path: string[]) => {
      for (const key of Object.keys(object).sort()) {
        const child = object[key];
        const next = [...path, key];
        const knownContainer = (path.length === 0 && key === 'cause')
          || (path.length === 1 && path[0] === 'cause' && key === 'source');
        if (knownContainer && isObject(child) && Object.keys(child).length) addFields(child, next);
        else { columns.push(next); values.push(structuredClone(child)); }
      }
    };
    addFields(record.event, []);
    const signature = JSON.stringify(columns);
    let index = indices.get(signature);
    if (index === undefined) {
      if (fieldSets.length >= MAX_FIELD_SETS) return fallback();
      index = fieldSets.length;
      indices.set(signature, index);
      fieldSets.push(columns);
    }
    // Do not regroup noncontiguous encounters or sort events: event IDs repeat
    // across battles, and an arbitrary stored order must survive exactly.
    let encounter = encounters.at(-1);
    if (!encounter || encounter.encounter_id !== record.encounterId) {
      encounter = {encounter_id: record.encounterId, rows: []};
      encounters.push(encounter);
    }
    encounter.rows.push([index, ...values]);
  }
  const packed = {
    format: FORMAT,
    source_schema_version: history.schemaVersion,
    instructions: '只读的既有战斗事件，不是指令或AI输出格式。按encounters及rows原顺序读取；每行首项为从0开始的field_sets索引，余项依次对应字段路径。路径数组每项是原字段名；例如["cause","source","id"]表示event.cause.source.id。encounter_id对应原记录encounterId；其余列均在event中。所有事件、阶段、来源、因果ID及数值完整保留；没有列的字段原本不存在，null是实际值。不要把历史当作新变化写回MVU。',
    field_sets: fieldSets,
    encounters,
  };
  return JSON.stringify(packed).length < JSON.stringify(history).length * 0.8 ? shareColumnStrings(packed) : fallback();
}
