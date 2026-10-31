import { beforeEach, describe, expect, it, vi } from "vitest";
import { setIcon } from "obsidian";
import { BUTTON_STEP_ICONS, getButtonOperationIcon, renderButtonMenuIcon } from "../views/RecordButtonMenuIcons";
import { renderDropdownPropertyTypeIcon } from "../views/PropertyTypeIcon";
import { renderDatabaseDropdownIcon } from "../views/RecordIconRenderer";

vi.mock("obsidian", () => ({ setIcon: vi.fn() }));
vi.mock("../views/PropertyTypeIcon", () => ({
  getPropertyDropdownIcon: (type: string) => `property:${type}`,
  renderDropdownPropertyTypeIcon: vi.fn((_parent, icon: string) => icon.startsWith("property:")),
}));
vi.mock("../views/RecordIconRenderer", () => ({ renderDatabaseDropdownIcon: vi.fn((_parent, icon: string) => icon.startsWith("note-database-icon:")) }));
beforeEach(() => vi.clearAllMocks());
describe("button menu icon rendering", () => {
  it("renders the official Tabler variable paths instead of the host's same-named Lucide icon", () => {
    class SvgNode {
      attributes: Record<string, string> = {};
      children: SvgNode[] = [];
      classList = { add: vi.fn() };
      setAttribute(key: string, value: string): void { this.attributes[key] = value; }
      appendChild(child: SvgNode): void { this.children.push(child); }
    }
    const host = Object.assign(new SvgNode(), { ownerDocument: { createElementNS: () => new SvgNode() } });
    renderButtonMenuIcon(host as unknown as HTMLElement, BUTTON_STEP_ICONS.variable);
    const svg = host.children[0];
    expect(svg.attributes.viewBox).toBe("0 0 24 24");
    expect(svg.attributes["stroke-width"]).toBe("2");
    expect(svg.children).toHaveLength(2);
    expect(svg.children[0].attributes.d).toContain("M5 4c-2.5 5 -2.5 10 0 16");
    expect(setIcon).not.toHaveBeenCalled();
  });
  it("delegates type and custom database icons without treating their tokens as Lucide names", () => {
    const host = {} as HTMLElement;
    renderButtonMenuIcon(host, "property:status");
    expect(renderDropdownPropertyTypeIcon).toHaveBeenCalledWith(host, "property:status");
    expect(renderDatabaseDropdownIcon).not.toHaveBeenCalled();
    for (const token of ["note-database-icon:🎯", "note-database-icon:lucide:star@orange", "note-database-icon:"]) {
      renderButtonMenuIcon(host, token);
      expect(renderDatabaseDropdownIcon).toHaveBeenCalledWith(host, token);
    }
    expect(setIcon).not.toHaveBeenCalled();
    renderButtonMenuIcon(host, "copy");
    expect(setIcon).toHaveBeenCalledWith(host, "copy");
  });
  it("uses the field's date precision for the now operation", () => {
    expect(getButtonOperationIcon("now", "date")).toBe("property:date");
    expect(getButtonOperationIcon("now", "datetime")).toBe("property:datetime");
  });
});
