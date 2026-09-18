import { type GameState, effectProgramToDisplayTags, triggeredEffectProgramToDisplayTags, cardAttachmentsToDisplayTags, compactContentToDisplayTags, describeCardCost } from '../game-core';
import { presentCompactContent } from '../game-core/contentPresentation';
import { isTowerInitialSetup } from './initialPresentation';
import { collectStanceDefinitions, collectStanceNames } from '../game-core/stanceIdentityDisplay';
import { collectSummonDisplayNames } from '../game-core/summonDisplayNames';
import { normalizeMvuStatusDefinitions, flattenMvuArray } from '../runtime/mvuArrays';
import { renderCardFace } from './cardFace';
import { renderSupportDetails } from './supportPresentation';
import { renderRulePills } from './rulePills';
import { openMechanicsHelp } from './mechanicsHelpPanel';
import { bindStatusReferenceDetails } from './statusReference';
import { escapeHtml } from '../fish/shared/html';
import { BATTLE_ITEM_USAGE_LABEL } from '../game-core/battleItemUsage';

const cache = new WeakMap<Document, { input: string; latest: () => void }>();
const list = (v: any): any[] => flattenMvuArray(v, { objectsOnly: true });
const names = (values: any[], field = 'name') => Object.fromEntries(values.filter(v => v?.id).map(v => [v.id, v[field] || v.id]));

/** One read-only status surface for combat, rooms, rewards and story. */
export function renderCharacterStatus(stat: Record<string, any>, live?: GameState): HTMLDetailsElement {
  const doc = document;
  let fold = doc.getElementById('mwg-status-fold') as HTMLDetailsElement | null;
  if (!fold) { fold = doc.createElement('details'); fold.id = 'mwg-status-fold'; fold.append(doc.createElement('summary')); }
  fold.classList.add('mwg-section-fold', 'mwg-character-status');
  fold.hidden = !live && isTowerInitialSetup(stat);
  fold.querySelector(':scope > summary')!.textContent = '状态栏';
  const battle = stat.battle || {}, core = battle.core || {}, player = live?.player;
  const cards = player?.deck || list(battle.cards);
  if (cards.length && !fold.dataset.initialDeckShown) { fold.open = true; fold.dataset.initialDeckShown = 'true'; }
  let panel = doc.getElementById('battle-player-overview');
  if (!panel) { panel = doc.createElement('div'); panel.id = 'battle-player-overview'; fold.append(panel); }
  let record = cache.get(doc);
  if (!record) {
    record = { input: '', latest: () => {} }; cache.set(doc, record);
    fold.addEventListener('toggle', () => { if (fold!.open) cache.get(doc)?.latest(); });
  }
  record.latest = () => renderCharacterStatus(stat, live);
  let summary: any;
  try { const api = (window.parent as any)?.MagicGirlDesignAssistant; summary = api?.getCharacterBuildSummary ? api.getCharacterBuildSummary() : api?.getDashboard?.()?.snapshot?.deckProfile; } catch { /* standalone frame */ }
  const profile = summary || battle.design_context?.balance?.deckProfile;
  const hp = player?.currentHp ?? core.hp ?? 0, maxHp = player?.maxHp ?? core.max_hp ?? 0;
  const lust = player?.currentLust ?? core.lust ?? 0, maxLust = player?.maxLust ?? core.max_lust ?? 0;
  const metric = (label: string, value: unknown, kind = '') => `<div class="character-metric ${kind}"><small>${label}</small><strong>${escapeHtml(value)}</strong></div>`;
  const vitalsHTML = `<div class="character-vitals">${metric('生命', `${hp} / ${maxHp}`, 'is-health')}${metric('欲望', `${lust} / ${maxLust}`, 'is-desire')}${metric('能量', `${player?.energy ?? core.energy ?? 0} / ${player?.maxEnergy ?? core.max_energy ?? 0}`)}${metric('金币', stat.run?.gold ?? stat.completed_expedition?.run?.gold ?? 0)}${metric('卡组', `${cards.reduce((n,c) => n + (player ? 1 : Math.max(1, Number(c.quantity) || 1)), 0)} 张`)}</div>`;
  const previousVitals = panel.querySelector('.character-vitals');
  if (previousVitals && previousVitals.outerHTML !== vitalsHTML) previousVitals.outerHTML = vitalsHTML;
  const playerView = player && { deck: player.deck, abilities: player.abilities, relics: player.relics, items: player.items, statusEffects: player.statusEffects, resources: player.resources };
  const next = JSON.stringify([{emoji: core.emoji, resources: core.resources}, battle.statuses, battle.player_lust_effect, playerView || [battle.cards, battle.player_abilities, battle.player_status_effects, battle.artifacts, battle.items], stat.status?.profession, profile]);
  if (!fold.open || (record.input === next && panel.childElementCount)) return fold;
  record.input = next;
  const expanded = new Set(Array.from(panel.querySelectorAll<HTMLDetailsElement>('details[open][data-detail-key]')).map(e => e.dataset.detailKey));
  const definitions = normalizeMvuStatusDefinitions(battle.statuses);
  const definitionMap = Object.fromEntries(definitions.map(v => [v.id, v]));
  const resources = player ? Object.values(player.resources || {}) : list(core.resources);
  const context = { inlineStatusDetails: false, statusNames: names(definitions), statusDefinitions: definitionMap,
    cardNames: names(cards), cardDefinitions: Object.fromEntries(cards.map(c => [c.id, c])),
    resourceNames: names(resources), resourceEmojis: names(resources, 'emoji'),
    summonNames: collectSummonDisplayNames(battle, cards), stanceNames: collectStanceNames(battle, cards), stanceDefinitions: collectStanceDefinitions(battle, cards) };
  const statusReferences = definitions.map(value => ({ id: value.id, name: value.name || value.id,
    rules: presentCompactContent(value, 'status', context).rulesText, flavor: value.description }));
  const rules = (value: any, kind: 'card' | 'status' | 'content' | 'item') => {
    const references: any[] = [...statusReferences];
    if (value.effectProgram) {
      const tags = value.trigger ? triggeredEffectProgramToDisplayTags(value.trigger, value.effectProgram, context, value.eventQuery) : effectProgramToDisplayTags(value.effectProgram, context);
      if (value.protection) tags.push(...compactContentToDisplayTags({ protection: value.protection }, context));
      if (kind === 'card') {
        tags.push(...effectProgramToDisplayTags(value.discardEffectProgram, context).map(t => ({ ...t, text: `弃置此牌时：${t.text}` })));
        tags.push(...cardAttachmentsToDisplayTags(value.attachments || []));
      }
      return renderRulePills(tags.map(t => t.text), [...references, ...tags.flatMap(t => [...(t.references || []), ...(t.reference ? [t.reference] : [])])]);
    }
    const presentation = presentCompactContent(value, kind, { ...context, onCardReference: v => references.push(v), onSummonReference: v => references.push(v), onStanceReference: v => references.push(v) });
    return renderRulePills(presentation.rulesGroups, references);
  };
  const support = (values: any[], kind: string) => values.map((value, i) => {
    const merged = kind === '状态' ? { ...definitionMap[value.id], ...value } : value;
    const key = `${kind}:${value.id || i}`;
    const html = rules(merged, kind === '状态' ? 'status' : kind === '道具' ? 'item' : 'content');
    return `<details class="battle-overview-detail" data-detail-key="${escapeHtml(key)}"${expanded.has(key) ? ' open' : ''}><summary>${escapeHtml(merged.emoji || '✦')} ${escapeHtml(merged.name || merged.id || kind)}${value.stacks != null ? ` ×${escapeHtml(value.stacks)}` : ''}</summary>${renderSupportDetails(merged, { kind, rulesHtml: html || renderRulePills(['暂无可显示的结构化规则']), extraHtml: kind === '道具' ? `<p>${BATTLE_ITEM_USAGE_LABEL}</p>` : '' })}</details>`;
  }).join('') || '<span class="battle-overview-empty">暂无</span>';
  const affinities = (profile?.archetypes || []).slice(0, 3).map((a: any) => a.label).filter(Boolean);
  const score = Number.isFinite(profile?.totalScore) ? `${Math.round(profile.totalScore * 10) / 10} 分` : '等待分析';
  const cardHTML = cards.map(card => `<div class="collection-card">${renderCardFace(card, { costLabel: card.type === 'Curse' ? '—' : describeCardCost(card.cost ?? 0, Object.fromEntries(resources.map(r => [r.id, r]))),
    typeLabel: ({Attack:'攻击',Skill:'技能',Power:'能力',Curse:'诅咒',Event:'事件'} as Record<string,string>)[card.type] || card.type,
    rarityLabel: ({Common:'普通',Uncommon:'罕见',Rare:'稀有',Epic:'史诗',Legendary:'传说',Corrupt:'腐化'} as Record<string,string>)[card.rarity] || card.rarity,
    rulesHtml: rules(card, 'card'), quantity: !player && card.quantity > 1 ? card.quantity : undefined })}</div>`).join('');
  panel.innerHTML = `<header class="character-status-header"><div class="character-identity"><span class="character-portrait" aria-hidden="true">${escapeHtml(core.emoji || '✨')}</span><div><small>旅途中的你</small><strong>${escapeHtml(stat.status?.profession?.name || '角色状态')}</strong></div></div><button type="button" class="character-help-button" aria-haspopup="dialog">? 规则帮助</button></header>
    ${vitalsHTML}
    <section class="character-detail-container" aria-label="角色详情"><h3>角色详情</h3><div class="character-detail-grid">
      <section class="character-build-analysis"><h4>卡组分析</h4><button id="status-build-details" type="button"><span>主要流派 <b id="status-build-archetype">${escapeHtml(affinities.join(' · ') || '等待分析')}</b></span><span>卡组估算 <b id="status-build-score">${escapeHtml(score)}</b></span><small>详细评分与流派分析 ↗</small></button><p>综合能力估算，不是胜率。</p></section>
      <section class="character-desire"><h4>欲望效果</h4><p>敌方欲望满时触发</p>${support(battle.player_lust_effect ? [battle.player_lust_effect] : [], '欲望效果')}</section>
      <section><h4>能力与状态</h4>${support(player?.abilities || list(battle.player_abilities), '能力')}${support(player?.statusEffects || list(battle.player_status_effects), '状态')}</section>
      <section><h4>资源</h4><div class="battle-overview-metrics">${resources.map(r => `<span>${escapeHtml(r.emoji || '◆')} ${escapeHtml(r.name || r.id)} <b>${escapeHtml(r.current ?? r.start ?? 0)}/${escapeHtml(r.max ?? 0)}</b></span>`).join('') || '<span class="battle-overview-empty">暂无</span>'}</div></section>
    </div></section>
    <div class="character-inventory"><section><h3>遗物</h3>${support(player?.relics || list(battle.artifacts), '遗物')}</section><section><h3>道具</h3>${support(player?.items || list(battle.items), '道具')}</section></div>
    <h3 class="character-deck-heading">我的卡组 <small>${cards.reduce((n,c) => n + (player ? 1 : Math.max(1, Number(c.quantity) || 1)), 0)} 张</small></h3><div class="tower-player-card-grid">${cardHTML || '<span class="battle-overview-empty">暂无卡牌</span>'}</div>`;
  panel.querySelector<HTMLButtonElement>('.character-help-button')!.addEventListener('click', event => openMechanicsHelp(event.currentTarget as HTMLElement));
  panel.querySelector('#status-build-details')!.addEventListener('click', () => { try { (window.parent as any)?.MagicGirlWorldMvuMonitor?.openSettings?.('build'); } catch { /* no host */ } });
  bindStatusReferenceDetails(doc);
  return fold;
}
