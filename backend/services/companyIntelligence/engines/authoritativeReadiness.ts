/**
 * CI-D408 — Company Authoritative Readiness (pure; assessment only). Validates readiness for a
 * (later, operator-controlled) authoritative flip WITHOUT changing production behaviour: projection/
 * scoring/reasoning STABILITY (deterministic reruns identical), field parity, contradiction handling,
 * tenant isolation, observability. Produces per-gate booleans + overall `ready`.
 */

import type { CompanyIntelligenceContext } from './engineTypes';
import type { CompanyProfileInput } from '../fromProfile';
import { assembleCompanyUnderstanding } from './assembly';
import { compareToLegacy } from '../shadowRuntime';
import { summarizeCompanyRun } from '../metrics';

export interface CompanyAuthoritativeReadiness {
  companies: number;
  meanParity: number;
  stable: boolean;
  contradictionHandled: boolean;
  tenantIsolated: boolean;
  observable: boolean;
  meanConfidence: number;
  gates: Record<string, boolean>;
  ready: boolean;
}

export function assessCompanyAuthoritativeReadiness(cases: Array<{ ctx: CompanyIntelligenceContext; legacy: CompanyProfileInput }>, opts: { parityGate?: number } = {}): CompanyAuthoritativeReadiness {
  const parityGate = opts.parityGate ?? 0.9;
  let parity = 0, confidence = 0, stable = true, contradictionHandled = true, tenantIsolated = true, observable = true;

  for (const { ctx, legacy } of cases) {
    const a = assembleCompanyUnderstanding(ctx);
    const b = assembleCompanyUnderstanding(ctx); // deterministic rerun must be byte-identical
    if (JSON.stringify(a.understanding) !== JSON.stringify(b.understanding)) stable = false;
    if (a.understanding.key.companyId !== ctx.key.companyId) tenantIsolated = false;
    if (a.understanding.contradictions.some((c) => typeof c.resolved !== 'boolean')) contradictionHandled = false;
    try { summarizeCompanyRun([a.understanding]); } catch { observable = false; }
    parity += compareToLegacy(a.understanding, legacy).parity;
    confidence += a.understanding.score.confidence;
  }
  const n = cases.length || 1;
  const meanParity = Number((parity / n).toFixed(4));
  const gates = { projection_parity: meanParity >= parityGate, stability: stable, contradiction_handling: contradictionHandled, tenant_isolation: tenantIsolated, observability: observable };
  return { companies: cases.length, meanParity, stable, contradictionHandled, tenantIsolated, observable, meanConfidence: Number((confidence / n).toFixed(4)), gates, ready: Object.values(gates).every(Boolean) };
}
