/**
 * WP-2 — country equivalence for identity corroboration.
 *
 * ONE question, answered deterministically: do two publicly observed country representations
 * denote the SAME jurisdiction? Nothing here ranks, scores, geocodes or guesses.
 *
 * ─── WHY THIS EXISTS ──────────────────────────────────────────────────────
 * The two sides of an advertiser identity comparison speak different country vocabularies and
 * always have:
 *
 *   subject side    JSON-LD `Organization.address.addressCountry` — an ISO 3166-1 alpha-2 code
 *                   in the measured cases (`hubspot.com` publishes "US", `wix.com` publishes "IL")
 *   provider side   Google Ads Transparency `Based in:` — always a full English country name
 *                   ("United States", "Israel", "the Netherlands")
 *
 * Compared as raw strings these never agree, so a verified, exactly-name-matching advertiser was
 * being downgraded from MATCHED to PROBABLE_MATCH on a jurisdiction that in fact corroborated it.
 *
 * ─── WHY THERE IS NO COUNTRY DICTIONARY IN THIS FILE ──────────────────────
 * The repository has no ISO 3166 name<->code table, and adding one would be a second source of
 * truth to maintain. The three near-candidates were each inspected and rejected on the record:
 *
 *   companyProfile/grounding/registry/jurisdiction.ts  parses and nests jurisdiction CODES
 *       ("US", "US-DE", "GLOBAL") and states "No country list: any well-formed code is accepted".
 *       It cannot turn "United States" into anything, which is the entire problem here.
 *   prospectIdentity/attributes.ts `normalizeCountryCode`  validates alpha-2 shape and documents
 *       that name->code translation "needs a reference dataset" it deliberately does not carry.
 *   companyContextTaxonomy.ts `geography`  is a marketing-geography vocabulary ('global', 'eu',
 *       'apac') whose members are not countries and whose keys are not ISO codes.
 *
 * So the canonical source used here is the one already present in the runtime: ICU, through
 * `Intl.DisplayNames({ type: 'region' })`. The comparison key is the CANONICAL ENGLISH NAME, not
 * the code, because names collapse ISO's historical aliases the right way: ICU resolves both "GB"
 * and "UK" to "United Kingdom", and both "RU" and "SU" to "Russia", so a code-keyed map would have
 * had to pick a winner and would then disagree with itself.
 *
 * The set of names ICU recognises is derived by enumerating the 676 two-letter codes once and
 * keeping those ICU resolves (279 codes, 263 distinct names at the time of writing). That is a
 * derivation, not a dictionary: there is nothing to keep in sync.
 *
 * ─── WHAT IS DELIBERATELY NOT DONE ────────────────────────────────────────
 * No substring matching, no prefix matching, no edit distance, no token overlap. "United States"
 * and "United Kingdom" share a word and must never agree; "US" must never agree with something
 * merely because it occurs inside it. Equality of a canonical key is the only test applied.
 *
 * ─── ABSENCE IS NOT AGREEMENT ─────────────────────────────────────────────
 * A value this module cannot place — missing, blank, an unrecognised code, a country name ICU does
 * not know — yields `null`, and `null` never equals anything, including another `null`. Two
 * unknowns are two unknowns.
 *
 * ─── PURITY ───────────────────────────────────────────────────────────────
 * No network, no database, no clock, no `process.env`. It does read the runtime's ICU data, which
 * is the single environmental dependency and is declared here rather than hidden. The failure mode
 * is safe in both directions: if ICU data is absent the derived name set comes back empty, the
 * module falls back to plain textual comparison (exactly the behaviour that preceded this file),
 * and a code-vs-name pair simply abstains instead of agreeing.
 */

/** ICU's own marker for a syntactically valid but meaningless region subtag ("ZZ"). */
const UNKNOWN_REGION_DISPLAY = 'Unknown Region';

/**
 * Case, accent, punctuation and whitespace only. Applied identically to both sides so that any
 * residual difference is a difference of content, never of typography.
 */
function normalizeCountryText(value: string): string {
  return value
    .normalize('NFKC')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/^the\s+/, '')
    .replace(/['‘’‛.,()"“”]/g, '')
    .replace(/[\s\-_/]+/g, ' ')
    .trim();
}

let displayNamesCache: Intl.DisplayNames | null | undefined;

function regionDisplayNames(): Intl.DisplayNames | null {
  if (displayNamesCache !== undefined) return displayNamesCache;
  try {
    displayNamesCache = new Intl.DisplayNames(['en'], { type: 'region' });
  } catch {
    displayNamesCache = null;
  }
  return displayNamesCache;
}

/**
 * The canonical name ICU gives an alpha-2 region code, normalised — or null when ICU does not
 * recognise the code. ICU's documented fallback for an unknown subtag is to echo the subtag back,
 * so `of('QQ') === 'QQ'` is the "unknown" signal, and "ZZ" is excluded by name.
 */
function regionNameForCode(code: string): string | null {
  const dn = regionDisplayNames();
  if (!dn) return null;
  let raw: string | undefined;
  try {
    raw = dn.of(code);
  } catch {
    return null;
  }
  if (!raw || raw === code || raw === UNKNOWN_REGION_DISPLAY) return null;
  return normalizeCountryText(raw) || null;
}

let knownNamesCache: Set<string> | null = null;

/** Every canonical region name ICU knows, derived once from the alpha-2 code space. */
function knownCountryNames(): Set<string> {
  if (knownNamesCache) return knownNamesCache;
  const names = new Set<string>();
  for (let first = 65; first <= 90; first += 1) {
    for (let second = 65; second <= 90; second += 1) {
      const name = regionNameForCode(String.fromCharCode(first) + String.fromCharCode(second));
      if (name) names.add(name);
    }
  }
  knownNamesCache = names;
  return names;
}

/**
 * Reduce one country representation to a canonical comparison key, or null when it cannot be
 * placed. Accepts an ISO 3166-1 alpha-2 code in any case, or a canonical English country name in
 * any case, with any surrounding or internal whitespace and the provider's definite article.
 *
 * Returns the canonical NAME form so that `"US"`, `"us"`, `"United States"` and `"  the UNITED
 * STATES "` all reduce to the same key, while `"United Kingdom"` reduces to a different one.
 */
export function canonicalCountryKey(value: string | null | undefined): string | null {
  const raw = String(value ?? '').normalize('NFKC').trim();
  if (!raw) return null;

  const known = knownCountryNames();

  // No ICU region data in this runtime: degrade to the textual comparison that preceded this
  // module rather than abstaining on everything, which would lose agreements that already worked.
  if (known.size === 0) return normalizeCountryText(raw) || null;

  // No country name is two letters, so a two-letter token is unambiguously a code attempt. An
  // unrecognised one abstains rather than falling through to be compared as a literal, which is
  // what keeps "QQ" vs "QQ" from counting as agreement between two unknowns.
  if (/^[A-Za-z]{2}$/.test(raw)) return regionNameForCode(raw.toUpperCase());

  const name = normalizeCountryText(raw);
  if (!name) return null;
  return known.has(name) ? name : null;
}

/**
 * True only when both sides name the SAME, recognised jurisdiction. Either side being absent,
 * blank or unplaceable yields false: this function reports agreement, never the absence of
 * disagreement, and the caller must not read a false as a contradiction.
 */
export function countriesEquivalent(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  const a = canonicalCountryKey(left);
  const b = canonicalCountryKey(right);
  return a !== null && b !== null && a === b;
}
