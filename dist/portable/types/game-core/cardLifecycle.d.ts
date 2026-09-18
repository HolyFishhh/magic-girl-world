/** Authored overrides are independent: playing is not discarding, cleanup is not a gameplay discard. */
export interface CardLifecycle {
    on_play?: 'discard' | 'exhaust' | 'purge';
    on_discard?: 'discard' | 'exhaust' | 'purge';
    turn_end?: 'discard' | 'retain' | 'exhaust';
}
export interface LifecycleCard {
    unique?: boolean;
    type?: string;
    retain?: boolean;
    exhaust?: boolean;
    ethereal?: boolean;
    innate?: boolean;
    lifecycle?: CardLifecycle;
}
export declare function validateCardLifecycle(value: unknown): string | null;
export declare function resolveCardLifecycle(card: LifecycleCard): Required<CardLifecycle>;
export interface CardTrait {
    id: string;
    name: string;
    detail: string;
    tone: 'fire' | 'break' | 'keep' | 'normal';
}
export declare function describeCardTraits(card: LifecycleCard): CardTrait[];
