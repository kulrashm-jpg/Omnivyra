import { runDiagnosticPrompt } from './llm/openaiAdapter';
import type { RawPost } from './socialConnectors/types';
import type { CompanyProfile } from './companyProfileService';
import type { CompanyMissionContext } from './companyMissionContext';
import { formatMissionContextForPrompt } from './companyMissionContext';
import { getConversionRate, applyPlatformWeight } from './leadPlatformStats';

export type PredictiveQualificationResult = {
  problem_domain: string;
  icp_score: number;
  urgency_score: number;
  intent_score: number;
  trend_velocity: number;
  conversion_window_days: number;
  risk_flag: boolean;
  recommended_tone: string;
  total_score: number;
};

const ICP_WEIGHT = 0.35;
const URGENCY_WEIGHT = 0.25;
const INTENT_WEIGHT = 0.25;
const TREND_BONUS_MAX = 0.15;

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, Number(n)));
}

/**
 * Conversion window estimation based on urgency:
 * urgency > 0.7 → 3–7 days; 0.4–0.7 → 7–21 days; else → 21–60 days
 */
function estimateConversionWindowDays(urgencyScore: number): number {
  if (urgencyScore > 0.7) return 5;
  if (urgencyScore >= 0.4) return 14;
  return 40;
}

/**
 * Predictive (latent) lead qualification: early-stage signals, emerging dissatisfaction,
 * trend clusters, behavior indicating future decision window.
 * When missionContext or prebuiltContextBlock is provided, posts that do NOT indicate user confusion, frustration,
 * decision uncertainty, or emotional distress are penalized (total_score * 0.5).
 */
export async function qualifyPredictiveLead(
  rawPost: RawPost,
  companyProfile: CompanyProfile | null,
  missionContext?: CompanyMissionContext | null,
  prebuiltContextBlock?: string | null
): Promise<PredictiveQualificationResult> {
  const contextBlock = prebuiltContextBlock != null && prebuiltContextBlock.length > 0
    ? prebuiltContextBlock
    : missionContext
      ? formatMissionContextForPrompt(missionContext)
      : companyProfile
      ? [
          companyProfile.ideal_customer_profile,
          companyProfile.target_audience,
          companyProfile.industry,
        ]
          .filter(Boolean)
          .join(' | ')
          .slice(0, 400)
      : 'No company profile';

  const hasProblemContext = (missionContext != null || (prebuiltContextBlock != null && prebuiltContextBlock.length > 0));
  const problemInstruction = hasProblemContext
    ? '\nCritical: Set problem_indicated true ONLY if the post indicates: user confusion, explicit frustration, decision uncertainty, emotional distress, or intent to fix something. Set false for informational posts, event mentions, or surface-level discussions.'
    : '';

  const systemPrompt = `You are a predictive lead scoring assistant. Detect early-stage signals, emerging dissatisfaction, trend clusters, and behavior indicating future decision window in public social posts. Output valid JSON only in this exact shape:
{
  "problem_domain": string (short label),
  "icp_score": number (0-1, fit with ideal customer),
  "urgency_score": number (0-1, time-sensitivity of need),
  "intent_score": number (0-1, implied or latent buying/solution-seeking intent),
  "trend_velocity": number (0-1, how fast interest is growing, 0 = static),
  "conversion_window_days": number (0-90, estimated days until conversion window closes),
  "risk_flag": boolean (sensitive or inappropriate),
  "recommended_tone": string (e.g. professional, empathetic),
  "problem_indicated": boolean (true if post shows person facing/experiencing a problem)
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
      trend_velocity: number;
      conversion_window_days: number;
      risk_flag: boolean;
      recommended_tone: string;
      problem_indicated?: boolean;
    }>(systemPrompt, userPrompt);

    const icp = clamp01(data?.icp_score ?? 0);
    const urgency = clamp01(data?.urgency_score ?? 0);
    const intent = clamp01(data?.intent_score ?? 0);

    let trend_velocity = clamp01(data?.trend_velocity ?? 0);
    if (trend_velocity === 0 && urgency > 0) {
      trend_velocity = clamp01(urgency * 0.7);
    }

    let conversion_window_days = Math.min(
      90,
      Math.max(0, Math.round(Number(data?.conversion_window_days) || 0))
    );
    if (conversion_window_days === 0) {
      conversion_window_days = estimateConversionWindowDays(urgency);
    }

    const base_score = icp * ICP_WEIGHT + urgency * URGENCY_WEIGHT + intent * INTENT_WEIGHT;
    const trend_bonus = Math.min(trend_velocity * 0.15, TREND_BONUS_MAX);
    let total_score = clamp01(base_score + trend_bonus);

    if (hasProblemContext && data?.problem_indicated === false) {
      total_score = clamp01(total_score * 0.5);
    }

    const conversionRate = companyProfile?.company_id
      ? await getConversionRate(companyProfile.company_id, rawPost.platform ?? '')
      : 0;
    total_score = clamp01(applyPlatformWeight(total_score, conversionRate));

    return {
      problem_domain: typeof data?.problem_domain === 'string' ? data.problem_domain : 'General',
      icp_score: icp,
      urgency_score: urgency,
      intent_score: intent,
      trend_velocity,
      conversion_window_days,
      risk_flag: Boolean(data?.risk_flag),
      recommended_tone: typeof data?.recommended_tone === 'string' ? data.recommended_tone : 'professional',
      total_score,
    };
  } catch {
    return {
      problem_domain: 'Unknown',
      icp_score: 0,
      urgency_score: 0,
      intent_score: 0,
      trend_velocity: 0,
      conversion_window_days: 30,
      risk_flag: false,
      recommended_tone: 'professional',
      total_score: 0,
    };
  }
}
