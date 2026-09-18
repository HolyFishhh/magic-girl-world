/**
 * Transient speech bubbles anchored to their actor. They are presentation-only:
 * rendering or dismissing a line never waits for combat.
 */
export type BattleDialogueSpeaker = {
  actor: 'player' | 'enemy' | 'summon';
  /** Enemy DOM is rebuilt frequently, so its stable battle id is required. */
  id?: string;
  name?: string;
};

type ActiveDialogue = {
  key: string;
  text: string;
  speaker: BattleDialogueSpeaker;
  expiresAt: number;
  timer: ReturnType<typeof window.setTimeout>;
};

const DIALOGUE_LIFETIME_MS = 5_000;
const activeDialogues = new Map<string, ActiveDialogue>();
let observer: MutationObserver | undefined;
let observedStage: Element | null = null;
let reconcileScheduled = false;

function dialogueKey(speaker: BattleDialogueSpeaker): string {
  return speaker.actor !== 'player' && speaker.id ? `${speaker.actor}:${speaker.id}` : 'player';
}

function normalizeSpeaker(speaker?: BattleDialogueSpeaker | string): BattleDialogueSpeaker {
  // The legacy string signature is deliberately retained for presentation
  // adapters. A card/system line is spoken by the player unless an enemy id is
  // supplied by the enemy-action path below.
  if (typeof speaker === 'string') return { actor: 'player', name: speaker };
  if (speaker && speaker.actor !== 'player' && speaker.id) return speaker;
  return { actor: 'player', name: speaker?.name };
}

function actorElement(speaker: BattleDialogueSpeaker): HTMLElement | null {
  if (speaker.actor === 'summon') return Array.from(document.querySelectorAll<HTMLElement>('[data-summon-id]')).find(element => element.dataset.summonId === speaker.id) || null;
  if (speaker.actor === 'player') {
    return document.querySelector<HTMLElement>('#stage-player .stage-main-unit');
  }
  return Array.from(document.querySelectorAll<HTMLElement>('#stage-enemy-party [data-enemy-id]'))
    .find(element => element.dataset.enemyId === speaker.id) || null;
}

function dismissDialogue(key: string): void {
  const dialogue = activeDialogues.get(key);
  if (!dialogue) return;
  window.clearTimeout(dialogue.timer);
  document.querySelectorAll<HTMLElement>('.battle-speech-bubble')
    .forEach(bubble => { if (bubble.dataset.dialogueKey === key) bubble.remove(); });
  activeDialogues.delete(key);
}

function renderDialogue(dialogue: ActiveDialogue): boolean {
  const actor = actorElement(dialogue.speaker);
  if (!actor) return false;
  let bubble = Array.from(document.querySelectorAll<HTMLElement>('.battle-speech-bubble'))
    .find(element => element.dataset.dialogueKey === dialogue.key) as HTMLElement | undefined;
  if (!bubble) {
    bubble = document.createElement('span');
    bubble.setAttribute('role', 'button');
    bubble.tabIndex = 0;
    bubble.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); dismissDialogue(dialogue.key); } });
    bubble.className = 'battle-speech-bubble';
    bubble.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); dismissDialogue(dialogue.key); });
  }
  const contentKey = JSON.stringify([dialogue.text, dialogue.speaker.name]);
  if (bubble.dataset.contentKey === contentKey) {
    if (bubble.parentElement !== actor) actor.append(bubble);
    return true;
  }
  bubble.dataset.contentKey = contentKey;
  bubble.dataset.dialogueKey = dialogue.key;
  bubble.dataset.actor = dialogue.speaker.actor;
  bubble.setAttribute('aria-label', `${dialogue.speaker.name || (dialogue.speaker.actor === 'enemy' ? '敌人' : '我方')}的战斗台词：${dialogue.text}。点击关闭`);
  bubble.replaceChildren();
  if (dialogue.speaker.name) {
    const name = document.createElement('span');
    name.className = 'battle-speech-bubble-speaker';
    name.textContent = dialogue.speaker.name;
    bubble.append(name);
  }
  const text = document.createElement('span');
  text.className = 'battle-speech-bubble-text';
  text.textContent = dialogue.text;
  bubble.append(text);
  if (bubble.parentElement !== actor) actor.append(bubble);
  return true;
}

function reconcileDialogues(): void {
  reconcileScheduled = false;
  for (const dialogue of activeDialogues.values()) {
    if (dialogue.expiresAt <= Date.now() || !renderDialogue(dialogue)) dismissDialogue(dialogue.key);
  }
}

function ensureStageObserver(): void {
  const stage = document.getElementById('battle-stage');
  if (!stage || (observer && observedStage === stage)) return;
  observer?.disconnect();
  observedStage = stage;
  observer = new MutationObserver(() => {
    if (reconcileScheduled) return;
    reconcileScheduled = true;
    queueMicrotask(reconcileDialogues);
  });
  observer.observe(stage, { childList: true, subtree: true });
}

/** Shows or refreshes one actor's bubble for five seconds without delaying combat. */
export function showBattleDialogue(text: string, speaker?: BattleDialogueSpeaker | string): void {
  const trimmed = text.trim();
  if (typeof document === 'undefined' || !trimmed) return;
  ensureStageObserver();
  const normalizedSpeaker = normalizeSpeaker(speaker);
  const key = dialogueKey(normalizedSpeaker);
  const previous = activeDialogues.get(key);
  if (previous) window.clearTimeout(previous.timer);
  const dialogue: ActiveDialogue = {
    key,
    text: trimmed,
    speaker: normalizedSpeaker,
    expiresAt: Date.now() + DIALOGUE_LIFETIME_MS,
    timer: undefined as unknown as ReturnType<typeof window.setTimeout>,
  };
  dialogue.timer = window.setTimeout(() => dismissDialogue(key), DIALOGUE_LIFETIME_MS);
  activeDialogues.set(key, dialogue);
  if (!renderDialogue(dialogue)) dismissDialogue(key);
}
