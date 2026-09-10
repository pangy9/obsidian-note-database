import { configsDeepEqual } from "./FrontmatterPatch";
import type { FrontmatterKeySnapshot } from "./RenameTransaction";

/**
 * 磁盘对账任务与冲突决策（obsidian-free 纯逻辑）。
 *
 * 统一原语 reconcileFromDisk 的可测核心：生产侧（DataSource）注入真实依赖
 * （vault.read / YAML 解析 / recordCache / overlay / 版本表），测试注入假实现即可
 * 覆盖时序行为。设计约束：
 *
 * 1. 与同路径插件写入串行：任务本身由调用方放入 PathTaskQueue 执行——队列只约束
 *    本插件，不能排除外部编辑，不是完整的磁盘原子锁；因此读取完成后必须复验。
 * 2. 版本守卫（状态转换而非"值不相等"）：进入任务时捕获该路径的写入版本，
 *    await readFile 期间若版本前进（本插件有更新写入完成）→ 本次读取过期，
 *    丢弃并返回 "stale" 交由调度器重试，不得覆盖新缓存、清除新 overlay。
 * 3. 磁盘即真相：新鲜读取结果发布到 recordCache；frontmatter overlay 的每个 key
 *    若已在磁盘上追平则自然完成交接，若与磁盘不同说明发生了更新的外部修改——
 *    磁盘接管（overlay 整体清除），不能凭"值不相等"保留 overlay 造成永久遮蔽。
 * 4. view-def overlay 同规则：磁盘 database payload 与 overlay 捕获的 rawPayload
 *    一致 → 追平；不同 → 外部接管；版本前进 → 整个读取作废（保护更新中的配置）。
 * 5. 解析失败：保留原缓存并抛错（调度器有界重试），不得当作空 frontmatter；
 *    合法的无 frontmatter 文件才视为空对象。
 */
export interface ParsedDiskFrontmatter {
  ok: true;
  frontmatter: Record<string, unknown>;
}

export interface DiskReconcileTaskDeps {
  /** 读取文件全文。 */
  readFile(path: string): Promise<string>;
  /** 解析 frontmatter；解析失败必须返回 ok:false（而不是空对象）。 */
  parse(content: string): ParsedDiskFrontmatter | { ok: false; error: unknown };
  /** 深克隆（记录快照与外部对象隔离，含共享值数组）。 */
  clone(frontmatter: Record<string, unknown>): Record<string, unknown>;
  /** 读取完成后复验：文件是否仍存在且有效（期间可能被删除/重命名）。 */
  isFileValid(path: string): boolean;
  /** 读取前的文件变更戳（mtime 等）；读取后与当前值比较，外部修改在读取期间落地 → 丢弃。 */
  getFileStamp?(path: string): number | string | undefined;
  /** 任务作用域是否仍然有效（插件卸载/调度器销毁后不得发布缓存、清 overlay、广播）。 */
  isScopeValid?(): boolean;
  /** 该路径当前的插件写入版本（每次成功写入 +1）。 */
  getWriteVersion(path: string): number;
  /** frontmatter overlay（无则 null）。 */
  getFrontmatterOverlay(path: string): Record<string, FrontmatterKeySnapshot> | null;
  /** view-def overlay 捕获的 raw database payload（无则 undefined）。 */
  getViewDefRawPayload(path: string): unknown;
  /** 发布记录快照（深克隆后的磁盘真相）。 */
  publishSnapshot(path: string, frontmatter: Record<string, unknown>): void;
  /** 清除 frontmatter overlay（磁盘已接管）。 */
  clearFrontmatterOverlay(path: string): void;
  /** 清除 view-def overlay（追平或外部接管）。 */
  clearViewDefOverlay(path: string): void;
  /** 广播恢复信号（changed/external），不消费写入 ownership。 */
  notifyRecovered(path: string): void;
}

export type DiskReconcileOutcome =
  | { outcome: "published"; frontmatter: Record<string, unknown> }
  | { outcome: "stale" }
  | { outcome: "invalid-file" };

/**
 * 执行一次磁盘对账。调用方必须把本任务放入该路径的 PathTaskQueue（与写入串行）。
 * 返回值：published=已发布快照并完成 overlay 交接；stale=读取期间有新写入，应重试；
 * invalid-file=文件已不存在/无效（静默放弃，不重试不报错）。
 * 解析失败会 throw（保留原缓存），由调度器决定重试或最终报错。
 */
export function runDiskReconcileTask(
  deps: DiskReconcileTaskDeps,
  path: string
): Promise<DiskReconcileOutcome> {
  return (async (): Promise<DiskReconcileOutcome> => {
    // 排队期间可能已卸载或删除文件：失效任务不应再触发 IO。
    if (deps.isScopeValid?.() === false || !deps.isFileValid(path)) {
      return { outcome: "invalid-file" };
    }
    // 捕获版本与文件变更戳：await readFile 期间任何本插件写入完成都会使版本前进；
    // 外部修改不推进版本号，但会改变文件的 mtime——读前读后比较捕获该窗口。
    const capturedWriteVersion = deps.getWriteVersion(path);
    const capturedStamp = deps.getFileStamp?.(path);
    const content = await deps.readFile(path);
    if (deps.isScopeValid && deps.isScopeValid() === false) return { outcome: "invalid-file" };
    if (!deps.isFileValid(path)) return { outcome: "invalid-file" };
    if (deps.getWriteVersion(path) !== capturedWriteVersion) {
      // 读取期间发生了新的插件写入：本次读取过期。不发布、不清 overlay，
      // 交由调度器丢弃后重试（读取将看到写入后的磁盘）。
      return { outcome: "stale" };
    }
    if (capturedStamp !== undefined) {
      const currentStamp = deps.getFileStamp?.(path);
      if (currentStamp !== undefined && currentStamp !== capturedStamp) {
        // 读取期间发生了外部修改（版本号不覆盖外部变更）：同 stale 处理。
        return { outcome: "stale" };
      }
    }
    const parsed = deps.parse(content);
    if (!parsed.ok) throw parsed.error;
    const frontmatter = deps.clone(parsed.frontmatter);
    deps.publishSnapshot(path, frontmatter);
    // 磁盘即真相：frontmatter overlay 与 view-def overlay 无论是追平还是被更新的
    // 外部修改超越，都由磁盘接管——版本守卫已保证此刻没有本插件写入在途。
    if (deps.getFrontmatterOverlay(path)) deps.clearFrontmatterOverlay(path);
    const rawPayload = deps.getViewDefRawPayload(path);
    if (rawPayload !== undefined) {
      // view-def：database payload 追平（一致）→ 正常交接；不一致 → 外部接管。
      // 两种情形都清除 overlay（版本守卫已排除"我们自己更配置在途"）。
      deps.clearViewDefOverlay(path);
    }
    deps.notifyRecovered(path);
    return { outcome: "published", frontmatter };
  })();
}

/**
 * view-def 对账决策（独立纯函数，供行为测试直接断言决策表）：
 * versionAdvanced → 保护更新中的 overlay（丢弃读取）；
 * payload 一致 → 追平；不一致 → 外部接管。二者都结束 overlay 生命周期。
 */
export function resolveViewDefOverlay(params: {
  versionAdvanced: boolean;
  overlayPayload: unknown;
  diskPayload: unknown;
}): { action: "discard-read" } | { action: "hand-off"; caughtUp: boolean } {
  if (params.versionAdvanced) return { action: "discard-read" };
  return { action: "hand-off", caughtUp: configsDeepEqual(params.overlayPayload, params.diskPayload) };
}

/** 有界退避序列（ms）。耗尽后由调度器报告最终失败。 */
export const RECONCILE_BACKOFF_MS = [500, 1000, 2000] as const;

/**
 * 解析文件内容的 frontmatter（生产解析逻辑的纯函数形式，yamlParse 注入 obsidian
 * 的 parseYaml，测试注入模拟实现）。规则：
 *   - 无 frontmatter 分隔符 → 合法空对象；
 *   - 有开头 --- 但缺少结束分隔符 → 解析失败（不当作空对象发布）；
 *   - YAML 解析为 null 且段落仅空白/注释 → 合法空对象（解析器对空段返回 null）；
 *   - YAML 解析为标量/数组 → 解析失败；
 *   - 解析抛错 → 解析失败。
 */
export function parseDiskFrontmatter(
  content: string,
  yamlParse: (text: string) => unknown
): ParsedDiskFrontmatter | { ok: false; error: unknown } {
  const opening = /^(?:\uFEFF)?---[ \t]*\r?\n/.exec(content);
  if (!opening) {
    return { ok: true, frontmatter: {} };
  }
  // 从开头分隔符后的第一行扫描；结束符必须独占一行，不能截断值中的 hello---。
  // 第一行就结束也合法，兼容零内容 frontmatter。
  const lines = content.slice(opening[0].length).split(/\r?\n/);
  const closingIndex = lines.findIndex((line) => /^---[ \t]*$/.test(line));
  if (closingIndex < 0) {
    return { ok: false, error: new Error("unterminated frontmatter block") };
  }
  const body = lines.slice(0, closingIndex).join("\n");
  try {
    const parsed: unknown = yamlParse(body);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { ok: true, frontmatter: parsed as Record<string, unknown> };
    }
    if (parsed == null) {
      // 空段/仅注释的 YAML 解析为 null：合法的空 frontmatter。
      if (body.split("\n").every((line) => !line.trim() || line.trimStart().startsWith("#"))) {
        return { ok: true, frontmatter: {} };
      }
      return { ok: false, error: new Error("frontmatter resolved to null") };
    }
    return { ok: false, error: new Error("frontmatter is not a mapping") };
  } catch (error) {
    return { ok: false, error };
  }
}

/**
 * 有界并发池（手动刷新批量对账使用）：去重、限制并发、收集失败、进度回调。
 * 纯逻辑独立成函数便于行为测试（并发/去重/失败收集）。
 */
export async function runBoundedReconcilePool(
  paths: Iterable<string>,
  runOne: (path: string) => Promise<boolean>,
  opts: { concurrency?: number; onProgress?: (done: number, total: number) => void } = {}
): Promise<{ succeeded: number; failed: string[] }> {
  const unique = Array.from(new Set(paths));
  const concurrency = Math.max(1, Math.min(opts.concurrency ?? 8, unique.length || 1));
  let cursor = 0;
  let done = 0;
  let succeeded = 0;
  const failed: string[] = [];
  const worker = async (): Promise<void> => {
    while (cursor < unique.length) {
      const path = unique[cursor++];
      try {
        if (await runOne(path)) succeeded += 1;
        else failed.push(path);
      } catch {
        failed.push(path);
      } finally {
        done += 1;
        opts.onProgress?.(done, unique.length);
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  return { succeeded, failed };
}
