export interface EvidenceListRecord {
  key: string;
  requestId: string;
  stage: string;
  kind: string;
  recordedAt: number;
  text?: string;
  characters?: number;
}

/** Bounded DOM only. Export continues to use the untouched complete archive. */
export function renderGenerationEvidencePage(
  container: HTMLElement,
  page: { total: number; records: EvidenceListRecord[] },
  loadMore: () => void,
  loadRecord?: (key: string) => Promise<{ text: string; full: unknown }>,
): void {
  const doc = container.ownerDocument;
  const open = new Set(Array.from(container.querySelectorAll<HTMLDetailsElement>('details[open]')).map(el => el.dataset.evidenceKey));
  container.replaceChildren();
  const note = doc.createElement('small');
  note.textContent = `显示最新 ${page.records.length} 条，共 ${page.total} 条。点击单条查看原文；完整内容保留在导出中。`;
  container.append(note);
  const labels: Record<string,string> = { request:'请求',response:'返回',outcome:'结果',failure:'失败','repair-final':'修改返回','provider-final':'生成返回','validation-errors':'校验问题' };
  for (const record of page.records) {
    const detail = doc.createElement('details'); detail.className = 'mwg-process-block'; detail.dataset.evidenceKey = record.key;
    const summary = doc.createElement('summary');
    summary.textContent = `${new Date(record.recordedAt).toLocaleString('zh-CN')} · ${record.kind} · ${labels[record.stage] || record.stage}`;
    summary.title = record.requestId;
    const pre = doc.createElement('pre');
    const more = doc.createElement('button'); more.type = 'button'; more.textContent = '继续显示这条原文'; more.hidden = true;
    const download = doc.createElement('button'); download.type = 'button'; download.textContent = '下载这条完整记录'; download.hidden = true;
    let shown = 0, text = record.text, full: unknown = record.text, loading = false;
    const reveal = () => {
      if (text === undefined) return;
      const next = Math.min(text.length, shown + 12000);
      pre.append(doc.createTextNode(text.slice(shown,next)));
      shown = next; more.hidden = shown >= text.length; download.hidden = false;
    };
    const openRecord = async () => {
      if (loading) return;
      if (text !== undefined) { if (!shown) reveal(); return; }
      loading = true; pre.textContent = '正在读取并校验原文…'; more.hidden = true;
      try {
        if (!loadRecord) throw Error('原文读取接口不可用，请刷新页面');
        const loaded = await loadRecord(record.key);
        if (!container.contains(detail)) return;
        text = loaded.text; full = loaded.full; pre.textContent = ''; more.textContent = '继续显示这条原文'; reveal();
      } catch (error) {
        if (!container.contains(detail)) return;
        pre.textContent = error instanceof Error ? error.message : String(error);
        more.textContent = '重试读取原文'; more.hidden = false;
      } finally { loading = false; }
    };
    detail.append(summary, pre, more, download);
    detail.addEventListener('toggle', () => { if (detail.open && shown === 0) void openRecord(); });
    more.addEventListener('click', () => { if (text === undefined) void openRecord(); else reveal(); });
    download.addEventListener('click', () => {
      if (full === undefined) return;
      const blob = new Blob([typeof full === 'string' ? full : JSON.stringify(full, null, 2)], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob), link = doc.createElement('a');
      link.href = url; link.download = `mwg-generation-record-${record.recordedAt}.json`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    container.append(detail);
    if (open.has(record.key)) { detail.open = true; void openRecord(); }
  }
  if (page.records.length < page.total) {
    const button = doc.createElement('button'); button.type = 'button'; button.textContent = '加载更早的 5 条';
    button.addEventListener('click', loadMore); container.append(button);
  }
}
