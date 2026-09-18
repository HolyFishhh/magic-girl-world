import { type ContentPack } from './contentPack';
/**
 * Read-only evidence for the independently selectable tower foundations.  This is
 * deliberately separate from the (broader) archetype graph: a graph family can
 * describe a deck, while a foundation must be supported by the exact executable
 * distinction selected by the player (for example, a plain damage step is not
 * evidence of piercing, lifesteal, or multi-hit).
 */
export type TowerFoundationRecognitionState = 'detected' | 'absent' | 'uncertain';
export interface TowerFoundationRecognition {
    id: string;
    detected: boolean;
    state: TowerFoundationRecognitionState;
    supportingIds: string[];
    evidence: string[];
}
/** Analyze authored compact definitions and compiled effect programs without mutation or model calls. */
export declare function recognizeTowerFoundations(pack: ContentPack): TowerFoundationRecognition[];
/** Lets tests and catalog maintenance assert that every selectable foundation has a recognition rule. */
export declare function towerFoundationRecognitionRuleIds(): string[];
