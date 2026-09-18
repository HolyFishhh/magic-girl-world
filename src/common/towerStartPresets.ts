const KEY = 'magic-girl-world:tower-start-presets:v1';
const FIELDS = ['name', 'profession', 'description', 'world', 'opening', 'card', 'requirements'] as const;
type Draft = Partial<Record<typeof FIELDS[number], string>> & { selectedMechanics?: string[] };
interface Saved { draft: Draft; presets: Array<{ name: string; fields: Draft }> }
interface Options { onApplied?: () => void; getSelectedMechanics?: () => readonly string[]; setSelectedMechanics?: (ids: string[]) => void; }

/** Only the seven authored start fields; never channel credentials or model settings. */
export function bindTowerStartPresets(doc: Document, storage: Storage, options: Options = {}): void {
  const panel = doc.getElementById('tower-start-panel');
  if (!panel || panel.dataset.presetsBound) return;
  panel.dataset.presetsBound = 'true';
  const select = doc.getElementById('tower-preset-select') as HTMLSelectElement;
  const name = doc.getElementById('tower-preset-name') as HTMLInputElement;
  const status = doc.getElementById('tower-preset-status')!;
  status.setAttribute?.('aria-live', 'polite');
  const field = (id: string) => doc.getElementById(`tower-start-${id}`) as HTMLInputElement | HTMLTextAreaElement;
  const clean = (value: unknown): Draft => {
    const source = value && typeof value === 'object' ? value as Draft : {};
    const draft: Draft = {};
    for (const key of FIELDS) {
      if (typeof source[key] === 'string') draft[key] = source[key];
    }
    if (Array.isArray(source.selectedMechanics)) {
      draft.selectedMechanics = [...new Set(source.selectedMechanics.filter(id => typeof id === 'string'))];
    }
    // Only migrate the exact historical generated wrapper. User-authored text,
    // including a preset name mentioned in ordinary prose, remains untouched.
    if (!draft.selectedMechanics?.length && draft.card) {
      const migrated = extractLegacyTowerArchetypeSelection(draft.card);
      if (migrated) { draft.card = migrated.card; draft.selectedMechanics = migrated.selectedMechanicIds; }
    }
    return draft;
  };
  let saved: Saved = { draft: {}, presets: [] };
  try {
    const value = JSON.parse(storage.getItem(KEY) || 'null');
    if (value && typeof value === 'object') saved = {
      draft: clean(value.draft),
      presets: Array.isArray(value.presets) ? value.presets.filter((p: any) => p && typeof p.name === 'string' && p.name.trim())
        .map((p: any) => ({ name: p.name, fields: clean(p.fields) })) : [],
    };
  } catch { status.textContent = '无法读取本地预设；当前输入仍可使用。'; }
  const read = (): Draft => ({ ...Object.fromEntries(FIELDS.map(key => [key, field(key).value])), selectedMechanics: [...new Set(options.getSelectedMechanics?.() || [])] });
  const apply = (draft: Draft) => {
    FIELDS.forEach(key => { field(key).value = draft[key] || ''; });
    options.setSelectedMechanics?.([...(draft.selectedMechanics || [])]);
    options.onApplied?.();
  };
  const write = () => {
    try { storage.setItem(KEY, JSON.stringify(saved)); return true; }
    catch { status.textContent = '本地保存失败，请勿关闭页面，以免丢失当前输入。'; return false; }
  };
  const refresh = (selected = '') => {
    select.replaceChildren();
    const placeholder = doc.createElement('option'); placeholder.value = ''; placeholder.textContent = '选择已保存的预设'; select.append(placeholder);
    saved.presets.forEach((p, i) => { const option = doc.createElement('option'); option.value = String(i); option.textContent = p.name; select.append(option); });
    select.value = selected;
  };
  if (FIELDS.every(key => !field(key).value)) apply(saved.draft);
  refresh();
  panel.addEventListener('input', event => {
    if (!FIELDS.some(key => field(key) === event.target)) return;
    saved.draft = read();
    if (write()) { delete status.dataset.saveResult; status.textContent = '当前输入已自动保存到此浏览器。'; }
  });
  panel.addEventListener('tower-archetype-selection-change', () => {
    saved.draft = read();
    if (write()) { delete status.dataset.saveResult; status.textContent = '当前输入与基础机制已自动保存到此浏览器。'; }
  });
  const save = (label: string): boolean => {
    label = label.trim();
    if (!label) { status.textContent = '请先填写预设名称。'; name.focus(); return false; }
    const before = structuredClone(saved);
    const index = saved.presets.findIndex(p => p.name === label);
    const preset = { name: label, fields: read() };
    if (index >= 0) saved.presets[index] = preset; else saved.presets.push(preset);
    saved.draft = preset.fields;
    if (!write()) { saved = before; return false; }
    name.value = label;
    refresh(String(index >= 0 ? index : saved.presets.length - 1)); status.dataset.saveResult = 'success'; status.textContent = `已保存「${label}」。`;
    return true;
  };
  doc.getElementById('tower-preset-save')?.addEventListener('click', () => save(name.value.trim() || field('name').value.trim() || '我的爬塔预设'));
  doc.getElementById('tower-preset-load')?.addEventListener('click', () => {
    const preset = select.value === '' ? undefined : saved.presets[Number(select.value)];
    if (!preset) { status.textContent = '请先选择预设。'; return; }
    apply(preset.fields); name.value = preset.name; saved.draft = read();
    if (write()) status.textContent = `已载入「${preset.name}」。`;
  });
  doc.getElementById('tower-preset-delete')?.addEventListener('click', () => {
    if (select.value === '') return;
    const removed = saved.presets.splice(Number(select.value), 1)[0];
    if (write()) { refresh(); status.textContent = `已删除「${removed.name}」，当前输入保留。`; }
  });
}

import { extractLegacyTowerArchetypeSelection } from '../game-core/towerArchetypePrompt';
