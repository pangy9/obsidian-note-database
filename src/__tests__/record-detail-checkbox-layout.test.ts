import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const styles = readFileSync(new URL("../../styles.css", import.meta.url), "utf8");
const selector = ".note-database-container .db-record-detail-field > .db-board-card-value.db-checkbox-cell";
const getRule = (sel: string) => styles.split(`${sel} {`)[1]?.split("}")[0] || "";

describe("calendar and timeline detail checkbox alignment", () => {
  it("moves the native input to the value column's right edge and centers the row vertically", () => {
    const renderer = readFileSync(new URL("../views/RecordDetailPanel.ts", import.meta.url), "utf8");
    expect(renderer).toContain('valueEl.addClass("db-checkbox-cell")');
    expect(getRule(selector)).toMatch(/display:\s*flex/);
    expect(getRule(selector)).toMatch(/justify-content:\s*flex-end/);
    expect(getRule(selector)).toMatch(/align-self:\s*center/);
    expect(getRule(`${selector} > input[type="checkbox"]`)).toMatch(/margin:\s*0/);
  });

  it("keeps the generic table checkbox centered", () => {
    expect(getRule(".note-database-container .db-checkbox-cell")).toMatch(/text-align:\s*center/);
  });
});
