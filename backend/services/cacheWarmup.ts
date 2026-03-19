/**
 * Cache Warmup — RISK 3: Cold Cache
 *
 * Pre-warms the AI response cache on server startup with common campaign templates
 * and content blueprints so that the first users don't hit cold-cache GPT latency.
 *
 * Strategy:
 *   1. Pre-generate blueprints for the most common (topic × content_type) combinations
 *      using the template layer (zero GPT cost)
 *   2. Store them in the Redis AI cache with standard TTLs
 *   3. Log warm-up stats
 *
 * Call this from your worker startup script or Next.js custom server.
 * It is idempotent — existing Redis entries are not overwritten.
 */

import { tryTemplateBlueprintFor } from './aiTemplateLayer';
import { setCachedBlueprint } from './contentBlueprintCache';
import { setCachedCompletion } from './aiResponseCache';
import { getContentBlueprintPromptWithFingerprint } from '../prompts';

const WARMUP_COMPANY_ID = 'warmup';
const WARMUP_MODEL      = process.env.OPENAI_MODEL || 'gpt-4o-mini';

// Common topic × contentType seeds that cover most campaigns
const WARMUP_SEEDS: Array<{
  topic: string;
  contentType: string;
  objective?: string;
  audience?: string;
  painPoint?: string;
  outcome?: string;
  cta?: string;
}> = [
  // How-to / educational
  { topic: 'How to get started with social media marketing', contentType: 'post', audience: 'Small business owners', cta: 'Soft CTA' },
  { topic: 'How to grow your audience on LinkedIn', contentType: 'post', audience: 'B2B professionals', cta: 'Soft CTA' },
  { topic: 'How to create a content calendar step by step', contentType: 'carousel', audience: 'Marketers', cta: 'Soft CTA' },
  { topic: 'How to write engaging posts that convert', contentType: 'post', audience: 'Entrepreneurs', cta: 'Soft CTA' },
  { topic: 'How to measure social media ROI', contentType: 'post', audience: 'Marketing managers', cta: 'Hard CTA' },

  // List-style
  { topic: '5 ways to increase engagement on social media', contentType: 'post', audience: 'Creators', cta: 'Soft CTA' },
  { topic: '3 mistakes most brands make with content marketing', contentType: 'post', audience: 'Business owners', cta: 'Soft CTA' },
  { topic: '7 tips for consistent social media posting', contentType: 'carousel', audience: 'Busy professionals', cta: 'Soft CTA' },
  { topic: '10 reasons your content is not getting traction', contentType: 'post', audience: 'Marketers', cta: 'Soft CTA' },

  // Case studies
  { topic: 'How a startup grew 10x with content marketing', contentType: 'post', audience: 'Founders', cta: 'Soft CTA' },
  { topic: 'Case study: doubling LinkedIn engagement in 30 days', contentType: 'post', audience: 'B2B marketers', cta: 'Hard CTA' },

  // Announcements
  { topic: 'Introducing our new AI-powered content planner', contentType: 'post', audience: 'Marketing teams', cta: 'Hard CTA' },
  { topic: 'Launching our biggest feature update yet', contentType: 'post', audience: 'Existing customers', cta: 'Hard CTA' },

  // Thought leadership / questions
  { topic: 'Why do most content strategies fail?', contentType: 'post', audience: 'Executives', cta: 'Soft CTA' },
  { topic: 'Are you measuring the right social media metrics?', contentType: 'post', audience: 'Analytics teams', cta: 'Soft CTA' },
  { topic: 'What if your content could sell without selling?', contentType: 'post', audience: 'Sales professionals', cta: 'Soft CTA' },

  // Mistakes
  { topic: 'Stop making this content marketing mistake', contentType: 'post', audience: 'Business owners', cta: 'Soft CTA' },
  { topic: 'Avoid these common social media errors', contentType: 'post', audience: 'Marketers', cta: 'Soft CTA' },
];

/**
 * Warms the blueprint cache from templates (zero GPT cost).
 * Returns count of entries written.
 */
async function warmBlueprintCache(): Promise<number> {
  const { content: systemPrompt } = getContentBlueprintPromptWithFingerprint();
  let written = 0;

  for (const seed of WARMUP_SEEDS) {
    const bp = tryTemplateBlueprintFor(
      seed.topic,
      seed.contentType,
      seed.objective,
      seed.audience,
      seed.painPoint,
      seed.outcome,
      seed.cta,
    );
    if (!bp) continue;

    // Write to in-memory LRU cache
    setCachedBlueprint(WARMUP_COMPANY_ID, seed.topic, seed.contentType, seed.audience || 'General audience', bp);

    // Also write to Redis AI cache so other workers benefit
    await setCachedCompletion(
      'generateContentBlueprint',
      WARMUP_MODEL,
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: JSON.stringify({
            topic: seed.topic,
            objective: seed.objective || 'TBD objective',
            target_audience: seed.audience || 'General audience',
            pain_point: seed.painPoint || 'Audience challenge',
            outcome_promise: seed.outcome || 'Clear improvement',
            tone: 'Neutral, practical',
            cta_type: seed.cta || 'Soft CTA',
            key_points: [],
          }),
        },
      ],
      JSON.stringify(bp),
    );

    written++;
  }

  return written;
}

/**
 * Run all warmup tasks.
 * Safe to call multiple times — won't overwrite existing Redis entries.
 */
export async function runCacheWarmup(): Promise<void> {
  try {
    const blueprintCount = await warmBlueprintCache();
    console.info('[cache-warmup] complete', { blueprints: blueprintCount });
  } catch (err) {
    // Non-fatal — warmup failure should never crash the server
    console.warn('[cache-warmup] failed (non-fatal):', (err as Error)?.message);
  }
}
