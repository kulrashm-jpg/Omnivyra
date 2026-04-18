type ActivationEventName =
  | 'empty_state_primary_clicked'
  | 'sample_used'
  | 'first_content_created'
  | 'first_campaign_created';

function getSessionId() {
  if (typeof window === 'undefined') return 'server';
  const key = 'activation_session_id';
  const existing = window.localStorage.getItem(key);
  if (existing) return existing;
  const created = `activation-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  window.localStorage.setItem(key, created);
  return created;
}

export async function trackActivationEvent(
  eventName: ActivationEventName,
  options?: {
    accountId?: string | null;
    context?: string;
    meta?: Record<string, unknown>;
  },
) {
  if (typeof window === 'undefined') return;

  const accountId = String(options?.accountId ?? '').trim();
  const payload = {
    account_id: accountId,
    session_id: getSessionId(),
    referrer_source: 'app_activation',
    url: window.location.href,
    event_type: 'cta_click',
    intent_meta: {
      activation_event: eventName,
      context: options?.context ?? null,
      ...(options?.meta ?? {}),
    },
    timestamp: new Date().toISOString(),
  };

  if (!accountId) {
    try {
      window.dispatchEvent(new CustomEvent('activation:track', { detail: payload }));
    } catch {
      // ignore client-only tracking fallback failures
    }
    return;
  }

  try {
    await fetch('/api/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
    });
  } catch {
    // tracking should never block the UX
  }
}
