import { normalizeComputedSyncMode } from "./ComputedSync";
import { ColumnDef, ComputedFieldDef, ComputedSyncMode, DatabaseConfig } from "./types";

export type ObservablePropertyType = "text" | "multitext" | "number" | "date" | "datetime" | "checkbox";
export type PropertyConflictKind = "type" | "date-precision";
export type PropertyWriterKind = "column" | "computed";

export interface PropertyTypeConflictEntry {
  config: DatabaseConfig;
  sourcePath?: string;
}

export interface PropertyWriter {
  key: string;
  label: string;
  databaseId: string;
  databaseName: string;
  databasePath?: string;
  sourceKind: PropertyWriterKind;
  pluginType: ColumnDef["type"] | ComputedFieldDef["type"];
  observableType: ObservablePropertyType;
  computedSyncMode?: ComputedSyncMode;
}

export interface PropertyTypeConflict {
  key: string;
  kind: PropertyConflictKind;
  observableTypes: ObservablePropertyType[];
  writers: PropertyWriter[];
  involvesComputed: boolean;
  signature: string;
}

export interface PropertyTypeConflictDraftChange {
  databaseId: string;
  databasePath?: string;
  key: string;
  sourceKind: PropertyWriterKind;
  type: ColumnDef["type"] | ComputedFieldDef["type"];
}

const OBSERVABLE_TYPE_LABELS: Record<ObservablePropertyType, string> = {
  text: "Text",
  multitext: "Multi-text",
  number: "Number",
  date: "Date",
  datetime: "Date & time",
  checkbox: "Checkbox",
};

export function mapColumnTypeToObservablePropertyType(
  type: ColumnDef["type"] | ComputedFieldDef["type"]
): ObservablePropertyType | null {
  switch (type) {
    case "text":
    case "select":
    case "status":
      return "text";
    case "multi-select":
      return "multitext";
    case "number":
    case "currency":
      return "number";
    case "date":
      return "date";
    case "datetime":
      return "datetime";
    case "checkbox":
      return "checkbox";
    case "computed":
      return null;
    default:
      return null;
  }
}

export function getPropertyTypeConflictTypeLabel(type: ObservablePropertyType): string {
  return OBSERVABLE_TYPE_LABELS[type];
}

export function getPropertyTypeConflictEntryId(entry: PropertyTypeConflictEntry): string {
  return entry.config.id || entry.sourcePath || entry.config.name;
}

export function getPropertyWriters(entries: PropertyTypeConflictEntry[]): PropertyWriter[] {
  const writers: PropertyWriter[] = [];
  for (const entry of entries) {
    const databaseId = getPropertyTypeConflictEntryId(entry);
    const databaseName = entry.config.name || entry.sourcePath || databaseId;
    const databasePath = entry.sourcePath;
    const columns = entry.config.schema?.columns || [];
    const computedFields = entry.config.schema?.computedFields || [];

    for (const col of columns) {
      if (!col.key || col.type === "computed" || isFileFieldKey(col.key)) continue;
      const observableType = mapColumnTypeToObservablePropertyType(col.type);
      if (!observableType) continue;
      writers.push({
        key: col.key,
        label: col.label || col.key,
        databaseId,
        databaseName,
        databasePath,
        sourceKind: "column",
        pluginType: col.type,
        observableType,
      });
    }

    const syncMode = normalizeComputedSyncMode(entry.config.computedSyncMode);
    if (syncMode === "display-only") continue;
    for (const field of computedFields) {
      if (!field.key || isFileFieldKey(field.key)) continue;
      const observableType = mapColumnTypeToObservablePropertyType(field.type);
      if (!observableType) continue;
      writers.push({
        key: field.key,
        label: field.label || field.key,
        databaseId,
        databaseName,
        databasePath,
        sourceKind: "computed",
        pluginType: field.type,
        observableType,
        computedSyncMode: syncMode,
      });
    }
  }
  return dedupeWriters(writers);
}

export function findPropertyTypeConflicts(entries: PropertyTypeConflictEntry[]): PropertyTypeConflict[] {
  const byKey = new Map<string, PropertyWriter[]>();
  for (const writer of getPropertyWriters(entries)) {
    const existing = byKey.get(writer.key);
    if (existing) existing.push(writer);
    else byKey.set(writer.key, [writer]);
  }

  const conflicts: PropertyTypeConflict[] = [];
  for (const [key, writers] of byKey.entries()) {
    const observableTypes = Array.from(new Set(writers.map((writer) => writer.observableType))).sort();
    if (observableTypes.length <= 1) continue;
    conflicts.push({
      key,
      kind: isDatePrecisionConflict(observableTypes) ? "date-precision" : "type",
      observableTypes,
      writers: writers.slice().sort(compareWriters),
      involvesComputed: writers.some((writer) => writer.sourceKind === "computed"),
      signature: buildConflictSignature(key, observableTypes, writers),
    });
  }
  return conflicts.sort((left, right) => left.key.localeCompare(right.key));
}

export function filterPropertyTypeConflictsForEntry(
  conflicts: PropertyTypeConflict[],
  entry: PropertyTypeConflictEntry
): PropertyTypeConflict[] {
  const activeId = getPropertyTypeConflictEntryId(entry);
  return conflicts.filter((conflict) => conflict.writers.some((writer) => writer.databaseId === activeId));
}

export function filterPropertyTypeConflictsForChange(
  beforeConflicts: PropertyTypeConflict[],
  afterConflicts: PropertyTypeConflict[],
  entry: PropertyTypeConflictEntry,
  changedKey: string
): PropertyTypeConflict[] {
  const activeId = getPropertyTypeConflictEntryId(entry);
  const previousSignatures = new Set(beforeConflicts.map((conflict) => conflict.signature));
  return afterConflicts.filter((conflict) =>
    conflict.key === changedKey &&
    !previousSignatures.has(conflict.signature) &&
    conflict.writers.some((writer) => writer.databaseId === activeId)
  );
}

export function getPropertyWriterIdentity(writer: Pick<PropertyWriter, "databaseId" | "databasePath" | "key" | "sourceKind">): string {
  return [writer.databaseId, writer.databasePath || "", writer.key, writer.sourceKind].join("\u0000");
}

export function getDraftObservableType(
  writer: PropertyWriter,
  drafts: PropertyTypeConflictDraftChange[]
): ObservablePropertyType | null {
  const draft = drafts.find((candidate) => getPropertyWriterIdentity(candidate) === getPropertyWriterIdentity(writer));
  return mapColumnTypeToObservablePropertyType(draft?.type || writer.pluginType);
}

export function isPropertyTypeConflictResolvedWithDrafts(
  conflict: PropertyTypeConflict,
  drafts: PropertyTypeConflictDraftChange[]
): boolean {
  const observableTypes = new Set<ObservablePropertyType>();
  for (const writer of conflict.writers) {
    const observable = getDraftObservableType(writer, drafts);
    if (observable) observableTypes.add(observable);
  }
  return observableTypes.size <= 1;
}

export function getResolvedPropertyTypeConflictKeys(
  conflicts: PropertyTypeConflict[],
  drafts: PropertyTypeConflictDraftChange[]
): Set<string> {
  return new Set(
    conflicts
      .filter((conflict) => isPropertyTypeConflictResolvedWithDrafts(conflict, drafts))
      .map((conflict) => conflict.key)
  );
}

export function filterDraftChangesToResolvedConflicts(
  conflicts: PropertyTypeConflict[],
  drafts: PropertyTypeConflictDraftChange[]
): PropertyTypeConflictDraftChange[] {
  const resolvedKeys = getResolvedPropertyTypeConflictKeys(conflicts, drafts);
  return drafts.filter((draft) => resolvedKeys.has(draft.key));
}

function dedupeWriters(writers: PropertyWriter[]): PropertyWriter[] {
  const seen = new Set<string>();
  const result: PropertyWriter[] = [];
  for (const writer of writers) {
    const id = [
      writer.databaseId,
      writer.databasePath || "",
      writer.key,
      writer.sourceKind,
      writer.pluginType,
      writer.observableType,
      writer.label,
    ].join("\u0000");
    if (seen.has(id)) continue;
    seen.add(id);
    result.push(writer);
  }
  return result;
}

function isDatePrecisionConflict(types: ObservablePropertyType[]): boolean {
  return types.length === 2 && types.includes("date") && types.includes("datetime");
}

function buildConflictSignature(
  key: string,
  observableTypes: ObservablePropertyType[],
  writers: PropertyWriter[]
): string {
  const writerIds = writers.map((writer) => [
    writer.databaseId,
    writer.databasePath || "",
    writer.sourceKind,
    writer.pluginType,
    writer.observableType,
  ].join(":")).sort();
  return [key, observableTypes.join(","), writerIds.join("|")].join("::");
}

function compareWriters(left: PropertyWriter, right: PropertyWriter): number {
  return (left.databasePath || left.databaseName).localeCompare(right.databasePath || right.databaseName) ||
    left.sourceKind.localeCompare(right.sourceKind) ||
    left.label.localeCompare(right.label);
}

function isFileFieldKey(key: string): boolean {
  return key === "file" || key.startsWith("file.");
}
