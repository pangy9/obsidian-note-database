import type { DataSource } from "./DataSource";
import type { ColumnDef, RecordButtonConfig } from "./types";
import type { FrontmatterKeySnapshot, FrontmatterWrite } from "./RenameTransaction";
import { planRecordButton, validateRecordButton } from "./RecordButton";
import { configsDeepEqual } from "./FrontmatterPatch";

export async function prepareRecordButton(data: Pick<DataSource, "readFrontmatterKeySnapshots">, path: string, button: RecordButtonConfig, columns: ColumnDef[]) {
  validateRecordButton(button, columns);
  const before = await data.readFrontmatterKeySnapshots(path, [...new Set(button.actions.map((action) => action.field))]);
  const current = Object.fromEntries(Object.entries(before).filter(([, snapshot]) => snapshot.exists).map(([key, snapshot]) => [key, snapshot.value]));
  const updates = planRecordButton(button, columns, current);
  const after: Record<string, FrontmatterKeySnapshot> = {};
  const writes: Record<string, FrontmatterWrite> = {};
  for (const [key, value] of Object.entries(updates)) {
    after[key] = value === null ? { exists: false } : { exists: true, value };
    if (!configsDeepEqual(before[key], after[key])) writes[key] = value === null ? { kind: "delete" } : { kind: "set", value };
  }
  return { before, after, writes, updates };
}
