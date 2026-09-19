import type {
  DeckPowerProfile,
  EncounterLineageMemory,
  EnemyBudgetEnvelope,
  EnemyPowerScore,
} from '../game-core';
import type { KnowledgeGraphView } from './knowledgeGraph';
import type { KnowledgeGraphStorage } from './knowledgeGraph';
import type { TowerBuildMeasurement } from '../game-core/towerEncounterBudget';
import type { TowerInitialPersistenceCheck } from './initialPersistence';

export const DESIGN_ASSISTANT_EXTENSION_ID = 'magic-girl-design-assistant';
export const DESIGN_ASSISTANT_METADATA_KEY = 'magicGirlDesignAssistant';
export const TOWER_ARCHIVE_METADATA_KEY = 'magicGirlTowerArchive';
export const DESIGN_ASSISTANT_STATE_SPEC = 'mwg.st-design-assistant/v1' as const;
export const DESIGN_ASSISTANT_PROMPT_MARKER = '[MWG_DESIGN_CONTEXT/v1]';
export const DESIGN_ASSISTANT_CARD_SCOPE = 'mwg.design-assistant-card/v1' as const;

export interface DesignAssistantSettings {
  enabled: boolean;
  difficultyPercent: number;
  autoCalibration: boolean;
  simulationSeeds: number;
  showNotifications: boolean;
  towerBattleNarrative?: boolean;
  debug: boolean;
  firstAuthoringSchemaTransport?: 'provider-outline' | 'compact-context';
  initialAuthoringProtocol?: 'canonical' | 'registry-draft';
  /** Experimental DeepSeek V4 initial mechanism calls only; never the story preset. */
  initialMechanismThinking?: 'inherit' | 'disabled';
}

export const DEFAULT_DESIGN_ASSISTANT_SETTINGS: DesignAssistantSettings = {
  enabled: true,
  difficultyPercent: 80,
  autoCalibration: true,
  simulationSeeds: 8,
  showNotifications: true,
  towerBattleNarrative: true,
  debug: false,
  firstAuthoringSchemaTransport: 'provider-outline',
  initialAuthoringProtocol: 'canonical',
  initialMechanismThinking: 'inherit',
};

export interface ProgramCalibrationMemory {
  enemyFingerprint: string;
  requestedRatio: number;
  effectiveRatio: number;
  appliedScale: number;
  mode: 'applied' | 'verified' | 'advisory';
  winnableAtCurrentResources: boolean;
  changedPaths: string[];
  warnings: string[];
  calibratedAt: number;
}

export interface DesignAssistantChatState {
  spec: typeof DESIGN_ASSISTANT_STATE_SPEC;
  lineage: EncounterLineageMemory;
  calibratedEnemyFingerprints: string[];
  lastDeckFingerprint?: string;
  lastEnemyFingerprint?: string;
  lastInjectionAt?: number;
  lastInjectionSource?: 'official' | 'tavern-helper' | 'mvu-lifecycle';
  lastInjectionMessageId?: number | 'latest';
  lastInjectionCount?: number;
  lastCalibration?: ProgramCalibrationMemory;
}

export interface MvuDesignSnapshot {
  prompt: string;
  deckProfile: DeckPowerProfile;
  enemyEnvelope: EnemyBudgetEnvelope;
  enemyPower: EnemyPowerScore | null;
  lineage: EncounterLineageMemory;
  deckFingerprint: string;
  enemyFingerprint: string | null;
  knowledgeGraph: KnowledgeGraphView;
}

export interface DesignAssistantStatus {
  phase: 'idle' | 'warming' | 'ready' | 'injecting' | 'calibrating' | 'error';
  message: string;
  updatedAt: number;
  deckScore?: number;
  targetScore?: number;
  enemyScore?: number;
}

export interface DesignAssistantDashboard {
  spec: 'mwg.design-assistant-dashboard/v1';
  available: boolean;
  settings: DesignAssistantSettings;
  status: DesignAssistantStatus;
  threaded: boolean;
  graph: { nodes: number; edges: number; version: string; storage: KnowledgeGraphStorage };
  state: DesignAssistantChatState;
  snapshot: MvuDesignSnapshot | null;
  runtimeMeasurement?: { fingerprint: string; status: 'running' | 'ready' | 'failed'; value?: TowerBuildMeasurement; error?: string };
}

export interface MvuHost {
  events?: Record<string, string>;
  getMvuData(options: { type: 'message'; message_id: number | 'latest' }): unknown;
  replaceMvuData?(
    data: unknown,
    options: { type: 'message'; message_id: number | 'latest' },
  ): Promise<void> | void;
  isDuringExtraAnalysis?(): boolean;
}

export interface SillyTavernEventSource {
  on(event: string, listener: (...args: any[]) => unknown): void;
  emit?(event: string, ...args: any[]): Promise<unknown> | unknown;
  removeListener?(event: string, listener: (...args: any[]) => unknown): void;
}

export interface SillyTavernContext {
  chatId?: string | null;
  characterId?: string | number | null;
  groupId?: string | number | null;
  characters?: Array<Record<string, any>>;
  /** Official getContext() reference; read only, never serialize credentials. */
  chatCompletionSettings?: { chat_completion_source?: string; deepseek_model?: string; show_thoughts?: boolean; custom_model?: string; custom_url?: string; custom_include_body?: string; custom_exclude_body?: string };
  chat?: Array<Record<string, any>>;
  extensionSettings: Record<string, any>;
  saveSettingsDebounced(): void;
  chatMetadata: Record<string, any>;
  saveMetadataDebounced(): void;
  saveChat?(): Promise<void> | void;
  getRequestHeaders?(): Record<string, string>;
  updateMessageBlock?(
    messageId: number,
    message: Record<string, any>,
    options?: { rerenderMessage?: boolean },
  ): void;
  eventSource: SillyTavernEventSource;
  eventTypes: Record<string, string>;
}

export interface DesignAssistantHost {
  context(): SillyTavernContext | null;
  mvu(): MvuHost | null;
  now(): number;
  notify(level: 'info' | 'success' | 'warning' | 'error', message: string, title?: string): void;
  verifyTowerInitialPersistence?(expected: TowerInitialPersistenceCheck): Promise<void>;
}
