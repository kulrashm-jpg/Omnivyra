import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../../backend/services/userContextService';
import { enforceRole, Role } from '../../../../backend/services/rbacService';
import { getCanonicalProfile as getProfile } from '@/backend/services/context/canonicalProfileAdapter';
import { runCompletionWithOperation } from '../../../../backend/services/aiGateway';
import { buildFormattedStyleInstructions } from '../../../../lib/content/writingStyleEngine';
import { createHash } from 'crypto';
import { wirePhase2Route } from '../../../../backend/services/billing/phase2RouteWiring';
import { PaymentRequiredError } from '../../../../backend/services/billing/phase2EnforcementGate';

type SuggestionResponse = {
  uniqueness_directive_options: string[];
  must_include_points_options: string[];
  campaign_objective_options: string[];
  trend_context_options: string[];
};

const EMPTY: SuggestionResponse = {
  uniqueness_directive_options: [],
  must_include_points_options: [],
  campaign_objective_options: [],
  trend_context_options: [],
};

function toStringArray(input: unknown, maxItems = 4): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((v) => (typeof v === 'string' ? v.trim() : ''))
    .filter(Boolean)
    .slice(0, maxItems);
}

function resolveSuggestionRange(
  rawCount: unknown,
  rawTargetWordCount: unknown,
): { min: number; max: number } {
  if (typeof rawCount === 'number' && rawCount >= 1 && rawCount <= 10) {
    const count = Math.round(rawCount);
    return { min: count, max: count };
  }

  const parsedTarget =
    typeof rawTargetWordCount === 'number'
      ? rawTargetWordCount
      : typeof rawTargetWordCount === 'string'
      ? parseInt(rawTargetWordCount, 10)
      : NaN;

  if (!Number.isFinite(parsedTarget)) return { min: 3, max: 3 };
  if (parsedTarget >= 2000) return { min: 6, max: 8 };
  if (parsedTarget >= 1600) return { min: 5, max: 6 };
  if (parsedTarget >= 1200) return { min: 4, max: 5 };
  return { min: 3, max: 3 };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    company_id,
    topic,
    reason,
    brief,
    currentValues,
    count: rawCount,
  } = req.body ?? {};

  if (!company_id || typeof company_id !== 'string') {
    return res.status(400).json({ error: 'company_id required' });
  }
  if (!topic || typeof topic !== 'string' || !topic.trim()) {
    return res.status(400).json({ error: 'topic required' });
  }

  const access = await enforceCompanyAccess({ req, res, companyId: company_id });
  if (!access) return;

  const roleGate = await enforceRole({
    req,
    res,
    companyId: company_id,
    allowedRoles: [Role.SUPER_ADMIN],
  });
  if (!roleGate) return;

  try {
    const profile = await getProfile(company_id, { autoRefine: false, languageRefine: false });
    const styleInstructions = profile ? buildFormattedStyleInstructions(profile) : '';

    const briefObj = (brief && typeof brief === 'object') ? (brief as Record<string, unknown>) : {};
    const valuesObj = (currentValues && typeof currentValues === 'object') ? (currentValues as Record<string, unknown>) : {};
    const suggestionRange = resolveSuggestionRange(rawCount, valuesObj.target_word_count ?? valuesObj.targetWords);

    const promptContext = [
      `Topic: ${String(topic).trim()}`,
      reason && typeof reason === 'string' ? `Reason/context: ${reason.trim()}` : '',
      briefObj.company_context ? `Company context: ${String(briefObj.company_context)}` : '',
      briefObj.current_content ? `Current content context: ${String(briefObj.current_content)}` : '',
      briefObj.writing_style ? `Writing style hint: ${String(briefObj.writing_style)}` : '',
      styleInstructions ? `Company style engine output:\n${styleInstructions}` : '',
      valuesObj.uniquenessDirective ? `Existing uniqueness directive: ${String(valuesObj.uniquenessDirective)}` : '',
      valuesObj.mustInclude ? `Existing must-include points: ${String(valuesObj.mustInclude)}` : '',
      valuesObj.campaignObjective ? `Existing campaign objective: ${String(valuesObj.campaignObjective)}` : '',
      valuesObj.trendContext ? `Existing trend context: ${String(valuesObj.trendContext)}` : '',
      valuesObj.target_word_count || valuesObj.targetWords ? `Target word count: ${String(valuesObj.target_word_count ?? valuesObj.targetWords)}` : '',
    ].filter(Boolean).join('\n\n');

    const ai = await wirePhase2Route({
      surface:        'admin.blog.brief-suggestions',
      organizationId: company_id,
      action:         'blog_brief_suggestions',
      referenceType:  'blog_brief_suggestions',
      referenceId:    createHash('sha256')
        .update([company_id, String(topic), String(suggestionRange.max)].join('|'))
        .digest('hex').slice(0, 40),
      run: () => runCompletionWithOperation({
      operation: 'blogGeneration',
      companyId: company_id,
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0.6,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'You are a senior content strategist. Generate concise, practical custom suggestions for pre-generation briefing fields. ' +
            'Output valid JSON only. Be specific and non-generic. Keep each option short (8-22 words).',
        },
        {
          role: 'user',
          content:
            `${promptContext}\n\n` +
            `Return JSON with this exact shape (${suggestionRange.min === suggestionRange.max ? `exactly ${suggestionRange.min}` : `between ${suggestionRange.min} and ${suggestionRange.max}`} options per field):\n` +
            '{\n' +
            `  "uniqueness_directive_options": [${Array.from({ length: suggestionRange.max }, () => '"..."').join(', ')}],\n` +
            `  "must_include_points_options": [${Array.from({ length: suggestionRange.max }, () => '"..."').join(', ')}],\n` +
            `  "campaign_objective_options": [${Array.from({ length: suggestionRange.max }, () => '"..."').join(', ')}],\n` +
            `  "trend_context_options": [${Array.from({ length: suggestionRange.max }, () => '"..."').join(', ')}]\n` +
            '}\n\n' +
            'Rules:\n' +
            '- No buzzwords or generic copy\n' +
            '- Keep aligned to company context and topic\n' +
            '- Must-includes should be comma-ready bullet phrases\n' +
            '- Trend context should mention current market/AI/distribution shifts where relevant\n' +
            '- Higher word counts require denser, more specific, more varied suggestions\n' +
            `- For target length tiers, use these counts for each field: 800+ => 3, 1200+ => 4-5, 1600+ => 5-6, 2000+ => 6-8`,
        },
      ],
      }),
    });

    const raw = ai.output ? JSON.parse(ai.output) as Record<string, unknown> : {};

    const out: SuggestionResponse = {
      uniqueness_directive_options: toStringArray(raw.uniqueness_directive_options, suggestionRange.max),
      must_include_points_options: toStringArray(raw.must_include_points_options, suggestionRange.max),
      campaign_objective_options: toStringArray(raw.campaign_objective_options, suggestionRange.max),
      trend_context_options: toStringArray(raw.trend_context_options, suggestionRange.max),
    };

    return res.status(200).json(out);
  } catch (e) {
    if (e instanceof PaymentRequiredError) {
      return res.status(402).json({ error: e.message, code: e.code });
    }
    return res.status(200).json(EMPTY);
  }
}
