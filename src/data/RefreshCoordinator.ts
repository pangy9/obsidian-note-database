export interface RefreshState {
  pendingCount: number;
  pendingUnknown: boolean;
  refreshing: boolean;
}

export interface RefreshRequest {
  paths: string[];
  unknown: boolean;
  manual: boolean;
}

export interface RefreshCoordinatorOptions {
  isBlocked: () => boolean;
  isEligible?: () => boolean;
  onRefresh: (request: RefreshRequest) => void | Promise<void>;
  onStateChange?: (state: RefreshState) => void;
  onError?: (error: unknown) => void;
  idleDelayMs?: number;
  maxDelayMs?: number;
  blockedRetryMs?: number;
  eligibilityRetryMs?: number;
  setTimer?: (callback: () => void, delay: number) => number;
  clearTimer?: (timer: number) => void;
}

/**
 * Coalesces external file changes without owning any view or Obsidian state.
 * The first event starts a maximum-delay timer; later events only reset the
 * short idle timer. Dirty paths stay queued while a view is hidden or editing.
 */
export class RefreshCoordinator {
  private readonly paths = new Set<string>();
  private unknown = false;
  private refreshing = false;
  private manualRequested = false;
  private idleTimer: number | null = null;
  private maxTimer: number | null = null;
  private retryTimer: number | null = null;
  private destroyed = false;
  private lastState = "";

  constructor(private readonly options: RefreshCoordinatorOptions) {
    this.emitState();
  }

  mark(paths: Iterable<string>, unknown = false): void {
    if (this.destroyed) return;
    const wasEmpty = !this.hasPending();
    for (const path of paths) {
      if (path) this.paths.add(path);
    }
    this.unknown ||= unknown;
    if (!this.hasPending()) return;
    this.emitState();
    this.scheduleIdle();
    if (wasEmpty && this.maxTimer === null) {
      this.maxTimer = this.setTimer(() => {
        this.maxTimer = null;
        void this.tryRefresh(false);
      }, this.options.maxDelayMs ?? 10_000);
    }
  }

  /** Manual refresh also works when no dirty paths have been observed. */
  refreshNow(): void {
    if (this.destroyed) return;
    this.manualRequested = true;
    this.emitState();
    void this.tryRefresh(true);
  }

  /** Re-check a queue after focus, visibility, or editor state changes. */
  poke(): void {
    if (this.destroyed || (!this.hasPending() && !this.manualRequested)) return;
    void this.tryRefresh(this.manualRequested);
  }

  getState(): RefreshState {
    return {
      pendingCount: this.paths.size,
      pendingUnknown: this.unknown,
      refreshing: this.refreshing,
    };
  }

  destroy(): void {
    this.destroyed = true;
    this.clearTimers();
    this.paths.clear();
  }

  private hasPending(): boolean {
    return this.paths.size > 0 || this.unknown;
  }

  private scheduleIdle(): void {
    if (this.idleTimer !== null) this.clearTimer(this.idleTimer);
    this.idleTimer = this.setTimer(() => {
      this.idleTimer = null;
      void this.tryRefresh(this.manualRequested);
    }, this.options.idleDelayMs ?? 2_000);
  }

  private scheduleRetry(delay: number): void {
    if (this.retryTimer !== null) return;
    this.retryTimer = this.setTimer(() => {
      this.retryTimer = null;
      void this.tryRefresh(this.manualRequested);
    }, delay);
  }

  private async tryRefresh(manual: boolean): Promise<void> {
    if (this.destroyed || this.refreshing) return;
    if (!manual && !this.hasPending()) return;
    if (!manual && this.options.isEligible && !this.options.isEligible()) {
      // Focus/active-leaf events are advisory and can be missed during app
      // switching or split-pane activation. Keep a cheap retry alive while
      // dirty data is queued so the batch cannot become permanently stranded.
      this.manualRequested ||= manual;
      this.scheduleRetry(this.options.eligibilityRetryMs ?? 1_000);
      return;
    }
    if (this.options.isBlocked()) {
      this.manualRequested ||= manual;
      this.scheduleRetry(this.options.blockedRetryMs ?? 300);
      return;
    }

    this.clearTimers();
    const paths = Array.from(this.paths);
    const unknown = this.unknown;
    this.paths.clear();
    this.unknown = false;
    this.manualRequested = false;
    this.refreshing = true;
    this.emitState();
    try {
      await this.options.onRefresh({ paths, unknown, manual });
    } catch (error) {
      for (const path of paths) this.paths.add(path);
      this.unknown ||= unknown;
      this.options.onError?.(error);
    } finally {
      this.refreshing = false;
      this.emitState();
      if (this.hasPending() || this.manualRequested) this.scheduleIdle();
    }
  }

  private clearTimers(): void {
    if (this.idleTimer !== null) this.clearTimer(this.idleTimer);
    if (this.maxTimer !== null) this.clearTimer(this.maxTimer);
    if (this.retryTimer !== null) this.clearTimer(this.retryTimer);
    this.idleTimer = null;
    this.maxTimer = null;
    this.retryTimer = null;
  }

  private setTimer(callback: () => void, delay: number): number {
    return this.options.setTimer?.(callback, delay) ?? window.setTimeout(callback, delay);
  }

  private clearTimer(timer: number): void {
    if (this.options.clearTimer) this.options.clearTimer(timer);
    else window.clearTimeout(timer);
  }

  private emitState(): void {
    const state = this.getState();
    const key = `${state.pendingCount}:${state.pendingUnknown}:${state.refreshing}`;
    if (key === this.lastState) return;
    this.lastState = key;
    this.options.onStateChange?.(state);
  }
}
