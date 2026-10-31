import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { headerCollapseStorageKey, loadHeaderCollapseState, readHeaderCollapseState, applyHeaderCollapseState } from "../views/HeaderCollapseControls";

class Element {
  classes = new Set<string>();
  toggleClass(value: string, on: boolean): void { if (on) this.classes.add(value); else this.classes.delete(value); }
}

describe("header collapse", () => {
  it.each([null, undefined, "true", [], { description: "true", toolbar: 1 }])("defaults invalid preferences to expanded: %j", (value) => {
    expect(readHeaderCollapseState(value)).toEqual({ description: false });
  });

  it("uses independent database identities and restores independent states", () => {
    expect(headerCollapseStorageKey("vault", "one")).not.toBe(headerCollapseStorageKey("vault", "two"));
    expect(headerCollapseStorageKey("vault", "one")).not.toBe(headerCollapseStorageKey("other-vault", "one"));
    expect(headerCollapseStorageKey("app://vault/?123", "one")).toBe(headerCollapseStorageKey("app://vault/?456", "one"));
    expect(readHeaderCollapseState({ description: true })).toEqual({ description: true });
    expect(readHeaderCollapseState({ description: true, toolbar: true })).toEqual({ description: true });
    expect(readHeaderCollapseState({ toolbar: true })).toEqual({ description: false });
  });

  it("loads saved preferences and tolerates corrupt or unavailable storage", () => {
    expect(loadHeaderCollapseState({ getItem: () => '{"description":true,"toolbar":true}' }, "key")).toEqual({ description: true });
    for (const getItem of [() => null, () => "bad json", () => { throw new Error("unavailable"); }]) {
      expect(loadHeaderCollapseState({ getItem }, "key")).toEqual({ description: false });
    }
  });

  it("applies single-line description state without hiding the toolbar", () => {
    const header = new Element();
    applyHeaderCollapseState(header as unknown as HTMLElement, { description: true });
    expect([...header.classes]).toEqual(["is-description-collapsed"]);
    applyHeaderCollapseState(header as unknown as HTMLElement, { description: true });
    expect([...header.classes]).toEqual(["is-description-collapsed"]);
    applyHeaderCollapseState(header as unknown as HTMLElement, { description: false });
    expect(header.classes.size).toBe(0);
  });

  it("keeps visibility toggles inside the title menu, including database file pages", () => {
    const toolbar = readFileSync(new URL("../views/ToolbarRenderer.ts", import.meta.url), "utf8");
    expect(toolbar).toContain("if (!actions.hideDatabaseActions || actions.headerCollapse)");
    expect(toolbar).toContain('t("headerCollapse.description"), "align-left"');
    expect(toolbar).not.toContain("headerCollapse.toolbar");
    expect(toolbar).toContain('}, "", collapse.state.description)');
    expect(toolbar).toContain('row.setAttribute("aria-checked", String(checked))');
    expect(toolbar).toContain('if (checked === true) setIcon(status, "check")');
    expect(toolbar).toContain('row.toggleClass("is-unchecked", !checked)');
    expect(toolbar).toContain('t("toolbar.toggleDatabaseIcon"), "database", () => actions.toggleDatabaseIcon?.(), "", actions.showDatabaseIcon !== false');
    expect(toolbar.match(/cls: "db-title-actions-separator"/g)).toHaveLength(2);
    expect(toolbar).toContain("collapse.state = { description: !collapse.state.description }");
    expect(toolbar).not.toContain("renderHeaderCollapseControls");
  });

  it("wires full pages to local storage and sticky offsets without enabling embedded overrides", () => {
    const full = readFileSync(new URL("../views/DatabaseView.ts", import.meta.url), "utf8");
    expect(full).toContain("loadHeaderCollapseState(collapseStorage, collapseKey)");
    expect(full).toMatch(/onChange: \(state\) => \{\s*collapseStorage\?\.setItem\(collapseKey, JSON.stringify\(state\)\);\s*this.closeHeaderPopovers\(\);\s*this.updateStickyOffsets\(\);/);
    const embedded = readFileSync(new URL("../views/EmbeddedDatabaseRenderer.ts", import.meta.url), "utf8");
    expect(embedded).not.toContain("headerCollapse:");
    const css = readFileSync(new URL("../../styles.css", import.meta.url), "utf8");
    expect(css).toContain(".db-header.is-description-collapsed > .db-description");
    expect(css).not.toContain("is-toolbar-collapsed");
    const collapsedDescription = css.match(/\.db-header\.is-description-collapsed > \.db-description:not\(\.is-empty\) \{([^}]+)\}/)?.[1];
    expect(collapsedDescription).toContain("-webkit-line-clamp: 1");
    expect(collapsedDescription).toContain("white-space: pre-wrap");
    expect(collapsedDescription).not.toContain("white-space: nowrap");
  });

  it("keeps the content divider before chips", () => {
    const toolbar = readFileSync(new URL("../views/ToolbarRenderer.ts", import.meta.url), "utf8");
    expect(toolbar).toContain('header.createDiv({ cls: "db-header-divider", attr: { role: "separator" } })');
    const controls = readFileSync(new URL("../views/ActiveViewControlsRenderer.ts", import.meta.url), "utf8");
    expect(controls).toContain('const rail = header.createDiv({');
    const full = readFileSync(new URL("../views/DatabaseView.ts", import.meta.url), "utf8");
    const renderToolbar = full.slice(full.indexOf("protected renderToolbar()"), full.indexOf("private renderActiveViewControls()"));
    expect(renderToolbar.indexOf("this.toolbarRenderer.render(")).toBeLessThan(renderToolbar.indexOf("this.renderActiveViewControls()"));
    const css = readFileSync(new URL("../../styles.css", import.meta.url), "utf8");
    expect(css).toContain(".db-header > .db-header-divider");
  });
});
