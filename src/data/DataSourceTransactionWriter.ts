import type { DataSource, ViewConfigMutation } from "./DataSource";
import type { DatabaseConfig } from "./types";
import type { TransactionWriter, FrontmatterKeySnapshot, FrontmatterWrite } from "./RenameTransaction";

/**
 * 把 RenameTransaction executor 接到真实文件 IO（DataSource）—— TransactionWriter
 * 的生产适配器（R2-CO-1）。
 *
 *   patchFrontmatter → DataSource.patchFrontmatter（笔记 frontmatter：单文件队列内
 *     read→校验涉及 key==expect→apply set/delete→写回 + optimistic overlay）
 *   patchConfig      → DataSource.patchViewDefConfig（view-def：database payload CAS +
 *     rememberViewDefConfig(raw casNext) + peer notify，post-commit hook 隔离异常）
 *
 * 两端都满足 writer 契约：resolve=已落盘、reject=未写入；同 path 经 enqueueWrite 串行。
 * adapter 本身是无状态转发，行为由 DataSource 保证（B1.7 生产故障注入端到端验证）。
 */
export class DataSourceTransactionWriter implements TransactionWriter {
  constructor(
    private readonly dataSource: DataSource,
    private readonly assertWritable?: () => void
  ) {}

  forCompensation(): TransactionWriter {
    return new DataSourceTransactionWriter(this.dataSource);
  }

  async patchFrontmatter(
    path: string,
    expect: Record<string, FrontmatterKeySnapshot>,
    writes: Record<string, FrontmatterWrite>
  ): Promise<void> {
    this.assertWritable?.();
    await this.dataSource.patchFrontmatter(path, expect, writes, this.assertWritable);
  }

  async patchConfig(
    path: string,
    casExpect: unknown,
    casNext: unknown,
    typedNext?: unknown,
    mutation?: unknown
  ): Promise<void> {
    this.assertWritable?.();
    await this.dataSource.patchViewDefConfig(
      path,
      casExpect,
      casNext,
      typedNext as DatabaseConfig | undefined,
      mutation as ViewConfigMutation | undefined,
      this.assertWritable
    );
  }
}
