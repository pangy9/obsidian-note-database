import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("database file tab title", () => {
  const databaseFileViewSource = readFileSync(new URL("../views/DatabaseFileView.ts", import.meta.url), "utf8");
  const databaseViewSource = readFileSync(new URL("../views/DatabaseView.ts", import.meta.url), "utf8");
  const mainSource = readFileSync(new URL("../main.ts", import.meta.url), "utf8");
  const stylesSource = readFileSync(new URL("../../styles.css", import.meta.url), "utf8");

  it("shows only the database file name, not its full path", () => {
    expect(databaseFileViewSource).toContain("getDisplayFileName(path: string)");
    expect(databaseFileViewSource).toContain("fileName.replace(/\\.md$/i, \"\")");
    expect(databaseFileViewSource).not.toContain("this.filePath.replace(/\\.md$/");
  });

  it("syncs database file paths through file-backed view state", () => {
    expect(databaseViewSource).toContain("export class DatabaseView extends FileView");
    expect(databaseViewSource).toContain("allowNoFile = true");
    expect(databaseViewSource).toContain("file: TFile | null = null");
    expect(databaseViewSource).toContain("canAcceptExtension(extension: string): boolean");
    expect(databaseViewSource).toContain("return false;");
    expect(databaseFileViewSource).toContain("file: TFile | null = null");
    expect(databaseFileViewSource).toContain("navigation = true");
    expect(databaseFileViewSource).toContain("allowNoFile = false");
    expect(databaseFileViewSource).toContain("this.app.vault.getFileByPath(this.filePath)");
    expect(databaseFileViewSource).toContain("getEphemeralState(): Record<string, unknown>");
    expect(databaseFileViewSource).toContain("setEphemeralState(state: unknown): void");
    expect(databaseFileViewSource).toContain("this.leaf.setEphemeralState(this.withFilePath(this.leaf.getEphemeralState()))");
    expect(databaseFileViewSource).toContain("file: this.filePath");
  });

  it("does not let stale ephemeral state replace the active database file path", () => {
    expect(databaseFileViewSource).toContain("setEphemeralState(state: unknown): void {\n    super.setEphemeralState(state);\n  }");
    expect(databaseFileViewSource).toContain("const nextPath = this.getStateFilePath(state);\n    if (nextPath && nextPath !== this.filePath) {\n      this.filePath = nextPath;\n    }\n    await super.setState(state, result);");
  });

  it("does not fake Obsidian header breadcrumbs with custom DOM", () => {
    expect(databaseFileViewSource).not.toContain([".view-header", "title-container"].join("-"));
    expect(databaseFileViewSource).not.toContain(["note-database-file", "header-path"].join("-"));
    expect(databaseFileViewSource).not.toContain(["reveal", "InFolder"].join(""));
    expect(stylesSource).not.toContain(["note-database-file", "header-path"].join("-"));
  });

  it("continues marking database file tabs without a title-hiding setting", () => {
    expect(mainSource).toContain("note-database-file-tab");
    expect(mainSource).toContain('this.app.workspace.getLeavesOfType("markdown")');
    expect(mainSource).toContain("this.app.workspace.getLeavesOfType(DATABASE_FILE_VIEW_TYPE)");
    expect(mainSource).not.toContain(["note-database-file-tab", "title-hidden"].join("-"));
    expect(databaseFileViewSource).not.toContain(["hide", "DatabaseFileTabTitles"].join(""));
    expect(stylesSource).not.toContain(["note-database-file-tab", "title-hidden"].join("-"));
  });

  it("reveals a newly opened dashboard leaf instead of leaving focus on the previous file tab", () => {
    expect(mainSource).toContain("await leaf.setViewState({\n      type: DATABASE_VIEW_TYPE,\n      active: true,\n    });\n    await this.app.workspace.revealLeaf(leaf);");
  });

  it("does not let duplicate-prevention reopen a database file while plugin views are active", () => {
    expect(mainSource).toContain("private currentWorkspaceLeaf: WorkspaceLeaf | null = null;");
    expect(mainSource).toContain("this.currentWorkspaceLeaf = leaf;");
    expect(mainSource).toContain("if (leaf && this.isDatabasePluginLeaf(leaf)) return;");
    expect(mainSource).toContain("if (this.isDatabasePluginLeaf(this.currentWorkspaceLeaf)) return;");
    expect(mainSource).toContain("if (targetLeaf && this.isDatabasePluginLeaf(targetLeaf)) return;");
    expect(mainSource).toContain("private isDatabasePluginLeaf(leaf: WorkspaceLeaf | null | undefined): boolean");
    expect(mainSource).toContain("viewType === DATABASE_VIEW_TYPE || viewType === DATABASE_FILE_VIEW_TYPE");
  });
});
