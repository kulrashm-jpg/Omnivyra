/**
 * CPG-012 — ONE script-neutral folding for comparisons (names, people, values).
 *
 * ⚠️ CPG-012 LIVE DEFECT: every comparison folded with `[^a-z0-9]`, so
 *   - a name in any non-Latin script ("トヨタ自動車株式会社", "Сбербанк") folded
 *     to "" — it could never match itself, identical non-Latin locations were
 *     reported as a conflict, two DIFFERENT non-Latin executives matched as
 *     leadership overlap (both ""), and "愛知県 豊田市, JP" equalled
 *     "東京都 港区, JP" (both "jp");
 *   - the same Latin name in two Unicode forms differed: bmwgroup.com serves
 *     "München" DECOMPOSED (u + U+0308), which folded to "mu nchen" while the
 *     composed form folded to "m nchen"; "Société" never met Sirene's "SOCIETE".
 *
 * Folding: compatibility-normalise (full-width → ASCII, ligatures), drop
 * combining marks ONLY on Latin letters (é→e, ü→u — a registry's upper-case
 * ASCII spelling is the same name; marks in other scripts such as kana voicing
 * or Devanagari vowel signs change the word and are kept), lower-case, and keep
 * letters and digits of every script.
 */
export function foldForComparison(s: string): string {
  return s.normalize('NFKD')
    .replace(/(\p{Script=Latin})\p{M}+/gu, '$1')
    .normalize('NFC')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
