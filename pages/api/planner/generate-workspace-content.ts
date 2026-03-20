/**
 * POST /api/planner/generate-workspace-content
 * Generates platform-specific content variants for the Activity Workspace Drawer.
 * Each variant is structurally formatted for its platform (hook, body, CTA, hashtags).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { getProfile } from '../../../backend/services/companyProfileService';
import { buildCompanyContext } from '../../../backend/services/companyContextService';
import { runCompletionWithOperation } from '../../../backend/services/aiGateway';
import { processContent } from '../../../backend/services/unifiedContentProcessor';
import { hasEnoughCredits } from '../../../backend/services/creditDeductionService';
import { deductCreditsAwaited } from '../../../backend/services/creditExecutionService';

// ─────────────────────────────────────────────────────────────────────────────
// Platform specs: character limits, tone, optimal targets, hashtag counts
// ─────────────────────────────────────────────────────────────────────────────

type PlatformSpec = {
  limit: number;           // Hard character ceiling
  optimal: number;         // Ideal target length (for best engagement)
  tone: string;
  emojis: string;          // Emoji usage guidance
  hashtags: string;        // Hashtag count guidance
  structure: string;       // Step-by-step content structure template
};

const PLATFORM_SPECS: Record<string, PlatformSpec> = {
  linkedin: {
    limit: 3000,
    optimal: 1200,
    tone: 'Professional, insightful, thought-leadership — confident but not arrogant',
    emojis: 'Use sparingly (0–3) only if they reinforce a point, never decorative',
    hashtags: '3–5 hashtags inline at the very end, on their own line',
    structure: `Structure (follow exactly):
LINE 1: Bold hook — a surprising stat, contrarian statement, or powerful question (1–2 sentences max). This line alone must make people stop scrolling.
[blank line]
BODY: 2–4 short paragraphs (2–3 sentences each). Each paragraph = one clear idea. Add blank line between every paragraph.
[blank line]
OPTIONAL BULLETS: 2–4 short bullet points using • if listing specific items/tips.
[blank line]
CTA: One sentence — ask a question or invite a specific action (comment, share, click).
[blank line]
HASHTAGS: 3–5 relevant hashtags on the last line.`,
  },

  instagram: {
    limit: 2200,
    optimal: 800,
    tone: 'Visual, aspirational, warm, relatable — conversational like a friend sharing a discovery',
    emojis: 'Use 3–8 emojis to add personality and break up text visually',
    hashtags: '8–15 hashtags separated by two blank lines from the main caption',
    structure: `Structure (follow exactly):
HOOK (first 125 chars): Emotionally compelling opener — a question, bold statement, or relatable confession. Must hook before the "more" cutoff.
[blank line]
STORY BODY: 2–3 short paragraphs. Tell a mini-story or share an insight with personal angle. Keep each paragraph to 2–3 lines max.
[blank line]
CTA: Ask followers a question ("Which one are you?", "Save this for later!", "Tag someone who needs this").
[two blank lines]
HASHTAGS: 8–15 tightly relevant hashtags on separate lines (mix niche, medium, and broad).`,
  },

  twitter: {
    limit: 280,
    optimal: 240,
    tone: 'Punchy, direct, witty — every word earns its place',
    emojis: 'Optional (0–2 max), only if they replace a word or add humour',
    hashtags: '1–2 hashtags maximum, only if highly relevant — avoid hashtag stuffing',
    structure: `Structure (follow exactly):
OPTION A — Single tweet (default if topic fits): 1–3 punchy sentences. No filler words. Contrarian, surprising, or immediately useful. End with a question or strong opinion if space allows.
OPTION B — Thread (only if topic requires depth): Start with "🧵 Thread:" then number tweets as 1/ 2/ 3/. Each tweet = one complete thought under 280 chars. Final tweet = CTA or summary.
Keep to Option A unless the topic genuinely needs multiple points.`,
  },

  x: {
    limit: 280,
    optimal: 240,
    tone: 'Punchy, direct, witty — every word earns its place',
    emojis: 'Optional (0–2 max), only if they replace a word or add humour',
    hashtags: '1–2 hashtags maximum, only if highly relevant — avoid hashtag stuffing',
    structure: `Structure (follow exactly):
OPTION A — Single tweet (default if topic fits): 1–3 punchy sentences. No filler words. Contrarian, surprising, or immediately useful. End with a question or strong opinion if space allows.
OPTION B — Thread (only if topic requires depth): Start with "🧵 Thread:" then number tweets as 1/ 2/ 3/. Each tweet = one complete thought under 280 chars. Final tweet = CTA or summary.
Keep to Option A unless the topic genuinely needs multiple points.`,
  },

  facebook: {
    limit: 63206,
    optimal: 1000,
    tone: 'Community-oriented, warm, conversational — like sharing with friends not broadcasting',
    emojis: 'Use 3–6 emojis naturally within sentences to add warmth',
    hashtags: '1–3 hashtags maximum at the end (Facebook hashtags have minimal reach impact)',
    structure: `Structure (follow exactly):
OPENER: Friendly, relatable opening — a short personal story, surprising fact, or direct question to the reader (2–3 sentences).
[blank line]
MAIN BODY: 2–3 paragraphs expanding on the topic. Use a conversational, storytelling tone. Each paragraph 2–4 sentences.
[blank line]
ENGAGEMENT QUESTION: End with a clear, easy-to-answer question that invites comments ("What do you think?", "Have you tried this?", "Drop a ❤️ if you agree!").
[blank line]
HASHTAGS: 1–3 hashtags (optional).`,
  },

  youtube: {
    limit: 5000,
    optimal: 1500,
    tone: 'Educational, narrative, authoritative — you are the trusted expert guiding the viewer',
    emojis: 'Use 1–3 emojis in section headers only to improve scanability',
    hashtags: '3–5 hashtags at the very bottom (YouTube uses these for discovery)',
    structure: `Structure (follow exactly):
FIRST LINE (60 chars max): SEO-optimised hook — must standalone as a search result title/snippet. Include the primary keyword.
[blank line]
INTRO PARAGRAPH: 2–3 sentences expanding on what viewers will learn. Include 2–3 secondary keywords naturally.
[blank line]
📌 WHAT'S COVERED (optional chapter markers):
0:00 - Introduction
X:XX - [Section Name]
X:XX - [Section Name]
X:XX - Conclusion & Next Steps
[blank line]
ABOUT THIS VIDEO: 2–3 sentences about the channel or series context.
[blank line]
🔗 LINKS & RESOURCES: [placeholder for links]
[blank line]
HASHTAGS: 3–5 hashtags on the last line.`,
  },

  tiktok: {
    limit: 2200,
    optimal: 300,
    tone: 'Casual, energetic, trend-aware, authentic — speak like a creator not a brand',
    emojis: '5–10 emojis used liberally to match TikTok energy',
    hashtags: '5–8 hashtags — mix trending broad tags (#fyp #foryou) with niche-specific ones',
    structure: `Structure (follow exactly):
HOOK (first 5 words): Must create immediate curiosity or FOMO — "Wait, you didn't know this?", "POV:", "The one thing nobody tells you about...". First line determines whether viewers watch.
[blank line]
PATTERN INTERRUPT: 1–2 sentences that flip expectations or reveal the surprising angle.
[blank line]
PAYOFF / VALUE: 2–4 short punchy lines delivering the promised insight or story.
[blank line]
CTA: Direct, low-friction action ("Follow for more 👇", "Comment 'YES' if this helped!", "Share with someone who needs this").
[blank line]
HASHTAGS: 5–8 hashtags including #fyp or #foryoupage plus niche tags.`,
  },

  pinterest: {
    limit: 500,
    optimal: 300,
    tone: 'Inspirational, aspirational, keyword-rich — people are searching for ideas and solutions',
    emojis: '1–3 emojis max, only if they enhance the visual description',
    hashtags: '3–5 keyword hashtags that match what people search on Pinterest',
    structure: `Structure (follow exactly):
KEYWORD HOOK (first 30 chars): Start with the primary search keyword people would type ("10 Ways to...", "Easy [Topic] Ideas", "How to [Outcome]"). Pinterest is a search engine — lead with searchable language.
[blank line]
VISUAL DESCRIPTION: 2–3 sentences describing what the pin shows and why it's useful. Be specific about materials, steps, or outcomes.
[blank line]
BENEFIT / OUTCOME: 1 sentence on the specific result or transformation the reader gets.
[blank line]
HASHTAGS: 3–5 keyword-based hashtags (not brand hashtags).`,
  },

  reddit: {
    limit: 40000,
    optimal: 600,
    tone: 'Authentic, community-first, no corporate speak — genuine value without self-promotion',
    emojis: 'Avoid emojis — Reddit communities generally dislike marketing-style formatting',
    hashtags: 'No hashtags — Reddit does not use hashtags',
    structure: `Structure (follow exactly):
TITLE (separate field, 50–200 chars): Specific, searchable, curiosity-driving. Avoid clickbait. Good: "I tested X for 30 days and here's what happened". Bad: "Amazing results with X!".
[blank line]
CONTEXT (2–3 sentences): Brief background that makes the post relevant to this community. Why does this matter to Reddit users specifically?
[blank line]
MAIN CONTENT: 2–4 short paragraphs. Each = one clear point. Use plain language. No corporate buzzwords. If listing items, use numbered lists.
[blank line]
DISCUSSION HOOK: End with a genuine open question inviting community input ("Has anyone else experienced this?", "What's worked better for you?").
Note: Separate the title with a line starting with "Title:" and the body below it.`,
  },
};

function getPlatformSpec(platform: string): PlatformSpec {
  return PLATFORM_SPECS[platform.toLowerCase()] ?? {
    limit: 2000,
    optimal: 600,
    tone: 'Professional, clear, and engaging',
    emojis: 'Use sparingly',
    hashtags: '3–5 relevant hashtags',
    structure: 'Hook → Value body → CTA → Hashtags',
  };
}

// Content-type specific overrides injected into the prompt
const CONTENT_TYPE_GUIDANCE: Record<string, string> = {
  video:     'Write a VIDEO SCRIPT or VIDEO DESCRIPTION — not a text post. Include: hook (what the video is about in 1 sentence), talking points (3–5 bullet points the creator will cover), and a closing CTA.',
  reel:      'Write a SHORT-FORM VIDEO SCRIPT (30–60 seconds). Include: hook line (read in first 3 seconds), 3–4 rapid-fire value points, CTA at the end. Keep it punchy and visual.',
  carousel:  'Write a CAROUSEL post. Format as: Slide 1: [hook/title], Slide 2: [point 1], Slide 3: [point 2], Slide 4: [point 3], Slide 5: [CTA]. Each slide max 50 words.',
  story:     'Write a STORY / EPHEMERAL content piece. Very short (1–3 sentences), highly visual, immediate CTA (swipe up, tap link, reply). Story disappears in 24h so be urgent.',
  thread:    'Write a THREAD. Start with a strong opening tweet, then provide 4–7 numbered follow-up tweets (each standalone under 280 chars), ending with a summary or CTA tweet.',
  podcast:   'Write PODCAST SHOW NOTES. Include: episode summary (2–3 sentences), key takeaways (3–5 bullets), guest mentions if relevant, timestamp highlights, and a listener CTA.',
  newsletter:'Write a NEWSLETTER introduction (first 150 words of the email). Include: subject-line-style opener, personal hook, 2–3 value teasers, and a "keep reading" invitation.',
  article:   'Write a LONG-FORM ARTICLE introduction and outline. Include: headline, subheadline, lede paragraph (first 2–3 sentences that hook the reader), and a bullet-point outline of 4–6 sections.',
};

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { companyId, topic, platforms, contentTypes, theme, objective, week } = req.body || {};

    if (!companyId || typeof companyId !== 'string') {
      return res.status(400).json({ error: 'companyId is required' });
    }
    if (!topic || typeof topic !== 'string') {
      return res.status(400).json({ error: 'topic is required' });
    }
    if (!Array.isArray(platforms) || platforms.length === 0) {
      return res.status(400).json({ error: 'platforms array is required' });
    }

    const access = await enforceCompanyAccess({ req, res, companyId: companyId.trim(), requireCampaignId: false });
    if (!access) return;

    // Credit check — 1 content_basic per platform requested
    const platformCount = (platforms as string[]).length;
    const check = await hasEnoughCredits(companyId.trim(), 'content_basic', platformCount);
    if (!check.sufficient) {
      return res.status(402).json({ error: 'Insufficient credits to generate content', required: check.required, balance: check.balance });
    }

    // Load company profile for brand context
    const profile = await getProfile(companyId.trim(), { autoRefine: false, languageRefine: false });
    let brandContext = '';
    if (profile) {
      const ctx = buildCompanyContext(profile);
      const parts: string[] = [];
      if (ctx.identity.name) parts.push(`Company: ${ctx.identity.name}`);
      if (ctx.identity.industry) parts.push(`Industry: ${ctx.identity.industry}`);
      if (ctx.brand.unique_value) parts.push(`Value proposition: ${ctx.brand.unique_value}`);
      if (ctx.brand.brand_voice) parts.push(`Tone of voice: ${ctx.brand.brand_voice}`);
      if (ctx.customer.target_audience) parts.push(`Target audience: ${ctx.customer.target_audience}`);
      if (ctx.brand.key_messages) parts.push(`Key messages: ${ctx.brand.key_messages}`);
      brandContext = parts.join('\n');
    }

    // Build detailed per-platform instruction blocks
    const platformBlocks = (platforms as string[]).map((p) => {
      const spec = getPlatformSpec(p);
      const ct = ((contentTypes as Record<string, string> | undefined)?.[p] ?? 'post').toLowerCase();
      const ctGuidance = CONTENT_TYPE_GUIDANCE[ct] ?? '';

      return `
=== ${p.toUpperCase()}${ct !== 'post' ? ` (${ct})` : ''} ===
Tone: ${spec.tone}
Character limit: ${spec.limit} (aim for ~${spec.optimal} for best engagement)
Emoji usage: ${spec.emojis}
Hashtags: ${spec.hashtags}
${ctGuidance ? `Content-type note: ${ctGuidance}\n` : ''}${spec.structure}`.trim();
    }).join('\n\n');

    const contextLines: string[] = [];
    if (theme) contextLines.push(`Weekly theme: ${theme}`);
    if (objective) contextLines.push(`Objective: ${objective}`);
    if (week) contextLines.push(`Campaign week: ${week}`);

    const systemPrompt = `You are an expert social media content strategist and copywriter. You write platform-native content — each piece feels like it was created specifically for that platform by someone who lives on it.

Rules you always follow:
1. Return ONLY a valid JSON object. Keys are lowercase platform names. Values are the complete ready-to-publish content strings.
2. Follow each platform's structure template exactly — hook, body, CTA, hashtags in the right places.
3. Never reuse the same sentences across platforms. Each variant must be genuinely adapted, not just copy-pasted.
4. Respect character limits. Never exceed the hard limit. Target the optimal length.
5. No meta-commentary, no "Here is your LinkedIn post:", no markdown code fences outside the content itself.
6. For Reddit: prefix the title with "Title: " on line 1, then write the body from line 2 onwards.
7. For Twitter/X threads: number tweets as 1/ 2/ 3/ with each on a new line.
8. For carousels: label each slide as "Slide 1:", "Slide 2:", etc.`;

    const userPrompt = `${brandContext ? `BRAND CONTEXT:\n${brandContext}\n\n` : ''}${contextLines.length > 0 ? `CAMPAIGN CONTEXT:\n${contextLines.join('\n')}\n\n` : ''}TOPIC / ANGLE:\n${topic.trim()}

Generate platform-specific content for each platform below. Follow each platform's structure template exactly.

${platformBlocks}

Return JSON: { "${(platforms as string[]).map((p) => p.toLowerCase()).join('": "...", "')}" : "..." }`;

    const result = await runCompletionWithOperation({
      companyId,
      model: 'gpt-4o-mini',
      temperature: 0.72,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      operation: 'generatePlatformVariants',
    });

    let rawVariants: Record<string, string> = {};
    try {
      const raw = typeof result.output === 'string' ? result.output : JSON.stringify(result.output ?? {});
      const parsed = JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, ''));
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === 'string') rawVariants[k.toLowerCase()] = v;
      }
    } catch {
      return res.status(500).json({ error: 'AI returned malformed JSON' });
    }

    // Run every variant through the unified content processor before returning
    const variants: Record<string, string> = {};
    await Promise.all(
      Object.entries(rawVariants).map(async ([platform, content]) => {
        const ct = ((contentTypes as Record<string, string> | undefined)?.[platform] ?? 'post').toLowerCase();
        const processed = await processContent({
          content,
          platform,
          content_type: ct,
          card_type: 'platform_variant',
        });
        variants[platform] = processed.content;
      })
    );

    const variantCount = Object.keys(variants).length;
    if (variantCount > 0) {
      await deductCreditsAwaited(companyId.trim(), 'content_basic', {
        note: `Generated ${variantCount} platform variant${variantCount > 1 ? 's' : ''} (workspace)`,
        multiplier: variantCount,
      });
    }

    return res.status(200).json({ variants });
  } catch (err: unknown) {
    console.error('[planner/generate-workspace-content]', err);
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to generate content' });
  }
}

export default handler;
