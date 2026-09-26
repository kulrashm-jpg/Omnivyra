/**
 * PI-SIM-001 — simulated ENRICHMENT PROVIDERS.
 *
 * Each implements `EnrichmentProviderAdapter`, the same contract the real
 * Apollo and Clearbit adapters implement. The executor cannot tell these apart
 * from a real provider, which is the point: the gate order it enforces
 * (adapter → credential → attribute → duplicate suppression → cost → call) is
 * exercised exactly as it will be in production.
 *
 * ─── ZERO NETWORK, STRUCTURALLY ───────────────────────────────────────────
 * There is no import of `safeFetch`, no `fetch`, no URL and no credential read
 * anywhere in this file. A simulated provider cannot make a real call even by
 * mistake, and a test asserts this file contains no transport primitive.
 *
 * ─── THESE ARE NOT VENDOR SCHEMAS ─────────────────────────────────────────
 * The fields returned below are CANONICAL attribute names drawn from the
 * platform's own vocabulary. They are NOT claims about what Apollo, RapidAPI or
 * ZoomInfo actually return — no such contract has been established in this
 * repository for RapidAPI or ZoomInfo, which `dataSourceCatalogue` records as
 * `available: false`. The purpose is to exercise Omnivyra's pipeline, not to
 * model a vendor's payload.
 *
 * ─── CONFLICT IS THE INTERESTING CASE ─────────────────────────────────────
 * The three simulators deliberately DISAGREE about `job_title`. Sales Navigator
 * says `VP Marketing`; Apollo says `Marketing Manager`; ZoomInfo says
 * `Head of Marketing`. Nothing HERE resolves that disagreement, and that is
 * still correct: resolution is not a provider's job. `PI-ADR-009` settled the
 * rule and `prospectIdentity/sourcePrecedence.ts` applies it at read time, over
 * observations these simulators merely report.
 */

import {
  refuse, type EnrichmentProviderAdapter, type EnrichmentRequest,
  type ProviderField, type ProviderResponse,
} from '../enrichment/providers/contract';
import { SIM_TIME } from './fixtures';

/**
 * The precedence question this simulation surfaced, and the decision that
 * settled it. Retained (rather than deleted) so the conflict these simulators
 * manufacture stays traceable to the ADR that resolved it — a test asserts the
 * recorded rule matches what `sourcePrecedence.ts` actually implements.
 */
export const PRECEDENCE_DECISION = {
  decision: 'OD-PRECEDENCE — settled by PI-ADR-009',
  question:
    'When Sales Navigator and a vendor disagree about an identity/person field '
    + '(job_title, company, seniority), which observation becomes the canonical value?',
  status: 'DECIDED',
  simulatedConflict: {
    attribute: 'job_title',
    salesNavigator: 'VP Marketing',
    apollo: 'Marketing Manager',
    zoominfo: 'Head of Marketing',
  },
  note:
    'SETTLED by PI-ADR-009: Sales Navigator is authoritative for job_title and '
    + 'company ONLY; every other field resolves by recency then confidence. Every '
    + 'observation is retained either way. Selection lives in sourcePrecedence.ts.',
} as const;

/** Deterministic failure modes a scenario can demand of any simulator. */
export const SIM_PROVIDER_MODES = [
  'success',
  'partial',              // company present, contact absent
  'no_match',
  'rate_limited',
  'timeout',
  'transient_failure',    // retryable
  'permanent_failure',    // not retryable
  'malformed',
] as const;
export type SimProviderMode = typeof SIM_PROVIDER_MODES[number];

const field = (
  attribute: string, subject: EnrichmentRequest['subject'], value: unknown,
  confidence: number,
): ProviderField => ({
  attribute, subject, value,
  observedAt: SIM_TIME.enrichment,
  confidence,
  providerInferred: false,
});

/** What each simulator knows, when it is behaving. */
const CATALOGUE: Record<string, {
  label: string;
  supports: readonly string[];
  fields: (req: EnrichmentRequest) => ProviderField[];
}> = {
  'apollo-sim': {
    label: 'Apollo (simulated)',
    supports: ['email', 'phone', 'job_title', 'employee_count', 'industry'],
    fields: (req) => [
      field('email', req.subject, 'jane@acme.example', 0.9),
      field('phone', req.subject, '+1-415-555-0101', 0.7),
      // Disagrees with Sales Navigator, on purpose.
      field('job_title', req.subject, 'Marketing Manager', 0.6),
    ],
  },
  'rapidapi-sim': {
    label: 'RapidAPI (simulated)',
    supports: ['email', 'phone', 'city', 'country_code'],
    fields: (req) => [
      field('phone', req.subject, '+1-415-555-0199', 0.5),
      field('city', req.subject, 'San Francisco', 0.6),
    ],
  },
  'zoominfo-sim': {
    label: 'ZoomInfo (simulated)',
    supports: ['employee_count', 'annual_revenue', 'industry', 'phone', 'job_title'],
    fields: (req) => [
      field('employee_count', req.subject, 320, 0.8),
      field('annual_revenue', req.subject, 48000000, 0.6),
      field('industry', req.subject, 'Software', 0.8),
      // A third opinion, again on purpose.
      field('job_title', req.subject, 'Head of Marketing', 0.55),
    ],
  },
};

/**
 * Per-provider mode, set by a scenario. Module-level and explicitly resettable:
 * a simulator that carried state between tests would be non-deterministic in
 * exactly the way this file exists to avoid.
 */
const modes = new Map<string, SimProviderMode>();

export function setSimProviderMode(providerId: string, mode: SimProviderMode): void {
  modes.set(providerId, mode);
}

export function resetSimProviderModes(): void {
  modes.clear();
}

function respond(providerId: string, req: EnrichmentRequest): ProviderResponse {
  const spec = CATALOGUE[providerId];
  const mode = modes.get(providerId) ?? 'success';
  const asked = [...req.attributes];

  switch (mode) {
    case 'no_match':
      return refuse('no_match', asked, 'simulated: provider does not know this entity');
    case 'rate_limited':
      // An absolute instant, because A6A stores the reset rather than guessing it.
      return { ...refuse('rate_limited', asked, 'simulated 429'), retryAfterAt: '2026-09-08T10:00:00.000Z' };
    case 'timeout':
      return refuse('timeout', asked, 'simulated: no response within the budget');
    case 'transient_failure':
      return refuse('provider_unavailable', asked, 'simulated: retryable upstream error');
    case 'permanent_failure':
      return refuse('provider_declined', asked, 'simulated: provider refused this request');
    case 'malformed':
      return refuse('malformed_response', asked, 'simulated: unparseable payload');
    case 'partial': {
      // Company-shaped facts survive; contact details do not.
      const kept = spec.fields(req).filter(
        (f) => f.attribute !== 'email' && f.attribute !== 'phone',
      );
      if (!kept.length) return refuse('field_not_found', asked, 'simulated partial: nothing contactless to give');
      return {
        outcome: 'enriched',
        fields: kept,
        notReturned: asked.filter((a) => !kept.some((f) => f.attribute === a)),
        detail: 'simulated partial response',
        payloadHash: `sim-${providerId}-partial`,
      };
    }
    case 'success':
    default: {
      const all = spec.fields(req);
      const usable = all.filter((f) => asked.includes(f.attribute));
      if (!usable.length) {
        return refuse('field_not_found', asked, 'simulated: matched, but holds none of the requested fields');
      }
      return {
        outcome: 'enriched',
        fields: usable,
        notReturned: asked.filter((a) => !usable.some((f) => f.attribute === a)),
        payloadHash: `sim-${providerId}-success`,
      };
    }
  }
}

function makeSimProvider(id: string): EnrichmentProviderAdapter {
  const spec = CATALOGUE[id];
  return {
    id,
    label: spec.label,
    supports: spec.supports,
    // No credential: a simulator that demanded one would be asserting something
    // about the tenant's configuration, which it has no business doing.
    credentialEnvVar: null,
    isAvailable: () => true,
    async enrich(request: EnrichmentRequest): Promise<ProviderResponse> {
      return respond(id, request);
    },
  };
}

export const apolloSimAdapter = makeSimProvider('apollo-sim');
export const rapidApiSimAdapter = makeSimProvider('rapidapi-sim');
export const zoomInfoSimAdapter = makeSimProvider('zoominfo-sim');

export const SIMULATION_PROVIDER_ADAPTERS: readonly EnrichmentProviderAdapter[] = [
  apolloSimAdapter, rapidApiSimAdapter, zoomInfoSimAdapter,
];

/**
 * Every observation the three simulators would make about one attribute,
 * WITHOUT resolving them. This is the shape a precedence contract would consume
 * once one exists; today it exists so a test can prove that conflicting
 * observations are all retained rather than silently collapsed.
 */
export function collectConflictingObservations(
  req: EnrichmentRequest, attribute: string,
): readonly { provider: string; value: unknown; confidence: number | null; observedAt: string | null }[] {
  return SIMULATION_PROVIDER_ADAPTERS.flatMap((p) => {
    const spec = CATALOGUE[p.id];
    return spec.fields(req)
      .filter((f) => f.attribute === attribute)
      .map((f) => ({
        provider: p.id, value: f.value, confidence: f.confidence, observedAt: f.observedAt,
      }));
  });
}
