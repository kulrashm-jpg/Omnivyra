/**
 * CI-C311 — Company Shadow Validation (pure; report-only). Runs the full assembly per company in
 * SHADOW and measures field parity vs the legacy profile + completeness + per-engine abstention.
 * Report only — no production behaviour change, authoritative OFF.
 */

import type { CompanyIntelligenceContext } from './engineTypes';
import type { CompanyProfileInput } from '../fromProfile';
import { assembleCompanyUnderstanding } from './assembly';
import { compareToLegacy } from '../shadowRuntime';
import { COMPANY_FACET_NAMES } from '../types';
import { validateReasoning } from '../../intelligence/canonical';

export interface CompanyShadowValidation { companyId: string; parity: number; completeness: number; unsupportedConclusions: number; engineAbstentions: Record<string, boolean>; }
export interface CompanyShadowReport {
  companies: number;
  meanParity: number;
  meanCompleteness: number;
  totalUnsupportedConclusions: number;
  engineAbstentionRate: Record<string, number>;
  perCompany: CompanyShadowValidation[];
}

export function validateCompanyShadowBatch(cases: Array<{ ctx: CompanyIntelligenceContext; legacy: CompanyProfileInput }>): CompanyShadowReport {
  const perCompany: CompanyShadowValidation[] = [];
  const abstain: Record<string, number> = {};

  for (const { ctx, legacy } of cases) {
    const { understanding, engines } = assembleCompanyUnderstanding(ctx);
    const parity = compareToLegacy(understanding, legacy).parity;
    const nonNull = COMPANY_FACET_NAMES.filter((n) => understanding.facets[n].value !== null).length;
    const unsupported = understanding.reasoning.filter((t) => !validateReasoning(t).valid).length;
    const engineAbstentions: Record<string, boolean> = {};
    for (const e of engines) { engineAbstentions[e.engine] = e.abstained; abstain[e.engine] = (abstain[e.engine] ?? 0) + (e.abstained ? 1 : 0); }
    perCompany.push({ companyId: ctx.key.companyId, parity, completeness: Number((nonNull / COMPANY_FACET_NAMES.length).toFixed(4)), unsupportedConclusions: unsupported, engineAbstentions });
  }

  const n = perCompany.length || 1;
  const engineAbstentionRate: Record<string, number> = {};
  for (const [eng, count] of Object.entries(abstain)) engineAbstentionRate[eng] = Number((count / (perCompany.length || 1)).toFixed(4));
  return {
    companies: perCompany.length,
    meanParity: Number((perCompany.reduce((a, p) => a + p.parity, 0) / n).toFixed(4)),
    meanCompleteness: Number((perCompany.reduce((a, p) => a + p.completeness, 0) / n).toFixed(4)),
    totalUnsupportedConclusions: perCompany.reduce((a, p) => a + p.unsupportedConclusions, 0),
    engineAbstentionRate,
    perCompany,
  };
}
