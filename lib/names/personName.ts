/**
 * Personal-name comparison. ONE rule, shared by every caller that compares a
 * provider's name to a person's (PI review F2): the Apollo locator guard and
 * the R3 import duplicate probe. Pure; no backend import.
 *
 * Name agreement is a CORRELATE, never an identity: callers use it only to
 * REFUSE (guard) or to HOLD for human review (probe), never to merge.
 */

/** Fold a personal name to comparable tokens: NFKD, marks stripped, lower case, letters only. */
export function nameTokens(name: unknown): string[] {
  if (typeof name !== 'string') return [];
  return name.normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase()
    .replace(/[^\p{L}\s]+/gu, ' ').split(/\s+/).filter(Boolean);
}

/** Whether a name has enough to be checked at all (two tokens after folding). */
export function personNamesAgreeable(name: unknown): boolean {
  return nameTokens(name).length >= 2;
}

/**
 * THE NAME RULE, stated so it can be tested both ways.
 *
 * Two names AGREE when, after `nameTokens` folding (diacritics and case
 * ignored, punctuation and digits dropped), BOTH have at least two tokens and
 * their FIRST and LAST tokens are equal, in either order (so surname-first
 * ordering agrees). Middle names and initials in between are ignored.
 *
 * Deliberately NOT agreement: nicknames (Bob vs Robert), maiden-name changes,
 * a single-token name, an obfuscated surname ("D." folds to one letter, which
 * equals nothing longer), and a name with no letters after folding.
 */
export function personNamesAgree(a: unknown, b: unknown): boolean {
  const x = nameTokens(a);
  const y = nameTokens(b);
  if (x.length < 2 || y.length < 2) return false;
  const [xf, xl] = [x[0], x[x.length - 1]];
  const [yf, yl] = [y[0], y[y.length - 1]];
  return (xf === yf && xl === yl) || (xf === yl && xl === yf);
}
