import { CharacterConfig } from '../types';
import { Faction } from '../types/index';

function getFactionDescription(faction: Faction): string {
  switch (faction) {
    case 'magical_girl':
      return '一位致力于爱与正义的魔法少女，在都市的暗影中对抗邪恶。';
    case 'evil_forces':
      return '一个利用欲望和混乱来侵蚀世界的邪恶组织成员。';
    case 'ordinary_people':
      return '一个被卷入超自然事件的普通人，挣扎求生并试图理解这疯狂的世界。';
  }
}

function buildCharacterDescription(config: CharacterConfig): string {
  let description = `角色名: ${config.name || '{{user}}'}\\n`;
  description += `性别: ${config.gender}\\n`;
  description += `阵营: ${getFactionDescription(config.faction)}\\n`;
  description += `身份: ${
    config.supernaturalIdentity ? config.supernaturalIdentity.name : config.ordinaryIdentity.name
  }\\n`;
  description += `城市: ${config.city.name}\\n`;
  description += `初始区域: ${config.location.name}\\n`;
  if (config.customDescription) {
    description += `额外描述: ${config.customDescription}\\n`;
  }
  return description;
}

export function generateInitialPrompt(config: CharacterConfig): string {
  const characterDescription = buildCharacterDescription(config);

  return `
You are the Game Master for FishRPG. A new character has been created.
This marks the beginning of the game. Your first response will establish the entire initial state of the game world.

<CharacterProfile>
${characterDescription}
</CharacterProfile>

Your response MUST strictly follow the XML format below. Do not add any text outside the <FishRPG> root tag.

<FishRPG>
  <Story>
    [Write a compelling opening story narrative here. Describe the character's current situation and surroundings based on their profile. Introduce the first scene and hint at the brewing conflict or adventure.]
  </Story>
  <Options>
    <Option id="1">[Write the first gameplay choice for the player, something they can do immediately.]</Option>
    <Option id="2">[Write the second, different gameplay choice for the player.]</Option>
  </Options>
  <UpdateVariable>
    [Based on the character profile and the game's starting rules from 属性.txt, generate a series of \`_.set('path', value);// comment\` commands to initialize the entire game state. The root object for variables is 'stat_data', but you should not include 'stat_data' in the path. For example, use 'status.阶段' not 'stat_data.status.阶段'. Create plausible initial values for every single variable defined in the game's data structure (status, battle, npcs, faction). Refer to 属性.txt for the structure of each section.]
    
    // Example Initialization:
    _.set('status.阶段', '日常阶段');//初始状态
    _.set('status.时间', '7月18日，周一，清晨，08:00');//初始状态
    _.set('status.地点&天气', '${config.city.name}（${config.location.name}） ☀晴朗');//初始状态
    _.set('status.称号', '无名新人');//初始状态
    _.set('status.职业', '${
      config.supernaturalIdentity ? config.supernaturalIdentity.name : config.ordinaryIdentity.name
    } - ${
    config.supernaturalIdentity ? config.supernaturalIdentity.description : config.ordinaryIdentity.description
  }');//初始状态
    _.set('status.永久性状态', []);//初始状态
    _.set('status.临时状态', []);//初始状态
    _.set('status.服装', { '头部':'无', '颈部':'无', '手':'无', '上衣':'校服', '下衣':'校服裙', '内衣':'普通胸罩', '内裤':'纯棉内裤', '腿':'及膝袜', '脚':'室内鞋', '其他':'无' });//初始状态
    _.set('status.持有物', ['学生证', '手机', '少量现金']);//初始状态

    _.set('battle.battle_ui_info.核心战斗数值.HP (生命值)', '100/100');//初始战斗数值
    _.set('battle.battle_ui_info.核心战斗数值.欲望值', '0/100');//初始战斗数值
    _.set('battle.battle_ui_info.等级与经验.等级 (Level)', 'LV 1');//初始战斗数值
    _.set('battle.battle_ui_info.等级与经验.经验值 (EXP)', '0/100');//初始战斗数值
    _.set('battle.battle_ui_info.战斗资源.卡牌删除次数', '剩余: 1');//初始战斗数值
    _.set('battle.battle_ui_info.信息面板.卡组信息', [
      { "name": "攻击", "cost": 1, "description": "造成6点伤害。" },
      { "name": "攻击", "cost": 1, "description": "造成6点伤害。" },
      { "name": "攻击", "cost": 1, "description": "造成6点伤害。" },
      { "name": "防御", "cost": 1, "description": "获得5点格挡。" },
      { "name": "防御", "cost": 1, "description": "获得5点格挡。" }
    ]);//初始卡组
    _.set('battle.battle_ui_info.信息面板.遗物信息', []);//初始遗物
    _.set('battle.battle_ui_info.信息面板.物品信息', []);//初始物品
    
    _.set('npcs', {});//初始NPC为空, 在剧情中添加
    
    _.set('faction.protagonist_alignment', '绝对中立');//初始阵营
    _.set('faction.relations', []);//初始势力关系为空
  </UpdateVariable>
</FishRPG>
`;
}
