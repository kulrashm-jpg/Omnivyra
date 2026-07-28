/**
 * V-C307 — Visitor Authoritative Readiness (pure; assessment only). Validates readiness for a (later,
 * operator-controlled) authoritative flip WITHOUT changing production behaviour: assembly STABILITY
 * (deterministic reruns identical), field parity vs raw, contradiction handling, tenant isolation,
 * observability, cross-understanding consistency. Per-gate booleans + `ready`. No enablement.
 */

import type { VisitorIntelligenceContext } from './engineTypes';
import { assembleVisitorIntelligence } from './assembly';
import { compareToRaw } from '../shadowRuntime';
import { summarizeVisitorRun } from '../metrics';
import { validateVisitorCrossUnderstanding } from './crossUnderstanding';

export interface VisitorAuthoritativeReadiness {
  visitors: number;
  meanParity: number;
  stable: boolean;
  contradictionHandled: boolean;
  tenantIsolated: boolean;
  observable: boolean;
  crossUnderstandingConsistent: boolean;
  meanConfidence: number;
  gates: Record<string, boolean>;
  ready: boolean;
}

export function assessVisitorAuthoritativeReadiness(cases: VisitorIntelligenceContext[], opts: { parityGate?: number } = {}): VisitorAuthoritativeReadiness {
  const parityGate = opts.parityGate ?? 0.9;
  let parity = 0, confidence = 0, stable = true, contradictionHandled = true, tenantIsolated = true, observable = true, crossOk = true;

  for (const ctx of cases) {
    const a = assembleVisitorIntelligence(ctx);
    const b = assembleVisitorIntelligence(ctx);
    if (JSON.stringify(a.understanding) !== JSON.stringify(b.understanding)) stable = false;   // deterministic rerun
    if (a.understanding.key.companyId !== ctx.key.companyId) tenantIsolated = false;
    if (a.understanding.contradictions.some((c) => typeof c.resolved !== 'boolean')) contradictionHandled = false;
    try { summarizeVisitorRun([a.understanding]); } catch { observable = false; }
    if (!validateVisitorCrossUnderstanding(a.understanding).consistent) crossOk = false;
    parity += ctx.raw ? compareToRaw(a.understanding, ctx.raw).parity : 1;
    confidence += a.understanding.score.confidence;
  }
  const n = cases.length || 1;
  const meanParity = Number((parity / n).toFixed(4));
  const gates = { projection_parity: meanParity >= parityGate, stability: stable, contradiction_handling: contradictionHandled, tenant_isolation: tenantIsolated, observability: observable, cross_understanding: crossOk };
  return { visitors: cases.length, meanParity, stable, contradictionHandled, tenantIsolated, observable, crossUnderstandingConsistent: crossOk, meanConfidence: Number((confidence / n).toFixed(4)), gates, ready: Object.values(gates).every(Boolean) };
}
