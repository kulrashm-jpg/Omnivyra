/**
 * OI-D406 — Offering Authoritative Readiness (pure; assessment only). Validates readiness for a
 * (later, operator-controlled) authoritative flip WITHOUT changing production behaviour: projection/
 * scoring/reasoning STABILITY (deterministic reruns identical), field parity, contradiction handling,
 * tenant isolation, observability, cross-understanding consistency. Per-gate booleans + `ready`.
 */

import type { OfferingIntelligenceContext } from './engineTypes';
import type { OfferingSeedInput } from '../fromSeed';
import { assembleOfferingUnderstanding } from './assembly';
import { compareToLegacy } from '../shadowRuntime';
import { summarizeOfferingRun } from '../metrics';
import { validateCrossUnderstanding } from './crossUnderstanding';

export interface OfferingAuthoritativeReadiness {
  offerings: number;
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

export function assessOfferingAuthoritativeReadiness(cases: Array<{ ctx: OfferingIntelligenceContext; legacy: OfferingSeedInput }>, opts: { parityGate?: number } = {}): OfferingAuthoritativeReadiness {
  const parityGate = opts.parityGate ?? 0.9;
  let parity = 0, confidence = 0, stable = true, contradictionHandled = true, tenantIsolated = true, observable = true, crossOk = true;

  for (const { ctx, legacy } of cases) {
    const a = assembleOfferingUnderstanding(ctx);
    const b = assembleOfferingUnderstanding(ctx);
    if (JSON.stringify(a.understanding) !== JSON.stringify(b.understanding)) stable = false;
    if (a.understanding.key.companyId !== ctx.key.companyId) tenantIsolated = false;
    if (a.understanding.contradictions.some((c) => typeof c.resolved !== 'boolean')) contradictionHandled = false;
    try { summarizeOfferingRun([a.understanding]); } catch { observable = false; }
    if (!validateCrossUnderstanding(a.understanding).consistent) crossOk = false;
    parity += compareToLegacy(a.understanding, legacy).parity;
    confidence += a.understanding.score.confidence;
  }
  const n = cases.length || 1;
  const meanParity = Number((parity / n).toFixed(4));
  const gates = { projection_parity: meanParity >= parityGate, stability: stable, contradiction_handling: contradictionHandled, tenant_isolation: tenantIsolated, observability: observable, cross_understanding: crossOk };
  return { offerings: cases.length, meanParity, stable, contradictionHandled, tenantIsolated, observable, crossUnderstandingConsistent: crossOk, meanConfidence: Number((confidence / n).toFixed(4)), gates, ready: Object.values(gates).every(Boolean) };
}
