import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import {
  __resetVaultPropertiesCacheForTests,
  collectVaultPropertiesFromMetadataCache,
  getVaultProperties,
  getVaultPropertyCacheInfo,
  mapRawProperties,
  obsidianTypeToColumnType,
  refreshVaultPropertyCache,
} from "../data/VaultProperties";

vi.mock("obsidian", () => ({}));

// The source-rule custom-property picker uses a plugin-owned property cache built from
// Obsidian's public metadataCache frontmatter. It does not depend on types.json or the
// internal metadataTypeManager registry. Each row carries a type icon inferred from
// cached values, with list-like Obsidian types mapped to multi-select when metadata is
// imported from external sources.

const appWithFrontmatter = (frontmatterByPath: Record<string, Record<string, unknown>>): App => {
  const files = Object.keys(frontmatterByPath).map((path) => ({ path }));
  return {
    vault: { getMarkdownFiles: () => files },
    metadataCache: {
      getFileCache: (file: { path: string }) => ({ frontmatter: frontmatterByPath[file.path] }),
    },
  } as unknown as App;
};

describe("obsidianTypeToColumnType", () => {
  it("maps Obsidian property types to plugin column types (case-insensitive)", () => {
    expect(obsidianTypeToColumnType("number")).toBe("number");
    expect(obsidianTypeToColumnType("date")).toBe("date");
    expect(obsidianTypeToColumnType("datetime")).toBe("datetime");
    expect(obsidianTypeToColumnType("checkbox")).toBe("checkbox");
    expect(obsidianTypeToColumnType("multitext")).toBe("multi-select");
    expect(obsidianTypeToColumnType("tags")).toBe("multi-select");
    expect(obsidianTypeToColumnType("aliases")).toBe("multi-select");
    expect(obsidianTypeToColumnType("text")).toBe("text");
    expect(obsidianTypeToColumnType("object")).toBe("text");
    expect(obsidianTypeToColumnType("something-new")).toBe("text");
    expect(obsidianTypeToColumnType("Number")).toBe("number");
    expect(obsidianTypeToColumnType("Tags")).toBe("multi-select");
    expect(obsidianTypeToColumnType("Checkbox")).toBe("checkbox");
    expect(obsidianTypeToColumnType("  DateTime ")).toBe("datetime");
  });
});

describe("mapRawProperties", () => {
  it("normalizes explicit property metadata when an import path already has declared types", () => {
    expect(mapRawProperties(new Map<string, unknown>([
      ["done", "checkbox"],
      ["tags", "tags"],
      ["when", { type: "datetime" }],
      ["file.name", "text"],
    ]))).toEqual([
      { key: "done", type: "checkbox" },
      { key: "tags", type: "multi-select" },
      { key: "when", type: "datetime" },
    ]);
  });

  it("returns [] for non-object / nullish input (defensive)", () => {
    expect(mapRawProperties(null)).toEqual([]);
    expect(mapRawProperties(undefined)).toEqual([]);
    expect(mapRawProperties("x")).toEqual([]);
    expect(mapRawProperties({ type: { /* no type field */ } })).toEqual([{ key: "type", type: "text" }]);
  });
});

describe("collectVaultPropertiesFromMetadataCache", () => {
  it("scans cached frontmatter keys without reading files and infers types", () => {
    const app = appWithFrontmatter({
      "a.md": { status: "draft", tags: ["x"], year: 2026, done: true, start: "2026-06-24T10:30:00" },
      "b.md": { status: "done", aliases: ["A"], cost: "12.5", hidden: null },
      "db.md": { db_view: true, ignored: "yes" },
    });
    expect(collectVaultPropertiesFromMetadataCache(app)).toEqual([
      { key: "aliases", type: "multi-select" },
      { key: "cost", type: "number" },
      { key: "done", type: "checkbox" },
      { key: "hidden", type: "text" },
      { key: "start", type: "datetime" },
      { key: "status", type: "text" },
      { key: "tags", type: "multi-select" },
      { key: "year", type: "number" },
    ]);
  });

  it("returns [] when metadata cache is unavailable", () => {
    expect(collectVaultPropertiesFromMetadataCache({} as unknown as App)).toEqual([]);
  });
});

describe("vault property cache", () => {
  it("refreshes and serves cached properties synchronously", () => {
    __resetVaultPropertiesCacheForTests();
    const app = appWithFrontmatter({ "a.md": { done: true } });
    expect(refreshVaultPropertyCache(app)).toEqual([{ key: "done", type: "checkbox" }]);
    expect(getVaultProperties({} as unknown as App)).toEqual([{ key: "done", type: "checkbox" }]);
    const info = getVaultPropertyCacheInfo();
    expect(info.count).toBe(1);
    expect(info.refreshedAt).toBeGreaterThan(0);
    expect(info.durationMs).toBeGreaterThanOrEqual(0);
    __resetVaultPropertiesCacheForTests();
  });

  it("builds immediately on first read if the cache is cold", () => {
    __resetVaultPropertiesCacheForTests();
    expect(getVaultProperties(appWithFrontmatter({ "a.md": { tags: ["x"] } }))).toEqual([
      { key: "tags", type: "multi-select" },
    ]);
    __resetVaultPropertiesCacheForTests();
  });
});

describe("source-rule custom-property picker wiring", () => {
  const viewConfig = readFileSync(new URL("../views/ViewConfigPanelRenderer.ts", import.meta.url), "utf8");
  const main = readFileSync(new URL("../main.ts", import.meta.url), "utf8");

  it("reads the plugin-owned cache and threads it to the source-rule leaf", () => {
    expect(viewConfig).toContain("getVaultProperties(actions.app)");
    expect(viewConfig).toContain("renderSourceRuleNode(editor, tree, commit, !!readOnly, database, getVaultProperties(actions.app))");
    expect(viewConfig).toContain("database: DatabaseConfig,\n    vaultProperties: VaultProperty[]");
  });

  it("custom-property slot uses a searchable picker with type icons (replaces the text input)", () => {
    expect(viewConfig).toContain("createCustomPropertyPicker(");
    expect(viewConfig).toContain("openDropdownMenu({");
    expect(viewConfig).toContain("searchable: true");
    expect(viewConfig).toContain("searchPlaceholder");
    expect(viewConfig).toContain("renderIcon: renderDropdownPropertyTypeIcon");
    expect(viewConfig).toContain("const selectedKey = knownFields.has(rule.field) ? \"\" : rule.field");
    expect(viewConfig).toContain("button.toggleClass(\"has-current-icon\", Boolean(propType))");
    expect(viewConfig).toContain("renderPropertyTypeIcon(button, { key: selectedKey, type: propType, label: selectedKey }, \"db-dropdown-field-icon\")");
    expect(viewConfig).toContain("value: knownFields.has(rule.field) ? \"\" : rule.field");
    expect(viewConfig).toContain("db-source-rule-dropdown db-source-rule-custom-field db-source-rule-property-picker");
    expect(viewConfig).toContain('t("viewConfig.sourceRules.pickProperty")');
    expect(viewConfig).toContain("const usePicker = vaultProperties.length > 0 && !readOnly;");
  });

  it("refreshes the cache from plugin lifecycle events", () => {
    expect(main).toContain("refreshVaultPropertyCache(this.app)");
    expect(main).toContain('this.app.metadataCache.on("resolved", () => this.scheduleVaultPropertyCacheRefresh())');
    expect(main).toContain('this.app.metadataCache.on("changed", (file) => {');
    expect(main).toContain('this.app.vault.on("create", () => this.scheduleVaultPropertyCacheRefresh())');
    expect(main).toContain('this.app.vault.on("delete", () => this.scheduleVaultPropertyCacheRefresh())');
    expect(main).toContain('this.app.vault.on("rename", () => this.scheduleVaultPropertyCacheRefresh())');
    expect(main).toContain("private scheduleVaultPropertyCacheRefresh");
  });

  it("keeps the property picker on the same source-rule dropdown styling path", () => {
    const styles = readFileSync(new URL("../../styles.css", import.meta.url), "utf8");
    expect(styles).toContain(".note-database-container .db-source-rule-property-picker");
    expect(styles).toContain(".note-database-container .db-source-rule-property-picker {\n  grid-template-columns: minmax(0, 1fr) 18px");
    expect(styles).toContain(".note-database-container .db-source-rule-property-picker.has-current-icon {\n  grid-template-columns: 16px minmax(0, 1fr) 18px");
    expect(styles).toContain(".note-database-container .db-source-rule-custom-field:not(.db-source-rule-property-picker)");
  });
});
