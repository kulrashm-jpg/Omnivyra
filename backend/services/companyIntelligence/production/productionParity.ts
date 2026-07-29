/**
 * COMPANY-UNDERSTANDING-IMPLEMENTATION-001 · U4.5 — Production parity harness (pure, shadow).
 *
 * For representative companies, compares the canonical evidence-derived identity (the new producer) against
 * the legacy stored/classifier identity, per field: parity / approved_improvement / expected_abstention /
 * unexpected_regression (reusing the certified `classifyLegacySurfaceDelta`). Unexpected regressions block
 * the authoritative rollout. Consumed by nothing in production — offline/CI parity certification only.
 */

import { produceCanonicalIdentity, type WriteEvidenceInputs } from './canonicalIdentityProducer';
import { classifyLegacySurfaceDelta, type SurfaceDelta } from '../evidence';
import type { CompanyProfileInput } from '../fromProfile';

export interface ProductionParityCase { legacy: CompanyProfileInput; inputs: WriteEvidenceInputs }
export interface ProductionParityRow { companyId: string; delta: SurfaceDelta; abstained: string[]; improved: string[] }
export interface ProductionParityReport {
  rows: ProductionParityRow[];
  totalUnexpectedRegressions: number;
  approvedImprovements: number;
  expectedAbstentions: number;
  overallParity: number;
  certifiable: boolean; // true iff zero unexpected regressions
}

export function runProductionParity(cases: ProductionParityCase[]): ProductionParityReport {
  const rows: ProductionParityRow[] = cases.map(({ legacy, inputs }) => {
    const { legacy: canon } = produceCanonicalIdentity(inputs);
    const delta = classifyLegacySurfaceDelta(legacy, canon);
    return {
      companyId: inputs.companyId,
      delta,
      abstained: delta.fields.filter((f) => f.class === 'expected_abstention').map((f) => f.field),
      improved: delta.fields.filter((f) => f.class === 'approved_improvement').map((f) => f.field),
    };
  });
  const totalUnexpectedRegressions = rows.reduce((s, r) => s + r.delta.unexpectedRegressions, 0);
  return {
    rows,
    totalUnexpectedRegressions,
    approvedImprovements: rows.reduce((s, r) => s + r.delta.approvedImprovements, 0),
    expectedAbstentions: rows.reduce((s, r) => s + r.delta.expectedAbstentions, 0),
    overallParity: rows.length ? Number((rows.reduce((s, r) => s + r.delta.parity, 0) / rows.length).toFixed(4)) : 1,
    certifiable: totalUnexpectedRegressions === 0,
  };
}
