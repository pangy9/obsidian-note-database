import { describe, expect, it } from "vitest";
// eslint-disable-next-line import/no-nodejs-modules
import { readFileSync } from "node:fs";
import { ColumnDef } from "../data/types";
import { PROPERTY_TYPE_ICON_NAMES, renderPropertyTypeIcon } from "../views/PropertyTypeIcon";

class FakeClassList {
  private values = new Set<string>();

  add(...classes: string[]): void {
    for (const cls of classes) this.values.add(cls);
  }

  contains(cls: string): boolean {
    return this.values.has(cls);
  }
}

class FakeElement {
  readonly children: FakeElement[] = [];
  readonly classList = new FakeClassList();
  readonly dataset: Record<string, string> = {};
  title = "";
  private attrs = new Map<string, string>();

  constructor(
    readonly tagName: string,
    readonly ownerDocument: FakeDocument
  ) {}

  addClass(cls: string): void {
    this.classList.add(cls);
  }

  createSpan(options?: { cls?: string; text?: string }): FakeElement {
    const span = this.ownerDocument.createElement("span");
    if (options?.cls) span.addClass(options.cls);
    if (options?.text) span.setAttribute("text", options.text);
    this.appendChild(span);
    return span;
  }

  appendChild(child: FakeElement): FakeElement {
    this.children.push(child);
    return child;
  }

  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null;
  }

  findChild(tagName: string): FakeElement | undefined {
    return this.children.find((child) => child.tagName === tagName);
  }
}

class FakeDocument {
  createElement(tagName: string): FakeElement {
    return new FakeElement(tagName, this);
  }

  createElementNS(_namespace: string, tagName: string): FakeElement {
    return this.createElement(tagName);
  }
}

function column(type: ColumnDef["type"], key: string = type): ColumnDef {
  return { key, label: key, type };
}

describe("PropertyTypeIcon", () => {
  it("renders every property type as safe SVG nodes", () => {
    const doc = new FakeDocument();
    for (const type of Object.keys(PROPERTY_TYPE_ICON_NAMES) as ColumnDef["type"][]) {
      const parent = doc.createElement("div");
      const icon = renderPropertyTypeIcon(parent as unknown as HTMLElement, column(type));
      const svg = (icon as unknown as FakeElement).findChild("svg");

      expect(icon.getAttribute("data-icon")).toBe(PROPERTY_TYPE_ICON_NAMES[type]);
      expect(svg).toBeDefined();
      expect(svg?.getAttribute("viewBox")).toBe("0 0 24 24");
      expect(svg?.children.some((child) => child.tagName === "path")).toBe(true);
    }
  });

  it("uses the text icon for file.name", () => {
    const doc = new FakeDocument();
    const icon = renderPropertyTypeIcon(doc.createElement("div") as unknown as HTMLElement, column("number", "file.name"));

    expect(icon.getAttribute("data-icon")).toBe(PROPERTY_TYPE_ICON_NAMES.text);
  });
});

describe("computed checkbox cells", () => {
  it("use a CSS class instead of inline pointer-events", () => {
    const source = readFileSync(new URL("../views/CellRenderer.ts", import.meta.url), "utf8");

    expect(source).toContain('checkbox.addClass("db-computed-checkbox-preview")');
    expect(source).not.toContain("checkbox.style.pointerEvents");
  });
});

describe("base import property type icons", () => {
  it("keeps type changes on the local SVG renderer instead of Obsidian setIcon", () => {
    const source = readFileSync(new URL("../views/modals/BaseImportConfirmModal.ts", import.meta.url), "utf8");

    expect(source).toContain("renderPropertyTypeIcon");
    expect(source).not.toContain("setIcon");
  });

  it("explains that file.name is added automatically", () => {
    const source = readFileSync(new URL("../i18n.ts", import.meta.url), "utf8");

    expect(source.match(/"baseImport\.desc": "[^"]*file\.name[^"]*"/g)?.length).toBe(3);
  });
});

describe("column rename migration help", () => {
  it("renders the help marker as an accessible button with an explicit popup action", () => {
    const source = readFileSync(new URL("../views/modals/ColumnRenameModal.ts", import.meta.url), "utf8");

    expect(source).toContain('createEl("button"');
    expect(source).toContain('"aria-label": migrateHelpText');
    expect(source).toContain("new Notice(migrateHelpText");
  });
});
