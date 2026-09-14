/**
 * DT-C2 — U1 PAIRED SCORER (evaluation-only).
 *
 * Scores a GROUNDED output against an UNGROUNDED output for one (workload, entry)
 * pair, under the frozen protocol in `u1Protocol.ts`.
 *
 * HARD INVARIANTS
 * ---------------
 *  1. PURE. No I/O, no database, no cache, no network, no filesystem, no clock.
 *     Same inputs → same result, forever.
 *  2. NO EXTERNAL API. Nothing here can reach a model provider.
 *  3. EVALUATES, NEVER IMPROVES. The scorer must not rewrite, retry, re-prompt,
 *     post-process or repair an output. It reads and measures.
 *  4. NO INPUT MUTATION. Inputs are treated as immutable.
 *  5. NO DATASET-SPECIFIC EXCEPTIONS. No branch keys off a specific entry id,
 *     company name or workload. The scorer would behave identically on a
 *     different dataset of the same shape.
 *  6. 'pending' IS NEVER 0. A metric that cannot be computed is reported as
 *     'pending' or 'not_applicable' — never silently coerced to a number.
 *  7. INVALID OBSERVATIONS ARE KEPT. Nothing is discarded; invalid pairs carry a
 *     reason and flow through to the exclusion table.
 *
 * WHAT THIS FILE IS NOT
 * ---------------------
 * It computes NO efficacy verdict. `aggregate()` summarises machine-computable
 * screening metrics only. The PRIMARY endpoint (M-P1) is human-rated and is
 * always 'pending' until blinded ratings are supplied. Running this scorer does
 * NOT execute U1 and produces no evidence about grounding efficacy.
 */

import {
  ARM_GROUNDED, ARM_UNGROUNDED, METRICS, PRIMARY_METRIC,
  PROTOCOL_DATASET_ID, PROTOCOL_ID, PROTOCOL_VERSION, protocolFingerprint,
  type MetricId,
} from './u1Protocol';
import type { DatasetEntry, WorkloadDef } from './types';

/** A value that is deliberately not a number. Never coerced to 0. */
export type MetricValue = number | 'pending' | 'not_applicable';

export type PairValidity = 'valid' | 'partial' | 'invalid';

export interface MetricResult {
  metricId: MetricId;
  grounded: MetricValue;
  ungrounded: MetricValue;
  /** grounded - ungrounded, ONLY when both sides are numeric; else null. */
  delta: number | null;
  evaluator: 'machine' | 'human';
  role: 'primary' | 'secondary' | 'screening';
  direction: 'lower-is-better' | 'higher-is-better';
  /** Why a side is non-numeric. null when both sides are numeric. */
  reason: string | null;
}

/** One scored pair. Protocol metadata is kept separate from measured values. */
export interface PairedScore {
  protocol: {
    protocolId: string;
    protocolVersion: string;
    protocolFingerprint: string;
    datasetId: string;
  };
  subject: {
    workload: string;
    entryId: string;
    armGrounded: string;
    armUngrounded: string;
  };
  metrics: MetricResult[];
  validity: PairValidity;
  invalidReason: string | null;
}

/** The outputs under comparison. `null` means the arm produced no output. */
export interface PairedOutputs {
  groundedText: string | null;
  ungroundedText: string | null;
  /** Optional blinded human ratings, 0..1 per metric per arm. Absent ⇒ 'pending'. */
  humanRatings?: Partial<Record<MetricId, { grounded?: number; ungrounded?: number }>>;
}

// ── deterministic text helpers (no clock, no RNG, no locale dependence) ──────

function normalise(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Extract checkable reference values from a fixture profile for a workload.
 * Reference is the ENTRY'S OWN PROFILE for BOTH arms — the shared ground truth
 * against which each arm is measured. Generic, no entry-specific branching.
 */
export function referenceValues(entry: DatasetEntry, workload: WorkloadDef): string[] {
  const out: string[] = [];
  for (const field of workload.fields) {
    const v = (entry.profile as Record<string, unknown>)[field];
    if (typeof v === 'string' && v.trim()) out.push(v.trim());
    else if (Array.isArray(v)) for (const item of v) if (typeof item === 'string' && item.trim()) out.push(item.trim());
  }
  // Stable, de-duplicated ordering keeps scoring byte-reproducible.
  return [...new Set(out)].sort();
}

function isBlank(text: string | null): boolean {
  return text === null || text === undefined || text.trim() === '';
}

// ── machine-computable metrics ───────────────────────────────────────────────

/** M-S3 — output present, non-empty. This is the metric that RECORDS absence. */
export function outputValidity(text: string | null): number {
  return isBlank(text) ? 0 : 1;
}

/** M-S1 — share of reference values appearing in the output. */
export function groundedFactUtilisation(text: string | null, refs: string[]): MetricValue {
  if (isBlank(text)) return 'pending';
  if (refs.length === 0) return 'not_applicable';
  const hay = normalise(text as string);
  let hits = 0;
  for (const ref of refs) {
    const needle = normalise(ref);
    if (needle && hay.includes(needle)) hits++;
  }
  return Number((hits / refs.length).toFixed(6));
}

/** M-S2 — names the correct company and no foreign one. */
export function entityIdentityFidelity(
  text: string | null, correctName: string | null, foreignNames: string[],
): MetricValue {
  if (isBlank(text)) return 'pending';
  const hay = normalise(text as string);
  const correct = correctName ? normalise(correctName) : '';
  const sawCorrect = !!correct && hay.includes(correct);
  const sawForeign = foreignNames.some((n) => {
    const f = normalise(n);
    return !!f && f !== correct && hay.includes(f);
  });
  if (!sawCorrect && !sawForeign) return 'not_applicable';
  if (sawForeign) return 0;
  return 1;
}

function humanValue(
  ratings: PairedOutputs['humanRatings'], id: MetricId, side: 'grounded' | 'ungrounded', text: string | null,
): MetricValue {
  if (isBlank(text)) return 'pending';
  const v = ratings?.[id]?.[side];
  if (typeof v !== 'number' || !Number.isFinite(v)) return 'pending';
  return Number(Math.max(0, Math.min(1, v)).toFixed(6));
}

// ── the scorer ───────────────────────────────────────────────────────────────

/**
 * Score one paired observation. Pure; mutates nothing; calls nothing external.
 * `foreignNames` are the other entries' company names (supplied by the caller so
 * the scorer holds no dataset knowledge of its own).
 */
export function scorePair(
  workload: WorkloadDef,
  entry: DatasetEntry,
  outputs: PairedOutputs,
  foreignNames: string[] = [],
): PairedScore {
  const refs = referenceValues(entry, workload);
  const correctName = typeof entry.profile.name === 'string' ? entry.profile.name : null;
  const g = outputs.groundedText;
  const u = outputs.ungroundedText;

  const results: MetricResult[] = METRICS.map((def) => {
    let grounded: MetricValue;
    let ungrounded: MetricValue;

    switch (def.id) {
      case 'M-S3-output-validity':
        grounded = outputValidity(g); ungrounded = outputValidity(u); break;
      case 'M-S1-grounded-fact-utilisation':
        grounded = groundedFactUtilisation(g, refs); ungrounded = groundedFactUtilisation(u, refs); break;
      case 'M-S2-entity-identity-fidelity':
        grounded = entityIdentityFidelity(g, correctName, foreignNames);
        ungrounded = entityIdentityFidelity(u, correctName, foreignNames); break;
      default:
        // Every remaining metric — including the PRIMARY — is human-rated.
        grounded = humanValue(outputs.humanRatings, def.id, 'grounded', g);
        ungrounded = humanValue(outputs.humanRatings, def.id, 'ungrounded', u);
    }

    const bothNumeric = typeof grounded === 'number' && typeof ungrounded === 'number';
    const reason = bothNumeric
      ? null
      : isBlank(g) || isBlank(u)
        ? 'missing output on at least one arm'
        : grounded === 'not_applicable' || ungrounded === 'not_applicable'
          ? 'metric not applicable to this pair'
          : def.evaluator === 'human'
            ? 'PENDING — REQUIRES HUMAN/EXTERNAL EVALUATION'
            : 'not computable';

    return {
      metricId: def.id,
      grounded,
      ungrounded,
      delta: bothNumeric ? Number(((grounded as number) - (ungrounded as number)).toFixed(6)) : null,
      evaluator: def.evaluator,
      role: def.role,
      direction: def.direction,
      reason,
    };
  });

  let validity: PairValidity = 'valid';
  let invalidReason: string | null = null;
  if (isBlank(g) && isBlank(u)) { validity = 'invalid'; invalidReason = 'both arms produced no output'; }
  else if (isBlank(g)) { validity = 'invalid'; invalidReason = 'grounded arm produced no output'; }
  else if (isBlank(u)) { validity = 'invalid'; invalidReason = 'ungrounded arm produced no output'; }
  else {
    const primary = results.find((r) => r.metricId === PRIMARY_METRIC);
    if (!primary || primary.delta === null) {
      validity = 'partial';
      invalidReason = 'primary endpoint not yet rated (human evaluation outstanding)';
    }
  }

  return {
    protocol: {
      protocolId: PROTOCOL_ID,
      protocolVersion: PROTOCOL_VERSION,
      protocolFingerprint: protocolFingerprint(),
      datasetId: PROTOCOL_DATASET_ID,
    },
    subject: {
      workload: workload.key,
      entryId: entry.id,
      armGrounded: ARM_GROUNDED,
      armUngrounded: ARM_UNGROUNDED,
    },
    metrics: results,
    validity,
    invalidReason,
  };
}

// ── aggregation (descriptive only) ───────────────────────────────────────────

export interface MetricAggregate {
  metricId: MetricId;
  evaluator: 'machine' | 'human';
  role: 'primary' | 'secondary' | 'screening';
  direction: 'lower-is-better' | 'higher-is-better';
  pairsScored: number;
  pairsPending: number;
  pairsNotApplicable: number;
  medianGrounded: number | null;
  medianUngrounded: number | null;
  medianDelta: number | null;
  ties: number;
}

export interface AggregateResult {
  protocolVersion: string;
  protocolFingerprint: string;
  totalPairs: number;
  validPairs: number;
  partialPairs: number;
  invalidPairs: number;
  exclusions: { workload: string; entryId: string; reason: string }[];
  metrics: MetricAggregate[];
  /** Always true in DT-C2 — the primary endpoint is human-rated and unrated. */
  primaryEndpointPending: boolean;
  /**
   * Deliberately absent: no SUCCESS/FAILURE/INCONCLUSIVE verdict is produced
   * here. The outcome is decided against the frozen protocol only after human
   * rating, by a reviewer — not by this function.
   */
  outcome: null;
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  const m = s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  return Number(m.toFixed(6));
}

/** Descriptive paired summary. Produces no verdict and no significance test. */
export function aggregate(scores: PairedScore[]): AggregateResult {
  const metrics: MetricAggregate[] = METRICS.map((def) => {
    const rows = scores.map((s) => s.metrics.find((m) => m.metricId === def.id)!).filter(Boolean);
    const gs: number[] = [], us: number[] = [], ds: number[] = [];
    let pending = 0, na = 0, ties = 0;
    for (const r of rows) {
      if (r.grounded === 'not_applicable' || r.ungrounded === 'not_applicable') { na++; continue; }
      if (typeof r.grounded !== 'number' || typeof r.ungrounded !== 'number') { pending++; continue; }
      gs.push(r.grounded); us.push(r.ungrounded);
      if (r.delta !== null) { ds.push(r.delta); if (r.delta === 0) ties++; }
    }
    return {
      metricId: def.id, evaluator: def.evaluator, role: def.role, direction: def.direction,
      pairsScored: gs.length, pairsPending: pending, pairsNotApplicable: na,
      medianGrounded: median(gs), medianUngrounded: median(us), medianDelta: median(ds), ties,
    };
  });

  const exclusions = scores
    .filter((s) => s.validity === 'invalid')
    .map((s) => ({ workload: s.subject.workload, entryId: s.subject.entryId, reason: s.invalidReason ?? 'unknown' }));

  const primary = metrics.find((m) => m.metricId === PRIMARY_METRIC);

  return {
    protocolVersion: PROTOCOL_VERSION,
    protocolFingerprint: protocolFingerprint(),
    totalPairs: scores.length,
    validPairs: scores.filter((s) => s.validity === 'valid').length,
    partialPairs: scores.filter((s) => s.validity === 'partial').length,
    invalidPairs: exclusions.length,
    exclusions,
    metrics,
    primaryEndpointPending: !primary || primary.pairsScored === 0,
    outcome: null,
  };
}
