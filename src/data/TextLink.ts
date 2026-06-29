/**
 * Shared link parsing for cell/card values.
 *
 * `parseTextLink` recognizes explicit link syntax (`[label](target)`,
 * `[[wikilink]]` / `[[target|label]]`) plus web URLs (`http(s)://` or a bare
 * domain such as `www.example.com`, normalized to `https://...`). Other bare
 * text returns null, so link-mode renderers fall back to plain text — link
 * rendering is lenient, never blocks input, and never forces a plain value into
 * a (possibly phantom) note link.
 *
 * The old auto-detection heuristic (treating any text containing "/" as a link)
 * caused plain values like "yes/no" or "2024/01/01" to render as clickable note
 * links that created phantom notes/folders on click. Link interpretation is now
 * opt-in via ColumnDef.textRenderMode, and file.* fields have their own explicit
 * rendering in FileFieldRenderer.
 */

export interface ParsedTextLink {
  label: string;
  target: string;
  external: boolean;
}

export interface NormalizedLinkTarget {
  target: string;
  external: boolean;
}

export function isExternalUrl(target: string): boolean {
  return /^https?:\/\//i.test(target);
}

const URL_SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;
const BARE_WEB_URL_RE = /^(?:www\.)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}(?::\d{1,5})?(?:[/?#][^\s]*)?$/i;

/** Return a safe http(s) URL, adding https:// for domain-like bare URLs. */
export function normalizeExternalUrlTarget(target: string): string | null {
  const text = target.trim();
  if (!text || /\s/.test(text)) return null;
  if (isExternalUrl(text)) return text;
  if (URL_SCHEME_RE.test(text)) return null;
  if (!BARE_WEB_URL_RE.test(text)) return null;
  return `https://${text}`;
}

/**
 * Normalize a target from explicit link syntax. http(s) and bare domains become
 * external URLs; unsupported URI schemes are rejected; everything else is an
 * Obsidian internal link target.
 */
export function normalizeExplicitLinkTarget(target: string): NormalizedLinkTarget | null {
  const text = target.trim();
  if (!text) return null;
  const external = normalizeExternalUrlTarget(text);
  if (external) return { target: external, external: true };
  if (URL_SCHEME_RE.test(text)) return null;
  return { target: text, external: false };
}

/** Derive a human label (basename without `.md`, ignoring `#subpath`) from a target. */
export function getLinkLabel(target: string): string {
  const withoutSubpath = target.split("#", 1)[0] || target;
  const basename = withoutSubpath.split("/").filter(Boolean).pop() || target;
  return basename.replace(/\.md$/i, "") || target;
}

/**
 * Parse a value into {label, target, external} when it uses EXPLICIT link
 * syntax: `[label](target)`, `[[wikilink]]` / `[[target|label]]`, or a web URL.
 * Returns null for empty / non-string / bare text without link syntax or a web
 * URL — link-mode renderers then fall back to plain text.
 *
 * Lenient by design: never validates, never blocks input, and never forces a
 * plain value into a (possibly phantom) note link.
 */
export function parseTextLink(value: unknown): ParsedTextLink | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;

  const markdownLink = text.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
  if (markdownLink) {
    const normalized = normalizeExplicitLinkTarget(markdownLink[2]);
    if (normalized) {
      return { label: markdownLink[1].trim() || getLinkLabel(normalized.target), ...normalized };
    }
  }

  const wikiLink = text.match(/^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/);
  if (wikiLink) {
    const target = wikiLink[1].trim();
    if (target) {
      const labelRaw = wikiLink[2]?.trim();
      return { label: labelRaw || getLinkLabel(target), target, external: false };
    }
  }

  const external = normalizeExternalUrlTarget(text);
  if (external) return { label: text, target: external, external: true };
  // Bare text without explicit link syntax is not a link → renderers fall back
  // to plain text. Don't force it into a note link.
  return null;
}
