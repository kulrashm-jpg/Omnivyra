/**
 * PO-3 Phase 2 — public Google Ads Transparency observation.
 *
 * Orchestration only. Every provider interaction arrives through an injected client, exactly as
 * `socialPresenceObservation` injects `fetchSerp`, so this module adds no provider, no credential,
 * no browser and no retry policy of its own, and its behaviour is testable without a network.
 *
 * ─── DISCOVERY ORDER IS THE EVIDENCE RULE ─────────────────────────────────
 * Advertiser-NAME discovery is primary. A destination-domain query is secondary and produces
 * CANDIDATES ONLY — never an ownership claim, never a company ad count. Both PO-3a observations
 * showed why: `?domain=hubspot.com` returned `~4K ads` across the genuine advertiser plus an
 * Indonesian education company and a private individual, and `?domain=calendly.com` returned eight
 * distinct advertisers across two vantages, none of them the subject.
 *
 * Every candidate — whichever path found it — is resolved by the pure resolver against the
 * subject's own declared identity before anything can be called the company's advertising.
 */
import {
  resolveAdvertiserIdentity,
  type AdvertiserResolution,
  type ObservedAdvertiser,
  type SubjectIdentity,
} from './advertiserIdentityResolver';

/** How the attempt to reach a public surface ended. Distinct from what the surface said. */
export type AdsAccessState =
  | 'observed'
  | 'blocked'
  | 'restricted'
  | 'requires_auth'
  | 'unreachable'
  | 'unavailable';

/** A row in the provider's advertiser-name suggestion panel. */
export interface AdvertiserSuggestion {
  advertiserId: string | null;
  name: string;
  basedIn: string | null;
  verified: boolean;
  ambiguityFlagged: boolean;
  /** Provider-stated, provider-rounded, e.g. `~200 ads`. Never re-derived into an integer. */
  adCountLabel: string | null;
}

/** What the public advertiser profile exposed. */
export interface AdvertiserProfileObservation {
  advertiserId: string;
  legalName: string | null;
  basedIn: string | null;
  verified: boolean;
  ambiguityFlagged: boolean;
  /** Provider-stated approximation, e.g. `~300 ads`. Carried verbatim. */
  adCountLabel: string | null;
  creativeIds: string[];
  profileUrl: string;
  artifactRef?: string | null;
}

/** Result of the secondary destination-domain query. CANDIDATES ONLY. */
export interface DomainCandidateObservation {
  /** Provider-stated count of ads pointing AT the domain. NOT a company ad count. */
  domainAdCountLabel: string | null;
  advertiserIds: string[];
}

/**
 * The provider seam. Production supplies a browser-backed implementation on the Railway plane;
 * tests supply a fake. Every method may throw — the orchestrator maps failure to an access state
 * and never to an absence of advertising.
 */
export interface AdsTransparencyClient {
  searchAdvertisers(name: string): Promise<AdvertiserSuggestion[]>;
  openAdvertiser(advertiserId: string): Promise<AdvertiserProfileObservation | null>;
  searchByDomain?(domain: string): Promise<DomainCandidateObservation>;
}

export interface AdsObservationParams {
  subject: SubjectIdentity;
  /** Names to search. The subject's declared legal name first, then its brand name. */
  searchNames: readonly string[];
  /** Secondary discovery only. Present so candidates can be found; never an ownership input. */
  destinationDomain?: string | null;
  client: AdsTransparencyClient;
  /** Where the observation was made from. First-class: results are vantage-dependent. */
  vantage: string;
  now?: () => Date;
  /** Hard ceiling on advertiser profiles opened per report. */
  maxProfiles?: number;
}

export interface AdsAdvertiserRecord {
  observation: AdvertiserProfileObservation;
  resolution: AdvertiserResolution;
  /** Which discovery path surfaced this candidate. Recorded, never used to resolve identity. */
  discoveredVia: 'advertiser_name' | 'destination_domain';
}

export interface AdsObservationResult {
  accessState: AdsAccessState;
  /** Why, when the state is not `observed`. Never phrased as an absence of advertising. */
  reason: string | null;
  vantage: string;
  observedAt: string;
  advertisers: AdsAdvertiserRecord[];
  /**
   * Six quantities that must never be conflated. `domainAdCountLabel` in particular is the count
   * of ads pointing AT the domain and is NOT this company's ad count.
   */
  counts: {
    domainAdCountLabel: string | null;
    advertiserAccountsDiscovered: number;
    candidateAdvertisers: number;
    matchedAdvertiserAccounts: number;
  };
}

const DEFAULT_MAX_PROFILES = 6;

/** Map a thrown provider error to an access state. Absence of access is never absence of ads. */
export function accessStateFromError(error: unknown): { state: AdsAccessState; reason: string } {
  const message = (error instanceof Error ? error.message : String(error ?? '')).toLowerCase();
  if (/sign in|log in|auth/.test(message)) {
    return { state: 'requires_auth', reason: 'The public surface required sign-in for this view.' };
  }
  if (/captcha|robot|unusual traffic|bot/.test(message)) {
    return { state: 'blocked', reason: 'The provider challenged the request; no bypass was attempted.' };
  }
  if (/region|not available in your/.test(message)) {
    return { state: 'restricted', reason: 'The provider did not serve this surface to the observation vantage.' };
  }
  if (/timeout|timed out|econnreset|enotfound|network|navigation/.test(message)) {
    return { state: 'unreachable', reason: 'The public surface could not be reached for this report.' };
  }
  return { state: 'unavailable', reason: 'Public advertising evidence could not be acquired for this report.' };
}

/**
 * Observe the company's publicly visible Google advertising.
 *
 * Returns the resolver's verdict per advertiser. It deliberately does NOT return a company ad
 * count: that number exists only on an advertiser whose identity resolved to `MATCHED`, and the
 * caller reads it from `observation.adCountLabel` on that record.
 */
export async function observePublicAdvertising(
  params: AdsObservationParams,
): Promise<AdsObservationResult> {
  const now = params.now ?? (() => new Date());
  const observedAt = now().toISOString();
  const maxProfiles = Math.max(1, params.maxProfiles ?? DEFAULT_MAX_PROFILES);

  const base = (over: Partial<AdsObservationResult>): AdsObservationResult => ({
    accessState: 'unavailable',
    reason: null,
    vantage: params.vantage,
    observedAt,
    advertisers: [],
    counts: {
      domainAdCountLabel: null,
      advertiserAccountsDiscovered: 0,
      candidateAdvertisers: 0,
      matchedAdvertiserAccounts: 0,
    },
    ...over,
  });

  const names = params.searchNames.map((n) => String(n ?? '').trim()).filter(Boolean);
  if (names.length === 0 && !params.destinationDomain) {
    return base({
      accessState: 'unavailable',
      reason: 'No public identity anchor was available to search the advertiser index with.',
    });
  }

  // ── Discovery ────────────────────────────────────────────────────────────
  // `via` records HOW a candidate was found, for the evidence trail. It is never consulted by the
  // resolver: a candidate found by domain gets exactly the same identity test as one found by name.
  const candidates = new Map<string, 'advertiser_name' | 'destination_domain'>();
  let domainAdCountLabel: string | null = null;
  let anyDiscoveryRan = false;

  for (const name of names) {
    try {
      const suggestions = await params.client.searchAdvertisers(name);
      anyDiscoveryRan = true;
      for (const s of suggestions) {
        if (s.advertiserId && !candidates.has(s.advertiserId)) {
          candidates.set(s.advertiserId, 'advertiser_name');
        }
      }
    } catch (error) {
      const { state, reason } = accessStateFromError(error);
      return base({ accessState: state, reason });
    }
  }

  if (params.destinationDomain && params.client.searchByDomain) {
    try {
      const byDomain = await params.client.searchByDomain(params.destinationDomain);
      anyDiscoveryRan = true;
      // Recorded as provider-stated context. It can never become a company ad count: only a
      // MATCHED advertiser's own count is eligible for that, and this value is not it.
      domainAdCountLabel = byDomain.domainAdCountLabel;
      for (const id of byDomain.advertiserIds) {
        if (id && !candidates.has(id)) candidates.set(id, 'destination_domain');
      }
    } catch (error) {
      // Secondary discovery is best-effort: losing it must not discard name-discovered candidates.
      if (!anyDiscoveryRan) {
        const { state, reason } = accessStateFromError(error);
        return base({ accessState: state, reason });
      }
    }
  }

  if (!anyDiscoveryRan) {
    return base({ accessState: 'unavailable', reason: 'Advertiser discovery could not run for this report.' });
  }

  // ── Profile observation + identity resolution ────────────────────────────
  const advertisers: AdsAdvertiserRecord[] = [];
  for (const [advertiserId, discoveredVia] of [...candidates].slice(0, maxProfiles)) {
    let profile: AdvertiserProfileObservation | null = null;
    try {
      profile = await params.client.openAdvertiser(advertiserId);
    } catch {
      // One unreadable profile is not an unreadable run. The candidate is simply not resolvable.
      continue;
    }
    if (!profile) continue;

    const observed: ObservedAdvertiser = {
      advertiserId: profile.advertiserId,
      legalName: profile.legalName,
      basedIn: profile.basedIn,
      verified: profile.verified,
      ambiguityFlagged: profile.ambiguityFlagged,
    };
    advertisers.push({
      observation: profile,
      resolution: resolveAdvertiserIdentity(params.subject, observed),
      discoveredVia,
    });
  }

  return base({
    // Discovery ran and the surface answered. Finding no advertiser is a real observation and is
    // NOT an absence of advertising — §16's distinction, preserved by the caller's wording.
    accessState: 'observed',
    reason: null,
    advertisers,
    counts: {
      domainAdCountLabel,
      advertiserAccountsDiscovered: candidates.size,
      candidateAdvertisers: candidates.size,
      matchedAdvertiserAccounts: advertisers.filter((a) => a.resolution.eligibleForCompanyClaim).length,
    },
  });
}
