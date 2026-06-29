import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Regression contract: search is TRANSIENT. It must never be written to the
// database file's config/frontmatter — not in the main view, not in embedded
// code blocks. Search is an in-session quick filter; the persisted "view" is
// filters / sort / group / hidden-columns. Persisting search caused a drift
// bug: navigating away and back either lost the search or reverted to a stale
// older query, because ViewStateStore recreated state from config on rebuild
// while search only ever lived in memory.
//
// See VIEW_REGRESSION_MATRIX.md ("搜索/筛选/排序" row) and the unit-level
// contract in view-state-store.test.ts ("does not persist searchText").
describe("search text stays transient", () => {
  const databaseViewSource = readFileSync(new URL("../views/DatabaseView.ts", import.meta.url), "utf8");
  const embeddedSource = readFileSync(new URL("../views/EmbeddedDatabaseRenderer.ts", import.meta.url), "utf8");

  const extractHandler = (source: string): string => {
    const match = source.match(/setSearchText: \(value\) => \{[\s\S]*?\n      \},/);
    expect(match, "setSearchText handler must exist").not.toBeNull();
    return match![0];
  };

  it("main view does not persist search text", () => {
    const handler = extractHandler(databaseViewSource);
    expect(handler).toContain("this.vs().searchText = value;");
    // Must NOT trigger any config / frontmatter write path.
    expect(handler).not.toContain("scheduleViewStateSave");
    expect(handler).not.toContain("scheduleConfigSave");
  });

  it("embedded view does not persist search text to its source", () => {
    const handler = extractHandler(embeddedSource);
    expect(handler).toContain("this.vs(config).searchText = value;");
    // Must NOT trigger the write-to-source path, nor any redundant local persist
    // (search mutates only in-memory view state — see setSearchText comment).
    expect(handler).not.toContain("saveEmbeddedConfigInBackground");
    expect(handler).not.toContain("persistEmbeddedConfigLocally");
  });

  it("survives a focus round-trip: refreshOnActivation does not hard-clear search", () => {
    // Returning to the database view (window focus / active-leaf back) must NOT
    // clear the in-memory search. The user may search, click another pane to take
    // notes, then click back — the search must still be there. Data freshness is
    // handled by onDataChanged; peer db-config changes by
    // handlePeerViewConfigChanged (which still does the hard clear).
    const match = databaseViewSource.match(/private refreshOnActivation\(\): void \{[\s\S]*?\n  \}/);
    expect(match, "refreshOnActivation must exist").not.toBeNull();
    const body = match![0];
    // Must not CALL the nuclear hard refresh (a comment may still reference it
    // by name, but there must be no `this.hardRefreshFromSource(...)` call).
    expect(body).not.toContain("this.hardRefreshFromSource");
    expect(body).not.toContain("viewStateStore.clear");
    expect(body).toContain("rebuildViewEntries");
    expect(body).toContain("this.refresh()");
  });
});
