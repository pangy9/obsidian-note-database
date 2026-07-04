import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isExternalUrl, normalizeExternalUrlTarget, parseTextLink } from "../data/TextLink";

// Text values are no longer auto-linkified. A text column renders links only
// when its textRenderMode === "link" (explicit opt-in), and file.* identity
// fields (file.file/path/basename) render as a link to the row's own file.
// The old `text.includes("/")` / `.md` heuristic — which turned plain values
// like "yes/no" into phantom note/folder links — is gone.

describe("parseTextLink (link-mode text values)", () => {
  it("returns null for empty / non-string", () => {
    expect(parseTextLink(null)).toBeNull();
    expect(parseTextLink("")).toBeNull();
    expect(parseTextLink("   ")).toBeNull();
  });

  it("parses markdown links", () => {
    expect(parseTextLink("[Label](folder/note)")).toEqual({ label: "Label", target: "folder/note", external: false });
    expect(parseTextLink("[Google](https://example.io)")).toEqual({ label: "Google", target: "https://example.io", external: true });
    expect(parseTextLink("[Google](www.google.com)")).toEqual({ label: "Google", target: "https://www.google.com", external: true });
  });

  it("parses wikilinks, deriving label from basename", () => {
    expect(parseTextLink("[[folder/note]]")).toEqual({ label: "note", target: "folder/note", external: false });
    expect(parseTextLink("[[folder/note|My Label]]")).toEqual({ label: "My Label", target: "folder/note", external: false });
  });

  it("treats http(s) as external", () => {
    const link = parseTextLink("https://example.com");
    expect(link).toEqual({ label: "https://example.com", target: "https://example.com", external: true });
    expect(isExternalUrl("https://x.io")).toBe(true);
    expect(isExternalUrl("folder/note")).toBe(false);
  });

  it("normalizes bare web URLs to https external links", () => {
    expect(parseTextLink("www.google.com")).toEqual({ label: "www.google.com", target: "https://www.google.com", external: true });
    expect(parseTextLink("google.com/path?q=1#top")).toEqual({ label: "google.com/path?q=1#top", target: "https://google.com/path?q=1#top", external: true });
    expect(normalizeExternalUrlTarget("www.google.com")).toBe("https://www.google.com");
  });

  it("rejects unsupported URL schemes instead of opening them as notes", () => {
    expect(parseTextLink("[x](javascript:alert(1))")).toBeNull();
    expect(parseTextLink("[x](data:text/html,hi)")).toBeNull();
    expect(parseTextLink("javascript:alert(1)")).toBeNull();
  });

  it("returns null for bare text without link syntax (lenient: falls back to plain text)", () => {
    // Link mode renders a link only for explicit link syntax. Bare values are
    // NOT forced into a (possibly phantom) note link, and input is never blocked.
    expect(parseTextLink("yes/no")).toBeNull();
    expect(parseTextLink("2024/01/01")).toBeNull();
    expect(parseTextLink("plainword")).toBeNull();
    expect(parseTextLink("hello world")).toBeNull();
  });
});

describe("text render mode wiring", () => {
  const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), "utf8");
  const cards = ["../views/BoardRenderer.ts", "../views/GalleryRenderer.ts", "../views/ListRenderer.ts"];

  it("card views gate link rendering on textRenderMode and use the shared helper", () => {
    for (const file of cards) {
      const src = read(file);
      expect(src, file).toContain('col.textRenderMode === "link"');
      expect(src, file).toContain("parseTextLink");
      // The buggy auto-detection heuristic and its duplicated parser are gone.
      expect(src, file).not.toContain("isLikelyLocalTarget");
      expect(src, file).not.toContain("this.parseLink");
      expect(src, file).not.toContain('text.includes("/")');
    }
  });

  it("file.* identity fields render as a link via FileFieldRenderer", () => {
    const src = read("../views/FileFieldRenderer.ts");
    expect(src).toContain("isFileSelfLinkField");
    expect(src).toContain("renderFileSelfLink");
    expect(read("../data/FileFields.ts")).toContain("isFileSelfLinkField");
  });

  it("column menu offers a display-style submenu for text columns", () => {
    const src = read("../views/ColumnMenu.ts");
    const styles = read("../../styles.css");
    expect(src).toContain("setTextRenderMode");
    expect(src).toContain("showTextRenderModePopover");
    expect(src).toContain('col.type === "text" && !isFileFieldKey(col.key)');
    expect(src).toContain("appendItemHint");
    expect(src).toContain("db-column-display-style-popover db-column-text-style-popover");
    expect(src).toContain("createDisplayOptionSection");
    expect(src).toContain("db-displayopt-row");
    expect(styles).toContain(".db-column-display-style-popover.db-column-menu-subpopover");
    expect(styles).not.toContain(".db-column-text-style-popover .db-numopt");
  });

  it("table view honors link mode via renderTextLink (click-open + dblclick-edit coexistence)", () => {
    const src = read("../views/CellRenderer.ts");
    expect(src).toContain('col.textRenderMode === "link"');
    expect(src).toContain("renderTextLink");
    expect(src).toContain("parseTextLink");
    // Single-click open is delayed/cancellable so dblclick (inline edit) wins.
    expect(src).toContain("event.detail > 1");
  });

  it("card views render markdown mode via the shared helper", () => {
    for (const file of cards) {
      const src = read(file);
      expect(src, file).toContain('col.textRenderMode === "markdown"');
      expect(src, file).toContain("renderInlineMarkdown");
      expect(src, file).toContain("parseInlineMarkdown");
      // Tooltip reads the raw value, not textContent (which would strip markers).
      expect(src, file).toContain("valueToTooltip");
    }
  });

  it("card/list title fields stay plain text even when markdown mode exists for field values", () => {
    expect(read("../views/BoardRenderer.ts")).toContain("resolveTitleFieldDisplay");
    expect(read("../views/BoardRenderer.ts")).toContain("titleEl.textContent = title.text");
    expect(read("../views/GalleryRenderer.ts")).toContain("resolveTitleFieldDisplay");
    expect(read("../views/GalleryRenderer.ts")).toContain("titleEl.textContent = title.text");
    expect(read("../views/ListRenderer.ts")).toContain("resolveTitleFieldDisplay");
    expect(read("../views/ListRenderer.ts")).toContain("title.textContent = titleDisplay.text");
    expect(read("../views/BoardRenderer.ts")).toContain("is-empty-title");
    expect(read("../views/GalleryRenderer.ts")).toContain("is-empty-title");
    expect(read("../views/ListRenderer.ts")).toContain("is-empty-title");
  });

  it("table view renders markdown mode via parseInlineMarkdown + renderInlineMarkdown", () => {
    const src = read("../views/CellRenderer.ts");
    expect(src).toContain('col.textRenderMode === "markdown"');
    expect(src).toContain("parseInlineMarkdown");
    expect(src).toContain("renderInlineMarkdown");
    // Table uses the delayed-click strategy so link open + dblclick-edit coexist.
    expect(src).toContain('linkClickStrategy: "table"');
  });

  it("markdown renderer never uses innerHTML (XSS defense via textContent)", () => {
    expect(read("../views/InlineMarkdownRenderer.ts")).not.toContain(".innerHTML");
  });

  it("markdown mode shows a format toolbar in the cell editor", () => {
    const src = read("../views/CellRenderer.ts");
    expect(src).toContain("buildMarkdownToolbar");
    expect(src).toContain("db-md-toolbar");
    expect(src).toContain("wrapSelection");
    // Toolbar only for markdown-mode, non-file columns.
    expect(src).toContain('col.textRenderMode === "markdown" && !isFileFieldKey(col.key)');
    // Pasting a web URL over a selection wraps it into a normalized [text](url) link.
    expect(src).toContain("attachPasteUrlAsLink");
    expect(src).toContain("normalizeExternalUrlTarget");
  });

  it("inline math renders via Obsidian renderMath (appendChild, not innerHTML)", () => {
    const src = read("../views/InlineMarkdownRenderer.ts");
    expect(src).toContain("renderMath");
    expect(src).toContain("finishRenderMath");
    expect(src).toContain("appendChild(renderMath(");
  });

  it("column menu offers markdown as a third text render option", () => {
    const src = read("../views/ColumnMenu.ts");
    expect(src).toContain('value: "markdown"');
    expect(src).toContain("menu.textRenderMarkdown");
    expect(src).toContain('col.textRenderMode ?? "plain"');
    // All three locales declare the key.
    const i18n = read("../i18n.ts");
    const matches = i18n.match(/"menu\.textRenderMarkdown":/g) || [];
    expect(matches.length).toBe(3); // en + zh-CN + zh-TW
  });
});
