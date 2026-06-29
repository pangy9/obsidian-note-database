/**
 * True while an IME (input method) composition is in progress — e.g. the user
 * is typing CJK text and has not yet confirmed the candidate.
 *
 * Keydown handlers that commit or close an editor on Enter / Escape must
 * early-return while this is true. Otherwise the Enter used to confirm an IME
 * candidate (or Escape used to cancel it) would wrongly submit/close the editor,
 * making IME input unusable in text cells. After the user confirms the
 * candidate, the next Enter/Escape fires with isComposing === false and is
 * handled normally.
 *
 * `event.isComposing` is reliable on Obsidian's Chromium/Electron runtime; the
 * deprecated `keyCode === 229` fallback is not needed here.
 */
export function isImeComposing(event: KeyboardEvent): boolean {
  return event.isComposing;
}
