/**
 * Integration activity timeline writer.
 *
 * Append-only emit helper for the `integration_activity_events` table
 * introduced by migration 20260805_integration_activity_events.sql.
 *
 * Fail-soft by design: if the migration has not been applied yet (the
 * table is missing), every write silently no-ops. Callers do NOT have
 * to wrap calls in try/catch; this prevents an unapplied-migration
 * window from breaking the OAuth flows we wired the emit into.
 *
 * Secrets policy: callers MUST NOT pass tokens, refresh tokens, OAuth
 * codes, or client secrets in `metadata`. We scrub a known-list at the
 * boundary as belt-and-suspenders.
 */

import { supabase } from '../db/supabaseClient';

export type IntegrationEventType =
  | 'connected'
  | 'validated'
  | 'refreshed'
  | 'published'
  | 'synced'
  | 'failed'
  | 'recovered'
  | 'disconnected'
  | 'retry_started'
  | 'retry_succeeded'
  | 'retry_failed';

export type IntegrationEventStatus = 'info' | 'success' | 'warning' | 'error';

export interface IntegrationEventInput {
  integration_id: string;
  company_id: string;
  provider: string;
  event_type: IntegrationEventType;
  event_status?: IntegrationEventStatus;
  message?: string | null;
  metadata?: Record<string, unknown> | null;
}

const SECRET_KEY_DENYLIST = new Set([
  'access_token', 'refresh_token', 'token', 'code', 'state',
  'client_secret', 'app_password', 'api_key', 'bearer_token',
  'admin_api_key', 'service_role_key', 'session_cookie',
]);

const MISSING_TABLE_CODE = 'PGRST205';

let _tableMissing = false; // process-local memo; cheap to re-flip when migration lands

function sanitizeMetadata(meta: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!meta) return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (SECRET_KEY_DENYLIST.has(k.toLowerCase())) continue;
    if (typeof v === 'string' && v.length > 1000) {
      out[k] = v.slice(0, 1000) + '…';
    } else {
      out[k] = v;
    }
  }
  return out;
}

/**
 * Append one event to the timeline. Never throws. Never blocks. Safe
 * to call from any hot path (OAuth callback, health check, retry).
 */
export async function emitIntegrationEvent(input: IntegrationEventInput): Promise<void> {
  if (_tableMissing) return; // process already learned the migration isn't applied; stop hitting PostgREST

  try {
    const payload = {
      integration_id: input.integration_id,
      company_id: input.company_id,
      provider: input.provider,
      event_type: input.event_type,
      event_status: input.event_status ?? 'info',
      message: input.message ? input.message.slice(0, 500) : null,
      metadata: sanitizeMetadata(input.metadata ?? null),
    };
    const { error } = await supabase.from('integration_activity_events').insert(payload);
    if (error) {
      if (error.code === MISSING_TABLE_CODE || /could not find the table/i.test(error.message || '')) {
        // Migration not applied yet — flip the memo so subsequent calls in
        // this process don't repeatedly probe a non-existent table.
        _tableMissing = true;
        return;
      }
      // Any other error: log + continue. Telemetry must never break the
      // caller's flow.
      console.warn('[integration-event] write failed', error.message);
    }
  } catch (err) {
    // Defensive — supabase client should never throw, but if it does
    // we still must not break the caller.
    console.warn('[integration-event] threw', err instanceof Error ? err.message : String(err));
  }
}

/**
 * Read the most-recent N events for one integration. Used by the
 * oauth-health page's per-integration drawer. Returns [] if the table
 * doesn't exist yet — same fail-soft semantics as the writer.
 */
export async function recentIntegrationEvents(
  integrationId: string,
  limit = 25,
): Promise<Array<{
  id: string;
  event_type: IntegrationEventType;
  event_status: IntegrationEventStatus;
  message: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}>> {
  if (_tableMissing) return [];
  try {
    const { data, error } = await supabase
      .from('integration_activity_events')
      .select('id, event_type, event_status, message, metadata, created_at')
      .eq('integration_id', integrationId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) {
      if (error.code === MISSING_TABLE_CODE || /could not find the table/i.test(error.message || '')) {
        _tableMissing = true;
        return [];
      }
      return [];
    }
    return (data ?? []) as Awaited<ReturnType<typeof recentIntegrationEvents>>;
  } catch {
    return [];
  }
}

/**
 * Read recent events tenant-wide, optionally filtered to failure-class
 * events. Drives the oauth-health page's "recent integration activity"
 * panel.
 */
export async function recentIntegrationEventsForCompany(
  companyId: string,
  opts: { limit?: number; onlyFailures?: boolean } = {},
): Promise<Array<{
  id: string;
  integration_id: string;
  provider: string;
  event_type: IntegrationEventType;
  event_status: IntegrationEventStatus;
  message: string | null;
  created_at: string;
}>> {
  if (_tableMissing) return [];
  try {
    let query = supabase
      .from('integration_activity_events')
      .select('id, integration_id, provider, event_type, event_status, message, created_at')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(opts.limit ?? 50);
    if (opts.onlyFailures) {
      query = query.in('event_status', ['warning', 'error']);
    }
    const { data, error } = await query;
    if (error) {
      if (error.code === MISSING_TABLE_CODE || /could not find the table/i.test(error.message || '')) {
        _tableMissing = true;
        return [];
      }
      return [];
    }
    return (data ?? []) as Awaited<ReturnType<typeof recentIntegrationEventsForCompany>>;
  } catch {
    return [];
  }
}
