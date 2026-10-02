/**
 * B7 — Market / ICP Recommendation  (WP-10)
 *
 * WHAT THIS IS
 * A PUBLIC-EVIDENCE-BASED PROPOSAL about the market this company already appears to address:
 * industry, geography, customer size, revenue range, market segment and buyer category. A human
 * reads it and may later choose to act on it.
 *
 * WHAT THIS IS NOT — and the reasons, because each of these is a live failure mode elsewhere:
 *
 *  • It is NOT a ratified ICP. `kind` is the literal `'proposal'` at the type level so no consumer
 *    can read this shape as a decision. Nothing here writes `prospect_icp_versions`; nothing here
 *    ratifies, versions or scores an ICP.
 *  • It does NOT mutate the Company Profile. This module is a pure function over values the caller
 *    already holds. It imports no client, no repository and no writer, performs no I/O, and returns
 *    a value. WP-11 is removing silent Company Profile mutation from report generation; this slice
 *    adds no new write for it to remove.
 *  • It does NOT create, list or score prospects. It says nothing about any individual or company
 *    other than the report's own subject.
 *
 * PROVENANCE
 * Report 1 is a public-evidence report. Every assertion here carries an `EvidenceTrace` stamped
 * with the GAP-07 provenance vocabulary, and any observation from a private source
 * (`COMPANY_CONFIRMED`, `OMNIVYRA_OBSERVED`, `CONNECTED_SOURCE`) is EXCLUDED from the trace rather
 * than dropped, exactly as `enforceTraceProvenance` does for the scored surfaces. An attribute left
 * with no admissible evidence ABSTAINS.
 *
 * OBSERVED vs INFERRED
 * `basis` is mandatory on every recommended attribute and is never elided:
 *
 *   observed   the public web exhibits this value directly (a country in the site's own
 *              `Organization` JSON-LD; an industry stated by a public knowledge graph)
 *   inferred   derived by deterministic reasoning over public observations (the modal segment
 *              across publicly observed peers)
 *
 * An inference from public evidence is legitimate. Presenting an inference as an observation is
 * not, so the two are separate fields with separate provenance classes and are asserted separately
 * in the tests.
 *
 * ABSTENTION IS THE DEFAULT
 * Every rule below is written so that the absence of evidence produces `status: 'unavailable'`,
 * `value: null` and a concrete `reason_unavailable` + `unlock`. There is no branch that invents a
 * value to fill a slot. On a company with no knowledge-graph entry, no declared `Organization`
 * country and no classified peers, this section abstains on all six attributes and says so.
 */
import type { EvidenceProvenanceClass } from '../evidenceProvenance';
import { isReport1Source, provenanceForSource } from '../evidenceProvenance';
import type {
  CanonicalDeclaredEvidence,
  ConfidenceBand,
  EvidenceObservation,
  EvidenceSourceKind,
  EvidenceTrace,
  ScoreState,
} from './canonicalReportTypes';
import { emptyEvidenceTrace } from './canonicalReportTypes';

// ── Public shape ──────────────────────────────────────────────────────────────

export type MarketIcpAttributeKey =
  | 'industry'
  | 'geography'
  | 'company_size'
  | 'revenue_range'
  | 'market_segment'
  | 'buyer_category';

/** How the value was arrived at. Never collapsed into one word — see the module docblock. */
export type MarketIcpBasis = 'observed' | 'inferred';

export type MarketIcpAttribute = {
  key: MarketIcpAttributeKey;
  label: string;
  /** `recommended` only when admissible public evidence supports a value. */
  status: 'recommended' | 'unavailable';
  /** The proposed value. `null` whenever `status` is `unavailable` — never a placeholder string. */
  value: string | null;
  /** `null` when abstaining: an abstention has no basis, and pretending otherwise is the defect. */
  basis: MarketIcpBasis | null;
  /** Report 1 legal classes only: PUBLIC_OBSERVED, INFERRED, ESTIMATED, UNAVAILABLE. */
  provenance: EvidenceProvenanceClass;
  confidence: ConfidenceBand;
  evidence: EvidenceTrace;
  /** What was read, in the reader's terms. Present for both recommendations and abstentions. */
  rationale: string;
  /** Present only when abstaining. */
  reason_unavailable: string | null;
  /** What would let this attribute resolve. Always present when abstaining. */
  unlock: string | null;
};

export type MarketIcpRecommendation = {
  /**
   * Literal, not a union. A consumer that pattern-matches on this can only ever see a proposal,
   * which is the type-level half of "this is not a ratified ICP".
   */
  kind: 'proposal';
  state: ScoreState;
  attributes: MarketIcpAttribute[];
  counts: {
    recommended: number;
    observed: number;
    inferred: number;
    unavailable: number;
  };
  headline: string;
  /** Customer-facing statement of what this section is and is not. Always rendered. */
  disclaimer: string;
  limitations: string[];
  /** Distinct provenance classes across everything this section asserts. */
  provenance_classes: EvidenceProvenanceClass[];
  /** True when nothing private had to be excluded from any attribute's evidence. */
  report1_clean: boolean;
};

export const MARKET_ICP_DISCLAIMER =
  'This is a proposal drawn from public evidence, not a decision and not a customer profile we have saved. '
  + 'It does not change your company profile, does not define or approve an ideal customer profile, and creates no prospect list. '
  + 'Review it, then decide.';

const ATTRIBUTE_LABELS: Record<MarketIcpAttributeKey, string> = {
  industry: 'Industry',
  geography: 'Geography',
  company_size: 'Customer company size',
  revenue_range: 'Customer revenue range',
  market_segment: 'Market segment',
  buyer_category: 'Buyer category',
};

/** Order is the reading order in the report. */
export const MARKET_ICP_ATTRIBUTE_KEYS: readonly MarketIcpAttributeKey[] = [
  'industry',
  'geography',
  'market_segment',
  'company_size',
  'revenue_range',
  'buyer_category',
];

// ── Evidence input ────────────────────────────────────────────────────────────
//
// Deliberately a plain value bundle rather than a service handle: a resolver that cannot reach a
// database cannot mutate a Company Profile, cannot write an ICP version and cannot create a
// prospect, whatever a later edit to it might try to do.

/** One publicly observed peer, from competitor intelligence. Structural — no cross-workstream type import. */
export type MarketIcpPeer = {
  competitor?: string | null;
  segment?: 'smb' | 'mid_market' | 'enterprise' | 'unknown' | null;
  geography?: string | null;
  customerIcp?: string | null;
  classification?: string | null;
};

export type MarketIcpSignal = {
  value: string;
  source: EvidenceSourceKind;
  observed_at?: string | null;
};

export type MarketIcpEvidenceInput = {
  /**
   * An industry stated by a public source about this company (a knowledge-graph industry claim, or
   * an `Organization` entry on the site that names one). No producer emits this today, so the
   * industry attribute abstains in production — that is the honest state, not a gap to paper over.
   */
  industryClassification?: MarketIcpSignal | null;
  /** `Organization.address.addressCountry` read from the company's own crawled pages. */
  declaredCountry?: MarketIcpSignal | null;
  /** Locale / hreflang region subtags observed across the crawl. */
  observedLocales?: readonly string[];
  /** Publicly observed peers. Drives segment, buyer category, and geography-of-last-resort. */
  peers?: readonly MarketIcpPeer[];
  /**
   * A customer revenue band established by a public source. Nothing emits this; the attribute
   * abstains rather than deriving revenue from headcount, which would be a modelled guess.
   */
  customerRevenueBand?: MarketIcpSignal | null;
  /** Timestamp to stamp on derived observations. */
  observedAt?: string | null;
};

// ── Evidence plumbing ─────────────────────────────────────────────────────────

/**
 * Build a provenance-stamped trace from raw observations, excluding anything private.
 *
 * Same contract as `enforceTraceProvenance`: out-of-boundary observations are MOVED to `excluded`,
 * not discarded, so "we had no evidence" stays distinguishable from "we had evidence we may not
 * use here".
 */
function buildTrace(
  observations: readonly EvidenceObservation[],
  observedAt: string | null,
): EvidenceTrace {
  const retained: EvidenceObservation[] = [];
  const excluded: EvidenceObservation[] = [];
  for (const observation of observations) {
    (isReport1Source(observation.source) ? retained : excluded).push(observation);
  }
  const classes = [...new Set(retained.map((o) => provenanceForSource(o.source)))];
  const excludedSources = [...new Set(excluded.map((o) => o.source))];
  const stamps = retained
    .map((o) => o.observed_at)
    .filter((t): t is string => typeof t === 'string' && t.length > 0);
  const last = stamps.length > 0 ? stamps.slice().sort().slice(-1)[0] : null;
  const ageHours = last && observedAt
    ? Math.max(0, Math.round((Date.parse(observedAt) - Date.parse(last)) / 36e5))
    : null;
  return {
    count: retained.length,
    sources: [...new Set(retained.map((o) => o.source))],
    freshness: {
      last_observed_at: last,
      age_hours: Number.isFinite(ageHours as number) ? ageHours : null,
    },
    observations: retained,
    provenance: {
      classes,
      excluded,
      excludedSources,
      report1Clean: excluded.length === 0,
    },
  };
}

function recommended(params: {
  key: MarketIcpAttributeKey;
  value: string;
  basis: MarketIcpBasis;
  confidence: ConfidenceBand;
  rationale: string;
  observations: readonly EvidenceObservation[];
  observedAt: string | null;
}): MarketIcpAttribute {
  return {
    key: params.key,
    label: ATTRIBUTE_LABELS[params.key],
    status: 'recommended',
    value: params.value,
    basis: params.basis,
    // The provenance of the CONCLUSION, not of its inputs. An inference over public observations
    // is INFERRED even though every observation behind it is PUBLIC_OBSERVED — the `llm_probe`
    // demotion in `evidenceProvenance` exists because that distinction was once collapsed.
    provenance: params.basis === 'observed' ? 'PUBLIC_OBSERVED' : 'INFERRED',
    confidence: params.confidence,
    evidence: buildTrace(params.observations, params.observedAt),
    rationale: params.rationale,
    reason_unavailable: null,
    unlock: null,
  };
}

function abstained(params: {
  key: MarketIcpAttributeKey;
  reason: string;
  unlock: string;
  /** Observations that were looked at but could not support a value. Usually empty. */
  observations?: readonly EvidenceObservation[];
  observedAt?: string | null;
}): MarketIcpAttribute {
  const trace = params.observations && params.observations.length > 0
    ? buildTrace(params.observations, params.observedAt ?? null)
    : emptyEvidenceTrace();
  return {
    key: params.key,
    label: ATTRIBUTE_LABELS[params.key],
    status: 'unavailable',
    value: null,
    basis: null,
    provenance: 'UNAVAILABLE',
    confidence: 'low',
    evidence: trace,
    rationale: params.reason,
    reason_unavailable: params.reason,
    unlock: params.unlock,
  };
}

// ── Derivations ───────────────────────────────────────────────────────────────

const SEGMENT_LABEL: Record<'smb' | 'mid_market' | 'enterprise', string> = {
  smb: 'Small and mid-sized businesses',
  mid_market: 'Mid-market',
  enterprise: 'Enterprise',
};

/**
 * The size band a segment corresponds to. A DISCLOSED, fixed mapping — stated in the rationale so
 * the reader can see it is a convention, not a measurement of anyone's headcount.
 */
const SEGMENT_SIZE_BAND: Record<'smb' | 'mid_market' | 'enterprise', string> = {
  smb: '1–200 employees',
  mid_market: '201–1,000 employees',
  enterprise: '1,000+ employees',
};

/** Peers whose relationship to this company was actually established. `unknown` is not evidence. */
function classifiedPeers(peers: readonly MarketIcpPeer[]): MarketIcpPeer[] {
  return peers.filter((p) => {
    const c = (p.classification ?? '').trim();
    return c.length > 0 && c !== 'unknown';
  });
}

/** Modal value with its supporting count. Ties resolve alphabetically so two runs agree. */
function mode(values: readonly string[]): { value: string; count: number } | null {
  if (values.length === 0) return null;
  const tally = new Map<string, number>();
  for (const v of values) tally.set(v, (tally.get(v) ?? 0) + 1);
  const ranked = [...tally.entries()].sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]));
  return { value: ranked[0][0], count: ranked[0][1] };
}

function peerObservations(
  peers: readonly MarketIcpPeer[],
  signal: (p: MarketIcpPeer) => string,
  observedAt: string | null,
): EvidenceObservation[] {
  return peers.map((p) => ({
    signal: `${(p.competitor ?? 'peer').trim() || 'peer'}: ${signal(p)}`,
    // Competitor intelligence is public-web analysis — PUBLIC_OBSERVED in the canonical table.
    source: 'competitor_intelligence' as EvidenceSourceKind,
    observed_at: observedAt,
  }));
}

/** Region subtags from locale codes (`en-GB` → `GB`). A bare language carries no geography. */
function regionsFromLocales(locales: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of locales) {
    const parts = String(raw ?? '').trim().split(/[-_]/);
    if (parts.length < 2) continue;
    const region = parts[parts.length - 1].toUpperCase();
    if (/^[A-Z]{2}$/.test(region) && !out.includes(region)) out.push(region);
  }
  return out.sort();
}

function confidenceFromSupport(count: number): ConfidenceBand {
  if (count >= 4) return 'high';
  if (count >= 2) return 'medium';
  return 'low';
}

// ── Resolver ──────────────────────────────────────────────────────────────────

/**
 * Resolve the market / ICP proposal. Pure and deterministic: same input, same output, no I/O.
 *
 * The default (no input) is total abstention, which is the correct reading of "we know nothing
 * about this company's market from the public web".
 */
export function resolveMarketIcpRecommendation(
  input: MarketIcpEvidenceInput = {},
): MarketIcpRecommendation {
  const observedAt = input.observedAt ?? null;
  const peers = classifiedPeers(input.peers ?? []);

  // ── market_segment — modal segment across publicly observed peers.
  const segmentPeers = peers.filter(
    (p) => p.segment === 'smb' || p.segment === 'mid_market' || p.segment === 'enterprise',
  );
  const segmentMode = mode(segmentPeers.map((p) => p.segment as string));
  const segmentKey = segmentMode ? (segmentMode.value as 'smb' | 'mid_market' | 'enterprise') : null;
  const marketSegment: MarketIcpAttribute = segmentKey
    ? recommended({
      key: 'market_segment',
      value: SEGMENT_LABEL[segmentKey],
      basis: 'inferred',
      confidence: confidenceFromSupport(segmentMode!.count),
      rationale:
        `Inferred from the ${segmentPeers.length} publicly observed competitor${segmentPeers.length === 1 ? '' : 's'} `
        + `whose customer segment could be established: ${segmentMode!.count} of them sell to the ${SEGMENT_LABEL[segmentKey].toLowerCase()} segment. `
        + 'This is a conclusion about the market you compete in, not an observation of your customers.',
      observations: peerObservations(segmentPeers, (p) => `segment ${p.segment}`, observedAt),
      observedAt,
    })
    : abstained({
      key: 'market_segment',
      reason: 'No publicly observed competitor had an establishable customer segment, so no segment can be proposed.',
      unlock: 'A competitor set with resolvable market-competition evidence would let this segment resolve.',
      observations: peerObservations(peers, () => 'segment not established', observedAt),
      observedAt,
    });

  // ── industry — stated by a public source, or nothing.
  const industrySignal = input.industryClassification ?? null;
  const industry: MarketIcpAttribute = industrySignal && industrySignal.value.trim()
    && isReport1Source(industrySignal.source)
    ? recommended({
      key: 'industry',
      value: industrySignal.value.trim(),
      basis: 'observed',
      confidence: 'medium',
      rationale: 'Read directly from a public source that classifies this organisation.',
      observations: [{
        signal: `industry: ${industrySignal.value.trim()}`,
        source: industrySignal.source,
        observed_at: industrySignal.observed_at ?? observedAt,
      }],
      observedAt,
    })
    : abstained({
      key: 'industry',
      reason: industrySignal
        ? 'The only industry statement available came from a source this public report may not assert on.'
        : 'No public source states an industry classification for this company.',
      unlock:
        'A public knowledge-graph entry (Wikidata, Google Knowledge Graph) naming the organisation\'s industry, '
        + 'or an Organization entry on your own site that declares one, would let this resolve.',
      observations: industrySignal
        ? [{
          signal: `industry: ${industrySignal.value.trim()}`,
          source: industrySignal.source,
          observed_at: industrySignal.observed_at ?? observedAt,
        }]
        : [],
      observedAt,
    });

  // ── geography — declared country first, then observed locales, then peers.
  const countrySignal = input.declaredCountry ?? null;
  const countryUsable = !!countrySignal
    && countrySignal.value.trim().length > 0
    && isReport1Source(countrySignal.source);
  const regions = regionsFromLocales(input.observedLocales ?? []);
  const geoPeers = peers.filter((p) => (p.geography ?? '').trim().length > 0);
  const geoMode = mode(geoPeers.map((p) => (p.geography as string).trim()));

  let geography: MarketIcpAttribute;
  if (countryUsable) {
    geography = recommended({
      key: 'geography',
      value: countrySignal!.value.trim(),
      basis: 'observed',
      confidence: 'medium',
      rationale: 'Read from the Organization entry your own website publishes, which anyone can read from the public page.',
      observations: [{
        signal: `addressCountry: ${countrySignal!.value.trim()}`,
        source: countrySignal!.source,
        observed_at: countrySignal!.observed_at ?? observedAt,
      }],
      observedAt,
    });
  } else if (regions.length > 0) {
    geography = recommended({
      key: 'geography',
      value: regions.join(', '),
      basis: 'inferred',
      confidence: confidenceFromSupport(regions.length),
      rationale:
        `Inferred from the ${regions.length} region${regions.length === 1 ? '' : 's'} your site targets in its own locale markup. `
        + 'Publishing pages for a region is a statement of intent, not proof of where your customers are.',
      observations: regions.map((r) => ({
        signal: `locale region: ${r}`,
        source: 'crawler' as EvidenceSourceKind,
        observed_at: observedAt,
      })),
      observedAt,
    });
  } else if (geoMode) {
    geography = recommended({
      key: 'geography',
      value: geoMode.value,
      basis: 'inferred',
      confidence: confidenceFromSupport(geoMode.count),
      rationale:
        `Inferred from publicly observed competitors: ${geoMode.count} of ${geoPeers.length} operate in ${geoMode.value}. `
        + 'This describes where the competition is, which is a proxy for your market rather than a reading of it.',
      observations: peerObservations(geoPeers, (p) => `geography ${p.geography}`, observedAt),
      observedAt,
    });
  } else {
    geography = abstained({
      key: 'geography',
      reason: 'Your site publishes no Organization country, no regional locale markup was observed, and no competitor geography could be established.',
      unlock: 'Publishing an Organization address on your site, or adding regional hreflang markup, would let this resolve from your own public pages.',
    });
  }

  // ── company_size — only from a resolved segment, via a disclosed mapping.
  const companySize: MarketIcpAttribute = segmentKey
    ? recommended({
      key: 'company_size',
      value: SEGMENT_SIZE_BAND[segmentKey],
      basis: 'inferred',
      confidence: 'low',
      rationale:
        `Derived from the proposed ${SEGMENT_LABEL[segmentKey].toLowerCase()} segment using a fixed band `
        + `(${SEGMENT_LABEL.smb.toLowerCase()} = ${SEGMENT_SIZE_BAND.smb}, mid-market = ${SEGMENT_SIZE_BAND.mid_market}, enterprise = ${SEGMENT_SIZE_BAND.enterprise}). `
        + 'The band is a convention for reading the segment, not a measurement of any customer\'s headcount.',
      observations: peerObservations(segmentPeers, (p) => `segment ${p.segment}`, observedAt),
      observedAt,
    })
    : abstained({
      key: 'company_size',
      reason: 'No market segment could be proposed from public evidence, so no customer size band follows from it.',
      unlock: 'Resolving the market segment above would let this band follow from it.',
    });

  // ── revenue_range — no public path. Abstains rather than modelling revenue from headcount.
  const revenueSignal = input.customerRevenueBand ?? null;
  const revenueRange: MarketIcpAttribute = revenueSignal && revenueSignal.value.trim()
    && isReport1Source(revenueSignal.source)
    ? recommended({
      key: 'revenue_range',
      value: revenueSignal.value.trim(),
      basis: 'observed',
      confidence: 'low',
      rationale: 'Read from a public source that states a revenue band for this market.',
      observations: [{
        signal: `revenue band: ${revenueSignal.value.trim()}`,
        source: revenueSignal.source,
        observed_at: revenueSignal.observed_at ?? observedAt,
      }],
      observedAt,
    })
    : abstained({
      key: 'revenue_range',
      reason: 'No public source states a revenue range for the customers in this market.',
      unlock:
        'A public source that reports revenue for this market would let this resolve. '
        + 'It is deliberately not derived from the size band above — that would be a modelled figure presented as a finding.',
    });

  // ── buyer_category — most common customer description across observed peers.
  const icpPeers = peers.filter((p) => (p.customerIcp ?? '').trim().length > 0);
  const icpMode = mode(icpPeers.map((p) => (p.customerIcp as string).trim()));
  const buyerCategory: MarketIcpAttribute = icpMode
    ? recommended({
      key: 'buyer_category',
      value: icpMode.value,
      basis: 'inferred',
      confidence: confidenceFromSupport(icpMode.count),
      rationale:
        `Inferred from how ${icpMode.count} of ${icpPeers.length} publicly observed competitor${icpPeers.length === 1 ? '' : 's'} describe the buyer they sell to. `
        + 'It is who this market sells to, read off the competition, not a buyer we have observed choosing you.',
      observations: peerObservations(icpPeers, (p) => `buyer ${p.customerIcp}`, observedAt),
      observedAt,
    })
    : abstained({
      key: 'buyer_category',
      reason: 'No publicly observed competitor described the buyer it sells to, so no buyer category can be proposed.',
      unlock: 'A competitor set with resolvable customer descriptions would let this resolve.',
    });

  const byKey: Record<MarketIcpAttributeKey, MarketIcpAttribute> = {
    industry,
    geography,
    market_segment: marketSegment,
    company_size: companySize,
    revenue_range: revenueRange,
    buyer_category: buyerCategory,
  };
  const attributes = MARKET_ICP_ATTRIBUTE_KEYS.map((k) => byKey[k]);

  const observedCount = attributes.filter((a) => a.basis === 'observed').length;
  const inferredCount = attributes.filter((a) => a.basis === 'inferred').length;
  const unavailableCount = attributes.filter((a) => a.status === 'unavailable').length;
  const recommendedCount = observedCount + inferredCount;

  const state: ScoreState = observedCount > 0
    ? 'measured'
    : inferredCount > 0
      ? 'inferred'
      : 'insufficient_signal';

  const provenanceClasses = [...new Set(attributes.map((a) => a.provenance))];
  const report1Clean = attributes.every((a) => a.evidence.provenance?.report1Clean !== false);

  const limitations: string[] = [];
  if (unavailableCount > 0) {
    limitations.push(
      `${unavailableCount} of ${attributes.length} characteristics could not be supported by public evidence and are reported as unavailable rather than estimated.`,
    );
  }
  if (inferredCount > 0) {
    limitations.push(
      `${inferredCount} characteristic${inferredCount === 1 ? ' is' : 's are'} inferred from public observations rather than read directly, and each is labelled as such.`,
    );
  }
  limitations.push('Nothing here is saved to your company profile, and no ideal customer profile is created or approved by this report.');

  const headline = recommendedCount === 0
    ? 'The public record does not yet support a market proposal for this company.'
    : `Public evidence supports a proposal on ${recommendedCount} of ${attributes.length} market characteristics`
      + `${observedCount > 0 ? `, ${observedCount} read directly from the public record` : ''}`
      + `${inferredCount > 0 ? `${observedCount > 0 ? ' and' : ','} ${inferredCount} inferred from it` : ''}.`;

  return {
    kind: 'proposal',
    state,
    attributes,
    counts: {
      recommended: recommendedCount,
      observed: observedCount,
      inferred: inferredCount,
      unavailable: unavailableCount,
    },
    headline,
    disclaimer: MARKET_ICP_DISCLAIMER,
    limitations,
    provenance_classes: provenanceClasses,
    report1_clean: report1Clean,
  };
}

// ── Collector ─────────────────────────────────────────────────────────────────

/**
 * Project the evidence this section may use out of what the report already holds.
 *
 * Read-only and total: it reaches for nothing new, calls no provider, and is defensive about every
 * field because the project compiles with `strict: false` and these shapes arrive from persisted
 * rows. Deliberately does NOT read the report's `category` / vertical hint: that value originates
 * in the Company Profile the tenant filled in, and a company-declared industry entering a public
 * report as an observation is precisely the leak the provenance boundary exists to stop.
 */
export function collectMarketIcpEvidence(params: {
  declaredEvidence?: CanonicalDeclaredEvidence | null;
  /** `SnapshotReport['competitive_tables']`, structurally typed to avoid a cross-workstream import. */
  competitiveTables?: { marketCompetition?: readonly MarketIcpPeer[] | null } | null;
  observedLocales?: readonly string[] | null;
  observedAt?: string | null;
}): MarketIcpEvidenceInput {
  const identity = params.declaredEvidence?.declared_identity ?? null;
  const country = typeof identity?.address_country === 'string' && identity.address_country.trim()
    ? { value: identity.address_country.trim(), source: identity.source, observed_at: params.observedAt ?? null }
    : null;
  const peers = Array.isArray(params.competitiveTables?.marketCompetition)
    ? params.competitiveTables!.marketCompetition!.filter((p) => p && typeof p === 'object')
    : [];
  return {
    // No producer supplies a public industry classification or a public customer revenue band
    // today. Stated explicitly rather than omitted, so the abstention is a decision and not an
    // oversight a later reader has to reconstruct.
    industryClassification: null,
    customerRevenueBand: null,
    declaredCountry: country,
    observedLocales: params.observedLocales ?? [],
    peers,
    observedAt: params.observedAt ?? null,
  };
}
