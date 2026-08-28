// 角色创建配置
export interface CharacterConfig {
  mode: 'story' | 'expedition';
  name?: string;
  customDescription?: string;
  world?: string;
  profession?: string;
  opening?: string;
  card?: string;
}
