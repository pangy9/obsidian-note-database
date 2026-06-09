import { ChartColorPalette } from "./types";

export type ChartPresetPalette = Exclude<ChartColorPalette, "auto" | "accent" | "option">;

/**
 * Chart color presets picked from Color Hunt's popular all-time palettes.
 * Keep the internal keys stable for saved views; the user-facing names live in i18n.
 */
export const CHART_PRESET_PALETTES: Record<ChartPresetPalette, string[]> = {
  colorful: ["#F9ED69", "#F08A5D", "#B83B5E", "#6A2C70", "#3F1D38"],
  pastel: ["#B1B2FF", "#AAC4FF", "#D2DAFF", "#EEF1FF", "#F8F9FF"],
  vivid: ["#2B2E4A", "#E84545", "#903749", "#53354A", "#1F2235"],
  warm: ["#FFF5E4", "#FFE3E1", "#FFD1D1", "#FF9494", "#E67373"],
  cool: ["#1B262C", "#0F4C75", "#3282B8", "#BBE1FA", "#E3F6FF"],
  mono: ["#222831", "#393E46", "#00ADB5", "#EEEEEE", "#F8F8F8"],
};

export function getChartPalettePreviewColors(palette: ChartColorPalette, accent = "#7c7dde"): string[] {
  if (palette === "accent") return [accent, accent, accent, accent, accent];
  if (palette === "option") return ["#2f6fad", "#448361", "#b65f00", "#d44c47", "#7c7dde"];
  if (palette === "auto") return [accent, "#10b981", "#f59e0b", "#ef4444", "#8b5cf6"];
  return CHART_PRESET_PALETTES[palette]?.slice(0, 5) || CHART_PRESET_PALETTES.colorful.slice(0, 5);
}
