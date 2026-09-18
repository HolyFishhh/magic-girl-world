import { roundBattleDisplayValue } from '../../game-core/battleMath';
import { escapeHtml, escapeHtmlAttribute } from '../shared/html';

export function stageHealthBar(hp: unknown, maxHp: unknown, name = '单位', block: unknown = 0): string {
  const current = typeof hp === 'number' && Number.isFinite(hp) ? Math.max(0, roundBattleDisplayValue(hp)) : 0;
  const maximum = typeof maxHp === 'number' && Number.isFinite(maxHp) ? Math.max(0, roundBattleDisplayValue(maxHp)) : 0;
  const shield = typeof block === 'number' && Number.isFinite(block) ? Math.max(0, roundBattleDisplayValue(block)) : 0;
  const percent = maximum > 0 ? Math.min(100, current / maximum * 100) : 0;
  return `<span class="stage-health-row${shield > 0 ? ' has-shield' : ''}"><span class="stage-unit-health" role="progressbar" aria-label="${escapeHtmlAttribute(name)}生命" aria-valuemin="0" aria-valuemax="${maximum}" aria-valuenow="${current}" aria-valuetext="${current}/${maximum}"><i class="stage-health-loss" style="width:${percent}%"></i><i class="stage-health-current" style="width:${percent}%"></i><b>${current}/${maximum}</b></span>${shield > 0 ? `<span class="stage-unit-shield" aria-label="${escapeHtmlAttribute(name)}格挡 ${shield}" title="格挡 ${shield}">🛡${shield}</span>` : ''}</span>`;
}

/** Stable rings expand instead of imposing a display cap. */
export function summonOrbitOffset(index: number, count: number): { x: number; y: number } {
  let ring = 0, local = index, capacity = 8;
  while (local >= capacity) { local -= capacity; ring++; capacity = 8 + ring * 4; }
  const actual = Math.min(capacity, count - (index - local));
  const angle = (-90 + 360 * local / Math.max(1, actual)) * Math.PI / 180;
  return { x: Math.round(Math.cos(angle) * (49 + ring * 28)), y: Math.round(Math.sin(angle) * (42 + ring * 26)) };
}

export function stageSummonMarkup(unit: any, index: number, orbit: boolean,
  badges: readonly { icon: string; value: string; label: string }[], detail: string): string {
  const name = String(unit.name || unit.templateId || '召唤物');
  const intent = badges.map(badge => `<span class="stage-intent-badge" title="${escapeHtmlAttribute(badge.label)}">${escapeHtml(badge.icon)}<b>${escapeHtml(badge.value)}</b></span>`).join('');
  const health = unit.hasHp === false ? '<span class="stage-summon-no-hp">无生命</span>' : stageHealthBar(unit.currentHp, unit.maxHp, name, unit.block);
  return `<button type="button" class="stage-summon-unit" data-summon-index="${index}" data-summon-id="${escapeHtmlAttribute(String(unit.instanceId || ''))}" data-summoner-id="${escapeHtmlAttribute(String(unit.summonerId || ''))}" aria-label="查看召唤单位：${escapeHtmlAttribute(name)}" title="${escapeHtmlAttribute(detail)}">
    ${orbit ? '' : `<span class="stage-summon-intent">${intent}</span>`}
    <span class="stage-summon-emoji" aria-hidden="true">${escapeHtml(String(unit.emoji || '◆'))}</span>
    ${orbit ? '' : health}
  </button>`;
}

/** Anchor each enemy summon to its actual summoner; no state or RNG is touched. */
export function positionStageSummonOrbits(root: ParentNode = document): void {
  for (const side of ['player', 'enemy']) {
    const container = root.querySelector<HTMLElement>(`#${side}-summons.is-orbit`);
    if (!container) continue;
    const bounds = container.getBoundingClientRect();
    const units = Array.from(container.querySelectorAll<HTMLElement>('.stage-summon-unit'));
    const groups = new Map<string, HTMLElement[]>();
    for (const unit of units) {
      const key = side === 'player' ? 'player' : unit.dataset.summonerId || '';
      groups.set(key, [...(groups.get(key) || []), unit]);
    }
    for (const [summonerId, members] of groups) {
      const enemy = Array.from(root.querySelectorAll<HTMLElement>('#stage-enemy-party .stage-enemy-member'))
        .find(entry => entry.dataset.enemyId === summonerId);
      const anchor = side === 'player' ? root.querySelector('#stage-player-emoji')
        : (enemy?.querySelector('.stage-emoji') || root.querySelector('#stage-enemy-emoji'));
      const rect = anchor?.getBoundingClientRect();
      const x = rect ? rect.left + rect.width / 2 - bounds.left : bounds.width / 2;
      const y = rect ? rect.top + rect.height / 2 - bounds.top : bounds.height / 2;
      members.forEach((unit, index) => {
        const offset = summonOrbitOffset(index, members.length);
        unit.style.left = `${x}px`; unit.style.top = `${y}px`;
        unit.style.setProperty('--summon-x', `${offset.x}px`); unit.style.setProperty('--summon-y', `${offset.y}px`);
      });
    }
  }
}
