import { getSearchHighlightTerms } from "../data/Search";

/** Walk text nodes in `root`, wrapping case-insensitive matches of `query` in
 *  <mark class="db-search-highlight">.
 *
 *  **Allowlist approach**: only highlight text inside result-area containers
 *  (table, board, gallery, list, calendar, timeline). Everything outside —
 *  toolbar, header, description, summary, nav buttons, "today" indicators,
 *  scale buttons, empty states, settings panels — is automatically excluded.
 *
 *  Within result containers, a small denylist skips structural elements
 *  (column headers, group titles, timeline axis/ticks, calendar header rows). */

/** Result containers that hold record data across all view types. */
const SEARCHABLE_CONTAINERS =
  ".db-table, .db-grouped-table, .db-board, .db-gallery, .db-gallery-grouped, " +
  ".db-list, .db-list-grouped, .db-calendar, .db-timeline";

/** Structural (non-data) text-bearing elements that live INSIDE result containers.
 *  Using broad container selectors (e.g. `.db-calendar-header`, `.db-timeline-axis`)
 *  to cover all descendants — `closest()` matches for nested children too. */
const NON_DATA_WITHIN_RESULTS = [
  // Cross-view: table/board headers, group titles, board subgroup headers, empty states
  "th", ".db-group-header", ".db-board-column-header",
  ".db-board-subgroup-header", ".db-empty",
  // Calendar: toolbar (title/scale/nav/add), sticky header row, weekday headers,
  // day numbers, hour labels, overflow counts, mini-calendar popover
  ".db-calendar-header", ".db-calendar-week-sticky", ".db-calendar-time-header-row",
  ".db-calendar-weekdays", ".db-calendar-day-heading", ".db-calendar-day-number",
  ".db-calendar-week-hour-label", ".db-calendar-week-allday-empty",
  ".db-calendar-week-allday-more", ".db-calendar-more-events",
  ".db-calendar-mini-popover",
  // Timeline: axis (ticks/bands/labels), group headers+tags, create row,
  // toolbar (title/scale/nav), mini-calendar popover, empty state, mobile menu
  ".db-timeline-axis", ".db-timeline-group-header", ".db-timeline-group-tag",
  ".db-timeline-create-row", ".db-timeline-header",
  ".db-timeline-mini-popover", ".db-timeline-empty-range",
  ".db-timeline-mobile-menu-button",
].join(", ");

export function highlightSearchMatches(root: HTMLElement, query: string): void {
  const terms = getSearchHighlightTerms(query);
  if (terms.length === 0) return;
  const lowerTerms = terms.map((term) => term.toLowerCase());
  const doc = root.ownerDocument || window.activeDocument;

  // Collect result containers — only these hold searchable cell/card text.
  const containers = root.querySelectorAll<HTMLElement>(SEARCHABLE_CONTAINERS);
  if (containers.length === 0) return;

  const targets: Text[] = [];
  for (const container of containers) {
    const walker = doc.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
      acceptNode(node: Text) {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        if (parent.closest(".db-search-highlight")) return NodeFilter.FILTER_REJECT;
        if (parent.closest(NON_DATA_WITHIN_RESULTS)) return NodeFilter.FILTER_REJECT;
        const lowerText = node.textContent?.toLowerCase() || "";
        return lowerTerms.some((term) => lowerText.includes(term))
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT;
      },
    });
    let current = walker.nextNode();
    while (current) {
      targets.push(current as Text);
      current = walker.nextNode();
    }
  }

  for (const textNode of targets) {
    const text = textNode.textContent || "";
    const lower = text.toLowerCase();
    let lastEnd = 0;
    let match = findNextSearchHighlightMatch(lower, lowerTerms, lastEnd);
    if (!match) continue;
    const frag = doc.createDocumentFragment();
    while (match) {
      if (match.index > lastEnd) frag.appendChild(doc.createTextNode(text.slice(lastEnd, match.index)));
      const mark = doc.createElement("mark");
      mark.className = "db-search-highlight";
      mark.textContent = text.slice(match.index, match.index + match.length);
      frag.appendChild(mark);
      lastEnd = match.index + match.length;
      match = findNextSearchHighlightMatch(lower, lowerTerms, lastEnd);
    }
    if (lastEnd < text.length) frag.appendChild(doc.createTextNode(text.slice(lastEnd)));
    textNode.parentNode?.replaceChild(frag, textNode);
  }
}

function findNextSearchHighlightMatch(
  lowerText: string,
  lowerTerms: string[],
  fromIndex: number,
): { index: number; length: number } | null {
  let best: { index: number; length: number } | null = null;
  for (const term of lowerTerms) {
    if (!term) continue;
    const index = lowerText.indexOf(term, fromIndex);
    if (index === -1) continue;
    if (!best || index < best.index || (index === best.index && term.length > best.length)) {
      best = { index, length: term.length };
    }
  }
  return best;
}
