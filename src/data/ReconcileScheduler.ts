import { RECONCILE_BACKOFF_MS } from "./DiskReconcile";

/**
 * 磁盘对账调度器（obsidian-free 纯逻辑，定时器注入可测）。
 *
 * 职责：同路径去重（pending 期间重复 schedule 合并为一次）、失败有界退避
 * （RECONCILE_BACKOFF_MS 耗尽后报最终失败，不无限循环）、删除/重命名/卸载时
 * 使旧任务失效。成功（含 stale 重试后成功）后重置退避计数。
 */
export interface ReconcileSchedulerDeps {
  setTimer(callback: () => void, delayMs: number): number;
  clearTimer(timer: number): void;
  /** 执行一次对账任务；resolve true=成功（含无需再试），false=需按退避重试。 */
  runReconcile(path: string): Promise<boolean>;
  /** 退避耗尽后的最终失败报告（每轮退避序列只报一次）。 */
  onFinalFailure(path: string): void;
  /** 日志钩子（生产接 console.warn）。 */
  onScheduleError?(path: string, error: unknown): void;
}

interface PendingEntry {
  timer: number | null;
  attempts: number;
  running: boolean;
  /** 执行期间又收到该路径的新对账请求：本轮完成后必须再跑一轮，不得当作已覆盖丢弃。 */
  dirty: boolean;
}

export class ReconcileScheduler {
  private readonly pending = new Map<string, PendingEntry>();
  private destroyed = false;

  constructor(private readonly deps: ReconcileSchedulerDeps) {}

  /** 调度一次对账；同路径已有 pending（计时或执行中）则合并去重。 */
  schedule(path: string, delayMs = 0): void {
    if (this.destroyed || !path) return;
    const existing = this.pending.get(path);
    if (existing && existing.running) {
      // 执行中收到新请求：本轮读取可能错过这次变化，标记 dirty，完成后重跑。
      existing.dirty = true;
      return;
    }
    if (existing && existing.timer !== null) return; // 已在等待计时，合并
    const entry: PendingEntry = existing ?? { timer: null, attempts: 0, running: false, dirty: false };
    this.pending.set(path, entry);
    entry.timer = this.deps.setTimer(() => {
      entry.timer = null;
      void this.execute(path, entry);
    }, delayMs);
  }

  /** 立即执行（绕过延迟）；仍受同路径去重约束。 */
  scheduleNow(path: string): void {
    if (this.destroyed || !path) return;
    const existing = this.pending.get(path);
    if (existing && existing.running) {
      existing.dirty = true;
      return;
    }
    if (existing && existing.timer !== null) return;
    const entry: PendingEntry = existing ?? { timer: null, attempts: 0, running: false, dirty: false };
    this.pending.set(path, entry);
    void this.execute(path, entry);
  }

  /** 使路径的待办失效（删除/重命名/切换）。 */
  invalidate(path: string): void {
    const entry = this.pending.get(path);
    if (!entry) return;
    if (entry.timer !== null) this.deps.clearTimer(entry.timer);
    this.pending.delete(path);
  }

  has(path: string): boolean {
    return this.pending.has(path);
  }

  destroy(): void {
    this.destroyed = true;
    for (const entry of this.pending.values()) {
      if (entry.timer !== null) this.deps.clearTimer(entry.timer);
    }
    this.pending.clear();
  }

  private async execute(path: string, entry: PendingEntry): Promise<void> {
    if (this.destroyed) return;
    entry.running = true;
    entry.dirty = false; // 本轮开始处理当前已知变化
    let success = false;
    try {
      success = await this.deps.runReconcile(path);
    } catch (err) {
      this.deps.onScheduleError?.(path, err);
    } finally {
      entry.running = false;
    }
    if (this.destroyed || this.pending.get(path) !== entry) return;
    if (success) {
      if (entry.dirty) {
        // 执行期间路径再次变脏（如外部修改）：旧读取成功不等于覆盖了新变化，再跑一轮。
        entry.timer = this.deps.setTimer(() => {
          entry.timer = null;
          void this.execute(path, entry);
        }, 0);
        return;
      }
      this.pending.delete(path);
      return;
    }
    // 失败（任务异常或明确要求重试）：有界退避；耗尽报最终失败并放弃。
    if (entry.attempts >= RECONCILE_BACKOFF_MS.length) {
      this.pending.delete(path);
      this.deps.onFinalFailure(path);
      return;
    }
    const delay = RECONCILE_BACKOFF_MS[entry.attempts];
    entry.attempts += 1;
    entry.timer = this.deps.setTimer(() => {
      entry.timer = null;
      void this.execute(path, entry);
    }, delay);
  }
}
