export interface EvidenceFileReference {
  sha256: string;
  bytes: number;
  parts: { sha256: string; bytes: number }[];
}
export interface EvidenceFilePorts {
  upload(name: string, bytes: Uint8Array): Promise<void>;
  download(name: string, expectedBytes: number): Promise<Uint8Array>;
}
const PART_BYTES = 1024 * 1024;
export const MAX_EVIDENCE_FILE_BYTES = 64 * PART_BYTES;
const CACHE_BYTES = 2 * PART_BYTES;
const hashPattern = /^[a-f0-9]{64}$/;
const filename = (hash: string) => `mwg-evidence-${hash}.txt`;
const hash = async (bytes: Uint8Array): Promise<string> => Array.from(
  new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>)),
  byte => byte.toString(16).padStart(2, '0'),
).join('');

export function validEvidenceReference(value: unknown): value is EvidenceFileReference {
  const ref = value as EvidenceFileReference | undefined;
  return !!ref && hashPattern.test(ref.sha256) && Number.isSafeInteger(ref.bytes)
    && ref.bytes > 0 && ref.bytes <= MAX_EVIDENCE_FILE_BYTES && Array.isArray(ref.parts)
    && ref.parts.length > 0 && ref.parts.length <= 64
    && ref.parts.every(part => part && hashPattern.test(part.sha256) && Number.isSafeInteger(part.bytes) && part.bytes > 0 && part.bytes <= PART_BYTES)
    && ref.parts.reduce((sum, part) => sum + part.bytes, 0) === ref.bytes;
}

/** Immutable, content-addressed files in the authenticated Tavern user's files.
 * Metadata cannot nominate arbitrary URLs or filesystem paths.
 */
export class EvidenceFileStore {
  private cache = new Map<string, Uint8Array>();
  private cacheBytes = 0;
  constructor(private readonly ports: EvidenceFilePorts) {}
  clearCache(): void { this.cache.clear(); this.cacheBytes = 0; }

  private remember(key: string, bytes: Uint8Array): void {
    if (bytes.length > CACHE_BYTES || this.cache.has(key)) return;
    while (this.cacheBytes + bytes.length > CACHE_BYTES) {
      const first = this.cache.keys().next().value!;
      this.cacheBytes -= this.cache.get(first)!.length; this.cache.delete(first);
    }
    this.cache.set(key, bytes); this.cacheBytes += bytes.length;
  }

  async write(chatId: string, value: unknown, assertCurrent: () => void = () => {}): Promise<EvidenceFileReference> {
    const bytes = new TextEncoder().encode(JSON.stringify({ spec: 'mwg.evidence-file/v1', chatId, value }));
    if (bytes.length > MAX_EVIDENCE_FILE_BYTES) throw new Error('单条记录超过64MiB，未归档；原文仍保留在聊天内，请先导出');
    const parts: EvidenceFileReference['parts'] = [];
    for (let offset = 0; offset < bytes.length; offset += PART_BYTES) {
      assertCurrent();
      const part = bytes.subarray(offset, offset + PART_BYTES), digest = await hash(part);
      assertCurrent();
      await this.ports.upload(filename(digest), part);
      assertCurrent();
      // A successful upload response alone is not proof of durable contents.
      const readBack = await this.ports.download(filename(digest), part.length);
      if (readBack.length !== part.length || await hash(readBack) !== digest) throw new Error('记录文件回读校验失败，已保留聊天内原文');
      parts.push({ sha256: digest, bytes: part.length });
    }
    assertCurrent();
    const ref = { sha256: await hash(bytes), bytes: bytes.length, parts };
    assertCurrent();
    this.remember(`${chatId}:${ref.sha256}`, bytes);
    return ref;
  }

  async read(chatId: string, ref: EvidenceFileReference, assertCurrent: () => void = () => {}): Promise<unknown> {
    if (!validEvidenceReference(ref)) throw new Error('生成记录文件引用无效，已停止读取');
    assertCurrent();
    const cacheKey = `${chatId}:${ref.sha256}`;
    let bytes = this.cache.get(cacheKey);
    if (!bytes) {
      bytes = new Uint8Array(ref.bytes);
      let offset = 0;
      for (const part of ref.parts) {
        assertCurrent();
        const data = await this.ports.download(filename(part.sha256), part.bytes);
        assertCurrent();
        if (data.length !== part.bytes || await hash(data) !== part.sha256) throw new Error('生成记录文件已变化或损坏，无法验证原文');
        bytes.set(data, offset); offset += data.length;
      }
      if (await hash(bytes) !== ref.sha256) throw new Error('生成记录完整性校验失败');
    }
    const envelope = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (envelope?.spec !== 'mwg.evidence-file/v1' || envelope.chatId !== chatId || !Object.hasOwn(envelope, 'value'))
      throw new Error('生成记录不属于当前聊天或格式不受支持');
    assertCurrent(); this.remember(cacheKey, bytes);
    return envelope.value;
  }
}

export function createTavernEvidenceFilePorts(headers: () => Record<string, string>): EvidenceFilePorts {
  const request = async (url: string, init: RequestInit) => {
    const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 15000);
    try {
      const response = await fetch(url, { ...init, signal: abort.signal, credentials: 'same-origin', redirect: 'error' });
      if (!response.ok) throw new Error(`记录文件服务返回 HTTP ${response.status}`);
      return { response, finish: () => clearTimeout(timer) };
    } catch (error) { clearTimeout(timer); throw error; }
  };
  return {
    async upload(name, bytes) {
      let binary = '';
      for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
      const { response, finish } = await request('/api/files/upload', {
        method: 'POST', headers: { ...headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, data: btoa(binary) }),
      });
      try { await response.arrayBuffer(); } finally { finish(); }
    },
    async download(name, expectedBytes) {
      const { response, finish } = await request(`/user/files/${name}`, { method: 'GET', headers: headers(), cache: 'no-store' });
      try {
        const reader = response.body?.getReader();
        if (!reader) throw new Error('记录文件读取流不可用');
        const bytes = new Uint8Array(expectedBytes); let offset = 0;
        try {
          while (true) {
            const part = await reader.read(); if (part.done) break;
            if (offset + part.value.length > expectedBytes) throw new Error('记录文件大小与索引不符');
            bytes.set(part.value, offset); offset += part.value.length;
          }
        } catch (error) { await reader.cancel().catch(() => {}); throw error; }
        finally { reader.releaseLock(); }
        if (offset !== expectedBytes) throw new Error('记录文件读取不完整');
        return bytes;
      } finally { finish(); }
    },
  };
}
