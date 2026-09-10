export interface ComputedSyncTarget {
  path: string;
}

export interface ComputedSyncCoordinatorDeps<C, T extends ComputedSyncTarget = ComputedSyncTarget> {
  listTargets(): T[];
  isRelevant(target: T, change: C): boolean;
  syncTarget(path: string, shouldContinue: () => boolean): Promise<void>;
  setTimer(callback: () => void, delay: number): number;
  clearTimer(timer: number): void;
  onError?(path: string, error: unknown): void;
  delayMs?: number;
}

/**
 * Plugin-wide computed persistence scheduler. A database path can occur only once
 * in the pending set, regardless of how many Dashboard/Embedded views observed the
 * same change. Runtime evaluation remains injected so this state machine is testable
 * without Obsidian.
 */
export class ComputedSyncCoordinator<C, T extends ComputedSyncTarget = ComputedSyncTarget> {
  private readonly pending = new Set<string>();
  private timer: number | null = null;
  private running = false;
  private destroyed = false;
  private generation = 0;
  private readonly targetVersions = new Map<string, number>();

  constructor(private readonly deps: ComputedSyncCoordinatorDeps<C, T>) {}

  requestChanges(changes: readonly C[]): void {
    if (this.destroyed || changes.length === 0) return;
    for (const target of this.deps.listTargets()) {
      if (changes.some((change) => this.deps.isRelevant(target, change))) {
        // A running sync may have captured records/config before this change.
        // Invalidate it before queueing the fresh pass so it cannot write stale results.
        this.invalidatePath(target.path);
        this.pending.add(target.path);
      }
    }
    this.schedule();
  }

  requestAll(): void {
    if (this.destroyed) return;
    for (const target of this.deps.listTargets()) {
      // requestAll can be triggered by a config mutation that has no path.
      // Treat it like the path-specific requests: an in-flight run may hold an
      // obsolete config/record snapshot, so stop it before queueing the fresh pass.
      this.invalidatePath(target.path);
      this.pending.add(target.path);
    }
    this.schedule();
  }

  requestPath(path: string): void {
    if (this.destroyed || !path) return;
    this.invalidatePath(path);
    if (!this.deps.listTargets().some((target) => target.path === path)) return;
    this.pending.add(path);
    this.schedule();
  }

  async flushNow(): Promise<void> {
    if (this.destroyed || this.running || this.pending.size === 0) return;
    this.clearScheduledTimer();
    const paths = Array.from(this.pending);
    this.pending.clear();
    const generation = this.generation;
    const currentPaths = new Set(this.deps.listTargets().map((target) => target.path));
    this.running = true;
    try {
      for (const path of paths) {
        if (!currentPaths.has(path) || !this.shouldContinue(generation)) continue;
        const targetVersion = this.targetVersions.get(path);
        try {
          await this.deps.syncTarget(
            path,
            () => this.shouldContinue(generation, path, targetVersion)
          );
        } catch (error) {
          this.deps.onError?.(path, error);
        }
      }
    } finally {
      this.running = false;
      if (this.pending.size > 0) this.schedule();
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.generation += 1;
    this.pending.clear();
    this.targetVersions.clear();
    this.clearScheduledTimer();
  }

  private schedule(): void {
    if (this.destroyed || this.running || this.pending.size === 0) return;
    this.clearScheduledTimer();
    this.timer = this.deps.setTimer(() => {
      this.timer = null;
      void this.flushNow();
    }, this.deps.delayMs ?? 5000);
  }

  /** Cancel an in-flight target before its next write without affecting other databases. */
  invalidatePath(path: string): void {
    if (this.destroyed || !path) return;
    this.targetVersions.set(path, (this.targetVersions.get(path) || 0) + 1);
    this.pending.delete(path);
  }

  private clearScheduledTimer(): void {
    if (this.timer === null) return;
    this.deps.clearTimer(this.timer);
    this.timer = null;
  }

  private shouldContinue(generation: number, path?: string, targetVersion?: number): boolean {
    return !this.destroyed &&
      this.generation === generation &&
      (path == null || this.targetVersions.get(path) === targetVersion);
  }
}
