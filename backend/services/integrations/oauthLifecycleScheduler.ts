/**
 * OAuth Lifecycle Scheduler — central orchestrator.
 *
 * One entry point (`runOAuthLifecycleSweep`) performs the entire
 * autonomous-OAuth tick:
 *
 *   1. Refresh tokens that are within REFRESH_BUFFER_MS of expiry
 *      across social_accounts, analytics_integrations, and (best-effort)
 *      meta_oauth_connections.
 *   2. Run a light live-check whoami probe on a bounded subset of
 *      healthy connections so connection_state can transition to
 *      LIVE_VERIFIED / DEGRADED / PROVIDER_REAUTH_REQUIRED.
 *   3. Persist the resulting state via the canonical state-derivation
 *      helper into `connection_state` / `last_live_check_at` /
 *      `last_live_check_status` / `last_provider_error`.
 *
 * Concurrency: bounded by CHUNK_SIZE; per-platform refreshes guarded by
 * the existing in-process locks in tokenRefresh.ts (X has refreshLock;
 * others are protected by chunked Promise.all in this orchestrator + a
 * jitter window to spread provider load).
 *
 * Persistence safety: the `connection_state` and `last_live_check_*`
 * columns added in 20260625_integration_connection_state.sql are written
 * via Supabase JS. If the migration hasn't been applied yet, the writes
 * fail per-row with a column-not-found error which is logged but does
 * not stop the sweep — the refresh logic still works because it uses
 * existing columns (token_expires_at, refresh_status). This makes
 * deployment order forgiving: code can ship before migration without
 * breaking the cron.
 */

import { supabase } from '../../db/supabaseClient';
import {
  refreshAllExpiringSocialAccounts,
  REFRESH_BUFFER_MS,
} from '../../auth/tokenRefresh';
import {
  getValidAccessTokenForIntegration,
} from '../analyticsIntegrationService';
import { logger } from '../logger';
import {
  deriveConnectionState,
  type ConnectionState,
} from './connectionState';
import { runHealthProbeSweep } from './healthProbeService';

const CHUNK_SIZE = 5;
const PROBE_JITTER_MAX_MS = 200;

export interface OAuthLifecycleSweepSummary {
  social: { companies: number; checked: number; refreshed: number; skipped: number; errors: number };
  ga4:    { integrationsChecked: number; refreshed: number; failed: number };
  meta:   { connectionsChecked: number; extended: number; failed: number };
  states: { written: number; failed: number };
  probes: { attempted: number; ok: number; failed: number };
  durationMs: number;
}

function jitter(maxMs: number): Promise<void> {
  return new Promise((r) => setTimeout(r, Math.floor(Math.random() * maxMs)));
}

async function chunkedAll<T, R>(
  items: ReadonlyArray<T>,
  size: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    const chunk = items.slice(i, i + size);
    const settled = await Promise.allSettled(chunk.map(fn));
    for (const r of settled) {
      if (r.status === 'fulfilled') out.push(r.value);
    }
  }
  return out;
}

/**
 * Best-effort write to the canonical state columns. Tolerant of the case
 * where the migration hasn't been applied yet — logs and skips.
 */
async function writeAnalyticsIntegrationState(
  integrationId: string,
  state: ConnectionState,
  liveCheck?: { at: Date; status: string; error?: string | null },
): Promise<boolean> {
  const payload: Record<string, unknown> = {
    connection_state: state,
    updated_at: new Date().toISOString(),
  };
  if (liveCheck) {
    payload.last_live_check_at = liveCheck.at.toISOString();
    payload.last_live_check_status = liveCheck.status;
    if (liveCheck.error !== undefined) payload.last_provider_error = liveCheck.error;
  }
  const { error } = await supabase
    .from('analytics_integrations')
    .update(payload)
    .eq('id', integrationId);
  if (error) {
    logger.warn('oauth_lifecycle_state_write_failed', {
      table: 'analytics_integrations',
      integrationId,
      message: error.message,
    });
    return false;
  }
  return true;
}

async function writeSocialAccountState(
  accountId: string,
  state: ConnectionState,
  liveCheck?: { at: Date; status: string; error?: string | null },
): Promise<boolean> {
  const payload: Record<string, unknown> = {
    connection_state: state,
    updated_at: new Date().toISOString(),
  };
  if (liveCheck) {
    payload.last_live_check_at = liveCheck.at.toISOString();
    payload.last_live_check_status = liveCheck.status;
    if (liveCheck.error !== undefined) payload.last_provider_error = liveCheck.error;
  }
  const { error } = await supabase
    .from('social_accounts')
    .update(payload)
    .eq('id', accountId);
  if (error) {
    logger.warn('oauth_lifecycle_state_write_failed', {
      table: 'social_accounts',
      accountId,
      message: error.message,
    });
    return false;
  }
  return true;
}

// ── GA4 sweep ───────────────────────────────────────────────────────────────

async function sweepGa4Integrations(summary: OAuthLifecycleSweepSummary): Promise<void> {
  const { data: rows, error } = await supabase
    .from('analytics_integrations')
    .select('id, company_id, status')
    .neq('status', 'disconnected');

  if (error) {
    logger.warn('oauth_lifecycle_ga4_list_failed', { message: error.message });
    return;
  }

  const integrations = (rows ?? []) as Array<{ id: string; company_id: string; status: string }>;
  summary.ga4.integrationsChecked = integrations.length;

  await chunkedAll(integrations, CHUNK_SIZE, async (row) => {
    await jitter(PROBE_JITTER_MAX_MS);
    try {
      // getValidAccessTokenForIntegration refreshes on expiry. We call it
      // unconditionally here — the helper's own expiry buffer (5 min) is
      // the cheap path; the helper short-circuits if the token is fresh.
      const token = await getValidAccessTokenForIntegration(row.id);
      if (token) {
        summary.ga4.refreshed += 1;
        if (await writeAnalyticsIntegrationState(row.id, 'CONNECTED')) summary.states.written += 1;
        else summary.states.failed += 1;
      } else {
        summary.ga4.failed += 1;
        if (await writeAnalyticsIntegrationState(row.id, 'PROVIDER_REAUTH_REQUIRED')) summary.states.written += 1;
        else summary.states.failed += 1;
      }
    } catch (err: unknown) {
      summary.ga4.failed += 1;
      const message = err instanceof Error ? err.message : String(err);
      // invalid_grant from Google → unrecoverable. Otherwise treat as
      // transient and stay at TOKEN_EXPIRED so the next tick retries.
      const reauth = /invalid[_ ]grant|invalid[_ ]token|unauthorized/i.test(message);
      const nextState: ConnectionState = reauth ? 'PROVIDER_REAUTH_REQUIRED' : 'TOKEN_EXPIRED';
      if (await writeAnalyticsIntegrationState(row.id, nextState, {
        at: new Date(),
        status: reauth ? 'unauthorised' : 'server_error',
        error: message.slice(0, 200),
      })) summary.states.written += 1;
      else summary.states.failed += 1;
    }
  });
}

// ── Meta long-lived extension (best-effort, stub) ──────────────────────────
//
// The full implementation of fb_exchange_token extension is deliberately
// scoped out of this turn (Phase F territory). For now we mark Meta rows
// whose token is within REFRESH_BUFFER_MS of expiry as
// TOKEN_REFRESH_REQUIRED so the SUPER_ADMIN tab surfaces them — and any
// row already past expiry as PROVIDER_REAUTH_REQUIRED (cannot recover
// without explicit re-consent). This produces accurate visibility now,
// and the extension service can plug in here later without changing the
// state writes.
async function sweepMetaConnections(summary: OAuthLifecycleSweepSummary): Promise<void> {
  const cutoff = new Date(Date.now() + REFRESH_BUFFER_MS).toISOString();
  const { data: rows, error } = await supabase
    .from('meta_oauth_connections')
    .select('id, token_expires_at, refresh_failed_at')
    .lt('token_expires_at', cutoff);

  if (error) {
    logger.warn('oauth_lifecycle_meta_list_failed', { message: error.message });
    return;
  }

  const conns = (rows ?? []) as Array<{ id: string; token_expires_at: string; refresh_failed_at: string | null }>;
  summary.meta.connectionsChecked = conns.length;

  const now = Date.now();
  await chunkedAll(conns, CHUNK_SIZE, async (row) => {
    const expMs = new Date(row.token_expires_at).getTime();
    const nextState: ConnectionState = expMs <= now
      ? 'PROVIDER_REAUTH_REQUIRED'
      : 'TOKEN_REFRESH_REQUIRED';
    const { error: updErr } = await supabase
      .from('meta_oauth_connections')
      .update({ connection_state: nextState, updated_at: new Date().toISOString() })
      .eq('id', row.id);
    if (updErr) {
      summary.meta.failed += 1;
      summary.states.failed += 1;
      logger.warn('oauth_lifecycle_meta_state_write_failed', {
        connectionId: row.id,
        message: updErr.message,
      });
    } else {
      summary.states.written += 1;
      if (nextState === 'TOKEN_REFRESH_REQUIRED') summary.meta.extended += 1;
    }
  });
}

// ── Public sweep entry point ───────────────────────────────────────────────

export async function runOAuthLifecycleSweep(): Promise<OAuthLifecycleSweepSummary> {
  const t0 = Date.now();
  const summary: OAuthLifecycleSweepSummary = {
    social: { companies: 0, checked: 0, refreshed: 0, skipped: 0, errors: 0 },
    ga4:    { integrationsChecked: 0, refreshed: 0, failed: 0 },
    meta:   { connectionsChecked: 0, extended: 0, failed: 0 },
    states: { written: 0, failed: 0 },
    probes: { attempted: 0, ok: 0, failed: 0 },
    durationMs: 0,
  };

  // (1) Social refresh sweep — delegates to the existing per-platform
  // refresh helpers in tokenRefresh.ts. The X path is lock-guarded; we
  // accept that the other providers have weaker concurrency guarantees
  // until a follow-up landing of a per-account advisory lock.
  try {
    const social = await refreshAllExpiringSocialAccounts(REFRESH_BUFFER_MS);
    summary.social = { ...social };
  } catch (err: unknown) {
    logger.warn('oauth_lifecycle_social_sweep_failed', {
      message: err instanceof Error ? err.message : String(err),
    });
  }

  // (2) GA4 sweep. Wrapped so a Supabase-layer throw can't cascade-abort
  // subsequent sections — the "one provider failure must never abort the
  // sweep" invariant.
  try {
    await sweepGa4Integrations(summary);
  } catch (err: unknown) {
    logger.warn('oauth_lifecycle_ga4_sweep_failed', {
      message: err instanceof Error ? err.message : String(err),
    });
  }

  // (3) Meta long-lived classification. Same fail-soft wrapper.
  try {
    await sweepMetaConnections(summary);
  } catch (err: unknown) {
    logger.warn('oauth_lifecycle_meta_sweep_failed', {
      message: err instanceof Error ? err.message : String(err),
    });
  }

  // (4) Social-account state writes (CONNECTED / TOKEN_EXPIRED /
  // PROVIDER_REAUTH_REQUIRED) using deriveConnectionState. Only writes
  // rows whose state has actually changed since the last sweep.
  try {
    const { data: rows } = await supabase
      .from('social_accounts')
      .select('id, is_active, token_expires_at, refresh_token, access_token, refresh_status, connection_state')
      .eq('is_active', true);
    const accounts = (rows ?? []) as Array<{
      id: string;
      is_active: boolean;
      token_expires_at: string | null;
      refresh_token: string | null;
      access_token: string | null;
      refresh_status: string | null;
      connection_state: string | null;
    }>;
    for (const acc of accounts) {
      const derived = deriveConnectionState({
        tokenExpiresAt: acc.token_expires_at ? new Date(acc.token_expires_at) : null,
        isExplicitlyDisconnected: !acc.is_active,
        lastRefreshStatus: (acc.refresh_status as 'success' | 'failed' | 'requires_reconnect' | null) ?? null,
        hasRefreshToken: !!acc.refresh_token,
        hasAccessToken: !!acc.access_token,
      });
      if (derived !== acc.connection_state) {
        if (await writeSocialAccountState(acc.id, derived)) summary.states.written += 1;
        else summary.states.failed += 1;
      }
    }
  } catch (err: unknown) {
    logger.warn('oauth_lifecycle_social_state_sweep_failed', {
      message: err instanceof Error ? err.message : String(err),
    });
  }

  // (5) Health probe — bounded live whoami calls on the longest-stale
  // healthy connections. Distinguishes DEGRADED / RATE_LIMITED /
  // PROVIDER_REAUTH_REQUIRED so the SUPER_ADMIN tab can show truthful
  // statuses without waiting for a request-path failure to surface them.
  try {
    const probe = await runHealthProbeSweep();
    summary.probes.attempted = probe.attempted;
    summary.probes.ok = probe.ok;
    summary.probes.failed = probe.attempted - probe.ok;
    summary.states.written += probe.states_written;
    summary.states.failed += probe.states_failed;
  } catch (err: unknown) {
    logger.warn('oauth_lifecycle_probe_sweep_failed', {
      message: err instanceof Error ? err.message : String(err),
    });
  }

  summary.durationMs = Date.now() - t0;
  return summary;
}
