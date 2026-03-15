/**
 * Response Policy Engine
 * Maps message intent + platform to response template.
 */

import { supabase } from '../db/supabaseClient';

export type MessageIntent =
  | 'greeting'
  | 'introduction'
  | 'question'
  | 'product_inquiry'
  | 'price_inquiry'
  | 'positive_feedback'
  | 'negative_feedback'
  | 'complaint'
  | 'lead_interest'
  | 'general_discussion'
  | 'spam';

export type ResolveInput = {
  message_id: string;
  organization_id: string;
  platform: string;
  intent?: string | null;
  sentiment?: string | null;
  author_name?: string | null;
  thread_context?: string | null;
};

export type ResolvedPolicy = {
  template_id: string;
  template_name: string;
  template_structure: string;
  tone: string;
  emoji_policy: string;
  auto_reply: boolean;
  platform_modifiers?: Record<string, string>;
};

/**
 * Resolve response policy for a message.
 */
export async function resolveResponsePolicy(
  input: ResolveInput
): Promise<ResolvedPolicy | null> {
  const platform = (input.platform ?? '').toString().trim().toLowerCase() || 'linkedin';
  const intent = normalizeIntent(input.intent);

  const { data: rules, error: rulesError } = await supabase
    .from('response_rules')
    .select('id, template_id, auto_reply, priority')
    .eq('organization_id', input.organization_id)
    .eq('intent_type', intent)
    .or(`platform.eq.${platform},platform.is.null`)
    .order('priority', { ascending: false })
    .limit(1);

  if (rulesError || !rules?.[0]) {
    return null;
  }

  const rule = rules[0];
  const { data: template, error: templateError } = await supabase
    .from('response_templates')
    .select('id, template_name, template_structure, tone, emoji_policy')
    .eq('id', rule.template_id)
    .eq('organization_id', input.organization_id)
    .maybeSingle();

  if (templateError || !template) {
    return null;
  }

  const profile = await getPlatformProfile(input.organization_id, platform);

  return {
    template_id: template.id,
    template_name: template.template_name,
    template_structure: template.template_structure,
    tone: profile?.default_tone ?? template.tone ?? 'professional',
    emoji_policy: profile?.emoji_usage ?? template.emoji_policy ?? 'minimal',
    auto_reply: rule.auto_reply ?? false,
    platform_modifiers: profile ? { response_style: profile.response_style ?? '' } : undefined,
  };
}

function normalizeIntent(raw: string | null | undefined): string {
  const s = (raw ?? '').toString().trim().toLowerCase();
  const intentMap: Record<string, string> = {
    greeting: 'greeting',
    introduction: 'introduction',
    question: 'question',
    product_inquiry: 'product_inquiry',
    price_inquiry: 'price_inquiry',
    positive_feedback: 'positive_feedback',
    negative_feedback: 'negative_feedback',
    complaint: 'complaint',
    lead_interest: 'lead_interest',
    general_discussion: 'general_discussion',
    spam: 'spam',
  };
  return (intentMap[s] ?? s) || 'general_discussion';
}

async function getPlatformProfile(
  organizationId: string,
  platform: string
): Promise<{ default_tone: string; emoji_usage: string; response_style: string | null } | null> {
  const { data, error } = await supabase
    .from('response_policy_profiles')
    .select('default_tone, emoji_usage, response_style')
    .eq('organization_id', organizationId)
    .eq('platform', platform)
    .maybeSingle();

  if (error || !data) return null;
  return data as { default_tone: string; emoji_usage: string; response_style: string | null };
}
