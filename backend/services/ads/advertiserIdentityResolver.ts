/**
 * PO-3 — advertiser identity resolution. PURE.
 *
 * Decides whether a publicly observed Google Ads Transparency advertiser IS the current Report 1
 * subject. No network, no database, no clock, no environment — inputs in, decision out — so the
 * rule is testable directly rather than inferred from acquisition output.
 *
 * ─── THE ONE RULE THIS FILE EXISTS TO ENFORCE ─────────────────────────────
 * Ads pointing AT a company's domain are not ads run BY that company. Two observations proved it:
 * `?domain=calendly.com` returned `~10K ads` behind four verified advertisers — none of them
 * Calendly — and the same query from a second continent returned four DIFFERENT advertisers, also
 * none of them Calendly. `?domain=hubspot.com` returned `~4K ads` across the genuine advertiser
 * plus an Indonesian education company and a private individual.
 *
 * So a destination domain can never reach `MATCHED` here. It is not an input to this function at
 * all: there is no parameter it could arrive through, which makes the guarantee structural rather
 * than remembered.
 *
 * ─── WHY THE SUBJECT SIDE NEEDS A DECLARED LEGAL NAME ─────────────────────
 * `wbsearchentities('Wix')` ranks an English village above the company, and the Ads Transparency
 * search for `Wix` returns seven verified advertisers sharing the token — `WIX.EG` (Egypt),
 * `Jason Wix` (US), `WIXI株式会社` (Japan), `Wixdek LTD` (UK), `LE PRO WIX` (Canada), `Wix Games`
 * (UK) and `WIX.COM LTD` (Israel). A brand token cannot separate them. `Wix.com Ltd`, declared by
 * the site itself, separates all seven on one exact comparison.
 *
 * Matching a Wikidata LABEL against Google's legal name was considered and rejected: both are
 * brand strings derived from the same public usage, so agreement between them demonstrates only
 * that two systems know the brand. That is correlated evidence, not corroboration.
 */

/** What the Ads Transparency advertiser profile publicly exposes. Observation, not conclusion. */
export interface ObservedAdvertiser {
  /** Durable public identifier from the profile URL, e.g. `AR06627928574101815297`. */
  advertiserId: string;
  /** The profile's `Legal name:` field. NOTE: not always a legal entity name — HubSpot's reads `HubSpot`. */
  legalName: string | null;
  /** The profile's `Based in:` field, e.g. `the Netherlands`. Corroboration only. */
  basedIn: string | null;
  /** Google's own `Advertiser has verified their identity` assertion. */
  verified: boolean;
  /** Google's own `Multiple advertiser accounts have a similar name` warning. */
  ambiguityFlagged: boolean;
}

/** What Report 1 can establish about the subject from PUBLIC evidence. */
export interface SubjectIdentity {
  /**
   * Class A — `Organization.legalName` declared by the subject's own website.
   * The ONLY anchor that can reach `MATCHED`. Null when the site declares none.
   */
  declaredLegalName: string | null;
  /** Class C/D — brand or trading name. Never sufficient; carried to explain a refusal. */
  brandName: string | null;
  /** Publicly evidenced jurisdiction (JSON-LD `addressCountry`, or Wikidata country). Corroboration only. */
  jurisdiction: string | null;
  /** True when the subject's Wikidata entity was domain-verified via `P856`. Supporting only. */
  wikidataDomainVerified: boolean;
}

export type AdvertiserResolutionState =
  | 'MATCHED'
  | 'PROBABLE_MATCH'
  | 'NOT_MATCHED'
  | 'UNRESOLVED'
  | 'INSUFFICIENT_EVIDENCE';

export interface AdvertiserResolution {
  advertiserId: string;
  state: AdvertiserResolutionState;
  /** Why this state was reached, in terms a reader can check against the evidence. */
  basis: string;
  /** True only for `MATCHED`. The single gate every customer-facing company claim must pass. */
  eligibleForCompanyClaim: boolean;
}

/**
 * Deterministic name normalisation for legal-name comparison.
 *
 * Case, Unicode, punctuation and whitespace ONLY. Explicitly NOT done: legal-suffix stripping,
 * abbreviation expansion, token or phonetic similarity, substring matching, embeddings.
 *
 * Suffix stripping is the tempting one and it is the dangerous one: it would turn `Wix` into a
 * match for `WIX.COM LTD` and `Booking.com` into a match for `Booking.com B.V.`, which is the
 * brand-token match this whole design exists to refuse. The suffix carries the meaning.
 */
export function normalizeLegalName(value: string | null | undefined): string | null {
  const raw = String(value ?? '').normalize('NFKC').trim();
  if (!raw) return null;
  const normalized = raw
    .toLowerCase()
    .replace(/[.,''‘’"“”()]/g, '')
    .replace(/[\s\-_/]+/g, ' ')
    .trim();
  return normalized || null;
}

/** Deterministic jurisdiction comparison. `the Netherlands` ≡ `Netherlands`; `NL` is NOT expanded. */
export function jurisdictionsAgree(subject: string | null, advertiser: string | null): boolean {
  const norm = (v: string | null) => {
    const s = String(v ?? '').normalize('NFKC').toLowerCase().replace(/^the\s+/, '').replace(/[.,]/g, '').trim();
    return s || null;
  };
  const a = norm(subject);
  const b = norm(advertiser);
  return a !== null && b !== null && a === b;
}

/**
 * Resolve ONE observed advertiser against the subject. Called per advertiser: a company may hold
 * several legitimate accounts (Wix in Israel and the US; Booking.com in the Netherlands and the
 * UK), so nothing here collapses a set into a single best match.
 *
 * The conditions are evaluated in refusal-first order. Each returns its own basis string, because
 * "we did not attribute this" is only useful to a reader who can see why.
 */
export function resolveAdvertiserIdentity(
  subject: SubjectIdentity,
  advertiser: ObservedAdvertiser,
): AdvertiserResolution {
  const deny = (state: AdvertiserResolutionState, basis: string): AdvertiserResolution => ({
    advertiserId: advertiser.advertiserId,
    state,
    basis,
    eligibleForCompanyClaim: false,
  });

  // The profile did not yield an identity to reason about.
  if (!advertiser.legalName || !normalizeLegalName(advertiser.legalName)) {
    return deny('INSUFFICIENT_EVIDENCE', 'The advertiser profile exposed no legal name to compare.');
  }

  const advertiserName = normalizeLegalName(advertiser.legalName) as string;
  const subjectLegal = normalizeLegalName(subject.declaredLegalName);

  // The provider's own ambiguity warning blocks BOTH directions, and the symmetry is the point.
  //
  // `Multiple advertiser accounts have a similar name` is Google saying it cannot cleanly separate
  // these accounts by name. Attribution is obviously unsafe then — but so is EXCLUSION, and that
  // is the easier mistake. `Wix.com Inc.` (US, flagged) differs from the declared `Wix.com Ltd`
  // only by legal form and is very likely the same group's US entity; answering "this is not your
  // advertising" would be a false exclusion about a company's own subsidiary.
  //
  // Establishing that the two names ARE related would require similarity matching, which §5
  // prohibits outright. So the honest output is "we could not tell", not a confident negative.
  if (advertiser.ambiguityFlagged) {
    if (subjectLegal && advertiserName === subjectLegal) {
      return deny(
        'PROBABLE_MATCH',
        'The legal names agree, but the provider flags multiple advertiser accounts with a similar name, so this account is not attributed.',
      );
    }
    return deny(
      'UNRESOLVED',
      'The provider flags multiple advertiser accounts with a similar name, so this account can be neither attributed nor excluded on its name.',
    );
  }

  // Class-A anchor absent ⇒ MATCHED is unreachable for this subject, whatever the advertiser shows.
  // This is the common case and it is not a failure: the advertiser is still reportable as a
  // candidate, and unrelated advertisers are still reportable as third parties.
  if (!subjectLegal) {
    const brand = normalizeLegalName(subject.brandName);
    if (brand && brand === advertiserName) {
      return deny(
        'PROBABLE_MATCH',
        'The advertiser name equals the subject brand name, but the site declares no legal name, so ownership is not established.',
      );
    }
    return deny(
      'UNRESOLVED',
      'The subject publishes no Organization.legalName, so the advertiser could not be attributed or excluded.',
    );
  }

  // Strong contradiction. Deliberately a LOWER bar than attribution: a false exclusion
  // under-reports, a false attribution fabricates.
  if (advertiserName !== subjectLegal) {
    if (advertiser.verified) {
      return deny(
        'NOT_MATCHED',
        `A different verified legal name (${advertiser.legalName}) — a separate entity, not this company.`,
      );
    }
    return deny('UNRESOLVED', 'The advertiser name differs from the declared legal name and is unverified.');
  }

  // Names agree, and the provider raised no ambiguity, from here on.

  // Google's verification is what makes the advertiser side an independent assertion rather than
  // another copy of the public brand string.
  if (!advertiser.verified) {
    return deny(
      'PROBABLE_MATCH',
      'The legal names agree but the advertiser identity is not provider-verified.',
    );
  }

  // Jurisdiction corroborates; it never substitutes for identity. Absent on either side is not a
  // contradiction — a multinational legitimately spans several (Wix: Israel and the US).
  const bothJurisdictionsKnown = Boolean(subject.jurisdiction && advertiser.basedIn);
  if (bothJurisdictionsKnown && !jurisdictionsAgree(subject.jurisdiction, advertiser.basedIn)) {
    return deny(
      'PROBABLE_MATCH',
      `The legal names agree but the jurisdictions differ (subject ${subject.jurisdiction} vs advertiser ${advertiser.basedIn}).`,
    );
  }

  return {
    advertiserId: advertiser.advertiserId,
    state: 'MATCHED',
    basis: bothJurisdictionsKnown
      ? `Website-declared legal name matches the provider-verified advertiser legal name, and the jurisdiction (${advertiser.basedIn}) corroborates.`
      : 'Website-declared legal name matches the provider-verified advertiser legal name.',
    eligibleForCompanyClaim: true,
  };
}

/**
 * Resolve a candidate set. Order and multiplicity are preserved: several `MATCHED` accounts is a
 * correct outcome, not a conflict to collapse.
 */
export function resolveAdvertiserSet(
  subject: SubjectIdentity,
  advertisers: readonly ObservedAdvertiser[],
): AdvertiserResolution[] {
  return advertisers.map((a) => resolveAdvertiserIdentity(subject, a));
}
