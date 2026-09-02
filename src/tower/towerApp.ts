import type { RunMapEdge, RunMapNode } from '../game-core/runMap';
import type { RunState } from '../game-core/runState';
import {
  requestRuntimeParentFullscreen,
  subscribeRuntimeParentFullscreen,
} from '../runtime/runtimeFullscreen';
import {
  createTowerMapPresentation,
  type TowerMapPresentation,
  type TowerMapPresentationOptions,
  type TowerNodePresentation,
} from './towerMapPresenter';

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const MAP_WIDTH = 700;
const MAP_HEIGHT = 1600;
const MAP_X_PADDING = 60;
const MAP_Y_PADDING = 70;
const MAP_FLOORS = 16;
const MAP_COLUMNS = 5;

export interface TowerAppCallbacks {
  onNodeSelect?: (node: RunMapNode, snapshot: RunState) => void;
  onRetryNode?: (node: RunMapNode, snapshot: RunState) => void;
  onRetry?: (snapshot: RunState) => void;
  onActChange?: (act: number, snapshot: RunState) => void;
  onFullscreenChange?: (fullscreen: boolean) => void;
}

export interface MountTowerAppOptions extends TowerMapPresentationOptions {
  root: HTMLElement;
  snapshot: RunState;
  callbacks?: TowerAppCallbacks;
  error?: string;
  title?: string;
}

export interface TowerAppUpdateOptions extends TowerMapPresentationOptions {
  error?: string;
}

export interface TowerAppController {
  update(snapshot: RunState, options?: TowerAppUpdateOptions): void;
  setCallbacks(callbacks: TowerAppCallbacks): void;
  selectAct(act: number): void;
  destroy(): void;
}

function pointFor(node: Pick<RunMapNode, 'column' | 'floor'>): { x: number; y: number } {
  const x = MAP_X_PADDING + (node.column * (MAP_WIDTH - MAP_X_PADDING * 2)) / (MAP_COLUMNS - 1);
  const y = MAP_HEIGHT - MAP_Y_PADDING - ((node.floor - 1) * (MAP_HEIGHT - MAP_Y_PADDING * 2)) / (MAP_FLOORS - 1);
  return { x, y };
}

function edgeState(
  edge: RunMapEdge,
  nodes: ReadonlyMap<string, TowerNodePresentation>,
): 'traversed' | 'reachable' | 'locked' {
  const from = nodes.get(edge.from);
  const to = nodes.get(edge.to);
  if (!from || !to) return 'locked';
  if (to.routeState === 'current' || (from.routeState === 'visited' && to.routeState === 'visited')) return 'traversed';
  if (to.routeState === 'reachable' && (from.routeState === 'current' || from.routeState === 'visited'))
    return 'reachable';
  return 'locked';
}

function createElement<K extends keyof HTMLElementTagNameMap>(
  document: Document,
  tagName: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function createMetric(document: Document, label: string, value: string, className: string): HTMLElement {
  const metric = createElement(document, 'div', `tower-metric ${className}`);
  metric.append(createElement(document, 'span', 'tower-metric-label', label));
  metric.append(createElement(document, 'strong', 'tower-metric-value', value));
  return metric;
}

function contentPhaseLabel(node: TowerNodePresentation): string {
  switch (node.contentPhase) {
    case 'queued':
      return '排队';
    case 'generating':
      return '准备中';
    case 'ready':
      return node.routeState === 'reachable' ? '可进入' : '已备好';
    case 'failed':
      return '可重试';
    default:
      return '';
  }
}

class TowerMapApp implements TowerAppController {
  private readonly root: HTMLElement;
  private readonly document: Document;
  private snapshot: RunState;
  private callbacks: TowerAppCallbacks;
  private selectedAct: number;
  private difficultyPercent?: number;
  private error: string;
  private readonly title: string;
  private shell: HTMLElement | null = null;
  private fullscreenButton: HTMLButtonElement | null = null;
  private mapViewport: HTMLElement | null = null;
  private pseudoFullscreen = false;
  private lastScrollKey = '';
  private pendingScrollFrame: number | null = null;
  private pendingScroll: {
    viewport: HTMLElement;
    canvas: HTMLElement;
    y: number;
    key: string;
  } | null = null;
  private readonly unsubscribeParentFullscreen: () => void;

  constructor(options: MountTowerAppOptions) {
    this.root = options.root;
    this.document = options.root.ownerDocument;
    this.snapshot = options.snapshot;
    this.callbacks = options.callbacks ?? {};
    this.selectedAct = options.selectedAct ?? options.snapshot.act;
    this.difficultyPercent = options.difficultyPercent;
    this.error = String(options.error || '');
    this.title = String(options.title || '星路远征');
    this.document.addEventListener('fullscreenchange', this.handleFullscreenChange);
    this.document.addEventListener('keydown', this.handleKeyDown);
    this.unsubscribeParentFullscreen = subscribeRuntimeParentFullscreen(active => {
      this.setPseudoFullscreen(active);
    });
    this.render();
  }

  update(snapshot: RunState, options: TowerAppUpdateOptions = {}): void {
    this.snapshot = snapshot;
    if (options.selectedAct !== undefined) this.selectedAct = options.selectedAct;
    if (options.difficultyPercent !== undefined) this.difficultyPercent = options.difficultyPercent;
    if (options.error !== undefined) this.error = String(options.error || '');
    this.render();
  }

  setCallbacks(callbacks: TowerAppCallbacks): void {
    this.callbacks = callbacks;
  }

  selectAct(act: number): void {
    if (!this.snapshot.map?.acts.some(candidate => candidate.act === act)) return;
    this.selectedAct = act;
    this.callbacks.onActChange?.(act, this.snapshot);
    this.render();
  }

  destroy(): void {
    if (this.pseudoFullscreen) void requestRuntimeParentFullscreen(false, 'tower');
    this.unsubscribeParentFullscreen();
    this.cancelPendingScrollFrame();
    this.document.removeEventListener('fullscreenchange', this.handleFullscreenChange);
    this.document.removeEventListener('keydown', this.handleKeyDown);
    this.root.classList.remove('mwg-tower-host');
    this.root.replaceChildren();
    this.shell = null;
    this.fullscreenButton = null;
    this.mapViewport = null;
    this.pendingScroll = null;
  }

  private readonly handleFullscreenChange = (): void => {
    this.updateFullscreenButton();
    this.callbacks.onFullscreenChange?.(this.isFullscreen());
  };

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || !this.pseudoFullscreen) return;
    void requestRuntimeParentFullscreen(false, 'tower');
    this.setPseudoFullscreen(false);
  };

  private setPseudoFullscreen(active: boolean): void {
    if (this.pseudoFullscreen === active) return;
    this.pseudoFullscreen = active;
    this.shell?.classList.toggle('is-pseudo-fullscreen', active);
    this.updateFullscreenButton();
    this.callbacks.onFullscreenChange?.(active);
  }

  private isFullscreen(): boolean {
    return this.document.fullscreenElement === this.shell || this.pseudoFullscreen;
  }

  private updateFullscreenButton(): void {
    if (!this.fullscreenButton) return;
    const active = this.isFullscreen();
    this.fullscreenButton.textContent = active ? '退出全屏' : '全屏游玩';
    this.fullscreenButton.setAttribute('aria-pressed', String(active));
  }

  private async toggleFullscreen(): Promise<void> {
    if (!this.shell) return;
    if (this.pseudoFullscreen) {
      await requestRuntimeParentFullscreen(false, 'tower');
      this.setPseudoFullscreen(false);
      return;
    }
    try {
      if (this.document.fullscreenElement === this.shell) {
        await this.document.exitFullscreen();
        return;
      }
      if (this.shell.requestFullscreen) {
        const parentAccepted = await requestRuntimeParentFullscreen(true, 'tower');
        if (parentAccepted) {
          this.setPseudoFullscreen(true);
          return;
        }
        await this.shell.requestFullscreen();
        return;
      }
    } catch {
      // Iframes can reject the native API; the fixed-position fallback remains available.
    }
    this.setPseudoFullscreen(true);
  }

  private createHeader(presentation: TowerMapPresentation): HTMLElement {
    const header = createElement(this.document, 'header', 'tower-header');
    const identity = createElement(this.document, 'div', 'tower-identity');
    identity.append(createElement(this.document, 'span', 'tower-identity-mark', '✦'));
    const copy = createElement(this.document, 'div', 'tower-identity-copy');
    copy.append(createElement(this.document, 'p', 'tower-kicker', 'MAGICAL ASCENSION'));
    copy.append(createElement(this.document, 'h1', 'tower-title', this.title));
    copy.append(
      createElement(
        this.document,
        'p',
        'tower-subtitle',
        `${presentation.chapterLabel} · ${presentation.chapterStateLabel}`,
      ),
    );
    identity.append(copy);

    const metrics = createElement(this.document, 'div', 'tower-metrics');
    metrics.append(createMetric(this.document, '层数', presentation.floorLabel, 'is-floor'));
    metrics.append(createMetric(this.document, '金币', presentation.goldLabel, 'is-gold'));
    metrics.append(createMetric(this.document, '难度', presentation.difficultyLabel, 'is-difficulty'));

    this.fullscreenButton = createElement(this.document, 'button', 'tower-fullscreen-button', '全屏游玩');
    this.fullscreenButton.type = 'button';
    this.fullscreenButton.setAttribute('aria-label', '切换爬塔地图全屏模式');
    this.fullscreenButton.addEventListener('click', () => void this.toggleFullscreen());
    header.append(identity, metrics, this.fullscreenButton);
    this.updateFullscreenButton();
    return header;
  }

  private createActTabs(presentation: TowerMapPresentation): HTMLElement {
    const tabs = createElement(this.document, 'nav', 'tower-act-tabs');
    tabs.setAttribute('aria-label', '选择要查看的章节');
    for (const tab of presentation.actTabs) {
      const button = createElement(this.document, 'button', `tower-act-tab is-${tab.state}`);
      button.type = 'button';
      button.dataset.act = String(tab.act);
      button.setAttribute('aria-pressed', String(tab.act === presentation.selectedAct));
      if (tab.act === presentation.selectedAct) button.classList.add('is-selected');
      const label = createElement(this.document, 'strong', 'tower-act-name', tab.label);
      const detail = createElement(
        this.document,
        'small',
        'tower-act-detail',
        `${tab.difficultyPercent}% · ${tab.state === 'cleared' ? '已通过' : tab.state === 'current' ? '当前' : '预览'}`,
      );
      button.append(label, detail);
      button.addEventListener('click', () => this.selectAct(tab.act));
      tabs.append(button);
    }
    return tabs;
  }

  private createErrorPanel(presentation: TowerMapPresentation): HTMLElement | null {
    const generalError = this.error || presentation.mapError;
    if (!generalError && presentation.failedNodes.length === 0) return null;
    const panel = createElement(this.document, 'section', 'tower-error-panel');
    panel.setAttribute('role', 'alert');
    const heading = createElement(this.document, 'div', 'tower-error-heading');
    const copy = createElement(this.document, 'div', 'tower-error-copy');
    copy.append(createElement(this.document, 'strong', '', generalError ? '地图暂时无法继续' : '部分地点生成失败'));
    copy.append(
      createElement(
        this.document,
        'span',
        '',
        generalError || `${presentation.failedNodes.length} 个可见地点需要重新生成。`,
      ),
    );
    heading.append(copy);
    if (generalError && this.callbacks.onRetry) {
      const retry = createElement(this.document, 'button', 'tower-retry-button', '重新载入');
      retry.type = 'button';
      retry.addEventListener('click', () => this.callbacks.onRetry?.(this.snapshot));
      heading.append(retry);
    }
    panel.append(heading);

    if (presentation.failedNodes.length > 0) {
      const failures = createElement(this.document, 'div', 'tower-failure-list');
      for (const failed of presentation.failedNodes) {
        const item = createElement(this.document, 'div', 'tower-failure-item');
        const message = createElement(
          this.document,
          'span',
          '',
          `第 ${failed.node.floor} 层 · ${failed.type.label}：${failed.error}`,
        );
        item.append(message);
        if (this.callbacks.onRetryNode && failed.routeState !== 'locked') {
          const retry = createElement(this.document, 'button', 'tower-retry-node', '重试');
          retry.type = 'button';
          retry.dataset.retryNodeId = failed.node.id;
          retry.addEventListener('click', () => this.callbacks.onRetryNode?.(failed.node, this.snapshot));
          item.append(retry);
        }
        failures.append(item);
      }
      panel.append(failures);
    }
    return panel;
  }

  private createMapEdges(presentation: TowerMapPresentation): SVGSVGElement {
    const svg = this.document.createElementNS(SVG_NAMESPACE, 'svg');
    svg.setAttribute('class', 'tower-route-lines');
    svg.setAttribute('viewBox', `0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('aria-hidden', 'true');
    const nodeById = new Map(presentation.nodes.map(node => [node.node.id, node]));
    for (const edge of presentation.act?.edges ?? []) {
      const from = nodeById.get(edge.from);
      const to = nodeById.get(edge.to);
      if (!from || !to) continue;
      const start = pointFor(from.node);
      const end = pointFor(to.node);
      const midpoint = (start.y + end.y) / 2;
      const path = this.document.createElementNS(SVG_NAMESPACE, 'path');
      path.setAttribute(
        'd',
        `M ${start.x} ${start.y} C ${start.x} ${midpoint}, ${end.x} ${midpoint}, ${end.x} ${end.y}`,
      );
      path.setAttribute('class', `tower-route-line is-${edgeState(edge, nodeById)}`);
      path.dataset.from = edge.from;
      path.dataset.to = edge.to;
      svg.append(path);
    }
    return svg;
  }

  private createFloorGuides(): HTMLElement {
    const guides = createElement(this.document, 'div', 'tower-floor-guides');
    guides.setAttribute('aria-hidden', 'true');
    for (let floor = 1; floor <= MAP_FLOORS; floor += 1) {
      const point = pointFor({ column: 0, floor });
      const guide = createElement(
        this.document,
        'span',
        'tower-floor-guide',
        floor === MAP_FLOORS ? 'BOSS' : String(floor),
      );
      guide.style.setProperty('--tower-y', `${(point.y / MAP_HEIGHT) * 100}%`);
      guides.append(guide);
    }
    return guides;
  }

  private createMapNode(node: TowerNodePresentation): HTMLButtonElement {
    const button = createElement(
      this.document,
      'button',
      `tower-map-node is-${node.node.kind} is-${node.routeState} content-${node.contentPhase}`,
    );
    button.type = 'button';
    button.dataset.nodeId = node.node.id;
    button.dataset.floor = String(node.node.floor);
    button.dataset.routeState = node.routeState;
    button.dataset.contentState = node.contentPhase;
    button.setAttribute('aria-label', node.ariaLabel);
    button.setAttribute('aria-current', node.routeState === 'current' ? 'step' : 'false');
    button.title = node.ariaLabel;
    const point = pointFor(node.node);
    button.style.setProperty('--tower-x', `${(point.x / MAP_WIDTH) * 100}%`);
    button.style.setProperty('--tower-y', `${(point.y / MAP_HEIGHT) * 100}%`);

    const sigil = createElement(this.document, 'span', 'tower-node-sigil', node.type.icon);
    sigil.setAttribute('aria-hidden', 'true');
    const label = createElement(this.document, 'span', 'tower-node-label', node.type.label);
    button.append(sigil, label);
    const phase = contentPhaseLabel(node);
    if (phase) button.append(createElement(this.document, 'span', 'tower-node-phase', phase));
    if (node.contentPhase === 'queued' || node.contentPhase === 'generating') {
      button.append(createElement(this.document, 'span', 'tower-node-orbit'));
    }

    if (node.contentPhase === 'failed' && node.routeState !== 'locked' && this.callbacks.onRetryNode) {
      button.classList.add('can-retry');
      button.addEventListener('click', () => this.callbacks.onRetryNode?.(node.node, this.snapshot));
    } else if (node.interactive && this.callbacks.onNodeSelect) {
      button.classList.add('can-enter');
      button.addEventListener('click', () => this.callbacks.onNodeSelect?.(node.node, this.snapshot));
    } else {
      button.disabled = true;
    }
    return button;
  }

  private createMapStatus(presentation: TowerMapPresentation): HTMLElement {
    const status = createElement(this.document, 'div', 'tower-map-status');
    const instruction = createElement(this.document, 'p', 'tower-map-instruction');
    instruction.append(createElement(this.document, 'span', 'tower-map-instruction-mark', '↟'));
    instruction.append(
      createElement(
        this.document,
        'span',
        '',
        presentation.selectedAct === presentation.activeAct
          ? '点选发光地点继续远征，浅蓝路线代表当前可达。'
          : `正在预览第 ${presentation.selectedAct} 幕，当前远征仍在第 ${presentation.activeAct} 幕。`,
      ),
    );
    status.append(instruction);

    const counters = createElement(this.document, 'div', 'tower-map-status-counters');
    const enterable = presentation.nodes.filter(node => node.interactive).length;
    const preparing = presentation.nodes.filter(
      node => node.contentPhase === 'queued' || node.contentPhase === 'generating',
    ).length;
    if (enterable > 0) {
      counters.append(createElement(this.document, 'span', 'tower-map-status-chip is-ready', `可进入 ${enterable}`));
    }
    if (preparing > 0) {
      counters.append(
        createElement(this.document, 'span', 'tower-map-status-chip is-generating', `后台准备 ${preparing}`),
      );
    }
    if (counters.children.length > 0) status.append(counters);
    return status;
  }

  private createLegend(): HTMLElement {
    const legend = createElement(this.document, 'div', 'tower-map-legend');
    const entries = [
      ['current', '当前位置'],
      ['reachable', '下一步可达'],
      ['visited', '已走过'],
      ['generating', '后台生成中'],
    ] as const;
    for (const [state, label] of entries) {
      const item = createElement(this.document, 'span', 'tower-legend-item');
      item.append(createElement(this.document, 'i', `tower-legend-dot is-${state}`));
      item.append(createElement(this.document, 'span', '', label));
      legend.append(item);
    }
    return legend;
  }

  private createMap(presentation: TowerMapPresentation): HTMLElement {
    const section = createElement(this.document, 'section', 'tower-map-section');
    const sectionHeader = createElement(this.document, 'div', 'tower-map-section-header');
    const sectionCopy = createElement(this.document, 'div');
    sectionCopy.append(createElement(this.document, 'strong', '', `${presentation.chapterLabel} 星路图`));
    sectionCopy.append(createElement(this.document, 'span', '', presentation.chapterStateLabel));
    sectionHeader.append(sectionCopy, this.createLegend());
    section.append(sectionHeader, this.createMapStatus(presentation));

    const viewport = createElement(this.document, 'div', 'tower-map-viewport');
    viewport.dataset.mapAct = String(presentation.selectedAct);
    this.mapViewport = viewport;
    const canvas = createElement(this.document, 'div', 'tower-map-canvas');
    canvas.append(this.createMapEdges(presentation), this.createFloorGuides());
    for (const node of presentation.nodes) canvas.append(this.createMapNode(node));
    viewport.append(canvas);
    section.append(viewport);

    const focusNode =
      presentation.nodes.find(node => node.node.id === presentation.currentNodeId) ??
      presentation.nodes.find(node => node.routeState === 'reachable');
    const scrollKey = `${presentation.selectedAct}:${focusNode?.node.id || 'start'}`;
    if (this.lastScrollKey !== scrollKey) {
      this.pendingScroll = {
        viewport,
        canvas,
        y: focusNode ? pointFor(focusNode.node).y : MAP_HEIGHT,
        key: scrollKey,
      };
    }
    return section;
  }

  private cancelPendingScrollFrame(): void {
    if (this.pendingScrollFrame === null) return;
    this.document.defaultView?.cancelAnimationFrame(this.pendingScrollFrame);
    this.pendingScrollFrame = null;
  }

  private applyPendingScroll(): boolean {
    if (!this.pendingScroll) return true;
    const { viewport, canvas, y, key } = this.pendingScroll;
    const viewportHeight = viewport.clientHeight;
    const canvasHeight = canvas.scrollHeight;
    // The reward surface keeps the map mounted with display:none.  Browsers
    // report a zero-sized layout there and clamp scrollTop to zero.  Do not
    // consume the focus key until the map owns a real scrollable box again.
    if (viewportHeight <= 0 || canvasHeight <= viewportHeight) return false;
    const target = Math.min(
      canvasHeight - viewportHeight,
      Math.max(0, (y / MAP_HEIGHT) * canvasHeight - viewportHeight * 0.62),
    );
    viewport.scrollTop = target;
    if (Math.abs(viewport.scrollTop - target) > 2) return false;
    this.lastScrollKey = key;
    this.pendingScroll = null;
    return true;
  }

  private schedulePendingScroll(): void {
    if (!this.pendingScroll || this.pendingScrollFrame !== null) return;
    const view = this.document.defaultView;
    if (!view?.requestAnimationFrame) return;
    this.pendingScrollFrame = view.requestAnimationFrame(() => {
      this.pendingScrollFrame = null;
      // One post-layout attempt is enough for a newly mounted visible map.
      // If an ancestor still hides it, the pending key survives and the next
      // state render (for example after reward settlement) retries naturally.
      this.applyPendingScroll();
    });
  }

  private restorePreservedScroll(previousMapAct: string | undefined, previousScrollTop: number | undefined): void {
    const currentViewport = this.mapViewport;
    if (
      this.pendingScroll ||
      !currentViewport ||
      previousScrollTop === undefined ||
      previousMapAct !== currentViewport.dataset.mapAct
    ) {
      return;
    }
    currentViewport.scrollTop = previousScrollTop;
  }

  private createEmptyMap(presentation: TowerMapPresentation): HTMLElement {
    const empty = createElement(this.document, 'section', 'tower-map-empty');
    empty.append(createElement(this.document, 'span', 'tower-empty-icon', '✦'));
    empty.append(createElement(this.document, 'strong', '', '星路尚未展开'));
    empty.append(createElement(this.document, 'p', '', presentation.mapError || '等待完整地图数据。'));
    if (this.callbacks.onRetry) {
      const retry = createElement(this.document, 'button', 'tower-retry-button', '重新载入地图');
      retry.type = 'button';
      retry.addEventListener('click', () => this.callbacks.onRetry?.(this.snapshot));
      empty.append(retry);
    }
    return empty;
  }

  private render(): void {
    this.cancelPendingScrollFrame();
    const presentation = createTowerMapPresentation(this.snapshot, {
      selectedAct: this.selectedAct,
      difficultyPercent: this.difficultyPercent,
    });
    this.selectedAct = presentation.selectedAct;
    this.root.classList.add('mwg-tower-host');
    const previousViewport = this.mapViewport;
    const previousMapAct = previousViewport?.dataset.mapAct;
    const previousScrollTop = previousViewport?.scrollTop;
    this.mapViewport = null;
    this.pendingScroll = null;
    const shell = this.shell ?? createElement(this.document, 'article');
    shell.className = 'mwg-tower-app';
    shell.replaceChildren();
    shell.dataset.phase = this.snapshot.phase;
    shell.dataset.selectedAct = String(presentation.selectedAct);
    if (this.pseudoFullscreen) shell.classList.add('is-pseudo-fullscreen');
    this.shell = shell;
    shell.append(this.createHeader(presentation));
    if (presentation.actTabs.length > 0) shell.append(this.createActTabs(presentation));
    const errors = this.createErrorPanel(presentation);
    if (errors) shell.append(errors);
    shell.append(presentation.act ? this.createMap(presentation) : this.createEmptyMap(presentation));
    if (shell.parentElement !== this.root) this.root.replaceChildren(shell);
    this.restorePreservedScroll(previousMapAct, previousScrollTop);
    if (!this.applyPendingScroll()) this.schedulePendingScroll();
  }
}

export function mountTowerApp(options: MountTowerAppOptions): TowerAppController {
  return new TowerMapApp(options);
}
