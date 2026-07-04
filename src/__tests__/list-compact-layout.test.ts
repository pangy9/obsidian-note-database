import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("list compact field layout", () => {
  it("persists the list compact field layout flag", () => {
    const types = read("../data/types.ts");
    const dataSource = read("../data/DataSource.ts");

    expect(types).toContain("listCompactFields?: boolean");
    expect(dataSource).toContain('listCompactFields: source["listCompactFields"] === true');
    expect(dataSource).toContain('listCompactFields: v["listCompactFields"] === true');
    expect(dataSource).toContain("listCompactFields: view.listCompactFields === true");
    expect(dataSource).toContain('"listCompactFields"');
  });

  it("adds a list-only view setting and renderer state class", () => {
    const viewConfig = read("../views/ViewConfigPanelRenderer.ts");
    const listRenderer = read("../views/ListRenderer.ts");
    const i18n = read("../i18n.ts");

    expect(viewConfig).toContain('if (config.viewType === "list")');
    expect(viewConfig).toContain("t(\"viewConfig.listCompactFields\")");
    expect(viewConfig).toContain("config.listCompactFields = value || undefined");
    expect(viewConfig).toContain("actions.onChange(t(\"undo.listCompactFieldsConfig\"))");
    expect(listRenderer).toContain("private createList(parent: HTMLElement, config: ViewConfig): HTMLElement");
    expect(listRenderer).toContain('list.addClass("is-compact-fields")');
    expect(i18n).toContain('"viewConfig.listCompactFields"');
    expect(i18n).toContain('"undo.listCompactFieldsConfig"');
  });

  it("shrinks only non-wrapped fields while wrapped fields keep full-width display", () => {
    const styles = read("../../styles.css");
    const compactRule = cssRule(styles, ".note-database-container .db-list.is-compact-fields .db-list-field:not(.db-list-field-wrap)");
    const wrapRule = cssRule(styles, ".note-database-container .db-list-field-wrap");
    const wrapValueRule = cssRule(styles, ".note-database-container .db-list-field-wrap .db-list-field-value");

    expect(compactRule).toContain("flex: 0 1 auto");
    expect(compactRule).toContain("width: max-content");
    expect(compactRule).toContain("max-width: var(--db-card-field-width, 150px)");
    expect(wrapRule).toContain("width: max-content");
    expect(wrapRule).toContain("max-width: none");
    expect(wrapValueRule).toContain("overflow: visible");
  });
});

function read(rel: string): string {
  return readFileSync(new URL(rel, import.meta.url), "utf8");
}

function cssRule(source: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  return match?.[1] || "";
}
