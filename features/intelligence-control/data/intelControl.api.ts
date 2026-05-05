// Transport-only thin wrappers around the admin intelligence endpoints.
// Each function returns the raw Response so the caller's existing
// `.ok` / `.json()` / status checks are preserved verbatim.

export async function getSchedulerConfig(): Promise<Response> {
  return fetch('/api/admin/intelligence/scheduler-config');
}

export async function updateSchedulerConfig(payload: Record<string, unknown>): Promise<Response> {
  return fetch('/api/admin/intelligence/scheduler-config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function getSchedulerOverrides(companyId: string): Promise<Response> {
  return fetch(`/api/admin/intelligence/scheduler-overrides?company_id=${encodeURIComponent(companyId)}`);
}

export async function createSchedulerOverride(payload: Record<string, unknown>): Promise<Response> {
  return fetch('/api/admin/intelligence/scheduler-overrides', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function deleteSchedulerOverride(
  payload: { company_id: string; job_type: string },
): Promise<Response> {
  return fetch('/api/admin/intelligence/scheduler-overrides', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function triggerSchedulerBoost(
  payload: { company_id: string; action: 'apply' | 'remove'; duration_hours: number },
): Promise<Response> {
  return fetch('/api/admin/intelligence/scheduler-boost', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function getExecutionInsights(days: number): Promise<Response> {
  return fetch(`/api/admin/intelligence/execution-insights?days=${days}`);
}
