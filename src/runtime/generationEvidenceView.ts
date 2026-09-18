export interface EvidenceListRecord {
  key: string;
  requestId: string;
  stage: string;
  kind: string;
  recordedAt: number;
  text: string;
}

/** Bounded DOM only. Export continues to use the untouched complete archive. */
export function renderGenerationEvidencePage(
  container: HTMLElement,
  page: { total: number; records: EvidenceListRecord[] },
  loadMore: () => void,
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
    let shown = 0;
    const reveal = () => {
      const next = Math.min(record.text.length, shown + 12000);
      pre.append(doc.createTextNode(record.text.slice(shown,next)));
      shown = next; more.hidden = shown >= record.text.length;
    };
    detail.append(summary, pre, more);
    detail.addEventListener('toggle', () => { if (detail.open && shown === 0) reveal(); });
    more.addEventListener('click', reveal);
    container.append(detail);
    if (open.has(record.key)) { detail.open = true; reveal(); }
  }
  if (page.records.length < page.total) {
    const button = doc.createElement('button'); button.type = 'button'; button.textContent = '加载更早的 5 条';
    button.addEventListener('click', loadMore); container.append(button);
  }
}
