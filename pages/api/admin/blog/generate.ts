/**
 * POST /api/admin/blog/generate
 *
 * AI-powered blog generation from a strategic theme.
 *
 * Two modes:
 *   mode=angles  — returns 3 editorial angle options + recommended angle based on historical performance
 *   mode=full    — generates complete blog post + hook strength assessment + content_blocks
 *
 * Full flow:
 *   1. Signal strength check → clarification questions if weak (and no answers yet)
 *   2. mode=angles → 3 angles + recommended_angle (from angle-performance data)
 *   3. mode=full   → full blog (HTML + content_blocks) + hook_assessment
 *                    + series continuation if series_blog_ids provided
 *
 * Body:
 * {
 *   company_id:       string,
 *   mode?:            'angles' | 'full',
 *   topic:            string,
 *   cluster?:         string,
 *   intent?:          string,
 *   related_blogs?:   string[],
 *   series_blog_ids?: string[],
 *   series_context?:  string,
 *   answers?:         Record<string, string>,
 *   selected_angle?:  BlogAngle,
 *   tone?:            string,
 *   goal_type?:       string,
 * }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../../backend/services/userContextService';
import { enforceRole, Role } from '../../../../backend/services/rbacService';
import { runCompletionWithOperation } from '../../../../backend/services/aiGateway';
import { supabase } from '../../../../backend/db/supabaseClient';
import { extractBlogContext } from '../../../../lib/blog/blockExtractor';
import { htmlToBlocks } from '../../../../lib/blog/htmlToBlocks';
import {
  generateClarificationQuestions,
  type ThemeInput,
} from '../../../../lib/blog/blogClarificationEngine';
import {
  buildAnglesSystemPrompt,
  buildAnglesUserPrompt,
  validateAnglesOutput,
  buildGenerationSystemPrompt,
  buildGenerationUserPrompt,
  validateGenerationOutput,
  buildGenerationFallback,
  type BlogAngle,
  type AngleType,
  type BlogGenerationInput,
  type BlogGenerationOutput,
  type SeriesSummary,
} from '../../../../lib/blog/blogGenerationEngine';

// ── Hook strength check ───────────────────────────────────────────────────────

export interface HookAssessment {
  strength: 'strong' | 'moderate' | 'weak';
  note:     string;
}

function extractFirstParagraph(html: string): string {
  const m = html.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
  if (!m) return '';
  return m[1].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, 400);
}

async function checkHookStrength(
  paragraph: string,
  companyId: string,
): Promise<HookAssessment> {
  if (!paragraph) return { strength: 'moderate', note: 'No opening paragraph found.' };

  try {
    const result = await runCompletionWithOperation({
      operation:       'blogGeneration',
      companyId,
      model:           'gpt-4o-mini',
      temperature:     0.2,
      response_format: { type: 'json_object' },
      messages: [
        {
          role:    'system',
          content: `Evaluate the hook strength of this blog post opening paragraph.

STRONG: Opens with a specific claim, counterintuitive insight, concrete problem, or surprising data point. Creates immediate tension or curiosity. Reader MUST continue.
MODERATE: Readable and relevant, but doesn't create urgency. Could be stronger.
WEAK: Generic, vague, sounds like AI-written padding, or could apply to any topic.

Return ONLY valid JSON:
{ "strength": "strong" | "moderate" | "weak", "note": "one specific sentence of feedback" }`,
        },
        { role: 'user', content: `Opening paragraph:\n"${paragraph}"` },
      ],
    });

    const raw = result.output ? JSON.parse(result.output) : null;
    if (raw && typeof raw.strength === 'string' && typeof raw.note === 'string') {
      return {
        strength: ['strong', 'moderate', 'weak'].includes(raw.strength) ? raw.strength : 'moderate',
        note:     raw.note,
      };
    }
  } catch { /* fall through to default */ }

  return { strength: 'moderate', note: 'Review the opening paragraph before publishing.' };
}

// ── Fallback angles ───────────────────────────────────────────────────────────

function buildFallbackAngles(topic: string): BlogAngle[] {
  const short = topic.length > 50 ? topic.slice(0, 50) + '…' : topic;
  return [
    {
      type:          'analytical',
      label:         'Analytical',
      title:         `The Data Behind ${short}`,
      angle_summary: 'Examines the evidence, patterns, and causal relationships that explain why this matters.',
      hook:          'The numbers tell a story most practitioners are too busy to read.',
    },
    {
      type:          'contrarian',
      label:         'Contrarian',
      title:         `Why Everything You Know About ${short} Is Wrong`,
      angle_summary: 'Challenges the dominant narrative and exposes the assumptions that lead teams astray.',
      hook:          'The prevailing advice on this topic has a quiet but expensive flaw.',
    },
    {
      type:          'strategic',
      label:         'Strategic',
      title:         `How to Turn ${short} Into a Competitive Advantage`,
      angle_summary: 'Connects the topic directly to business outcomes and shows leaders how to act on it.',
      hook:          'Most companies treat this as a tactic. The ones winning treat it as infrastructure.',
    },
  ];
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    company_id,
    mode = 'full',
    topic,
    cluster,
    intent,
    related_blogs,
    series_blog_ids,
    series_context,
    answers,
    selected_angle,
    tone,
    goal_type,
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
    req, res, companyId: company_id,
    allowedRoles: [Role.COMPANY_ADMIN, Role.SUPER_ADMIN],
  });
  if (!roleGate) return;

  const themeInput: ThemeInput = {
    topic:          topic.trim(),
    cluster:        typeof cluster        === 'string' ? cluster.trim()        : undefined,
    intent:         typeof intent         === 'string' ? intent.trim()         : undefined,
    related_blogs:  Array.isArray(related_blogs) ? related_blogs.filter((b: unknown) => typeof b === 'string') : undefined,
    series_context: typeof series_context === 'string' ? series_context.trim() : undefined,
  };

  const hasAnswers = answers && typeof answers === 'object' && Object.keys(answers).length > 0;

  // ── Clarification check ───────────────────────────────────────────────────
  if (!hasAnswers && !selected_angle) {
    const questions = generateClarificationQuestions(themeInput);
    if (questions.length > 0) {
      return res.status(200).json({ needs_clarification: true, questions });
    }
  }

  const confidence: 'high' | 'medium' = hasAnswers ? 'medium' : 'high';

  const baseInput: BlogGenerationInput = {
    ...themeInput,
    answers:        hasAnswers ? (answers as Record<string, string>) : undefined,
    selected_angle: selected_angle as BlogAngle | undefined,
    tone:           typeof tone      === 'string' ? tone.trim()      : undefined,
    goal_type:      typeof goal_type === 'string' ? goal_type.trim() : undefined,
  };

  // ── Mode: angles ──────────────────────────────────────────────────────────
  if (mode === 'angles') {
    // Fetch angle performance in parallel with AI angle generation
    const [anglesResult, perfData] = await Promise.allSettled([
      (async () => {
        const aiResult = await runCompletionWithOperation({
          operation:       'blogGeneration',
          companyId:       company_id,
          model:           'gpt-4o-mini',
          temperature:     0.7,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: buildAnglesSystemPrompt() },
            { role: 'user',   content: buildAnglesUserPrompt(baseInput) },
          ],
        });
        const raw = aiResult.output ? JSON.parse(aiResult.output) : null;
        return raw ? validateAnglesOutput(raw) : null;
      })(),
      (async () => {
        const { data } = await supabase
          .from('blogs')
          .select('angle_type')
          .eq('company_id', company_id)
          .eq('status', 'published')
          .not('angle_type', 'is', null);
        if (!data || data.length === 0) return null;
        // Count occurrences
        const counts: Record<string, number> = {};
        for (const b of data as Array<{ angle_type: string }>) {
          if (b.angle_type) counts[b.angle_type] = (counts[b.angle_type] ?? 0) + 1;
        }
        // For now, use frequency as a proxy — real performance data comes from /api/track/angle-performance
        // Return the most used angle so far, or null
        const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
        return sorted[0]?.[0] as AngleType | null;
      })(),
    ]);

    const angles = anglesResult.status === 'fulfilled' && anglesResult.value
      ? anglesResult.value
      : buildFallbackAngles(topic.trim());

    // Fetch real performance data for recommendation
    let recommended_angle: AngleType | null = null;
    try {
      const { data: perfBlogs } = await supabase
        .from('blogs')
        .select('slug, angle_type')
        .eq('company_id', company_id)
        .eq('status', 'published')
        .not('angle_type', 'is', null);

      if (perfBlogs && perfBlogs.length >= 2) {
        // Use the angle with most posts as a simple signal
        const counts: Record<string, number> = {};
        for (const b of perfBlogs as Array<{ slug: string; angle_type: string }>) {
          if (b.angle_type) counts[b.angle_type] = (counts[b.angle_type] ?? 0) + 1;
        }
        const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
        const top = sorted[0]?.[0];
        if (top && ['analytical', 'contrarian', 'strategic'].includes(top)) {
          recommended_angle = top as AngleType;
        }
      }
    } catch { /* ignore */ }

    // Prefer perfData result if available
    if (perfData.status === 'fulfilled' && perfData.value) {
      recommended_angle = perfData.value;
    }

    return res.status(200).json({
      needs_clarification: false,
      mode: 'angles',
      angles,
      recommended_angle,
    });
  }

  // ── Mode: full ────────────────────────────────────────────────────────────

  // Continuation mode: fetch prior blog summaries from DB
  let series_summaries: SeriesSummary[] | undefined;
  if (Array.isArray(series_blog_ids) && series_blog_ids.length > 0) {
    const validIds = series_blog_ids.filter((id: unknown) => typeof id === 'string');
    if (validIds.length > 0) {
      const { data: seriesBlogs } = await supabase
        .from('blogs')
        .select('title, content, content_blocks')
        .eq('company_id', company_id)
        .in('id', validIds);

      if (seriesBlogs && seriesBlogs.length > 0) {
        series_summaries = (seriesBlogs as Array<{ title: string; content: string; content_blocks: unknown }>)
          .map(b => {
            const extracted = extractBlogContext(b.content_blocks);
            return {
              title:      b.title,
              headings:   extracted.h2_headings,
              key_points: extracted.key_insights,
              summary:    extracted.summary,
            };
          });
      }
    }
  }

  const generationInput: BlogGenerationInput = { ...baseInput, series_summaries };

  try {
    const aiResult = await runCompletionWithOperation({
      operation:       'blogGeneration',
      companyId:       company_id,
      model:           'gpt-4o',
      temperature:     0.5,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: buildGenerationSystemPrompt() },
        { role: 'user',   content: buildGenerationUserPrompt(generationInput) },
      ],
    });

    const raw       = aiResult.output ? JSON.parse(aiResult.output) : null;
    const generated = validateGenerationOutput(raw) ?? buildGenerationFallback(generationInput);

    // Convert HTML → content_blocks
    const content_blocks = htmlToBlocks(generated.content_html);

    const result: BlogGenerationOutput & { content_blocks: unknown[] } = {
      ...generated,
      content_blocks,
    };

    // Hook strength check in parallel (non-blocking failure)
    let hook_assessment: HookAssessment = { strength: 'moderate', note: '' };
    try {
      const firstPara = extractFirstParagraph(generated.content_html);
      hook_assessment = await checkHookStrength(firstPara, company_id);
    } catch { /* keep default */ }

    return res.status(200).json({
      needs_clarification: false,
      mode:                'full',
      confidence,
      result,
      hook_assessment,
    });
  } catch {
    const fallback          = buildGenerationFallback(generationInput);
    const content_blocks    = htmlToBlocks(fallback.content_html);
    return res.status(200).json({
      needs_clarification: false,
      mode:                'full',
      confidence:          'medium',
      result:              { ...fallback, content_blocks },
      hook_assessment:     { strength: 'moderate', note: 'Review before publishing.' } as HookAssessment,
    });
  }
}
