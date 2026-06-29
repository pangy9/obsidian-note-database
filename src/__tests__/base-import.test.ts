import { describe, expect, it, vi } from "vitest";
import NoteDatabasePlugin from "../main";
import { combineSourceRuleTrees } from "../data/SourceRules";

// eslint-disable-next-line obsidianmd/no-global-this -- test setup needs globalThis to mock globals
const _g = globalThis as unknown as Record<string, unknown>;

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
  FileView: class {},
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

_g.moment = Object.assign(
  (value: unknown) => {
    const date = value == null ? new Date() : new Date(value as string | number | Date);
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
_g.document = { documentElement: { lang: "en" } };
// eslint-disable-next-line obsidianmd/no-global-this -- test setup needs globalThis to mock globals
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: { language: "en-US" },
});

/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion -- test helper casts are intentional */

interface MockFile {
  name: string;
  basename: string;
  path: string;
  extension: string;
  parent: { path: string };
  stat: { size: number; ctime: number; mtime: number };
}

function file(path: string, extension = path.split(".").pop() || "md"): MockFile {
  const name = path.split("/").pop() || path;
  return Object.assign(new MockTFile(), {
    name,
    basename: name.replace(/\.[^.]+$/, ""),
    path,
    extension,
    parent: { path: path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "" },
    stat: { size: 1, ctime: 0, mtime: 0 },
  }) as unknown as MockFile;
}

/* eslint-enable @typescript-eslint/no-unnecessary-type-assertion */

interface MockPluginInstance {
  app: {
    vault: {
      getMarkdownFiles: () => MockFile[];
      getAbstractFileByPath: (path: string) => MockFile | null;
    };
    metadataCache: {
      getFileCache: (target: { path: string }) => { frontmatter: Record<string, unknown> };
      getFirstLinkpathDest: () => null;
    };
  };
  settings: { databaseFolder: string };
  createConfigFromBase: (baseFile: MockFile, ignored: string) => { config: Record<string, unknown> };
  importFromCsvs: (result: unknown, metadata: unknown) => Promise<void>;
  saveSettings: () => Promise<void>;
  dataSource?: {
    getViewDefFiles: () => unknown[];
    createViewDefFile: (folder: string, name: string, config: Record<string, unknown>) => Promise<MockFile>;
    openNote: () => void;
  };
}

function createPlugin(frontmatterByPath: Record<string, Record<string, unknown>> = {}): MockPluginInstance {
  const plugin = Object.create(NoteDatabasePlugin.prototype) as unknown as MockPluginInstance;
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

function uploadFile(name: string, content: string): { name: string; text: () => Promise<string> } {
  return { name, text: async () => content };
}

interface ConfigResult {
  baseThisFilePath: string;
  schema: {
    computedFields: Array<{ key: string; type?: string }>;
    columns: Array<{ key: string; type?: string; width?: number; statusOptions?: unknown[] }>;
  };
  views: Array<{
    viewType?: string;
    columnWidths: Record<string, number>;
    columnOrder?: string[];
    hiddenColumns?: string[];
    sourceRules?: unknown;
    sourceRuleTree?: unknown;
    viewSourceRulesEnabled?: boolean;
    chartGroupField?: string;
    chartValueField?: string;
  }>;
  sourceRules?: unknown;
  sourceRuleTree: unknown;
}

describe(".base import", () => {
  it("does not copy global source rules into the auto-created view when the .base has no views", () => {
    parseYamlMock.mockReturnValue({
      sourceFolder: "Projects",
      filters: { and: ['file.hasProperty("status")'] },
    });
    const plugin = createPlugin({ "Projects/task.md": { status: "todo" } });
    const baseFile = file("Projects/source.base", "base");

    const { config } = plugin.createConfigFromBase(baseFile, "ignored") as unknown as { config: ConfigResult };

    // The db level still carries the global rule, so queries keep working.
    expect(config.sourceRules).toBeDefined();
    expect(config.sourceRuleTree).toBeDefined();
    // The single auto-created view must NOT inherit a copy of the global rules — otherwise,
    // after a save/reload cycle, parseViewConfig flags it as having view-level source rules.
    const view = config.views[0];
    expect(view.sourceRules).toBeUndefined();
    expect(view.sourceRuleTree).toBeUndefined();
    expect(view.viewSourceRulesEnabled).not.toBe(true);
  });

  it("does not copy global source rules into explicitly-defined views either", () => {
    parseYamlMock.mockReturnValue({
      sourceFolder: "Projects",
      filters: { and: ['file.hasProperty("status")'] },
      views: [{ type: "table", name: "All", order: ["file.name", "status"] }],
    });
    const plugin = createPlugin({ "Projects/task.md": { status: "todo" } });
    const baseFile = file("Projects/source.base", "base");

    const { config } = plugin.createConfigFromBase(baseFile, "ignored") as unknown as { config: ConfigResult };

    for (const view of config.views) {
      expect(view.sourceRules).toBeUndefined();
      expect(view.sourceRuleTree).toBeUndefined();
      expect(view.viewSourceRulesEnabled).not.toBe(true);
    }
  });

  it("imports every column a .base view lists in order, including file.* fields (e.g. file.basename)", () => {
    parseYamlMock.mockReturnValue({
      sourceFolder: "Demo/任务管理",
      filters: { and: ['file.inFolder("Demo/任务管理")'] },
      views: [
        { type: "table", name: "表格", order: ["file.name", "aliases"] },
        { type: "table", name: "视图", order: ["file.basename"] },
      ],
    });
    const plugin = createPlugin({ "Demo/任务管理/t1.md": { aliases: ["a"] } });

    const { config } = plugin.createConfigFromBase(file("Demo/任务管理/x.base", "base"), "ignored") as unknown as { config: ConfigResult };

    const schemaKeys = new Set(config.schema.columns.map((col) => col.key));
    // An explicitly-ordered file.* field is imported into the schema, not dropped as "unsupported".
    expect(schemaKeys.has("file.basename")).toBe(true);
    // Bases shows exactly the columns each view lists in `order`; conversion mirrors that per view.
    expect(config.views[0].columnOrder).toEqual(["file.name", "aliases"]);
    expect(config.views[1].columnOrder).toEqual(["file.basename"]);
    // Each view's ordered columns stay visible (not hidden); only the unlisted columns are hidden.
    expect(config.views[0].hiddenColumns ?? []).not.toContain("file.name");
    expect(config.views[0].hiddenColumns ?? []).not.toContain("aliases");
    expect(config.views[1].hiddenColumns ?? []).not.toContain("file.basename");
  });

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

    const { config } = plugin.createConfigFromBase(baseFile, "ignored") as unknown as { config: ConfigResult };

    expect(config.baseThisFilePath).toBe("Projects/source.base");
    expect(config.schema.computedFields.find((field) => field.key === "active")?.type).toBe("checkbox");
    expect(config.schema.columns.find((col) => col.key === "status")?.width).toBeUndefined();
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

  it("keeps file.* fields fixed and does not generate option lists for virtual file metadata", () => {
    parseYamlMock.mockReturnValue({
      sourceFolder: "Projects",
      views: [
        {
          type: "table",
          name: "Files",
          order: ["file.name", "file.tags", "file.links", "file.backlinks", "file.embeds", "file.size"],
        },
      ],
    });
    const plugin = createPlugin({
      "Projects/Active/task.md": { tags: ["alpha", "beta"] },
    });
    const baseFile = file("Projects/source.base", "base");

    const { config } = plugin.createConfigFromBase(baseFile, "ignored") as unknown as { config: ConfigResult };
    const byKey = new Map(config.schema.columns.map((col) => [col.key, col]));

    expect(byKey.get("file.tags")?.type).toBe("multi-select");
    expect(byKey.get("file.tags")?.statusOptions).toBeUndefined();
    expect(byKey.get("file.links")?.type).toBe("text");
    expect(byKey.get("file.links")?.statusOptions).toBeUndefined();
    expect(byKey.get("file.backlinks")?.type).toBe("text");
    expect(byKey.get("file.embeds")?.type).toBe("text");
    expect(byKey.get("file.size")?.type).toBe("number");
  });

  it("does not import unsupported chart views into unusable chart configs", () => {
    parseYamlMock.mockReturnValue({
      sourceFolder: "Projects",
      views: [
        {
          type: "chart",
          name: "Revenue Chart",
          order: ["file.name", "status", "amount"],
          chartGroupField: "missing",
          chartValueField: "also_missing",
        },
      ],
    });
    const plugin = createPlugin({
      "Projects/Active/task.md": { status: "todo", amount: 12 },
    });

    const { config } = plugin.createConfigFromBase(file("Projects/source.base", "base"), "ignored") as unknown as { config: ConfigResult };

    expect(config.views).toHaveLength(1);
    expect(config.views[0]?.viewType).toBe("table");
    expect(config.views[0]?.chartGroupField).toBeUndefined();
    expect(config.views[0]?.chartValueField).toBeUndefined();
    expect(config.views[0]?.columnOrder).toEqual(config.schema.columns.map((col) => col.key));
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

    const { config } = plugin.createConfigFromBase(file("Projects/source.base", "base"), "ignored") as unknown as { config: ConfigResult };

    expect(config.sourceRuleTree).toEqual({ field: "status", op: "eq", value: "active", valueType: "string" });
    expect(config.views[0].sourceRuleTree).toEqual({ field: "owner", op: "eq", value: "me", valueType: "string" });
    expect(combineSourceRuleTrees(
      config.sourceRuleTree as Parameters<typeof combineSourceRuleTrees>[0],
      config.views[0].sourceRuleTree as Parameters<typeof combineSourceRuleTrees>[1]
    )).toEqual({
      type: "group",
      logic: "and",
      rules: [
        { field: "status", op: "eq", value: "active", valueType: "string" },
        { field: "owner", op: "eq", value: "me", valueType: "string" },
      ],
    });
  });

  it("skips readonly file.* CSV columns and writes file.tags to frontmatter tags", async () => {
    const plugin = createPlugin();
    const createdNotes: Array<{ path: string; content: string }> = [];
    let createdConfig: ConfigResult | undefined;
    plugin.app.vault = {
      ...plugin.app.vault,
      createFolder: () => Promise.resolve(),
      create: (path: string, content: string) => {
        createdNotes.push({ path, content });
        return Promise.resolve(file(path));
      },
    } as typeof plugin.app.vault & {
      createFolder: () => Promise<void>;
      create: (path: string, content: string) => Promise<MockFile>;
    };
    plugin.dataSource = {
      getViewDefFiles: () => [],
      createViewDefFile: (_folder, name, config) => {
        createdConfig = config as unknown as ConfigResult;
        return Promise.resolve(file(`Databases/${name}.md`));
      },
      openNote: () => undefined,
    };
    plugin.saveSettings = async () => undefined;

    await plugin.importFromCsvs(
      {
        csvFiles: [uploadFile("Import.csv", "Name,file.path,file.tags,status\nTask,Other.md,\"#alpha, #beta\",todo")],
        markdownFiles: [],
        databaseName: "Imported",
        targetFolder: "Imported",
      },
      {
        format: "note-database-csv-markdown",
        database: {
          id: "source",
          name: "Source",
          sourceFolder: "",
          schema: { columns: [{ key: "file.name", label: "Name", type: "text" }], computedFields: [] },
          views: [],
        },
      }
    );

    expect(createdConfig?.schema.columns.some((col) => col.key === "file.path")).toBe(false);
    expect(createdConfig?.schema.columns.find((col) => col.key === "file.tags")?.type).toBe("multi-select");
    expect(createdNotes[0]?.content).toContain("\"tags\":[\"alpha\",\"beta\"]");
    expect(createdNotes[0]?.content).not.toContain("file.path");
    expect(createdNotes[0]?.content).not.toContain("file.tags");
  });
});
