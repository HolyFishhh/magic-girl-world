/** Makes the active battle occupy the viewport without changing battle state. */
import {
  enterBattleFullscreenFallback,
  exitBattleFullscreenFallback,
  type BattleFullscreenFallbackSnapshot,
} from './battleFullscreenFallback';
import {
  requestRuntimeParentFullscreen,
  subscribeRuntimeParentFullscreen,
} from '../../runtime/runtimeFullscreen';

export class BattleFullscreenController {
  private button: HTMLButtonElement | null = null;
  private fallbackActive = false;
  private fallbackSnapshot: BattleFullscreenFallbackSnapshot | null = null;
  private parentDocument: Document | null = null;
  private frame: HTMLElement | null = null;
  private parentBridgeActive = false;
  private unsubscribeParentFullscreen: (() => void) | null = null;
  private readonly onFullscreenChange = (): void => this.syncState();
  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && this.fallbackActive) this.exitFallback();
  };

  public initialize(): void {
    this.button = document.getElementById('battle-fullscreen-toggle') as HTMLButtonElement | null;
    if (!this.button) return;
    this.frame = this.resolveFrameElement();
    this.parentDocument = this.frame?.ownerDocument || null;
    this.button.addEventListener('click', () => void this.toggle());
    this.unsubscribeParentFullscreen = subscribeRuntimeParentFullscreen(active => {
      this.parentBridgeActive = active;
      this.syncState();
    });
    document.addEventListener('fullscreenchange', this.onFullscreenChange);
    this.parentDocument?.addEventListener('fullscreenchange', this.onFullscreenChange);
    document.addEventListener('keydown', this.onKeyDown);
    this.syncState();
  }

  public destroy(): void {
    if (this.parentBridgeActive) void requestRuntimeParentFullscreen(false, 'fish');
    if (this.fallbackActive) this.exitFallback();
    this.unsubscribeParentFullscreen?.();
    this.unsubscribeParentFullscreen = null;
    document.removeEventListener('fullscreenchange', this.onFullscreenChange);
    this.parentDocument?.removeEventListener('fullscreenchange', this.onFullscreenChange);
    document.removeEventListener('keydown', this.onKeyDown);
  }

  private resolveFrameElement(): HTMLElement | null {
    try {
      const frame = window.frameElement as HTMLElement | null;
      return frame?.style ? frame : null;
    } catch {
      return null;
    }
  }

  private isNativeFullscreen(): boolean {
    return Boolean(
      document.fullscreenElement ||
        (this.frame && this.parentDocument?.fullscreenElement === this.frame),
    );
  }

  private isActive(): boolean {
    return this.parentBridgeActive || this.fallbackActive || this.isNativeFullscreen();
  }

  private async toggle(): Promise<void> {
    if (this.isActive()) {
      await this.exit();
      return;
    }
    await this.enter();
  }

  private async enter(): Promise<void> {
    if (await requestRuntimeParentFullscreen(true, 'fish')) {
      this.parentBridgeActive = true;
      document.documentElement.classList.add('mwg-fullscreen-active');
      this.syncState();
      return;
    }
    const candidates = [this.frame, document.documentElement].filter(
      (element): element is HTMLElement => Boolean(element?.requestFullscreen),
    );
    for (const element of candidates) {
      try {
        await element.requestFullscreen({ navigationUI: 'hide' });
        document.documentElement.classList.add('mwg-fullscreen-active');
        this.syncState();
        return;
      } catch (error) {
        console.warn('[MagicGirlWorld] 原生全屏不可用，尝试兼容模式', error);
      }
    }
    this.enterFallback();
  }

  private async exit(): Promise<void> {
    if (this.parentBridgeActive) {
      await requestRuntimeParentFullscreen(false, 'fish');
      this.parentBridgeActive = false;
      this.syncState();
      return;
    }
    if (this.fallbackActive) {
      this.exitFallback();
      return;
    }
    try {
      if (this.frame && this.parentDocument?.fullscreenElement === this.frame) {
        await this.parentDocument.exitFullscreen();
      } else if (document.fullscreenElement) {
        await document.exitFullscreen();
      }
    } finally {
      this.syncState();
    }
  }

  private enterFallback(): void {
    if (!this.frame || !this.parentDocument?.body) {
      document.documentElement.classList.add('mwg-fullscreen-active');
      this.fallbackActive = true;
      this.syncState();
      return;
    }
    this.fallbackSnapshot = enterBattleFullscreenFallback(this.frame, this.parentDocument);
    this.fallbackActive = true;
    document.documentElement.classList.add('mwg-fullscreen-active');
    this.syncState();
  }

  private exitFallback(): void {
    if (this.frame && this.parentDocument?.body && this.fallbackSnapshot) {
      exitBattleFullscreenFallback(this.frame, this.parentDocument, this.fallbackSnapshot);
    }
    this.fallbackSnapshot = null;
    this.fallbackActive = false;
    document.documentElement.classList.remove('mwg-fullscreen-active');
    this.syncState();
  }

  private syncState(): void {
    const active = this.isActive();
    document.documentElement.classList.toggle('mwg-fullscreen-active', active);
    if (!this.button) return;
    this.button.classList.toggle('active', active);
    this.button.setAttribute('aria-label', active ? '退出全屏：返回酒馆楼层' : '全屏游玩：让战斗界面占满当前窗口');
    this.button.setAttribute('title', active ? '退出全屏：返回酒馆楼层' : '全屏游玩：让战斗界面占满当前窗口');
    const icon = this.button.querySelector<HTMLElement>('.fullscreen-icon');
    const text = this.button.querySelector<HTMLElement>('.fullscreen-text');
    if (icon) icon.textContent = active ? '↙' : '⛶';
    if (text) text.textContent = active ? '退出全屏' : '全屏游玩';
    window.dispatchEvent(new Event('resize'));
  }
}
