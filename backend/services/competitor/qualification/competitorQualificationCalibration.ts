/**
 * COMPETITOR-TAXONOMY-P2 — Calibration & validation harness.
 *
 * A representative cross-industry fixture set (taxonomy-SEEN and taxonomy-UNSEEN industries)
 * with ground-truth qualification labels, plus a runner that scores every case with the
 * multi-signal model AND with a taxonomy-only baseline that mirrors the live category gate.
 * The comparison quantifies the two calibration goals:
 *   • unseen industries qualify correctly on evidence (taxonomy abstains), and
 *   • no increase in false positives vs the live taxonomy gate.
 *
 * Pure & deterministic — consumed by the validation test and quoted in the report.
 */

import type { CompanyCompetitiveContext, CompetitorCandidate } from '../../competitorEngineServiceModel';
import { normalizeCompetitorCategory, categoryAffinity } from '../../competitorTaxonomy';
import { candidateSignalText, normalizeCompetitorDomain } from '../../competitorEngineServiceModel';
import {
  evaluateMultiSignalQualification,
  MULTISIGNAL_WEIGHT_PROFILE_V1,
  type MultiSignalQualification,
  type QualificationWeightProfile,
} from './competitorQualificationModel';

export interface CalibrationCase {
  id: string;
  industry: string;
  coverage: 'seen' | 'unseen';
  context: CompanyCompetitiveContext;
  candidate: CompetitorCandidate;
  /** Ground truth: is this candidate a genuine competitor of the company? */
  expectedCompetitor: boolean;
}

function ctx(partial: Partial<CompanyCompetitiveContext>): CompanyCompetitiveContext {
  return {
    marketFocus: null,
    primaryService: null,
    targetCustomer: null,
    idealCustomerProfile: null,
    brandPositioning: null,
    geography: null,
    teamSize: null,
    foundedYear: null,
    revenueRange: null,
    businessModel: null,
    entityArchetype: null,
    ...partial,
  };
}

function cand(partial: Partial<CompetitorCandidate> & { name: string }): CompetitorCandidate {
  return { source: 'serp_live', confidenceScore: 0.6, ...partial };
}

// ── Fixtures ────────────────────────────────────────────────────────────────
// SEEN industries exercise "existing supported industries retain accuracy".
// UNSEEN industries exercise "unknown industries qualify correctly" + "no FP increase".

const MENTAL_WELLNESS = ctx({
  marketFocus: 'mental wellness AI platform',
  primaryService: 'AI mental wellness chatbot for anxiety and stress, guided clarity and self-reflection',
  targetCustomer: 'individuals seeking emotional wellbeing and mental health support',
  idealCustomerProfile: 'consumers with anxiety, stress, seeking self-reflection',
  brandPositioning: 'clinically-informed emotional wellbeing companion',
  businessModel: 'B2C subscription',
});

const MARKETING_PLATFORM = ctx({
  marketFocus: 'AI marketing and content platform',
  primaryService: 'AI content generation, SEO copywriting and social media scheduling for brands',
  targetCustomer: 'B2B marketing teams and founders',
  idealCustomerProfile: 'SMB marketing teams doing content marketing and SEO',
  brandPositioning: 'AI marketing intelligence and content automation',
  businessModel: 'B2B SaaS',
});

const LOGISTICS = ctx({
  marketFocus: 'freight logistics visibility platform',
  primaryService: 'real-time shipment tracking and supply chain visibility for freight operators',
  targetCustomer: 'freight forwarders, carriers and logistics operators',
  idealCustomerProfile: 'mid-market logistics and supply chain teams',
  brandPositioning: 'end-to-end freight visibility and shipment tracking',
  businessModel: 'B2B SaaS',
});

const LEGALTECH = ctx({
  marketFocus: 'contract lifecycle management platform',
  primaryService: 'contract lifecycle management, clause automation and legal document review for legal teams',
  targetCustomer: 'in-house legal teams and general counsel',
  idealCustomerProfile: 'enterprise legal operations managing contracts',
  brandPositioning: 'AI contract management and clause automation',
  businessModel: 'B2B SaaS',
});

const AGRITECH = ctx({
  marketFocus: 'precision agriculture analytics platform',
  primaryService: 'precision farming crop analytics, soil sensors and yield prediction for farms',
  targetCustomer: 'farms, growers and agronomists',
  idealCustomerProfile: 'commercial farms adopting precision agriculture',
  brandPositioning: 'data-driven precision agriculture and crop yield analytics',
  businessModel: 'B2B SaaS',
});

export const CALIBRATION_CASES: CalibrationCase[] = [
  // ── Mental wellness (SEEN) ──
  {
    id: 'wellness-true',
    industry: 'mental_wellness',
    coverage: 'seen',
    context: MENTAL_WELLNESS,
    expectedCompetitor: true,
    candidate: cand({
      name: 'Wysa',
      domain: 'wysa.io',
      category: 'mental_wellness_ai',
      description: 'AI mental wellness chatbot for anxiety, stress and emotional wellbeing with guided self-reflection',
      targetCustomer: 'individuals seeking mental health and emotional support',
      businessModel: 'B2C subscription',
    }),
  },
  {
    id: 'wellness-companion-fp',
    industry: 'mental_wellness',
    coverage: 'seen',
    context: MENTAL_WELLNESS,
    expectedCompetitor: false,
    candidate: cand({
      name: 'Replika',
      domain: 'replika.com',
      category: 'ai_companion',
      description: 'AI companion and virtual friend for romantic relationships, conversation and companionship',
      targetCustomer: 'people seeking a virtual friend or romantic companion',
      businessModel: 'B2C subscription',
    }),
  },
  {
    id: 'wellness-crm-fp',
    industry: 'mental_wellness',
    coverage: 'seen',
    context: MENTAL_WELLNESS,
    expectedCompetitor: false,
    candidate: cand({
      name: 'HubSpot',
      domain: 'hubspot.com',
      category: 'crm_marketing_automation',
      description: 'CRM, marketing automation and sales pipeline software for B2B revenue teams',
      targetCustomer: 'B2B sales and marketing teams',
      businessModel: 'B2B SaaS',
    }),
  },
  // ── Marketing platform (SEEN) ──
  {
    id: 'marketing-true',
    industry: 'marketing_seo',
    coverage: 'seen',
    context: MARKETING_PLATFORM,
    expectedCompetitor: true,
    candidate: cand({
      name: 'Jasper',
      domain: 'jasper.ai',
      category: 'marketing_seo_software',
      description: 'AI content generation, SEO copywriting and marketing content platform for brands and marketing teams',
      targetCustomer: 'B2B marketing teams',
      businessModel: 'B2B SaaS',
    }),
  },
  {
    id: 'marketing-wellness-fp',
    industry: 'marketing_seo',
    coverage: 'seen',
    context: MARKETING_PLATFORM,
    expectedCompetitor: false,
    candidate: cand({
      name: 'Calm',
      domain: 'calm.com',
      category: 'meditation_mindfulness',
      description: 'Meditation, mindfulness and sleep app for relaxation and stress reduction',
      targetCustomer: 'consumers seeking meditation and better sleep',
      businessModel: 'B2C subscription',
    }),
  },
  // ── Logistics (UNSEEN) ──
  {
    id: 'logistics-true',
    industry: 'logistics',
    coverage: 'unseen',
    context: LOGISTICS,
    expectedCompetitor: true,
    candidate: cand({
      name: 'FourKites',
      domain: 'fourkites.com',
      category: 'supply chain visibility',
      description: 'real-time freight shipment tracking and supply chain visibility platform for carriers and logistics operators',
      targetCustomer: 'freight forwarders, carriers and logistics teams',
      businessModel: 'B2B SaaS',
    }),
  },
  {
    id: 'logistics-marketing-fp',
    industry: 'logistics',
    coverage: 'unseen',
    context: LOGISTICS,
    expectedCompetitor: false,
    candidate: cand({
      name: 'ContentPro',
      domain: 'contentpro.example',
      category: 'marketing agency',
      description: 'digital marketing agency offering SEO, content marketing and social media campaigns for brands',
      targetCustomer: 'consumer brands and marketing teams',
      businessModel: 'agency services',
    }),
  },
  // ── Legaltech (UNSEEN) ──
  {
    id: 'legaltech-true',
    industry: 'legaltech',
    coverage: 'unseen',
    context: LEGALTECH,
    expectedCompetitor: true,
    candidate: cand({
      name: 'Ironclad',
      domain: 'ironcladapp.com',
      category: 'contract management',
      description: 'contract lifecycle management and clause automation platform for in-house legal teams and general counsel',
      targetCustomer: 'enterprise legal operations and general counsel',
      businessModel: 'B2B SaaS',
    }),
  },
  {
    id: 'legaltech-wellness-fp',
    industry: 'legaltech',
    coverage: 'unseen',
    context: LEGALTECH,
    expectedCompetitor: false,
    candidate: cand({
      name: 'Headspace',
      domain: 'headspace.com',
      category: 'meditation_mindfulness',
      description: 'meditation and mindfulness app for stress, sleep and relaxation',
      targetCustomer: 'consumers seeking meditation and mindfulness',
      businessModel: 'B2C subscription',
    }),
  },
  // ── Agritech (UNSEEN) ──
  {
    id: 'agritech-true',
    industry: 'agritech',
    coverage: 'unseen',
    context: AGRITECH,
    expectedCompetitor: true,
    candidate: cand({
      name: 'Granular',
      domain: 'granular.ag',
      category: 'precision agriculture',
      description: 'precision agriculture crop analytics, soil data and yield prediction platform for farms and agronomists',
      targetCustomer: 'commercial farms, growers and agronomists',
      businessModel: 'B2B SaaS',
    }),
  },
  {
    id: 'agritech-crm-fp',
    industry: 'agritech',
    coverage: 'unseen',
    context: AGRITECH,
    expectedCompetitor: false,
    candidate: cand({
      name: 'Salesforce',
      domain: 'salesforce.com',
      category: 'crm_marketing_automation',
      description: 'CRM and sales automation software for B2B revenue and marketing teams',
      targetCustomer: 'enterprise sales and marketing teams',
      businessModel: 'B2B SaaS',
    }),
  },
];

// ── Runner ────────────────────────────────────────────────────────────────
export interface ConfusionMatrix {
  truePositive: number;
  falsePositive: number;
  trueNegative: number;
  falseNegative: number;
  precision: number;
  recall: number;
  falsePositiveRate: number;
  accuracy: number;
}

function emptyMatrix(): ConfusionMatrix {
  return {
    truePositive: 0,
    falsePositive: 0,
    trueNegative: 0,
    falseNegative: 0,
    precision: 0,
    recall: 0,
    falsePositiveRate: 0,
    accuracy: 0,
  };
}

function finalizeMatrix(m: ConfusionMatrix): ConfusionMatrix {
  const tp = m.truePositive;
  const fp = m.falsePositive;
  const tn = m.trueNegative;
  const fn = m.falseNegative;
  const round = (v: number) => Number(v.toFixed(3));
  return {
    ...m,
    precision: round(tp + fp > 0 ? tp / (tp + fp) : 1),
    recall: round(tp + fn > 0 ? tp / (tp + fn) : 1),
    falsePositiveRate: round(fp + tn > 0 ? fp / (fp + tn) : 0),
    accuracy: round(tp + fp + tn + fn > 0 ? (tp + tn) / (tp + fp + tn + fn) : 0),
  };
}

function tally(matrix: ConfusionMatrix, predictedCompetitor: boolean, expectedCompetitor: boolean): void {
  if (predictedCompetitor && expectedCompetitor) matrix.truePositive += 1;
  else if (predictedCompetitor && !expectedCompetitor) matrix.falsePositive += 1;
  else if (!predictedCompetitor && !expectedCompetitor) matrix.trueNegative += 1;
  else matrix.falseNegative += 1;
}

/**
 * Baseline decision that mirrors the LIVE taxonomy category gate (`hasStrictCategoryFit`):
 * a candidate is a competitor iff its normalized category has `same`/`functional` affinity
 * with the company's normalized category. This is what the current model relies on, and what
 * collapses every unseen industry into one bucket.
 */
export function taxonomyBaselineDecision(caseItem: CalibrationCase): boolean {
  const companyCategory = normalizeCompetitorCategory(
    caseItem.context.marketFocus,
    [caseItem.context.primaryService, caseItem.context.brandPositioning, caseItem.context.businessModel]
      .filter(Boolean)
      .join(' '),
  );
  const domain = normalizeCompetitorDomain(caseItem.candidate.domain ?? caseItem.candidate.name);
  const competitorCategory = normalizeCompetitorCategory(
    caseItem.candidate.category,
    candidateSignalText(caseItem.candidate, domain),
  );
  const affinity = categoryAffinity(companyCategory, competitorCategory);
  return affinity === 'same' || affinity === 'functional';
}

export interface CalibrationRow {
  id: string;
  industry: string;
  coverage: 'seen' | 'unseen';
  expectedCompetitor: boolean;
  multiSignal: MultiSignalQualification;
  multiSignalPredictsCompetitor: boolean;
  taxonomyBaselinePredictsCompetitor: boolean;
}

export interface CalibrationResult {
  rows: CalibrationRow[];
  multiSignal: ConfusionMatrix;
  multiSignalSeen: ConfusionMatrix;
  multiSignalUnseen: ConfusionMatrix;
  taxonomyBaseline: ConfusionMatrix;
  taxonomyBaselineUnseen: ConfusionMatrix;
}

/** Score every fixture with both models and compute confusion matrices. Pure. */
export function runCalibration(
  cases: CalibrationCase[] = CALIBRATION_CASES,
  profile: QualificationWeightProfile = MULTISIGNAL_WEIGHT_PROFILE_V1,
): CalibrationResult {
  const rows: CalibrationRow[] = [];
  const multiSignal = emptyMatrix();
  const multiSignalSeen = emptyMatrix();
  const multiSignalUnseen = emptyMatrix();
  const taxonomyBaseline = emptyMatrix();
  const taxonomyBaselineUnseen = emptyMatrix();

  for (const caseItem of cases) {
    const q = evaluateMultiSignalQualification(caseItem.candidate, caseItem.context, profile);
    // Qualification counts as "predicts competitor" when qualified (not borderline) — the
    // decision the live filter would surface as a genuine competitor.
    const msPredicts = q.decision === 'qualified';
    const baselinePredicts = taxonomyBaselineDecision(caseItem);

    tally(multiSignal, msPredicts, caseItem.expectedCompetitor);
    tally(caseItem.coverage === 'seen' ? multiSignalSeen : multiSignalUnseen, msPredicts, caseItem.expectedCompetitor);
    tally(taxonomyBaseline, baselinePredicts, caseItem.expectedCompetitor);
    if (caseItem.coverage === 'unseen') tally(taxonomyBaselineUnseen, baselinePredicts, caseItem.expectedCompetitor);

    rows.push({
      id: caseItem.id,
      industry: caseItem.industry,
      coverage: caseItem.coverage,
      expectedCompetitor: caseItem.expectedCompetitor,
      multiSignal: q,
      multiSignalPredictsCompetitor: msPredicts,
      taxonomyBaselinePredictsCompetitor: baselinePredicts,
    });
  }

  return {
    rows,
    multiSignal: finalizeMatrix(multiSignal),
    multiSignalSeen: finalizeMatrix(multiSignalSeen),
    multiSignalUnseen: finalizeMatrix(multiSignalUnseen),
    taxonomyBaseline: finalizeMatrix(taxonomyBaseline),
    taxonomyBaselineUnseen: finalizeMatrix(taxonomyBaselineUnseen),
  };
}
