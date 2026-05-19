import type { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseUserFromRequest } from '@/backend/services/supabaseAuthService';
import { processContent, PLATFORM_CHAR_LIMITS } from '@/backend/services/unifiedContentProcessor';
import { optimizeDiscoverabilityForPlatform } from '@/backend/services/contentGeneration/discoverabilityHelpers';
import { runCompletionWithOperation } from '@/backend/services/aiGateway';
import { createHash } from 'crypto';
import { wirePhase2Route } from '@/backend/services/billing/phase2RouteWiring';
import { PaymentRequiredError } from '@/backend/services/billing/phase2EnforcementGate';
import { getProfile } from '@/backend/services/companyProfileService';
import type { CompanyProfile } from '@/backend/services/companyProfile/types';

type CompanyContext = {
  block: string;
  /** Brand / product / service names the model is allowed to use verbatim. */
  allowedNames: string[];
};

function buildCompanyContextBlock(profile: CompanyProfile | null): CompanyContext | null {
  if (!profile) return null;
  const fields: Array<[string, string | null | undefined]> = [
    ['Company', profile.name],
    ['Industry', profile.industry],
    ['Website', profile.website_url],
    ['Products / services', profile.products_services],
    ['Target audience', profile.target_audience],
    ['Geography', profile.geography],
    ['Brand voice', profile.brand_voice],
    ['Unique value', profile.unique_value],
    ['Brand positioning', profile.brand_positioning],
    ['Key messages', profile.key_messages],
  ];
  const rendered = fields
    .map(([label, value]) => {
      if (!value || typeof value !== 'string') return null;
      const trimmed = value.trim();
      if (!trimmed) return null;
      const compact = trimmed.length > 280 ? `${trimmed.slice(0, 277).trimEnd()}…` : trimmed;
      return `- ${label}: ${compact}`;
    })
    .filter((line): line is string => line !== null);

  // Build the allow-list of brand/product/service names the model may use.
  // Source of truth: the company name plus every entry in products_services_list
  // (the structured list set during onboarding/profile refinement). The freeform
  // products_services string is left out of the allow-list because it is prose
  // and might contain capability descriptions, not just names.
  const seen = new Set<string>();
  const allowedNames: string[] = [];
  const pushName = (raw: string | null | undefined) => {
    if (!raw || typeof raw !== 'string') return;
    const cleaned = raw.trim();
    if (!cleaned) return;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    allowedNames.push(cleaned);
  };
  pushName(profile.name);
  if (Array.isArray(profile.products_services_list)) {
    for (const entry of profile.products_services_list) pushName(entry);
  }

  if (rendered.length === 0 && allowedNames.length === 0) return null;

  if (allowedNames.length > 0) {
    rendered.push(`- Allowed product / brand names (use ONLY these, copy verbatim): ${allowedNames.map((n) => `"${n}"`).join(', ')}`);
  }

  return { block: rendered.join('\n'), allowedNames };
}

type PlatformSpec = {
  rules: string[];
  /** Native word-count range that reads well on this surface. */
  wordRange: [number, number];
  /** Emoji guidance — count + role. Empty string disables emoji use. */
  emoji: string;
  /** Hard platform conventions the model must respect. */
  conventions: string[];
  /** Native CTA style for this platform — what the close should look like. */
  cta: string;
};

const PLATFORM_SPECS: Record<string, PlatformSpec> = {
  x: {
    rules: [
      'Lead with one sharp point or contrarian insight.',
      'Use short punchy lines, not paragraphs.',
      'Make it feel native to fast-moving social conversation.',
      'End cleanly with a complete sentence — never trailing filler or ellipses.',
    ],
    wordRange: [25, 45],
    emoji: 'Use 1-2 emojis, placed where they punctuate a beat (not decorating every line).',
    conventions: [
      '280-character hard limit including spaces, emojis, and any inline link.',
      'No more than 2 hashtags; place them at the very end on their own line.',
      'Do not @-mention people unless the source explicitly references them.',
    ],
    cta: 'End with a single low-friction CTA that fits inside the 280-char budget — examples: "Learn more →", "Try it free", "DM us", "Reply with X", or a one-line question that invites a quote-tweet. If a website is supplied in the company context, you may close with a short "Learn more: <url>" instead.',
  },
  twitter: {
    rules: [
      'Lead with one sharp point or contrarian insight.',
      'Use short punchy lines, not paragraphs.',
      'Make it feel native to fast-moving social conversation.',
      'End cleanly with a complete sentence — never trailing filler or ellipses.',
    ],
    wordRange: [25, 45],
    emoji: 'Use 1-2 emojis, placed where they punctuate a beat (not decorating every line).',
    conventions: [
      '280-character hard limit including spaces, emojis, and any inline link.',
      'No more than 2 hashtags; place them at the very end on their own line.',
      'Do not @-mention people unless the source explicitly references them.',
    ],
    cta: 'End with a single low-friction CTA that fits inside the 280-char budget — examples: "Learn more →", "Try it free", "DM us", "Reply with X", or a one-line question that invites a quote-tweet. If a website is supplied in the company context, you may close with a short "Learn more: <url>" instead.',
  },
  instagram: {
    rules: [
      'Open with a strong scroll-stopping hook in the first line.',
      'Use short emotional or story-driven blocks separated by line breaks.',
      'Write like a caption, not a LinkedIn post.',
      'Keep the close action-oriented and audience-friendly.',
    ],
    wordRange: [80, 150],
    emoji: 'Use 3-6 emojis distributed naturally to add rhythm and warmth.',
    conventions: [
      '2,200-character cap; the first 125 characters must work as a standalone preview.',
      '5-10 hashtags, grouped together at the end of the caption.',
      'Avoid clickable links inline (Instagram does not hyperlink them) — point to bio or stickers instead.',
    ],
    cta: 'End with an action prompt that respects Instagram\'s no-clickable-link reality — e.g. "Link in bio 👆", "Save this for later", "Tag a friend who needs this", "Tap the sticker", or a comment-prompt question. Place it on its own line just before the hashtag block.',
  },
  facebook: {
    rules: [
      'Use a warm, conversational tone.',
      'Make the post easy to skim for a broad audience.',
      'Favor clarity and relatability over thought-leadership jargon.',
      'Close with a natural engagement prompt or next step.',
    ],
    wordRange: [60, 110],
    emoji: 'Use 2-4 emojis to add warmth — never more than one per line.',
    conventions: [
      'Keep paragraphs to 1-2 sentences; long blocks get truncated by the "See more" fold.',
      '0-3 hashtags; Facebook hashtag culture is light.',
      'Inline links work; place the link at the end so the hook reads first.',
    ],
    cta: 'End with a warm next-step CTA — e.g. "See how it works →", "Comment below if this resonates", "Send us a message", or, when the company context supplies a website, a "Read more: <url>" line at the very end.',
  },
  tiktok: {
    rules: [
      'Open with curiosity immediately.',
      'Use rapid, compact phrasing built for short attention spans.',
      'Make it sound like creator-native social copy.',
      'End with a low-friction CTA.',
    ],
    wordRange: [15, 35],
    emoji: 'Use 2-3 emojis — one on the hook line, the rest sparingly.',
    conventions: [
      '2,200-character cap, but the strongest TikTok captions stay under 150.',
      '3-5 hashtags including 1-2 broad trend tags and 1-2 niche tags.',
      'No inline URLs — TikTok strips most link preview behavior.',
    ],
    cta: 'End with a creator-native action prompt — e.g. "Follow for part 2", "Save this", "Try it and duet me", "Comment YES if you want the breakdown". Do not use formal "Learn more" corporate phrasing here. No links.',
  },
  pinterest: {
    rules: [
      'Lead with the searchable topic or outcome.',
      'Focus on utility, inspiration, and the specific benefit.',
      'Make it feel like pin copy, not a post caption.',
      'Keep it concise and keyword-friendly.',
    ],
    wordRange: [20, 40],
    emoji: 'Use 1-2 emojis only — Pinterest copy is search-driven, not decorative.',
    conventions: [
      '500-character cap; first 100 characters carry the searchable terms.',
      'Treat it as a Pin description: keyword-rich, no hashtag spam (2-3 max).',
      'Avoid emoji-only openings — start with a real word search engines can index.',
    ],
    cta: 'End with a benefit-led CTA aligned to a search action — e.g. "Save for later", "Click to read the full guide", "Get the free checklist". When the company context supplies a website, close with "→ <url>".',
  },
  reddit: {
    rules: [
      'Remove polished brand-marketing phrasing.',
      'Make it sound grounded, useful, and community-native.',
      'Avoid salesy CTA language.',
      'Close with an authentic discussion angle when appropriate.',
    ],
    wordRange: [80, 200],
    emoji: '',
    conventions: [
      'No hashtags; Reddit does not use them.',
      'No emojis or formal corporate tone — the post should feel written by a real user.',
      'Lead with substance; do not link out without contributing the insight in the body.',
    ],
    cta: 'Do NOT use a marketing CTA on Reddit — Reddit users punish promotional closes. Replace the CTA with a genuine discussion prompt, e.g. "Curious how others have handled this — what worked for you?" or "Has anyone here tried a different angle?".',
  },
  linkedin: {
    rules: [
      'Keep a strong opening hook in the first 1-2 lines (above the "see more" fold).',
      'Use short professional paragraphs separated by line breaks.',
      'Preserve a credible, insight-led tone.',
      'End with a clear CTA, takeaway, or reflective question.',
    ],
    wordRange: [120, 220],
    emoji: 'Use 0-2 emojis sparingly. Professional tone — emojis should reinforce a point, not decorate.',
    conventions: [
      '3,000-character cap; the first 210 characters appear above the "see more" fold.',
      '3-5 hashtags placed at the end on their own line.',
      'Avoid all-caps shouting and excessive line breaks between every sentence.',
    ],
    cta: 'End with a credible professional CTA — e.g. a reflective question to invite comments, "DM me to compare notes", "Curious how your team handles this — drop a thought below", or, when the company context supplies a website, a single "Learn more: <url>" line. Place the CTA on its own line just before the hashtag block.',
  },
};

function buildPlatformRewritePrompt(
  platform: string,
  contentType: string,
  targetLimit: number | null,
  companyContext: CompanyContext | null,
) {
  const platformLabel = platform === 'x' ? 'X' : platform.charAt(0).toUpperCase() + platform.slice(1);
  const spec = PLATFORM_SPECS[platform];

  const rules = spec?.rules ?? [
    'Rewrite it to feel native to the target platform.',
    'Keep the meaning intact but change pacing, tone, and structure for the channel.',
  ];

  // Tight-format platforms (X, TikTok, Pinterest) — treat the source as RESEARCH
  // material and write a brand-new native post from the strongest single idea.
  // Without this clause the model defaults to mechanical compression of the
  // long-form input, which produces a shrunken LinkedIn post instead of a
  // platform-native one.
  const isTightFormat = ['x', 'twitter', 'tiktok', 'pinterest'].includes(platform);

  const allowedNamesClause =
    companyContext && companyContext.allowedNames.length > 0
      ? `The ONLY brand, product, feature, or platform names you may use in the output are: ${companyContext.allowedNames.map((n) => `"${n}"`).join(', ')}. Copy them character-for-character. Names that appear verbatim in the SOURCE MATERIAL or TOPIC are also allowed; nothing else is.`
      : 'The ONLY brand, product, feature, or platform names you may use are the ones literally written under "Company" and "Products / services" in the context block above, plus names that appear verbatim in the SOURCE MATERIAL or TOPIC. Copy them character-for-character.';

  const lines: Array<string | null> = [
    `You are a senior ${platformLabel} social copywriter.`,
    isTightFormat
      ? `The text below is SOURCE MATERIAL — a long-form piece written for a different channel. Do NOT shorten it line-by-line. Treat it as research: extract the single sharpest insight, contrarian take, or surprising data point, and write a brand-new ${platformLabel} ${contentType} around that idea.`
      : `Repurpose the source ${contentType} into a native ${platformLabel} ${contentType}.`,
    'Do not summarize mechanically and do not simply shorten the original.',
    isTightFormat
      ? `The output should read like it was written natively for ${platformLabel} from the start — not like a compressed version of the source. Lead with the hook in the first line; do not echo the source's opening sentence.`
      : 'Rewrite it so it feels created for that platform from the start.',
    companyContext ? '' : null,
    companyContext ? '## Company / product / market context' : null,
    companyContext
      ? 'Use this context as ground truth: name the right product, speak to the right audience, stay inside the brand voice, and respect the positioning.'
      : null,
    companyContext ? companyContext.block : null,
    companyContext ? '' : null,
    companyContext ? '### Naming rules (HARD CONSTRAINT)' : null,
    companyContext ? allowedNamesClause : null,
    companyContext
      ? 'DO NOT invent, coin, or extrapolate any new product names, sub-brands, feature names, suite names, or platform names — even if they sound plausible or rhyme with the real name. Examples of forbidden behavior: turning "Omnivyra" into "Omniverse", "OmniSuite", "Omnivyra AI"; turning "Acme" into "Acme Pro" or "AcmeX". If a name is not explicitly listed, do not write it.'
      : null,
    companyContext
      ? 'If the source material describes a capability, refer to it using ONLY a listed product name plus a plain-English description of the capability — never a made-up product label.'
      : null,
    companyContext
      ? 'Do not invent statistics, customer names, integration partners, awards, or quotes. Only use facts present in the source material or this context block.'
      : null,
    '',
    `## ${platformLabel} writing rules`,
    ...rules,
    '',
    `## ${platformLabel} length target`,
    spec
      ? `Aim for ${spec.wordRange[0]}-${spec.wordRange[1]} words — that is the natural reading length on ${platformLabel}. Going shorter feels thin; going longer feels awkward and gets truncated by the platform UI.`
      : 'Aim for a length that reads naturally on this platform.',
    targetLimit ? `Hard character cap: ${targetLimit} characters before hashtags. Aim ~10% under that cap.` : null,
    '',
    `## ${platformLabel} platform conventions (must follow)`,
    ...(spec?.conventions ?? ['Follow the visual and structural conventions a native reader expects.']),
    '',
    `## Visual rhythm / emoji`,
    spec?.emoji ? spec.emoji : 'Do not use emojis on this platform.',
    '',
    `## Call to action`,
    spec?.cta ?? 'Close the post with a single, low-friction next step appropriate to the platform.',
    'The CTA must feel native to the platform and to the brand voice in the company context — never bolt on a generic "Click here" or "Learn more" if it does not match the surrounding tone.',
    'EXACTLY ONE CTA per post. Do not stack a conversational CTA ("Let\'s chat", "Curious how your team handles this?") together with a link CTA ("Read more: <url>", "Learn more →") — pick one. Two CTAs make the post feel pushy and dilute the action you want.',
    'If a website URL is supplied in the company context and the platform allows links, prefer the link CTA over a conversational one ONLY when there is a clear destination worth driving to; otherwise keep the conversational one and omit the URL entirely.',
    '',
    'Preserve the core business meaning and strongest insight from the source.',
    'Return plain text only — no markdown, no labels, no preamble.',
  ];

  return lines.filter((line): line is string => line !== null).join('\n');
}

async function rewriteForPlatform({
  content,
  platform,
  contentType,
  companyId,
  topic,
  companyContext,
}: {
  content: string;
  platform: string;
  contentType: string;
  companyId: string | null;
  topic: string | null;
  companyContext: CompanyContext | null;
}) {
  const charLimit = PLATFORM_CHAR_LIMITS[platform] ?? 280;
  const targetLimit = charLimit
    ? charLimit <= 500
      ? Math.floor(charLimit * 0.82)
      : charLimit - 20
    : null;
  const isTightFormat = ['x', 'twitter', 'tiktok', 'pinterest'].includes(platform);
  const userMessage = topic
    ? `TOPIC: ${topic}\n\nSOURCE MATERIAL:\n${content}`
    : content;
  const result = await runCompletionWithOperation({
    companyId,
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    operation: 'regenerateContent',
    // Tight formats need creative freedom to re-imagine the piece; low
    // temperature there causes the model to fall back to compression.
    temperature: isTightFormat ? 0.7 : 0.2,
    messages: [
      {
        role: 'system',
        content: buildPlatformRewritePrompt(platform, contentType, targetLimit, companyContext),
      },
      {
        role: 'user',
        content: userMessage,
      },
    ],
  });

  return String(result?.output || '').trim();
}

function requiresTrueRewrite(platform: string) {
  return ['x', 'twitter', 'instagram', 'facebook', 'tiktok', 'pinterest', 'reddit'].includes(platform);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { user, error } = await getSupabaseUserFromRequest(req);
  if (error || !user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const platform = String((req.body as any)?.platform || '').trim().toLowerCase();
    const content = String((req.body as any)?.content || '').trim();
    const contentType = String((req.body as any)?.contentType || 'post').trim().toLowerCase();
    const rawCompanyId = (req.body as any)?.companyId;
    const companyId = typeof rawCompanyId === 'string' && rawCompanyId.trim() ? rawCompanyId.trim() : null;
    const rawTopic = (req.body as any)?.topic;
    const topic = typeof rawTopic === 'string' && rawTopic.trim() ? rawTopic.trim() : null;

    if (!platform) {
      return res.status(400).json({ error: 'platform is required' });
    }
    if (!content) {
      return res.status(400).json({ error: 'content is required' });
    }

    let companyContext: CompanyContext | null = null;
    if (companyId) {
      try {
        const profile = await getProfile(companyId, { autoRefine: false });
        companyContext = buildCompanyContextBlock(profile);
      } catch (err) {
        // Context is best-effort: a missing or slow profile lookup must never
        // block the rewrite. Log and proceed without the context block.
        console.warn('[quick-platform-adapt] company profile fetch failed', {
          companyId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    let workingContent = content;
    let rewriteApplied = false;
    let rewriteError: unknown = null;
    try {
      const doRewrite = () => rewriteForPlatform({
        content,
        platform,
        contentType,
        companyId,
        topic,
        companyContext,
      });
      // No companyId → nothing to charge; passthrough (honest, like Task 2).
      const rewritten = companyId
        ? await wirePhase2Route({
            surface:        'content.quick-platform-adapt',
            organizationId: companyId,
            action:         'quick_platform_adapt',
            referenceType:  'quick_platform_adapt',
            referenceId:    createHash('sha256')
              .update([companyId, platform, contentType, content].join('|'))
              .digest('hex').slice(0, 40),
            run: doRewrite,
          })
        : await doRewrite();
      if (rewritten) {
        workingContent = rewritten;
        rewriteApplied = true;
      }
    } catch (err) {
      if (err instanceof PaymentRequiredError) throw err; // surface as 402
      rewriteError = err;
      console.error('[quick-platform-adapt] rewrite failed', {
        platform,
        contentType,
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      workingContent = content;
    }

    if (requiresTrueRewrite(platform) && !rewriteApplied) {
      const detail = rewriteError instanceof Error ? rewriteError.message : null;
      return res.status(502).json({
        error: detail
          ? `Platform-native rewrite for ${platform === 'x' ? 'X' : platform} failed: ${detail}`
          : `Platform-native rewrite for ${platform === 'x' ? 'X' : platform} did not complete.`,
      });
    }

    const processed = await processContent({
      content: workingContent,
      platform,
      content_type: contentType,
      card_type: 'platform_variant',
      enforce_char_limit: true,
    });

    let discoverabilityMeta: Record<string, unknown> | null = null;
    try {
      discoverabilityMeta = await optimizeDiscoverabilityForPlatform(processed.content, platform, contentType);
    } catch {
      discoverabilityMeta = null;
    }

    return res.status(200).json({
      success: true,
      variant: {
        platform,
        content_type: contentType,
        generated_content: processed.content,
        generation_status: 'generated',
        adaptation_trace: {
          adaptation_style: 'platform_specific',
          adaptation_reason: `Applied quick platform formatting rules for ${platform}.`,
          processing_trace: processed.processing_trace,
        },
        discoverability_meta: discoverabilityMeta,
      },
    });
  } catch (routeError) {
    if (routeError instanceof PaymentRequiredError) {
      return res.status(402).json({ error: routeError.message, code: routeError.code });
    }
    return res.status(500).json({
      error: routeError instanceof Error ? routeError.message : 'Failed to adapt content quickly',
    });
  }
}
