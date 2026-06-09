import { describe, expect, it, vi } from "vitest";
// eslint-disable-next-line import/no-nodejs-modules
import { readFileSync } from "node:fs";
import { StatusPresetDef } from "../data/types";
import {
  getManualStatusOptionsPresetId,
  getValidStatusPresetId,
  selectStatusOptionsPreset,
} from "../views/modals/StatusOptionsModal";

vi.mock("obsidian", () => ({
  Modal: class {},
  Notice: class {},
  setIcon: () => undefined,
}));

const presets: StatusPresetDef[] = [
  {
    id: "general",
    name: "General",
    options: [
      { value: "Todo", color: "gray" },
      { value: "Done", color: "green" },
    ],
  },
  {
    id: "review",
    name: "Review",
    options: [
      { value: "Draft", color: "orange" },
      { value: "Approved", color: "green" },
    ],
  },
];

describe("status options preset state", () => {
  it("uses the explicitly stored preset id when it exists", () => {
    expect(getValidStatusPresetId("review", presets)).toBe("review");
  });

  it("treats old columns without statusPresetId as no preset", () => {
    expect(getValidStatusPresetId(undefined, presets)).toBeUndefined();
  });

  it("does not infer a preset from matching option contents", () => {
    const optionsMatchingGeneral = presets[0].options.map((option) => ({ ...option }));
    expect(optionsMatchingGeneral).toEqual(presets[0].options);
    expect(getValidStatusPresetId(undefined, presets)).toBeUndefined();
  });

  it("clears the preset id for manual option edits", () => {
    expect(getManualStatusOptionsPresetId()).toBeUndefined();
  });

  it("restores custom options after switching from custom to a preset and back", () => {
    const customOptions = [
      { value: "Idea", color: "purple" },
      { value: "Later", color: "blue" },
    ] as const;
    const presetState = selectStatusOptionsPreset({
      activePresetId: undefined,
      options: customOptions.map((option) => ({ ...option })),
      customOptions: customOptions.map((option) => ({ ...option })),
    }, "general", presets);
    expect(presetState.activePresetId).toBe("general");
    expect(presetState.options).toEqual(presets[0].options);

    const customState = selectStatusOptionsPreset(presetState, undefined, presets);
    expect(customState.activePresetId).toBeUndefined();
    expect(customState.options).toEqual(customOptions);
  });
});

describe("file field option editing guards", () => {
  it("keeps file.* columns out of normal option editing and type menus", () => {
    const columnMenu = readFileSync(new URL("../views/ColumnMenu.ts", import.meta.url), "utf8");
    const databaseView = readFileSync(new URL("../views/DatabaseView.ts", import.meta.url), "utf8");

    expect(columnMenu).toContain("!isFileFieldKey(col.key)");
    expect(columnMenu).toContain("setDisabled(isFileFieldKey(col.key))");
    expect(columnMenu).toContain("setDisabled(col.key === \"file.name\")");
    expect(databaseView).toContain("isFileFieldKey(col.key)");
    expect(databaseView).toContain("fileField.fixedType");
  });

  it("disables the file.* change type parent menu item", () => {
    const columnMenu = readFileSync(new URL("../views/ColumnMenu.ts", import.meta.url), "utf8");

    expect(columnMenu).toContain("const isFileField = isFileFieldKey(col.key)");
    expect(columnMenu).toContain("item.setDisabled(isFileField)");
    expect(columnMenu).toContain("if (isFileField) return item");
  });
});

describe("status option modal long labels", () => {
  it("keeps long preview labels to one truncated line with a full title", () => {
    const modalSource = readFileSync(new URL("../views/modals/StatusOptionsModal.ts", import.meta.url), "utf8");
    const css = readFileSync(new URL("../../styles.css", import.meta.url), "utf8");

    expect(modalSource).toContain('title: option.value || t("modal.untitled")');
    expect(css).toContain(".note-database-modal .db-status-option-preview.status-badge");
    expect(css).toContain("text-overflow: ellipsis");
    expect(css).toContain("white-space: nowrap");
  });
});
