import { describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import type { DataSource } from "../data/DataSource";
import type { DatabaseConfig } from "../data/types";
import { createVaultStarter } from "../data/VaultStarterTemplates";
import { buildDatabaseWithInferredColumns, createDatabaseFromModalResult } from "../views/modals/AddDatabaseFlow";

vi.mock("obsidian", () => ({ TFile: class {}, TFolder: class {}, Notice: class {}, normalizePath: (path: string) => path }));
vi.mock("../i18n", () => ({ t: (key: string) => key }));
vi.mock("../data/FrontmatterScanner", () => ({}));
vi.mock("../data/ColumnTypes", () => ({}));
vi.mock("../views/modals/BaseImportConfirmModal", () => ({ BaseImportConfirmModal: class {} }));

function setup() {
  const schema = { columns: [{ key: "file.name", label: "Name", type: "text" as const }], computedFields: [] };
  const db: DatabaseConfig = { id: "old", name: "Original", sourceFolder: "old", schema,
    views: [{ id: "old-view", name: "Capture", viewType: "form", sourceFolder: "", schema }] };
  const template = createVaultStarter(db, "My starter", "Reusable", [{ filename: "Sample", frontmatter: { status: "Todo" }, body: "Body" }]);
  const result = { name: "New", sourceFolder: "", customStarter: template, starterSourceFolderAuto: true, includeStarterSamples: true };
  const files = new Map<string, { path: string }>();
  const app = { vault: {
    getFiles: () => [...files.values()], getAbstractFileByPath: (path: string) => files.get(path),
    read: async () => "unchanged", createFolder: vi.fn(),
  } } as unknown as App;
  const createFile = (path: string) => { const file = { path }; files.set(path, file); return file; };
  const dataSource = {
    createViewDefFile: vi.fn(async () => createFile("database/New.md")),
    createNote: vi.fn(async (folder: string, name: string) => createFile(`${folder}/${name}.md`)),
    trashNote: vi.fn(async (file: { path: string }) => { files.delete(file.path); }),
  };
  const commit = vi.fn(async () => {});
  const prepare = vi.fn(async () => ({ commit })) as unknown as Parameters<typeof createDatabaseFromModalResult>[5];
  return { app, result, dataSource, commit, prepare, files };
}

describe("custom starter creation flow", () => {
  it("builds a fresh database using the final unique name and edited global options", async () => {
    const { app, result } = setup();
    const db = await buildDatabaseWithInferredColumns(app, { ...result, coverImage: "new-cover.png", description: "Edited" }, "New 2", "database");
    expect(db?.sourceFolder).toBe("database/records/New 2");
    expect(db?.newRecordFolder).toBe(db?.sourceFolder);
    expect(db?.id).not.toBe("old");
    expect(db?.views[0].id).not.toBe("old-view");
    expect(db?.views[0].viewType).toBe("form");
    expect(db?.coverImage).toBe("new-cover.png");
    expect(db?.description).toBe("Edited");
  });
  it("creates new sample notes and commits only after file creation", async () => {
    const { app, result, dataSource, prepare, commit } = setup();
    const file = await createDatabaseFromModalResult(app, dataSource as unknown as DataSource, result, "New", "database", prepare);
    expect(file?.path).toBe("database/New.md");
    expect(dataSource.createNote).toHaveBeenCalledWith("database/records/New", "Sample", { status: "Todo" }, undefined, "Body");
    expect(commit).toHaveBeenCalledOnce();
  });
  it("honors excluding samples", async () => {
    const { app, result, dataSource, prepare } = setup();
    await createDatabaseFromModalResult(app, dataSource as unknown as DataSource, { ...result, includeStarterSamples: false }, "New", "database", prepare);
    expect(dataSource.createNote).not.toHaveBeenCalled();
  });
  it("refuses occupied automatic record folders before writing", async () => {
    const { app, result, dataSource, prepare, files } = setup();
    files.set("database/records/New/existing.md", { path: "database/records/New/existing.md" });
    expect(await createDatabaseFromModalResult(app, dataSource as unknown as DataSource, result, "New", "database", prepare)).toBeNull();
    expect(dataSource.createViewDefFile).not.toHaveBeenCalled();
  });
  it("rolls back its own new database if sample creation fails", async () => {
    const { app, result, dataSource, prepare, commit } = setup();
    dataSource.createNote.mockRejectedValueOnce(new Error("write failed"));
    expect(await createDatabaseFromModalResult(app, dataSource as unknown as DataSource, result, "New", "database", prepare)).toBeNull();
    expect(dataSource.trashNote).toHaveBeenCalledWith({ path: "database/New.md" });
    expect(commit).not.toHaveBeenCalled();
  });
});
