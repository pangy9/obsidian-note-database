/** Height of one rendered database code block, stored alongside its reference. */
export const MIN_EMBED_HEIGHT = 160;
export const MAX_EMBED_HEIGHT = 1200;

export function clampEmbeddedHeight(value: number): number {
  if (!Number.isFinite(value)) return MIN_EMBED_HEIGHT;
  return Math.round(Math.max(MIN_EMBED_HEIGHT, Math.min(MAX_EMBED_HEIGHT, value)));
}

export function parseEmbeddedHeight(value: string | undefined): number | null {
  const match = value?.trim().match(/^(\d{1,4})(?:px)?$/i);
  if (!match) return null;
  const number = Number(match[1]);
  return number >= MIN_EMBED_HEIGHT && number <= MAX_EMBED_HEIGHT ? number : null;
}

/** Preserve every other code-block option, including unknown future options. */
export function updateEmbeddedHeightOption(source: string, height: number | null): string {
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const lines = source ? source.split(/\r?\n/) : [];
  const heightLine = height == null ? null : `height: ${clampEmbeddedHeight(height)}`;
  let replaced = false;
  const next = lines.filter((line) => {
    if (!/^height\s*:/i.test(line.trim())) return true;
    if (heightLine != null && !replaced) {
      replaced = true;
      return true;
    }
    return false;
  }).map((line) => /^height\s*:/i.test(line.trim()) ? heightLine! : line);
  if (heightLine != null && !replaced) next.push(heightLine);
  return next.join(newline);
}

/** Only rewrite a verified database code block; never replace neighboring Markdown. */
export function updateEmbeddedHeightBlock(block: string, height: number | null): string | null {
  const newline = block.includes("\r\n") ? "\r\n" : "\n";
  const lines = block.split(/\r?\n/);
  const opener = lines[0]?.match(/^[ \t]*(`{3,}|~{3,})(note-database|database-view)(?:\s.*)?$/);
  if (!opener || lines.length < 2 || lines[lines.length - 1]?.trim() !== opener[1]) return null;
  const source = lines.slice(1, -1).join(newline);
  const updatedSource = updateEmbeddedHeightOption(source, height);
  return [lines[0], ...(updatedSource ? updatedSource.split(/\r?\n/) : []), lines[lines.length - 1]].join(newline);
}
