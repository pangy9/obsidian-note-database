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
    return a.file.path.localeCompare(b.file.path);
  });
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
