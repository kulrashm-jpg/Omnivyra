/**
 * Report ROI Determinability  (BETA-REPORT-EXEC-005 — BR-H-004)
 *
 * A truthful, deterministic statement of WHETHER this report can quantify ROI — never a fabricated number. It
 * reuses the ENGINE-012 honest vocabulary (`ROIStatus`: measured | estimated | not_determinable) rather than
 * introducing a parallel ROI calculation. The live canonical report (Pipeline A) has NO connected commercial
 * evidence — no commercial provider in its registry and ENGINE-012 is unreachable from this path (see
 * BETA-REPORT-AUDIT-002 / EXEC-005) — so today this resolves to `not_determinable` / "Not Quantifiable". The
 * shape is future-proof: it upgrades honestly the moment real commercial evidence is connected. NO invented
 * revenue, NO heuristic estimate, NO fabricated currency.
 */
import type { ROIStatus } from '../evidencePlatform/business/businessImpactModel';

export interface ReportRoiDeterminability {
  status: ROIStatus;
  /** Executive-facing label for the status. */
  label: 'Quantified' | 'Estimated (native units)' | 'Not Quantifiable';
  /** Deterministic reason for the status — never a hidden assumption. */
  basis: string;
  /** Native-unit opportunity when determinable (clicks, reviews, …) — NEVER a fabricated revenue figure. */
  quantified: { value: number; unit: string } | null;
  /** How to reach a higher (more quantified) status; null when already measured. */
  unlock: string | null;
  confidence: 'high' | 'medium' | 'low' | 'none';
  limitations: string[];
}

export interface RoiDeterminabilityInput {
  /** Whether the report has connected commercial revenue/conversion evidence at all. */
  hasCommercialEvidence?: boolean;
  /** A deterministic native-unit opportunity, if one exists (e.g. additional clicks). Never dollars unless
   *  backed by measured revenue evidence. */
  quantified?: { value: number; unit: string } | null;
  /** Whether the quantity is backed by MEASURED revenue/conversion-value evidence. */
  measuredRevenue?: boolean;
}

const NOT_QUANTIFIABLE_LIMITS = [
  'ROI is not monetized: business impact is directional and stated in native terms, not currency.',
  'No revenue, conversion, or pipeline evidence is connected to this report.',
];

/**
 * Resolve the honest ROI determinability for a report. Deterministic; never fabricates a number. The default
 * (no input) is the current live state: `not_determinable` / "Not Quantifiable".
 */
export function resolveReportRoiDeterminability(
  input: RoiDeterminabilityInput = {},
): ReportRoiDeterminability {
  const quantified = input.quantified ?? null;

  // MEASURED — real revenue/conversion-value evidence backs the quantity.
  if (input.measuredRevenue && quantified) {
    return {
      status: 'measured',
      label: 'Quantified',
      basis: 'Backed by connected commercial revenue/conversion evidence.',
      quantified,
      unlock: null,
      confidence: 'high',
      limitations: [],
    };
  }

  // ESTIMATED — a deterministic native-unit opportunity exists (NOT invented revenue).
  if (quantified) {
    return {
      status: 'estimated',
      label: 'Estimated (native units)',
      basis: `Deterministic opportunity in native units (${quantified.unit}); not monetized — no revenue evidence connected.`,
      quantified,
      unlock: 'Connect commercial revenue/conversion evidence to monetize this opportunity.',
      confidence: 'medium',
      limitations: ['Expressed in native units, not currency — monetization requires connected revenue evidence.'],
    };
  }

  // NOT DETERMINABLE — no commercial evidence. The honest current live state.
  return {
    status: 'not_determinable',
    label: 'Not Quantifiable',
    basis: input.hasCommercialEvidence
      ? 'Commercial evidence is connected but insufficient to quantify a defensible ROI.'
      : 'No connected commercial evidence (revenue, conversions, pipeline) in this report.',
    quantified: null,
    unlock: 'Connect a commercial data source (CRM / revenue / conversions) to quantify ROI.',
    confidence: 'none',
    limitations: NOT_QUANTIFIABLE_LIMITS,
  };
}
