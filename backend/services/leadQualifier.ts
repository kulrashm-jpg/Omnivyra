import { runDiagnosticPrompt } from './llm/openaiAdapter';
import type { RawPost } from './postDiscoveryConnectors/types';
import type { CompanyProfile } from './companyProfileService';
import type { CompanyMissionContext } from './companyMissionContext';
import { formatMissionContextForPrompt } from './companyMissionContext';
import { getConversionRate, applyPlatformWeight } from './leadPlatformStats';

export type QualificationResult = {
  problem_domain: string;
  icp_score: number;
  urgency_score: number;
  intent_score: number;
  risk_flag: boolean;
  recommended_tone: string;
  /** Quality score before engagement/freshness/platform adjustments. */
  total_score: number;
  /** LLM probability_of_response (0-1); used for ranking and display. */
  engagement_potential: number;
};

const ICP_WEIGHT = 0.4;
const URGENCY_WEIGHT = 0.3;
const INTENT_WEIGHT = 0.3;

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, Number(n)));
}

/** Lead Freshness Guard: daysOld <= 2 → +0.1, <= 7 → neutral, > 30 → -0.2 */
function getFreshnessFactor(postedAt: string | undefined): number {
  if (!postedAt) return 0;
  const postedMs = new Date(postedAt).getTime();
  const daysOld = (Date.now() - postedMs) / (1000 * 60 * 60 * 24);
  if (daysOld <= 2) return 0.1;
  if (daysOld <= 7) return 0;
  if (daysOld > 30) return -0.2;
  return 0;
}

/**
 * Qualify a raw post against company profile via LLM.
 * Returns structured scores; total_score = 0.4*icp + 0.3*urgency + 0.3*intent.
 * When missionContext or prebuiltContextBlock is provided, posts that do NOT indicate user confusion, frustration,
 * decision uncertainty, emotional distress, or intent to fix something are penalized (total_score * 0.5).
 */
export async function qualifyLead(
  rawPost: RawPost,
  companyProfile: CompanyProfile | null,
  missionContext?: CompanyMissionContext | null,
  prebuiltContextBlock?: string | null
): Promise<QualificationResult> {
  const contextBlock = prebuiltContextBlock != null && prebuiltContextBlock.length > 0
    ? prebuiltContextBlock
    : missionContext
      ? formatMissionContextForPrompt(missionContext)
      : companyProfile
        ? [
            companyProfile.ideal_customer_profile,
            companyProfile.target_audience,
            companyProfile.industry,
            companyProfile.content_themes,
          ]
            .filter(Boolean)
            .join(' | ')
            .slice(0, 500)
        : 'No company profile';

  const hasProblemContext = (missionContext != null || (prebuiltContextBlock != null && prebuiltContextBlock.length > 0));
  const problemInstruction = hasProblemContext
    ? '\nCritical: Set problem_indicated true ONLY if the post indicates: user confusion, explicit frustration, decision uncertainty, emotional distress, or intent to fix something. Talking about a problem is NOT the same as facing it. Set false for informational posts, event mentions, or surface-level discussions.'
    : '';

  const systemPrompt = `You are a lead qualification assistant. Given a public social post and optional company context, output valid JSON only in this exact shape:
{
  "problem_domain": string (short label),
  "icp_score": number (0-1, fit with ideal customer),
  "urgency_score": number (0-1, how time-sensitive),
  "intent_score": number (0-1, buying/solution-seeking intent),
  "risk_flag": boolean (sensitive or inappropriate),
  "recommended_tone": string (e.g. professional, friendly),
  "probability_of_response": number (0-1, likelihood they will respond to outreach),
  "problem_indicated": boolean (true if post shows person facing/experiencing a problem, false if just discussing or informing)
}${problemInstruction}`;

  const userPrompt = JSON.stringify(
    {
      post_snippet: rawPost.snippet,
      raw_text_preview: rawPost.raw_text.slice(0, 300),
      platform: rawPost.platform,
      company_context: contextBlock,
    },
    null,
    2
  );

  try {
    const { data } = await runDiagnosticPrompt<{
      problem_domain: string;
      icp_score: number;
      urgency_score: number;
      intent_score: number;
      risk_flag: boolean;
      recommended_tone: string;
      probability_of_response: number;
      problem_indicated?: boolean;
    }>(systemPrompt, userPrompt);

    const icp = clamp01(data?.icp_score ?? 0);
    const urgency = clamp01(data?.urgency_score ?? 0);
    const intent = clamp01(data?.intent_score ?? 0);
    const qualityScore =
      icp * ICP_WEIGHT + urgency * URGENCY_WEIGHT + intent * INTENT_WEIGHT;
    const freshnessFactor = getFreshnessFactor(rawPost.posted_at);
    let total_score = clamp01(qualityScore + freshnessFactor);

    if (hasProblemContext && data?.problem_indicated === false) {
      total_score = clamp01(total_score * 0.5);
    }
    const conversionRate = companyProfile?.company_id
      ? await getConversionRate(companyProfile.company_id, rawPost.platform ?? '')
      : 0;
    total_score = clamp01(applyPlatformWeight(total_score, conversionRate));
    const engagement_potential = clamp01(data?.probability_of_response ?? 0.5);

    return {
      problem_domain: typeof data?.problem_domain === 'string' ? data.problem_domain : 'General',
      icp_score: icp,
      urgency_score: urgency,
      intent_score: intent,
      risk_flag: Boolean(data?.risk_flag),
      recommended_tone: typeof data?.recommended_tone === 'string' ? data.recommended_tone : 'professional',
      total_score,
      engagement_potential,
    };
  } catch {
    return {
      problem_domain: 'Unknown',
      icp_score: 0,
      urgency_score: 0,
      intent_score: 0,
      risk_flag: true,
      recommended_tone: 'professional',
      total_score: 0,
      engagement_potential: 0,
    };
  }
}
