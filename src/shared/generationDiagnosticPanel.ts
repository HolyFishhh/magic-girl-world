/** One visible diagnostic surface for both mode selection and the tower start form. */
export function installGenerationDiagnosticPanel(container: HTMLElement): void {
  if (container.querySelector('[data-generation-diagnostics]')) return;
  const panel = document.createElement('details');
  panel.dataset.generationDiagnostics = '';
  panel.style.cssText = 'margin:12px 0;padding:12px;border:1px solid #7891b8;border-radius:12px;background:#182239;color:#e7edfa;text-align:left';
  const title = document.createElement('summary'); title.textContent = '生成日志与错误详情';
  const body = document.createElement('pre');
  body.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere;max-height:320px;overflow:auto;font:13px/1.6 system-ui';
  const copy = document.createElement('button'); copy.type = 'button'; copy.textContent = '复制排查信息';
  const inspect = document.createElement('button'); inspect.type = 'button'; inspect.textContent = '查看本次生成原文';
  inspect.addEventListener('click', () => (globalThis as any).MagicGirlWorld?.openGenerationDiagnostics?.());
  const tip = document.createElement('small'); tip.textContent = '只复制阶段与校验信息，不含模型请求、正文和密钥。';
  panel.append(title, body, copy, inspect, tip); container.append(panel);
  let last = '', reportText = '', openedError = '';
  const render = () => {
    const runtime = (globalThis as any).MagicGirlWorld;
    const report = runtime?.getGenerationDiagnosticReport?.();
    const fallback = runtime?.getMvuMonitorSnapshot?.();
    const data = report || (fallback?.phase !== 'idle' ? fallback : null);
    if (!data) { body.textContent = '尚无本聊天的生成记录。开始后这里显示阶段与错误；失败后不会自动消失。'; copy.disabled = true; return; }
    reportText = [data.phase === 'error' ? '生成失败' : '生成进度', `请求：${data.generationId || '尚未建立模型请求'}`,
      ...(data.timeline || []).map((entry: any) => `${Math.max(0, (entry.at - (data.startedAt || entry.at)) / 1000).toFixed(1)}s  ${entry.label} · ${entry.detail || ''}`),
      `当前结果：${data.detail || ''}`, data.note || '旧运行时诊断：刷新以启用脱敏持久记录。'].join('\n');
    if (last !== reportText) { body.textContent = reportText; last = reportText; }
    copy.disabled = !report;
    if (data.phase === 'error' && openedError !== reportText) { panel.open = true; openedError = reportText; }
  };
  copy.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(reportText); copy.textContent = '已复制'; }
    catch { copy.textContent = '请选中上方文本复制'; }
  });
  render();
  const timer = window.setInterval(() => { if (!container.isConnected) window.clearInterval(timer); else render(); }, 1000);
  window.addEventListener('pagehide', () => window.clearInterval(timer), { once: true });
}
