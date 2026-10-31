import { describe, expect, it, vi } from "vitest";
import { TFile, type App } from "obsidian";
import { setLocale } from "../i18n";
import { prepareButtonWorkflow } from "../data/RecordButtonWorkflow";
import { executeDataSteps } from "../data/EmbeddedDataHistory";
import { applyButtonActions, resolveButtonValue, resolveButtonTemplate, type ButtonValueContext } from "../data/RecordButtonValue";
import { DataSource, type DataWriteContext } from "../data/DataSource";
import type { ColumnDef, DatabaseConfig, RecordButtonAction, RecordButtonConfig, RecordButtonStep } from "../data/types";
import { EmbeddedDataOperations } from "../views/EmbeddedDataOperations";
import { sanitizeStarterConfig } from "../data/VaultStarterTemplates";
import { updateColumnKeyReferences } from "../data/ColumnKeyReferences";

const constructors = vi.hoisted(() => ({ count: 0 }));
vi.mock("obsidian", () => ({
  TFile: class { constructor() { constructors.count++; } }, TFolder: class {}, Notice: class {}, normalizePath: (p: string) => p.replace(/^\/+|\/+$/g, ""),
  parseYaml: (s: string) => JSON.parse(s), stringifyYaml: (v: unknown) => JSON.stringify(v),
  getFrontMatterInfo: (s: string) => ({ contentStart: s.startsWith("---\n") ? s.indexOf("\n---\n", 4) + 5 : 0 }),
}));
setLocale("en");
const columns: ColumnDef[] = [
  { key: "title", label: "Title", type: "text" }, { key: "count", label: "Count", type: "number" },
  { key: "done", label: "Done", type: "checkbox" }, { key: "due", label: "Due", type: "date" },
  { key: "parent", label: "Parent", type: "relation", relationConfig: { targetDatabaseId: "tasks" } },
];
const act = (field: string, value: RecordButtonAction["value"], operation: RecordButtonAction["operation"] = "set"): RecordButtonAction => ({ field, fieldType: columns.find(c => c.key === field)!.type, operation, value });
const config = (...steps: RecordButtonStep[]): RecordButtonConfig => ({ label: "Workflow", actions: [], steps });
function fixture() {
  const contents = new Map<string, string>(); const files = new Map<string, TFile>();
  const encode = (fm: Record<string, unknown>, body = "Body\n"): string => `---\n${JSON.stringify(fm)}\n---\n\n${body}`;
  const add = (path: string, fm: Record<string, unknown>, body?: string): TFile => {
    const file = Object.assign(new TFile(), { path, name: path.split("/").pop()!, basename: path.split("/").pop()!.replace(/\.md$/, ""), extension: "md", stat: { mtime: 1, size: 1 } });
    files.set(path, file); contents.set(path, encode(fm, body)); return file;
  };
  add("Tasks/Source.md", { title: "Original", count: 2, done: false, unknown: ["keep"] }, "# Body\nKeep ![[image.png]]\n");
  add("Followups/One.md", { parent: ["[[Tasks/Source]]"], done: false, count: 1 });
  add("Followups/Two.md", { parent: ["[[Tasks/Else]]"], done: false, count: 5 });
  const db = { id: "tasks", name: "Tasks", sourceFolder: "Tasks", schema: { columns, computedFields: [] }, views: [] } as DatabaseConfig;
  const other = { id: "followups", name: "Followups", sourceFolder: "Followups", schema: { columns, computedFields: [] }, views: [] } as DatabaseConfig;
  const dbs = [db, other];
  for (const database of dbs) add(`DB/${database.id}.md`, { db_view: true, database });
  const app = {
    vault: { getAbstractFileByPath: (path: string) => files.get(path), read: async (file: TFile) => contents.get(file.path)!, getMarkdownFiles: () => [...files.values()] },
    metadataCache: { getFirstLinkpathDest: (path: string) => files.get(path) || files.get(path + ".md") },
    workspace: { openLinkText: vi.fn(async () => {}) },
  } as unknown as App;
  let failPath = "";
  const data = {
    getViewDefFiles: () => dbs.map(config => ({ config, file: files.get(`DB/${config.id}.md`)! })),
    readViewDefSnapshot: async (path: string) => ({ typedConfig: dbs.find(d => path === `DB/${d.id}.md`)! }),
    matchesRecordForDatabase: (record: { file: TFile; frontmatter: Record<string, unknown> }, db: DatabaseConfig) => !record.frontmatter.db_view && record.file.path.startsWith(db.sourceFolder + "/"),
    prepareNoteCreation: (folder: string, name: string, fm: Record<string, unknown>, body: string) => {
      let path = `${folder}/${name}.md`; for (let i = 2; files.has(path); i++) path = `${folder}/${name} ${i}.md`;
      return { path, content: encode(fm, body) };
    },
    patchNoteContent: vi.fn(async (path: string, before: string, after: string, file: TFile, context?: DataWriteContext) => {
      context?.assertWritable?.(); if (path === failPath || contents.get(path) !== before || files.get(path) !== file) throw new Error(`Conflict ${path}`);
      contents.set(path, after);
    }),
    patchNoteExistence: vi.fn(async (path: string, before: string | null, after: string | null, file: TFile | null, context?: DataWriteContext) => {
      context?.assertWritable?.(); if (path === failPath) throw new Error("Creation failed");
      if (before === null) { if (files.has(path)) throw new Error("Occupied"); const created = add(path, {}); contents.set(path, after!); return created; }
      if (contents.get(path) !== before || files.get(path) !== file) throw new Error("Edited created note");
      files.delete(path); contents.delete(path); return null;
    }),
  };
  const prepare = (button: RecordButtonConfig) => prepareButtonWorkflow(app, data as unknown as DataSource, db, "Tasks/Source.md", button, "test", () => {});
  const fm = (path: string) => JSON.parse(contents.get(path)!.split("\n---\n")[0].slice(4));
  return { prepare, contents, files, db, other, data, app, add, fm, fail: (path: string) => { failPath = path; } };
}
const create: RecordButtonStep = { kind: "create", databaseId: "followups", title: "{{trigger.file.basename}} followup", body: "Follow [[{{trigger.file.path}}]]", actions: [{ ...act("parent", []), dynamic: { source: "trigger", value: "file.link" } }] };
const batch: RecordButtonStep = { kind: "edit", target: "database", databaseId: "followups", filters: [{ field: "parent", op: "eq", value: { source: "trigger", value: "file.link" } }], actions: [act("done", true)] };

describe("button workflows: production planner and reversible writes", () => {
  it("composes source and created bodies without frontmatter and undoes the whole workflow", async () => {
    const f = fixture();
    const source = f.contents.get("Tasks/Source.md");
    const plan = await f.prepare(config(
      { ...create, title: "Body copy", body: "Copied\n{{trigger.file.body}}" },
      { ...create, title: "Second copy", body: "Again\n{{created.file.body}}" },
    ));
    await executeDataSteps(plan.steps, "forward");
    expect(f.contents.get("Followups/Body copy.md")).toContain("Copied\n\n# Body\nKeep ![[image.png]]");
    expect(f.contents.get("Followups/Second copy.md")).toContain("Again\nCopied\n\n# Body");
    expect(f.contents.get("Followups/Second copy.md")!.split("---")).toHaveLength(3);
    await executeDataSteps(plan.steps, "reverse");
    expect(f.files.has("Followups/Body copy.md")).toBe(false);
    expect(f.files.has("Followups/Second copy.md")).toBe(false);
    expect(f.contents.get("Tasks/Source.md")).toBe(source);
  });
  it("does not call Obsidian's internal TFile constructor for planned records", async () => {
    const f = fixture(); const before = constructors.count;
    await f.prepare(config(create)); expect(constructors.count).toBe(before);
  });
  it("rejects relation links outside their configured target database", async () => {
    const f = fixture();
    await expect(f.prepare(config({ ...create, actions: [act("parent", ["[[Followups/One]]"])] }))).rejects.toThrow("reference");
    expect(f.data.patchNoteExistence).not.toHaveBeenCalled();
  });
  it("clears cross-database destinations in portable starters without changing the source", () => {
    const f = fixture(); const workflow = config(create, batch);
    f.db.schema.columns = [...columns, { key: "button", label: "Button", type: "button", buttonConfig: workflow }];
    const sanitized = sanitizeStarterConfig(f.db);
    expect(sanitized.schema.columns.at(-1)!.buttonConfig!.steps).toMatchObject([{ databaseId: "" }, { databaseId: "" }]);
    expect(workflow.steps![0]).toMatchObject({ databaseId: "followups" });
  });
  it("creates a linked record, updates it, opens only after commit, and undoes/redoes all files", async () => {
    const f = fixture(); const source = f.contents.get("Tasks/Source.md");
    const plan = await f.prepare(config(create, { kind: "edit", target: "created", actions: [act("count", 3)] }, { kind: "edit", target: "trigger", actions: [act("done", true)] }, { kind: "open", target: "created" }));
    expect(f.files.has("Followups/Source followup.md")).toBe(false); expect(f.app.workspace.openLinkText).not.toHaveBeenCalled();
    await plan.verify(); await executeDataSteps(plan.steps, "forward"); await plan.open();
    expect(f.fm("Followups/Source followup.md")).toMatchObject({ parent: ["[[Tasks/Source]]"], count: 3 });
    expect(f.contents.get("Followups/Source followup.md")).toContain("Follow [[Tasks/Source.md]]");
    expect(f.fm("Tasks/Source.md").done).toBe(true); expect(f.app.workspace.openLinkText).toHaveBeenCalledWith("Followups/Source followup.md", "Tasks/Source.md", false);
    await executeDataSteps(plan.steps, "reverse"); expect(f.contents.get("Tasks/Source.md")).toBe(source); expect(f.files.has("Followups/Source followup.md")).toBe(false);
    await executeDataSteps(plan.steps, "forward"); expect(f.fm("Followups/Source followup.md").count).toBe(3);
  });
  it("copies body and unknown properties while allowing overrides", async () => {
    const f = fixture(); const plan = await f.prepare(config({ kind: "duplicate", databaseId: "followups", title: "Copy", actions: [act("count", 10)] }));
    await executeDataSteps(plan.steps, "forward"); expect(f.fm("Followups/Copy.md")).toMatchObject({ unknown: ["keep"], count: 10, title: "Original" }); expect(f.contents.get("Followups/Copy.md")).toContain("# Body\nKeep ![[image.png]]");
  });
  it("filters a different database with trigger values and leaves unrelated records untouched", async () => {
    const f = fixture(); const untouched = f.contents.get("Followups/Two.md"); const plan = await f.prepare(config(batch));
    expect(plan.requiresConfirmation).toBe(true); expect(plan.summary).toContain("1 notes");
    await executeDataSteps(plan.steps, "forward"); expect(f.fm("Followups/One.md").done).toBe(true); expect(f.contents.get("Followups/Two.md")).toBe(untouched);
    await executeDataSteps(plan.steps, "reverse"); expect(f.fm("Followups/One.md").done).toBe(false);
  });
  it("uses fresh disk values instead of cached source properties", async () => {
    const f = fixture(); f.contents.set("Followups/One.md", '---\n{"parent":["[[Tasks/Else]]"],"done":false}\n---\n');
    const plan = await f.prepare(config(batch)); expect(plan.steps).toHaveLength(0);
  });
  it("sees newly created records in later database filters and reserves distinct names", async () => {
    const f = fixture(); const plan = await f.prepare(config(create, create, batch)); await executeDataSteps(plan.steps, "forward");
    expect(f.fm("Followups/Source followup.md").done).toBe(true); expect(f.fm("Followups/Source followup 2.md").done).toBe(true);
  });
  it("can save an earlier creation as a variable for a later record", async () => {
    const f = fixture(); f.other.schema = { ...f.other.schema, columns: columns.map(c => c.key === "parent" ? { ...c, relationConfig: { targetDatabaseId: "followups" } } : c) };
    const first = { ...create, actions: [] }; const plan = await f.prepare(config(first, { kind: "variable", name: "first", value: { source: "created", value: "file.link" } }, { ...create, title: "Second", actions: [{ ...act("parent", []), dynamic: { source: "variable", value: "first" } }] }));
    await executeDataSteps(plan.steps, "forward"); expect(f.fm("Followups/Second.md").parent).toEqual(["[[Followups/Source followup]]"]);
  });
  it("rolls back earlier file updates when a later creation fails", async () => {
    const f = fixture(); const original = f.contents.get("Tasks/Source.md");
    const plan = await f.prepare(config({ kind: "edit", target: "trigger", actions: [act("done", true)] }, create));
    f.fail("Followups/Source followup.md"); await expect(executeDataSteps(plan.steps, "forward")).rejects.toThrow("Creation failed");
    expect(f.contents.get("Tasks/Source.md")).toBe(original); expect(f.files.has("Followups/Source followup.md")).toBe(false);
  });
  it("refuses undo that would discard manual edits to a created note", async () => {
    const f = fixture(); const plan = await f.prepare(config(create)); await executeDataSteps(plan.steps, "forward");
    f.contents.set("Followups/Source followup.md", f.contents.get("Followups/Source followup.md") + "Manual text");
    await expect(executeDataSteps(plan.steps, "reverse")).rejects.toThrow("Edited created note"); expect(f.files.has("Followups/Source followup.md")).toBe(true);
  });
  it("checks input and configuration changes after the confirmation wait", async () => {
    const f = fixture(); const plan = await f.prepare(config(create)); f.contents.set("Tasks/Source.md", f.contents.get("Tasks/Source.md") + "External");
    await expect(plan.verify()).rejects.toThrow("changed"); expect(f.data.patchNoteContent).not.toHaveBeenCalled();
  });
  it("rejects invalid later actions before any earlier create occurs", async () => {
    const f = fixture(); await expect(f.prepare(config(create, { kind: "edit", target: "created", actions: [act("count", "bad")] }))).rejects.toThrow(); expect(f.data.patchNoteExistence).not.toHaveBeenCalled();
  });
  it("requires explicit all-record intent, and rejects a missing target database", async () => {
    const f = fixture(); await expect(f.prepare(config({ ...batch, filters: [] }))).rejects.toThrow("filter");
    await expect(f.prepare(config({ ...create, databaseId: "missing" }))).rejects.toThrow("database");
    const plan = await f.prepare(config({ ...batch, filters: [], allRecords: true })); expect(plan.steps).toHaveLength(2);
  });
  it("opens aliased wikilinks and heading links without treating the alias as a filename", async () => {
    const f = fixture();
    for (const link of ["[[Tasks/Source#Body|Source note]]", "[Source note](Tasks/Source#Body)"]) {
      const plan = await f.prepare(config({ kind: "open", target: "link", link }));
      await plan.verify(); await plan.open();
      expect(f.app.workspace.openLinkText).toHaveBeenLastCalledWith("Tasks/Source#Body", "Tasks/Source.md", false);
      expect(plan.steps).toHaveLength(0);
    }
  });
  it("rejects source rules silently overriding explicit creation actions before any writes", async () => {
    const f = fixture();
    f.other.sourceRules = [{ field: "count", op: "eq", value: "1" }];
    await expect(f.prepare(config({ ...create, actions: [act("count", 10)] }))).rejects.toThrow("source rules");
    expect(f.data.patchNoteContent).not.toHaveBeenCalled();
    expect(f.data.patchNoteExistence).not.toHaveBeenCalled();
  });
  it("supports a plain Markdown database template", async () => {
    const f = fixture(); f.add("Templates/Task.md", { count: 9 }, "Template text"); f.other.newRecordTemplate = { path: "Templates/Task.md", engine: "markdown" };
    const plan = await f.prepare(config({ ...create, body: "" })); await executeDataSteps(plan.steps, "forward");
    expect(f.fm("Followups/Source followup.md").count).toBe(9); expect(f.contents.get("Followups/Source followup.md")).toContain("Template text");
  });
  it("rejects executable template engines before writing", async () => {
    const f = fixture(); f.other.newRecordTemplate = { path: "Template.md", engine: "templater" }; await expect(f.prepare(config(create))).rejects.toThrow("Markdown");
  });
  it("guards unsafe URL schemes and unavailable created-record references", async () => {
    const f = fixture(); await expect(f.prepare(config({ kind: "open", target: "link", link: "javascript:alert(1)" }))).rejects.toThrow("HTTP");
    await expect(f.prepare(config({ kind: "open", target: "created" }))).rejects.toThrow("created");
  });
  it("keeps open-only workflows out of data history and supports embedded undo/redo", async () => {
    const f = fixture(); const button = config(create);
    const col: ColumnDef = { key: "action", label: "Action", type: "button", buttonConfig: button }; f.db.schema = { computedFields: [], columns: [...columns, col] };
    const op = new EmbeddedDataOperations(f.app, f.data as unknown as DataSource, "test", () => ({ path: "DB/tasks.md", dbId: "tasks", viewId: "v" }), () => true, () => {});
    expect(await op.runButton("Tasks/Source.md", "action", button)).toBe(true); expect(op.canUndo).toBe(true);
    await op.replay("undo"); expect(f.files.has("Followups/Source followup.md")).toBe(false);
    await op.replay("redo"); expect(f.files.has("Followups/Source followup.md")).toBe(true);
    const openButton = config({ kind: "open", target: "trigger" }); col.buttonConfig = openButton;
    const op2 = new EmbeddedDataOperations(f.app, f.data as unknown as DataSource, "test", () => ({ path: "DB/tasks.md", dbId: "tasks", viewId: "v" }), () => true, () => {});
    expect(await op2.runButton("Tasks/Source.md", "action", openButton)).toBe(true); expect(op2.canUndo).toBe(false); expect(f.app.workspace.openLinkText).toHaveBeenCalled();
  });
  it("does not navigate or write after cancelling a batch confirmation", async () => {
    const f = fixture(); const button = config(batch, { kind: "open", target: "trigger" }); f.db.schema = { computedFields: [], columns: [...columns, { key: "action", label: "Action", type: "button", buttonConfig: button }] };
    const op = new EmbeddedDataOperations(f.app, f.data as unknown as DataSource, "test", () => ({ path: "DB/tasks.md", dbId: "tasks", viewId: "v" }), () => true, () => {});
    expect(await op.runButton("Tasks/Source.md", "action", button, async () => false)).toBe(false); expect(op.canUndo).toBe(false); expect(f.data.patchNoteContent).not.toHaveBeenCalled(); expect(f.app.workspace.openLinkText).not.toHaveBeenCalled();
  });
});

describe("typed button values", () => {
  const context = (): ButtonValueContext => ({ trigger: { path: "Tasks/A.md", frontmatter: { count: 4, labels: ["A", "B"] } }, target: { path: "Tasks/B.md", frontmatter: { count: 2 } }, variables: new Map(), now: new Date(2026, 9, 30, 14, 35, 10) });
  it("preserves types, supports templates and calendar-day offsets", () => {
    const ctx = context(); expect(resolveButtonValue({ source: "trigger", value: "labels" }, ctx)).toEqual(["A", "B"]);
    expect(resolveButtonTemplate("{{trigger.file.basename}} / {{today}}", ctx)).toBe("A / 2026-10-30");
    expect(resolveButtonValue({ source: "date", value: "today", offsetDays: 3 }, ctx)).toBe("2026-11-02");
    expect(resolveButtonValue({ source: "date", value: "now", offsetDays: -1 }, ctx)).toBe("2026-10-29T14:35:10");
  });
  it("resolves target values sequentially while preserving trigger snapshots", () => {
    const ctx = context(); applyButtonActions([act("count", 3, "increment"), { ...act("count", 0, "increment"), dynamic: { source: "target", value: "count" } }], columns, ctx);
    expect(ctx.target!.frontmatter.count).toBe(10); expect(ctx.trigger.frontmatter.count).toBe(4);
  });
  it("rejects missing variables, prototype references and invalid numeric values", () => {
    const ctx = context(); expect(() => resolveButtonTemplate("{{var.missing}}", ctx)).toThrow(); expect(() => resolveButtonValue({ source: "trigger", value: "__proto__" }, ctx)).toThrow();
    expect(() => applyButtonActions([{ ...act("count", 0), dynamic: { source: "template", value: "bad" } }], columns, ctx)).toThrow();
  });
  it("updates local field references without renaming another database's fields", () => {
    const workflow = config({ kind: "edit", target: "trigger", actions: [act("count", 2)] }, { ...create, title: "{{trigger.count}}", actions: [{ ...act("count", 0), dynamic: { source: "trigger", value: "count" } }] });
    const schema = { columns: [{ key: "button", label: "Button", type: "button", buttonConfig: workflow } as ColumnDef] };
    const view = { schema } as Parameters<typeof updateColumnKeyReferences>[0];
    expect(updateColumnKeyReferences(view, undefined, "count", "total", { updateSourceRuleTree: () => false })).toBe(true);
    expect(workflow.steps![0]).toMatchObject({ actions: [{ field: "total" }] }); expect(workflow.steps![1]).toMatchObject({ title: "{{trigger.total}}", actions: [{ field: "count", dynamic: { value: "total" } }] });
  });
});


describe("production content CAS for workflow transactions", () => {
  it("validates content inside Vault.process and leaves concurrent edits intact", async () => {
    const file = Object.assign(new TFile(), { path: "A.md" });
    let content = "---\n{}\n---\nOriginal";
    const publish = vi.fn();
    const adapter = {
      vault: { getAbstractFileByPath: () => file, process: async (_file: TFile, change: (text: string) => string) => { content = change(content); } },
      enqueueWrite: async (_path: string, task: () => Promise<void>) => task(),
      publishCommittedSnapshot: publish,
    } as unknown as DataSource;
    const before = content; const after = "---\n{\"done\":true}\n---\nOriginal";
    await DataSource.prototype.patchNoteContent.call(adapter, "A.md", before, after, file);
    expect(content).toBe(after); expect(publish).toHaveBeenCalledWith("A.md", { done: true });
    content += "External";
    await expect(DataSource.prototype.patchNoteContent.call(adapter, "A.md", after, before, file)).rejects.toThrow("File changed");
    expect(content).toBe(after + "External"); expect(publish).toHaveBeenCalledTimes(1);
  });
});
