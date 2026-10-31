export interface HeaderCollapseState {
  description: boolean;
}

export function readHeaderCollapseState(value: unknown): HeaderCollapseState {
  const state = value && typeof value === "object" ? value as Partial<HeaderCollapseState> : {};
  return { description: state.description === true };
}

/** Local UI preferences: never written into the shared database definition. */
export function headerCollapseStorageKey(vaultId: string, databaseId: string): string {
  // Resource URLs can carry a cache-busting timestamp; it is not vault identity.
  const stableVaultId = vaultId.split("?")[0];
  return `note-database:header-collapse:${JSON.stringify([stableVaultId, databaseId])}`;
}

export function loadHeaderCollapseState(storage: Pick<Storage, "getItem">, key: string): HeaderCollapseState {
  try {
    return readHeaderCollapseState(JSON.parse(storage.getItem(key) || "null"));
  } catch {
    return readHeaderCollapseState(null);
  }
}

export function applyHeaderCollapseState(header: HTMLElement, state: HeaderCollapseState): void {
  header.toggleClass("is-description-collapsed", state.description);
}
