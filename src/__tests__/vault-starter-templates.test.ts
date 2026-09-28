import { describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import { TFile, TFolder } from "obsidian";
import type { DatabaseConfig } from "../data/types";
import { createVaultStarter, instantiateVaultStarter, parseVaultStarter, saveVaultStarter, loadVaultStarters, getMissingStarterAssets, VAULT_STARTER_FOLDER } from "../data/VaultStarterTemplates";

vi.mock("obsidian", () => ({ TFile: class {}, TFolder: class {}, normalizePath: (path: string) => path }));

function database(): DatabaseConfig {
  const schema: DatabaseConfig["schema"] = {
    columns: [
      { key: "file.name", label: "Name", type: "text" },
      { key: "status", label: "Status", type: "status", statusOptions: [{ value: "Todo", color: "blue" }] },
      { key: "link", label: "Link", type: "relation", relationConfig: { targetDatabaseId: "old-db" } },
      { key: "calc", label: "Formula", type: "computed", computedKey: "calc" },
    ],
    computedFields: [{ key: "calc", label: "Formula", type: "number", expression: "1 + 2" }],
  };
  return {
    id: "old-db", name: "Original", sourceFolder: "old/records", newRecordFolder: "old/records",
    sourceRules: [{ field: "file.folder", op: "eq", value: "old/records" }],
    coverImage: "assets/cover.png", icon: "📚", newRecordTemplate: { path: "Templates/record.md", engine: "core" },
    schema, views: [
      { id: "old-view", name: "Chart", viewType: "chart", sourceFolder: "old/records", schema,
        manualOrder: { ranks: { "old/record.md": "a" } }, chartType: "donut", chartGroupField: "status",
        filters: [{ field: "status", op: "eq", value: "Todo" }, { field: "file.folder", op: "eq", value: "old" }],
        viewStates: { table: { filters: [{ field: "link", op: "eq", value: "old/record.md" }] } } },
      { id: "old-form", name: "Capture", viewType: "form", sourceFolder: "", schema, formRequiredFields: ["status"] },
    ],
  };
}

describe("vault-local starter templates", () => {
  it("round-trips views and formulas without retaining original source or relation bindings", () => {
    const source = database();
    const template = parseVaultStarter(JSON.stringify(createVaultStarter(source, "Library", "My setup")));
    let id = 0;
    const first = instantiateVaultStarter(template, "New library", "new/records", () => `new-${++id}`);
    const second = instantiateVaultStarter(template, "Another", "another/records", () => `new-${++id}`);
    expect(first.id).not.toBe(second.id);
    expect(first.views.map((view) => view.id)).toEqual(["new-2", "new-3"]);
    expect(first.sourceFolder).toBe("new/records");
    expect(first.newRecordFolder).toBe("new/records");
    expect(first.sourceRules).toBeUndefined();
    expect(first.schema.columns[2].relationConfig).toBeUndefined();
    expect(first.schema.computedFields[0].expression).toBe("1 + 2");
    expect(first.views[0].chartType).toBe("donut");
    expect(first.views[1].formRequiredFields).toEqual(["status"]);
    expect(first.views[0].manualOrder).toBeUndefined();
    expect(first.views[0].filters).toEqual([{ field: "status", op: "eq", value: "Todo" }]);
    expect(first.views[0].viewStates?.table?.filters).toEqual([]);
    expect(first.views[0].schema).toBe(first.schema);
    expect(first.coverImage).toBe("assets/cover.png");
    expect(first.newRecordTemplate?.path).toBe("Templates/record.md");
    first.schema.columns[0].label = "Changed";
    expect(second.schema.columns[0].label).toBe("Name");
    expect(source.schema.columns[2].relationConfig?.targetDatabaseId).toBe("old-db");
  });

  it("excludes samples by default and strips relation and computed values from selected samples", () => {
    expect(createVaultStarter(database(), "Empty", "").samples).toEqual([]);
    const template = createVaultStarter(database(), "Sample", "", [{ filename: "Record", body: "# Body\n", frontmatter: {
      status: "Todo", link: "[[old/record]]", calc: 100, db_view: true, database: {}, position: "Researcher",
    } }]);
    expect(template.samples).toEqual([{ filename: "Record", body: "# Body\n", frontmatter: { status: "Todo", position: "Researcher" } }]);
  });

  it("rejects unsupported versions, unsafe sample paths and oversized sample collections", () => {
    const template = createVaultStarter(database(), "Library", "");
    expect(() => parseVaultStarter(JSON.stringify({ ...template, version: 2 }))).toThrow();
    expect(() => parseVaultStarter(JSON.stringify({ ...template, samples: [{ filename: "../outside", body: "", frontmatter: {} }] }))).toThrow();
    expect(() => parseVaultStarter(JSON.stringify({ ...template, samples: Array.from({ length: 21 }, () => ({ filename: "a", body: "", frontmatter: {} })) }))).toThrow();
  });

  it("saves and reloads a vault file, isolates malformed files, and never overwrites an existing template", async () => {
    const files = new Map<string, TFile | TFolder>();
    const content = new Map<string, string>();
    const app = { vault: {
      getAbstractFileByPath: (path: string) => files.get(path),
      createFolder: async (path: string) => { files.set(path, Object.assign(new TFolder(), { path, children: [] })); },
      create: async (path: string, text: string) => {
        if (files.has(path)) throw new Error("exists");
        const file = Object.assign(new TFile(), { path, name: path.split("/").pop() });
        files.set(path, file); content.set(path, text);
        (files.get(VAULT_STARTER_FOLDER) as TFolder).children.push(file);
        return file;
      },
      read: async (file: TFile) => content.get(file.path),
    } } as unknown as App;
    const template = createVaultStarter(database(), "My library", "Reusable");
    const saved = await saveVaultStarter(app, template);
    await app.vault.create(`${VAULT_STARTER_FOLDER}/bad.starter.json`, "broken");
    const loaded = await loadVaultStarters(app);
    expect(loaded.templates.map((item) => item.name)).toEqual(["My library"]);
    expect(loaded.templates[0].path).toBe(saved.path);
    expect(loaded.invalid).toEqual([`${VAULT_STARTER_FOLDER}/bad.starter.json`]);
    await expect(saveVaultStarter(app, template)).rejects.toThrow("exists");
  });

  it("reports missing local dependencies but permits remote image references", () => {
    const template = createVaultStarter(database(), "Library", "");
    template.config.coverImage = "![Cover](https://example.com/cover.png)";
    const app = { vault: { getAbstractFileByPath: () => null }, metadataCache: { getFirstLinkpathDest: () => null } } as unknown as App;
    expect(getMissingStarterAssets(app, template)).toEqual(["Templates/record.md"]);
  });
});
