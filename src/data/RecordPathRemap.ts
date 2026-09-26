import type { DatabaseConfig, ViewConfig } from "./types";

export function remapRecordPathsInConfig(
    database: DatabaseConfig,
    changes: Array<{ oldPath: string; newPath: string }>,
    direction: "old" | "new",
  ): void {
    const pathMap = new Map(changes.map((change) => (
      direction === "new" ? [change.oldPath, change.newPath] : [change.newPath, change.oldPath]
    )));
    const remapPath = (path: string): string => pathMap.get(path) || path;
    for (const view of database.views) {
      const ranks = view.manualOrder?.ranks;
      if (ranks) {
        view.manualOrder = {
          ...(view.manualOrder || {}),
          ranks: Object.fromEntries(Object.entries(ranks).map(([path, rank]) => [remapPath(path), rank])),
        };
      }
      if (view.boardCardOrders) {
        view.boardCardOrders = Object.fromEntries(
          Object.entries(view.boardCardOrders).map(([field, groups]) => [
            field,
            Object.fromEntries(Object.entries(groups).map(([group, paths]) => [group, paths.map(remapPath)])),
          ]),
        );
      }
      remapFileGroupState(view, pathMap);
    }
  }

function remapFileGroupState(view: ViewConfig, pathMap: Map<string, string>): void {
    const fileGroupFields = new Set(["file.name", "file.basename", "file.path", "file.file"]);
    const groupValueMap = (field: string): Map<string, string> => new Map(
      Array.from(pathMap, ([oldPath, newPath]) => [
        getFileGroupValueForPath(field, oldPath),
        getFileGroupValueForPath(field, newPath),
      ]),
    );
    const remapListMap = (source: Record<string, string[]> | undefined): Record<string, string[]> | undefined => {
      if (!source) return source;
      return Object.fromEntries(Object.entries(source).map(([field, values]) => {
        if (!fileGroupFields.has(field)) return [field, values];
        const valuesMap = groupValueMap(field);
        return [field, values.map((value) => valuesMap.get(value) || value)];
      }));
    };
    view.groupOrders = remapListMap(view.groupOrders);
    view.collapsedGroups = remapListMap(view.collapsedGroups);
    if (view.expandedGroupRows) {
      view.expandedGroupRows = Object.fromEntries(
        Object.entries(view.expandedGroupRows).map(([field, values]) => {
          if (!fileGroupFields.has(field)) return [field, values];
          const valuesMap = groupValueMap(field);
          return [field, Object.fromEntries(Object.entries(values).map(([value, count]) => [valuesMap.get(value) || value, count]))];
        }),
      );
    }
  }

function getFileGroupValueForPath(field: string, path: string): string {
    const name = path.slice(path.lastIndexOf("/") + 1);
    if (field === "file.name") return name;
    if (field === "file.basename") return name.replace(/\.md$/i, "");
    if (field === "file.path" || field === "file.file") return path;
    return path;
  }
