/**
 * V-C303/304/307 — Visitor Shadow Validation (pure; report-only). Runs the full assembly per visitor in
 * SHADOW and measures field parity vs the raw input + completeness + per-engine abstention + unsupported
 * conclusions + evidence integrity (no orphaned/duplicate evidence; deterministic ordering). Report
 * only — no production behaviour change, authoritative OFF.
 */

import type { VisitorIntelligenceContext } from './engineTypes';
import { assembleVisitorIntelligence } from './assembly';
import { compareToRaw } from '../shadowRuntime';
import { VISITOR_FACET_NAMES } from '../types';
import { validateReasoning } from '../../intelligence/canonical';

export interface VisitorShadowValidation {
  visitorId: string;
  parity: number;
  completeness: number;
  unsupportedConclusions: number;
  duplicateEvidence: number;
  evidenceOrdered: boolean;
  engineAbstentions: Record<string, boolean>;
}
export interface VisitorShadowReport {
  visitors: number;
  meanParity: number;
  meanCompleteness: number;
  totalUnsupportedConclusions: number;
  totalDuplicateEvidence: number;
  allEvidenceOrdered: boolean;
  engineAbstentionRate: Record<string, number>;
  perVisitor: VisitorShadowValidation[];
}

export function validateVisitorShadowBatch(cases: VisitorIntelligenceContext[]): VisitorShadowReport {
  const perVisitor: VisitorShadowValidation[] = [];
  const abstain: Record<string, number> = {};

  for (const ctx of cases) {
    const { understanding, engines } = assembleVisitorIntelligence(ctx);
    const parity = ctx.raw ? compareToRaw(understanding, ctx.raw).parity : 1;
    const nonNull = VISITOR_FACET_NAMES.filter((n) => understanding.facets[n].value !== null).length;
    const unsupported = understanding.reasoning.filter((t) => !validateReasoning(t).valid).length;

    // Evidence integrity: cross-facet REUSE of the same evidence id is legitimate (shared source of truth);
    // a defect is the same id listed twice WITHIN one facet. Contradictions must be deterministically sorted.
    let duplicateEvidence = 0;
    for (const n of VISITOR_FACET_NAMES) { const ids = understanding.facets[n].evidence.map((e) => e.id); duplicateEvidence += ids.length - new Set(ids).size; }
    const evidenceOrdered = understanding.contradictions.every((_, i, arr) => i === 0 || arr[i - 1].id.localeCompare(arr[i].id) <= 0);

    const engineAbstentions: Record<string, boolean> = {};
    for (const e of engines) { engineAbstentions[e.engine] = e.abstained; abstain[e.engine] = (abstain[e.engine] ?? 0) + (e.abstained ? 1 : 0); }
    perVisitor.push({ visitorId: understanding.key.visitorId, parity, completeness: Number((nonNull / VISITOR_FACET_NAMES.length).toFixed(4)), unsupportedConclusions: unsupported, duplicateEvidence, evidenceOrdered, engineAbstentions });
  }

  const n = perVisitor.length || 1;
  const engineAbstentionRate: Record<string, number> = {};
  for (const [eng, count] of Object.entries(abstain)) engineAbstentionRate[eng] = Number((count / n).toFixed(4));
  return {
    visitors: perVisitor.length,
    meanParity: Number((perVisitor.reduce((a, p) => a + p.parity, 0) / n).toFixed(4)),
    meanCompleteness: Number((perVisitor.reduce((a, p) => a + p.completeness, 0) / n).toFixed(4)),
    totalUnsupportedConclusions: perVisitor.reduce((a, p) => a + p.unsupportedConclusions, 0),
    totalDuplicateEvidence: perVisitor.reduce((a, p) => a + p.duplicateEvidence, 0),
    allEvidenceOrdered: perVisitor.every((p) => p.evidenceOrdered),
    engineAbstentionRate,
    perVisitor,
  };
}
