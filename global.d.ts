declare module '*?raw' {
  const content: string;
  export default content;
}
declare module '*.html' {
  const content: string;
  export default content;
}
declare module '*.css' {
  const content: unknown;
  export default content;
}

declare const YAML: typeof import('yaml');

type TavernVariableOptions = {
  type?: 'message' | 'chat' | 'character' | 'global';
  message_id?: number | 'latest';
};

declare const require: (moduleId: string) => any;
declare function getVariables(options?: TavernVariableOptions): Record<string, any>;
declare function replaceVariables(variables: Record<string, any>, options?: TavernVariableOptions): unknown | Promise<unknown>;
declare function insertOrAssignVariables(
  variables: Record<string, any>,
  options?: TavernVariableOptions,
): unknown | Promise<unknown>;
declare function triggerSlash(command: string): Promise<string>;
declare function refreshOneMessage(messageId: number): Promise<void>;
declare function createChatMessages(
  messages: Array<{
    name?: string;
    role: 'system' | 'assistant' | 'user';
    is_hidden?: boolean;
    message: string;
    data?: Record<string, any>;
    extra?: Record<string, any>;
  }>,
  options?: {
    insert_before?: number | 'end';
    refresh?: 'none' | 'affected' | 'all';
  },
): Promise<void>;
declare function getChatMessages(messageId: number | string): Array<{ message?: string }>;
declare function setChatMessages(
  messages: Array<{ message_id: number; message?: string }>,
  options?: { refresh?: 'none' | 'affected' | 'all' },
): Promise<void>;
declare function getButtonEvent(name: string): string;
declare function eventEmit(eventName: string, ...args: unknown[]): Promise<unknown>;
declare function generate(options?: Record<string, any>): Promise<string>;
declare function generateRaw(options?: Record<string, any>): Promise<string>;

declare const z: typeof import('zod');
declare namespace z {
  export type infer<T> = import('zod').infer<T>;
  export type input<T> = import('zod').input<T>;
  export type output<T> = import('zod').output<T>;
}
