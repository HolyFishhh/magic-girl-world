export declare const TOWER_DUNGEON_PLAN_SPEC: "mwg.tower-dungeon-plan/v1";
export interface TowerDungeonPlan {
    spec: typeof TOWER_DUNGEON_PLAN_SPEC;
    theme: string;
    enemyTypes: string[];
    mainSystems: string[];
    bossDirection: string;
    acts: Array<{
        act: number;
        theme: string;
        enemies: string;
        mechanics: string;
        boss: string;
        progression: string;
    }>;
}
export declare const towerDungeonPlanSchema: {
    type: string;
    additionalProperties: boolean;
    required: string[];
    properties: {
        spec: {
            const: "mwg.tower-dungeon-plan/v1";
        };
        theme: {
            type: string;
            minLength: number;
            maxLength: number;
        };
        bossDirection: {
            type: string;
            minLength: number;
            maxLength: number;
        };
        enemyTypes: {
            type: string;
            minItems: number;
            maxItems: number;
            items: {
                type: string;
                minLength: number;
                maxLength: number;
            };
        };
        mainSystems: {
            type: string;
            minItems: number;
            maxItems: number;
            items: {
                type: string;
                minLength: number;
                maxLength: number;
            };
        };
        acts: {
            type: string;
            minItems: number;
            maxItems: number;
            items: {
                type: string;
                additionalProperties: boolean;
                required: string[];
                properties: {
                    act: {
                        type: string;
                        minimum: number;
                        maximum: number;
                    };
                    theme: {
                        type: string;
                        minLength: number;
                        maxLength: number;
                    };
                    enemies: {
                        type: string;
                        minLength: number;
                        maxLength: number;
                    };
                    mechanics: {
                        type: string;
                        minLength: number;
                        maxLength: number;
                    };
                    boss: {
                        type: string;
                        minLength: number;
                        maxLength: number;
                    };
                    progression: {
                        type: string;
                        minLength: number;
                        maxLength: number;
                    };
                };
            };
        };
    };
};
export declare function isTowerDungeonPlan(value: unknown): value is TowerDungeonPlan;
/** Plan is final authored content, separate from provider reasoning and public prose. */
export declare function parseTowerPlannedNarrative(response: string): {
    narrative: string;
    dungeonPlan: TowerDungeonPlan;
};
export declare function towerDungeonPlanningPrompt(): string;
