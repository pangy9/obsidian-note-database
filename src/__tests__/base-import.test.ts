import { describe, expect, it, vi } from "vitest";
import NoteDatabasePlugin from "../main";
import { combineSourceRuleTrees } from "../data/SourceRules";

const { MockChainSetting, MockMenu, MockPlugin, MockTFile, parseYamlMock } = vi.hoisted(() => ({
  MockPlugin: class MockPlugin {},
  MockTFile: class MockTFile {},
  MockChainSetting: class MockChainSetting {
    setName() { return this; }
    setDesc() { return this; }
    addButton() { return this; }
    addDropdown() { return this; }
    addText() { return this; }
    addToggle() { return this; }
  },
  MockMenu: class MockMenu {
    addItem() { return this; }
    addSeparator() { return this; }
    showAtMouseEvent() { return this; }
  },
  parseYamlMock: vi.fn(),
}));

vi.mock("obsidian", () => ({
  App: class {},
  FuzzySuggestModal: class {},
  ItemView: class {},
  MarkdownView: class {},
  MarkdownRenderChild: class {},
  Menu: MockMenu,
  Modal: class {},
  Notice: class {},
  Platform: { isMacOS: false },
  Plugin: MockPlugin,
  PluginSettingTab: class {},
  Setting: MockChainSetting,
  WorkspaceLeaf: class {},
  TFile: MockTFile,
  EventRef: class {},
  getAllTags: () => [],
  normalizePath: (path: string) => path.replace(/\/+/g, "/").replace(/\/+$/, ""),
  parseYaml: parseYamlMock,
  setIcon: () => undefined,
  stringifyYaml: (value: unknown) => JSON.stringify(value),
}));

(globalThis as any).moment = Object.assign(
  (value: unknown) => {
    const date = value == null ? new Date() : new Date(value as any);
    return {
      add: () => ({ toDate: () => date }),
      duration: () => ({ asMilliseconds: () => 0 }),
      format: () => "2026-06-03",
      fromNow: () => "now",
      isValid: () => !Number.isNaN(date.getTime()),
      startOf: () => ({ toDate: () => date }),
      toDate: () => date,
    };
  },
  {
    duration: () => ({
      asDays: () => 0,
      asHours: () => 0,
      asMilliseconds: () => 0,
      asMinutes: () => 0,
      asSeconds: () => 0,
    }),
    isDuration: () => false,
    isMoment: () => false,
    ISO_8601: "ISO_8601",
  }
);
(globalThis as any).document = { documentElement: { lang: "en" } };
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: { language: "en-US" },
});

function file(path: string, extension = path.split(".").pop() || "md") {
  const name = path.split("/").pop() || path;
  return Object.assign(new MockTFile(), {
    name,
    basename: name.replace(/\.[^.]+$/, ""),
    path,
    extension,
    parent: { path: path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "" },
    stat: { size: 1, ctime: 0, mtime: 0 },
  }) as any;
}

function createPlugin(frontmatterByPath: Record<string, Record<string, unknown>> = {}) {
  const plugin = Object.create(NoteDatabasePlugin.prototype) as any;
  const markdownFiles = Object.keys(frontmatterByPath).map((path) => file(path));
  plugin.app = {
    vault: {
      getMarkdownFiles: () => markdownFiles,
      getAbstractFileByPath: (path: string) => markdownFiles.find((candidate) => candidate.path === path) || null,
    },
    metadataCache: {
      getFileCache: (target: { path: string }) => ({ frontmatter: frontmatterByPath[target.path] || {} }),
      getFirstLinkpathDest: () => null,
    },
  };
  plugin.settings = { databaseFolder: "Databases" };
  return plugin;
}

describe(".base import", () => {
  it("preserves this context, computed checkbox type, view widths, and multi-argument source rules", () => {
    parseYamlMock.mockReturnValue({
      sourceFolder: "Projects",
      filters: {
        and: [
          'file.inFolder("Projects/Active", "Projects/Next")',
          'file.hasProperty("status", "priority")',
        ],
      },
      formulas: {
        active: "note.done == true",
      },
      views: [
        {
          type: "table",
          name: "Wide",
          order: ["file.name", "status", "formula.active"],
          columnSize: { status: 420, "formula.active": 96 },
        },
        {
          type: "table",
          name: "Narrow",
          order: ["file.name", "status", "formula.active"],
          columnSize: { status: 180 },
        },
      ],
    });
    const plugin = createPlugin({
      "Projects/Active/task.md": { status: "todo", priority: "high", done: true },
    });
    const baseFile = file("Projects/source.base", "base");

    const { config } = plugin.createConfigFromBase(baseFile, "ignored");

    expect(config.baseThisFilePath).toBe("Projects/source.base");
    expect(config.schema.computedFields.find((field: any) => field.key === "active")?.type).toBe("checkbox");
    expect(config.schema.columns.find((col: any) => col.key === "status")?.width).toBeUndefined();
    expect(config.views[0].columnWidths).toEqual({ status: 420, "formula.active": 96 });
    expect(config.views[1].columnWidths).toEqual({ status: 180 });
    expect(config.sourceRuleTree).toEqual({
      type: "group",
      logic: "and",
      rules: [
        {
          type: "group",
          logic: "or",
          rules: [
            { field: "folder", op: "inFolder", value: "Projects/Active" },
            { field: "folder", op: "inFolder", value: "Projects/Next" },
          ],
        },
        {
          type: "group",
          logic: "and",
          rules: [
            { field: "status", op: "hasProperty" },
            { field: "priority", op: "hasProperty" },
          ],
        },
      ],
    });
  });

  it("rejects unsupported view filters instead of silently dropping them", () => {
    parseYamlMock.mockReturnValue({
      sourceFolder: "Projects",
      views: [
        {
          type: "table",
          name: "Unsupported",
          order: ["file.name"],
          filters: { xor: ["status == 'todo'"] },
        },
      ],
    });
    const plugin = createPlugin();

    expect(() => plugin.createConfigFromBase(file("Projects/source.base", "base"), "ignored")).toThrow(/filter|筛选/i);
  });

  it("keeps global and view filters separate for runtime composition", () => {
    parseYamlMock.mockReturnValue({
      sourceFolder: "Projects",
      filters: 'status == "active"',
      views: [
        {
          type: "table",
          name: "Mine",
          order: ["file.name", "owner"],
          filters: 'owner == "me"',
        },
      ],
    });
    const plugin = createPlugin();

    const { config } = plugin.createConfigFromBase(file("Projects/source.base", "base"), "ignored");

    expect(config.sourceRuleTree).toEqual({ field: "status", op: "eq", value: "active", valueType: "string" });
    expect(config.views[0].sourceRuleTree).toEqual({ field: "owner", op: "eq", value: "me", valueType: "string" });
    expect(combineSourceRuleTrees(config.sourceRuleTree, config.views[0].sourceRuleTree)).toEqual({
      type: "group",
      logic: "and",
      rules: [
        { field: "status", op: "eq", value: "active", valueType: "string" },
        { field: "owner", op: "eq", value: "me", valueType: "string" },
      ],
    });
  });
});
