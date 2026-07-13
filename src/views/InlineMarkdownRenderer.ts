/**
 * DOM renderer for the inline-markdown token tree (src/data/InlineMarkdown.ts).
 *
 * Builds DOM with createEl / appendText — NEVER innerHTML — so HTML in user
 * content is escaped by the browser and cannot execute. This keeps the repo's
 * "zero innerHTML" XSS defense intact.
 *
 * Link clicks reuse the coexistence pattern from `CellRenderer.renderTextLink`:
 *  - table cells single-click = select, double-click = edit, so a link opens on
 *    a 280ms delay that the second click of a dblclick cancels (delayed strategy);
 *  - board/gallery/list cards single-click = edit, so a link stopPropagation's
 *    the click and opens immediately (card strategy).
 */

import { App, finishRenderMath, renderMath, TFile } from "obsidian";
import { parseInlineMarkdown, type InlineMarkdownNode } from "../data/InlineMarkdown";
import type { RowData } from "../data/types";
import { parseTextLink } from "../data/TextLink";

export type LinkClickStrategy = "table" | "card";

export interface RenderInlineMarkdownOptions {
  /** Open a parsed link target. external=true → URL; otherwise internal note. */
  onOpenLink: (target: string, external: boolean) => void;
  /** Resolve an internal image target to a displayable src (e.g. vault resource path).
   *  External targets are used as-is; if omitted, the raw target is used as src. */
  onResolveImage?: (target: string, external: boolean) => string | null;
  /** CSS class prefix for markup elements. Default "db-text". */
  baseClass?: string;
  /** How anchor clicks coexist with the host interaction. Default "card". */
  linkClickStrategy?: LinkClickStrategy;
}

export interface RenderedTextWidthMeasurer {
  measure(raw: string, mode: "markdown" | "link"): number | null;
  dispose(): void;
}

/**
 * Create one hidden real table cell for an auto-fit pass. Reusing the visible
 * renderer and CSS makes width measurement include bold/italic/code styling,
 * Obsidian link decoration and MathJax's actual layout.
 */
export function createRenderedTextWidthMeasurer(): RenderedTextWidthMeasurer | null {
  if (typeof window === "undefined" || !window.activeDocument?.body) return null;
  const doc = window.activeDocument;
  const host = doc.createElement("div");
  const table = doc.createElement("table");
  const tbody = doc.createElement("tbody");
  const tr = doc.createElement("tr");
  const td = doc.createElement("td");
  if (typeof td.createEl !== "function" || typeof td.empty !== "function") return null;

  host.className = "note-database-container db-column-width-measure";
  table.className = "db-table db-column-width-measure-table";
  td.className = "db-column-width-measure-cell";

  tr.appendChild(td);
  tbody.appendChild(tr);
  table.appendChild(tbody);
  host.appendChild(table);
  doc.body.appendChild(host);

  const cache = new Map<string, number | null>();
  return {
    measure(raw: string, mode: "markdown" | "link"): number | null {
      const cacheKey = `${mode}\u0000${raw}`;
      if (cache.has(cacheKey)) return cache.get(cacheKey) ?? null;
      if (mode === "markdown") {
        const nodes = parseInlineMarkdown(raw);
        if (!nodes) {
          cache.set(cacheKey, null);
          return null;
        }
        // Measuring must not trigger image fetches. Images use the pure fallback
        // estimator; surrounding text is still accounted for there.
        if (containsNodeType(nodes, "image")) {
          cache.set(cacheKey, null);
          return null;
        }
        renderInlineMarkdown(td, nodes, { onOpenLink: () => undefined, linkClickStrategy: "table" });
        // renderMath falls back to raw `$...$` while MathJax is unavailable.
        // Never treat that TeX source as the rendered formula width.
        if (containsNodeType(nodes, "math")) {
          const mathElements = Array.from(td.querySelectorAll<HTMLElement>(".db-text-md-math"));
          if (mathElements.some((element) => !element.querySelector("mjx-container"))) {
            cache.set(cacheKey, null);
            return null;
          }
        }
      } else {
        const link = parseTextLink(raw);
        if (!link) {
          cache.set(cacheKey, null);
          return null;
        }
        td.empty();
        td.createEl("a", {
          cls: `db-text-link ${link.external ? "external-link" : "internal-link"}`,
          text: link.label,
          attr: { href: link.external ? link.target : "#" },
        });
      }
      const width = Math.max(td.scrollWidth, td.getBoundingClientRect().width);
      const measured = Number.isFinite(width) && width > 0 ? Math.ceil(width + 2) : null;
      cache.set(cacheKey, measured);
      return measured;
    },
    dispose(): void {
      host.remove();
    },
  };
}

function containsNodeType(nodes: InlineMarkdownNode[], type: InlineMarkdownNode["type"]): boolean {
  return nodes.some((node) => {
    if (node.type === type) return true;
    if ("children" in node) return containsNodeType(node.children, type);
    if (node.type === "link") return containsNodeType(node.label, type);
    return false;
  });
}

/** Render an inline-markdown token tree into `parent`. Clears `parent` first. */
export function renderInlineMarkdown(
  parent: HTMLElement,
  nodes: InlineMarkdownNode[],
  options: RenderInlineMarkdownOptions,
): void {
  parent.empty();
  const baseClass = options.baseClass ?? "db-text";
  const strategy = options.linkClickStrategy ?? "card";
  for (const node of nodes) appendNode(parent, node, options, baseClass, strategy);
  // MathJax requires a single flush after all renderMath() calls in a batch.
  // Guard: finishRenderMath throws if MathJax isn't loaded yet (see math case).
  if (containsMath(nodes)) { try { void finishRenderMath(); } catch { /* not loaded yet */ } }
}

/** True if any node (recursively) is an inline math span. */
function containsMath(nodes: InlineMarkdownNode[]): boolean {
  return nodes.some((n) => {
    if (n.type === "math") return true;
    if ("children" in n) return containsMath(n.children);
    if (n.type === "link") return containsMath(n.label);
    return false;
  });
}

function appendNode(
  parent: HTMLElement,
  node: InlineMarkdownNode,
  options: RenderInlineMarkdownOptions,
  baseClass: string,
  strategy: LinkClickStrategy,
): void {
  switch (node.type) {
    case "text":
      parent.appendText(node.text);
      break;
    case "br":
      parent.createEl("br");
      break;
    case "code":
      parent.createEl("code", { text: node.text, cls: `${baseClass}-md-code` });
      break;
    case "math": {
      // Obsidian MathJax. renderMath returns an element we append (no innerHTML);
      // finishRenderMath() is flushed once by the caller after the batch.
      // If MathJax has not finished loading yet (loadMathJax is async, kicked off
      // in main onload), renderMath throws — fall back to the raw `$...$` source
      // so the cell still renders instead of breaking the whole row.
      const mathEl = parent.createSpan({ cls: `${baseClass}-md-math` });
      try {
        mathEl.appendChild(renderMath(node.text, false));
      } catch {
        mathEl.setText(`$${node.text}$`);
      }
      break;
    }
    case "bold": {
      const el = parent.createEl("strong");
      for (const child of node.children) appendNode(el, child, options, baseClass, strategy);
      break;
    }
    case "italic": {
      const el = parent.createEl("em");
      for (const child of node.children) appendNode(el, child, options, baseClass, strategy);
      break;
    }
    case "strike": {
      const el = parent.createEl("del");
      for (const child of node.children) appendNode(el, child, options, baseClass, strategy);
      break;
    }
    case "highlight": {
      // Distinct class — must NOT reuse .db-search-highlight (SearchHighlight walker).
      const el = parent.createEl("mark", { cls: `${baseClass}-md-highlight` });
      for (const child of node.children) appendNode(el, child, options, baseClass, strategy);
      break;
    }
    case "image": {
      const src = node.external
        ? node.target
        : (options.onResolveImage?.(node.target, node.external) ?? node.target);
      const img = parent.createEl("img", {
        cls: `${baseClass}-md-image`,
        attr: { src, alt: node.alt, title: node.alt },
      });
      attachAnchorClick(img, () => options.onOpenLink(node.target, node.external), strategy);
      break;
    }
    case "link": {
      const anchor = parent.createEl("a", {
        cls: `${baseClass}-md-link ${node.external ? "external-link" : "internal-link"}`,
        attr: { href: node.external ? node.target : "#", title: node.target },
      });
      for (const child of node.label) appendNode(anchor, child, options, baseClass, strategy);
      attachAnchorClick(anchor, () => options.onOpenLink(node.target, node.external), strategy);
      break;
    }
    case "wikilink": {
      const anchor = parent.createEl("a", {
        cls: `${baseClass}-md-link internal-link`,
        text: node.label,
        attr: { href: "#", title: node.target },
      });
      attachAnchorClick(anchor, () => options.onOpenLink(node.target, false), strategy);
      break;
    }
  }
}

/** Bind the coexistence-aware click handler to a link anchor. */
function attachAnchorClick(anchor: HTMLElement, open: () => void, strategy: LinkClickStrategy): void {
  let timer: number | undefined;
  anchor.addEventListener("click", (event: MouseEvent) => {
    event.preventDefault();
    if (strategy === "table") {
      // Second click of a double-click cancels the pending open so the dblclick
      // (inline edit) wins — mirrors CellRenderer.renderTextLink.
      if (event.detail > 1) {
        if (timer !== undefined) { window.clearTimeout(timer); timer = undefined; }
        return;
      }
      timer = window.setTimeout(() => {
        timer = undefined;
        open();
      }, 280);
    } else {
      // Card: stop the click from bubbling to the card's click-to-edit handler.
      event.stopPropagation();
      open();
    }
  });
}

/** Resolve an inline image target to a displayable src.
 *  External targets are returned as-is; internal targets resolve via the vault
 *  (metadataCache.getFirstLinkpathDest + getResourcePath). Returns null if unresolved. */
export function resolveInlineImageSrc(app: App, row: RowData, target: string, external: boolean): string | null {
  if (external) return target;
  const file = app.metadataCache.getFirstLinkpathDest(target, row.file.path);
  return file instanceof TFile ? app.vault.getResourcePath(file) : null;
}

/** Render a raw cell value (string or string[]) as a tooltip string, preserving
 *  the original markdown source (renderer must not read textContent, which would
 *  strip marker characters after markdown rendering). */
export function valueToTooltip(value: unknown): string {
  return Array.isArray(value) ? value.map((v) => String(v)).join(", ") : String(value);
}
