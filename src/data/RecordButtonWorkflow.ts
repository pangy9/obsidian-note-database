import { parseRecordTemplate, resolveCoreRecordTemplate } from "./RecordTemplate";
import { parseRelationValues } from "./RelationLinks";
import { parseTextLink } from "./TextLink";
import { stringifyValue } from "./Stringify";
import { App, TFile, getFrontMatterInfo, normalizePath, parseYaml, stringifyYaml } from "obsidian";
import type { DataSource } from "./DataSource";
import type { ColumnDef, DatabaseConfig, RecordButtonConfig, RecordButtonStep } from "./types";
import type { ReversibleDataStep } from "./EmbeddedDataHistory";
import { parseDiskFrontmatter } from "./DiskReconcile";
import { configsDeepEqual } from "./FrontmatterPatch";
import { validateRecordButton } from "./RecordButton";
import { applyButtonActions, resolveButtonTemplate, resolveButtonValue, type ButtonValueContext, type ButtonValueRecord } from "./RecordButtonValue";
import { planCreateEntry } from "./CreateEntryPlan";
import { getSourceRuleTree } from "./SourceRules";
import { QueryEngine } from "./QueryEngine";
import { t } from "../i18n";

interface Draft extends ButtonValueRecord { file: TFile | null; before: string | null; body: string; original: Record<string, unknown> }
export interface ButtonWorkflowPlan {
  steps: ReversibleDataStep[];
  summary: string;
  requiresConfirmation: boolean;
  verify(): Promise<void>;
  open(): Promise<void>;
}

/** Read and simulate the entire workflow before any write. Every changed file becomes one
 * content-CAS step, shared by full-view and embedded history (including compensation). */
export async function prepareButtonWorkflow(
  app: App, data: DataSource, db: DatabaseConfig, path: string, button: RecordButtonConfig,
  sourceInstanceId: string, assertWritable: () => void,
): Promise<ButtonWorkflowPlan> {
  validateRecordButton(button, db.schema.columns);
  const drafts = new Map<string, Draft>();
  const dependencies = new Map<string, { file: TFile; content: string }>();
  const databases = new Map<string, DatabaseConfig>();
  const touchedColumns = new Map<Draft, Map<string, ColumnDef>>();
  const touched = (draft: Draft, columns: ColumnDef[]): void => {
    const known = touchedColumns.get(draft) || new Map<string, ColumnDef>();
    for (const column of columns) known.set(column.key, column);
    touchedColumns.set(draft, known);
  };
  const readContent = async (file: TFile): Promise<string> => {
    const content = await app.vault.read(file);
    if (app.vault.getAbstractFileByPath(file.path) !== file) throw new Error(t("button.configurationChanged"));
    dependencies.set(file.path, { file, content });
    return content;
  };
  const read = async (file: TFile): Promise<Draft> => {
    const known = drafts.get(file.path);
    if (known) return known;
    const before = await readContent(file);
    const parsed = parseDiskFrontmatter(before, parseYaml);
    if (!parsed.ok) throw parsed.error;
    const draft: Draft = { path: file.path, file, before, body: before.slice(getFrontMatterInfo(before).contentStart), original: parsed.frontmatter, frontmatter: structuredClone(parsed.frontmatter) };
    drafts.set(file.path, draft); return draft;
  };
  const database = async (id: string): Promise<DatabaseConfig> => {
    const known = databases.get(id); if (known) return known;
    const entry = data.getViewDefFiles().find(e => e.config.id === id);
    if (!entry) throw new Error(t("button.workflow.databaseRequired"));
    await readContent(entry.file);
    const fresh = (await data.readViewDefSnapshot(entry.file.path)).typedConfig;
    if (fresh.id !== id || (id === db.id && !configsDeepEqual(fresh.schema, db.schema))) throw new Error(t("button.configurationChanged"));
    databases.set(id, fresh); return fresh;
  };
  const currentDb = await database(db.id);
  const triggerFile = app.vault.getAbstractFileByPath(path);
  if (!(triggerFile instanceof TFile)) throw new Error(t("button.configurationChanged"));
  const trigger = await read(triggerFile);
  if (!data.matchesRecordForDatabase({ file: triggerFile, frontmatter: trigger.frontmatter }, currentDb)) throw new Error(t("button.workflow.outsideDatabase"));
  const ctx: ButtonValueContext = { trigger: { path, frontmatter: structuredClone(trigger.frontmatter), body: trigger.body }, variables: new Map(), now: new Date(), schemas: { trigger: currentDb.schema.columns } };
  const messages: string[] = [];
  const opens: Array<{ link: string; newTab: boolean; external: boolean }> = [];
  let createdDb: DatabaseConfig | undefined;
  let hasBatch = false;
  const query = new QueryEngine();
  const resolve = (value: string): string => resolveButtonTemplate(value, ctx);
  const fakeFile = (notePath: string): TFile => {
    // TFile's runtime constructor needs internal Vault arguments. Inherit an existing
    // file's prototype instead; this candidate is used for source matching only.
    const candidate: unknown = Object.create(triggerFile);
    if (!(candidate instanceof TFile)) throw new Error(t("button.configurationChanged"));
    return Object.assign(candidate, {
    path: notePath, name: notePath.split("/").pop()!, basename: notePath.split("/").pop()!.replace(/\.md$/i, ""), extension: "md",
    parent: { path: notePath.slice(0, Math.max(0, notePath.lastIndexOf("/"))) }, stat: { ctime: ctx.now.getTime(), mtime: ctx.now.getTime(), size: 0 },
    });
  };
  const steps: RecordButtonStep[] = button.steps || [{ kind: "edit", target: "trigger", actions: button.actions }];
  for (const step of steps) {
    assertWritable(); ctx.target = undefined;
    if (step.kind === "variable") {
      if (ctx.variables.has(step.name)) throw new Error(t("button.workflow.duplicateVariable", { name: step.name }));
      ctx.variables.set(step.name, resolveButtonValue(step.value, ctx));
    } else if (step.kind === "confirm") {
      messages.push(resolve(step.message));
    } else if (step.kind === "open") {
      const rawLink = step.target === "trigger" ? path : step.target === "created" ? ctx.created?.path : resolve(step.link || "");
      const link = rawLink && (step.target === "link" ? (rawLink.trim().startsWith("[") ? parseTextLink(rawLink)?.target : undefined) || rawLink.trim() : rawLink);
      if (!link) throw new Error(t("button.workflow.missingValue", { value: "created" }));
      const external = /^[a-z][a-z\d+.-]*:/i.test(link);
      if (external && !/^https?:\/\//i.test(link) && !/^obsidian:\/\//i.test(link)) throw new Error(t("button.workflow.invalidLink"));
      if (external) new URL(link); // reject malformed URLs before writing
      const notePath = link.split("#", 1)[0] || path;
      if (!external && !drafts.has(notePath) && !drafts.has(`${notePath}.md`) && !app.metadataCache.getFirstLinkpathDest(notePath, path)) throw new Error(t("button.workflow.missingValue", { value: link }));
      opens.push({ link, newTab: step.newTab === true, external });
    } else if (step.kind === "create" || step.kind === "duplicate") {
      const targetDb = await database(step.databaseId);
      const title = resolve(step.title).replace(/\.md$/i, "").trim();
      if (!title || title === "." || title === ".." || /[\r\n]/.test(title)) throw new Error(t("button.workflow.invalidTitle"));
      let fm: Record<string, unknown> = {};
      let body = "";
      if (step.kind === "duplicate") { fm = structuredClone(ctx.trigger.frontmatter); body = trigger.body; }
      else if (targetDb.newRecordTemplate?.path) {
        if (targetDb.newRecordTemplate.engine === "templater") throw new Error(t("button.workflow.templateEngine"));
        const file = app.vault.getAbstractFileByPath(targetDb.newRecordTemplate.path);
        if (!(file instanceof TFile)) throw new Error(t("button.workflow.missingValue", { value: targetDb.newRecordTemplate.path }));
        const content = await readContent(file);
        const parsed = resolveCoreRecordTemplate(parseRecordTemplate(content, targetDb.newRecordTemplate.engine), title);
        fm = structuredClone(parsed.frontmatter); body = parsed.body;
      }
      // Never copy virtual button values or database definition payloads into a record.
      delete fm.db_view; delete fm.database;
      for (const column of [...currentDb.schema.columns, ...targetDb.schema.columns]) if (column.type === "button") delete fm[column.key];
      const draft: Draft = { path: "", file: null, before: null, body: step.body ? resolve(step.body) : body, original: {}, frontmatter: fm };
      ctx.target = draft; ctx.schemas!.target = targetDb.schema.columns;
      applyButtonActions(step.actions, targetDb.schema.columns, ctx);
      const plan = planCreateEntry({ sourceRuleTree: getSourceRuleTree(targetDb.sourceRuleTree, targetDb.sourceRules, targetDb.sourceLogic), schema: targetDb.schema,
        sourceFolder: targetDb.sourceFolder, newRecordFolder: targetDb.newRecordFolder, fallbackFolder: targetDb.sourceFolder,
        contextFrontmatter: fm, intentionalContextKeys: new Set(step.actions.map(a => a.field)), defaultFilename: title, filenameHint: title, normalizeFolder: normalizePath });
      if (plan.diagnostics.some(d => d.reason === "conflictOverride" || d.reason === "filenameHintOverridden")) throw new Error(t("button.workflow.sourceConflict"));
      draft.frontmatter = plan.frontmatter; touched(draft, targetDb.schema.columns);
      let prepared = data.prepareNoteCreation(plan.folder, plan.filename, draft.frontmatter, draft.body);
      for (let suffix = 2; drafts.has(prepared.path); suffix++) prepared = data.prepareNoteCreation(plan.folder, `${plan.filename} ${suffix}`, draft.frontmatter, draft.body);
      draft.path = prepared.path;
      if (!data.matchesRecordForDatabase({ file: fakeFile(draft.path), frontmatter: draft.frontmatter }, targetDb)) throw new Error(t("button.workflow.outsideDatabase"));
      drafts.set(draft.path, draft); ctx.created = draft; createdDb = targetDb; ctx.schemas!.created = targetDb.schema.columns;
    } else if (step.kind === "edit") {
      const targetDb = step.target === "database" ? await database(step.databaseId!) : step.target === "created" ? createdDb : currentDb;
      if (!targetDb) throw new Error(t("button.workflow.missingValue", { value: "created" }));
      const targets: Draft[] = [];
      if (step.target === "trigger") targets.push(trigger);
      else if (step.target === "created") targets.push(drafts.get(ctx.created!.path)!);
      else {
        hasBatch = true;
        // Refresh source membership from disk instead of relying on a lagging metadata cache.
        for (const file of app.vault.getMarkdownFiles()) {
          const folder = normalizePath(targetDb.sourceFolder || "").replace(/^\/+|\/+$/g, "");
          if (folder && !file.path.startsWith(`${folder}/`)) continue;
          const draft = await read(file);
          if (data.matchesRecordForDatabase({ file, frontmatter: draft.frontmatter }, targetDb)) targets.push(draft);
        }
        for (const draft of drafts.values()) if (!draft.file && data.matchesRecordForDatabase({ file: fakeFile(draft.path), frontmatter: draft.frontmatter }, targetDb)) targets.push(draft);
        for (const filter of step.filters || []) {
          const column = targetDb.schema.columns.find(c => c.key === filter.field);
          if (!column || ["button", "computed", "rollup"].includes(column.type) || !["eq", "neq", "contains", "hasTag", "gt", "lt", "gte", "lte", "empty", "notempty"].includes(filter.op)) throw new Error(t("button.missingField", { field: filter.field }));
        }
      }
      for (const draft of targets) {
        ctx.target = draft; ctx.schemas!.target = targetDb.schema.columns;
        const filters = step.target === "database" ? (step.filters || []).map(f => ({ field: f.field, op: f.op, value: ["empty", "notempty"].includes(f.op) ? "" : stringifyValue(resolveButtonValue(f.value, ctx)) })) : [];
        if (!query.applyFilters([{ app, file: draft.file || fakeFile(draft.path), frontmatter: draft.frontmatter, computed: {} }], filters, "and", targetDb.schema.columns).length) continue;
        applyButtonActions(step.actions, targetDb.schema.columns, ctx);
        touched(draft, targetDb.schema.columns.filter(column => step.actions.some(action => action.field === column.key)));
      }
    }
  }
  for (const [draft, columns] of touchedColumns) {
      for (const column of columns.values()) {
        if (column.type !== "relation" || configsDeepEqual(draft.original[column.key], draft.frontmatter[column.key])) continue;
        const links = parseRelationValues(draft.frontmatter[column.key]);
        if (!links.length) continue;
        if (!column.relationConfig?.targetDatabaseId) throw new Error(t("button.missingField", { field: column.label }));
        const relationDb = await database(column.relationConfig.targetDatabaseId);
        for (const link of links) {
          const planned = drafts.get(link.target) || drafts.get(`${link.target}.md`);
          const file = planned?.file || app.metadataCache.getFirstLinkpathDest(link.target, draft.path);
          const record = planned || (file ? await read(file) : undefined);
          if (!record || !data.matchesRecordForDatabase({ file: record.file || fakeFile(record.path), frontmatter: record.frontmatter }, relationDb)) throw new Error(t("button.workflow.missingValue", { value: link.target }));
        }
      }
  }
  const mutations: ReversibleDataStep[] = [];
  const changed: string[] = [];
  for (const draft of drafts.values()) {
    if (draft.before !== null && configsDeepEqual(draft.original, draft.frontmatter)) continue;
    const after = `---\n${stringifyYaml(draft.frontmatter).trim()}\n---\n${draft.body.startsWith("\n") ? "" : "\n"}${draft.body}`;
    changed.push(draft.path);
    // File identity follows a creation through undo/redo; closures are session-local.
    let file = draft.file;
    mutations.push({ description: draft.path, apply: async (direction, compensating) => {
      const before = direction === "forward" ? draft.before : after;
      const desired = direction === "forward" ? after : draft.before;
      const guard = (): void => { if (!compensating) assertWritable(); };
      const context = { sourceInstanceId, assertWritable: guard };
      if (before === null || desired === null) file = await data.patchNoteExistence(draft.path, before, desired, file, context);
      else {
        if (!file) throw new Error(t("button.configurationChanged"));
        await data.patchNoteContent(draft.path, before, desired, file, context);
      }
    } });
  }
  return {
    steps: mutations,
    summary: [...messages, t("button.workflow.preview", { count: String(changed.length) }), ...changed.slice(0, 15), ...(changed.length > 15 ? ["…"] : [])].join("\n"),
    requiresConfirmation: button.confirm === true || hasBatch || messages.length > 0,
    verify: async () => {
      assertWritable();
      for (const [readPath, dependency] of dependencies) {
        if (app.vault.getAbstractFileByPath(readPath) !== dependency.file || await app.vault.read(dependency.file) !== dependency.content) throw new Error(t("button.workflow.changed", { path: readPath }));
      }
      assertWritable();
    },
    open: async () => {
      for (const action of opens) {
        if (action.external) window.open(action.link, "_blank", "noopener,noreferrer");
        else await app.workspace.openLinkText(action.link, path, action.newTab);
      }
    },
  };
}
