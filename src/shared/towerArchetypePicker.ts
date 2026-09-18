import { TOWER_ARCHETYPE_CATEGORIES, TOWER_ARCHETYPE_PRESETS, type TowerArchetypePreset } from '../game-core/towerArchetypeCatalog';
import './towerArchetypePicker.scss';

export interface TowerArchetypePickerOptions {
  /** The selection is intentionally separate from the player's card request. */
  getSelectedMechanics?: () => readonly string[];
  onSelectionChange?: (ids: string[]) => void;
}

const bindings = new WeakMap<HTMLElement, { target: HTMLTextAreaElement; refresh: () => void }>();

/** Shared by both tower starts. Choices are carried separately from free-form card requirements. */
export function bindTowerArchetypePicker(host: HTMLElement | null, target: HTMLTextAreaElement | null, options: TowerArchetypePickerOptions = {}): () => void {
  if (!host || !target) return () => {};
  const bound = bindings.get(host);
  if (bound?.target === target) return bound.refresh;
  const doc = host.ownerDocument;
  host.classList.add('tower-archetype-picker');
  host.innerHTML = `<div class="archetype-heading"><strong>选择基础机制（可多选）</strong><span data-archetype-count></span></div>
    <p>可跨类别自由组合；不选也可以直接填写自己的卡组要求。</p>
    <div class="archetype-filters"><label>类别<select data-archetype-category aria-label="流派类别"></select></label><label>搜索<input type="search" data-archetype-search placeholder="例如：单核心、自爆、弃牌、永久成长" /></label></div>
    <div class="archetype-level-heading"><strong data-archetype-level></strong><p data-archetype-description></p></div>
    <div class="archetype-list" data-archetype-list aria-label="基础机制"></div>
    <div class="archetype-selection"><button type="button" data-archetype-selected aria-expanded="false"></button><button type="button" data-archetype-clear>清空选择</button></div>
    <div class="archetype-detail" data-archetype-detail hidden></div>`;
  const search = host.querySelector<HTMLInputElement>('[data-archetype-search]')!;
  const category = host.querySelector<HTMLSelectElement>('[data-archetype-category]')!;
  const list = host.querySelector<HTMLElement>('[data-archetype-list]')!;
  const count = host.querySelector<HTMLElement>('[data-archetype-count]')!;
  const level = host.querySelector<HTMLElement>('[data-archetype-level]')!;
  const description = host.querySelector<HTMLElement>('[data-archetype-description]')!;
  const selected = host.querySelector<HTMLButtonElement>('[data-archetype-selected]')!;
  const detail = host.querySelector<HTMLElement>('[data-archetype-detail]')!;
  const clear = host.querySelector<HTMLButtonElement>('[data-archetype-clear]')!;
  const categoryName = (id: string) => TOWER_ARCHETYPE_CATEGORIES.find(entry => entry.id === id)?.name || '';
  count.textContent = `${TOWER_ARCHETYPE_CATEGORIES.length} 类 · ${TOWER_ARCHETYPE_PRESETS.length} 项基础机制`;
  for (const entry of TOWER_ARCHETYPE_CATEGORIES) { const option = doc.createElement('option'); option.value = entry.id; option.textContent = `${entry.name} · ${TOWER_ARCHETYPE_PRESETS.filter(preset => preset.category === entry.id).length} 项`; category.append(option); }
  const current = () => uniqueSelected(options.getSelectedMechanics?.() || []);
  const write = (presets: readonly TowerArchetypePreset[]) => {
    options.onSelectionChange?.(presets.map(preset => preset.id));
    renderList();
    refresh();
  };
  const renderList = () => {
    const query = search.value.trim().toLocaleLowerCase();
    const matches = TOWER_ARCHETYPE_PRESETS.filter(preset => query ? [categoryName(preset.category), preset.name, ...preset.aliases, preset.summary, ...preset.loop, ...preset.requirements].join(' ').toLocaleLowerCase().includes(query) : preset.category === category.value);
    level.textContent = query ? `搜索结果 · ${matches.length} 项` : `${categoryName(category.value)} · ${matches.length} 项基础机制`;
    description.textContent = query ? '搜索不会清除已选项；可继续跨类别勾选。' : TOWER_ARCHETYPE_CATEGORIES.find(entry => entry.id === category.value)?.description || '';
    const selectedIds = new Set(current().map(preset => preset.id)); list.replaceChildren();
    for (const preset of matches) {
      const button = doc.createElement('button'); button.type = 'button'; button.dataset.archetypeId = preset.id; button.setAttribute('aria-pressed', String(selectedIds.has(preset.id))); button.disabled = target.disabled;
      const name = doc.createElement('strong'); name.textContent = preset.name; const summary = doc.createElement('span'); summary.textContent = preset.summary;
      if (query) { const parent = doc.createElement('small'); parent.textContent = categoryName(preset.category); button.append(parent); }
      button.append(name, summary); button.addEventListener('click', () => { if (target.disabled) return; const before = current(); write(selectedIds.has(preset.id) ? before.filter(entry => entry.id !== preset.id) : [...before, preset]); [...list.querySelectorAll<HTMLButtonElement>('[data-archetype-id]')].find(item => item.dataset.archetypeId === preset.id)?.focus(); }); list.append(button);
    }
    if (!matches.length) { const empty = doc.createElement('p'); empty.textContent = '没有匹配项；可以继续自由填写卡组要求。'; list.append(empty); }
  };
  const renderSelectedDetail = () => {
    detail.replaceChildren();
    for (const preset of current()) { const row = doc.createElement('div'); const copy = doc.createElement('span'); copy.textContent = `${categoryName(preset.category)} · ${preset.name}：${preset.summary}`; const remove = doc.createElement('button'); remove.type = 'button'; remove.textContent = `移除 ${preset.name}`; remove.disabled = target.disabled; remove.addEventListener('click', () => write(current().filter(entry => entry.id !== preset.id))); row.append(copy, remove); detail.append(row); }
  };
  const refresh = () => {
    const presets = current(); selected.textContent = presets.length ? `已选 ${presets.length} 项：${presets.map(preset => preset.name).join('、')}（打开管理）` : '未选基础机制（可自由填写）'; selected.disabled = !presets.length || target.disabled; clear.hidden = !presets.length;
    if (!presets.length) { detail.hidden = true; selected.setAttribute('aria-expanded', 'false'); } else if (!detail.hidden) renderSelectedDetail();
    list.querySelectorAll<HTMLButtonElement>('[data-archetype-id]').forEach(button => button.setAttribute('aria-pressed', String(presets.some(preset => preset.id === button.dataset.archetypeId))));
  };
  selected.addEventListener('click', () => { detail.hidden = !detail.hidden; selected.setAttribute('aria-expanded', String(!detail.hidden)); if (!detail.hidden) renderSelectedDetail(); });
  search.addEventListener('input', renderList); category.addEventListener('change', () => { search.value = ''; renderList(); }); target.addEventListener('input', () => { renderList(); refresh(); });
  clear.addEventListener('click', () => { if (!target.disabled) write([]); });
  const restore = () => { category.value = category.value || TOWER_ARCHETYPE_CATEGORIES[0].id; search.value = ''; renderList(); refresh(); };
  restore(); bindings.set(host, { target, refresh: restore }); return restore;
}

function uniqueSelected(ids: readonly string[]): TowerArchetypePreset[] {
  const selected = new Set(ids);
  return TOWER_ARCHETYPE_PRESETS.filter(preset => selected.has(preset.id));
}
