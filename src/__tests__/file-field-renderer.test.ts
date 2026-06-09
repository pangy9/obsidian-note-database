import { describe, expect, it, vi } from "vitest";
// eslint-disable-next-line import/no-nodejs-modules
import { readFileSync } from "node:fs";
import { renderSpecialFileFieldValue, shouldRenderSpecialFileField } from "../views/FileFieldRenderer";
import { ColumnDef, RowData } from "../data/types";

vi.mock("obsidian", () => ({
  normalizePath: (path: string) => path.replace(/\/+/g, "/"),
  getAllTags: vi.fn(() => []),
}));

class FakeClassList {
  private values = new Set<string>();

  add(...classes: string[]): void {
    for (const cls of classes.flatMap((value) => value.split(/\s+/).filter(Boolean))) this.values.add(cls);
  }

  contains(cls: string): boolean {
    return this.values.has(cls);
  }

  toArray(): string[] {
    return Array.from(this.values);
  }
}

class FakeElement {
  readonly children: FakeElement[] = [];
  readonly classList = new FakeClassList();
  textContent = "";
  title = "";
  href = "";
  onclick?: (event: { preventDefault(): void; stopPropagation(): void }) => void;
  private attrs = new Map<string, string>();

  constructor(readonly tagName: string) {}

  addClass(cls: string): void {
    this.classList.add(cls);
  }

  createDiv(options?: { cls?: string; text?: string }): FakeElement {
    return this.createChild("div", options);
  }

  createSpan(options?: { cls?: string; text?: string }): FakeElement {
    return this.createChild("span", options);
  }

  createEl(tagName: string, options?: { cls?: string; text?: string; attr?: Record<string, string> }): FakeElement {
    return this.createChild(tagName, options);
  }

  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null;
  }

  findByClass(cls: string): FakeElement | undefined {
    if (this.classList.contains(cls)) return this;
    for (const child of this.children) {
      const found = child.findByClass(cls);
      if (found) return found;
    }
    return undefined;
  }

  findAllByClass(cls: string): FakeElement[] {
    return [
      ...(this.classList.contains(cls) ? [this] : []),
      ...this.children.flatMap((child) => child.findAllByClass(cls)),
    ];
  }

  private createChild(tagName: string, options?: { cls?: string; text?: string; attr?: Record<string, string> }): FakeElement {
    const child = new FakeElement(tagName);
    if (options?.cls) child.addClass(options.cls);
    if (options?.text) child.textContent = options.text;
    for (const [key, value] of Object.entries(options?.attr || {})) child.setAttribute(key, value);
    this.children.push(child);
    return child;
  }
}

function col(key: string, type: ColumnDef["type"] = "text"): ColumnDef {
  return { key, label: key, type };
}

function row(): RowData {
  return {
    id: "row",
    file: { path: "Notes/source.md" },
    frontmatter: {},
    computed: {},
  } as unknown as RowData;
}

describe("FileFieldRenderer", () => {
  it("renders file.tags as neutral badges by default and filters invalid tags", () => {
    const parent = new FakeElement("div");

    expect(renderSpecialFileFieldValue(parent as unknown as HTMLElement, undefined, row(), col("file.tags", "multi-select"), ["#a", "123", "b"])).toBe(true);

    const badges = parent.findAllByClass("db-file-tag-badge");
    expect(parent.findByClass("db-file-tags")).toBeDefined();
    expect(badges.map((badge) => badge.textContent)).toEqual(["a", "b"]);
    expect(badges.flatMap((badge) => badge.classList.toArray()).some((cls) => cls.startsWith("status-color-"))).toBe(false);
  });

  it("uses manually configured file.tags colors without coloring every tag", () => {
    const parent = new FakeElement("div");
    const tagsCol = col("file.tags", "multi-select");
    tagsCol.statusOptions = [{ value: "a", color: "blue" }];

    renderSpecialFileFieldValue(parent as unknown as HTMLElement, undefined, row(), tagsCol, ["#a", "b"]);

    const badges = parent.findAllByClass("db-file-tag-badge");
    expect(badges.map((badge) => badge.textContent)).toEqual(["a", "b"]);
    expect(badges[0].classList.contains("status-color-blue")).toBe(true);
    expect(badges[1].classList.toArray().some((cls) => cls.startsWith("status-color-"))).toBe(false);
  });

  it("renders file link fields as clickable internal links", () => {
    const openLinkText = vi.fn();
    const parent = new FakeElement("div");
    const app = { workspace: { openLinkText } };

    expect(renderSpecialFileFieldValue(parent as unknown as HTMLElement, app as never, row(), col("file.links"), ["[[Target|Label]]"])).toBe(true);

    const link = parent.findByClass("db-file-link-list-item");
    expect(link?.tagName).toBe("a");
    expect(link?.classList.contains("internal-link")).toBe(true);
    expect(link?.textContent).toBe("Label");

    link?.onclick?.({ preventDefault: vi.fn(), stopPropagation: vi.fn() });
    expect(openLinkText).toHaveBeenCalledWith("Target", "Notes/source.md", false);
  });

  it("accepts renderer context classes so cards keep their existing alignment", () => {
    const parent = new FakeElement("div");

    renderSpecialFileFieldValue(parent as unknown as HTMLElement, undefined, row(), col("file.tags", "multi-select"), ["#alpha"], {
      tagsContainerClass: "db-board-card-badges",
      linkContainerClass: "db-board-card-links",
      linkItemClass: "db-board-card-link",
    });

    expect(parent.findByClass("db-board-card-badges")).toBeDefined();
    expect(parent.findByClass("db-file-tags")).toBeUndefined();
  });

  it("leaves ordinary fields to their existing renderers", () => {
    expect(shouldRenderSpecialFileField(col("tags", "multi-select"))).toBe(false);
  });

  it("is used by table and card field renderers before generic option rendering", () => {
    for (const file of ["CellRenderer.ts", "BoardRenderer.ts", "GalleryRenderer.ts", "ListRenderer.ts"]) {
      const source = readFileSync(new URL(`../views/${file}`, import.meta.url), "utf8");

      expect(source).toContain("renderSpecialFileFieldValue");
      expect(source).toContain("shouldRenderSpecialFileField");
    }
  });
});
