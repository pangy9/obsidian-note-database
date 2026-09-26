import type { DataSource, ViewDefSnapshot } from "./DataSource";
import type { DatabaseConfig } from "./types";
import { executeDataSteps, type ReversibleDataStep } from "./EmbeddedDataHistory";

export interface NewDatabaseConflictConfigChange {
  path: string;
  dbId: string;
  before: ViewDefSnapshot;
  after: DatabaseConfig;
  afterPayload: unknown;
}

/** CAS writes plus reverse-order compensation: a failed multi-database commit leaves no partial type changes. */
export async function commitNewDatabaseConflictChanges(
  dataSource: Pick<DataSource, "patchViewDefConfig">,
  changes: readonly NewDatabaseConflictConfigChange[],
  sourceInstanceId: string,
): Promise<void> {
  const steps: ReversibleDataStep[] = changes.map(({ path, dbId, before, after, afterPayload }) => ({
    description: path,
    apply: async (direction) => {
      await dataSource.patchViewDefConfig(
        path,
        direction === "forward" ? before.rawPayload : afterPayload,
        direction === "forward" ? afterPayload : before.rawPayload,
        direction === "forward" ? after : before.typedConfig,
        { dbId, dbPath: path, sourceInstanceId },
      );
    },
  }));
  await executeDataSteps(steps, "forward");
}
