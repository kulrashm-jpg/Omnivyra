/**
 * POST /api/blogs/[id]/repurpose
 *
 * AI-powered blog repurposing endpoint.
 * Fetches the blog (company or public), extracts context, and generates
 * platform-specific content via the AI gateway.
 *
 * Body params (all optional):
 *   tone?:   'professional' | 'conversational' | 'bold' | 'educational'
 *   source?: 'company' | 'public'  — defaults to 'company'
 *
 * Auth: company members can repurpose their own blogs;
 *       public blogs require no auth (pass source=public).
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../backend/db/supabaseClient';
import { enforceCompanyAccess } from '../../../../backend/services/userContextService';
import { runCompletionWithOperation } from '../../../../backend/services/aiGateway';
import { extractBlogContext } from '../../../../lib/blog/blockExtractor';
import {
  buildRepurposeSystemPrompt,
  buildRepurposeUserPrompt,
  validateRepurposeOutput,
  type BlogRepurposeInput,
  type RepurposeOutput,
} from '../../../../lib/blog/blogRepurposingEngine';

// ---------------------------------------------------------------------------
// Deterministic fallback (no-AI) — simple template-based output
// ---------------------------------------------------------------------------

function buildFallback(input: BlogRepurposeInput): RepurposeOutput {
  const top3 = input.key_insights.slice(0, 3);
  const bullets = input.key_insights.slice(0, 5).map((i) => `• ${i}`);

  return {
    linkedin_posts: [
      {
        variation: 'insight-led',
        label: 'Insight-Led',
        content: `${input.title}\n\n${top3.join('\n\n')}\n\nRead the full article to learn more.`,
      },
      {
        variation: 'story-led',
        label: 'Story-Led',
        content: `Here's what we learned from exploring "${input.title}":\n\n${top3.join('\n\n')}\n\nCheck out the full piece.`,
      },
      {
        variation: 'contrarian',
        label: 'Contrarian',
        content: `Conventional wisdom may not apply here.\n\n"${input.title}" challenges the norm:\n\n${top3.join('\n\n')}\n\nWorth a read.`,
      },
    ],
    twitter_thread: [
      `🧵 ${input.title} — here's what you need to know:`,
      ...input.key_insights.slice(0, 6).map((ins, i) => `${i + 2}/ ${ins}`),
      `9/ Read the full article for the complete picture.`,
    ],
    email: {
      subject: input.title.slice(0, 60),
      preview: input.summary.slice(0, 100) || `Key insights from: ${input.title}`,
      bullet_insights: bullets,
      cta: 'Read the full article →',
    },
    instagram_caption: `${input.title}\n\n${top3[0] ?? ''}\n\n#marketing #content #insights`,
  };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const id = typeof req.query.id === 'string' ? req.query.id : null;
  if (!id) return res.status(400).json({ error: 'id is required' });

  const source = req.body?.source === 'public' ? 'public' : 'company';
  const tone   = ['professional', 'conversational', 'bold', 'educational'].includes(req.body?.tone)
    ? req.body.tone as BlogRepurposeInput['tone']
    : 'professional';

  // ── Auth: company blogs require company membership ────────────────────────
  let companyId: string | null = null;

  if (source === 'company') {
    const companyIdParam =
      typeof req.query.company_id === 'string' ? req.query.company_id :
      typeof req.body?.company_id  === 'string' ? req.body.company_id : null;

    if (!companyIdParam) return res.status(400).json({ error: 'company_id is required for company blogs' });

    const access = await enforceCompanyAccess({ req, res, companyId: companyIdParam });
    if (!access) return;
    companyId = companyIdParam;
  }

  // ── Fetch blog ────────────────────────────────────────────────────────────
  const table = source === 'public' ? 'public_blogs' : 'blogs';

  const query = supabase
    .from(table)
    .select('id, title, tags, content_blocks, excerpt')
    .eq('id', id)
    .eq('status', 'published');

  if (source === 'company' && companyId) {
    query.eq('company_id', companyId);
  }

  const { data: blog, error: blogErr } = await query.maybeSingle();
  if (blogErr || !blog) return res.status(404).json({ error: 'Blog not found or not published' });

  // ── Extract structured context ────────────────────────────────────────────
  const { key_insights, summary, h2_headings } = extractBlogContext(blog.content_blocks);

  const input: BlogRepurposeInput = {
    title:        blog.title ?? '',
    summary:      summary || blog.excerpt || '',
    key_insights: key_insights.length > 0 ? key_insights : [],
    headings:     h2_headings,
    tone,
  };

  // ── AI generation ─────────────────────────────────────────────────────────
  let output: RepurposeOutput | null = null;

  try {
    const result = await runCompletionWithOperation({
      operation:       'blogRepurpose',
      companyId,
      model:           'gpt-4o-mini',
      temperature:     0.5,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: buildRepurposeSystemPrompt() },
        { role: 'user',   content: buildRepurposeUserPrompt(input) },
      ],
    });

    const raw = result.output ? JSON.parse(result.output) : null;
    output = validateRepurposeOutput(raw);
  } catch (_err) {
    // AI failure → deterministic fallback (no hallucination risk)
    output = null;
  }

  // ── Fallback if AI returned invalid/empty output ──────────────────────────
  if (!output) {
    output = buildFallback(input);
  }

  return res.status(200).json({ repurpose: output });
}
