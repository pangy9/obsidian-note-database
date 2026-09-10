/**
 * Per-path FIFO 任务队列（obsidian-free 纯逻辑）。
 *
 * 从 DataSource.enqueueWrite 中抽出的串行原语：同一路径的任务严格按入队顺序执行，
 * 前一个任务失败不毒化队列。读写共用此队列实现「磁盘对账与插件写入串行协调」——
 * 关键约束：队列本身**零副作用**（不标记写入 ownership），读取任务使用它不会产生
 * "插件写入"标记、不会被外部变化过滤误伤；ownership 由写侧调用方自行包装。
 */
export class PathTaskQueue {
  private readonly tails = new Map<string, Promise<void>>();

  /** 按路径入队；返回的 promise 携带任务本身的成败。 */
  enqueue(path: string, task: () => Promise<void>): Promise<void> {
    const prev = this.tails.get(path) ?? Promise.resolve();
    const next = prev.catch(() => {}).then(task);
    this.tails.set(path, next);
    const cleanup = () => {
      if (this.tails.get(path) === next) this.tails.delete(path);
    };
    next.then(cleanup, cleanup);
    return next;
  }

  has(path: string): boolean {
    return this.tails.has(path);
  }

  clear(): void {
    this.tails.clear();
  }
}
