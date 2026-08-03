/**
 * INT-001 Phase 2 — configurable scoring configuration.
 *
 * Every number the engines use lives here so scoring is tunable without code
 * changes and no engine hardcodes point values. `defaultEngineConfig` is the
 * shipped baseline; callers may pass a partial override.
 */

import type { PageCategory, Persona, QualificationSectionKey } from './types';
import { defaultPageClassifierConfig, type PageClassifierConfig } from './pageClassifier';

export interface IntentEngineConfig {
  /** Points granted per distinct visit to a page category, and the cap per category. */
  pageCategoryPoints: Partial<Record<PageCategory, { points: number; cap: number; label: string }>>;
  /** Event names treated as a content download. */
  downloadEventNames: string[];
  downloadPoints: { points: number; cap: number };
  /** Repeat visitor (more than one session). */
  repeatVisitPoints: { pointsPerExtraSession: number; cap: number };
  /** Scroll depth (%) at or above which a page counts as deeply read. */
  deepScrollThreshold: number;
  deepScrollPoints: { points: number; cap: number };
  /** Dwell: seconds between consecutive events in a session to count as engaged dwell. */
  dwellSecondsThreshold: number;
  dwellPoints: { points: number; cap: number };
  /** Recency of last activity relative to `now`. */
  recency: Array<{ withinDays: number; points: number; label: string }>;
  /** Visit frequency: distinct active days. */
  frequency: { pointsPerActiveDay: number; cap: number };
  bands: { high: number; medium: number }; // score >= high → 'high', >= medium → 'medium', > 0 → 'low'
  maxScore: number;
}

export interface PersonaRule {
  persona: Persona;
  titleKeywords: string[];
  /** Substrings matched against the email domain (lowercased). */
  domainKeywords: string[];
  /** Page categories whose visits support this persona. */
  behaviorCategories: PageCategory[];
  titlePoints: number;
  domainPoints: number;
  behaviorPoints: number;
}

export interface PersonaEngineConfig {
  rules: PersonaRule[];
  freeEmailDomains: string[];
  studentDomainSuffixes: string[];
  studentPoints: number;
  /** Minimum winning score for a non-Unknown persona. */
  minScore: number;
  /** Score at which confidence saturates to maxConfidence. */
  saturationScore: number;
  maxConfidence: number;
}

export interface QualificationEngineConfig {
  weights: Record<QualificationSectionKey, number>; // must sum to 1
  bands: { hot: number; warm: number; cool: number }; // total >= hot → 'hot', etc.
  companyFit: {
    enterpriseSizes: string[];
    midMarketSizes: string[];
    enterprisePoints: number;
    midMarketPoints: number;
    smallCompanyPoints: number;
    corporateDomainPoints: number;
    industryKnownPoints: number;
    companyNamePoints: number;
  };
  behavior: {
    pointsPerEvent: number;
    eventCap: number;
    pointsPerDistinctPage: number;
    distinctPageCap: number;
    deepScrollBonus: number;
    downloadBonus: number;
  };
  urgency: {
    recency: Array<{ withinDays: number; points: number }>;
    demoOrPricingLastSessionPoints: number;
    acceleratingVisitsPoints: number;
  };
}

export interface SegmentationEngineConfig {
  /** Minimum confidence to include a segment in output. */
  minConfidence: number;
  /** Intent score at/above which High Intent Buyers applies. */
  highIntentScore: number;
  /** Max events for Cold Visitors. */
  coldVisitorMaxEvents: number;
  /** Distinct docs/blog pages to qualify as Researchers. */
  researcherMinPages: number;
}

export interface RecommendationEngineConfig {
  meetingProbability: { base: number; perQualificationPoint: number; max: number };
  closeProbability: { base: number; perQualificationPoint: number; companyFitFactor: number; max: number };
}

export interface LeadIntelligenceEngineConfig {
  pageClassifier: PageClassifierConfig;
  intent: IntentEngineConfig;
  persona: PersonaEngineConfig;
  qualification: QualificationEngineConfig;
  segmentation: SegmentationEngineConfig;
  recommendation: RecommendationEngineConfig;
}

export const defaultEngineConfig: LeadIntelligenceEngineConfig = {
  pageClassifier: defaultPageClassifierConfig,
  intent: {
    pageCategoryPoints: {
      pricing: { points: 10, cap: 20, label: 'Pricing' },
      enterprise: { points: 9, cap: 18, label: 'Enterprise' },
      demo: { points: 15, cap: 30, label: 'Demo' },
      comparison: { points: 8, cap: 16, label: 'Comparison' },
      documentation: { points: 6, cap: 12, label: 'Documentation' },
      security: { points: 7, cap: 14, label: 'Security' },
      case_study: { points: 5, cap: 10, label: 'Case Study' },
      download: { points: 6, cap: 12, label: 'Download Page' },
    },
    downloadEventNames: ['download', 'file_download', 'asset_download'],
    downloadPoints: { points: 6, cap: 12 },
    repeatVisitPoints: { pointsPerExtraSession: 6, cap: 12 },
    deepScrollThreshold: 75,
    deepScrollPoints: { points: 3, cap: 9 },
    dwellSecondsThreshold: 45,
    dwellPoints: { points: 3, cap: 9 },
    recency: [
      { withinDays: 1, points: 10, label: 'Active in the last 24 hours' },
      { withinDays: 7, points: 6, label: 'Active in the last 7 days' },
      { withinDays: 30, points: 3, label: 'Active in the last 30 days' },
    ],
    frequency: { pointsPerActiveDay: 3, cap: 12 },
    bands: { high: 70, medium: 40 },
    maxScore: 100,
  },
  persona: {
    rules: [
      { persona: 'Founder', titleKeywords: ['founder', 'co-founder', 'owner'], domainKeywords: [], behaviorCategories: ['pricing', 'demo'], titlePoints: 60, domainPoints: 0, behaviorPoints: 5 },
      { persona: 'CEO', titleKeywords: ['ceo', 'chief executive'], domainKeywords: [], behaviorCategories: ['pricing', 'enterprise'], titlePoints: 60, domainPoints: 0, behaviorPoints: 5 },
      { persona: 'CTO', titleKeywords: ['cto', 'chief technology', 'chief technical', 'vp engineering', 'head of engineering'], domainKeywords: [], behaviorCategories: ['documentation', 'security'], titlePoints: 60, domainPoints: 0, behaviorPoints: 5 },
      { persona: 'Marketing', titleKeywords: ['marketing', 'growth', 'brand', 'content', 'demand gen', 'cmo'], domainKeywords: [], behaviorCategories: ['blog', 'case_study'], titlePoints: 55, domainPoints: 0, behaviorPoints: 5 },
      { persona: 'Sales', titleKeywords: ['sales', 'account executive', 'business development', 'revenue', 'cro'], domainKeywords: [], behaviorCategories: ['pricing'], titlePoints: 55, domainPoints: 0, behaviorPoints: 4 },
      { persona: 'Developer', titleKeywords: ['developer', 'engineer', 'programmer', 'architect', 'devops'], domainKeywords: [], behaviorCategories: ['documentation'], titlePoints: 55, domainPoints: 0, behaviorPoints: 8 },
      { persona: 'Procurement', titleKeywords: ['procurement', 'purchasing', 'vendor management', 'sourcing'], domainKeywords: [], behaviorCategories: ['security', 'pricing'], titlePoints: 60, domainPoints: 0, behaviorPoints: 4 },
      { persona: 'Agency', titleKeywords: ['agency'], domainKeywords: ['agency', 'studio', 'media'], behaviorCategories: ['pricing'], titlePoints: 45, domainPoints: 25, behaviorPoints: 3 },
      { persona: 'Consultant', titleKeywords: ['consultant', 'advisor', 'freelance'], domainKeywords: ['consulting'], behaviorCategories: [], titlePoints: 50, domainPoints: 20, behaviorPoints: 0 },
      { persona: 'Partner', titleKeywords: ['partnership', 'alliances', 'channel'], domainKeywords: [], behaviorCategories: ['partners'], titlePoints: 50, domainPoints: 0, behaviorPoints: 15 },
      { persona: 'Investor', titleKeywords: ['investor', 'venture', 'principal at', 'general partner'], domainKeywords: ['capital', 'ventures'], behaviorCategories: ['investors'], titlePoints: 55, domainPoints: 20, behaviorPoints: 12 },
      { persona: 'Recruiter', titleKeywords: ['recruiter', 'talent', 'people ops', 'human resources'], domainKeywords: [], behaviorCategories: ['careers'], titlePoints: 55, domainPoints: 0, behaviorPoints: 8 },
    ],
    freeEmailDomains: ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com', 'proton.me', 'protonmail.com', 'aol.com'],
    studentDomainSuffixes: ['.edu', '.ac.uk', '.ac.in', '.edu.au'],
    studentPoints: 55,
    minScore: 20,
    saturationScore: 80,
    maxConfidence: 0.95,
  },
  qualification: {
    weights: { intent: 0.35, persona: 0.15, companyFit: 0.2, behavior: 0.2, urgency: 0.1 },
    bands: { hot: 75, warm: 50, cool: 25 },
    companyFit: {
      enterpriseSizes: ['201-500', '501-1000', '1000+', '1001-5000', '5000+'],
      midMarketSizes: ['51-200', '50-200'],
      enterprisePoints: 40,
      midMarketPoints: 25,
      smallCompanyPoints: 10,
      corporateDomainPoints: 30,
      industryKnownPoints: 15,
      companyNamePoints: 15,
    },
    behavior: {
      pointsPerEvent: 2,
      eventCap: 40,
      pointsPerDistinctPage: 5,
      distinctPageCap: 30,
      deepScrollBonus: 15,
      downloadBonus: 15,
    },
    urgency: {
      recency: [
        { withinDays: 1, points: 50 },
        { withinDays: 3, points: 35 },
        { withinDays: 7, points: 20 },
        { withinDays: 30, points: 10 },
      ],
      demoOrPricingLastSessionPoints: 30,
      acceleratingVisitsPoints: 20,
    },
  },
  segmentation: {
    minConfidence: 0.3,
    highIntentScore: 70,
    coldVisitorMaxEvents: 2,
    researcherMinPages: 3,
  },
  recommendation: {
    meetingProbability: { base: 0.05, perQualificationPoint: 0.007, max: 0.9 },
    closeProbability: { base: 0.02, perQualificationPoint: 0.004, companyFitFactor: 0.002, max: 0.75 },
  },
};

/** Shallow-merge a partial override onto the default config (top-level sections). */
export function resolveEngineConfig(override?: Partial<LeadIntelligenceEngineConfig>): LeadIntelligenceEngineConfig {
  if (!override) return defaultEngineConfig;
  return {
    pageClassifier: override.pageClassifier ?? defaultEngineConfig.pageClassifier,
    intent: override.intent ?? defaultEngineConfig.intent,
    persona: override.persona ?? defaultEngineConfig.persona,
    qualification: override.qualification ?? defaultEngineConfig.qualification,
    segmentation: override.segmentation ?? defaultEngineConfig.segmentation,
    recommendation: override.recommendation ?? defaultEngineConfig.recommendation,
  };
}
