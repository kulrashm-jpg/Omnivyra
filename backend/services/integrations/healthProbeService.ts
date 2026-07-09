/**
 * Live-check health probe — minimal whoami calls per provider so the
 * SUPER_ADMIN tab can distinguish DEGRADED (5xx) from REAUTH_REQUIRED
 * (401/403) from RATE_LIMITED (429).
 *
 * Scope: this module ONLY classifies. It NEVER refreshes a token, NEVER
 * decrypts credentials beyond what's needed for one call, and never
 * mutates the row outside the canonical state columns:
 *   - connection_state
 *   - last_live_check_at
 *   - last_live_check_status
 *   - last_provider_error
 *
 * Called from the scheduler tick (oauth-refresh BullMQ job). Bounded
 * concurrency, jittered, fail-soft per row.
 */

import { supabase } from '../../db/supabaseClient';
import { logger } from '../logger';
import { getToken } from '../../auth/tokenStore';
import { deriveConnectionState, type ConnectionState } from './connectionState';

const PROBE_CHUNK = 5;
const PROBE_JITTER_MAX_MS = 250;

const PROBE_ENDPOINTS: Record<string, string | null> = {
  linkedin:  'https://api.linkedin.com/v2/userinfo',
  x:         'https://api.twitter.com/2/users/me',
  twitter:   'https://api.twitter.com/2/users/me',
  youtube:   'https://www.googleapis.com/youtube/v3/channels?part=id&mine=true',
  instagram: 'https://graph.facebook.com/v22.0/me?fields=id',
  facebook:  'https://graph.facebook.com/v22.0/me?fields=id',
  reddit:    'https://oauth.reddit.com/api/v1/me',
  pinterest: 'https://api.pinterest.com/v5/user_account',
};

export type LiveCheckStatus = 'ok' | 'unauthorised' | 'forbidden' | 'rate_limited' | 'server_error';

function classifyHttp(status: number): LiveCheckStatus {
  if (status >= 200 && status < 300) return 'ok';
  if (status === 401) return 'unauthorised';
  if (status === 403) return 'forbidden';
  if (status === 429) return 'rate_limited';
  return 'server_error';
}

async function probeOne(platform: string, accessToken: string): Promise<{ status: LiveCheckStatus; httpStatus: number | null; error: string | null }> {
  const url = PROBE_ENDPOINTS[platform];
  if (!url) return { status: 'ok', httpStatus: null, error: null }; // no probe implemented; treat as ok

  // Reddit requires a User-Agent header per their API ToS.
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
  };
  if (platform === 'reddit') headers['User-Agent'] = 'virality/1.0 health-probe';

  try {
    // ssrf-ok: url comes from the fixed PROBE_ENDPOINTS constant table (platform API hosts)
    const res = await fetch(url, { headers });
    return {
      status: classifyHttp(res.status),
      httpStatus: res.status,
      error: res.ok ? null : `http_${res.status}`,
    };
  } catch (err) {
    return {
      status: 'server_error',
      httpStatus: null,
      error: err instanceof Error ? err.message.slice(0, 200) : 'network_error',
    };
  }
}

function jitter(maxMs: number): Promise<void> {
  return new Promise((r) => setTimeout(r, Math.floor(Math.random() * maxMs)));
}

async function chunked<T>(items: ReadonlyArray<T>, size: number, fn: (item: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += size) {
    const chunk = items.slice(i, i + size);
    await Promise.allSettled(chunk.map(fn));
  }
}

export interface HealthProbeSweepSummary {
  attempted: number;
  ok: number;
  unauthorised: number;
  forbidden: number;
  rate_limited: number;
  server_error: number;
  skipped: number;
  states_written: number;
  states_failed: number;
}

/**
 * Probe a bounded sample of healthy-looking social_accounts. We only
 * probe rows in state CONNECTED (or CONNECTED legacy NULL), with a
 * non-null access_token and a future-dated `token_expires_at`. Rows in
 * TOKEN_EXPIRED / PROVIDER_REAUTH_REQUIRED already have an actionable
 * state and don't benefit from another HTTP call.
 *
 * Phase E surfaces the result via /api/super-admin/integration-health.
 */
export async function runHealthProbeSweep(limit = 100): Promise<HealthProbeSweepSummary> {
  const summary: HealthProbeSweepSummary = {
    attempted: 0,
    ok: 0,
    unauthorised: 0,
    forbidden: 0,
    rate_limited: 0,
    server_error: 0,
    skipped: 0,
    states_written: 0,
    states_failed: 0,
  };

  const nowIso = new Date().toISOString();
  const { data: rows, error } = await supabase
    .from('social_accounts')
    .select('id, platform, token_expires_at, refresh_token, refresh_status, connection_state')
    .eq('is_active', true)
    .or(`connection_state.eq.CONNECTED,connection_state.is.null`)
    .gt('token_expires_at', nowIso)
    .order('last_live_check_at', { ascending: true, nullsFirst: true })
    .limit(limit);

  if (error) {
    logger.warn('health_probe_list_failed', { message: error.message });
    return summary;
  }

  const accounts = (rows ?? []) as Array<{
    id: string;
    platform: string;
    token_expires_at: string;
    refresh_token: string | null;
    refresh_status: string | null;
    connection_state: string | null;
  }>;

  await chunked(accounts, PROBE_CHUNK, async (acc) => {
    await jitter(PROBE_JITTER_MAX_MS);
    summary.attempted += 1;

    let tokenObj;
    try {
      tokenObj = await getToken(acc.id);
    } catch (err) {
      summary.skipped += 1;
      logger.warn('health_probe_get_token_failed', {
        accountId: acc.id,
        message: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    if (!tokenObj?.access_token) {
      summary.skipped += 1;
      return;
    }

    const result = await probeOne(acc.platform, tokenObj.access_token);
    summary[result.status] += 1;

    const derived: ConnectionState = deriveConnectionState({
      tokenExpiresAt: acc.token_expires_at ? new Date(acc.token_expires_at) : null,
      isExplicitlyDisconnected: false,
      lastRefreshStatus: (acc.refresh_status as 'success' | 'failed' | 'requires_reconnect' | null) ?? null,
      hasRefreshToken: !!acc.refresh_token,
      hasAccessToken: true,
      lastLiveCheckStatus: result.status,
      lastLiveCheckAt: new Date(),
    });

    const { error: updErr } = await supabase
      .from('social_accounts')
      .update({
        connection_state: derived,
        last_live_check_at: new Date().toISOString(),
        last_live_check_status: result.status,
        last_provider_error: result.error,
        updated_at: new Date().toISOString(),
      })
      .eq('id', acc.id);

    if (updErr) {
      summary.states_failed += 1;
      logger.warn('health_probe_state_write_failed', {
        accountId: acc.id,
        platform: acc.platform,
        message: updErr.message,
      });
    } else {
      summary.states_written += 1;
    }
  });

  return summary;
}
