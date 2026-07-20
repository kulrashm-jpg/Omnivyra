/**
 * WAVE-1 — Market Intelligence provenance guard (realizes AI-CONTRACT-000 §P6).
 *
 * OMNI-AI-001 (CRITICAL): the flagship MarketPulse persisted LLM-fabricated signals
 * with `source_url` never set + a hard-coded `source_credibility: 65`, and computed
 * "trust" over synthetic single sources — evidence-backed presentation of fabricated
 * data. This module enforces the contract's fabrication policy at the persistence
 * boundary, additively and deterministically:
 *   - classify each signal into a provenance tier (deterministic | retrieval_backed
 *     | ai_inference | speculative) from its ACTUAL evidence,
 *   - an uncited signal is honestly labeled `ai_inference` (or `speculative`) and its
 *     credibility is DERIVED from evidence, never hard-coded,
 *   - trust/credibility is scored ONLY over real cited sources; an uncited signal
 *     can never present as high-credibility evidence.
 *
 * Pure & deterministic. Applied to the signal record before persist — additive
 * (signals still persist), it only makes their provenance honest.
 */

export type ProvenanceTier = 'deterministic' | 'retrieval_backed' | 'ai_inference' | 'speculative';

export interface EvidenceInput {
  /** Real, resolvable source URL for the signal, if any. */
  sourceUrl?: string | null;
  /** True when the value is computed from persisted real data (Website Intelligence / DB aggregation). */
  deterministic?: boolean;
  /** Number of distinct real sources backing the claim. */
  sourceCount?: number;
  /** The signal's own confidence (0..100) as produced upstream. */
  confidenceScore?: number | null;
}

export interface ProvenanceVerdict {
  tier: ProvenanceTier;
  /** Honest credibility (0..100) DERIVED from evidence — never a hard-coded constant. */
  credibility: number;
  /** True only for retrieval_backed / deterministic signals with ≥1 real source. */
  cited: boolean;
  /** Whether a trust score may be presented as evidence for this signal. */
  trustScorable: boolean;
  /** Human/UI label. */
  label: string;
}

function isRealUrl(u?: string | null): boolean {
  if (!u || typeof u !== 'string') return false;
  return /^https?:\/\/[^\s]+\.[^\s]+/i.test(u.trim());
}

/**
 * Classify a signal's provenance from its actual evidence. An uncited, LLM-derived
 * signal is `ai_inference` (or `speculative` when confidence is very low) — NEVER
 * dressed as a credible 'system' source.
 */
export function classifyProvenance(ev: EvidenceInput): ProvenanceVerdict {
  const cited = isRealUrl(ev.sourceUrl) || (ev.sourceCount ?? 0) >= 1;
  const conf = typeof ev.confidenceScore === 'number' ? ev.confidenceScore : 50;

  if (ev.deterministic) {
    return { tier: 'deterministic', credibility: 90, cited: true, trustScorable: true, label: 'Deterministic (computed from real data)' };
  }
  if (cited) {
    // Credibility scales with the number of real sources; capped, honest.
    const credibility = Math.min(85, 45 + Math.min(4, ev.sourceCount ?? 1) * 10);
    return { tier: 'retrieval_backed', credibility, cited: true, trustScorable: true, label: 'Retrieval-backed (cited sources)' };
  }
  // Uncited, model-derived. NOT evidence.
  if (conf < 40) {
    return { tier: 'speculative', credibility: 10, cited: false, trustScorable: false, label: 'Speculative (AI hypothesis — not evidence)' };
  }
  return { tier: 'ai_inference', credibility: 25, cited: false, trustScorable: false, label: 'AI inference (uncited — not evidence-backed)' };
}

export interface SignalLike {
  source_type?: string | null;
  source_url?: string | null;
  source_credibility?: number | null;
  confidence_score?: number | null;
  provenance_tier?: string | null;   // populated if the column exists; otherwise ignored by the DB layer
  trust_scorable?: boolean | null;
}

/**
 * Apply honest provenance to a signal record before persist. Additive: returns a
 * NEW record with corrected `source_type`/`source_credibility` and (best-effort)
 * `provenance_tier`/`trust_scorable`. Uncited signals can no longer carry a
 * fabricated high credibility. Never throws.
 */
export function applyProvenance<T extends SignalLike>(signal: T, evidenceOverride?: Partial<EvidenceInput>): T & { __provenance: ProvenanceVerdict } {
  const ev: EvidenceInput = {
    sourceUrl: evidenceOverride?.sourceUrl ?? signal.source_url ?? null,
    deterministic: evidenceOverride?.deterministic ?? false,
    sourceCount: evidenceOverride?.sourceCount ?? (isRealUrl(signal.source_url) ? 1 : 0),
    confidenceScore: evidenceOverride?.confidenceScore ?? signal.confidence_score ?? null,
  };
  const v = classifyProvenance(ev);
  return {
    ...signal,
    source_type: v.tier,                    // honest tier, not 'system'
    source_credibility: v.credibility,      // derived, not hard-coded 65
    provenance_tier: v.tier,
    trust_scorable: v.trustScorable,
    __provenance: v,
  };
}

/**
 * Guard: is it safe to present a trust/evidence score for this signal?
 * (For scoring code — never trust-score an uncited signal.)
 */
export function mayTrustScore(signal: SignalLike): boolean {
  const v = classifyProvenance({
    sourceUrl: signal.source_url ?? null,
    sourceCount: isRealUrl(signal.source_url) ? 1 : 0,
    confidenceScore: signal.confidence_score ?? null,
  });
  return v.trustScorable;
}
