import { describe, expect, it } from "vitest";
import { parseInlineMarkdown } from "../data/InlineMarkdown";
import type { InlineMarkdownNode } from "../data/InlineMarkdown";

// Pure-logic parser. No DOM. Mirrors the parseTextLink pattern: opt-in, lenient,
// unpaired markers stay literal, and plain text returns null (textContent fast path).

const text = (t: string): InlineMarkdownNode => ({ type: "text", text: t });

describe("parseInlineMarkdown — fast path (null)", () => {
  it.each<[string, unknown]>([
    ["non-string", null],
    ["undefined", undefined],
    ["number", 123],
    ["empty", ""],
    ["whitespace", "   "],
    ["plain text", "hello world"],
    ["slashes are not links", "yes/no"],
    ["isolated asterisk (math)", "5 * 3"],
    ["unpaired bold", "**unclosed"],
    ["escaped markup is plain", "a\\*b"],
  ])("returns null for %s", (_label, input) => {
    expect(parseInlineMarkdown(input)).toBeNull();
  });
});

describe("parseInlineMarkdown — single markers", () => {
  it("bold", () => {
    expect(parseInlineMarkdown("**b**")).toEqual([{ type: "bold", children: [text("b")] }]);
  });
  it("italic with * and _", () => {
    expect(parseInlineMarkdown("*i*")).toEqual([{ type: "italic", children: [text("i")] }]);
    expect(parseInlineMarkdown("_i_")).toEqual([{ type: "italic", children: [text("i")] }]);
  });
  it("strikethrough", () => {
    expect(parseInlineMarkdown("~~s~~")).toEqual([{ type: "strike", children: [text("s")] }]);
  });
  it("highlight", () => {
    expect(parseInlineMarkdown("==h==")).toEqual([{ type: "highlight", children: [text("h")] }]);
  });
  it("inline code (no inner parsing)", () => {
    expect(parseInlineMarkdown("`c`")).toEqual([{ type: "code", text: "c" }]);
    expect(parseInlineMarkdown("`a*b`")).toEqual([{ type: "code", text: "a*b" }]);
  });
  it("inline math (no inner parsing)", () => {
    expect(parseInlineMarkdown("$x^2$")).toEqual([{ type: "math", text: "x^2" }]);
    expect(parseInlineMarkdown("$a*b$")).toEqual([{ type: "math", text: "a*b" }]);
    expect(parseInlineMarkdown("E = $mc^2$ now")).toEqual([
      text("E = "), { type: "math", text: "mc^2" }, text(" now"),
    ]);
  });
  it("currency $ is NOT treated as math", () => {
    // Closing $ preceded by a space ⇒ not math; whole thing is plain ⇒ null.
    expect(parseInlineMarkdown("$5 and $10")).toBeNull();
    expect(parseInlineMarkdown("it costs $5")).toBeNull();
    // Escaped $ stays literal.
    expect(parseInlineMarkdown("price \\$5 only")).toBeNull();
  });
  it("markdown link — internal & external", () => {
    expect(parseInlineMarkdown("[lbl](folder/note)")).toEqual([
      { type: "link", label: [text("lbl")], target: "folder/note", external: false },
    ]);
    expect(parseInlineMarkdown("[g](https://x.io)")).toEqual([
      { type: "link", label: [text("g")], target: "https://x.io", external: true },
    ]);
    expect(parseInlineMarkdown("[g](www.google.com)")).toEqual([
      { type: "link", label: [text("g")], target: "https://www.google.com", external: true },
    ]);
  });
  it("wikilink — with and without label", () => {
    expect(parseInlineMarkdown("[[note]]")).toEqual([{ type: "wikilink", label: "note", target: "note" }]);
    expect(parseInlineMarkdown("[[folder/note|My Label]]")).toEqual([
      { type: "wikilink", label: "My Label", target: "folder/note" },
    ]);
  });
  it("image — markdown & wiki, internal & external, alt fallback", () => {
    expect(parseInlineMarkdown("![alt](cover.png)")).toEqual([
      { type: "image", alt: "alt", target: "cover.png", external: false },
    ]);
    // Empty alt falls back to target (mirrors BoardRenderer.parseImage).
    expect(parseInlineMarkdown("![](cover.png)")).toEqual([
      { type: "image", alt: "cover.png", target: "cover.png", external: false },
    ]);
    expect(parseInlineMarkdown("![alt](https://x.io/a.png)")).toEqual([
      { type: "image", alt: "alt", target: "https://x.io/a.png", external: true },
    ]);
    expect(parseInlineMarkdown("![[photo.jpg]]")).toEqual([
      { type: "image", alt: "photo.jpg", target: "photo.jpg", external: false },
    ]);
    expect(parseInlineMarkdown("![[photo.jpg|封面]]")).toEqual([
      { type: "image", alt: "封面", target: "photo.jpg", external: false },
    ]);
    expect(parseInlineMarkdown("![[https://x.io/a.png]]")).toEqual([
      { type: "image", alt: "https://x.io/a.png", target: "https://x.io/a.png", external: true },
    ]);
    expect(parseInlineMarkdown("see ![alt](x.png) here")).toEqual([
      text("see "), { type: "image", alt: "alt", target: "x.png", external: false }, text(" here"),
    ]);
  });
});

describe("parseInlineMarkdown — nesting", () => {
  it("bold containing italic", () => {
    expect(parseInlineMarkdown("**bold *italic* end**")).toEqual([{
      type: "bold",
      children: [text("bold "), { type: "italic", children: [text("italic")] }, text(" end")],
    }]);
  });
  it("italic containing bold", () => {
    expect(parseInlineMarkdown("*a **b** c*")).toEqual([{
      type: "italic",
      children: [text("a "), { type: "bold", children: [text("b")] }, text(" c")],
    }]);
  });
  it("link label can contain formatting", () => {
    expect(parseInlineMarkdown("[**x**](note)")).toEqual([{
      type: "link",
      label: [{ type: "bold", children: [text("x")] }],
      target: "note",
      external: false,
    }]);
  });
});

describe("parseInlineMarkdown — escapes & unpaired markers", () => {
  it("escaped marker inside a span stays literal", () => {
    expect(parseInlineMarkdown("**a\\*b**")).toEqual([{ type: "bold", children: [text("a*b")] }]);
  });
  it("unpaired asterisk after a span is kept verbatim (not eaten)", () => {
    expect(parseInlineMarkdown("**b** and * loose")).toEqual([
      { type: "bold", children: [text("b")] },
      text(" and * loose"),
    ]);
  });
});

describe("parseInlineMarkdown — newlines", () => {
  it("newline becomes a br node", () => {
    expect(parseInlineMarkdown("a\nb")).toEqual([text("a"), { type: "br" }, text("b")]);
  });
});

describe("parseInlineMarkdown — untrusted input stays as tokens (no HTML execution)", () => {
  it("html inside a span is kept verbatim (renderer escapes via textContent)", () => {
    expect(parseInlineMarkdown("**<b>**")).toEqual([{ type: "bold", children: [text("<b>")] }]);
  });
  it("unsupported URL schemes stay literal instead of becoming clickable links", () => {
    expect(parseInlineMarkdown("[x](javascript:alert(1))")).toBeNull();
    expect(parseInlineMarkdown("before [x](data:text/html,hi) after")).toBeNull();
  });
  it("plain html with no markers returns null (textContent path)", () => {
    expect(parseInlineMarkdown("<script>alert(1)</script>")).toBeNull();
  });
});
