/**
 * GET  /api/super-admin/integration-audit
 *   Returns a per-integration health summary for every `company_integrations`
 *   row, including the 8-state derived health label and a rollup. Read-only.
 *   Never returns config secrets — the `config` column is excluded from the
 *   query selection. Auth: SUPER_ADMIN_DASHBOARD_VIEW.
 *
 * POST /api/super-admin/integration-audit
 *   Body: { integration_id: string, company_id: string, rediscover?: boolean }
 *   Triggers the existing `runIntegrationHealthCheck` flow (CMS adapter
 *   health probe) for one integration. Updates `last_tested_at` /
 *   `last_error` in the standard write path. Returns the post-check
 *   derived health.
 *
 * No new DB columns, no new tables, no new cron jobs. Surfaces health
 * from columns already present + delegates revalidation to the existing
 * service.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { requireCapability } from '../../../backend/security/requireCapability';
import { SUPER_ADMIN_DASHBOARD_VIEW } from '../../../shared/contracts/security';
import { supabase } from '../../../backend/db/supabaseClient';
import {
  deriveIntegrationHealth,
  rollupHealth,
  type IntegrationHealth,
  type HealthRollup,
} from '../../../backend/services/integrationHealthService';
import { runIntegrationHealthCheckWithRetry } from '../../../backend/services/integrationHealthRetry';
import type { Integration } from '../../../backend/services/integrationService';
import type { IntegrationEventType, IntegrationEventStatus } from '../../../backend/services/integrationEventService';

type AuditRow = {
  id: string;
  company_id: string;
  type: string;
  name: string;
  status: string;
  website_id: string | null;
  website_connection_id: string | null;
  last_tested_at: string | null;
  created_at: string;
  updated_at: string;
  health: IntegrationHealth;
};

type TimelineEvent = {
  id: string;
  integration_id: string;
  provider: string;
  event_type: IntegrationEventType;
  event_status: IntegrationEventStatus;
  message: string | null;
  created_at: string;
};

type AuditGetResponse = {
  status: 'ok';
  rollup: HealthRollup;
  rows: AuditRow[];
  recent_events: TimelineEvent[];
  timeline_table_available: boolean;
};

type AuditPostResponse = {
  status: 'ok';
  health_check: { status: string; message: string };
  health: IntegrationHealth;
};

type ErrorResponse = { status: 'error'; message: string };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<AuditGetResponse | AuditPostResponse | ErrorResponse>,
) {
  const guard = await requireCapability(req, res, {
    capability: SUPER_ADMIN_DASHBOARD_VIEW,
    reason: 'integration-audit',
  });
  if (guard.ok !== true) return;

  if (req.method === 'GET') {
    return handleGet(req, res);
  }
  if (req.method === 'POST') {
    return handlePost(req, res);
  }
  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ status: 'error', message: 'Method not allowed' });
}

async function handleGet(req: NextApiRequest, res: NextApiResponse<AuditGetResponse | ErrorResponse>) {
  // Optional ?company_id filter for tenant-scoped views; absent = all rows.
  const companyId = typeof req.query.company_id === 'string' ? req.query.company_id : null;

  // Explicit column list — `config` and `non_secret_config` are NOT selected
  // because they may contain credentials encoded as non-secret fields by
  // older rows. Health computation needs none of them.
  const cols = 'id, company_id, type, name, status, website_id, website_connection_id, last_tested_at, last_error, created_at, updated_at';
  let query = supabase.from('company_integrations').select(cols).order('updated_at', { ascending: false }).limit(500);
  if (companyId) query = query.eq('company_id', companyId);

  const { data, error } = await query;
  if (error) {
    return res.status(500).json({ status: 'error', message: `query failed: ${error.message}` });
  }

  const integrations = (data ?? []) as Array<Integration>;
  const rows: AuditRow[] = integrations.map((i) => ({
    id: i.id,
    company_id: i.company_id,
    type: i.type,
    name: i.name,
    status: i.status,
    website_id: i.website_id ?? null,
    website_connection_id: i.website_connection_id ?? null,
    last_tested_at: i.last_tested_at,
    created_at: i.created_at,
    updated_at: i.updated_at,
    health: deriveIntegrationHealth(i),
  }));

  const rollup = rollupHealth(rows.map((r) => ({ type: r.type as Integration['type'], health: r.health })));

  // Best-effort timeline read: returns [] when the migration hasn't been
  // applied yet (table_available=false), so the page can render a
  // friendly "timeline migration pending" message instead of breaking.
  let recent_events: TimelineEvent[] = [];
  let timeline_table_available = true;
  try {
    const eventsQuery = supabase
      .from('integration_activity_events')
      .select('id, integration_id, provider, event_type, event_status, message, created_at')
      .order('created_at', { ascending: false })
      .limit(50);
    const { data: events, error: eventsError } = companyId
      ? await eventsQuery.eq('company_id', companyId)
      : await eventsQuery;
    if (eventsError) {
      if (eventsError.code === 'PGRST205' || /could not find the table/i.test(eventsError.message || '')) {
        timeline_table_available = false;
      }
    } else {
      recent_events = (events ?? []) as TimelineEvent[];
    }
  } catch {
    timeline_table_available = false;
  }

  return res.status(200).json({ status: 'ok', rollup, rows, recent_events, timeline_table_available });
}

async function handlePost(req: NextApiRequest, res: NextApiResponse<AuditPostResponse | ErrorResponse>) {
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body ?? {});
  const integrationId = typeof body.integration_id === 'string' ? body.integration_id : '';
  const companyId = typeof body.company_id === 'string' ? body.company_id : '';
  if (!integrationId || !companyId) {
    return res.status(400).json({ status: 'error', message: 'integration_id and company_id are required' });
  }

  // Load the integration row so we can route the health check via its
  // website_connection_id (the existing service is keyed on connection)
  // and pass the integration_id + provider through to the retry wrapper
  // so timeline events are correctly attributed.
  const { data: row, error } = await supabase
    .from('company_integrations')
    .select('id, company_id, type, website_connection_id')
    .eq('id', integrationId)
    .eq('company_id', companyId)
    .maybeSingle();
  if (error || !row) {
    return res.status(404).json({ status: 'error', message: 'integration not found' });
  }
  if (!row.website_connection_id) {
    return res.status(409).json({ status: 'error', message: 'integration has no website_connection — connect a website before validating' });
  }

  // Use the retry-aware wrapper so manual revalidates get the same
  // transient-failure handling + timeline emission as the scheduled
  // sweep. The wrapper never throws; it returns a structured result
  // with `attempts`, `retried`, `retry_attempts_made`.
  const checkResult = await runIntegrationHealthCheckWithRetry({
    companyId,
    connectionId: row.website_connection_id,
    integrationId: row.id,
    provider: row.type,
  });
  const result = { status: checkResult.status, message: checkResult.message };

  // Re-read the post-check state so the response carries the freshly
  // updated `last_tested_at` / `last_error` — they were written by the
  // existing service's update path inside the health check call.
  const { data: refreshed } = await supabase
    .from('company_integrations')
    .select('id, company_id, type, name, status, website_id, website_connection_id, last_tested_at, last_error, created_at, updated_at')
    .eq('id', integrationId)
    .maybeSingle();
  const integration = (refreshed ?? {}) as Integration;
  const health = deriveIntegrationHealth(integration);

  return res.status(200).json({ status: 'ok', health_check: result, health });
}
