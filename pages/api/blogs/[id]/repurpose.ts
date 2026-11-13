import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';

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
import { enforceCompanyAccess, resolveUserContext } from '../../../../backend/services/userContextService';
import { runCompletionWithOperation } from '../../../../backend/services/aiGateway';
import { resolveCompanyGroundingGuard } from '../../../../backend/services/context/canonicalContentContextResolver';
import { createHash } from 'crypto';
import { wirePhase2Route } from '../../../../backend/services/billing/phase2RouteWiring';
import { PaymentRequiredError } from '../../../../backend/services/billing/phase2EnforcementGate';
import { checkRateLimit, type RateLimitConfig } from '../../../../lib/auth/rateLimit';
import { authRequestIpOrNull } from '../../../../backend/auth/requestClientIp';

/**
 * BLOCKING (money), 2026-11-13. source=public WAS an anonymous, unbilled model call (the gateway's AI guard saw no
 * user and no IP for it, so only platform-wide fail-open caps applied). OWNER RULING (via e9): repurpose REQUIRES
 * LOGIN and is CHARGED to the caller's company, like every AI feature - no anonymous free AI. A public blog is now
 * just a SOURCE; the company billed is the CALLER's (explicit company_id, else their first ACTIVE membership; never
 * the blog's, never the users.active_company_id pointer). Defence in depth: public-source requests are still
 * limited per trusted client IP and globally, FAIL-CLOSED, before the blog read and the model call.
 */
export const PUBLIC_REPURPOSE_IP_LIMIT: RateLimitConfig = {
  keyPrefix: 'rl:public:blog-repurpose:ip', limit: 10, windowSecs: 3600, onRedisFailure: 'closed',
};
export const PUBLIC_REPURPOSE_GLOBAL_LIMIT: RateLimitConfig = {
  keyPrefix: 'rl:public:blog-repurpose:global', limit: 300, windowSecs: 3600, onRedisFailure: 'closed',
};
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

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const id = typeof req.query.id === 'string' ? req.query.id : null;
  if (!id) return res.status(400).json({ error: 'id is required' });

  const source = req.body?.source === 'public' ? 'public' : 'company';
  const tone   = ['professional', 'conversational', 'bold', 'educational'].includes(req.body?.tone)
    ? req.body.tone as BlogRepurposeInput['tone']
    : 'professional';

  // ── Auth: EVERY repurpose is a signed-in, billed action for the caller's company ──
  const companyIdParam =
    typeof req.query.company_id === 'string' && req.query.company_id.trim() ? req.query.company_id.trim() :
    typeof req.body?.company_id  === 'string' && req.body.company_id.trim()  ? req.body.company_id.trim()  : null;

  let companyId: string;
  if (source === 'company') {
    if (!companyIdParam) return res.status(400).json({ error: 'company_id is required for company blogs' });
    const access = await enforceCompanyAccess({ req, res, companyId: companyIdParam });
    if (!access) return;
    companyId = companyIdParam;
  } else {
    const user = await resolveUserContext(req);
    if (!user?.userId) return res.status(401).json({ error: 'Sign in to repurpose a blog.', code: 'AUTH_REQUIRED' });
    // The caller's company: the one they name, else their first ACTIVE membership (resolveUserContext never yields
    // the raw pointer). Membership is enforced either way.
    // DETERMINISTIC (e1): a multi-company caller must NAME the company to charge - never whichever membership row
    // comes back first (two identical clicks could otherwise bill different companies under different keys).
    if (!companyIdParam && (user.companyIds?.length ?? 0) > 1) {
      return res.status(400).json({ error: 'company_id is required: you belong to more than one company.', code: 'COMPANY_REQUIRED' });
    }
    const callerCompanyId = companyIdParam ?? (user.defaultCompanyId || null);
    if (!callerCompanyId) return res.status(403).json({ error: 'An active company membership is required.', code: 'NO_ACTIVE_COMPANY' });
    const access = await enforceCompanyAccess({ req, res, companyId: callerCompanyId });
    if (!access) return;
    companyId = callerCompanyId;
  }

  // ── Public source: per-IP and global limits, fail-closed (defence in depth) ───
  if (source === 'public') {
    const ip = authRequestIpOrNull(req);
    if (!ip) {
      return res.status(429).json({ error: 'Too many requests. Try again later.', code: 'RATE_LIMITED' });
    }
    const perIp = await checkRateLimit(ip, PUBLIC_REPURPOSE_IP_LIMIT);
    if (!perIp.allowed) {
      return res.status(429).json({ error: 'Too many requests. Try again later.', code: 'RATE_LIMITED' });
    }
    const global = await checkRateLimit('all', PUBLIC_REPURPOSE_GLOBAL_LIMIT);
    if (!global.allowed) {
      return res.status(429).json({ error: 'Too many requests. Try again later.', code: 'RATE_LIMITED' });
    }
  }

  // ── Fetch blog ────────────────────────────────────────────────────────────
  const table = source === 'public' ? 'public_blogs' : 'blogs';

  const query = supabase
    .from(table)
    .select('id, title, tags, content_blocks, excerpt')
    .eq('id', id)
    .eq('status', 'published');

  if (source === 'company') {
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

  // Deterministic company grounding: repurposed posts speak for the active
  // company only (public blogs → no company; the directive still forbids
  // naming any company not present in the blog content).
  const grounding = await resolveCompanyGroundingGuard(companyId);

  const runAi = () => runCompletionWithOperation({
    operation:       'blogRepurpose',
    companyId,
    referenceType:   'blog_repurpose',
    referenceId:     String(id),
    model:           'gpt-4o-mini',
    temperature:     0.5,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: buildRepurposeSystemPrompt(grounding.directive) },
      { role: 'user',   content: buildRepurposeUserPrompt(input) },
    ],
  });

  try {
    // ONE billed path for both sources (owner ruling): the caller's company is charged through the same
    // wirePhase2Route call as the authenticated company path. The source is part of the reference so a public and a
    // company blog with the same id are distinct charges.
    const result = await wirePhase2Route({
      surface:        'blogs.repurpose',
      organizationId: companyId,
      action:         'content_repurpose',
      referenceType:  'content_repurpose',
      referenceId:    createHash('sha256')
        .update([companyId, source, String(id), String(tone)].join('|'))
        .digest('hex').slice(0, 40),
      run: runAi,
    });

    const raw = result.output ? JSON.parse(result.output) : null;
    output = validateRepurposeOutput(raw);
  } catch (_err) {
    if (_err instanceof PaymentRequiredError) {
      return res.status(402).json({ error: _err.message, code: _err.code });
    }
    // AI failure → deterministic fallback (no hallucination risk)
    output = null;
  }

  // ── Fallback if AI returned invalid/empty output ──────────────────────────
  if (!output) {
    output = buildFallback(input);
  }

  return res.status(200).json({ repurpose: output });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/blogs/:id/repurpose' });
