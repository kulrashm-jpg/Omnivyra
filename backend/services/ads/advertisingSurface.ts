/**
 * PO-3 Phase 4 — turn an advertising observation into the Report 1 surface. PURE.
 *
 * The split into `companyAdvertisers` / `otherAdvertisers` happens HERE, once, driven by the
 * resolver's `eligibleForCompanyClaim` and nothing else. Doing it at the boundary means the
 * renderer never has to re-derive ownership, and cannot get it wrong: by the time a record reaches
 * a template it is already in the array that determines what may be said about it.
 */
import type { AdsObservationResult } from './adsTransparencyObservation';
import type { SnapshotAdvertiserRecord, SnapshotAdvertising } from '../snapshotReportTypes';

export function buildAdvertisingSurface(params: {
  observation: AdsObservationResult;
  /** The subject legal name resolution ran against. Null ⇒ MATCHED was structurally unreachable. */
  subjectLegalNameUsed: string | null;
}): SnapshotAdvertising {
  const { observation } = params;

  const toRecord = (
    entry: AdsObservationResult['advertisers'][number],
  ): SnapshotAdvertiserRecord => ({
    // WP-1 — carried per record as well as on the surface. A surface describes ONE observation, so
    // today both always agree; the record-level field is what lets a later renderer group or label
    // advertisers once observations from more than one platform can be presented together, without
    // the surface contract having to change again at that point.
    platform: observation.platform,
    advertiserId: entry.observation.advertiserId,
    legalName: entry.observation.legalName,
    basedIn: entry.observation.basedIn,
    verified: entry.observation.verified,
    ambiguityFlagged: entry.observation.ambiguityFlagged,
    adCountLabel: entry.observation.adCountLabel,
    creativeIds: entry.observation.creativeIds,
    profileUrl: entry.observation.profileUrl,
    resolutionState: entry.resolution.state,
    resolutionBasis: entry.resolution.basis,
    discoveredVia: entry.discoveredVia,
  });

  // The ONLY partition rule. `eligibleForCompanyClaim` is true for `MATCHED` alone.
  const companyAdvertisers = observation.advertisers
    .filter((a) => a.resolution.eligibleForCompanyClaim)
    .map(toRecord);
  const otherAdvertisers = observation.advertisers
    .filter((a) => !a.resolution.eligibleForCompanyClaim)
    .map(toRecord);

  return {
    // WP-1 — the platform this surface is about, taken from the observation rather than assumed by
    // the renderer. `source` stays `ads_transparency`: that is the evidence SURFACE key the
    // provenance map and the canonical report type already use, and it is a different dimension
    // from which platform was advertised on.
    platform: observation.platform,
    accessState: observation.accessState,
    reason: observation.reason,
    source: 'ads_transparency',
    provenance: 'PUBLIC_OBSERVED',
    vantage: observation.vantage,
    observedAt: observation.observedAt,
    subjectLegalNameUsed: params.subjectLegalNameUsed,
    companyAdvertisers,
    otherAdvertisers,
    counts: {
      // Carried for the third-party statement only. There is deliberately no field on this object
      // that aggregates it into a company total.
      domainAdCountLabel: observation.counts.domainAdCountLabel,
      advertiserAccountsDiscovered: observation.counts.advertiserAccountsDiscovered,
      matchedAdvertiserAccounts: companyAdvertisers.length,
    },
  };
}

/**
 * Whether the report may state that no verified company advertising was found.
 *
 * Permitted only when discovery actually ran against a subject identity capable of reaching
 * `MATCHED`. Without a declared legal name the honest statement is "ownership not established",
 * because the search could not have confirmed ownership even if the company does advertise.
 */
export function mayStateNoVerifiedCompanyAdvertising(surface: SnapshotAdvertising): boolean {
  return (
    surface.accessState === 'observed'
    && surface.subjectLegalNameUsed !== null
    && surface.companyAdvertisers.length === 0
  );
}
