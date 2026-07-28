/**
 * LI-D308 — Authoritative Readiness (pure; assessment only). Validates the platform is ready for a
 * (later, operator-controlled) authoritative flip WITHOUT changing production behavior: projection +
 * scoring + reasoning + confidence STABILITY (deterministic reruns identical), contradiction handling,
 * tenant isolation, and observability. Produces gates + an overall readiness boolean.
 */

import type { CanonicalLeadScores } from '../../../../lib/leadIntelligence/types';
import type { LeadIntelligenceContext } from './engineTypes';
import { assembleLeadUnderstanding } from './assembly';
import { compareToLegacy } from '../shadowRuntime';
import { assessQuality } from './quality';

export interface AuthoritativeReadiness {
  leads: number;
  meanParity: number;
  stable: boolean;                 // deterministic rerun identical (projection/scoring/reasoning)
  contradictionHandled: boolean;   // contradictions detected & carry resolution
  tenantIsolated: boolean;         // every understanding keyed by companyId; no cross-tenant leakage
  observable: boolean;             // quality scorecard computable for every lead
  meanConfidence: number;
  gates: Record<string, boolean>;
  ready: boolean;
}

export function assessAuthoritativeReadiness(cases: Array<{ ctx: LeadIntelligenceContext; legacy: CanonicalLeadScores }>, opts: { parityGate?: number; tolerance?: number } = {}): AuthoritativeReadiness {
  const parityGate = opts.parityGate ?? 0.9;
  let parity = 0, confidence = 0, stable = true, contradictionHandled = true, tenantIsolated = true, observable = true;

  for (const { ctx, legacy } of cases) {
    const a = assembleLeadUnderstanding(ctx);
    const b = assembleLeadUnderstanding(ctx);            // rerun — must be byte-identical (deterministic)
    if (JSON.stringify(a.understanding) !== JSON.stringify(b.understanding)) stable = false;
    if (a.understanding.key.companyId !== ctx.key.companyId) tenantIsolated = false;
    // every contradiction must carry a resolution flag (handled, not silent)
    if (a.understanding.contradictions.some((c) => typeof c.resolved !== 'boolean')) contradictionHandled = false;
    try { assessQuality(a.understanding); } catch { observable = false; }
    parity += compareToLegacy(a.understanding, legacy, { tolerance: opts.tolerance }).parity;
    confidence += a.understanding.score.confidence;
  }
  const n = cases.length || 1;
  const meanParity = Number((parity / n).toFixed(4));
  const gates = {
    projection_parity: meanParity >= parityGate,
    stability: stable,
    contradiction_handling: contradictionHandled,
    tenant_isolation: tenantIsolated,
    observability: observable,
  };
  return {
    leads: cases.length, meanParity, stable, contradictionHandled, tenantIsolated, observable,
    meanConfidence: Number((confidence / n).toFixed(4)),
    gates, ready: Object.values(gates).every(Boolean),
  };
}
