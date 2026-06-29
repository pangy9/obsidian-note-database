import { afterEach, describe, expect, it } from "vitest";
import { formatDateValueDisplay, setDateDisplayMode } from "../data/DateTimeFormat";
import { getSearchHighlightTerms } from "../data/Search";
import { setLocale } from "../i18n";

describe("search helpers", () => {
  afterEach(() => {
    setDateDisplayMode("always");
    setLocale("system");
  });

  it("adds visible date text as a highlight term for full date storage queries", () => {
    setDateDisplayMode("always");
    const visibleDate = formatDateValueDisplay("2026-06-17");

    expect(getSearchHighlightTerms("2026-06-17")).toContain(visibleDate);
  });

  it("adds visible month-day text as a highlight term for month-day date queries", () => {
    setDateDisplayMode("always");

    expect(getSearchHighlightTerms("6-17").some((term) => /17/.test(term) && !/2000/.test(term))).toBe(true);
  });

  it("highlights visible Chinese month text for year-month storage queries when the year is hidden", () => {
    setLocale("zh-CN");
    setDateDisplayMode("smart");
    const visibleDate = formatDateValueDisplay("2026-06-21", { contextYear: 2026 });

    expect(visibleDate).toBe("6月21日");
    expect(getSearchHighlightTerms("2026-06").some((term) => visibleDate.toLowerCase().includes(term.toLowerCase()))).toBe(true);
  });
});
