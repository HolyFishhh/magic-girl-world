import type { CardValueOperator, EffectNode, EffectOrbSelector } from './effectDsl';
export interface ActiveStance {
    id: string;
    name: string;
    emoji?: string;
    description?: string;
    enterEffects?: EffectNode[];
    exitEffects?: EffectNode[];
    passiveEffects?: EffectNode[];
    enteredTurn: number;
    source?: {
        kind: string;
        id: string;
        name?: string;
    };
}
export interface OrbInstance {
    instanceId: string;
    id: string;
    name: string;
    emoji?: string;
    description?: string;
    value: number;
    passiveEffects?: EffectNode[];
    evokeEffects?: EffectNode[];
    source?: {
        kind: string;
        id: string;
        name?: string;
    };
}
export interface OrbContainer {
    slots: number;
    orbs: OrbInstance[];
}
export interface StanceTransition {
    previous: ActiveStance | null;
    next: ActiveStance | null;
    changed: boolean;
}
export declare function transitionStance(current: ActiveStance | null | undefined, next: Omit<ActiveStance, 'enteredTurn'> | null, currentTurn: number): StanceTransition;
export declare function normalizeOrbContainer(value?: Partial<OrbContainer> | null): OrbContainer;
export declare function resizeOrbContainer(container: OrbContainer | undefined, slots: number): {
    container: OrbContainer;
    overflow: OrbInstance[];
};
/** Channel to the right; a full container evicts the oldest (left-most) Orb. */
export declare function channelOrb(container: OrbContainer | undefined, orb: OrbInstance): {
    container: OrbContainer;
    evicted: OrbInstance | null;
    accepted: boolean;
};
export declare function selectOrbs(container: OrbContainer | undefined, selector: EffectOrbSelector): OrbInstance[];
export declare function removeSelectedOrbs(container: OrbContainer | undefined, selector: EffectOrbSelector): {
    container: OrbContainer;
    selected: OrbInstance[];
};
export declare function modifyOrbValues(container: OrbContainer | undefined, selector: EffectOrbSelector, operator: CardValueOperator, value: number): {
    container: OrbContainer;
    changed: Array<{
        before: OrbInstance;
        after: OrbInstance;
    }>;
};
export interface TurnControlState {
    extraPlayerTurns: number;
    extraEnemyTurns: number;
    forceEndPlayer: boolean;
    forceEndEnemy: boolean;
}
export declare function normalizeTurnControl(value?: Partial<TurnControlState> | null): TurnControlState;
export declare function addExtraTurns(value: TurnControlState | undefined, actor: 'player' | 'enemy', amount: number): TurnControlState;
export declare function consumeExtraTurn(value: TurnControlState | undefined, actor: 'player' | 'enemy'): {
    state: TurnControlState;
    consumed: boolean;
};
export declare function setForceEndTurn(value: TurnControlState | undefined, actor: 'player' | 'enemy', requested: boolean): TurnControlState;
