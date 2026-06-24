import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("embedded calendar/timeline invalid-events warning (read-only)", () => {
  const source = readFileSync(new URL("../views/EmbeddedDatabaseRenderer.ts", import.meta.url), "utf8");

  it("wires invalid-events callbacks into the calendar and timeline renderers", () => {
    expect(source).toContain("getCalendarInvalidEventCount: () => this.getEmbeddedInvalidEventCount()");
    expect(source).toContain("openCalendarInvalidEvents: () => this.openEmbeddedInvalidEvents()");
    expect(source).toContain("getTimelineInvalidEventCount: () => this.getEmbeddedInvalidEventCount()");
    expect(source).toContain("openTimelineInvalidEvents: () => this.openEmbeddedInvalidEvents()");
  });

  it("wires invalid-events callbacks into the calendar options popover", () => {
    expect(source).toContain("getInvalidEventCount: () => this.getEmbeddedInvalidEventCount(cfg)");
    expect(source).toContain("openInvalidEvents: () => this.openEmbeddedInvalidEvents()");
  });

  it("relaxes the invalid-event count gate to calendar (mirrors DatabaseView)", () => {
    expect(source).toContain('config.viewType !== "timeline" && config.viewType !== "calendar"');
  });

  it("keeps the fix path read-only: notice in codeblock, full view otherwise", () => {
    expect(source).toContain('t("notice.editInFullView"');
    expect(source).toContain("void this.openFullDatabaseView(this.config)");
  });

  it("does not instantiate the mutating InvalidTimeEventsModal inside the embed renderer", () => {
    expect(source).not.toContain("InvalidTimeEventsModal");
  });
});
