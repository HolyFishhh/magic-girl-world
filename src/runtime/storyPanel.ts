import { renderCharacterStatus } from '../shared/characterStatus';
import { getCurrentChatMessageText, getCurrentMessageVariables } from './messageVariables';
import { readGameMode } from '../game-core/towerMode';
import { isTowerInitialSetup } from '../shared/initialPresentation';

const lastPanelRenderKey = new WeakMap<Document, string>();

export function cleanDisplayedStory(value: unknown): string {
  return String(value || '')
    .replace(/<(UpdateVariable|VariableUpdate|Update|think|thinking|analysis|reasoning)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<(?:think|thinking|analysis|reasoning)\b[^>]*>[\s\S]*$/gi, '')
    .replace(/<\/?(?:StatusPlaceHolderImpl|TOWER_STATUS|BATTLE_START|BATTLE_PENDING|CONTENT_PENDING|CHARACTER_INIT_PENDING)\s*\/?\s*>/gi, '')
    .replace(/\[(?:开始游戏|剧情模式开场|爬塔模式开场)\]/g, '').trim();
}

/** Read-only story view. Never rewrites MVU or exposes prefetched unvisited nodes. */
export function renderStoryPanel(view: 'common' | 'fish'): void {
  const nodePanel = document.getElementById('tower-node-panel-root');
  const variables = getCurrentMessageVariables();
  const stat = variables?.stat_data || {};
  const storyMode = readGameMode(stat) === 'story';
  document.body.classList.toggle('mwg-story-mode', storyMode);
  if (storyMode) {
    document.documentElement.classList.remove('mwg-expedition-terminal');
    document.getElementById('mwg-story-panel')?.remove();
    if (view === 'common') {
      document.getElementById('mwg-status-fold')?.remove();
      const header = document.querySelector<HTMLElement>('.statusbar-header');
      if (header) header.hidden = false;
    }
    return;
  }
  const run = stat.run || stat.completed_expedition?.run;
  const terminal = view === 'common' && ['won', 'lost'].includes(stat.run?.phase);
  document.documentElement.classList.toggle('mwg-expedition-terminal', terminal);
  const introduction = cleanDisplayedStory(variables?.mwg_tower_initial_commit?.narrative || getCurrentChatMessageText());
  const currentNodeId = String(stat.run_node?.node_id || run?.currentNode?.id || run?.currentNodeId || '');
  const current = cleanDisplayedStory(stat.run_node?.narrative || run?.nodeContent?.[currentNodeId]?.content?.narrative);
  const battleTitle = String(stat.run_node?.title || run?.nodeContent?.[currentNodeId]?.content?.title || stat.battle?.name || '').trim() || '战斗';
  const opening = run?.opening;
  const openingNarrative = cleanDisplayedStory(opening?.content?.narrative);
  const openingIsActive = opening && opening.phase !== 'consumed' && opening.phase !== 'skipped';
  // The initial commit and its gift are one scene. Keeping them in a single
  // prose container prevents the story shell and gift panel from presenting
  // two disconnected beginnings while a choice is still pending.
  // Preset prose is authoritative; the mechanism draft's opening narrative is
  // only a legacy fallback, not a second independently-authored introduction.
  // The initial commit belongs only to Act 1. Once a later act is active,
  // never fall back to that stale greeting while its own opening is pending.
  const isLaterAct = Number(run?.act || 1) > 1;
  const initialScene = isLaterAct
    ? openingNarrative
    : (introduction || openingNarrative);
  const latestVisitedId = [...(run?.visitedNodeIds || [])].reverse().find((id: string) =>
    cleanDisplayedStory(run?.nodeContent?.[id]?.content?.narrative));
  const latestVisitedStory = latestVisitedId ? cleanDisplayedStory(run.nodeContent[latestVisitedId].content.narrative) : '';
  const battleStories: any[] = Array.isArray(stat.tower_battle_stories) ? stat.tower_battle_stories : [];
  const latestBattleStory = [...battleStories].reverse().find(entry => entry.seed === run?.seed && entry.nodeId === (run?.visitedNodeIds || []).at(-1));
  const showBattleStory = view === 'common' && run?.phase !== 'in_node' && latestBattleStory;
  const postBattleText = showBattleStory && latestBattleStory.phase === 'ready' ? cleanDisplayedStory(latestBattleStory.narrative) : '';
  const displayedStory = postBattleText || current || (openingIsActive
    ? (initialScene || (isLaterAct ? '正在生成本幕开场剧情…' : ''))
    : latestVisitedStory || initialScene);
  const nodeId = currentNodeId;
  const renderKey = JSON.stringify([battleStories, view, terminal, nodeId, battleTitle, displayedStory, initialScene, openingIsActive,
    run?.act, run?.floor, (run?.visitedNodeIds || []).map((id: string) => [id, run.nodeContent?.[id]?.content?.narrative])]);
  let root = document.getElementById('mwg-story-panel');
  if (!root) {
    root = document.createElement('section'); root.id = 'mwg-story-panel';
    const board = view === 'fish' ? document.getElementById('battle-scene')?.closest('.card-game-container') : null;
    if (board?.parentElement) board.before(root);
    else if (view === 'fish') document.body.append(root);
    else document.body.prepend(root);
  }
  // The story is refreshed passively during battle. Exclude its changing prose
  // from browser scroll-anchor selection so the host's real scrolling ancestor
  // (which may be outside this iframe) keeps the board in place. Explicit
  // common-view reward/choice focus remains outside this renderer.
  if (view === 'fish') root.style.overflowAnchor = 'none';
  root.hidden = view === 'common' && isTowerInitialSetup(stat);
  const needsRender = lastPanelRenderKey.get(document) !== renderKey || !root.childElementCount;
  if (needsRender) {
  lastPanelRenderKey.set(document, renderKey);
  if (nodePanel && root.contains(nodePanel)) nodePanel.remove();
  const heading = root.querySelector('h2') || document.createElement('h2');
  heading.textContent = view === 'fish'
    ? battleTitle
    : current
      ? '当前剧情'
      : openingIsActive
        ? String(opening?.content?.title || '').trim() || '启程剧情'
        : latestVisitedStory ? '最新剧情' : '启程剧情';
  const steps = root.querySelector<HTMLElement>('.story-steps') || document.createElement('p'); steps.className = 'story-steps';
  steps.textContent = openingIsActive ? '启程' : `第 ${run?.act || 1} 幕 · 第 ${run?.currentNode?.floor || run?.floor || 0} 层`;
  let reading = root.querySelector<HTMLElement>('.story-reading-pane');
  if (!reading) { reading = document.createElement('div'); reading.className = 'story-reading-pane'; reading.tabIndex = 0; reading.setAttribute('aria-label', '剧情与历史'); root.replaceChildren(steps, heading, reading); }
  let body = reading.querySelector<HTMLElement>(':scope > .story-prose');
  if (!body) { body = document.createElement('div'); body.className = 'story-prose'; reading.prepend(body); }
  if (body.textContent !== displayedStory) body.textContent = displayedStory || '等待当前剧情…';
  let battleStatus = reading.querySelector<HTMLElement>('.post-battle-story-status');
  if (!battleStatus) { battleStatus = document.createElement('p'); battleStatus.className = 'post-battle-story-status'; reading.append(battleStatus); }
  battleStatus.textContent = showBattleStory && ['pending', 'generating'].includes(latestBattleStory.phase)
    ? '正在生成战后剧情…可以继续选择路线，不影响后续节点生成。'
    : showBattleStory && latestBattleStory.phase === 'failed' ? '战后剧情生成失败；战斗已结算，可以继续旅程。' : '';
  battleStatus.hidden = !battleStatus.textContent;
  if (postBattleText) heading.textContent = '战后剧情';
  let history = reading.querySelector('details');
  if (!history) { history = document.createElement('details'); reading.append(history); }
  const summary = document.createElement('summary'); summary.textContent = '预览过去剧情';
  const entries: Array<[string, string]> = [];
  if (initialScene && initialScene !== displayedStory) entries.push(['启程剧情', initialScene]);
  for (const id of run?.visitedNodeIds || []) {
    if (id === currentNodeId || (!postBattleText && !current && !openingIsActive && id === latestVisitedId)) continue;
    const entry = run.nodeContent?.[id];
    const content = entry?.content;
    const kind = entry?.kind || run.map?.nodes?.find((node: any) => node.id === id)?.kind;
    const label: Record<string, string> = { battle: '战斗', elite: '精英战斗', boss: '首领战斗', treasure: '宝箱', rest: '休息', shop: '商店', event: '事件' };
    if (content?.narrative) entries.push([`${label[kind] || '旅程'}${content.title ? `-${content.title}` : ''}剧情`, cleanDisplayedStory(content.narrative)]);
  }
  for (const story of battleStories) {
    if (story.phase === 'ready' && story.narrative && cleanDisplayedStory(story.narrative) !== displayedStory)
      entries.push(['战后剧情', cleanDisplayedStory(story.narrative)]);
  }
  const archiveKey = JSON.stringify(entries);
  if (history.dataset.archiveKey !== archiveKey) {
  history.dataset.archiveKey = archiveKey;
  history.replaceChildren(summary);
  for (const [title, narrative] of entries) {
    const item = document.createElement('article'); const label = document.createElement('h3'); label.textContent = title;
    const prose = document.createElement('div'); prose.className = 'story-prose'; prose.textContent = narrative;
    item.append(label, prose); history.append(item);
  }
  if (!entries.length) { const empty = document.createElement('p'); empty.textContent = '暂无过去剧情'; history.append(empty); }
  }
  // The same top section remains present after settlement as well.
  if (terminal) heading.textContent = '旅程回顾';
  }
  const playerPanel = document.getElementById('tower-player-panel');
  if (view === 'common' && playerPanel) {
    const status = renderCharacterStatus(stat);
    // Keep legacy transaction controls available without rendering a second,
    // mode-dependent character panel.
    playerPanel.hidden = true;
    if (status.contains(playerPanel)) document.body.append(playerPanel);
    const removal = document.getElementById('tower-player-resolve-removals');
    if (removal && !removal.hidden && removal.parentElement !== status) status.append(removal);
    const legacyHeader = document.querySelector<HTMLElement>('.statusbar-header');
    if (legacyHeader) legacyHeader.hidden = true;
    // The tower screen owns these nodes after the first full render. Prose is
    // refreshed independently; moving them back into hidden legacy folds here
    // would empty the active room every 750 ms.
    if (document.body.dataset.towerScreen) {
      const host = document.getElementById('tower-screen-host');
      if (host && root.nextElementSibling !== host) host.before(root);
      if (host && host.nextElementSibling !== status) host.after(status);
      return;
    }
    let host = document.getElementById('tower-screen-host');
    if (!host) { host = document.createElement('section'); host.id = 'tower-screen-host'; document.body.prepend(host); }
    if (root.nextElementSibling !== host) host.before(root);
    if (host.nextElementSibling !== status) host.after(status);
    if (nodePanel && nodePanel.parentElement !== host) host.append(nodePanel);
    const rewards = document.getElementById('choice-container');
    if (rewards && rewards.parentElement !== host) host.append(rewards);
    const map = document.getElementById('tower-map-root');
    if (map) {
      if (map.parentElement !== host) host.append(map);
      map.hidden = readGameMode(stat) !== 'tower';
    }
    document.getElementById('mwg-adventure-fold')?.remove();
    document.getElementById('mwg-route-fold')?.remove();
  } else if (view === 'fish') {
    const scene = document.getElementById('battle-scene');
    const board = scene?.closest('.card-game-container');
    // The bounded reading pane absorbs late prose and archive growth.
    if (board?.parentElement && root.nextElementSibling !== board) board.before(root);
  }
}
