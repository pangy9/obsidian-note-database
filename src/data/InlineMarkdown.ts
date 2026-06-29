/**
 * Lightweight inline-markdown parser for text cell/card values.
 *
 * Pure logic — no DOM, no Obsidian, no external markdown library. Mirrors the
 * pattern of `parseTextLink` (src/data/TextLink.ts): opt-in, lenient, string
 * in → token tree out.
 *
 * Supports inline markers only (no block syntax): **bold**, *italic* / _italic_,
 * ~~strike~~, ==highlight==, `code`, [label](target), [[wikilink]] / [[t|l]].
 * Nested emphasis is handled by recursive descent. Unpaired markers are kept
 * verbatim — `5 * 3` stays `5 * 3`; the parser never eats user characters.
 *
 * `parseInlineMarkdown` returns null when the value has no structured markup,
 * so renderers keep their zero-cost textContent fast path for plain values.
 *
 * The renderer (src/views/InlineMarkdownRenderer.ts) builds DOM from the token
 * tree via createEl/textContent — never innerHTML — so HTML in user content is
 * escaped by the browser and cannot execute (XSS-safe by construction).
 */

import { getLinkLabel, normalizeExplicitLinkTarget } from "./TextLink";

export type InlineMarkdownNode =
  | { type: "text"; text: string }
  | { type: "bold"; children: InlineMarkdownNode[] }
  | { type: "italic"; children: InlineMarkdownNode[] }
  | { type: "strike"; children: InlineMarkdownNode[] }
  | { type: "highlight"; children: InlineMarkdownNode[] }
  | { type: "code"; text: string }
  | { type: "math"; text: string }
  | { type: "link"; label: InlineMarkdownNode[]; target: string; external: boolean }
  | { type: "wikilink"; label: string; target: string }
  | { type: "br" };

/** Characters that may begin a marker. Absence of all of them ⇒ plain text. */
const MARKER_CHARS = new Set(["*", "_", "~", "`", "[", "=", "$", "\\", "\n"]);

function isSpaceChar(ch: string | undefined): boolean {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r";
}

/** ASCII punctuation that a backslash can escape. */
function isMarkdownPunct(ch: string | undefined): boolean {
  return !!ch && "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~".includes(ch);
}

/** Index of `needle` in `s` from `from`, but only if it fits before `end` (exclusive). */
function indexOfWithin(s: string, needle: string, from: number, end: number): number {
  const idx = s.indexOf(needle, from);
  return idx !== -1 && idx + needle.length <= end ? idx : -1;
}

/** Next single `ch` that is NOT part of a `ch`+`ch` pair (so `*` italics skip `**`). */
function indexOfSingle(s: string, ch: string, from: number, end: number): number {
  let i = from;
  while (i < end) {
    if (s[i] === ch) {
      if (s[i + 1] === ch) { i += 2; continue; } // skip the ** / __ pair
      return i;
    }
    i += 1;
  }
  return -1;
}

class InlineParser {
  constructor(private readonly s: string) {}

  /** Parse the whole string into nodes, or null if it has no structured markup. */
  parse(): InlineMarkdownNode[] | null {
    if (!this.hasMarker()) return null;
    const nodes = this.parseRange(0, this.s.length);
    // Plain text (incl. isolated markers that fell back to literals) ⇒ null fast path.
    return nodes.some((n) => n.type !== "text") ? nodes : null;
  }

  private hasMarker(): boolean {
    for (const ch of this.s) if (MARKER_CHARS.has(ch)) return true;
    return false;
  }

  /** Parse s[start:end) into nodes. */
  private parseRange(start: number, end: number): InlineMarkdownNode[] {
    const s = this.s;
    const nodes: InlineMarkdownNode[] = [];
    let textBuf = "";
    let pos = start;
    const flush = (): void => {
      if (textBuf) { nodes.push({ type: "text", text: textBuf }); textBuf = ""; }
    };

    while (pos < end) {
      const c = s[pos];

      // Escape: backslash + ASCII punctuation → literal char.
      if (c === "\\") {
        const next = s[pos + 1];
        if (isMarkdownPunct(next)) { textBuf += next; pos += 2; continue; }
        textBuf += "\\"; pos += 1; continue;
      }

      // Newline → <br>.
      if (c === "\n") { flush(); nodes.push({ type: "br" }); pos += 1; continue; }

      // Inline code (no inner parsing).
      if (c === "`") {
        const close = indexOfWithin(s, "`", pos + 1, end);
        if (close !== -1) {
          flush();
          nodes.push({ type: "code", text: s.slice(pos + 1, close) });
          pos = close + 1;
          continue;
        }
      }

      // Inline LaTeX math $...$ (no inner parsing). Currency-safe: the opening
      // `$` must be followed by a non-space and the closing `$` preceded by a
      // non-space, so `$5 and $10` is NOT treated as math. Escape with `\$`.
      if (c === "$" && !isSpaceChar(s[pos + 1])) {
        let mathClose = -1;
        let j = pos + 1;
        while (j < end) {
          if (s[j] === "$" && !isSpaceChar(s[j - 1])) { mathClose = j; break; }
          j += 1;
        }
        if (mathClose !== -1 && mathClose > pos + 1) {
          flush();
          nodes.push({ type: "math", text: s.slice(pos + 1, mathClose) });
          pos = mathClose + 1;
          continue;
        }
      }

      // Wikilink [[target]] / [[target|label]].
      if (c === "[" && s[pos + 1] === "[") {
        const close = indexOfWithin(s, "]]", pos + 2, end);
        if (close !== -1) {
          const inner = s.slice(pos + 2, close);
          const pipe = inner.indexOf("|");
          const target = (pipe === -1 ? inner : inner.slice(0, pipe)).trim();
          if (target) {
            const labelRaw = pipe === -1 ? "" : inner.slice(pipe + 1).trim();
            flush();
            nodes.push({ type: "wikilink", label: labelRaw || getLinkLabel(target), target });
            pos = close + 2;
            continue;
          }
        }
      }

      // Bold ** / __.
      if ((c === "*" || c === "_") && s[pos + 1] === c) {
        const mark = c + c;
        const close = indexOfWithin(s, mark, pos + 2, end);
        if (close !== -1) {
          flush();
          nodes.push({ type: "bold", children: this.parseRange(pos + 2, close) });
          pos = close + 2;
          continue;
        }
        // No closing pair: treat both chars as literal and skip past them, so
        // the trailing marker is NOT reused as an italic open/close (`**x` must
        // stay literal, not become an empty italic span).
        textBuf += mark;
        pos += 2;
        continue;
      }

      // Italic * / _ (single; skips ** / __ pairs).
      if (c === "*" || c === "_") {
        const close = indexOfSingle(s, c, pos + 1, end);
        if (close !== -1) {
          flush();
          nodes.push({ type: "italic", children: this.parseRange(pos + 1, close) });
          pos = close + 1;
          continue;
        }
      }

      // Strikethrough ~~.
      if (c === "~" && s[pos + 1] === "~") {
        const close = indexOfWithin(s, "~~", pos + 2, end);
        if (close !== -1) {
          flush();
          nodes.push({ type: "strike", children: this.parseRange(pos + 2, close) });
          pos = close + 2;
          continue;
        }
      }

      // Highlight ==.
      if (c === "=" && s[pos + 1] === "=") {
        const close = indexOfWithin(s, "==", pos + 2, end);
        if (close !== -1) {
          flush();
          nodes.push({ type: "highlight", children: this.parseRange(pos + 2, close) });
          pos = close + 2;
          continue;
        }
      }

      // Markdown link [label](target).
      if (c === "[") {
        const link = this.matchLink(pos, end);
        if (link) {
          flush();
          nodes.push({
            type: "link",
            label: this.parseRange(link.labelStart, link.labelEnd),
            target: link.target.target,
            external: link.target.external,
          });
          pos = link.closeEnd;
          continue;
        }
      }

      // Default: literal char.
      textBuf += c;
      pos += 1;
    }

    flush();
    return nodes;
  }

  /** Try to match `[label](target)` at `pos`. Returns spans or null. */
  private matchLink(pos: number, end: number): {
    labelStart: number; labelEnd: number; target: { target: string; external: boolean }; closeEnd: number;
  } | null {
    const s = this.s;
    const labelEnd = indexOfWithin(s, "]", pos + 1, end);
    if (labelEnd === -1 || s[labelEnd + 1] !== "(") return null;
    // Scan the target with balanced parens so a nested () inside the target
    // (e.g. `[x](https://en.wikipedia.org/wiki/Foo_(bar))`) does not close early.
    let depth = 1;
    let i = labelEnd + 2;
    while (i < end) {
      const ch = s[i];
      if (ch === "(") depth += 1;
      else if (ch === ")") {
        depth -= 1;
        if (depth === 0) break;
      }
      i += 1;
    }
    if (depth !== 0) return null;
    const parenClose = i;
    const target = normalizeExplicitLinkTarget(s.slice(labelEnd + 2, parenClose));
    if (!target) return null;
    return { labelStart: pos + 1, labelEnd, target, closeEnd: parenClose + 1 };
  }
}

/**
 * Parse a cell/card value into an inline-markdown token tree.
 *
 * Returns null for non-string / empty / plain text without any structured
 * markup, so renderers fall back to their textContent fast path. A non-null
 * result always contains at least one markup node (bold/italic/strike/highlight/
 * code/link/wikilink/br).
 */
export function parseInlineMarkdown(value: unknown): InlineMarkdownNode[] | null {
  if (typeof value !== "string") return null;
  if (!value || !value.trim()) return null;
  return new InlineParser(value).parse();
}
