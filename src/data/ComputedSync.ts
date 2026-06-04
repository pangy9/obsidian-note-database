import { ComputedSyncMode } from "./types";

export const DEFAULT_COMPUTED_SYNC_MODE: ComputedSyncMode = "display-only";

export function normalizeComputedSyncMode(value: unknown): ComputedSyncMode {
  if (value === "automatic" || value === "manual") return value;
  return DEFAULT_COMPUTED_SYNC_MODE;
}
