import { describe, expect, it, vi } from "vitest";
import { setLocale } from "../i18n";
import { setIcon } from "obsidian";
import { buttonPickerToken, renderRecordButtonIcon, renderButtonStyleSample } from "../views/RecordButtonAppearance";
import { renderRecordIcon } from "../views/RecordIconRenderer";

vi.mock("obsidian", () => ({ setIcon: vi.fn() }));
vi.mock("../views/RecordIconRenderer", () => ({ renderRecordIcon: vi.fn(), getValidRecordIconIds: () => ["lucide-check"] }));

setLocale("en");

describe("record button appearance", () => {
  it("adapts old Lucide IDs to the shared picker without changing emoji or colored tokens", () => {
    expect(buttonPickerToken("check")).toBe("lucide:lucide-check");
    expect(buttonPickerToken("lucide:star@orange")).toBe("lucide:star@orange");
    expect(buttonPickerToken("🎯")).toBe("🎯");
    expect(buttonPickerToken("")).toBeUndefined();
  });
  it("keeps legacy icons rendering directly and delegates picker values to the shared renderer", () => {
    const host = {} as HTMLElement;
    renderRecordButtonIcon(host, "check"); expect(setIcon).toHaveBeenCalledWith(host, "check");
    for (const token of ["🎯", "lucide:star@orange"]) {
      renderRecordButtonIcon(host, token);
      expect(renderRecordIcon).toHaveBeenCalledWith(host, token, { compact: true, defaultIcon: "mouse-pointer-2" });
    }
  });
  it("renders each style as a distinct non-interactive example inside the dropdown", () => {
    for (const style of ["default", "primary", "plain"]) {
      const sample = { createSpan: vi.fn(() => ({})) };
      const parent = { createSpan: vi.fn(() => sample) };
      renderButtonStyleSample(parent as unknown as HTMLElement, style);
      expect(parent.createSpan).toHaveBeenCalledWith({ cls: `db-button-style-sample is-${style}`, attr: { "aria-hidden": "true" } });
      expect(sample.createSpan).toHaveBeenCalledTimes(1);
    }
  });
});
