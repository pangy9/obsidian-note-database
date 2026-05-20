import { App, TFile } from "obsidian";
import { getDefaultCellValue, toBooleanValue, toMultiSelectValues } from "./ColumnTypes";
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
  constructor(private app: App) {}

  async setObsidianPropertyType(key: string, type: ColumnDef["type"]): Promise<void> {
    if (!key || key === "file.name" || type === "computed") return;
    const adapter = this.app.vault.adapter;
    const configPath = ".obsidian/types.json";
    let data: { types?: Record<string, string> } = {};

    try {
      if (await adapter.exists(configPath)) {
        const raw = await adapter.read(configPath);
        data = raw.trim() ? JSON.parse(raw) : {};
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
    if (!oldKey || !newKey || oldKey === newKey) return result;

    for (const file of files) {
      await this.app.fileManager.processFrontMatter(file, (fm) => {
        const frontmatter = fm as Record<string, unknown>;
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
    if (!key || key === "file.name") return result;

    for (const file of files) {
      await this.app.fileManager.processFrontMatter(file, (fm) => {
        const frontmatter = fm as Record<string, unknown>;
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
    if (!sourceKey || !targetKey || sourceKey === targetKey) return result;

    for (const file of files) {
      await this.app.fileManager.processFrontMatter(file, (fm) => {
        const frontmatter = fm as Record<string, unknown>;
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
    if (!key || key === "file.name" || type === "computed") return result;

    for (const file of files) {
      await this.app.fileManager.processFrontMatter(file, (fm) => {
        const frontmatter = fm as Record<string, unknown>;
        if (!Object.prototype.hasOwnProperty.call(frontmatter, key)) {
          result.skipped += 1;
          return;
        }
        const nextValue = this.convertValueForType(frontmatter[key], type);
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
    if (!key || key === "file.name") return result;

    for (const file of files) {
      await this.app.fileManager.processFrontMatter(file, (fm) => {
        const frontmatter = fm as Record<string, unknown>;
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

  getDefaultValue(col: ColumnDef): unknown {
    return getDefaultCellValue(col);
  }

  convertValueForType(value: unknown, type: ColumnDef["type"]): unknown {
    if (value == null || value === "") return "";
    switch (type) {
      case "number":
      case "currency": {
        const parsed = typeof value === "number" ? value : parseFloat(String(value).replace(/,/g, ""));
        return Number.isFinite(parsed) ? parsed : "";
      }
      case "date": {
        if (value instanceof Date && !isNaN(value.getTime())) {
          return value.toISOString().substring(0, 10);
        }
        const text = String(value).trim();
        const match = text.match(/^\d{4}-\d{2}-\d{2}/);
        if (match) return match[0];
        const parsed = new Date(text);
        return isNaN(parsed.getTime()) ? "" : parsed.toISOString().substring(0, 10);
      }
      case "text":
      case "select":
      case "status":
        return String(value);
      case "multi-select":
        return toMultiSelectValues(value);
      case "checkbox":
        return toBooleanValue(value);
      default:
        return value;
    }
  }

  private cloneValue(value: unknown): unknown {
    if (Array.isArray(value)) return [...value];
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
