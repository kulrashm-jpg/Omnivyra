import { apiFetch } from '@/lib/apiFetch';

// ─── Integrations CRUD ───────────────────────────────────────────────────────

export type IntegrationCreatePayload = {
  company_id: string;
  type: 'lead_webhook' | 'wordpress' | 'custom_blog_api';
  name: string;
  config: Record<string, string>;
};

export type IntegrationUpdatePayload = {
  company_id: string;
  name: string;
  config: Record<string, string>;
};

export async function getIntegrations(companyId: string): Promise<Response> {
  return fetch(`/api/integrations?company_id=${encodeURIComponent(companyId)}`, {
    credentials: 'include',
  });
}

export async function createIntegration(payload: IntegrationCreatePayload): Promise<Response> {
  return fetch('/api/integrations', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function updateIntegration(
  id: string,
  companyId: string,
  payload: IntegrationUpdatePayload,
): Promise<Response> {
  return fetch(`/api/integrations/${id}?company_id=${encodeURIComponent(companyId)}`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function deleteIntegration(id: string, companyId: string): Promise<Response> {
  return fetch(`/api/integrations/${id}?company_id=${encodeURIComponent(companyId)}`, {
    method: 'DELETE',
    credentials: 'include',
  });
}

export async function testIntegration(id: string, companyId: string): Promise<Response> {
  return fetch(`/api/integrations/${id}/test`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ company_id: companyId }),
  });
}

// ─── Google Analytics ────────────────────────────────────────────────────────

export async function getGAStatus(companyId: string): Promise<Response> {
  return apiFetch(`/api/analytics/status?companyId=${encodeURIComponent(companyId)}`);
}

// Same endpoint as getGAStatus; kept as a separate function so the polling
// call-site reads as polling intent rather than initial-load intent.
export async function pollGAStatus(companyId: string): Promise<Response> {
  return apiFetch(`/api/analytics/status?companyId=${encodeURIComponent(companyId)}`);
}

export async function connectGoogleAnalytics(
  companyId: string,
  returnTo: string,
): Promise<Response> {
  return apiFetch('/api/analytics/connect/google', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ companyId, returnTo }),
  });
}

export async function forceSyncGA(companyId: string): Promise<Response> {
  return apiFetch('/api/analytics/force-sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ companyId }),
  });
}

export async function selectGAProperty(
  companyId: string,
  propertyId: string,
): Promise<Response> {
  return apiFetch('/api/analytics/select-property', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ companyId, propertyId }),
  });
}

// ─── Tracking helper ─────────────────────────────────────────────────────────

export type TrackingAssistPayload = {
  website_url: string;
  platform: string;
};

export async function trackingAssist(payload: TrackingAssistPayload): Promise<Response> {
  return fetch('/api/analytics/tracking-assist', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}
