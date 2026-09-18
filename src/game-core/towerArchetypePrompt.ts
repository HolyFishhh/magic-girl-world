import { TOWER_ARCHETYPE_PRESETS, type TowerArchetypePreset } from './towerArchetypeCatalog';

// New blocks carry independently selected foundations. Legacy blocks stay readable so
// named saves are never discarded during migration.
const BLOCK = /^【流派机制】\r?\n([\s\S]*?)^【流派机制结束】(?:\r?\n)?/gm;
const LEGACY_BLOCK = /^【流派机制：([^\r\n]+)】\r?\n[\s\S]*?^【流派机制结束】(?:\r?\n)?/gm;
const MIGRATED_BLOCK = /^【旧版流派提示（请按需改选基础机制）】\r?\n[\s\S]*?^【旧版流派提示结束】(?:\r?\n)?/gm;
const SELECTED_LINE = /^- (.+)$/gm;

function unique(values: readonly TowerArchetypePreset[]): TowerArchetypePreset[] {
  return [...new Map(values.map(preset => [preset.id, preset])).values()];
}

export function buildTowerArchetypePrompt(values: readonly TowerArchetypePreset[]): string {
  const presets = unique(values);
  if (!presets.length) return '';
  return [
    '【流派机制】',
    ...presets.map(preset => `- ${preset.name}：${preset.requirements[0]}`),
    '请自由组合以上基础机制来组织开局构筑；每项都应有可执行的启动、运转与收益路径，并兼顾资源周转和生存。',
    '这些要求仅约束玩法机制。卡牌名称、形象、题材、能力来源与叙事表现由世界和角色设定决定。',
    '【流派机制结束】',
  ].join('\n');
}

export function readTowerArchetypePresets(value: string): TowerArchetypePreset[] {
  const blocks = [...value.matchAll(new RegExp(BLOCK))];
  if (blocks.length !== 1) return [];
  const names = [...blocks[0][1].matchAll(new RegExp(SELECTED_LINE))].map(match => match[1].split('：', 1)[0]);
  return unique(names.map(name => TOWER_ARCHETYPE_PRESETS.find(preset => preset.name === name || preset.aliases?.includes(name))).filter((preset): preset is TowerArchetypePreset => Boolean(preset)));
}

/**
 * One-time migration for the old picker, which injected an exact generated block
 * into the card textarea. Free prose is never inferred from names alone.
 */
export function extractLegacyTowerArchetypeSelection(value: string): { card: string; selectedMechanicIds: string[] } | undefined {
  const blocks = [...value.matchAll(new RegExp(BLOCK))];
  if (blocks.length !== 1) return undefined;
  const selected = readTowerArchetypePresets(value);
  if (!selected.length || blocks[0][0].trim() !== buildTowerArchetypePrompt(selected).trim()) return undefined;
  return { card: value.replace(blocks[0][0], '').trim(), selectedMechanicIds: selected.map(preset => preset.id) };
}

/** Compatibility for older callers and old one-preset saved prompts. */
export function readTowerArchetypePreset(value: string): TowerArchetypePreset | undefined {
  const selected = readTowerArchetypePresets(value);
  if (selected.length === 1) return selected[0];
  const legacy = [...value.matchAll(new RegExp(LEGACY_BLOCK))];
  return legacy.length === 1 ? TOWER_ARCHETYPE_PRESETS.find(preset => preset.name === legacy[0][1] || preset.aliases?.includes(legacy[0][1])) : undefined;
}

function removeMechanismBlocks(value: string): { custom: string; legacy: string[]; migrated: string[]; unknown: string[] } {
  const legacy: string[] = [], migrated: string[] = [], unknown: string[] = [];
  const withoutNew = value.replace(new RegExp(MIGRATED_BLOCK), block => { migrated.push(block.trim()); return ''; })
    .replace(new RegExp(BLOCK), (_block, body: string) => {
      for (const line of [...body.matchAll(new RegExp(SELECTED_LINE))].map(match => match[1])) {
        const name = line.split('：', 1)[0];
        if (!TOWER_ARCHETYPE_PRESETS.some(preset => preset.name === name || preset.aliases?.includes(name))) unknown.push(`- ${line}`);
      }
      return '';
    });
  const custom = withoutNew.replace(new RegExp(LEGACY_BLOCK), (block, name: string) => {
    // An unknown legacy direction is player-authored free text. Do not reclassify it.
    if (!TOWER_ARCHETYPE_PRESETS.some(preset => preset.name === name || preset.aliases?.includes(name))) return block;
    legacy.push(block.trim()); return '';
  }).trim();
  return { custom, legacy, migrated, unknown };
}

export function replaceTowerArchetypePrompt(value: string, values: readonly TowerArchetypePreset[] = []): string {
  const { custom, legacy, migrated, unknown } = removeMechanismBlocks(value);
  // A legacy preset was bundled; retain it as visible free text rather than quietly
  // treating it as an equivalent set of new choices.
  const legacyNotice = legacy.length ? ['【旧版流派提示（请按需改选基础机制）】', ...legacy, '【旧版流派提示结束】'].join('\n') : '';
  // Keep unknown new-format choices as ordinary visible custom text. A wrapper would
  // itself resemble an authored block and risk recursive migration on later edits.
  const unknownNotice = unknown.length ? ['未识别流派机制（保留原要求）：', ...[...new Set(unknown)]].join('\n') : '';
  return [buildTowerArchetypePrompt(values), ...migrated, legacyNotice, unknownNotice, custom].filter(Boolean).join('\n\n');
}
