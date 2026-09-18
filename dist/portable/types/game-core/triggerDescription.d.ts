import type { EventTriggerQuery } from './battleEventJournal';
/** Plain text; hosts must HTML-escape it. Shared by full rules and compact tags. */
export declare function describeTriggerEventQuery(query: EventTriggerQuery | undefined): string;
