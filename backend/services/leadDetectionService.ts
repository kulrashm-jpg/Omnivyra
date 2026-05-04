/**
 * Lead Detection Service
 * Detects buying signals and lead intent from engagement messages.
 */

import { createServiceRoleMigrationProxy } from '../db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');
import {
  writeLeadSignal,
} from './canonicalLeadSignalService';

const LEAD_PATTERNS: Array<{ pattern: RegExp; intent: string; score: number }> = [
  { pattern: /\b(exploring solutions?|exploring options?)\b/i, intent: 'solution_exploration', score: 70 },
  { pattern: /\b(looking for (?:tools|solutions|options|alternatives|software))\b/i, intent: 'tool_search', score: 80 },
  { pattern: /\b(interested in|interest in)\b/i, intent: 'interest_expressed', score: 65 },
  { pattern: /\b(pricing|pricing model|how much|costs?)\b/i, intent: 'pricing_inquiry', score: 85 },
  { pattern: /\b(demo|schedule a demo|book a demo|see a demo)\b/i, intent: 'demo_request', score: 90 },
  { pattern: /\b(how can we use|how do we use|how to use)\b/i, intent: 'usage_inquiry', score: 75 },
  { pattern: /\b(trial|free trial|try (?:it|your))\b/i, intent: 'trial_interest', score: 80 },
  { pattern: /\b(reach out|contact (?:you|us)|get in touch|connect)\b/i, intent: 'connection_request', score: 60 },
  { pattern: /\b(implement|implementation|roll out|deploy)\b/i, intent: 'implementation_interest', score: 70 },
  { pattern: /\b(compare|comparison|vs\.? |versus)\b/i, intent: 'comparison_inquiry', score: 65 },
];

export type DetectInput = {
  content: string;
  intent?: string | null;
  sentiment?: string | null;
  thread_context?: string | null;
};

export type LeadSignal = {
  lead_intent: string;
  lead_score: number;
  confidence_score: number;
};

const INTENT_LEAD_BONUS: Record<string, number> = {
  product_inquiry: 40,
  price_inquiry: 50,
  lead_interest: 60,
  lead: 60,
  demo_request: 55,
  trial_request: 50,
  trial_interest: 50,
};

const VALID_LEAD_INTENTS = new Set([
  'product_inquiry',
  'price_inquiry',
  'lead_interest',
  'demo_request',
  'trial_request',
  'trial_interest',
]);

function normalizeIntent(raw: string | null | undefined): string | null {
  const s = (raw ?? '').toString().trim().toLowerCase();
  if (!s) return null;
  if (VALID_LEAD_INTENTS.has(s)) return s;
  if (s === 'lead') return 'lead_interest';
  if (s === 'trial_interest') return 'trial_request';
  return null;
}

function getIntentBonus(normalizedIntent: string | null): number {
  if (!normalizedIntent) return 0;
  return INTENT_LEAD_BONUS[normalizedIntent] ?? 0;
}

/**
 * Detect lead signals from message content and context.
 * Supports intent-aware scoring for second-pass (post-intelligence) detection.
 */
export function detectLeadSignals(input: DetectInput): LeadSignal | null {
  const text = [
    input.content ?? '',
    input.thread_context ?? '',
  ]
    .filter(Boolean)
    .join(' ')
    .trim();

  const normalizedIntent = normalizeIntent(input.intent);
  const sentimentLow = (input.sentiment ?? '').toString().trim().toLowerCase();

  let bestMatch: { intent: string; score: number } | null = null;

  if (text) {
    for (const { pattern, intent, score } of LEAD_PATTERNS) {
      if (pattern.test(text)) {
        if (!bestMatch || score > bestMatch.score) {
          bestMatch = { intent, score };
        }
      }
    }
  }

  let baseScore = bestMatch?.score ?? 0;
  let leadIntent = bestMatch?.intent ?? '';

  let intentBonus = 0;
  if (normalizedIntent) {
    intentBonus = getIntentBonus(normalizedIntent);
  }
  if (intentBonus > 0 && !leadIntent && normalizedIntent) {
    leadIntent = normalizedIntent;
  }

  if (!bestMatch && intentBonus === 0) return null;

  let leadScore = baseScore + intentBonus;
  if (sentimentLow === 'positive') leadScore += 10;
  if (sentimentLow === 'negative') leadScore -= 10;
  leadScore = Math.max(0, Math.min(100, leadScore));

  let confidence = 0.7;
  if (normalizedIntent && VALID_LEAD_INTENTS.has(normalizedIntent)) {
    confidence = 0.9;
  }
  if (sentimentLow === 'positive') confidence += 0.1;
  confidence = Math.max(0, Math.min(1, confidence));

  return {
    lead_intent: leadIntent || 'lead_interest',
    lead_score: leadScore,
    confidence_score: confidence,
  };
}

/**
 * Process a message and write a normalized lead signal through the shared write path.
 * The shared writer enforces canonical-first behavior, optional legacy mirroring,
 * and invalid flag-state protection.
 */
export async function processMessageForLeads(input: {
  organization_id: string;
  message_id: string;
  thread_id: string;
  author_id?: string | null;
  content: string;
  intent?: string | null;
  sentiment?: string | null;
  thread_context?: string | null;
}): Promise<{ detected: boolean; lead_intent?: string }> {
  if (input.content == null || String(input.content).trim().length === 0) {
    return { detected: false };
  }

  let threadContext = input.thread_context ?? null;
  if (!threadContext) {
    const { data: newest } = await supabase
      .from('engagement_messages')
      .select('content, platform_created_at')
      .eq('thread_id', input.thread_id)
      .neq('id', input.message_id)
      .order('platform_created_at', { ascending: false })
      .limit(3);
    const messages = (newest ?? []) as Array<{ content?: string; platform_created_at?: string | null }>;
    messages.sort(
      (a, b) =>
        (new Date(a.platform_created_at ?? 0).getTime() - new Date(b.platform_created_at ?? 0).getTime())
    );
    threadContext =
      messages
        .map((m) => (m.content ?? '').toString().trim())
        .filter(Boolean)
        .join(' ') || null;
  }

  const signal = detectLeadSignals({
    content: input.content,
    intent: input.intent,
    sentiment: input.sentiment,
    thread_context: threadContext,
  });

  if (!signal) {
    return { detected: false };
  }

  const [{ data: message }, { data: thread }, { data: author }] = await Promise.all([
    supabase
      .from('engagement_messages')
      .select('content, platform')
      .eq('id', input.message_id)
      .maybeSingle(),
    supabase
      .from('engagement_threads')
      .select('platform')
      .eq('id', input.thread_id)
      .maybeSingle(),
    input.author_id
      ? supabase
          .from('engagement_authors')
          .select('platform_user_id')
          .eq('id', input.author_id)
          .maybeSingle()
      : Promise.resolve({ data: null as { platform_user_id?: string | null } | null }),
  ]);
  const platform =
    ((message as { platform?: string | null } | null)?.platform ??
      (thread as { platform?: string | null } | null)?.platform ??
      '')
      .toString()
      .trim()
      .toLowerCase();
  if (!platform) {
    throw new Error(`Missing platform for engagement lead signal message ${input.message_id}`);
  }

  const writeResult = await writeLeadSignal({
    debugContext: 'leadDetectionService.processMessageForLeads',
    canonical: {
      organization_id: input.organization_id,
      source_type: 'engagement',
      source_id: input.message_id,
      thread_id: input.thread_id,
      platform,
      platform_user_id:
        ((author as { platform_user_id?: string | null } | null)?.platform_user_id ?? null) || null,
      content_text:
        ((message as { content?: string | null } | null)?.content ?? input.content ?? '').toString(),
      intent_score: signal.lead_score / 100,
      urgency_score: null,
      icp_score: null,
      confidence_score: signal.confidence_score,
      total_score: signal.lead_score / 100,
      detected_at: new Date().toISOString(),
      migration_source: 'native',
      metadata: {
        lead_intent: signal.lead_intent,
        author_id: input.author_id ?? null,
      },
    },
  });

  void import('./leadThreadScoring').then(({ scheduleThreadScoreUpdate }) =>
    scheduleThreadScoreUpdate(input.thread_id, input.organization_id)
  );

  void import('./responsePerformanceService').then(({ markLeadConversion }) =>
    markLeadConversion(input.thread_id).catch((err) =>
      console.warn('[leadDetection] markLeadConversion', (err as Error)?.message)
    )
  );

  return { detected: true, lead_intent: signal.lead_intent };
}
