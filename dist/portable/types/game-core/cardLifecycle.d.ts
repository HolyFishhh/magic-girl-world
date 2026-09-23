/** Authored overrides are independent: playing is not discarding, cleanup is not a gameplay discard. */
export interface CardLifecycle {
    /** These permissions are independent of temporary battle-zone movement. */
    removable?: boolean;
    transformable?: boolean;
    on_play?: 'discard' | 'exhaust' | 'purge';
    on_discard?: 'discard' | 'exhaust' | 'remove' | 'purge';
    turn_end?: 'discard' | 'retain' | 'exhaust';
}
export interface LifecycleCard {
    id?: string;
    unique?: boolean;
    type?: string;
    retain?: boolean;
    exhaust?: boolean;
    ethereal?: boolean;
    innate?: boolean;
    sly?: boolean;
    lifecycle?: CardLifecycle;
}
export declare function validateCardLifecycle(value: unknown): string | null;
export declare function canPermanentlyRemoveCard(card: LifecycleCard): boolean;
export declare function canTransformCard(card: LifecycleCard): boolean;
export declare function resolveCardLifecycle(card: LifecycleCard): Required<Pick<CardLifecycle, 'on_play' | 'on_discard' | 'turn_end'>>;
export interface CardTrait {
    id: string;
    name: string;
    detail: string;
    tone: 'fire' | 'break' | 'keep' | 'normal';
}
export declare function describeCardTraits(card: LifecycleCard): CardTrait[];
