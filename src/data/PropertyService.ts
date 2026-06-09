import { App, TFile } from "obsidian";
import { getDefaultCellValue, normalizeOptionValueForKey, toBooleanValue, toMultiSelectValuesForKey } from "./ColumnTypes";
import type { FrontmatterMutator } from "./DataSource";
import { isFileFieldKey } from "./FileFields";
import { stringifyValue } from "./Stringify";
import { ColumnDef } from "./types";

export interface RenameFrontmatterResult {
  moved: number;
  skippedConflicts: number;
  deletedStale: number;
}

export interface FrontmatterBatchResult {
  changed: number;
  skipped: number;
}

export class PropertyService {
  /** Serialize writes to Obsidian property type metadata to prevent read-modify-write races */
  private typesJsonWriteQueue: Promise<void> = Promise.resolve();

  constructor(
    private app: App,
    private mutateFrontmatter?: (file: TFile, mutator: FrontmatterMutator) => Promise<void>
  ) {}

  async setObsidianPropertyType(key: string, type: ColumnDef["type"]): Promise<void> {
    if (!key || isFileFieldKey(key) || type === "computed") return;
    // Serialize writes to prevent read-modify-write races
    const task = this.typesJsonWriteQueue.then(() => this.doSetObsidianPropertyType(key, type));
    this.typesJsonWriteQueue = task.catch(() => {}); // keep queue alive on error
    return task;
  }

  private async doSetObsidianPropertyType(key: string, type: ColumnDef["type"]): Promise<void> {
    const adapter = this.app.vault.adapter;
    const configPath = `${this.app.vault.configDir}/types.json`;
    let data: { types?: Record<string, string> } = {};

    try {
      if (await adapter.exists(configPath)) {
        const raw = await adapter.read(configPath);
        data = raw.trim() ? JSON.parse(raw) as { types?: Record<string, string> } : {};
      }
    } catch (err) {
      console.warn("Note Database: failed to read Obsidian property types", err);
      data = {};
    }

    data.types = data.types || {};
    data.types[key] = this.toObsidianPropertyType(type);
    await adapter.write(configPath, `${JSON.stringify(data, null, 2)}\n`);
  }

  async renameKey(
    files: TFile[],
    oldKey: string,
    newKey: string,
    staleValue?: unknown,
    force = false
  ): Promise<RenameFrontmatterResult> {
    const result: RenameFrontmatterResult = { moved: 0, skippedConflicts: 0, deletedStale: 0 };
    if (!oldKey || !newKey || oldKey === newKey || isFileFieldKey(oldKey) || isFileFieldKey(newKey)) return result;

    for (const file of files) {
      await this.processFrontmatter(file, (frontmatter) => {
        if (!Object.prototype.hasOwnProperty.call(frontmatter, oldKey)) return;
        if (force) {
          // Force mode: always overwrite new key with old key's value
          frontmatter[newKey] = frontmatter[oldKey];
          delete frontmatter[oldKey];
          result.moved += 1;
          return;
        }
        const hasTarget = Object.prototype.hasOwnProperty.call(frontmatter, newKey);
        const targetValue = frontmatter[newKey];
        const canMove = !hasTarget || targetValue == null || targetValue === "";
        if (!canMove) {
          if (this.isStaleGeneratedValue(frontmatter[oldKey], staleValue)) {
            delete frontmatter[oldKey];
            result.deletedStale += 1;
            return;
          }
          result.skippedConflicts += 1;
          return;
        }
        frontmatter[newKey] = frontmatter[oldKey];
        delete frontmatter[oldKey];
        result.moved += 1;
      });
    }

    return result;
  }

  private isStaleGeneratedValue(value: unknown, staleValue: unknown): boolean {
    if (value == null || value === "") return true;
    if (Array.isArray(value) && value.length === 0) return true;
    return this.valuesEqual(value, staleValue);
  }

  private valuesEqual(a: unknown, b: unknown): boolean {
    if (Array.isArray(a) || Array.isArray(b)) {
      return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
    }
    return a === b;
  }

  async ensureKey(
    files: TFile[],
    key: string,
    value: unknown = ""
  ): Promise<FrontmatterBatchResult> {
    const result: FrontmatterBatchResult = { changed: 0, skipped: 0 };
    if (!key || isFileFieldKey(key)) return result;

    for (const file of files) {
      await this.processFrontmatter(file, (frontmatter) => {
        if (Object.prototype.hasOwnProperty.call(frontmatter, key)) {
          result.skipped += 1;
          return;
        }
        frontmatter[key] = value;
        result.changed += 1;
      });
    }

    return result;
  }

  async copyKey(
    files: TFile[],
    sourceKey: string,
    targetKey: string
  ): Promise<FrontmatterBatchResult> {
    const result: FrontmatterBatchResult = { changed: 0, skipped: 0 };
    if (!sourceKey || !targetKey || sourceKey === targetKey || isFileFieldKey(sourceKey) || isFileFieldKey(targetKey)) return result;

    for (const file of files) {
      await this.processFrontmatter(file, (frontmatter) => {
        if (!Object.prototype.hasOwnProperty.call(frontmatter, sourceKey)) {
          result.skipped += 1;
          return;
        }
        const targetValue = frontmatter[targetKey];
        const canCopy = !Object.prototype.hasOwnProperty.call(frontmatter, targetKey) ||
          targetValue == null ||
          targetValue === "";
        if (!canCopy) {
          result.skipped += 1;
          return;
        }
        frontmatter[targetKey] = this.cloneValue(frontmatter[sourceKey]);
        result.changed += 1;
      });
    }

    return result;
  }

  async convertKeyType(
    files: TFile[],
    key: string,
    type: ColumnDef["type"]
  ): Promise<FrontmatterBatchResult> {
    const result: FrontmatterBatchResult = { changed: 0, skipped: 0 };
    if (!key || isFileFieldKey(key) || type === "computed") return result;

    for (const file of files) {
      await this.processFrontmatter(file, (frontmatter) => {
        if (!Object.prototype.hasOwnProperty.call(frontmatter, key)) {
          result.skipped += 1;
          return;
        }
        const nextValue = this.convertValueForType(frontmatter[key], type, key);
        if (nextValue === undefined) {
          result.skipped += 1;
          return;
        }
        if (frontmatter[key] === nextValue) {
          result.skipped += 1;
          return;
        }
        frontmatter[key] = nextValue;
        result.changed += 1;
      });
    }

    return result;
  }

  async deleteKey(files: TFile[], key: string): Promise<FrontmatterBatchResult> {
    const result: FrontmatterBatchResult = { changed: 0, skipped: 0 };
    if (!key || isFileFieldKey(key)) return result;

    for (const file of files) {
      await this.processFrontmatter(file, (frontmatter) => {
        if (!Object.prototype.hasOwnProperty.call(frontmatter, key)) {
          result.skipped += 1;
          return;
        }
        delete frontmatter[key];
        result.changed += 1;
      });
    }

    return result;
  }

  private async processFrontmatter(file: TFile, mutator: FrontmatterMutator): Promise<void> {
    // Prefer DataSource so bulk property operations share queued writes and metadata-cache overlays.
    if (this.mutateFrontmatter) {
      await this.mutateFrontmatter(file, mutator);
      return;
    }
    await this.app.fileManager.processFrontMatter(file, (fm) => mutator(fm as Record<string, unknown>));
  }

  getDefaultValue(col: ColumnDef): unknown {
    return getDefaultCellValue(col);
  }

  convertValueForType(value: unknown, type: ColumnDef["type"], key = ""): unknown {
    if (value == null || value === "") return "";
    switch (type) {
      case "number":
      case "currency": {
        const parsed = typeof value === "number" ? value : parseFloat(stringifyValue(value).replace(/,/g, ""));
        return Number.isFinite(parsed) ? parsed : "";
      }
      case "date": {
        if (value instanceof Date && !isNaN(value.getTime())) {
          return value.toISOString().substring(0, 10);
        }
        const text = stringifyValue(value).trim();
        const match = text.match(/^\d{4}-\d{2}-\d{2}/);
        if (match) return match[0];
        const parsed = new Date(text);
        return isNaN(parsed.getTime()) ? "" : parsed.toISOString().substring(0, 10);
      }
      case "text":
        return stringifyValue(value);
      case "select":
      case "status":
        return normalizeOptionValueForKey(key, toMultiSelectValuesForKey(key, value)[0] || "");
      case "multi-select":
        return toMultiSelectValuesForKey(key, value);
      case "checkbox":
        return toBooleanValue(value);
      default:
        return value;
    }
  }

  private cloneValue(value: unknown): unknown {
    if (Array.isArray(value)) return [...(value as unknown[])];
    if (value && typeof value === "object") return { ...(value as Record<string, unknown>) };
    return value;
  }

  private toObsidianPropertyType(type: ColumnDef["type"]): string {
    switch (type) {
      case "number":
      case "currency":
        return "number";
      case "date":
        return "date";
      case "checkbox":
        return "checkbox";
      case "multi-select":
        return "multitext";
      case "status":
      case "select":
      case "text":
      default:
        return "text";
    }
  }
}
