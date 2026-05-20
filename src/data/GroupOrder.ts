import { getColumnOptionValues } from "./ColumnTypes";
import { ColumnDef, ViewConfig } from "./types";

export function getGroupColumn(config: ViewConfig, field: string): ColumnDef | undefined {
  return config.schema.columns.find((col) => col.key === field);
}

export function getDefaultGroupOrder(config: ViewConfig, field: string): string[] {
  const col = getGroupColumn(config, field);
  if (!col) return [];
  const optionOrder = getColumnOptionValues(col);
  if (optionOrder.length > 0) return optionOrder;
  if (col.type === "checkbox") return ["true", "false"];
  return [];
}

export function getEffectiveGroupOrder(
  config: ViewConfig,
  field: string,
  actualKeys: string[] = []
): string[] {
  return mergeGroupOrder(config.groupOrders?.[field] || [], getDefaultGroupOrder(config, field), actualKeys);
}

export function mergeGroupOrder(...orders: string[][]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const order of orders) {
    for (const key of order) {
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(key);
    }
  }
  return result;
}
