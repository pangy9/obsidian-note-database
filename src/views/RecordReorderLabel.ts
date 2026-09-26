import { RowData, ViewConfig, NO_TITLE_FIELD } from "../data/types";
import { resolveTitleFieldDisplay } from "../data/TitleFieldDisplay";

/** Match the visible title where possible; always provide a filename fallback. */
export function getRecordReorderLabel(row: RowData, config: ViewConfig): string {
  const titleField = config.titleField === NO_TITLE_FIELD ? undefined : config.titleField || "file.name";
  const title = titleField ? resolveTitleFieldDisplay(row, config, titleField) : undefined;
  return title && !title.isHidden && title.text ? title.text : row.file.basename;
}
