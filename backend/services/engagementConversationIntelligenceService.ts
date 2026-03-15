/**
 * Engagement Conversation Intelligence Service
 *
 * Analyzes engagement messages for intent, sentiment, lead signals, and influencer detection.
 * Stores results in engagement_message_intelligence and engagement_thread_intelligence.
 * Does NOT execute actions automatically — classification only.
 */

import { supabase } from '../db/supabaseClient';
import { evaluateCommunityAiEngagement, isOmniVyraEnabled } from './omnivyraClientV1';
import { getProfile } from './companyProfileService';

const INFLUENCER_FOLLOWER_THRESHOLD = 10000;

export type MessageIntelligenceResult = {
  sentiment: string | null;
  intent: string | null;
  lead_signal: boolean;
  question_detected: boolean;
  influencer_signal: boolean;
  confidence_score: number;
};

async function detectInfluencer(
  author_id: string | null,
  platform: string,
  organization_id: string | null
): Promise<boolean> {
  if (!author_id || !organization_id) return false;

  const { data: author } = await supabase
    .from('engagement_authors')
    .select('id, platform_user_id, username, profile_url')
    .eq('id', author_id)
    .maybeSingle();

  if (!author) return false;

  let discoveredQuery = supabase
    .from('community_ai_discovered_users')
    .select('id, classification, metadata')
    .eq('organization_id', organization_id)
    .eq('tenant_id', organization_id)
    .eq('platform', (platform || '').toString().trim().toLowerCase());

  if (author.profile_url) {
    discoveredQuery = discoveredQuery.eq('profile_url', author.profile_url);
  } else if (author.username) {
    discoveredQuery = discoveredQuery.eq('external_username', author.username);
  } else {
    return false;
  }

  const { data: discovered } = await discoveredQuery.maybeSingle();

  if (!discovered) return false;

  if (discovered.classification === 'influencer') return true;

  const followerCount = discovered.metadata && typeof discovered.metadata === 'object'
    ? Number((discovered.metadata as Record<string, unknown>).follower_count)
    : null;
  if (followerCount != null && !Number.isNaN(followerCount) && followerCount >= INFLUENCER_FOLLOWER_THRESHOLD) {
    return true;
  }

  return false;
}

function ruleBasedAnalysis(content: string, sentimentScore: number | null): MessageIntelligenceResult {
  const lower = (content ?? '').toString().trim().toLowerCase();
  const sentiment = sentimentScore != null && sentimentScore < -0.3 ? 'negative'
    : sentimentScore != null && sentimentScore > 0.3 ? 'positive'
    : 'neutral';

  const negativeWords = ['problem', 'bad', 'issue', 'not working', 'disappointed', 'frustrated', 'unhappy'];
  const hasNegative = negativeWords.some((w) => lower.includes(w)) || (sentiment === 'negative');

  const leadWords = ['interested', 'contact', 'demo', 'pricing', 'schedule', 'buy', 'purchase'];
  const leadSignal = leadWords.some((w) => lower.includes(w));

  const questionDetected = lower.includes('?');

  let intent: string | null = null;
  if (leadSignal) intent = 'lead';
  else if (questionDetected) intent = 'question';
  else if (hasNegative) intent = 'complaint';
  else intent = 'general';

  return {
    sentiment,
    intent,
    lead_signal: leadSignal,
    question_detected: questionDetected,
    influencer_signal: false,
    confidence_score: 0.7,
  };
}

/**
 * Analyze a single message and store intelligence.
 * Updates engagement_thread_intelligence for the thread.
 */
export async function analyzeMessage(message_id: string): Promise<void> {
  const { data: message, error: msgError } = await supabase
    .from('engagement_messages')
    .select('id, thread_id, content, author_id, platform, sentiment_score')
    .eq('id', message_id)
    .maybeSingle();

  if (msgError || !message) {
    console.warn('[engagementConversationIntelligence] message not found', message_id);
    return;
  }

  const { data: thread } = await supabase
    .from('engagement_threads')
    .select('id, organization_id')
    .eq('id', message.thread_id)
    .maybeSingle();

  const organizationId = thread?.organization_id ?? null;

  let result: MessageIntelligenceResult = ruleBasedAnalysis(
    message.content ?? '',
    message.sentiment_score ?? null
  );

  result.influencer_signal = await detectInfluencer(
    message.author_id,
    message.platform ?? '',
    organizationId
  );

  if (isOmniVyraEnabled() && organizationId) {
    try {
      const voice = await getProfile(organizationId, { autoRefine: false, languageRefine: true })
        .then((p) => {
          const entry = Array.isArray(p?.brand_voice_list) ? p.brand_voice_list[0] : null;
          return (entry || p?.brand_voice || 'professional').toString().trim();
        });

      const response = await evaluateCommunityAiEngagement({
        tenant_id: organizationId,
        organization_id: organizationId,
        platform: message.platform ?? undefined,
        post_data: { content: message.content, target_message: message.content },
        engagement_metrics: {},
        brand_voice: voice || 'professional',
        context: { message_id, analysis_type: 'intent' },
      });

      if (response?.status === 'ok' && response?.data) {
        const analysis = (response.data as { analysis?: string }).analysis ?? '';
        const lowerAnalysis = analysis.toLowerCase();
        if (lowerAnalysis.includes('question') || lowerAnalysis.includes('?')) {
          result.question_detected = true;
          result.intent = result.intent ?? 'question';
        }
        if (lowerAnalysis.includes('lead') || lowerAnalysis.includes('interested')) {
          result.lead_signal = true;
          result.intent = result.intent ?? 'lead';
        }
        if (lowerAnalysis.includes('negative') || lowerAnalysis.includes('complaint')) {
          result.intent = result.intent ?? 'complaint';
        }
        const conf = (response.data as { confidence_level?: number }).confidence_level;
        if (conf != null && !Number.isNaN(conf)) {
          result.confidence_score = Math.min(1, Math.max(0, Number(conf)));
        }
      }
    } catch (err) {
      console.warn('[engagementConversationIntelligence] OmniVyra error, using rule-based:', (err as Error)?.message);
    }
  }

  const { error: insertError } = await supabase
    .from('engagement_message_intelligence')
    .upsert(
      {
        message_id,
        sentiment: result.sentiment,
        intent: result.intent,
        lead_signal: result.lead_signal,
        question_detected: result.question_detected,
        influencer_signal: result.influencer_signal,
        confidence_score: result.confidence_score,
        created_at: new Date().toISOString(),
      },
      { onConflict: 'message_id' }
    );

  if (insertError) {
    console.warn('[engagementConversationIntelligence] upsert message intelligence failed', insertError.message);
    return;
  }

  if (organizationId) {
    void import('./leadDetectionService')
      .then(({ processMessageForLeads }) =>
        processMessageForLeads({
          organization_id: organizationId,
          message_id,
          thread_id: message.thread_id,
          author_id: message.author_id ?? null,
          content: (message.content ?? '').toString(),
          intent: result.intent ?? null,
          sentiment: result.sentiment ?? null,
          thread_context: null,
        })
      )
      .catch((err) => console.warn('[engagementConversationIntelligence] processMessageForLeads async error', (err as Error)?.message));
  }

  await updateThreadIntelligence(message.thread_id);
}

/**
 * Aggregate message intelligence into thread intelligence.
 */
async function updateThreadIntelligence(thread_id: string): Promise<void> {
  const { data: messages } = await supabase
    .from('engagement_messages')
    .select('id')
    .eq('thread_id', thread_id);

  const messageIds = (messages ?? []).map((m: { id: string }) => m.id);
  if (messageIds.length === 0) return;

  const { data: intelRows } = await supabase
    .from('engagement_message_intelligence')
    .select('lead_signal, question_detected, influencer_signal, intent, sentiment')
    .in('message_id', messageIds);

  const leadDetected = (intelRows ?? []).some((r: { lead_signal?: boolean }) => r.lead_signal === true);
  const negativeFeedback = (intelRows ?? []).some(
    (r: { sentiment?: string }) => (r.sentiment ?? '').toLowerCase() === 'negative'
  );
  const customerQuestion = (intelRows ?? []).some((r: { question_detected?: boolean }) => r.question_detected === true);
  const influencerDetected = (intelRows ?? []).some((r: { influencer_signal?: boolean }) => r.influencer_signal === true);

  const intents = (intelRows ?? []).map((r: { intent?: string }) => r.intent).filter(Boolean);
  const dominantIntent = intents.length > 0
    ? intents.sort((a, b) => (intents.filter((x) => x === b).length - intents.filter((x) => x === a).length))[0]
    : null;

  const reasons: string[] = [];
  if (leadDetected) reasons.push('lead_detected');
  if (negativeFeedback) reasons.push('negative_feedback');
  if (customerQuestion) reasons.push('customer_question');
  if (influencerDetected) reasons.push('influencer_detected');

  const { error: upsertError } = await supabase
    .from('engagement_thread_intelligence')
    .upsert(
      {
        thread_id,
        dominant_intent: dominantIntent,
        lead_detected: leadDetected,
        negative_feedback: negativeFeedback,
        customer_question: customerQuestion,
        influencer_detected: influencerDetected,
        priority_reason: reasons.length > 0 ? reasons.join(',') : null,
        confidence_score: intelRows?.length
          ? (intelRows as { confidence_score?: number }[]).reduce((s, r) => s + (r.confidence_score ?? 0), 0) / intelRows.length
          : null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'thread_id' }
    );

  if (upsertError) {
    console.warn('[engagementConversationIntelligence] upsert thread intelligence failed', upsertError.message);
  }
}
