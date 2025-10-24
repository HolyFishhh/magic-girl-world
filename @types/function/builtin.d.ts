const builtin: {
  addOneMessage: (
    mes: Record<string, any>,
    {
      type = 'normal',
      insertAfter = null,
      scroll = true,
      insertBefore = null,
      forceId = null,
      showSwipes = true,
    }?: {
      type?: string;
      insertAfter?: number;
      scroll?: boolean;
      insertBefore?: number;
      forceId?: number;
      showSwipes?: boolean;
    },
  ) => void;
  saveSettings: () => Promise<void>;
  reloadEditor: (file: string, load_if_not_selected?: boolean) => void;
  reloadEditorDebounced: (file: string, load_if_not_selected?: boolean) => void;
};
