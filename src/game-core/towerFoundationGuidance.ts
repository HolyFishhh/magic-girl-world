import type { ContentPack } from './contentPack';
import { TOWER_ARCHETYPE_CATEGORIES, TOWER_ARCHETYPE_PRESETS } from './towerArchetypeCatalog';
import { readTowerArchetypePresets } from './towerArchetypePrompt';
import { recognizeTowerFoundations } from './towerFoundationRecognition';

/** Local analysis only. Preferences never become invented evidence or a card rejection rule. */
export function buildTowerFoundationGuidance(pack: ContentPack, selectedPrompt = '') {
  const recognition = recognizeTowerFoundations(pack);
  const byId = new Map(recognition.map(value => [value.id, value]));
  const selected = readTowerArchetypePresets(selectedPrompt);
  const detected = TOWER_ARCHETYPE_PRESETS.filter(preset => byId.get(preset.id)?.detected);
  const observed = detected.map(preset => ({
    id: preset.id, name: preset.name, mechanism: preset.summary,
    supportingIds: byId.get(preset.id)!.supportingIds,
    evidence: byId.get(preset.id)!.evidence,
  }));
  return {
    spec: 'mwg.foundation-guidance/v1',
    catalogCount: TOWER_ARCHETYPE_PRESETS.length,
    evaluatedCount: recognition.length,
    selectedPreferences: selected.map(preset => ({id: preset.id, name: preset.name,
      requirement: preset.summary, alreadyPresent: Boolean(byId.get(preset.id)?.detected)})),
    // Preserve custom/older preference prose without pretending it has been recognized.
    originalPreference: selectedPrompt || undefined,
    observedMechanisms: observed,
    availableMechanismFamilies: TOWER_ARCHETYPE_CATEGORIES.map(category => ({
      category: category.name,
      foundations: TOWER_ARCHETYPE_PRESETS.filter(preset => preset.category === category.id).map(preset => preset.name),
    })),
    generationPolicy: [
      '只有普通攻击或格挡且数值小于7的基础牌不作为流派证据；它们仍参与战斗能力评估。低数值但带条件、连击、成长、触发或特殊目标等机制的牌仍按实际结构识别。',
      '玩家勾选项是方向偏好，observedMechanisms才是当前已持有内容的结构证据；未出现不等于禁止，不能把偏好写成已经拥有的配合。',
      '奖励、商店、事件与馈赠共同参考这份目录：先补已选但缺入口的机制，再补启动、维持或收益；不按最高分流派强行出牌。',
      '候选可分别提供深化、补短板和可行转向；无需每张卡包含所有已选基础，也无需固定候选配额。未选择新方向时不要强制加入孤立资源或无配套引擎。',
      '组合说明必须写清触发、支付、模板身份、计数窗口和收益。目录可自由组合，也允许目录外的合法原创机制。',
      '流派识别仅指导生成倾向，不自动修改合法卡牌、数值、稀有度或玩家存档；在既有的一次内容生成请求内使用此分析，不另加AI分类请求。',
    ],
  };
}
