/**
 * AI Content Improvement Suggestions
 * Analyzes a content brief and returns actionable improvement suggestions
 * that can be applied with one click in the Activity Workspace.
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { runCompletionWithOperation } from '../../../backend/services/aiGateway';
import { createHash } from 'crypto';
import { wirePhase2Route } from '../../../backend/services/billing/phase2RouteWiring';
import { PaymentRequiredError } from '../../../backend/services/billing/phase2EnforcementGate';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      companyId,
      topic,
      objective,
      targetAudience,
      contentType,
      platform,
      hook,
      keyPoints,
      cta,
      narrativeStyle,
    } = req.body;

    if (!companyId || !topic) {
      return res.status(400).json({ error: 'companyId and topic are required' });
    }

    const prompt = `You are a content strategist. Analyze this content brief and provide improvement suggestions.

Content Brief:
- Topic: ${topic}
- Content Type: ${contentType || 'post'}
- Platform: ${platform || 'linkedin'}
- Objective: ${objective || 'Not specified'}
- Target Audience: ${targetAudience || 'Not specified'}
- Hook: ${hook || 'Not specified'}
- Key Points: ${Array.isArray(keyPoints) ? keyPoints.join('; ') : keyPoints || 'Not specified'}
- CTA: ${cta || 'Not specified'}
- Narrative Style: ${narrativeStyle || 'Not specified'}

Return a JSON object with exactly this structure:
{
  "suggestions": [
    {
      "id": "unique_id",
      "category": "hook" | "structure" | "engagement" | "seo" | "cta" | "tone",
      "title": "Short improvement title (5-8 words)",
      "description": "Why this improvement helps (1 sentence)",
      "before": "Current state or what's missing",
      "after": "Improved version or what to add",
      "impact": "high" | "medium" | "low",
      "applyField": "hook" | "key_points" | "cta" | "objective" | "narrative_style" | "seo_focus"
    }
  ],
  "overallScore": 1-10,
  "quickWins": ["1-2 word action items that can be applied immediately"]
}

Provide exactly 4-6 suggestions. Focus on practical, immediately applicable improvements.
Prioritize: hook strength, audience relevance, platform optimization, CTA clarity.`;

    const result = await wirePhase2Route({
      surface:        'ai.content-suggestions',
      organizationId: String(companyId),
      action:         'content_suggestions',
      referenceType:  'content_suggestions',
      referenceId:    createHash('sha256')
        .update([String(companyId), String(topic), String(contentType ?? ''), String(platform ?? '')].join('|'))
        .digest('hex').slice(0, 40),
      run: () => runCompletionWithOperation({
      companyId,
      model: 'gpt-4o-mini',
      temperature: 0.6,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'You are a content optimization expert. Return only valid JSON.' },
        { role: 'user', content: prompt },
      ],
      operation: 'contentSuggestions',
      }),
    });

    let parsed: any = {};
    try {
      const raw = typeof result.output === 'string' ? result.output : JSON.stringify(result.output ?? {});
      parsed = JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, ''));
    } catch {
      // Fallback: return deterministic suggestions without AI
      parsed = buildFallbackSuggestions({ topic, contentType, platform, hook, keyPoints, cta, targetAudience });
    }

    return res.status(200).json(parsed);
  } catch (error: any) {
    if (error instanceof PaymentRequiredError) {
      return res.status(402).json({ error: error.message, code: error.code });
    }
    // If AI is blocked (cost guard), return deterministic suggestions
    if (error?.code === 'COST_BLOCKED') {
      const { topic, contentType, platform, hook, keyPoints, cta, targetAudience } = req.body;
      return res.status(200).json(
        buildFallbackSuggestions({ topic, contentType, platform, hook, keyPoints, cta, targetAudience })
      );
    }
    console.error('[content-suggestions] Error:', error);
    return res.status(500).json({ error: 'Failed to generate suggestions' });
  }
}

/** Deterministic fallback when AI is unavailable */
function buildFallbackSuggestions(ctx: {
  topic?: string; contentType?: string; platform?: string;
  hook?: string; keyPoints?: string[]; cta?: string; targetAudience?: string;
}) {
  const suggestions = [];
  const platform = (ctx.platform || 'linkedin').toLowerCase();

  if (!ctx.hook || ctx.hook === 'Not specified') {
    suggestions.push({
      id: 'add-hook',
      category: 'hook',
      title: 'Add a compelling opening hook',
      description: 'Posts with strong hooks get 2-3x more engagement in the first 3 seconds.',
      before: 'No hook defined',
      after: `Start with a question or bold statement about ${ctx.topic || 'your topic'}`,
      impact: 'high',
      applyField: 'hook',
    });
  } else {
    suggestions.push({
      id: 'strengthen-hook',
      category: 'hook',
      title: 'Make your hook more specific',
      description: 'Specific numbers and outcomes outperform generic statements.',
      before: ctx.hook,
      after: ctx.hook.replace(/many|several|some/gi, '73%').replace(/improve|better/gi, 'transform'),
      impact: 'medium',
      applyField: 'hook',
    });
  }

  if (!ctx.cta || ctx.cta === 'Not specified' || ctx.cta === 'Engage') {
    suggestions.push({
      id: 'add-cta',
      category: 'cta',
      title: 'Add a clear call-to-action',
      description: 'Content with a specific CTA drives 3x more conversions.',
      before: ctx.cta || 'No CTA defined',
      after: platform === 'linkedin' ? 'Comment your biggest challenge with this topic 👇' : 'Save this for later and share with your team',
      impact: 'high',
      applyField: 'cta',
    });
  }

  if (platform === 'linkedin') {
    suggestions.push({
      id: 'linkedin-format',
      category: 'structure',
      title: 'Optimize for LinkedIn algorithm',
      description: 'Short paragraphs with line breaks increase dwell time on LinkedIn.',
      before: 'Standard paragraph format',
      after: 'Break into 1-2 sentence paragraphs with blank lines between. Add emoji bullets for key points.',
      impact: 'medium',
      applyField: 'key_points',
    });
  }

  if (!ctx.keyPoints || (Array.isArray(ctx.keyPoints) && ctx.keyPoints.length < 3)) {
    suggestions.push({
      id: 'add-points',
      category: 'structure',
      title: 'Add 3-5 key takeaways',
      description: 'Structured content with clear takeaways gets saved and shared more.',
      before: `${Array.isArray(ctx.keyPoints) ? ctx.keyPoints.length : 0} key points`,
      after: 'Add 3-5 specific, actionable takeaways your audience can apply today',
      impact: 'medium',
      applyField: 'key_points',
    });
  }

  suggestions.push({
    id: 'seo-keywords',
    category: 'seo',
    title: 'Add SEO-friendly keywords',
    description: 'Including relevant keywords improves discoverability.',
    before: 'No explicit SEO focus',
    after: `Focus on: "${ctx.topic || 'topic'}", "${ctx.targetAudience || 'audience'} tips", "how to ${(ctx.topic || '').toLowerCase()}"`,
    impact: 'low',
    applyField: 'seo_focus',
  });

  return {
    suggestions,
    overallScore: Math.min(10, Math.max(3, suggestions.filter(s => s.impact === 'high').length > 1 ? 5 : 7)),
    quickWins: ['Add hook', 'Clarify CTA', 'Add hashtags'],
  };
}
