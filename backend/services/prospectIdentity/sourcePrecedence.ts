/**
 * PI-ADR-009 — which conflicting observation becomes the canonical value.
 *
 * ─── WHAT THIS IS ─────────────────────────────────────────────────────────
 * A pure, read-time selection over observations that are ALREADY RETAINED. It
 * chooses; it never deletes, never merges and never writes. LI-2 remains the
 * single writer to the spine and `decideCanonicalUpdates` keeps its own
 * never-overwrite rule — this module answers a different question ("which
 * observation is canonical?") from the one that module answers ("may we write?").
 *
 * ─── THE RULE THE OWNER ACTUALLY APPROVED ─────────────────────────────────
 * The brief proposed a broad rule making Sales Navigator authoritative for
 * LinkedIn identity, person identity, current company, current title AND
 * seniority. The owner chose a NARROWER one, and the narrow one is what is
 * implemented:
 *
 *   RULE 1  Sales Navigator wins `job_title` and the employer identity, and
 *           ONLY those two — where it actually supplies an observation.
 *   RULE 2  everything else: most recent wins; ties broken by confidence.
 *   RULE 3  nothing is discarded, in either case.
 *
 * Seniority is deliberately NOT authoritative, because that is what was
 * declined. Implementing the broader list would have been implementing a policy
 * the owner rejected, which is worse than implementing none.
 *
 * ─── ABSENCE IS NOT AUTHORITY ─────────────────────────────────────────────
 * A source that says nothing about a field does not win it by default. Sales
 * Navigator holds no email in any of our models; if it were treated as
 * authoritative-by-silence, every email would resolve to null. So an
 * authoritative source competes only when it has actually spoken.
 *
 * ─── A TIE IS REPORTED, NOT INVENTED AWAY ─────────────────────────────────
 * Equal `observedAt` and equal confidence yields `unresolved_tie` and a null
 * selection. Breaking it by source name or array order would be arbitrary
 * behaviour wearing determinism's clothes, and a caller cannot notice a silent
 * arbitrary choice. `PI-ADR-009` §6 leaves the tiebreak to a further decision.
 */

/** One source's claim about one attribute. Retained whether or not it wins. */
export interface SourceObservation {
  /** `source_records.provider` — free text, so a simulated source is visible as one. */
  readonly source: string;
  readonly attribute: string;
  readonly value: unknown;
  /** When the SOURCE observed it. Null means the source did not say. */
  readonly observedAt: string | null;
  /** Source-stated confidence, 0..1. Null means the source did not state one. */
  readonly confidence: number | null;
}

/**
 * The attributes Sales Navigator is authoritative for, and no others.
 *
 * `job_title` is the canonical attribute name for "current title". The employer
 * identity is carried as `company` here rather than as an account-attribute
 * name, because what Rule 1 settles is *which employer observation is current*,
 * not any firmographic fact about that employer.
 */
export const AUTHORITATIVE_ATTRIBUTES: readonly string[] = ['job_title', 'company'];

/**
 * Source keys that count as Sales Navigator.
 *
 * The simulated key (`salesnav-sim`) is included on purpose: the precedence rule
 * must behave identically for a simulated and a real Sales Navigator, or the
 * simulation would be proving something the production path does not do. Every
 * other source — including MarketPulse under `PI-ADR-008` — holds no authority.
 */
const AUTHORITATIVE_SOURCES: readonly string[] = [
  'salesnav',
  'salesnav-sim',
  'linkedin_sales_navigator',
];

export const isAuthoritativeSource = (source: string): boolean =>
  AUTHORITATIVE_SOURCES.includes(String(source ?? '').trim().toLowerCase());

export const isAuthoritativeAttribute = (attribute: string): boolean =>
  AUTHORITATIVE_ATTRIBUTES.includes(String(attribute ?? '').trim().toLowerCase());

/** Why the selected observation was selected. Stable; safe to branch on. */
export type PrecedenceRule =
  | 'authoritative_source'   // RULE 1
  | 'most_recent'            // RULE 2
  | 'higher_confidence'      // RULE 2, tiebreak
  | 'sole_observation'
  | 'unresolved_tie'         // RULE 2, admitted
  | 'no_observations';

export interface PrecedenceVerdict {
  /** Null when nothing could be selected — never a guess. */
  readonly selected: SourceObservation | null;
  readonly rule: PrecedenceRule;
  /** EVERY observation considered, winner included. RULE 3 made observable. */
  readonly retained: readonly SourceObservation[];
  /** True when more than one source made a differing claim. */
  readonly conflicted: boolean;
}

/** A source that said nothing is not a claim and never competes. */
const speaks = (o: SourceObservation): boolean =>
  o.value !== null && o.value !== undefined && String(o.value).trim() !== '';

const instant = (o: SourceObservation): number => {
  if (!o.observedAt) return Number.NEGATIVE_INFINITY;
  const t = Date.parse(o.observedAt);
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
};

const confidenceOf = (o: SourceObservation): number =>
  typeof o.confidence === 'number' && Number.isFinite(o.confidence)
    ? o.confidence
    : Number.NEGATIVE_INFINITY;

/**
 * Select the canonical observation for one attribute.
 *
 * `retained` always carries every observation passed in, in input order,
 * including ones that did not compete. That is Rule 3: a caller can always
 * re-decide from the same evidence if the precedence contract changes.
 */
export function selectCanonicalObservation(
  observations: readonly SourceObservation[],
  attribute: string,
): PrecedenceVerdict {
  const all = observations.filter((o) => o.attribute === attribute);
  const retained = all;

  const claims = all.filter(speaks);
  const distinctValues = new Set(claims.map((c) => String(c.value)));
  const conflicted = distinctValues.size > 1;

  if (!claims.length) return { selected: null, rule: 'no_observations', retained, conflicted: false };
  if (claims.length === 1) {
    return { selected: claims[0], rule: 'sole_observation', retained, conflicted: false };
  }

  // ── RULE 1 ───────────────────────────────────────────────────────────────
  if (isAuthoritativeAttribute(attribute)) {
    const authoritative = claims.filter((c) => isAuthoritativeSource(c.source));
    if (authoritative.length === 1) {
      return { selected: authoritative[0], rule: 'authoritative_source', retained, conflicted };
    }
    if (authoritative.length > 1) {
      // Two Sales Navigator observations of the same field: the newer snapshot
      // is the current one. Still Rule 1 — the authority held; recency only
      // chose between two holders of it.
      const newest = [...authoritative].sort((a, b) => instant(b) - instant(a));
      if (instant(newest[0]) > instant(newest[1])) {
        return { selected: newest[0], rule: 'authoritative_source', retained, conflicted };
      }
      return { selected: null, rule: 'unresolved_tie', retained, conflicted };
    }
    // None: absence is not authority — fall through to RULE 2.
  }

  // ── RULE 2 ───────────────────────────────────────────────────────────────
  const byRecency = [...claims].sort((a, b) => instant(b) - instant(a));
  if (instant(byRecency[0]) > instant(byRecency[1])) {
    return { selected: byRecency[0], rule: 'most_recent', retained, conflicted };
  }

  const newestInstant = instant(byRecency[0]);
  const tied = claims.filter((c) => instant(c) === newestInstant);
  const byConfidence = [...tied].sort((a, b) => confidenceOf(b) - confidenceOf(a));
  if (confidenceOf(byConfidence[0]) > confidenceOf(byConfidence[1])) {
    return { selected: byConfidence[0], rule: 'higher_confidence', retained, conflicted };
  }

  return { selected: null, rule: 'unresolved_tie', retained, conflicted };
}

/**
 * Select across every attribute present, in one pass.
 *
 * Returned as a map so a caller can show the canonical value AND the evidence
 * behind it without a second traversal — which is what makes a conflict
 * inspectable in a UI rather than merely retained in a table.
 */
export function selectCanonicalObservations(
  observations: readonly SourceObservation[],
): Readonly<Record<string, PrecedenceVerdict>> {
  const attributes = [...new Set(observations.map((o) => o.attribute))];
  const out: Record<string, PrecedenceVerdict> = {};
  for (const a of attributes) out[a] = selectCanonicalObservation(observations, a);
  return out;
}
