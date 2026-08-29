import { type ContentDefinition, type ContentPack } from './contentPack';
import { createContentMechanicsFingerprint, createContentStructuralFingerprint } from './contentFingerprint';
import { extractContentMechanicFeatures, mergeContentMechanicFeatures } from './contentMechanicFeatures';

export const ENCOUNTER_LINEAGE_SPEC = 'mwg.encounter-lineage/v1' as const;

export interface EnemyActionMemory {
  id: string;
  name: string;
  mechanicsFingerprint: string;
  structuralFingerprint: string;
  /** Bounded canonical definition allows an upper-rank enemy to reuse the real action. */
  definition: ContentDefinition;
}

export interface EnemyLineageFamily {
  key: string;
  label: string;
  encounters: number;
  memberNames: string[];
  stages: string[];
  themeAxes: string[];
  statusIds: string[];
  canonicalActions: EnemyActionMemory[];
}

export interface RecentEnemyMemory {
  id: string;
  name: string;
  familyKey?: string;
  stage?: string;
  fingerprint: string;
  themeAxes: string[];
  actions: Array<{ name: string; structuralFingerprint: string }>;
}

export interface EncounterLineageMemory {
  spec: typeof ENCOUNTER_LINEAGE_SPEC;
  families: EnemyLineageFamily[];
  recentEnemies: RecentEnemyMemory[];
}

export interface LineageContinuityReview {
  knownFamily: boolean;
  sharedActionCount: number;
  sharedAxes: string[];
  issues: string[];
  guidance: string[];
}

function record(value: unknown): value is Readonly<Record<string, any>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function compactUnique(values: Iterable<string>, limit: number): string[] {
  const result: string[] = [];
  for (const raw of values) {
    const value = String(raw || '').trim();
    if (!value || result.includes(value)) continue;
    result.push(value);
    if (result.length >= limit) break;
  }
  return result;
}

function cloneDefinition(value: ContentDefinition): ContentDefinition {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return {};
  }
}

function compactActionDefinition(value: ContentDefinition): ContentDefinition {
  const source = cloneDefinition(value) as Record<string, any>;
  const output: Record<string, any> = {};
  for (const key of ['id', 'name', 'emoji', 'description', 'weight', 'effects', 'trigger']) {
    if (source[key] !== undefined) output[key] = source[key];
  }
  return output;
}

function enemyStage(enemy: ContentDefinition): string | null {
  const value = enemy.evolution_stage ?? enemy.lineage_stage ?? enemy.family_stage ?? enemy.rank;
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 40) : null;
}

function enemyList(pack: ContentPack): ContentDefinition[] {
  return (pack.enemies?.length ? pack.enemies : pack.enemy ? [pack.enemy] : []).filter(record);
}

/** Only explicit identity metadata groups a family; names and prose are left for the model to interpret. */
export function explicitEnemyFamilyKey(enemy: ContentDefinition): string | null {
  const value = enemy.family_id ?? enemy.lineage_id ?? enemy.species_id ?? enemy.family ?? enemy.lineage ?? enemy.species;
  if (typeof value !== 'string' || !value.trim()) return null;
  return value.trim().toLowerCase().replace(/[^a-z0-9_\-\u4e00-\u9fff]+/gi, '_').slice(0, 80);
}

function actionMemories(enemy: ContentDefinition): EnemyActionMemory[] {
  const actions = Array.isArray(enemy.actions) ? enemy.actions.filter(record) : [];
  return actions.slice(0, 6).map((action, index) => ({
    id: String(action.id || `action_${index + 1}`),
    name: String(action.name || action.id || `行动${index + 1}`),
    mechanicsFingerprint: createContentMechanicsFingerprint(action),
    structuralFingerprint: createContentStructuralFingerprint(action),
    definition: compactActionDefinition(action),
  }));
}

function recentMemory(enemy: ContentDefinition): RecentEnemyMemory {
  const actions = actionMemories(enemy);
  const definitions = [
    ...actions.map(action => action.definition),
    ...(Array.isArray(enemy.abilities) ? enemy.abilities.filter(record) : []),
    ...(record(enemy.lust_effect) ? [enemy.lust_effect] : []),
  ];
  const features = mergeContentMechanicFeatures(definitions.map(extractContentMechanicFeatures));
  const familyKey = explicitEnemyFamilyKey(enemy);
  const stage = enemyStage(enemy);
  return {
    id: String(enemy.id || enemy.name || createContentMechanicsFingerprint(enemy)),
    name: String(enemy.name || enemy.id || '未命名敌人'),
    ...(familyKey ? { familyKey } : {}),
    ...(stage ? { stage } : {}),
    fingerprint: createContentMechanicsFingerprint(enemy),
    themeAxes: features.axes.slice(0, 6),
    actions: actions.map(action => ({ name: action.name, structuralFingerprint: action.structuralFingerprint })),
  };
}

function normalizeMemory(value: unknown): EncounterLineageMemory {
  if (!record(value) || value.spec !== ENCOUNTER_LINEAGE_SPEC) {
    return { spec: ENCOUNTER_LINEAGE_SPEC, families: [], recentEnemies: [] };
  }
  return {
    spec: ENCOUNTER_LINEAGE_SPEC,
    families: Array.isArray(value.families)
      ? value.families.filter(record).map(family => ({
          ...family,
          memberNames: Array.isArray(family.memberNames) ? family.memberNames.map(String) : [],
          stages: Array.isArray(family.stages) ? family.stages.map(String) : [],
          themeAxes: Array.isArray(family.themeAxes) ? family.themeAxes.map(String) : [],
          statusIds: Array.isArray(family.statusIds) ? family.statusIds.map(String) : [],
          canonicalActions: Array.isArray(family.canonicalActions) ? family.canonicalActions.filter(record) : [],
        })) as unknown as EnemyLineageFamily[]
      : [],
    recentEnemies: Array.isArray(value.recentEnemies) ? value.recentEnemies.filter(record) as unknown as RecentEnemyMemory[] : [],
  };
}

/** Update bounded long-term memory after an enemy has actually been generated. */
export function updateEncounterLineageMemory(previous: unknown, pack: ContentPack): EncounterLineageMemory {
  const prior = normalizeMemory(previous);
  const families = prior.families.map(family => ({
    ...family,
    memberNames: [...family.memberNames],
    stages: [...family.stages],
    themeAxes: [...family.themeAxes],
    statusIds: [...family.statusIds],
    canonicalActions: family.canonicalActions.map(action => ({ ...action, definition: cloneDefinition(action.definition) })),
  }));
  const recentEnemies = prior.recentEnemies.map(enemy => ({
    ...enemy,
    themeAxes: [...enemy.themeAxes],
    actions: enemy.actions.map(action => ({ ...action })),
  }));
  for (const enemy of enemyList(pack)) {
    const recent = recentMemory(enemy);
    const isNewEncounter = recentEnemies.at(-1)?.fingerprint !== recent.fingerprint;
    if (isNewEncounter) recentEnemies.push(recent);
    if (!isNewEncounter) continue;
    const familyKey = recent.familyKey;
    if (!familyKey) continue;
    const actions = actionMemories(enemy);
    const enemyFeatures = mergeContentMechanicFeatures([
      ...actions.map(action => extractContentMechanicFeatures(action.definition)),
      ...(Array.isArray(enemy.abilities) ? enemy.abilities.filter(record).map(extractContentMechanicFeatures) : []),
    ]);
    let family = families.find(entry => entry.key === familyKey);
    if (!family) {
      family = {
        key: familyKey,
        label: String(enemy.family_name || enemy.family || enemy.lineage || enemy.species || familyKey),
        encounters: 0,
        memberNames: [],
        stages: [],
        themeAxes: [],
        statusIds: [],
        canonicalActions: [],
      };
      families.push(family);
    }
    family.encounters = Math.min(999, family.encounters + 1);
    family.memberNames = compactUnique([...family.memberNames, recent.name], 8);
    family.stages = compactUnique([...family.stages, ...(recent.stage ? [recent.stage] : [])], 8);
    family.themeAxes = compactUnique([...family.themeAxes, ...enemyFeatures.axes], 8);
    family.statusIds = compactUnique([...family.statusIds, ...enemyFeatures.statuses], 10);
    for (const action of actions) {
      const existing = family.canonicalActions.find(entry => entry.structuralFingerprint === action.structuralFingerprint);
      if (existing) continue;
      family.canonicalActions.push(action);
      if (family.canonicalActions.length > 4) family.canonicalActions.shift();
    }
  }
  while (families.length > 12) families.shift();
  while (recentEnemies.length > 10) recentEnemies.shift();
  return { spec: ENCOUNTER_LINEAGE_SPEC, families, recentEnemies };
}

/**
 * Keep the full archive in a program-owned MVU path, but expose only the families
 * most likely to matter to the next generation.  This prevents old action JSON
 * from growing the second-model prompt without losing long-term continuity.
 */
export function createEncounterLineagePromptView(
  memory: EncounterLineageMemory,
  pack?: ContentPack,
): EncounterLineageMemory {
  const currentKeys = new Set(enemyList(pack || ({ enemy: null, enemies: [] } as unknown as ContentPack))
    .map(explicitEnemyFamilyKey)
    .filter((value): value is string => Boolean(value)));
  memory.recentEnemies.slice(-3).forEach(enemy => {
    if (enemy.familyKey) currentKeys.add(enemy.familyKey);
  });
  const rankedFamilies = [...memory.families].sort((left, right) => {
    const relevance = Number(currentKeys.has(right.key)) - Number(currentKeys.has(left.key));
    return relevance || right.encounters - left.encounters;
  }).slice(0, 4);
  return {
    spec: ENCOUNTER_LINEAGE_SPEC,
    families: rankedFamilies.map(family => ({
      ...family,
      memberNames: family.memberNames.slice(-5),
      stages: family.stages.slice(-4),
      themeAxes: family.themeAxes.slice(0, 6),
      statusIds: family.statusIds.slice(0, 6),
      canonicalActions: family.canonicalActions.slice(-2).map(action => ({
        ...action,
        definition: compactActionDefinition(action.definition),
      })),
    })),
    recentEnemies: memory.recentEnemies.slice(-5).map(enemy => ({
      ...enemy,
      themeAxes: enemy.themeAxes.slice(0, 4),
      actions: enemy.actions.slice(0, 3),
    })),
  };
}

export function reviewEnemyLineageContinuity(
  memory: EncounterLineageMemory,
  enemy: ContentDefinition,
): LineageContinuityReview {
  const key = explicitEnemyFamilyKey(enemy);
  const family = key ? memory.families.find(entry => entry.key === key) : undefined;
  if (!family) {
    return {
      knownFamily: false,
      sharedActionCount: 0,
      sharedAxes: [],
      issues: [],
      guidance: ['未提供明确谱系标识；保留为近期遭遇记录，让第二阶段结合剧情判断关联。'],
    };
  }
  const actions = actionMemories(enemy);
  const sharedActionCount = actions.filter(action =>
    family.canonicalActions.some(known => known.structuralFingerprint === action.structuralFingerprint),
  ).length;
  const features = mergeContentMechanicFeatures(actions.map(action => extractContentMechanicFeatures(action.definition)));
  const sharedAxes = features.axes.filter(axis => family.themeAxes.includes(axis));
  const issues: string[] = [];
  if (family.canonicalActions.length > 0 && sharedActionCount === 0) issues.push('同谱系敌人没有继承任何既有行动结构。');
  if (family.themeAxes.length > 0 && sharedAxes.length === 0) issues.push('同谱系敌人的机械主题完全漂移。');
  return {
    knownFamily: true,
    sharedActionCount,
    sharedAxes,
    issues,
    guidance: issues.length
      ? ['保留当前剧情身份，复用至少一个谱系招牌行动或核心状态，再增加符合位阶的新机制。']
      : ['谱系继承成立；新增内容应体现位阶差异，不必复制全部旧行动。'],
  };
}

export function formatEncounterLineageForModel(memory: EncounterLineageMemory): string[] {
  const familyLines = memory.families.slice(-6).map(family => {
    const actions = family.canonicalActions.slice(-3).map(action => action.name).join('、') || '暂无固定招式';
    return `${family.label}：主题 ${family.themeAxes.join('、') || '未定'}；可继承行动 ${actions}`;
  });
  const recentLines = memory.recentEnemies.slice(-5).map(enemy =>
    `${enemy.name}：${enemy.themeAxes.join('、') || '未定'}；行动 ${enemy.actions.map(action => action.name).join('、') || '无'}`,
  );
  return [...familyLines, ...recentLines];
}
