import type { ContentPack } from './contentPack';
import { type DeckPlayabilityAssessment } from './deckPlayability';
export interface PlayerContentReadinessIssue {
    path: string;
    code: string;
    message: string;
}
export interface PlayerContentReadiness {
    ok: boolean;
    issues: PlayerContentReadinessIssue[];
    deck: DeckPlayabilityAssessment;
}
export interface InitialPlayerStateInput {
    hp: unknown;
    maxHp: unknown;
    lust: unknown;
    maxLust: unknown;
    level: unknown;
    exp: unknown;
}
/** Validate player-owned content from the first AI response before opening the run. */
export declare function assessInitialPlayerContent(pack: ContentPack, player?: InitialPlayerStateInput): PlayerContentReadiness;
export declare function formatPlayerContentReadiness(readiness: PlayerContentReadiness, limit?: number): string;
/** Build a bounded repair request without echoing untrusted AI field values. */
export declare function formatPlayerContentRepairPrompt(readiness: PlayerContentReadiness, limit?: number): string;
