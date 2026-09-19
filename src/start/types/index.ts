// 角色创建配置
export interface CharacterConfig {
  mode: 'story' | 'tower';
  name?: string;
  customDescription?: string;
  world?: string;
  profession?: string;
  opening?: string;
  card?: string;
  /** Optional tower-only guidance entered from the in-card start form. */
  towerRequirements?: string;
  /** Selected foundations are sent as their own prompt field, never merged into card text. */
  selectedMechanics?: string;
}
