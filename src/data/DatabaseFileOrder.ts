import { TFile } from "obsidian";
import { DatabaseConfig } from "./types";

export interface DatabaseFileEntry {
  file: TFile;
  config: DatabaseConfig;
}

export function sortDatabaseFileEntries(entries: DatabaseFileEntry[], order: string[] = []): DatabaseFileEntry[] {
  const indexByPath = new Map(order.map((path, index) => [path, index]));
  return [...entries].sort((a, b) => {
    const aIndex = indexByPath.get(a.file.path);
    const bIndex = indexByPath.get(b.file.path);
    if (aIndex != null && bIndex != null) return aIndex - bIndex;
    if (aIndex != null) return -1;
    if (bIndex != null) return 1;
    // 未记录（新建）的库按文件时间升序：新建者最晚 → 稳定落在列表末尾；
    // 同秒并发创建回落路径字典序保证稳定。
    const aTime = a.file.stat?.mtime ?? 0;
    const bTime = b.file.stat?.mtime ?? 0;
    if (aTime !== bTime) return aTime - bTime;
    return a.file.path.localeCompare(b.file.path);
  });
}

/**
 * 一次性迁移（零感知方案）：把不在 order 里的现有库路径按旧字典序追加到末尾，
 * 固化老用户当前看到的列表顺序；此后新建的库（未记录）才按创建时间排尾。
 */
export function appendUntrackedDatabasePaths(order: string[], allPaths: string[]): string[] {
  const known = new Set(order);
  const untracked = allPaths.filter((path) => !known.has(path));
  if (untracked.length === 0) return order;
  untracked.sort((a, b) => a.localeCompare(b));
  return [...order, ...untracked];
}

export function moveDatabaseFilePath(currentPaths: string[], fromPath: string, toPath: string): string[] {
  const paths = [...currentPaths];
  const fromIndex = paths.indexOf(fromPath);
  const toIndex = paths.indexOf(toPath);
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return paths;
  const [moved] = paths.splice(fromIndex, 1);
  paths.splice(toIndex, 0, moved);
  return paths;
}
