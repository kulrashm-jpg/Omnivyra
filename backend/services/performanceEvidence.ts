/**
 * Website performance evidence via PageSpeed Insights (Phase 4).
 *
 * Report 1 previously had NO performance capability at all — an audit of the repository
 * found only a Lighthouse mention inside recommendation copy and the word "lighthouse" in a
 * bot-detection regex. `performanceIngestionService` is social-content metrics (likes,
 * shares), not web performance. So this is a new provider, built as the smallest integration
 * that yields real evidence.
 *
 * Two design decisions carry the evidence discipline:
 *
 *  1. BENCHMARKS ARE NOT INVENTED. Where PageSpeed returns CrUX field data it also returns
 *     Google's own classification per metric (`FAST` / `AVERAGE` / `SLOW`), and that is used
 *     verbatim. Where only Lighthouse lab data exists, classification uses the PUBLISHED
 *     Core Web Vitals thresholds (web.dev/defining-core-web-vitals-thresholds) — an external,
 *     citable standard, not an Omnivyra scale.
 *  2. NO SYNTHETIC PERFORMANCE SCORE. When the provider is unavailable the result is
 *     `unavailable` with the actual reason. There is no fallback value, and no metric is
 *     estimated from another metric.
 *
 * Credential: the PSI API works WITHOUT a key against a shared anonymous quota, and accepts
 * `PAGESPEED_API_KEY` for a dedicated quota. It is therefore not a customer integration and
 * not a prerequisite — but the shared quota is frequently exhausted, so a key is required for
 * reliable operation.
 */
import type { ScoreState } from './snapshotReport/canonicalScoreState';
// E — FAILURE VOCABULARY IS NOT INVENTED HERE. `ProviderFailureKind` and
// `failureFromStatus` are the project's existing provider-failure taxonomy
// (CPG-012 §10, registry/providerContract): every way a provider can fail, kept
// distinct "because the operator remedy differs (wait / get a key / fix a parser
// / nothing), and none of them is evidence of anything about the company". That
// is precisely the distinction this file needs, so it is reused rather than
// restated. `failureFromStatus` is generic HTTP semantics, not a registry rule,
// and `providerContract` has only type-level imports of its own — so this file
// stays pure.
import {
  failureFromStatus,
  type ProviderFailureKind,
} from './companyProfile/grounding/registry/providerContract';
// E — one readiness vocabulary across Report 1 providers. Type-only, erased at
// compile time: no runtime dependency on the intelligence registry.
import type { ProviderSlotAvailability } from './intelligence/providerRegistry';

const PSI_ENDPOINT = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';

/** Lighthouse is slow; PSI routinely takes 15–40s for a cold URL. */
const DEFAULT_TIMEOUT_MS = Math.max(10_000, Number(process.env.PAGESPEED_TIMEOUT_MS) || 60_000);

export type FormFactor = 'mobile' | 'desktop';

/** Google's own vocabulary. Deliberately not renamed into an Omnivyra scale. */
export type MetricCategory = 'FAST' | 'AVERAGE' | 'SLOW' | 'NONE';

/** The CMO-facing directional reading, mapped 1:1 from Google's categories. */
export type PerformanceVerdict = 'good' | 'needs_improvement' | 'poor' | 'unknown';

export const VERDICT_BY_CATEGORY: Record<MetricCategory, PerformanceVerdict> = {
  FAST: 'good',
  AVERAGE: 'needs_improvement',
  SLOW: 'poor',
  NONE: 'unknown',
};

/**
 * Published Core Web Vitals thresholds — used ONLY when CrUX field data is absent and the
 * classification must come from Lighthouse lab values. Source:
 * https://web.dev/articles/defining-core-web-vitals-thresholds  (good ≤ / poor >)
 *
 * These are Google's public thresholds, quoted, not tuned by Omnivyra. `unit` is recorded so
 * the report can state the measurement without the reader guessing.
 */
export const CWV_THRESHOLDS = {
  LCP: { good: 2500, poor: 4000, unit: 'ms', label: 'Largest Contentful Paint' },
  INP: { good: 200, poor: 500, unit: 'ms', label: 'Interaction to Next Paint' },
  CLS: { good: 0.1, poor: 0.25, unit: 'score', label: 'Cumulative Layout Shift' },
  FCP: { good: 1800, poor: 3000, unit: 'ms', label: 'First Contentful Paint' },
  TTFB: { good: 800, poor: 1800, unit: 'ms', label: 'Time to First Byte' },
} as const;

export type MetricKey = keyof typeof CWV_THRESHOLDS;

/** The minimum useful CMO-facing set. PSI returns dozens of audits; these are the five that carry a diagnosis. */
export const REPORTED_METRICS: MetricKey[] = ['LCP', 'INP', 'CLS', 'FCP', 'TTFB'];

export interface PerformanceMetric {
  key: MetricKey;
  label: string;
  value: number | null;
  unit: string;
  /** Google's classification, or NONE when unclassifiable. */
  category: MetricCategory;
  verdict: PerformanceVerdict;
  /** 'crux_field' = real-user data from Google; 'lighthouse_lab' = synthetic lab run. */
  source: 'crux_field' | 'lighthouse_lab' | null;
  /** The threshold pair applied, so the classification is auditable. */
  threshold: { good: number; poor: number } | null;
  state: ScoreState;
}

export interface PerformanceObservation {
  url: string;
  finalUrl: string | null;
  formFactor: FormFactor;
  metrics: PerformanceMetric[];
  /** Google's own overall CrUX category for the page, when field data exists. */
  overallCategory: MetricCategory;
  /**
   * Lighthouse performance score 0..100 AS SUPPLIED BY THE PROVIDER. Never computed here.
   * Null when the provider did not return one.
   */
  providerPerformanceScore: number | null;
  observedAt: string;
  provider: 'pagespeed_insights';
  state: ScoreState;
  reasonUnavailable: string | null;
  /**
   * E — WHY `state` ALONE WAS NOT ENOUGH.
   *
   * Four different things produced `state: 'unavailable'` and nothing but the
   * prose in `reasonUnavailable` told them apart: a missing dedicated quota, a
   * 429, a timeout, and a provider that answered with no usable metric. A
   * consumer that wanted to behave differently for a transient failure than for
   * "the provider has nothing on this URL" had to regex an English sentence, so
   * in practice nobody did and all four read as one undifferentiated absence.
   *
   * `failureKind` is the machine-readable half of that reason, in the project's
   * existing `ProviderFailureKind` vocabulary. It is `null` when, and only when,
   * the observation is `measured`.
   *
   * It is NOT a score and can never become one: every value here still leaves
   * `state: 'unavailable'` and every metric `null`. In particular `not_found`
   * ("the provider answered, and has no usable metric for this URL") is not a
   * measured zero and no verdict is derived from it.
   */
  failureKind: ProviderFailureKind | null;
  /** Lighthouse JS execution time, used as a client-rendering signal. */
  jsBootupMs: number | null;
}

export interface PerformanceEvidence {
  observations: PerformanceObservation[];
  /** Pages measured vs pages we intended to measure — feeds evidence coverage. */
  coverage: { measured: number; attempted: number; eligible: number };
  byFormFactor: Record<FormFactor, { measured: number; verdict: PerformanceVerdict }>;
  state: ScoreState;
  reasonUnavailable: string | null;
  /**
   * E — the report-level counterpart of `PerformanceObservation.failureKind`:
   * why NO observation could be measured. Optional because the "PageSpeed is
   * not enabled for this environment" envelope is built by
   * `digitalExperienceRepository.collectPerformanceEvidence`, which this module
   * does not own; that path still carries its reason in prose only.
   */
  failureKind?: ProviderFailureKind | null;
}

export function isPageSpeedConfigured(): boolean {
  // Keyless operation is supported; this reports whether a DEDICATED quota is configured.
  return Boolean(process.env.PAGESPEED_API_KEY);
}

/**
 * E — PageSpeed readiness, in the shared readiness vocabulary, with the exact
 * operator prerequisite.
 *
 * Read-only: no network call, no credential value read, no score touched. It
 * reports the SAME two environment variables `pageSpeedEnabled()` gates on
 * (`digitalExperienceRepository`), and a focused test asserts the two agree on
 * every combination, so this cannot drift into describing a gate that is not the
 * one in force.
 *
 * PageSpeed is never `CREDENTIAL_REQUIRED`: the API works keyless on a shared
 * quota, so the absence of a key is a DECISION not to call it (the shared quota
 * is routinely exhausted and costs tens of seconds for a 429). `DISABLED` is the
 * honest term.
 */
export function describePageSpeedReadiness(): {
  availability: ProviderSlotAvailability;
  prerequisite: readonly string[];
  detail: string;
} {
  if (process.env.PAGESPEED_API_KEY?.trim()) {
    return {
      availability: 'CONFIGURED',
      prerequisite: [],
      detail: 'PageSpeed Insights has a dedicated quota (PAGESPEED_API_KEY). Reachability is not asserted here — only a call can establish it.',
    };
  }
  if (/^(1|true|on|yes)$/i.test(process.env.PAGESPEED_ENABLED ?? '')) {
    return {
      availability: 'CONFIGURED',
      prerequisite: ['PAGESPEED_API_KEY'],
      detail: 'PageSpeed Insights is enabled on the keyless SHARED quota, which is frequently exhausted (HTTP 429). Set PAGESPEED_API_KEY for a dedicated quota.',
    };
  }
  return {
    availability: 'DISABLED',
    prerequisite: ['PAGESPEED_API_KEY', 'PAGESPEED_ENABLED'],
    detail: 'Performance evidence is not collected: neither PAGESPEED_API_KEY nor PAGESPEED_ENABLED is set. No performance claim is made about the site — the capability is off.',
  };
}

/** Classify a lab value against the published thresholds. Pure. */
export function categorizeLabMetric(key: MetricKey, value: number | null): MetricCategory {
  if (value === null || !Number.isFinite(value)) return 'NONE';
  const t = CWV_THRESHOLDS[key];
  if (value <= t.good) return 'FAST';
  if (value > t.poor) return 'SLOW';
  return 'AVERAGE';
}

/** Map a CrUX metric id onto our reported key. Unmapped metrics are ignored, not invented. */
const CRUX_KEY_MAP: Record<string, MetricKey> = {
  LARGEST_CONTENTFUL_PAINT_MS: 'LCP',
  INTERACTION_TO_NEXT_PAINT: 'INP',
  CUMULATIVE_LAYOUT_SHIFT_SCORE: 'CLS',
  FIRST_CONTENTFUL_PAINT_MS: 'FCP',
  EXPERIMENTAL_TIME_TO_FIRST_BYTE: 'TTFB',
};

const LAB_AUDIT_MAP: Record<MetricKey, string> = {
  LCP: 'largest-contentful-paint',
  INP: 'interaction-to-next-paint',
  CLS: 'cumulative-layout-shift',
  FCP: 'first-contentful-paint',
  TTFB: 'server-response-time',
};

function unavailableMetric(key: MetricKey): PerformanceMetric {
  return {
    key, label: CWV_THRESHOLDS[key].label, value: null, unit: CWV_THRESHOLDS[key].unit,
    category: 'NONE', verdict: 'unknown', source: null, threshold: null, state: 'unavailable',
  };
}

/**
 * Parse a PSI response into canonical metrics. Pure and total — a malformed or partial
 * response yields `unavailable` metrics rather than throwing or guessing.
 *
 * CrUX field data is PREFERRED over Lighthouse lab data because it is real-user measurement
 * and carries Google's own category. Lab data is used only where field data is absent, and
 * is tagged as such so the report never presents a synthetic lab run as real-user experience.
 */
export function parsePageSpeedResponse(params: {
  body: unknown;
  url: string;
  formFactor: FormFactor;
  observedAt?: string;
}): PerformanceObservation {
  const body = (params.body ?? {}) as Record<string, any>;
  const observedAt = params.observedAt ?? new Date().toISOString();
  const lr = body.lighthouseResult ?? {};
  const field = body.loadingExperience ?? body.originLoadingExperience ?? {};
  const fieldMetrics = (field.metrics ?? {}) as Record<string, { percentile?: number; category?: string }>;

  const metrics: PerformanceMetric[] = REPORTED_METRICS.map((key) => {
    // 1. Field data (preferred).
    const cruxId = Object.keys(CRUX_KEY_MAP).find((id) => CRUX_KEY_MAP[id] === key);
    const fieldEntry = cruxId ? fieldMetrics[cruxId] : undefined;
    if (fieldEntry && Number.isFinite(Number(fieldEntry.percentile))) {
      const raw = Number(fieldEntry.percentile);
      // CrUX reports CLS ×100 as an integer; normalise to the published unit scale.
      const value = key === 'CLS' ? raw / 100 : raw;
      const category = (['FAST', 'AVERAGE', 'SLOW'].includes(String(fieldEntry.category))
        ? fieldEntry.category : 'NONE') as MetricCategory;
      return {
        key, label: CWV_THRESHOLDS[key].label, value, unit: CWV_THRESHOLDS[key].unit,
        category, verdict: VERDICT_BY_CATEGORY[category], source: 'crux_field',
        threshold: { good: CWV_THRESHOLDS[key].good, poor: CWV_THRESHOLDS[key].poor },
        state: 'measured',
      };
    }
    // 2. Lab data (fallback, explicitly tagged).
    const audit = lr.audits?.[LAB_AUDIT_MAP[key]];
    const numeric = Number(audit?.numericValue);
    if (audit && Number.isFinite(numeric)) {
      const category = categorizeLabMetric(key, numeric);
      return {
        key, label: CWV_THRESHOLDS[key].label, value: numeric, unit: CWV_THRESHOLDS[key].unit,
        category, verdict: VERDICT_BY_CATEGORY[category], source: 'lighthouse_lab',
        threshold: { good: CWV_THRESHOLDS[key].good, poor: CWV_THRESHOLDS[key].poor },
        state: 'measured',
      };
    }
    return unavailableMetric(key);
  });

  const measured = metrics.filter((m) => m.state === 'measured');
  const overallCategory = (['FAST', 'AVERAGE', 'SLOW'].includes(String(field.overall_category))
    ? field.overall_category : 'NONE') as MetricCategory;

  const providerScore = Number(lr.categories?.performance?.score);

  return {
    url: params.url,
    finalUrl: typeof lr.finalUrl === 'string' ? lr.finalUrl : null,
    formFactor: params.formFactor,
    metrics,
    overallCategory,
    // Provider-supplied only. PSI returns 0..1; expose 0..100 without recomputation.
    providerPerformanceScore: Number.isFinite(providerScore) ? Math.round(providerScore * 100) : null,
    observedAt,
    provider: 'pagespeed_insights',
    state: measured.length > 0 ? 'measured' : 'unavailable',
    reasonUnavailable: measured.length > 0
      ? null
      : 'PageSpeed returned no usable field or lab metrics for this URL.',
    // E — the provider ANSWERED and holds no usable metric for this URL
    // (`not_found` in the shared vocabulary: "answered: no such identifier /
    // empty record"). That is categorically not a slow page, and not a
    // transport failure either.
    failureKind: measured.length > 0 ? null : 'not_found',
    jsBootupMs: Number.isFinite(Number(lr.audits?.['bootup-time']?.numericValue))
      ? Number(lr.audits['bootup-time'].numericValue)
      : null,
  };
}

/**
 * An observation representing a provider that could not be reached. Never a score.
 *
 * E — `failureKind` is REQUIRED, not optional: a new failure path cannot be added
 * without deciding which kind of failure it is, which is the whole point of
 * keeping them distinct.
 */
export function unavailableObservation(params: {
  url: string; formFactor: FormFactor; reason: string; failureKind: ProviderFailureKind;
}): PerformanceObservation {
  return {
    url: params.url, finalUrl: null, formFactor: params.formFactor,
    metrics: REPORTED_METRICS.map(unavailableMetric),
    overallCategory: 'NONE', providerPerformanceScore: null,
    observedAt: new Date().toISOString(), provider: 'pagespeed_insights',
    state: 'unavailable', reasonUnavailable: params.reason,
    failureKind: params.failureKind, jsBootupMs: null,
  };
}

/**
 * Run PageSpeed for one URL + form factor. Never throws: every failure mode — timeout, rate
 * limit, HTTP error, malformed body — returns an `unavailable` observation carrying the real
 * reason, so a provider outage can never become a performance claim.
 */
export async function fetchPageSpeed(params: {
  url: string;
  formFactor: FormFactor;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<PerformanceObservation> {
  const doFetch = params.fetchImpl ?? fetch;
  const query = new URLSearchParams({
    url: params.url,
    strategy: params.formFactor,
    category: 'performance',
  });
  if (process.env.PAGESPEED_API_KEY) query.set('key', process.env.PAGESPEED_API_KEY);

  try {
    const response = await doFetch(`${PSI_ENDPOINT}?${query.toString()}`, {
      signal: AbortSignal.timeout(params.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      let detail = `HTTP ${response.status}`;
      try {
        const body = await response.json() as any;
        if (body?.error?.message) detail = `HTTP ${response.status} — ${String(body.error.message).slice(0, 200)}`;
      } catch { /* keep the status-only detail */ }
      return unavailableObservation({
        url: params.url, formFactor: params.formFactor,
        reason: response.status === 429
          ? `PageSpeed quota exceeded (${detail}). Set PAGESPEED_API_KEY for a dedicated quota.`
          : `PageSpeed request failed: ${detail}`,
        // E — classified by the SHARED HTTP mapping (`failureFromStatus`), so a
        // 429 is `rate_limited`, a 5xx is `retrieval_failed` and a 4xx is not
        // quietly folded in with either.
        failureKind: failureFromStatus(response.status, 'pagespeed').failure,
      });
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch (error) {
      // E — a 200 whose body is not the expected JSON is `malformed_response`,
      // not a transport failure and certainly not a measurement.
      return unavailableObservation({
        url: params.url, formFactor: params.formFactor,
        reason: `PageSpeed returned a response that could not be parsed: ${
          (error instanceof Error ? error.message : String(error)).slice(0, 200)}`,
        failureKind: 'malformed_response',
      });
    }
    return parsePageSpeedResponse({ body, url: params.url, formFactor: params.formFactor });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return unavailableObservation({
      url: params.url, formFactor: params.formFactor,
      reason: /abort|timeout/i.test(message)
        ? `PageSpeed timed out after ${params.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms.`
        : `PageSpeed request error: ${message.slice(0, 200)}`,
      // E — timeout, connection reset and DNS failure are all transient
      // retrieval failures in the shared vocabulary. None of them is a zero.
      failureKind: 'retrieval_failed',
    });
  }
}

/**
 * Aggregate observations into report-level evidence.
 *
 * The aggregate verdict is the WORST measured metric verdict, not an average: a page with an
 * excellent CLS and a poor LCP is a slow page, and averaging would hide that. Coverage is
 * reported separately and never folded into the verdict — "we measured 2 of 40 pages" is a
 * statement about evidence, not about the site.
 */
export function aggregatePerformanceEvidence(params: {
  observations: readonly PerformanceObservation[];
  eligiblePages: number;
}): PerformanceEvidence {
  const observations = [...(params.observations ?? [])];
  const measured = observations.filter((o) => o.state === 'measured');

  const verdictFor = (subset: PerformanceObservation[]): PerformanceVerdict => {
    const verdicts = subset.flatMap((o) => o.metrics)
      .filter((m) => m.state === 'measured' && m.verdict !== 'unknown')
      .map((m) => m.verdict);
    if (verdicts.length === 0) return 'unknown';
    if (verdicts.includes('poor')) return 'poor';
    if (verdicts.includes('needs_improvement')) return 'needs_improvement';
    return 'good';
  };

  const forFactor = (factor: FormFactor) => {
    const subset = measured.filter((o) => o.formFactor === factor);
    return { measured: subset.length, verdict: verdictFor(subset) };
  };

  return {
    observations,
    coverage: {
      measured: measured.length,
      attempted: observations.length,
      eligible: Math.max(params.eligiblePages, measured.length),
    },
    byFormFactor: { mobile: forFactor('mobile'), desktop: forFactor('desktop') },
    state: measured.length > 0 ? 'measured' : 'unavailable',
    reasonUnavailable: measured.length > 0
      ? null
      : observations[0]?.reasonUnavailable ?? 'No performance evidence was collected.',
    // E — carry the first observation's kind alongside its reason, so the
    // report-level absence is as diagnosable as the per-URL one. Null when
    // something was measured, and null when there was nothing to attempt (no
    // observation means no provider failure to report).
    failureKind: measured.length > 0 ? null : observations[0]?.failureKind ?? null,
  };
}
