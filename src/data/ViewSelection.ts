export interface ViewSelectionEntry {
  sourcePath: string;
  viewIds: readonly (string | undefined)[];
}

export interface ViewSelectionIdentity {
  sourcePath?: string;
  viewId?: string;
}

export interface ResolvedViewSelection {
  databaseIndex: number;
  viewIndex: number;
}

/**
 * Restore a database/view selection by stable identity after entries are
 * reordered or rebuilt. Numeric indexes are only a fallback when the selected
 * database or view no longer exists.
 */
export function resolveViewSelection(
  entries: readonly ViewSelectionEntry[],
  identity: ViewSelectionIdentity,
  fallbackDatabaseIndex: number,
  fallbackViewIndex: number,
): ResolvedViewSelection {
  if (entries.length === 0) return { databaseIndex: 0, viewIndex: 0 };

  const identityDatabaseIndex = identity.sourcePath
    ? entries.findIndex((entry) => entry.sourcePath === identity.sourcePath)
    : -1;
  const databaseIndex = identityDatabaseIndex >= 0
    ? identityDatabaseIndex
    : clampIndex(fallbackDatabaseIndex, entries.length);

  const viewIds = entries[databaseIndex]?.viewIds || [];
  if (viewIds.length === 0) return { databaseIndex, viewIndex: 0 };

  const identityViewIndex = identity.viewId ? viewIds.indexOf(identity.viewId) : -1;
  const viewIndex = identityViewIndex >= 0
    ? identityViewIndex
    : clampIndex(fallbackViewIndex, viewIds.length);
  return { databaseIndex, viewIndex };
}

function clampIndex(index: number, length: number): number {
  if (!Number.isFinite(index)) return 0;
  return Math.max(0, Math.min(Math.trunc(index), length - 1));
}
