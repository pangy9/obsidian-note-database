import type { App, TFile } from "obsidian";
import { t } from "../i18n";

/** Run Templater against a note that has already been created from the template. */
export async function runTemplaterOnCreatedFile(app: App, file: TFile): Promise<void> {
  type TemplaterRuntime = {
    templater?: { overwrite_file_commands?: (target: TFile) => Promise<unknown> };
  };
  type PluginRegistry = { getPlugin?: (id: string) => unknown; plugins?: Record<string, unknown> };
  const registry = (app as unknown as { plugins?: PluginRegistry }).plugins;
  const plugin = (registry?.getPlugin?.("templater-obsidian") ||
    registry?.plugins?.["templater-obsidian"]) as TemplaterRuntime | undefined;
  const execute = plugin?.templater?.overwrite_file_commands;
  if (!execute) throw new Error(t("template.templaterUnavailable"));
  await execute.call(plugin.templater, file);
}
