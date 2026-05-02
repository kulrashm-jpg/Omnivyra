import { supabase } from '../db/supabaseClient';
import { normalizeCompetitorCategory, type StandardCompetitorCategory } from './competitorTaxonomy';
import type { CompetitorCandidate, RankedCompetitor } from './competitorEngineService';

export const COMPETITOR_FEEDBACK_TABLE = 'competitor_feedback';

export type CompetitorFeedbackType = 'correct' | 'incorrect' | 'missing';

export type CompetitorFeedbackRow = {
  company_id: string;
  competitor_name: string;
  category: string | null;
  feedback_type: CompetitorFeedbackType;
  created_at: string;
};

export type CompetitorFeedbackDecision = {
  suppressed: boolean;
  relevanceScoreBoost: number;
  finalScoreBoost: number;
  confidenceBoost: number;
  reason: string | null;
};

export type CompetitorFeedbackMemory = {
  decisionsByName: Record<string, CompetitorFeedbackDecision>;
  missingCompetitorNames: string[];
};

type BuildFeedbackMemoryParams = {
  companyId?: string | null;
  categories?: Array<string | null | undefined> | null;
};

type LoadFeedbackMemoryParams = BuildFeedbackMemoryParams & {
  limit?: number;
};

const LEGAL_SUFFIX_PATTERN = /\b(private limited|pvt ltd|pvt|limited liability company|llc|llp|incorporated|inc|ltd|limited|plc|corp|corporation|company|co|technologies|technology|solutions|services|service)\b/g;
const GLOBAL_FEEDBACK_MIN_COUNT = 3;

function cleanText(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeId(value: string | null | undefined): string {
  return cleanText(value).toLowerCase();
}

export function normalizeCompetitorFeedbackName(value: string | null | undefined): string {
  return cleanText(value)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(LEGAL_SUFFIX_PATTERN, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeCompetitorFeedbackCategory(value: string | null | undefined): StandardCompetitorCategory | null {
  const cleaned = cleanText(value);
  if (!cleaned) return null;
  return normalizeCompetitorCategory(cleaned, cleaned);
}

function uniqueCategories(values: Array<string | null | undefined> | null | undefined): StandardCompetitorCategory[] {
  return Array.from(new Set(
    (values ?? [])
      .map((value) => normalizeCompetitorFeedbackCategory(value))
      .filter((value): value is StandardCompetitorCategory => Boolean(value)),
  ));
}

function feedbackType(value: unknown): CompetitorFeedbackType | null {
  const type = cleanText(value).toLowerCase();
  if (type === 'correct' || type === 'incorrect' || type === 'missing') return type;
  return null;
}

function categoryApplies(rowCategory: StandardCompetitorCategory | null, categories: StandardCompetitorCategory[]): boolean {
  if (!rowCategory) return true;
  if (categories.length === 0) return true;
  return categories.includes(rowCategory);
}

function positiveFeedback(type: CompetitorFeedbackType): boolean {
  return type === 'correct' || type === 'missing';
}

type FeedbackCounts = {
  displayName: string;
  localCorrect: number;
  localIncorrect: number;
  localMissing: number;
  globalPositive: number;
  globalIncorrect: number;
};

function emptyCounts(displayName: string): FeedbackCounts {
  return {
    displayName,
    localCorrect: 0,
    localIncorrect: 0,
    localMissing: 0,
    globalPositive: 0,
    globalIncorrect: 0,
  };
}

function decisionFromCounts(counts: FeedbackCounts): CompetitorFeedbackDecision {
  if (counts.localIncorrect > 0) {
    return {
      suppressed: true,
      relevanceScoreBoost: 0,
      finalScoreBoost: 0,
      confidenceBoost: 0,
      reason: 'company_feedback_rejected',
    };
  }

  if (
    counts.globalIncorrect >= GLOBAL_FEEDBACK_MIN_COUNT &&
    counts.globalIncorrect >= Math.max(GLOBAL_FEEDBACK_MIN_COUNT, counts.globalPositive * 2)
  ) {
    return {
      suppressed: true,
      relevanceScoreBoost: 0,
      finalScoreBoost: 0,
      confidenceBoost: 0,
      reason: 'category_feedback_rejected',
    };
  }

  const localPositive = counts.localCorrect + counts.localMissing;
  let relevanceScoreBoost = localPositive > 0 ? 3 : 0;
  let finalScoreBoost = localPositive > 0 ? 0.03 : 0;
  let confidenceBoost = localPositive > 0 ? 0.03 : 0;

  if (counts.globalPositive >= GLOBAL_FEEDBACK_MIN_COUNT && counts.globalPositive > counts.globalIncorrect) {
    relevanceScoreBoost += 2;
    finalScoreBoost += 0.015;
    confidenceBoost += 0.02;
  }

  relevanceScoreBoost = Math.min(relevanceScoreBoost, 5);
  finalScoreBoost = Math.min(finalScoreBoost, 0.05);
  confidenceBoost = Math.min(confidenceBoost, 0.05);

  return {
    suppressed: false,
    relevanceScoreBoost,
    finalScoreBoost,
    confidenceBoost,
    reason: relevanceScoreBoost > 0 ? 'feedback_confirmed' : null,
  };
}

export function buildCompetitorFeedbackMemory(
  rows: Array<Partial<CompetitorFeedbackRow>>,
  params: BuildFeedbackMemoryParams = {},
): CompetitorFeedbackMemory {
  const categories = uniqueCategories(params.categories);
  const companyId = normalizeId(params.companyId);
  const countsByName = new Map<string, FeedbackCounts>();
  const missingNames = new Map<string, string>();

  for (const row of rows) {
    const normalizedName = normalizeCompetitorFeedbackName(row.competitor_name);
    if (!normalizedName) continue;

    const type = feedbackType(row.feedback_type);
    if (!type) continue;

    const displayName = cleanText(row.competitor_name);
    const rowCategory = normalizeCompetitorFeedbackCategory(row.category ?? null);
    const rowCompanyId = normalizeId(row.company_id);
    const appliesToCategory = categoryApplies(rowCategory, categories);
    const counts = countsByName.get(normalizedName) ?? emptyCounts(displayName);
    counts.displayName = counts.displayName || displayName;

    if (companyId && rowCompanyId === companyId && appliesToCategory) {
      if (type === 'correct') counts.localCorrect += 1;
      if (type === 'incorrect') counts.localIncorrect += 1;
      if (type === 'missing') {
        counts.localMissing += 1;
        missingNames.set(normalizedName, displayName);
      }
    }

    if (rowCategory && categories.length > 0 && categories.includes(rowCategory)) {
      if (positiveFeedback(type)) counts.globalPositive += 1;
      if (type === 'incorrect') counts.globalIncorrect += 1;
    }

    countsByName.set(normalizedName, counts);
  }

  const decisionsByName: Record<string, CompetitorFeedbackDecision> = {};
  for (const [name, counts] of countsByName.entries()) {
    decisionsByName[name] = decisionFromCounts(counts);
  }

  const missingCompetitorNames = Array.from(missingNames.entries())
    .filter(([normalizedName]) => !decisionsByName[normalizedName]?.suppressed)
    .map(([, name]) => name);

  return { decisionsByName, missingCompetitorNames };
}

export async function loadCompetitorFeedbackMemory(
  params: LoadFeedbackMemoryParams = {},
): Promise<CompetitorFeedbackMemory> {
  const companyId = cleanText(params.companyId);
  const categories = uniqueCategories(params.categories);
  if (!companyId && categories.length === 0) {
    return buildCompetitorFeedbackMemory([], params);
  }

  try {
    const { data, error } = await supabase
      .from(COMPETITOR_FEEDBACK_TABLE)
      .select('company_id, competitor_name, category, feedback_type, created_at')
      .order('created_at', { ascending: false })
      .limit(params.limit ?? 1000);

    if (error) {
      console.warn('[competitor-feedback][load-failed]', {
        company_id: companyId || null,
        error: error.message,
      });
      return buildCompetitorFeedbackMemory([], params);
    }

    return buildCompetitorFeedbackMemory((data ?? []) as CompetitorFeedbackRow[], {
      companyId,
      categories,
    });
  } catch (error) {
    console.warn('[competitor-feedback][load-failed]', {
      company_id: companyId || null,
      error: error instanceof Error ? error.message : String(error),
    });
    return buildCompetitorFeedbackMemory([], params);
  }
}

export function getCompetitorFeedbackDecision(
  memory: CompetitorFeedbackMemory | null | undefined,
  competitor: Pick<RankedCompetitor, 'name'>,
): CompetitorFeedbackDecision | null {
  const normalizedName = normalizeCompetitorFeedbackName(competitor.name);
  if (!normalizedName) return null;
  return memory?.decisionsByName[normalizedName] ?? null;
}

export function applyCompetitorFeedbackBoost(
  competitor: RankedCompetitor,
  decision: CompetitorFeedbackDecision | null | undefined,
): RankedCompetitor {
  if (
    !decision ||
    decision.suppressed ||
    (decision.relevanceScoreBoost <= 0 && decision.finalScoreBoost <= 0 && decision.confidenceBoost <= 0)
  ) {
    return competitor;
  }

  return {
    ...competitor,
    relevance_score: Math.min(100, Number(competitor.relevance_score ?? 0) + decision.relevanceScoreBoost),
    final_score: Math.min(1, Number(competitor.final_score ?? 0) + decision.finalScoreBoost),
    enrichment_confidence_score: Math.min(
      1,
      Number(competitor.enrichment_confidence_score ?? competitor.enrichment?.confidence_score ?? 0) + decision.confidenceBoost,
    ),
    rationale: competitor.rationale.includes('Feedback learning:')
      ? competitor.rationale
      : `${competitor.rationale} Feedback learning: prior corrections confirmed this competitor.`,
  };
}

export function buildFeedbackMissingCompetitorCandidates(
  memory: CompetitorFeedbackMemory | null | undefined,
): CompetitorCandidate[] {
  return (memory?.missingCompetitorNames ?? []).map((name) => ({
    name,
    source: 'manual',
    rationale: 'User feedback marked this as a missing competitor; engine revalidation still required.',
  }));
}

export async function recordCompetitorFeedback(input: {
  companyId: string;
  competitorName: string;
  category?: string | null;
  feedbackType: CompetitorFeedbackType;
  createdAt?: string | null;
}): Promise<CompetitorFeedbackRow> {
  const companyId = cleanText(input.companyId);
  const competitorName = cleanText(input.competitorName);
  const type = feedbackType(input.feedbackType);

  if (!companyId) throw new Error('company_id required');
  if (!competitorName) throw new Error('competitor_name required');
  if (!type) throw new Error("feedback_type must be 'correct', 'incorrect', or 'missing'");

  const row: CompetitorFeedbackRow = {
    company_id: companyId,
    competitor_name: competitorName,
    category: normalizeCompetitorFeedbackCategory(input.category ?? null),
    feedback_type: type,
    created_at: input.createdAt ?? new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from(COMPETITOR_FEEDBACK_TABLE)
    .insert(row)
    .select('company_id, competitor_name, category, feedback_type, created_at')
    .single();

  if (error) throw new Error(error.message);
  return (data ?? row) as CompetitorFeedbackRow;
}
