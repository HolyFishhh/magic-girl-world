// 角色创建配置
export interface CharacterConfig {
  /** `expedition` is accepted only for old callers and is normalized to `tower`. */
  mode: 'story' | 'tower' | 'expedition';
  name?: string;
  customDescription?: string;
  world?: string;
  profession?: string;
  opening?: string;
  card?: string;
  /** Optional tower-only guidance entered from the in-card start form. */
  towerRequirements?: string;
}
