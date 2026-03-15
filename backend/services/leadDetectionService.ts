/**
 * Lead Detection Service
 * Detects buying signals and lead intent from engagement messages.
 */

import { supabase } from '../db/supabaseClient';

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
 * Process a message and upsert lead signal to engagement_lead_signals.
 * Uses onConflict: 'message_id'. Updates lead_score, confidence_score, lead_intent
 * only when the new signal is better than existing.
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

  const { data: existing } = await supabase
    .from('engagement_lead_signals')
    .select('lead_score, confidence_score, lead_intent')
    .eq('message_id', input.message_id)
    .maybeSingle();

  const existingRow = existing as { lead_score?: number; confidence_score?: number; lead_intent?: string } | null;
  const existingScore = existingRow?.lead_score ?? 0;
  const existingConf = existingRow?.confidence_score ?? 0;

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

  const shouldInsert = !existingRow;
  const shouldUpdate =
    existingRow &&
    (signal.lead_score > existingScore ||
      (signal.lead_score === existingScore && signal.confidence_score > existingConf));

  if (!shouldInsert && !shouldUpdate) {
    return { detected: true, lead_intent: existingRow?.lead_intent ?? signal.lead_intent };
  }

  if (shouldInsert) {
    const { error } = await supabase.from('engagement_lead_signals').insert({
      organization_id: input.organization_id,
      message_id: input.message_id,
      thread_id: input.thread_id,
      author_id: input.author_id ?? null,
      lead_intent: signal.lead_intent,
      lead_score: signal.lead_score,
      confidence_score: signal.confidence_score,
      detected_at: new Date().toISOString(),
    });
    if (error?.code === '23505') {
      const { data: raced } = await supabase
        .from('engagement_lead_signals')
        .select('lead_score, confidence_score')
        .eq('message_id', input.message_id)
        .maybeSingle();
      const racedRow = raced as { lead_score?: number; confidence_score?: number } | null;
      const racedScore = racedRow?.lead_score ?? 0;
      const racedConf = racedRow?.confidence_score ?? 0;
      const isBetter =
        signal.lead_score > racedScore ||
        (signal.lead_score === racedScore && signal.confidence_score > racedConf);
      if (isBetter) {
        const orFilter = `lead_score.lt.${signal.lead_score},and(lead_score.eq.${signal.lead_score},confidence_score.lt.${signal.confidence_score})`;
        await supabase
          .from('engagement_lead_signals')
          .update({
            lead_intent: signal.lead_intent,
            lead_score: signal.lead_score,
            confidence_score: signal.confidence_score,
            detected_at: new Date().toISOString(),
          })
          .eq('message_id', input.message_id)
          .or(orFilter);
      }
    }
  } else if (shouldUpdate) {
    const orFilter = `lead_score.lt.${signal.lead_score},and(lead_score.eq.${signal.lead_score},confidence_score.lt.${signal.confidence_score})`;
    await supabase
      .from('engagement_lead_signals')
      .update({
        lead_intent: signal.lead_intent,
        lead_score: signal.lead_score,
        confidence_score: signal.confidence_score,
        detected_at: new Date().toISOString(),
      })
      .eq('message_id', input.message_id)
      .or(orFilter);
  }

  const shouldRecompute =
    !existingRow || signal.lead_score !== existingScore;
  if (shouldRecompute) {
    void import('./leadThreadScoring').then(({ scheduleThreadScoreUpdate }) =>
      scheduleThreadScoreUpdate(input.thread_id, input.organization_id)
    );
  }

  void import('./responsePerformanceService').then(({ markLeadConversion }) =>
    markLeadConversion(input.thread_id).catch((err) =>
      console.warn('[leadDetection] markLeadConversion', (err as Error)?.message)
    )
  );

  return { detected: true, lead_intent: signal.lead_intent };
}
