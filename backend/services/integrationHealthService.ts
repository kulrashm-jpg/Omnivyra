import { ownedDbTable } from '../db/writeOwner';
import { getCmsAdapter, isCmsProvider } from './cms/registry';
import { getIntegration, type Integration, type IntegrationType } from './integrationService';
import { updateWebsiteConnection } from './websiteService';

export type IntegrationHealthStatus = 'healthy' | 'warning' | 'degraded' | 'failed' | 'reauth_required';

export async function runIntegrationHealthCheck(input: {
  companyId: string;
  connectionId: string;
}): Promise<{ status: IntegrationHealthStatus; message: string }> {
  const { data: connection, error } = await ownedDbTable('website_connections')
    .select('*, websites!inner(company_id)')
    .eq('id', input.connectionId)
    .maybeSingle();
  if (error || !connection) throw new Error(error?.message || 'Connection not found');
  if ((connection as any).websites?.company_id !== input.companyId) throw new Error('Connection not found');

  const { data: integrationRow } = await ownedDbTable('company_integrations')
    .select('id')
    .eq('company_id', input.companyId)
    .eq('website_connection_id', input.connectionId)
    .maybeSingle();

  let status: IntegrationHealthStatus = 'warning';
  let message = 'No active diagnostic is available for this provider.';
  const diagnostics: Record<string, unknown> = {};

  if (integrationRow?.id) {
    const integration = await getIntegration(String(integrationRow.id), input.companyId);
    if (integration && isCmsProvider(integration.type)) {
      const result = await getCmsAdapter(integration.type).healthCheck({
        provider: integration.type,
        companyId: input.companyId,
        websiteId: integration.website_id,
        connectionId: integration.website_connection_id,
        config: integration.config,
        timeoutMs: 10_000,
      });
      status = result.healthy ? 'healthy' : result.message.toLowerCase().includes('auth') ? 'reauth_required' : 'failed';
      message = result.message;
      diagnostics.provider_response = result.providerResponse ?? null;
    }
  }

  await ownedDbTable('integration_health_checks').insert({
    company_id: input.companyId,
    website_id: connection.website_id,
    connection_id: input.connectionId,
    provider: connection.provider,
    check_type: 'connection_health',
    status,
    message,
    diagnostics,
  });

  await updateWebsiteConnection(input.connectionId, {
    health_status: status as any,
    last_error: status === 'healthy' ? null : message,
    last_sync_at: new Date().toISOString(),
  });

  return { status, message };
}

// ─── Derived 8-state health (Phase 13) ──────────────────────────────────────
//
// This block is a PURE DERIVATION layer on top of the existing
// company_integrations row shape — no new columns, no new tables, no
// background workers. The 8-state label is computed at read time from
// columns that already exist (`status`, `last_tested_at`, `last_error`,
// `updated_at`). Persisting `last_success_at` / `last_failure_at` /
// `retry_count` separately would require a migration on a hot prod
// table; deferred.

export type IntegrationHealthState =
  | 'healthy'
  | 'degraded'
  | 'disconnected'
  | 'invalid_credentials'
  | 'quota_limited'
  | 'permission_lost'
  | 'validation_failed'
  | 'retrying';

export interface IntegrationHealth {
  state: IntegrationHealthState;
  score: number; // 0–100; 100 = fresh + connected, 0 = broken
  last_success_at: string | null;
  last_failure_at: string | null;
  last_validation_at: string | null;
  last_error_code: string | null;
  last_error_message: string | null;
  retry_count: number;
  age_hours: number | null;
  reasons: string[];
}

const STALE_THRESHOLD_HOURS = 24;
const STALE_DEGRADE_THRESHOLD_HOURS = 72;

const ERROR_FINGERPRINTS: Array<{ test: RegExp; state: IntegrationHealthState; code: string }> = [
  { test: /invalid_grant|refresh.?token|token.?expired|unauthorized_client|401\b/i, state: 'invalid_credentials', code: 'INVALID_CREDENTIALS' },
  { test: /quota|rate.?limit|429\b|usageLimit/i,                                    state: 'quota_limited',       code: 'QUOTA_LIMITED' },
  { test: /forbidden|permission|insufficient.?scope|403\b/i,                        state: 'permission_lost',     code: 'PERMISSION_LOST' },
  { test: /HTTPS_REQUIRED|wp-admin|REST API|REST_DISABLED/i,                        state: 'validation_failed',   code: 'WORDPRESS_REST_BROKEN' },
  { test: /ENOTFOUND|ECONNREFUSED|ETIMEDOUT|fetch failed|network/i,                 state: 'degraded',            code: 'NETWORK_TRANSIENT' },
];

function hoursSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return (Date.now() - t) / (1000 * 60 * 60);
}

function classifyError(message: string | null): { state: IntegrationHealthState; code: string } | null {
  if (!message) return null;
  for (const fp of ERROR_FINGERPRINTS) {
    if (fp.test.test(message)) return { state: fp.state, code: fp.code };
  }
  return null;
}

/**
 * Derive the canonical health view from an existing integration row.
 * Pure function — no I/O. The 8-state label is computed from `status`,
 * `last_tested_at`, `last_error` only.
 *
 * `last_success_at` / `last_failure_at` are INFERRED from `last_tested_at`
 * via the current status. A "true" implementation would persist them
 * separately; the inference is correct in the common case where the
 * status hasn't flipped since the last validation.
 */
export function deriveIntegrationHealth(integration: Integration): IntegrationHealth {
  const reasons: string[] = [];
  const lastTestedAt = integration.last_tested_at;
  const lastError = integration.last_error;
  const ageHours = hoursSince(lastTestedAt);

  const lastSuccessAt = integration.status === 'connected' ? lastTestedAt : null;
  const lastFailureAt = integration.status === 'failed' ? lastTestedAt : null;

  const errClassified = classifyError(lastError);
  const errorCode = errClassified?.code ?? (lastError ? 'UNCLASSIFIED' : null);

  let state: IntegrationHealthState;

  if (integration.status === 'pending') {
    state = 'retrying';
    reasons.push('Pending — never tested or validation in flight');
  } else if (integration.status === 'failed') {
    state = errClassified?.state ?? 'validation_failed';
    if (errClassified) reasons.push(`Failure fingerprint: ${errClassified.code}`);
    else if (lastError) reasons.push(`Last error: ${lastError.slice(0, 120)}`);
    else reasons.push('Status is failed but no error message was recorded');
  } else if (integration.status === 'connected') {
    if (ageHours === null) {
      state = 'degraded';
      reasons.push('Connected but never validated against the provider');
    } else if (ageHours > STALE_DEGRADE_THRESHOLD_HOURS) {
      state = 'degraded';
      reasons.push(`Last validated ${Math.round(ageHours)}h ago — past the ${STALE_DEGRADE_THRESHOLD_HOURS}h degrade threshold`);
    } else if (ageHours > STALE_THRESHOLD_HOURS) {
      state = 'healthy';
      reasons.push(`Last validated ${Math.round(ageHours)}h ago — stale but below degrade threshold`);
    } else {
      state = 'healthy';
    }
  } else {
    state = 'disconnected';
    reasons.push(`Unknown status: ${integration.status}`);
  }

  let score: number;
  switch (state) {
    case 'healthy':
      if (ageHours === null) score = 70;
      else if (ageHours <= STALE_THRESHOLD_HOURS) score = 100;
      else score = 60;
      break;
    case 'retrying':           score = 50; break;
    case 'degraded':           score = 35; break;
    case 'quota_limited':      score = 25; break;
    case 'permission_lost':    score = 10; break;
    case 'invalid_credentials':score = 5;  break;
    case 'validation_failed':  score = 5;  break;
    case 'disconnected':
    default:                   score = 0;  break;
  }

  return {
    state,
    score,
    last_success_at: lastSuccessAt,
    last_failure_at: lastFailureAt,
    last_validation_at: lastTestedAt,
    last_error_code: errorCode,
    last_error_message: lastError ? lastError.slice(0, 240) : null,
    retry_count: 0, // No persistence column — always 0 until a retry-count migration lands
    age_hours: ageHours,
    reasons,
  };
}

export interface HealthRollup {
  total: number;
  by_state: Record<IntegrationHealthState, number>;
  by_type: Record<string, { total: number; healthy: number; broken: number }>;
}

export function rollupHealth(items: Array<{ type: IntegrationType; health: IntegrationHealth }>): HealthRollup {
  const by_state: Record<IntegrationHealthState, number> = {
    healthy: 0, degraded: 0, disconnected: 0, invalid_credentials: 0,
    quota_limited: 0, permission_lost: 0, validation_failed: 0, retrying: 0,
  };
  const by_type: Record<string, { total: number; healthy: number; broken: number }> = {};
  for (const i of items) {
    by_state[i.health.state] += 1;
    const t = by_type[i.type] ?? { total: 0, healthy: 0, broken: 0 };
    t.total += 1;
    if (i.health.state === 'healthy') t.healthy += 1;
    if (i.health.score < 20) t.broken += 1;
    by_type[i.type] = t;
  }
  return { total: items.length, by_state, by_type };
}

// ─── End derived 8-state health ─────────────────────────────────────────────

export async function getWebsiteHealthSummary(companyId: string, websiteId: string): Promise<Record<string, unknown>> {
  const { data: connections } = await ownedDbTable('website_connections')
    .select('id, provider, status, health_status, last_error, last_sync_at')
    .eq('website_id', websiteId)
    .is('deleted_at', null);
  const { data: latestEvents } = await ownedDbTable('tracking_events')
    .select('created_at')
    .eq('company_id', companyId)
    .eq('website_id', websiteId)
    .order('created_at', { ascending: false })
    .limit(1);
  const { data: failedJobs } = await ownedDbTable('publishing_jobs')
    .select('id')
    .eq('company_id', companyId)
    .eq('website_id', websiteId)
    .in('status', ['failed', 'dead_letter'])
    .limit(10);

  return {
    connections: connections ?? [],
    tracking_last_seen_at: latestEvents?.[0]?.created_at ?? null,
    failed_publish_count: failedJobs?.length ?? 0,
  };
}
