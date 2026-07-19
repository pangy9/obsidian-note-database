import type { App } from "obsidian";
import { evaluateComputedFields } from "./ComputedEvaluator";
import { getRowFileFieldValue, isFileFieldKey } from "./FileFields";
import { parseRelationValues } from "./RelationLinks";
import { stringifyValue } from "./Stringify";
import type { ColumnDef, DatabaseConfig } from "./types";
import type { NoteRecord } from "./DataSource";

export interface RelationRollupContext {
  app: App;
  sourceRecords: NoteRecord[];
  sourceDatabase: DatabaseConfig;
  databases: DatabaseConfig[];
  getRecordsForDatabase(database: DatabaseConfig): NoteRecord[];
}

export interface RelationRollupResult {
  valuesByPath: Map<string, Record<string, unknown>>;
  /** Valid target paths referenced by the source rows, used to scope refreshes. */
  targetPaths: Set<string>;
}

export function buildRelationRollups(context: RelationRollupContext): RelationRollupResult {
  const valuesByPath = new Map<string, Record<string, unknown>>();
  const targetPaths = new Set<string>();
  const databaseById = new Map(context.databases.map((database) => [database.id, database]));
  const relationColumns = new Map(
    context.sourceDatabase.schema.columns
      .filter((column) => column.type === "relation" && column.relationConfig?.targetDatabaseId)
      .map((column) => [column.key, column])
  );
  const rollupColumns = context.sourceDatabase.schema.columns.filter(
    (column) => column.type === "rollup" && column.rollupConfig
  );
  if (rollupColumns.length === 0) return { valuesByPath, targetPaths };

  const targetCache = new Map<string, {
    database: DatabaseConfig;
    recordsByPath: Map<string, NoteRecord>;
  }>();

  const getTarget = (relation: ColumnDef) => {
    const targetDatabaseId = relation.relationConfig?.targetDatabaseId;
    if (!targetDatabaseId) return null;
    const cached = targetCache.get(targetDatabaseId);
    if (cached) return cached;
    const database = databaseById.get(targetDatabaseId);
    if (!database) return null;
    const recordsByPath = new Map(
      context.getRecordsForDatabase(database).map((record) => [record.file.path, record])
    );
    const target = { database, recordsByPath };
    targetCache.set(targetDatabaseId, target);
    return target;
  };

  for (const sourceRecord of context.sourceRecords) {
    const derived: Record<string, unknown> = {};
    for (const rollup of rollupColumns) {
      const config = rollup.rollupConfig!;
      const relation = relationColumns.get(config.relationField);
      const target = relation ? getTarget(relation) : null;
      if (!relation || !target) {
        derived[rollup.key] = emptyRollupValue(config.aggregation);
        continue;
      }
      const relatedRecords: NoteRecord[] = [];
      const seenPaths = new Set<string>();
      for (const link of parseRelationValues(sourceRecord.frontmatter[relation.key])) {
        const resolved = context.app.metadataCache.getFirstLinkpathDest(link.target, sourceRecord.file.path);
        if (!resolved || seenPaths.has(resolved.path)) continue;
        const record = target.recordsByPath.get(resolved.path);
        if (!record) continue;
        seenPaths.add(resolved.path);
        targetPaths.add(resolved.path);
        relatedRecords.push(record);
      }
      derived[rollup.key] = aggregateRollup(
        relatedRecords,
        target.database,
        config.targetField,
        config.aggregation,
        context.app
      );
    }
    valuesByPath.set(sourceRecord.file.path, derived);
  }
  return { valuesByPath, targetPaths };
}

function aggregateRollup(
  records: NoteRecord[],
  database: DatabaseConfig,
  targetField: string,
  aggregation: NonNullable<ColumnDef["rollupConfig"]>["aggregation"],
  app: App
): unknown {
  if (aggregation === "count") return records.length;
  const column = database.schema.columns.find((candidate) => candidate.key === targetField);
  if (column?.type === "rollup") return emptyRollupValue(aggregation);
  const values = records.flatMap((record) => {
    const value = getTargetFieldValue(record, database, column, targetField, app);
    return Array.isArray(value)
      ? value.map((entry: unknown) => entry)
      : value == null || value === ""
        ? []
        : [value];
  });
  if (aggregation === "list") {
    const seen = new Set<string>();
    const result: unknown[] = [];
    for (const value of values) {
      const key = stringifyValue(value);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      result.push(value);
    }
    return result;
  }
  const numbers = values
    .map((value) => typeof value === "number" ? value : Number(stringifyValue(value).replace(/[^0-9.-]/g, "")))
    .filter((value) => Number.isFinite(value));
  if (numbers.length === 0) return null;
  const sum = numbers.reduce((total, value) => total + value, 0);
  return aggregation === "avg" ? sum / numbers.length : sum;
}

function getTargetFieldValue(
  record: NoteRecord,
  database: DatabaseConfig,
  column: ColumnDef | undefined,
  targetField: string,
  app: App
): unknown {
  if (isFileFieldKey(targetField)) {
    return getRowFileFieldValue({
      app,
      file: record.file,
      frontmatter: record.frontmatter,
      cache: app.metadataCache.getFileCache(record.file),
      computed: {},
    }, targetField);
  }
  if (column?.type === "computed") {
    const computed = evaluateComputedFields(
      database.schema.computedFields,
      database.schema.columns,
      record.frontmatter,
      { app, file: record.file }
    );
    return computed[column.computedKey || column.key];
  }
  return record.frontmatter[targetField];
}

function emptyRollupValue(aggregation: NonNullable<ColumnDef["rollupConfig"]>["aggregation"]): unknown {
  return aggregation === "count" ? 0 : aggregation === "list" ? [] : null;
}
