import { compactContentToDisplayTags } from '../../game-core';
import { escapeHtml } from '../../fish/shared/html';
import { getCurrentChatMessageText, getCurrentMessageVariables } from '../../runtime/messageVariables';
import { normalizeMvuStatusDefinitions } from '../../runtime/mvuArrays';
import { ensureRuntimeFrameHeightSync } from '../../runtime/runtimeFrameHeight';
import {
  groupMvuUpdateCommands,
  mvuUpdateFieldLabel,
  parseMvuUpdateCommands,
  type MvuUpdateCommand,
} from '../../runtime/mvuUpdateDisplay';
import './index.scss';

ensureRuntimeFrameHeightSync()?.request();

const TYPE_LABELS: Readonly<Record<string, string>> = {
  Attack: '攻击',
  Skill: '技能',
  Power: '能力',
  Curse: '诅咒',
  Event: '事件',
};

const RARITY_LABELS: Readonly<Record<string, string>> = {
  Common: '普通',
  Uncommon: '罕见',
  Rare: '稀有',
  Epic: '史诗',
  Legendary: '传说',
  Corrupt: '腐化',
};

const COLLECTION_PATHS = new Set([
  'battle.cards',
  'battle.artifacts',
  'battle.items',
  'battle.statuses',
  'battle.player_abilities',
  'battle.player_status_effects',
  'status.permanent_status',
  'status.temporary_status',
  'status.inventory',
  'npcs',
  'factions.relations',
  'reward.card',
  'reward.artifact',
  'reward.item',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function formatPrimitive(value: unknown): string {
  if (value === null || value === undefined || value === '') return '无';
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (typeof value === 'number' || typeof value === 'string') return String(value);
  return '';
}

function normalizeItems(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (!isRecord(value)) return value === undefined ? [] : [value];
  if ('name' in value || 'id' in value || 'effects' in value || 'description' in value) return [value];
  return Object.values(value);
}

function contentMeta(value: Record<string, unknown>): string[] {
  const output: string[] = [];
  if (value.type) output.push(TYPE_LABELS[String(value.type)] || String(value.type));
  if (value.rarity) output.push(RARITY_LABELS[String(value.rarity)] || String(value.rarity));
  if (value.cost !== undefined) output.push(`费用 ${String(value.cost) === 'energy' ? 'X' : String(value.cost)}`);
  if (value.quantity !== undefined) output.push(`数量 ${String(value.quantity)}`);
  if (value.count !== undefined) output.push(`数量 ${String(value.count)}`);
  if (value.hp !== undefined && value.max_hp !== undefined) output.push(`生命 ${String(value.hp)}/${String(value.max_hp)}`);
  if (value.lust !== undefined && value.max_lust !== undefined) output.push(`欲望 ${String(value.lust)}/${String(value.max_lust)}`);
  return output;
}

function renderEffectTags(value: Record<string, unknown>, statusNames: Readonly<Record<string, string>>): string {
  const tags = compactContentToDisplayTags(value, { statusNames, selfLabel: '自身', opponentLabel: '敌方' });
  if (tags.length === 0) return '';
  return `<div class="effect-tags">${tags
    .map(
      tag =>
        `<span class="effect-tag" style="color:${escapeHtml(tag.color)};background:${escapeHtml(tag.color)}12">${escapeHtml(tag.icon)} ${escapeHtml(tag.text)}</span>`,
    )
    .join('')}</div>`;
}

function renderContentCard(value: unknown, statusNames: Readonly<Record<string, string>>): string {
  if (!isRecord(value)) return `<div class="content-card"><div class="value-line">${escapeHtml(formatPrimitive(value))}</div></div>`;
  const name = formatPrimitive(value.name || value.id || '未命名内容');
  const emoji = typeof value.emoji === 'string' ? value.emoji : '';
  const meta = contentMeta(value);
  const description = formatPrimitive(value.description || value.ability || value.notes || '');
  const actions = Array.isArray(value.actions)
    ? `<div class="content-grid">${value.actions.map(action => renderContentCard(action, statusNames)).join('')}</div>`
    : '';
  return `<article class="content-card">
    <div class="content-title"><span>${escapeHtml(emoji)}</span><strong>${escapeHtml(name)}</strong></div>
    ${meta.length ? `<div class="content-meta">${meta.map(item => `<span>${escapeHtml(item)}</span>`).join('')}</div>` : ''}
    ${description && description !== '无' ? `<div class="content-description">${escapeHtml(description)}</div>` : ''}
    ${renderEffectTags(value, statusNames)}
    ${actions}
  </article>`;
}

function renderObjectFields(value: Record<string, unknown>): string {
  const hidden = new Set(['effects', 'trigger', 'triggers', 'actions', 'abilities', 'status_effects', 'description']);
  const rows = Object.entries(value)
    .filter(
      ([key, entry]) =>
        !hidden.has(key) && entry !== null && entry !== undefined && entry !== '' && formatPrimitive(entry),
    )
    .map(
      ([key, entry]) =>
        `<div class="field-row"><b>${escapeHtml(mvuUpdateFieldLabel(key))}</b>${escapeHtml(formatPrimitive(entry))}</div>`,
    );
  return rows.length ? `<div class="field-grid">${rows.join('')}</div>` : '';
}

function renderValue(command: MvuUpdateCommand, statusNames: Readonly<Record<string, string>>): string {
  const value = command.value;
  if (COLLECTION_PATHS.has(command.path)) {
    const items = normalizeItems(value);
    return items.length
      ? `<div class="content-grid">${items.map(item => renderContentCard(item, statusNames)).join('')}</div>`
      : '<div class="value-line">清空</div>';
  }
  if (command.path === 'battle.enemy' || command.path.endsWith('.lust_effect')) {
    return renderContentCard(value, statusNames);
  }
  if (isRecord(value)) {
    const description = formatPrimitive(value.description || '');
    return `${renderObjectFields(value)}${description && description !== '无' ? `<div class="content-description">${escapeHtml(description)}</div>` : ''}${renderEffectTags(value, statusNames)}`;
  }
  const newValue = formatPrimitive(value);
  if (command.operation === 'set' && command.oldValue !== undefined) {
    const oldValue = formatPrimitive(command.oldValue);
    if (oldValue !== newValue) {
      return `<div class="value-line"><span class="value-old">${escapeHtml(oldValue)}</span><span class="value-arrow">→</span><span>${escapeHtml(newValue)}</span></div>`;
    }
  }
  const prefix = command.operation === 'add' && Number(value) >= 0 ? '+' : '';
  return `<div class="value-line">${escapeHtml(prefix + newValue)}</div>`;
}

function renderCommand(command: MvuUpdateCommand, statusNames: Readonly<Record<string, string>>): string {
  const operation = { set: '更新', assign: '新增', remove: '移除', add: '变化' }[command.operation];
  return `<article class="update-command">
    <div class="command-heading"><span class="operation-badge ${command.operation === 'remove' ? 'remove' : ''}">${operation}</span><strong>${escapeHtml(command.label)}</strong></div>
    ${renderValue(command, statusNames)}
  </article>`;
}

function currentStatusNames(): Readonly<Record<string, string>> {
  try {
    const stat = getCurrentMessageVariables()?.stat_data;
    const definitions = normalizeMvuStatusDefinitions(stat?.battle?.statuses);
    return Object.fromEntries(definitions.map(definition => [String(definition.id), String(definition.name || definition.id)]));
  } catch {
    return {};
  }
}

function render(): void {
  const container = document.getElementById('update-sections');
  const count = document.getElementById('update-count');
  if (!container || !count) return;
  const commands = parseMvuUpdateCommands(getCurrentChatMessageText());
  const sections = groupMvuUpdateCommands(commands);
  const statusNames = currentStatusNames();
  count.textContent = commands.length ? `共 ${commands.length} 项，本栏只展示这一次实际写入的内容` : '没有读取到有效更新命令';
  container.innerHTML = sections.length
    ? sections
        .map(
          section => `<section class="update-section" data-section="${escapeHtml(section.id)}">
            <header class="section-title"><span>${escapeHtml(section.icon)}</span><strong>${escapeHtml(section.label)}</strong><small>${section.commands.length} 项</small></header>
            <div class="command-list">${section.commands.map(command => renderCommand(command, statusNames)).join('')}</div>
          </section>`,
        )
        .join('')
    : '<div class="empty-update">本轮没有可展示的变量变化。</div>';
}

render();
