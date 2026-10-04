/**
 * WP-9 / PO-3 — the presentation model for publicly observed advertising.
 *
 * ─── WHY A SEPARATE, PURE MODULE ──────────────────────────────────────────
 * Every customer-facing safety decision about advertising is a DERIVATION, not a layout choice:
 * whether ownership may be stated, which wording a resolution state earns, and whether an ad
 * count may be placed next to the company's name. Deriving them here — pure, no React — means
 * they are testable without a DOM and cannot be re-derived differently by a second renderer.
 *
 * The authority on wording and on the guards is the HTML export
 * (`backend/services/intelligence/exportRendererReport1.ts` -> `renderPublicAdvertising`).
 * This module reproduces its semantics; it does not invent new claims.
 *
 * TWO RULES THIS MODULE EXISTS TO ENFORCE
 *  1. Internal resolver values (MATCHED / PROBABLE_MATCH / NOT_MATCHED / UNRESOLVED /
 *     INSUFFICIENT_EVIDENCE, and the `eligibleForCompanyClaim` gate) never reach a customer.
 *     They are translated to plain language here and the raw string is never carried onto the view.
 *  2. Not being able to observe advertising is NEVER rendered as the company not advertising.
 */

import type { ReportViewAdvertising } from '@/pages/api/reports/reportViewPayloadTypes';

type AdvertiserRecord = ReportViewAdvertising['companyAdvertisers'][number];

/**
 * What the public record established about ONE advertiser, in customer terms.
 *
 * Deliberately a different vocabulary from the resolver's own state: those are an audit trail,
 * these are what a reader is allowed to conclude.
 */
export type AdvertisingEvidenceState =
  | 'observed'
  | 'inferred'
  | 'separate_entity'
  | 'insufficient_evidence'
  | 'unresolved';

export type AdvertisingEvidencePresentation = {
  state: AdvertisingEvidenceState;
  /** The chip text. Never an internal state name. */
  label: string;
  /** One sentence a reader can check against the basis line. */
  meaning: string;
  /** Visual tone key — the component maps it to classes; tests assert the key. */
  tone: 'positive' | 'probable' | 'neutral' | 'muted';
};

const EVIDENCE_PRESENTATION: Record<AdvertisingEvidenceState, AdvertisingEvidencePresentation> = {
  observed: {
    state: 'observed',
    label: 'Observed',
    meaning:
      'The advertiser’s provider-verified legal name matches the legal name your own website declares.',
    tone: 'positive',
  },
  inferred: {
    state: 'inferred',
    label: 'Likely, not confirmed',
    meaning:
      'The public evidence points towards you but stops short of confirming ownership, so this account is not reported as yours.',
    tone: 'probable',
  },
  separate_entity: {
    state: 'separate_entity',
    label: 'Separate advertiser',
    meaning:
      'A different verified legal entity. This is someone else’s advertising pointing at your domain.',
    tone: 'neutral',
  },
  insufficient_evidence: {
    state: 'insufficient_evidence',
    label: 'Insufficient evidence',
    meaning: 'The public profile did not expose enough identity information to decide either way.',
    tone: 'muted',
  },
  unresolved: {
    state: 'unresolved',
    label: 'Could not be resolved',
    meaning: 'On the public evidence this account can be neither attributed to you nor excluded.',
    tone: 'muted',
  },
};

/**
 * Translate the resolver's internal state into a customer-facing one.
 *
 * An unrecognised value falls through to `unresolved` rather than being echoed: a state this
 * renderer has not been taught about must not become a claim, and must not leak its own name.
 */
export function toEvidenceState(resolutionState: string | null | undefined): AdvertisingEvidenceState {
  switch (String(resolutionState ?? '').trim().toUpperCase()) {
    case 'MATCHED':
      return 'observed';
    case 'PROBABLE_MATCH':
      return 'inferred';
    case 'NOT_MATCHED':
      return 'separate_entity';
    case 'INSUFFICIENT_EVIDENCE':
      return 'insufficient_evidence';
    default:
      return 'unresolved';
  }
}

export function evidencePresentation(
  state: AdvertisingEvidenceState,
): AdvertisingEvidencePresentation {
  return EVIDENCE_PRESENTATION[state] ?? EVIDENCE_PRESENTATION.unresolved;
}

/** Whether the subject could be identified well enough for ownership to be decidable at all. */
export type AdvertisingIdentityState = 'legal_name_declared' | 'legal_name_not_declared';

/** Per-advertiser identity assurance, as the provider stated it. */
export type AdvertiserIdentityState = 'provider_verified' | 'unverified' | 'ambiguous';

export type AdvertisingFreshness = {
  observedAtIso: string | null;
  /** `YYYY-MM-DD`, matching the export footer. */
  observedOnLabel: string | null;
  ageDays: number | null;
  ageLabel: string;
  tone: 'fresh' | 'recent' | 'ageing' | 'unknown';
};

/**
 * Observation age.
 *
 * Freshness is first-class because the underlying record is time-dependent: the same query run a
 * week apart legitimately returns different advertisers. A reader who cannot see when the look
 * happened cannot judge what the absence of a result means.
 */
export function buildFreshness(
  observedAt: string | null | undefined,
  now: Date,
): AdvertisingFreshness {
  const raw = typeof observedAt === 'string' ? observedAt.trim() : '';
  const parsed = raw ? new Date(raw) : null;
  if (!raw || !parsed || Number.isNaN(parsed.getTime())) {
    return {
      observedAtIso: raw || null,
      observedOnLabel: null,
      ageDays: null,
      ageLabel: 'Observation date not recorded',
      tone: 'unknown',
    };
  }

  const ageDays = Math.max(0, Math.floor((now.getTime() - parsed.getTime()) / 86400000));
  const ageLabel =
    ageDays === 0
      ? 'Observed today'
      : ageDays === 1
        ? 'Observed 1 day ago'
        : 'Observed ' + String(ageDays) + ' days ago';
  const tone: AdvertisingFreshness['tone'] =
    ageDays <= 7 ? 'fresh' : ageDays <= 30 ? 'recent' : 'ageing';

  return { observedAtIso: raw, observedOnLabel: raw.slice(0, 10), ageDays, ageLabel, tone };
}

/**
 * Geography, split by what it actually describes.
 *
 * `searchVantage` is where the public record was READ FROM; `advertiserLocations` are the
 * provider's stated home jurisdictions of the advertisers. Neither is the geographic targeting of
 * a campaign, and this type refuses to let a renderer blur them: the delivery scope of an ad is
 * not carried by the contract at this commit — see `campaignScopeAvailable`.
 */
export type AdvertisingGeography = {
  searchVantage: string | null;
  advertiserLocations: string[];
  /** SEAM (WP-1): per-ad geographic targeting is not in the model yet. Always false today. */
  campaignScopeAvailable: false;
};

/**
 * The observed surface.
 *
 * SEAM (WP-1): the contract carries a single `source` discriminator, not a per-ad `platform`.
 * Until that field exists there is exactly one surface to name, and naming a platform per ad
 * would be fabrication.
 */
export type AdvertisingSurface = {
  sourceLabel: string;
  /** SEAM (WP-1): per-advertiser / per-ad platform attribution. Always false today. */
  platformsAvailable: false;
};

export type AdvertiserView = {
  key: string;
  advertiserId: string;
  displayName: string;
  /** False when the provider exposed no legal name — the display name is then a placeholder. */
  nameDeclared: boolean;
  identityState: AdvertiserIdentityState;
  basedIn: string | null;
  /**
   * The provider's own rounded label for THIS advertiser. Carried only for advertisers resolved
   * to the company: an ad count beside an unattributed advertiser reads as the company's.
   */
  adCountLabel: string | null;
  basis: string;
  evidence: AdvertisingEvidencePresentation;
  creativeCount: number;
  profileUrl: string | null;
};

/** What may be said about whether the company itself advertises. */
export type AdvertisingOwnership =
  | { kind: 'company_advertisers_found' }
  | { kind: 'none_found_with_declared_name'; subjectLegalName: string }
  | { kind: 'ownership_not_establishable' };

export type PublicAdvertisingView = {
  /** `observed` = the public surface was read. Anything else = we could not look. */
  sectionState: 'observed' | 'unavailable';
  /** Present only when `sectionState === 'unavailable'`. Never phrased as absence of advertising. */
  unavailableReason: string | null;
  identityState: AdvertisingIdentityState;
  ownership: AdvertisingOwnership;
  freshness: AdvertisingFreshness;
  geography: AdvertisingGeography;
  surface: AdvertisingSurface;
  companyAdvertisers: AdvertiserView[];
  otherAdvertisers: AdvertiserView[];
  /** Ads pointing AT the domain. Belongs to the third-party paragraph and nowhere else. */
  domainAdCountLabel: string | null;
  advertiserAccountsDiscovered: number;
};

function safeProfileUrl(value: string | null | undefined): string | null {
  const raw = typeof value === 'string' ? value.trim() : '';
  return /^https?:\/\//i.test(raw) ? raw : null;
}

function toAdvertiserView(record: AdvertiserRecord, index: number, owned: boolean): AdvertiserView {
  const legalName = typeof record?.legalName === 'string' ? record.legalName.trim() : '';
  const identityState: AdvertiserIdentityState = record?.ambiguityFlagged
    ? 'ambiguous'
    : record?.verified
      ? 'provider_verified'
      : 'unverified';
  const basedIn =
    typeof record?.basedIn === 'string' && record.basedIn.trim() ? record.basedIn.trim() : null;
  const adCountLabel =
    typeof record?.adCountLabel === 'string' && record.adCountLabel.trim()
      ? record.adCountLabel.trim()
      : null;

  return {
    key: (owned ? 'company-' : 'other-') + String(record?.advertiserId ?? index) + '-' + String(index),
    advertiserId: String(record?.advertiserId ?? ''),
    displayName: legalName || 'Unnamed advertiser',
    nameDeclared: Boolean(legalName),
    identityState,
    basedIn,
    // The count is carried ONLY for the company's own advertisers — see the field comment.
    adCountLabel: owned ? adCountLabel : null,
    basis: typeof record?.resolutionBasis === 'string' ? record.resolutionBasis : '',
    evidence: evidencePresentation(
      // Advertisers in `companyAdvertisers` were partitioned upstream by the single ownership
      // gate, which only `MATCHED` passes. Trusting the ARRAY rather than re-reading the state is
      // what keeps this renderer from re-deriving ownership.
      owned ? 'observed' : toEvidenceState(record?.resolutionState),
    ),
    creativeCount: Array.isArray(record?.creativeIds) ? record.creativeIds.length : 0,
    profileUrl: safeProfileUrl(record?.profileUrl),
  };
}

/**
 * Build the view, or return `null` when there is nothing to show.
 *
 * `null` is the important case: a report with no advertising observation must render NOTHING.
 * Rendering an empty section would itself assert that we looked and found nothing, which is the
 * one claim this whole surface exists to avoid.
 */
export function buildPublicAdvertisingView(
  advertising: ReportViewAdvertising | null | undefined,
  now: Date = new Date(),
): PublicAdvertisingView | null {
  if (!advertising || typeof advertising !== 'object') return null;

  const companyRecords = Array.isArray(advertising.companyAdvertisers)
    ? advertising.companyAdvertisers
    : [];
  const otherRecords = Array.isArray(advertising.otherAdvertisers) ? advertising.otherAdvertisers : [];
  const subjectLegalNameUsed =
    typeof advertising.subjectLegalNameUsed === 'string' && advertising.subjectLegalNameUsed.trim()
      ? advertising.subjectLegalNameUsed.trim()
      : null;

  const observed = advertising.accessState === 'observed';

  // Reproduces the export's honest-absence condition: "none found" is only truthful when discovery
  // actually ran against an identity capable of confirming ownership.
  const ownership: AdvertisingOwnership =
    companyRecords.length > 0
      ? { kind: 'company_advertisers_found' }
      : subjectLegalNameUsed !== null
        ? { kind: 'none_found_with_declared_name', subjectLegalName: subjectLegalNameUsed }
        : { kind: 'ownership_not_establishable' };

  const companyAdvertisers = companyRecords.map((r, i) => toAdvertiserView(r, i, true));
  const otherAdvertisers = otherRecords.map((r, i) => toAdvertiserView(r, i, false));

  const vantage =
    typeof advertising.vantage === 'string' && advertising.vantage.trim()
      ? advertising.vantage.trim()
      : null;

  const advertiserLocations: string[] = [];
  for (const entry of companyAdvertisers.concat(otherAdvertisers)) {
    if (entry.basedIn && advertiserLocations.indexOf(entry.basedIn) === -1) {
      advertiserLocations.push(entry.basedIn);
    }
  }

  const counts = advertising.counts;
  const domainAdCountLabel =
    typeof counts?.domainAdCountLabel === 'string' && counts.domainAdCountLabel.trim()
      ? counts.domainAdCountLabel.trim()
      : null;

  return {
    sectionState: observed ? 'observed' : 'unavailable',
    unavailableReason: observed
      ? null
      : typeof advertising.reason === 'string' && advertising.reason.trim()
        ? advertising.reason.trim()
        : 'Public advertising evidence could not be established for this report.',
    identityState: subjectLegalNameUsed !== null ? 'legal_name_declared' : 'legal_name_not_declared',
    ownership,
    freshness: buildFreshness(advertising.observedAt, now),
    geography: { searchVantage: vantage, advertiserLocations, campaignScopeAvailable: false },
    surface: { sourceLabel: 'Public Ads Transparency Center', platformsAvailable: false },
    companyAdvertisers,
    otherAdvertisers,
    domainAdCountLabel,
    advertiserAccountsDiscovered: Number.isFinite(counts?.advertiserAccountsDiscovered)
      ? Number(counts.advertiserAccountsDiscovered)
      : 0,
  };
}
