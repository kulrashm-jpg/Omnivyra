import { supabase } from '../db/supabaseClient';

type WebhookEventType = 'failed' | 'high_risk_pending' | 'anomaly' | 'executed';

type WebhookPayload = {
  tenant_id: string;
  organization_id: string;
  event_type: WebhookEventType;
  action_id?: string | null;
  message: string;
  metadata?: Record<string, unknown> | null;
};

const postWebhook = async (url: string, payload: WebhookPayload) => {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`Webhook failed with status ${response.status}`);
  }
};

export const sendCommunityAiWebhooks = async (payload: WebhookPayload) => {
  const { data: hooks, error } = await supabase
    .from('community_ai_webhooks')
    .select('webhook_url')
    .eq('tenant_id', payload.tenant_id)
    .eq('organization_id', payload.organization_id)
    .eq('event_type', payload.event_type)
    .eq('is_active', true);

  if (error || !hooks || hooks.length === 0) {
    return;
  }

  for (const hook of hooks) {
    try {
      await postWebhook(hook.webhook_url, payload);
    } catch (err) {
      try {
        await postWebhook(hook.webhook_url, payload);
      } catch (finalError: any) {
        if (process.env.NODE_ENV !== 'test') {
          console.warn('COMMUNITY_AI_WEBHOOK_FAILED', finalError?.message || String(finalError));
        }
      }
    }
  }
};

export type { WebhookEventType, WebhookPayload };
