/**
 * runBlogGeneration
 *
 * Single source of truth for all blog generation logic.
 * Called by:
 *   - /api/admin/blog/generate  (Super Admin — public_blogs)
 *   - /api/blogs/generate       (Company Admin — blogs)
 *
 * API routes are responsible ONLY for:
 *   1. Auth / role enforcement
 *   2. Company context injection (placeholder per route)
 *   3. Calling runBlogGeneration(input)
 *   4. Returning res.status(200).json(result)
 *
 * No generation logic lives inside any API route file.
 *
 * PURE FUNCTION DESIGN
 * ─────────────────────
 * runBlogGeneration does NOT access req, res, cookies, headers, or session.
 * All external data access is injected via BlogGenerationRequest:
 *   - fetchAngleData   — overrideable for testing / mocking
 *   - fetchSeriesData  — overrideable for testing / mocking
 * Default implementations are module-level functions that use supabase.
 * Injectable overrides let callers eliminate all DB coupling in unit tests.
 */

import { supabase } from '../../backend/db/supabaseClient';
import { runCompletionWithOperation } from '../../backend/services/aiGateway';
import { extractBlogContext } from './blockExtractor';
import { htmlToBlocks } from './htmlToBlocks';
import {
  generateClarificationQuestions,
  type ThemeInput,
  type ClarificationQuestion,
} from './blogClarificationEngine';
import {
  buildAnglesSystemPrompt,
  buildAnglesUserPrompt,
  validateAnglesOutput,
  buildFallbackAngles,
  buildGenerationSystemPrompt,
  buildGenerationUserPrompt,
  validateGenerationOutput,
  buildGenerationFallback,
  type BlogAngle,
  type AngleType,
  type BlogGenerationInput,
  type BlogGenerationOutput,
  type SeriesSummary,
} from './blogGenerationEngine';
import {
  checkHookStrength,
  extractFirstParagraph,
  type HookAssessment,
} from './hookAssessment';

// ── Injectable data-access signatures ────────────────────────────────────────

/**
 * Returns the most-used angle type for a company/table, or null if insufficient data.
 * Used as a frequency proxy for recommended_angle in mode='angles'.
 */
export type FetchAngleDataFn = (
  companyId: string,
  blogTable: 'blogs' | 'public_blogs',
) => Promise<AngleType | null>;

/**
 * Fetches series blog summaries by ID for mode='full' series continuation.
 * company_id is provided so the default implementation can scope the query.
 */
export type FetchSeriesDataFn = (
  ids:       string[],
  companyId: string,
  blogTable: 'blogs' | 'public_blogs',
) => Promise<SeriesSummary[]>;

// ── Default supabase implementations ─────────────────────────────────────────

/**
 * Default implementation — uses supabase directly.
 * Replace with an injectable in tests or edge cases.
 */
async function defaultFetchAngleData(
  companyId: string,
  blogTable:  'blogs' | 'public_blogs',
): Promise<AngleType | null> {
  const query = supabase
    .from(blogTable)
    .select('angle_type')
    .eq('status', 'published')
    .not('angle_type', 'is', null);

  if (blogTable === 'blogs') {
    query.eq('company_id', companyId);
  }

  const { data } = await query;
  if (!data || data.length === 0) return null;

  const counts: Record<string, number> = {};
  for (const b of data as Array<{ angle_type: string }>) {
    if (b.angle_type) counts[b.angle_type] = (counts[b.angle_type] ?? 0) + 1;
  }
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const top    = sorted[0]?.[0];
  return (top && ['analytical', 'contrarian', 'strategic'].includes(top))
    ? (top as AngleType)
    : null;
}

/**
 * Default implementation — uses supabase directly.
 * Replace with an injectable in tests or edge cases.
 */
async function defaultFetchSeriesData(
  ids:       string[],
  companyId: string,
  blogTable: 'blogs' | 'public_blogs',
): Promise<SeriesSummary[]> {
  const query = supabase
    .from(blogTable)
    .select('title, content, content_blocks')
    .in('id', ids);

  // Company blogs: scope to company to prevent cross-company data access
  if (blogTable === 'blogs') {
    query.eq('company_id', companyId);
  }

  const { data } = await query;
  if (!data || data.length === 0) return [];

  return (data as Array<{ title: string; content: string; content_blocks: unknown }>).map(b => {
    const extracted = extractBlogContext(b.content_blocks);
    return {
      title:      b.title,
      headings:   extracted.h2_headings,
      key_points: extracted.key_insights,
      summary:    extracted.summary,
    };
  });
}

// ── Input ─────────────────────────────────────────────────────────────────────

/**
 * Company context forwarded from the API route after profile fetch.
 * Used by generation prompts to tailor tone, audience, and brand voice.
 * All fields optional — partial context is better than none.
 */
export interface CompanyContext {
  brand_voice?: string;
  audience?:    string;
  industry?:    string;
  /**
   * Pre-formatted writing style instructions block from WritingStyleEngine.
   * When present, this is injected as a WRITING STYLE GUIDE section in the
   * generation user prompt. Build with:
   *   buildFormattedStyleInstructions(profile) from lib/content/writingStyleEngine
   */
  writingStyleInstructions?: string;
}

export interface BlogGenerationRequest {
  company_id:       string;
  mode?:            'angles' | 'full';
  topic:            string;
  cluster?:         string;
  intent?:          string;
  related_blogs?:   string[];
  series_blog_ids?: string[];
  series_context?:  string;
  answers?:         Record<string, string>;
  selected_angle?:  BlogAngle;
  tone?:            string;
  goal_type?:       string;
  /**
   * Which table to look up series_blog_ids from.
   * - 'blogs'        → Company Admin (scoped by company_id)
   * - 'public_blogs' → Super Admin   (no company scope)
   */
  blogTable?: 'blogs' | 'public_blogs';
  /**
   * Company profile context injected by the API route.
   * Fetched by the route before calling runBlogGeneration.
   * Used to personalise generation prompts for brand voice, audience, industry.
   */
  companyContext?: CompanyContext;
  /**
   * Injectable data-access override for angle frequency lookup.
   * Defaults to defaultFetchAngleData (supabase).
   * Override in unit tests to eliminate DB coupling.
   */
  fetchAngleData?: FetchAngleDataFn;
  /**
   * Injectable data-access override for series blog summary fetch.
   * Defaults to defaultFetchSeriesData (supabase).
   * Override in unit tests to eliminate DB coupling.
   */
  fetchSeriesData?: FetchSeriesDataFn;
}

// ── Output discriminated union ────────────────────────────────────────────────

export type BlogGenerationResult =
  | {
      needs_clarification: true;
      questions:           ClarificationQuestion[];
    }
  | {
      needs_clarification: false;
      mode:                'angles';
      angles:              BlogAngle[];
      recommended_angle:   AngleType | null;
    }
  | {
      needs_clarification: false;
      mode:                'full';
      confidence:          'high' | 'medium';
      result:              BlogGenerationOutput & { content_blocks: unknown[] };
      hook_assessment:     HookAssessment;
    };

// ── Main function ─────────────────────────────────────────────────────────────

export async function runBlogGeneration(
  req: BlogGenerationRequest,
): Promise<BlogGenerationResult> {
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
    blogTable       = 'blogs',
    fetchAngleData  = defaultFetchAngleData,
    fetchSeriesData = defaultFetchSeriesData,
    companyContext,
  } = req;

  const themeInput: ThemeInput = {
    topic:          topic.trim(),
    cluster:        typeof cluster        === 'string' ? cluster.trim()        : undefined,
    intent:         typeof intent         === 'string' ? intent.trim()         : undefined,
    related_blogs:  Array.isArray(related_blogs)
      ? related_blogs.filter((b: unknown) => typeof b === 'string')
      : undefined,
    series_context: typeof series_context === 'string' ? series_context.trim() : undefined,
  };

  const hasAnswers = (
    answers !== null &&
    answers !== undefined &&
    typeof answers === 'object' &&
    Object.keys(answers).length > 0
  );

  // ── Clarification check ─────────────────────────────────────────────────────
  if (!hasAnswers && !selected_angle) {
    const questions = generateClarificationQuestions(themeInput);
    if (questions.length > 0) {
      return { needs_clarification: true, questions };
    }
  }

  const confidence: 'high' | 'medium' = hasAnswers ? 'medium' : 'high';

  const contextualAnswers: Record<string, string> = {
    ...(hasAnswers ? (answers as Record<string, string>) : {}),
  };
  if (companyContext?.audience && !contextualAnswers.audience) {
    contextualAnswers.audience = companyContext.audience;
  }
  if (companyContext?.industry && !contextualAnswers.industry) {
    contextualAnswers.industry = companyContext.industry;
  }
  if (companyContext?.brand_voice && !contextualAnswers.tone) {
    contextualAnswers.tone = companyContext.brand_voice;
  }
  const hasContextualAnswers = Object.keys(contextualAnswers).length > 0;

  const baseInput: BlogGenerationInput = {
    ...themeInput,
    answers:        hasContextualAnswers ? contextualAnswers : undefined,
    selected_angle: selected_angle as BlogAngle | undefined,
    tone:           typeof tone      === 'string' ? tone.trim()      : undefined,
    goal_type:      typeof goal_type === 'string' ? goal_type.trim() : undefined,
    writingStyleInstructions: companyContext?.writingStyleInstructions,
  };

  // ── Mode: angles ────────────────────────────────────────────────────────────
  if (mode === 'angles') {
    const [anglesResult, perfData] = await Promise.allSettled([

      // AI angle generation
      (async (): Promise<ReturnType<typeof validateAnglesOutput>> => {
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

      // Angle frequency proxy — injectable for test isolation
      fetchAngleData(company_id, blogTable),
    ]);

    const angles = (anglesResult.status === 'fulfilled' && anglesResult.value)
      ? anglesResult.value
      : buildFallbackAngles(topic.trim());

    const recommended_angle: AngleType | null =
      (perfData.status === 'fulfilled' && perfData.value) ? perfData.value : null;

    return {
      needs_clarification: false,
      mode:                'angles',
      angles,
      recommended_angle,
    };
  }

  // ── Mode: full ──────────────────────────────────────────────────────────────

  // Series continuation: fetch prior blog summaries via injectable
  let series_summaries: SeriesSummary[] | undefined;

  if (Array.isArray(series_blog_ids) && series_blog_ids.length > 0) {
    const validIds = series_blog_ids.filter((id: unknown) => typeof id === 'string');

    if (validIds.length > 0) {
      const fetched = await fetchSeriesData(validIds, company_id, blogTable);
      if (fetched.length > 0) series_summaries = fetched;
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

    const content_blocks = htmlToBlocks(generated.content_html);

    const result: BlogGenerationOutput & { content_blocks: unknown[] } = {
      ...generated,
      content_blocks,
    };

    // Hook strength check — non-blocking, failure returns moderate default
    let hook_assessment: HookAssessment = { strength: 'moderate', note: '' };
    try {
      const firstPara = extractFirstParagraph(generated.content_html);
      hook_assessment = await checkHookStrength(firstPara, company_id);
    } catch { /* keep default */ }

    return {
      needs_clarification: false,
      mode:                'full',
      confidence,
      result,
      hook_assessment,
    };

  } catch {
    const fallback       = buildGenerationFallback(generationInput);
    const content_blocks = htmlToBlocks(fallback.content_html);

    return {
      needs_clarification: false,
      mode:                'full',
      confidence:          'medium',
      result:              { ...fallback, content_blocks },
      hook_assessment:     { strength: 'moderate', note: 'Review before publishing.' },
    };
  }
}
