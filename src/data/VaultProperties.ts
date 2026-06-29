import { App } from "obsidian";
import { ColumnDef } from "./types";
import { isFileFieldKey } from "./FileFields";
import { inferColumnType } from "./FrontmatterScanner";

export interface VaultProperty {
  key: string;
  type: ColumnDef["type"];
}

export interface VaultPropertyCacheInfo {
  count: number;
  refreshedAt: number;
  durationMs: number;
}

let cachedProperties: VaultProperty[] | null = null;
let cacheInfo: VaultPropertyCacheInfo = { count: 0, refreshedAt: 0, durationMs: 0 };

/** Map an Obsidian-declared property type to a plugin column type. This is kept for
 *  defensive compatibility with imported property metadata, but the runtime picker uses
 *  the plugin-owned metadata-cache scan below instead of Obsidian's internal registries. */
export function obsidianTypeToColumnType(obsidianType: string): ColumnDef["type"] {
  switch (obsidianType.trim().toLowerCase()) {
    case "number":
      return "number";
    case "date":
      return "date";
    case "datetime":
    case "date&time":
    case "date-time":
      return "datetime";
    case "checkbox":
    case "bool":
    case "boolean":
      return "checkbox";
    case "multitext":
    case "tags":
    case "aliases":
    case "multiselect":
      return "multi-select";
    default:
      return "text";
  }
}

/** Normalize raw property metadata when an import path already has declared Obsidian types.
 *  Runtime code should not call Obsidian's internal metadataTypeManager directly. */
export function mapRawProperties(raw: unknown): VaultProperty[] {
  if (!raw || typeof raw !== "object") return [];
  const entries: Array<[string, unknown]> = raw instanceof Map
    ? Array.from(raw.entries()).filter((entry): entry is [string, unknown] => typeof entry[0] === "string")
    : Object.entries(raw as Record<string, unknown>);
  const properties: VaultProperty[] = [];
  for (const [key, value] of entries) {
    if (!key || isFileFieldKey(key)) continue;
    const rawType = typeof value === "string"
      ? value
      : (value && typeof value === "object" ? (value as { type?: unknown }).type : undefined);
    const obsidianType = typeof rawType === "string" ? rawType : "";
    properties.push({ key, type: obsidianTypeToColumnType(obsidianType) });
  }
  properties.sort((a, b) => a.key.localeCompare(b.key));
  return properties;
}

/** Build a complete property list from Obsidian's public metadata cache. This does not
 *  read file contents; it walks loaded Markdown files and their parsed frontmatter. */
export function collectVaultPropertiesFromMetadataCache(app: App): VaultProperty[] {
  const vault = (app as unknown as {
    vault?: { getMarkdownFiles?: () => Array<{ path: string }> };
    metadataCache?: { getFileCache?: (file: unknown) => { frontmatter?: Record<string, unknown> } | null | undefined };
  }).vault;
  const metadataCache = (app as unknown as {
    metadataCache?: { getFileCache?: (file: unknown) => { frontmatter?: Record<string, unknown> } | null | undefined };
  }).metadataCache;
  const files = vault?.getMarkdownFiles?.();
  if (!Array.isArray(files) || !metadataCache?.getFileCache) return [];

  const samples = new Map<string, unknown[]>();
  for (const file of files) {
    const fm = metadataCache.getFileCache(file)?.frontmatter;
    if (!fm || fm["db_view"] === true) continue;
    for (const key of Object.keys(fm)) {
      if (!key || key.startsWith("_") || key === "db_view" || isFileFieldKey(key)) continue;
      const list = samples.get(key) || [];
      if (list.length < 10 && fm[key] != null) list.push(fm[key]);
      samples.set(key, list);
    }
  }

  return Array.from(samples.entries())
    .map(([key, values]) => ({ key, type: inferColumnType(key, values) }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

/** Refresh the plugin-owned vault property cache. Call on plugin load and after metadata
 *  changes; callers that only need values should use `getVaultProperties`. */
export function refreshVaultPropertyCache(app: App): VaultProperty[] {
  const started = nowMs();
  cachedProperties = collectVaultPropertiesFromMetadataCache(app);
  cacheInfo = {
    count: cachedProperties.length,
    refreshedAt: Date.now(),
    durationMs: nowMs() - started,
  };
  return cachedProperties;
}

/** Synchronous source for source-rule property pickers. If refresh has not run yet, build
 *  the cache immediately from the public metadata cache. */
export function getVaultProperties(app: App): VaultProperty[] {
  if (!cachedProperties) refreshVaultPropertyCache(app);
  return cachedProperties ?? [];
}

export function getVaultPropertyCacheInfo(): VaultPropertyCacheInfo {
  return { ...cacheInfo };
}

/** Test-only: reset the cache so unit tests don't leak state across cases. */
export function __resetVaultPropertiesCacheForTests(): void {
  cachedProperties = null;
  cacheInfo = { count: 0, refreshedAt: 0, durationMs: 0 };
}

function nowMs(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}
