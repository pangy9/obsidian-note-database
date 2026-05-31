import { App, TFile, Notice, stringifyYaml } from "obsidian";
import { ColumnDef, DatabaseConfig, RowData, ViewConfig } from "./types";
import { t } from "../i18n";
import { createStoredZip, ZipEntry } from "./ZipExport";
import { saveZipWithPicker } from "./ExportSaveTarget";

export interface CsvMarkdownExportOptions {
  includeFrontmatter: boolean;
}

/** Create a CSV+Markdown ZIP file in the vault and return the created TFile */
export async function createCsvMarkdownZip(
  app: App,
  dbConfig: DatabaseConfig,
  viewConfig: ViewConfig,
  rows: RowData[],
  getRowsForView: (index: number) => RowData[],
  getVisibleColumns: (view: ViewConfig) => ColumnDef[],
  getExportCellValue: (row: RowData, col: ColumnDef) => string,
  outputFolder: string,
  options: CsvMarkdownExportOptions
): Promise<TFile | null> {
  if (rows.length === 0) {
    new Notice(t("errors.noDataExport"));
    return null;
  }
  const baseName = sanitize(String(dbConfig.name || "Database"));
  const entries: ZipEntry[] = [];
  const pageNames = new Map<string, number>();

  // Build markdown files
  for (const row of rows) {
    const title = row.file.basename || t("common.untitled");
    const pageName = uniqueName(sanitize(title), pageNames);
    const md = await app.vault.cachedRead(row.file);
    const body = stripFrontmatter(md).trim();
    entries.push({
      path: `${baseName}/notes/${pageName}.md`,
      content: buildMdContent(row, title, body, options.includeFrontmatter),
    });
  }

  // Build CSV files
  addViewCsvEntries(entries, dbConfig, baseName, rows, getRowsForView, getVisibleColumns, getExportCellValue);

  // Metadata JSON
  entries.push({
    path: `${baseName}/note-database.json`,
    content: JSON.stringify({
      format: "note-database-csv-markdown",
      version: 3,
      exportedAt: new Date().toISOString(),
      includeFrontmatter: options.includeFrontmatter,
      summaryCsvFile: `${baseName}_all.csv`,
      database: dbConfig,
      activeViewId: viewConfig.id,
    }, null, 2),
  });

  const zip = createStoredZip(entries);
  const result = await saveZipWithPicker(app, zip, `${baseName}.zip`, outputFolder || "");
  return result?.file || null;
}

// ── Helpers ──

function sanitize(value: string): string {
  return String(value || "Untitled").replace(/[\\/:"*?<>|#^[\]]/g, "-").trim() || "Untitled";
}

function uniqueName(base: string, used: Map<string, number>): string {
  const current = used.get(base) || 0;
  used.set(base, current + 1);
  return current === 0 ? base : `${base} ${current + 1}`;
}

function stripFrontmatter(content: string): string {
  if (!content.startsWith("---")) return content;
  const end = content.indexOf("\n---", 3);
  if (end < 0) return content;
  return content.slice(end + 4).replace(/^\s*\n/, "");
}

function buildMdContent(
  row: RowData,
  title: string,
  body: string,
  includeFrontmatter: boolean
): string {
  const normalizedBody = body || `# ${title}\n`;
  if (!includeFrontmatter) return normalizedBody;
  const yaml = stringifyYaml(row.frontmatter || {}).trim();
  return yaml ? `---\n${yaml}\n---\n\n${normalizedBody}` : normalizedBody;
}

function csvEscape(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function addViewCsvEntries(
  entries: ZipEntry[],
  dbConfig: DatabaseConfig,
  baseName: string,
  selectedRows: RowData[],
  getRowsForView: (index: number) => RowData[],
  getVisibleColumns: (view: ViewConfig) => ColumnDef[],
  getExportCellValue: (row: RowData, col: ColumnDef) => string
): void {
  const allViews = dbConfig.views.map((view, index) => ({ view, index }));
  if (allViews.length === 0) return;

  const usedViewNames = new Map<string, number>();
  const allColumns: ColumnDef[] = [];
  const seenColumnKeys = new Set<string>();
  const allRowsByPath = new Map<string, RowData>();

  for (const entry of allViews) {
    const view = entry.view;
    const viewRows = getRowsForView(entry.index);
    const visibleColumns = getVisibleColumns(view).filter((col) => col.key !== "file.name");
    for (const col of visibleColumns) {
      if (seenColumnKeys.has(col.key)) continue;
      seenColumnKeys.add(col.key);
      allColumns.push(col);
    }
    for (const row of viewRows) {
      if (!allRowsByPath.has(row.file.path)) allRowsByPath.set(row.file.path, row);
    }
    const viewName = uniqueName(
      sanitize(view.name || "View"),
      usedViewNames
    );
    const headers = ["Name", ...visibleColumns.map((col) => col.label || col.key)];
    const csvRows = [headers.map((v) => csvEscape(v)).join(",")];
    for (const row of viewRows) {
      const values = [row.file.basename || t("common.untitled"), ...visibleColumns.map((col) => getExportCellValue(row, col))];
      csvRows.push(values.map((v) => csvEscape(v)).join(","));
    }
    entries.push({ path: `${baseName}/views/${viewName}.csv`, content: csvRows.join("\n") });
  }

  // Summary CSV
  const headers = ["Name", "Path", ...allColumns.map((col) => col.label || col.key)];
  const summaryRows = [headers.map((v) => csvEscape(v)).join(",")];
  for (const row of allRowsByPath.values()) {
    const values = [
      row.file.basename || t("common.untitled"),
      row.file.path,
      ...allColumns.map((col) => getExportCellValue(row, col)),
    ];
    summaryRows.push(values.map((v) => csvEscape(v)).join(","));
  }
  entries.push({ path: `${baseName}/${baseName}_all.csv`, content: summaryRows.join("\n") });

  // Schema CSV
  const schemaHeaders = ["Property", "Key", "Type"];
  const schemaRows = [schemaHeaders.join(",")];
  for (const col of dbConfig.schema.columns) {
    schemaRows.push([col.label || col.key, col.key, col.type].map((v) => csvEscape(v)).join(","));
  }
  entries.push({ path: `${baseName}/${baseName}_schema.csv`, content: schemaRows.join("\n") });
}
