import { describe, expect, it, vi } from "vitest";
import { setLocale } from "../i18n";
import { getStarterTemplates, buildStarterDatabaseConfig } from "../data/DatabaseStarterTemplates";
import { validateRecordButton } from "../data/RecordButton";
import { applyButtonActions, buttonDate } from "../data/RecordButtonValue";
import { cleanStarterSamples, createVaultStarter, instantiateVaultStarter } from "../data/VaultStarterTemplates";
vi.mock("obsidian", () => ({ TFile: class {}, TFolder: class {}, normalizePath: (p: string) => p }));

describe("built-in starter buttons", () => {
  it.each(["en", "zh-CN", "zh-TW"] as const)("runs every example using its own localized schema (%s)", locale => {
    setLocale(locale);
    const now = new Date(2026, 11, 31, 13, 20);
    let count = 0;
    for (const starter of getStarterTemplates(now)) {
      let id = 0;
      const db = buildStarterDatabaseConfig(starter, "Example", "Notes/Example", () => `id-${++id}`);
      for (const col of db.schema.columns.filter(c => c.type === "button")) {
        count++;
        expect(col.buttonConfig?.label).not.toContain("starter.");
        validateRecordButton(col.buttonConfig, db.schema.columns);
        const before = structuredClone(starter.samples[0].frontmatter);
        const target = { path: "Notes/Example/Sample.md", frontmatter: structuredClone(before) };
        const step = col.buttonConfig!.steps![0];
        expect(step.kind).toBe("edit");
        if (step.kind !== "edit") throw new Error("Expected a local example");
        expect(step.target).toBe("trigger");
        applyButtonActions(step.actions, db.schema.columns, { trigger: { ...target, frontmatter: before }, target, variables: new Map(), now });
        if (col.key === "schedule_tomorrow") expect(target.frontmatter.due).toBe("2027-01-01");
        else if (col.key === "follow_up") {
          expect(target.frontmatter.nextContact).toBe(buttonDate(now, false, 7));
          expect(target.frontmatter.stage).toBe(db.schema.columns.find(c => c.key === "stage")!.statusOptions![2].value);
        } else expect(target.frontmatter.status).toBe(db.schema.columns.find(c => c.key === "status")!.statusOptions![2].value);
        expect(target.frontmatter).not.toHaveProperty(col.key);
        expect(cleanStarterSamples(starter.samples, db).every(sample => !(col.key in sample.frontmatter))).toBe(true);
        const portable = createVaultStarter(db, "Saved", "", starter.samples);
        expect(instantiateVaultStarter(portable, "Copy", "Notes/Copy").schema.columns.find(c => c.key === col.key)?.buttonConfig).toEqual(col.buttonConfig);
        expect(starter.samples[0].frontmatter).toEqual(before);
      }
    }
    expect(count).toBe(5);
  });
});
