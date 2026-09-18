import { sha256 } from '../shared/sha256';

const KEY = 'mwg.schema-capability/v1';
const TTL = 30 * 60 * 1000;
type Store = Pick<Storage, 'getItem' | 'setItem'>;
type Entry = { fingerprint: string; expiresAt: number };
const record = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);

function defaultStorage(): Store | undefined {
  // Same-origin capability evidence must survive closing/reopening a tab.
  // Its lifetime is still bounded by each entry's existing TTL, not storage lifetime.
  try { if (globalThis.localStorage) return globalThis.localStorage; } catch { /* optional */ }
  try { return globalThis.sessionStorage; } catch { return undefined; }
}

/** Expiry-bound negative capability evidence. Never store the route itself,
 * credentials, schema, game data or provider response. Storage is optional. */
export function createSchemaCapabilityCache(
  storage: () => Store | undefined = defaultStorage,
  now: () => number = Date.now,
) {
  const entries = (): Entry[] => {
    try {
      const parsed: unknown = JSON.parse(storage()?.getItem(KEY) || '[]');
      if (!Array.isArray(parsed) || parsed.length > 16) return [];
      return parsed.filter((entry): entry is Entry => record(entry)
        && Object.keys(entry).sort().join(',') === 'expiresAt,fingerprint'
        && typeof entry.fingerprint === 'string' && /^[a-f0-9]{64}$/.test(entry.fingerprint)
        && Number.isFinite(entry.expiresAt) && entry.expiresAt > now() && entry.expiresAt <= now() + TTL);
    } catch { return []; }
  };
  return {
    async fingerprint(settings: unknown): Promise<string | undefined> {
      if (!record(settings) || settings.chat_completion_source !== 'custom'
        || typeof settings.custom_model !== 'string' || !settings.custom_model.trim()
        || typeof settings.custom_url !== 'string' || !settings.custom_url.trim()
        || ![undefined, ''].includes(settings.custom_include_body)
        || ![undefined, ''].includes(settings.custom_exclude_body)) return;
      try {
        return await sha256(JSON.stringify([settings.custom_model, settings.custom_url]));
      } catch { return; }
    },
    has(fingerprint: string | undefined): boolean {
      return !!fingerprint && entries().some(entry => entry.fingerprint === fingerprint);
    },
    remember(fingerprint: string | undefined): void {
      if (!fingerprint || !/^[a-f0-9]{64}$/.test(fingerprint)) return;
      try {
        const next = entries().filter(entry => entry.fingerprint !== fingerprint).slice(-15);
        next.push({ fingerprint, expiresAt: now() + TTL });
        storage()?.setItem(KEY, JSON.stringify(next));
      } catch { /* A denied/full store must never prevent a generation. */ }
    },
  };
}
