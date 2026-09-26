import { SerialTaskQueue } from "./SerialTaskQueue";

export type HistoryDirection = "forward" | "reverse";
/** Each step must reject before mutation, or resolve after persistence. */
export interface ReversibleDataStep {
  description: string;
  apply(direction: HistoryDirection, compensating: boolean): Promise<void>;
}

export class DataHistoryFailure extends Error {
  constructor(readonly primaryError: unknown, readonly compensationErrors: Array<{ step: string; error: unknown }>) {
    super([String(primaryError), ...compensationErrors.map(({ step, error }) => `${step}: ${String(error)}`)].join("\n"));
  }
}

export async function executeDataSteps(steps: readonly ReversibleDataStep[], direction: HistoryDirection): Promise<void> {
  const ordered = direction === "forward" ? [...steps] : [...steps].reverse();
  const applied: ReversibleDataStep[] = [];
  try {
    for (const step of ordered) {
      await step.apply(direction, false);
      applied.push(step);
    }
  } catch (primaryError) {
    const compensationErrors: Array<{ step: string; error: unknown }> = [];
    for (const step of applied.reverse()) {
      try { await step.apply(direction === "forward" ? "reverse" : "forward", true); }
      catch (error) { compensationErrors.push({ step: step.description, error }); }
    }
    throw new DataHistoryFailure(primaryError, compensationErrors);
  }
}

interface Entry { label: string; steps: ReversibleDataStep[] }

/** Session-local history. Prepare, commit and replay share one queue; failed undo never pops. */
export class EmbeddedDataHistory {
  private queue = new SerialTaskQueue();
  private undoEntries: Entry[] = [];
  private redoEntries: Entry[] = [];
  private pending = 0;
  private damaged = false;
  get busy(): boolean { return this.pending > 0; }
  get canUndo(): boolean { return !this.damaged && this.undoEntries.length > 0; }
  get canRedo(): boolean { return !this.damaged && this.redoEntries.length > 0; }
  get undoLabel(): string | undefined { return this.undoEntries.at(-1)?.label; }

  private async enqueue<T>(task: () => Promise<T>): Promise<T> {
    this.pending++;
    try {
      return await this.queue.enqueue(async () => {
        if (this.damaged) throw new Error("History blocked after incomplete rollback; reload and check the reported files.");
        try { return await task(); }
        catch (error) {
          if (error instanceof DataHistoryFailure && error.compensationErrors.length) this.damaged = true;
          throw error;
        }
      });
    } finally { this.pending--; }
  }

  perform(label: string, prepare: () => Promise<ReversibleDataStep[]>): Promise<boolean> {
    return this.enqueue(async () => {
      const steps = await prepare();
      if (!steps.length) return false;
      await executeDataSteps(steps, "forward");
      this.undoEntries.push({ label, steps });
      if (this.undoEntries.length > 30) this.undoEntries.shift();
      this.redoEntries = [];
      return true;
    });
  }

  replay(direction: "undo" | "redo"): Promise<string | undefined> {
    return this.enqueue(async () => {
      const source = direction === "undo" ? this.undoEntries : this.redoEntries;
      const target = direction === "undo" ? this.redoEntries : this.undoEntries;
      const entry = source.at(-1);
      if (!entry) return undefined;
      await executeDataSteps(entry.steps, direction === "undo" ? "reverse" : "forward");
      source.pop();
      target.push(entry);
      return entry.label;
    });
  }
}
