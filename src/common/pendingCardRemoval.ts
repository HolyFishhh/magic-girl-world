import { migratePersistentRunDeck } from '../game-core/cardProgression';
import { canPermanentlyRemoveCard } from '../game-core/cardLifecycle';
import { flattenMvuArray } from '../runtime/mvuArrays';
export interface PendingRemovalPorts {
  read(): Record<string, any>;
  active(): boolean;
  choose(stat: Record<string, any>, remaining: number): Promise<string | null>;
  commit(id: string, revision: number): Promise<void>;
  changed(): Promise<void>;
}
/** Persisted allowance is the queue. Opening/cancelling never mutates a save. */
export class PendingCardRemoval {
  private running = false;
  private dismissed = '';
  resetDismissal(): void { this.dismissed = ''; }
  async offer(ports: PendingRemovalPorts, force = false): Promise<void> {
    if (this.running || !ports.active()) return;
    this.running = true;
    try {
      while (ports.active()) {
        const stat = structuredClone(ports.read());
        const remaining = Number(stat.battle?.core?.card_removal_count ?? 0);
        if (remaining === 0) this.dismissed = '';
        const cards = migratePersistentRunDeck(flattenMvuArray<Record<string, any>>(stat.battle?.cards));
        if (!Number.isInteger(remaining) || remaining <= 0 || !cards.some(canPermanentlyRemoveCard)) return;
        const revision = Number(stat.run_transaction_revision ?? 0);
        const key = JSON.stringify([stat.run?.seed, remaining]);
        if (!force && this.dismissed === key) return;
        force = false;
        const id = await ports.choose(stat, remaining);
        if (!ports.active()) return;
        if (id === null) { this.dismissed = key; return; }
        // The transaction rechecks revision, allowance and exact instance identity.
        await ports.commit(id, revision);
        this.dismissed = '';
        await ports.changed();
      }
    } finally { this.running = false; }
  }
}
