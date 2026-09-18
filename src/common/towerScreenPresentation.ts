import { escapeHtml } from '../fish/shared/html';
import { isLockedTowerMapRun } from './towerMapMode';
import { isTowerInitialSetup } from '../shared/initialPresentation';

type Screen = 'map' | 'room' | 'battle-reward' | 'setup';
const BACKDROP_KEY = '__MWG_BATTLE_REWARD_BACKDROP__';
const dismissed = new Set<string>();
const sceneKey = (stat: any) => JSON.stringify([stat?.run?.seed, stat?.run?.act, stat?.run?.floor, stat?.run?.visitedNodeIds?.at(-1)]);
const revealKey = (stat: any) => JSON.stringify([stat?.run?.seed, stat?.run_event_reveal?.node_id, stat?.run_event_reveal?.choice_id]);

export function towerScreenFor(stat: any, hasRewards: boolean, revealDismissed = false): Screen {
  const run = stat?.run;
  if (!run) return 'setup';
  if (stat.initial_artifact_acquisition?.phase === 'pending') return 'room';
  const lastVisited = run.visitedNodeIds?.at(-1);
  const kind = run.currentNode?.kind || run.lastNodeKind || run.map?.nodes?.find((node: any) => node.id === lastVisited)?.kind
    || run.nodeContent?.[lastVisited]?.kind;
  if (hasRewards && ['battle', 'elite', 'boss'].includes(kind)) return 'battle-reward';
  if (run.opening && !['consumed', 'skipped'].includes(run.opening.phase)) return 'room';
  if (run.phase !== 'awaiting_choice' || hasRewards) return 'room';
  if (stat.run_event_reveal && !revealDismissed) return 'room';
  return 'map';
}

/** Only the completed visual is retained; the live battle is still torn down. */
export function captureBattleRewardBackdrop(stat: any): void {
  if (typeof document === 'undefined') return;
  const scene = document.getElementById('battle-scene');
  if (!scene) return;
  const clone = scene.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('.battle-end-dialog,script,.support-details-popover,.card-tooltip').forEach(node => node.remove());
  clone.setAttribute('inert', '');
  const styles = Array.from(document.querySelectorAll('style')).map(style => style.textContent || '').join('\n');
  (globalThis as any)[BACKDROP_KEY] = { key: sceneKey(stat), html: clone.outerHTML, styles };
}

export function currentTowerScreen(stat: any, hasRewards: boolean): Screen {
  return towerScreenFor(stat, hasRewards, dismissed.has(revealKey(stat)));
}

/** Keep controller anchors alive independently of removable legacy folds.
 * These are DOM-only repairs: no run state or generation transaction is changed.
 */
export function ensureTowerRunDom(): void {
  const ensure = (id: string, tag: string, parent: HTMLElement): HTMLElement => {
    const existing = document.getElementById(id);
    if (existing) return existing;
    const node = document.createElement(tag);
    node.id = id;
    parent.append(node);
    return node;
  };
  const host = ensure('tower-screen-host', 'section', document.body);
  const room = ensure('tower-room-page', 'section', host);
  // The legacy controller still writes this section's classes, but its actual
  // status/actions live outside folds which the story renderer may remove.
  const section = ensure('run-section', 'section', host);
  const feedback = ensure('tower-run-feedback', 'section', room);
  feedback.setAttribute('aria-label', '当前地点准备状态');
  for (const [id, tag] of [['run-current', 'strong'], ['run-actions', 'div'], ['run-error', 'div']]) {
    const node = ensure(id, tag, feedback);
    if (node.parentElement !== feedback) feedback.append(node);
    node.hidden = false;
    if (id === 'run-error') node.setAttribute('role', 'alert');
    if (id !== 'run-current') node.classList.add(id);
  }
  const panel = ensure('tower-node-panel-root', 'div', room);
  panel.classList.add('tower-node-panel-host');
  if (panel.closest('#mwg-route-fold, #mwg-adventure-fold') || section.contains(panel)) room.append(panel);
  const map = ensure('tower-map-root', 'div', host);
  map.classList.add('tower-map-common-host');
  if (map.closest('#mwg-route-fold, #mwg-adventure-fold') || section.contains(map)) host.append(map);
}

export function renderTowerScreen(stat: any, hasRewards: boolean, refresh: () => void): void {
  if (isLockedTowerMapRun(stat, stat?.run)) ensureTowerRunDom();
  const screen = currentTowerScreen(stat, hasRewards);
  document.body.dataset.towerScreen = screen;
  const story = document.getElementById('mwg-story-panel');
  if (story) story.hidden = isTowerInitialSetup(stat);
  const panel = document.getElementById('tower-node-panel-root');
  const rewards = document.getElementById('choice-container');
  const map = document.getElementById('tower-map-root');
  const activity = document.getElementById('mwg-adventure-fold');
  const route = document.getElementById('mwg-route-fold');
  if (activity) activity.hidden = true;
  if (route) route.hidden = true;
  let host = document.getElementById('tower-screen-host');
  if (!host) { host = document.createElement('section'); host.id = 'tower-screen-host'; document.body.prepend(host); }
  // Only the middle section changes. Story and status remain its siblings.
  if (story && story.nextElementSibling !== host) host.before(story);
  const status = document.getElementById('mwg-status-fold');
  if (status) {
    status.hidden = isTowerInitialSetup(stat);
    if (host.nextElementSibling !== status) host.after(status);
  }
  let room = document.getElementById('tower-room-page');
  if (!room) { room = document.createElement('section'); room.id = 'tower-room-page'; host.append(room); }
  let battle = document.getElementById('tower-battle-rewards-page');
  if (!battle) { battle = document.createElement('section'); battle.id = 'tower-battle-rewards-page'; host.append(battle); }
  room.hidden = screen !== 'room'; battle.hidden = screen !== 'battle-reward';
  if (panel && panel.parentElement !== room) room.append(panel);
  document.getElementById('common-loading-status')?.remove();
  let loading = document.getElementById('tower-room-loading');
  const roomHasContent = [panel].some(node => node && !node.hidden && node.style.display !== 'none' && node.childElementCount > 0);
  const feedback = document.getElementById('tower-run-feedback');
  const error = document.getElementById('run-error');
  const hasError = !!error?.textContent?.trim() && error.style.display !== 'none';
  if (feedback) {
    if (feedback.parentElement !== room) room.append(feedback);
    feedback.hidden = screen !== 'room' || (roomHasContent && !hasError);
  }
  const hasFeedback = !!feedback && !feedback.hidden && !!feedback.textContent?.trim();
  if (screen === 'room' && !roomHasContent && !hasRewards && !hasFeedback) {
    if (!loading) { loading = document.createElement('p'); loading.id = 'tower-room-loading'; loading.setAttribute('role', 'status'); room.prepend(loading); }
    loading.textContent = stat?.run?.opening?.phase === 'failed'
      ? '当前地点生成失败，请在生成进度中查看原因并重试。'
      : '正在加载当前地点…生成完成后会自动显示剧情与可选内容。';
  } else loading?.remove();
  if (map) { if (map.parentElement !== host) host.append(map); map.hidden = screen !== 'map'; map.style.display = screen === 'map' ? '' : 'none'; }
  if (rewards) {
    const destination = screen === 'battle-reward' ? battle : room;
    if (rewards.parentElement !== destination) destination.append(rewards);
    rewards.setAttribute('role', screen === 'battle-reward' ? 'dialog' : 'region');
    rewards.setAttribute('aria-label', screen === 'battle-reward' ? '领取战利品' : '当前地点奖励');
    if (screen === 'battle-reward') rewards.setAttribute('aria-modal','true'); else rewards.removeAttribute('aria-modal');
  }
  document.getElementById('tower-room-return')?.remove();
  if (screen === 'room' && stat?.run?.phase === 'awaiting_choice' && !hasRewards && stat.run_event_reveal
    && ['consumed','skipped'].includes(stat.run.opening?.phase)) {
    const back = document.createElement('button'); back.id = 'tower-room-return'; back.className = 'btn btn-primary';
    back.textContent = '返回路线图'; back.addEventListener('click', () => { dismissed.add(revealKey(stat)); document.dispatchEvent(new CustomEvent('mwg-user-navigate', { detail: '#tower-map-root' })); refresh(); }); room.append(back);
  }
  if (screen === 'battle-reward' && !battle.querySelector('#tower-battle-backdrop')) {
    const background = document.createElement('div'); background.id = 'tower-battle-backdrop'; background.setAttribute('inert','');
    background.setAttribute('aria-hidden','true'); battle.prepend(background);
    const saved = (globalThis as any)[BACKDROP_KEY];
    const shadow = background.attachShadow({ mode: 'open' });
    if (saved?.key === sceneKey(stat)) {
      const style = document.createElement('style'); style.textContent = saved.styles.replace(/:root\b/g, ':host') + '\n#battle-scene{min-height:720px!important;max-height:none!important}';
      shadow.append(style); const content = document.createElement('div'); content.innerHTML = saved.html; shadow.append(content);
    } else {
      // Refresh recovery uses persisted post-combat facts, never reruns the fight.
      const core = stat?.battle?.core || {};
      shadow.innerHTML = `<style>:host{display:block;min-height:720px;background:radial-gradient(ellipse at 50% 30%,#343356,#121b31);color:#e6eeff}section{padding:60px 28px;font:18px system-ui}footer{margin-top:430px}</style><section><h2>战斗结束</h2><p>战利品等待领取</p><footer>我方生命 ${escapeHtml(String(core.hp ?? '—'))} / ${escapeHtml(String(core.max_hp ?? '—'))}</footer></section>`;
    }
    battle.classList.add('mwg-battle-reward-entering');
    window.setTimeout(() => battle.classList.remove('mwg-battle-reward-entering'), 220);
  }
  if (screen !== 'battle-reward') {
    battle.querySelector('#tower-battle-backdrop')?.remove();
    delete (globalThis as any)[BACKDROP_KEY];
  }
}
