import { App, TFile, TFolder, normalizePath } from "obsidian";
import { DatabaseConfig, StatusPresetDef, generateId } from "./types";
import type { StarterSampleRecord } from "./DatabaseStarterTemplates";

export const VAULT_STARTER_FOLDER = "Note Database Templates";
export const MAX_STARTER_SAMPLES = 20;
const MAX_TEMPLATE_BYTES = 5 * 1024 * 1024;

export interface VaultStarterTemplate {
  kind: "note-database-starter";
  version: 1;
  id: string;
  name: string;
  description: string;
  config: DatabaseConfig;
  samples: StarterSampleRecord[];
}
export interface SavedVaultStarter extends VaultStarterTemplate { path: string }

/** Strip record identity and source scope while retaining reusable presentation. */
export function sanitizeStarterConfig(source: DatabaseConfig): DatabaseConfig {
  const db = structuredClone(source);
  db.id = "";
  db.sourceFolder = "";
  delete db.newRecordFolder;
  delete db.sourceRules;
  delete db.sourceLogic;
  delete db.sourceRuleTree;
  delete db.baseThisFilePath;
  db.computedSyncMode = "display-only";
  for (const column of db.schema.columns) {
    if (column.type === "relation") delete column.relationConfig;
  }
  for (const view of db.views) {
    delete view.id;
    view.schema = db.schema;
    view.sourceFolder = "";
    delete view.newRecordFolder;
    delete view.sourceRules;
    delete view.sourceLogic;
    delete view.sourceRuleTree;
    delete view.viewSourceRulesEnabled;
    delete view.baseThisFilePath;
    delete view.manualOrder;
    delete view.boardCardOrders;
    delete view.collapsedGroups;
    delete view.expandedGroupRows;
    delete view.calendarMonth;
    delete view.calendarDay;
    delete view.calendarWeekStart;
    delete view.timelineAnchor;
    delete view.timelineAnchorTimeMinutes;
    const cleanFilters = (filters: typeof view.filters) => filters?.filter((filter) => !["file.path", "file.folder"].includes(filter.field)
      && !db.schema.columns.some((column) => column.key === filter.field && column.type === "relation"));
    view.filters = cleanFilters(view.filters);
    for (const state of Object.values(view.viewStates || {})) state.filters = cleanFilters(state.filters);
  }
  return db;
}

export function cleanStarterSamples(samples: StarterSampleRecord[], db: DatabaseConfig): StarterSampleRecord[] {
  if (samples.length > MAX_STARTER_SAMPLES) throw new Error("Too many sample records");
  return samples.map((sample) => {
    const frontmatter = structuredClone(sample.frontmatter);
    delete frontmatter.db_view;
    delete frontmatter.database;
    for (const column of db.schema.columns) {
      if (["relation", "rollup", "computed"].includes(column.type)) delete frontmatter[column.key];
    }
    for (const field of db.schema.computedFields || []) delete frontmatter[field.key];
    return { filename: sample.filename, body: sample.body, frontmatter };
  });
}

export function createVaultStarter(
  source: DatabaseConfig, name: string, description: string, samples: StarterSampleRecord[] = [],
  globalPresets: StatusPresetDef[] = [],
): VaultStarterTemplate {
  const config = sanitizeStarterConfig(source);
  // Snapshot inherited presets so later global edits do not change the template.
  config.statusPresets = structuredClone(config.statusPresets?.length ? config.statusPresets : globalPresets);
  config.name = name.trim();
  config.description = description.trim();
  return { kind: "note-database-starter", version: 1, id: generateId(), name: config.name,
    description: config.description, config, samples: cleanStarterSamples(samples, config) };
}

export function instantiateVaultStarter(template: VaultStarterTemplate, name: string, folder: string, newId = generateId): DatabaseConfig {
  const db = sanitizeStarterConfig(template.config);
  db.id = newId();
  db.name = name;
  db.description = template.description;
  db.sourceFolder = folder;
  db.newRecordFolder = folder;
  for (const view of db.views) view.id = newId();
  return db;
}

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Files are local data, never template-engine scripts or executable code. */
export function parseVaultStarter(text: string): VaultStarterTemplate {
  if (text.length > MAX_TEMPLATE_BYTES) throw new Error("Template is too large");
  const value: unknown = JSON.parse(text);
  if (!object(value) || value.kind !== "note-database-starter" || value.version !== 1 ||
    typeof value.id !== "string" || !value.id || typeof value.name !== "string" || !value.name.trim() ||
    typeof value.description !== "string" || !object(value.config) || !object(value.config.schema) ||
    !Array.isArray(value.config.schema.columns) || !Array.isArray(value.config.schema.computedFields) ||
    !Array.isArray(value.config.views) || !value.config.views.length || value.config.views.length > 15 ||
    !Array.isArray(value.samples) || value.samples.length > MAX_STARTER_SAMPLES) throw new Error("Invalid starter template");
  const types = ["text", "number", "currency", "date", "datetime", "status", "select", "multi-select", "checkbox", "computed", "rollup", "relation"];
  for (const column of value.config.schema.columns) {
    if (!object(column) || typeof column.key !== "string" || typeof column.label !== "string" || typeof column.type !== "string" || !types.includes(column.type)) throw new Error("Invalid property");
  }
  for (const view of value.config.views) {
    if (!object(view) || typeof view.name !== "string" || (view.viewType !== undefined && (typeof view.viewType !== "string" || !["table", "board", "gallery", "list", "calendar", "timeline", "chart", "form"].includes(view.viewType)))) throw new Error("Invalid view");
  }
  for (const sample of value.samples) {
    if (!object(sample) || typeof sample.filename !== "string" || !sample.filename.trim() || /[\\/]/.test(sample.filename) ||
      typeof sample.body !== "string" || !object(sample.frontmatter)) throw new Error("Invalid sample record");
  }
  const template = value as unknown as VaultStarterTemplate;
  template.config = sanitizeStarterConfig(template.config);
  template.samples = cleanStarterSamples(template.samples, template.config);
  return template;
}

export async function loadVaultStarters(app: App): Promise<{ templates: SavedVaultStarter[]; invalid: string[] }> {
  const folder = app.vault.getAbstractFileByPath(VAULT_STARTER_FOLDER);
  const templates: SavedVaultStarter[] = [], invalid: string[] = [];
  if (!(folder instanceof TFolder)) return { templates, invalid };
  for (const file of folder.children) {
    if (!(file instanceof TFile) || !file.name.endsWith(".starter.json")) continue;
    try { templates.push({ ...parseVaultStarter(await app.vault.read(file)), path: file.path }); }
    catch { invalid.push(file.path); }
  }
  templates.sort((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path));
  return { templates, invalid };
}

export async function saveVaultStarter(app: App, template: VaultStarterTemplate): Promise<TFile> {
  const text = JSON.stringify(template, null, 2);
  parseVaultStarter(text);
  if (!app.vault.getAbstractFileByPath(VAULT_STARTER_FOLDER)) await app.vault.createFolder(VAULT_STARTER_FOLDER);
  const name = template.name.replace(/[\\/:*?"<>|#^]/g, "-").replace(/\.+$/g, "").trim() || "Template";
  return app.vault.create(normalizePath(`${VAULT_STARTER_FOLDER}/${name}-${template.id}.starter.json`), text);
}

export function getMissingStarterAssets(app: App, template: VaultStarterTemplate): string[] {
  const refs = [template.config.coverImage, template.config.newRecordTemplate?.path,
    ...template.config.views.map((view) => view.formCoverImage)];
  const imageFields = new Set(template.config.views.flatMap((view) => [view.boardImageField, view.galleryImageField]).filter((field): field is string => !!field));
  for (const sample of template.samples) {
    for (const field of imageFields) {
      const value = sample.frontmatter[field];
      for (const ref of Array.isArray(value) ? value : [value]) {
        if (typeof ref === "string") refs.push(ref);
      }
    }
  }
  const missing = new Set<string>();
  for (const ref of refs) {
    if (!ref) continue;
    const path = ref.replace(/^!\[[^\]]*\]\(([^)]+)\)$/, "$1")
      .replace(/^!?(?:\[\[)(.*?)\]\]$/, "$1").split("|")[0].split("#")[0];
    if (/^(https?:|data:)/i.test(path)) continue;
    if (!app.vault.getAbstractFileByPath(path) && !app.metadataCache.getFirstLinkpathDest(path, "")) missing.add(ref);
  }
  return [...missing];
}
