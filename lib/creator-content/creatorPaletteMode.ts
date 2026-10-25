/**
 * Palette mode — whose colours a creative uses (owner request 2026-10-25).
 *
 * "If we don't select brand-aware generation and select independent creative
 * generation, it should get the look's own colours, or ask if it is open for
 * experimentation."
 *
 *   brand-aware  → 'brand'         the brand kit's colours (unchanged behaviour)
 *   independent  → 'look'          the chosen look's own palette (the default)
 *                → 'experimental'  AI picks a fresh, harmonious palette per generation
 *
 * In independent mode with no look chosen, 'look' simply has no palette to
 * apply and every renderer keeps its current (non-brand) behaviour.
 *
 * Pure; shared by the intake screen, the editor, the summary card, the payload
 * builder and the renderers.
 */

export type CreatorPaletteMode = 'brand' | 'look' | 'experimental';

/** The user's colour choice in independent mode. */
export type IndependentPaletteChoice = 'look' | 'experimental';

export const DEFAULT_INDEPENDENT_PALETTE: IndependentPaletteChoice = 'look';

/** A valid independent choice, or null. */
export function readIndependentPaletteChoice(value: unknown): IndependentPaletteChoice | null {
  return value === 'look' || value === 'experimental' ? value : null;
}

/** The palette mode a request carries, from the brand mode and the user's colour choice. */
export function paletteModeFor(brandMode: string | null | undefined, choice: unknown): CreatorPaletteMode {
  if (brandMode !== 'independent') return 'brand';
  return readIndependentPaletteChoice(choice) ?? DEFAULT_INDEPENDENT_PALETTE;
}

/** The colour options offered when Independent is selected (intake + editor). */
export const INDEPENDENT_PALETTE_OPTIONS: ReadonlyArray<{ id: IndependentPaletteChoice; label: string; body: string }> = Object.freeze([
  { id: 'look', label: "Use the look's own colours", body: 'The colours of the look you chose lead the design.' },
  { id: 'experimental', label: 'Open to experimentation — let AI choose a fresh palette', body: 'Each generation tries a new harmonious palette suited to the look.' },
]);

/** The summary-card wording for a palette mode (null for brand mode — the Brand row covers it). */
export function paletteSummaryLabel(mode: CreatorPaletteMode | null | undefined): string | null {
  if (mode === 'look') return "The look's own palette";
  if (mode === 'experimental') return 'Experimental palette chosen by AI';
  return null;
}
