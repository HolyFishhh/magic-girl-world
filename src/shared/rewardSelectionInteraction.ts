export interface RewardSelectionOptionSurface {
  option: HTMLElement;
  input: HTMLInputElement;
  preview: HTMLElement;
  details: HTMLDetailsElement;
}

export function rewardPreviewLabel(kind: 'card' | 'relic' | 'item', value: { name?: unknown; emoji?: unknown; quantity?: unknown }): string {
  const name = typeof value.name === 'string' && value.name.trim() ? value.name.trim() : '未命名';
  const emoji = typeof value.emoji === 'string' && value.emoji.trim() ? value.emoji.trim() : kind === 'relic' ? '✦' : '🧪';
  if (kind === 'card') {
    const quantity = Number.isInteger(Number(value.quantity)) && Number(value.quantity) > 0 ? Number(value.quantity) : 1;
    return `卡牌：${name} ×${quantity}`;
  }
  return kind === 'relic' ? `遗物：${emoji}` : `道具：${emoji} ${name}`;
}

/** A reward-content pill only reveals its adjacent details; it never changes selection. */
export function createRewardPreviewPill(
  document: Document,
  details: HTMLDetailsElement,
  label: string,
): HTMLButtonElement {
  const pill = document.createElement('button');
  pill.type = 'button';
  pill.className = 'reward-preview-pill';
  pill.textContent = label;
  const sync = () => pill.setAttribute('aria-expanded', String(details.open));
  sync();
  details.addEventListener('toggle', sync);
  pill.addEventListener('click', event => {
    event.preventDefault?.();
    event.stopPropagation?.();
    details.open = !details.open;
  });
  return pill;
}

/** Shared DOM structure for every selectable card/relic/item reward. */
export function createRewardSelectionOption(
  document: Document,
  options: {
    value: string;
    label: string;
    previewLabel?: string;
    disabled?: boolean;
    className?: string;
    ariaLabel?: string;
  },
): RewardSelectionOptionSurface {
  const option = document.createElement('article');
  option.className = `option reward-selection-option${options.className ? ` ${options.className}` : ''}`;
  const pick = document.createElement('label');
  pick.className = 'reward-pick';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.value = options.value;
  input.disabled = Boolean(options.disabled);
  if (options.ariaLabel) input.setAttribute('aria-label', options.ariaLabel);
  const label = document.createElement('span');
  label.textContent = options.label;
  pick.append(input, label);
  const details = document.createElement('details');
  details.className = 'reward-preview';
  const summary = document.createElement('summary');
  summary.className = 'reward-preview-trigger';
  summary.textContent = options.previewLabel ?? options.label;
  const preview = document.createElement('div');
  details.append(summary, preview);
  option.append(pick, details);
  return { option, input, preview, details };
}

/** Keep the existing checkbox/change transaction, but make the reward face the control. */
export function refreshRewardSelectionSurfaces(root: ParentNode): void {
  const ownOption = (root as Element).matches?.('.option') ? [root as HTMLElement] : [];
  [...ownOption, ...root.querySelectorAll<HTMLElement>('.option')].forEach(option => {
    const input = option.querySelector<HTMLInputElement>('input[type="checkbox"]');
    if (!input) return;
    option.classList.toggle('is-selected', input.checked);
    option.querySelectorAll<HTMLElement>('.collection-card, .collection-support').forEach(surface => {
      surface.tabIndex = input.disabled ? -1 : 0;
      surface.setAttribute('role', 'button');
      surface.setAttribute('aria-pressed', String(input.checked));
      surface.setAttribute('aria-disabled', String(input.disabled));
    });
  });
}

export function bindRewardSelectionSurface(input: HTMLInputElement): void {
  const option = input.closest<HTMLElement>('.option');
  if (!option) return;
  const select = (event: Event) => {
    const target = event.target as Element | null;
    if (!target || target === input || input.disabled) return;
    // Reading a status/summon, expanding the preview, or using a separate
    // action never selects/claims a reward. Ordinary face clicks do select.
    if (target.closest('summary, button, a, .mwg-status-reference, .mwg-card-preview')) return;
    event.preventDefault();
    input.click();
  };
  option.addEventListener('click', select);
  option.addEventListener('keydown', event => {
    if ((event.key === 'Enter' || event.key === ' ') && event.target instanceof Element
      && event.target.matches('.collection-card, .collection-support')) select(event);
  });
}
