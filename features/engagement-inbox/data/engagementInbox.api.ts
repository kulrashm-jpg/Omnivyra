// Transport-only thin wrappers around the engagement-inbox endpoints.
// Each function returns the raw Response so the caller's existing
// `.ok` / `.json()` / status checks are preserved verbatim.

export async function sendReply(payload: Record<string, unknown>): Promise<Response> {
  return fetch('/api/engagement/reply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload),
  });
}

export async function sendAISuggestion(payload: Record<string, unknown>): Promise<Response> {
  return fetch('/api/engagement/ai-suggestion', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload),
  });
}

export async function trackAISuggestionShown(payload: Record<string, unknown>): Promise<Response> {
  return fetch('/api/engagement/ai-suggestion', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload),
  });
}

export async function trackAISuggestionUsed(payload: Record<string, unknown>): Promise<Response> {
  return fetch('/api/engagement/ai-suggestion', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload),
  });
}

export async function getIntelligenceContext(payload: Record<string, unknown>): Promise<Response> {
  return fetch('/api/intelligence/context', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload),
  });
}

export async function generateResponse(payload: Record<string, unknown>): Promise<Response> {
  return fetch('/api/engagement/generate-response', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload),
  });
}

export async function updateSignalStatus(payload: Record<string, unknown>): Promise<Response> {
  return fetch('/api/engagement/signal/status', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload),
  });
}

export async function exportToCRM(payload: Record<string, unknown>): Promise<Response> {
  return fetch('/api/engagement/crm-export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload),
  });
}

export async function getCampaignSignals(params: URLSearchParams): Promise<Response> {
  return fetch(`/api/engagement/campaign-signals?${params}`, { credentials: 'include' });
}

export async function getCampaigns(companyId: string): Promise<Response> {
  return fetch(`/api/campaigns/list?companyId=${encodeURIComponent(companyId)}`, { credentials: 'include' });
}
