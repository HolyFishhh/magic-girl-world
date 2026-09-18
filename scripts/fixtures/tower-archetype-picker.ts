import { bindTowerArchetypePicker } from '../../src/shared/towerArchetypePicker';
import { bindTowerStartPresets } from '../../src/common/towerStartPresets';
import { TOWER_ARCHETYPE_PRESETS } from '../../src/game-core/towerArchetypeCatalog';
import { createCharacterStartMessage } from '../../src/game-core/characterStartRequest';
import { buildTowerArchetypePrompt } from '../../src/game-core/towerArchetypePrompt';

const win = window as any;
win.mountPicker = (surface: string, saved?: string) => {
  saved ??= location.hash ? decodeURIComponent(location.hash.slice(1)) : undefined;
  const host = document.getElementById(surface === 'common' ? 'tower-archetype-picker' : 'start-archetype-picker')!;
  const target = document.querySelector<HTMLTextAreaElement>(surface === 'common' ? '#tower-start-card' : '[data-config-field="card"]')!;
  host.hidden = false;
  const panel = document.getElementById('tower-start-panel');
  if (panel) { panel.style.display = 'block'; panel.parentElement!.style.display = 'block'; }
  let selected: string[] = [];
  let refresh = () => {};
  refresh = bindTowerArchetypePicker(host, target, {
    getSelectedMechanics: () => selected,
    onSelectionChange: ids => { selected = ids; host.dispatchEvent(new CustomEvent('tower-archetype-selection-change', { bubbles: true })); },
  });
  const data = new Map<string, string>(saved ? [['magic-girl-world:tower-start-presets:v1', saved]] : []);
  const storage = new URLSearchParams(location.search).has('persist') ? window.localStorage
    : { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value) } as Storage;
  if (surface === 'common') bindTowerStartPresets(document, storage, {
    onApplied: refresh, getSelectedMechanics: () => selected, setSelectedMechanics: ids => { selected = ids; },
  });
  win.pickerTest = { host, target, data, refresh, presets: TOWER_ARCHETYPE_PRESETS, selected: () => selected, message: () => createCharacterStartMessage({ mode: 'tower', card: target.value, selectedMechanics: buildTowerArchetypePrompt(TOWER_ARCHETYPE_PRESETS.filter(preset => selected.includes(preset.id))) }) };
};
