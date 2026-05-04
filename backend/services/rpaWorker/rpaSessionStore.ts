import fs from 'fs/promises';
import path from 'path';
import { createServiceRoleMigrationProxy } from '../../db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');

/**
 * RPA session storage. Playwright's `storageState` is a JSON blob holding
 * cookies + localStorage for a domain. We persist one blob per
 * (organization_id, platform).
 *
 * Storage resolution, in order:
 *   1. `rpa_sessions` DB table (authoritative, survives worker restart,
 *      shared across workers)
 *   2. Local filesystem at $RPA_SESSION_DIR || tmp/rpa-sessions (legacy
 *      seed / ops-only path; retained as a fallback)
 *
 * A worker that cannot resolve either source refuses the task with a
 * clean RPA_NO_SESSION error rather than attempting an unauthenticated run.
 */

export type PlaywrightStorageState = {
  cookies?: Array<Record<string, unknown>>;
  origins?: Array<Record<string, unknown>>;
};

export type RpaSessionMetadata = {
  account_tier?: string | null;
  last_login_at?: string | null;
  expires_at?: string | null;
  last_verified_at?: string | null;
};

function sessionDir(): string {
  return process.env.RPA_SESSION_DIR || path.join(process.cwd(), 'tmp', 'rpa-sessions');
}

function sessionPath(organizationId: string, platform: string): string {
  const safeOrg = organizationId.replace(/[^a-zA-Z0-9-]/g, '_');
  const safePlatform = platform.replace(/[^a-zA-Z0-9-]/g, '_');
  return path.join(sessionDir(), `${safeOrg}__${safePlatform}.json`);
}

async function loadFromDb(
  organizationId: string,
  platform: string,
): Promise<PlaywrightStorageState | null> {
  try {
    const { data, error } = await supabase
      .from('rpa_sessions')
      .select('storage_state, expires_at')
      .eq('organization_id', organizationId)
      .eq('platform', platform.toLowerCase())
      .maybeSingle();
    if (error || !data) return null;
    if (data.expires_at && new Date(data.expires_at).getTime() < Date.now()) {
      return null;
    }
    return (data.storage_state as PlaywrightStorageState) ?? null;
  } catch {
    return null;
  }
}

async function loadFromFs(
  organizationId: string,
  platform: string,
): Promise<PlaywrightStorageState | null> {
  const file = sessionPath(organizationId, platform.toLowerCase());
  try {
    const raw = await fs.readFile(file, 'utf8');
    return JSON.parse(raw) as PlaywrightStorageState;
  } catch {
    return null;
  }
}

export async function loadRpaSession(
  organizationId: string,
  platform: string,
): Promise<PlaywrightStorageState | null> {
  const fromDb = await loadFromDb(organizationId, platform);
  if (fromDb) return fromDb;
  return loadFromFs(organizationId, platform);
}

/**
 * Persist a storageState to BOTH the DB (canonical) and local fs (legacy
 * fallback). Upserts on (organization_id, platform).
 */
export async function saveRpaSession(
  organizationId: string,
  platform: string,
  state: PlaywrightStorageState,
  metadata?: RpaSessionMetadata,
): Promise<void> {
  const platformLc = platform.toLowerCase();
  const now = new Date().toISOString();

  // DB (canonical)
  try {
    await supabase.from('rpa_sessions').upsert(
      {
        organization_id: organizationId,
        platform: platformLc,
        storage_state: state,
        account_tier: metadata?.account_tier ?? null,
        last_login_at: metadata?.last_login_at ?? now,
        expires_at: metadata?.expires_at ?? null,
        last_verified_at: metadata?.last_verified_at ?? now,
        updated_at: now,
      },
      { onConflict: 'organization_id,platform' },
    );
  } catch (err: any) {
    console.warn('[rpaSessionStore] DB upsert failed, falling back to fs only:', err?.message || err);
  }

  // Local fs (best-effort fallback)
  try {
    const file = sessionPath(organizationId, platformLc);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(state), 'utf8');
  } catch (err: any) {
    console.warn('[rpaSessionStore] fs write failed:', err?.message || err);
  }
}

/**
 * Lightweight account-tier lookup used by the dispatch layer (Instagram
 * business-only check). Returns null when no session is registered; the
 * caller should treat null as "unknown" rather than "consumer".
 */
export async function getRpaAccountTier(
  organizationId: string,
  platform: string,
): Promise<string | null> {
  try {
    const { data } = await supabase
      .from('rpa_sessions')
      .select('account_tier')
      .eq('organization_id', organizationId)
      .eq('platform', platform.toLowerCase())
      .maybeSingle();
    return (data?.account_tier as string | null) ?? null;
  } catch {
    return null;
  }
}

/**
 * Purge a session (e.g. on revoke or on auth failure). Removes the DB
 * row and the fs artifact.
 */
export async function deleteRpaSession(
  organizationId: string,
  platform: string,
): Promise<void> {
  const platformLc = platform.toLowerCase();
  try {
    await supabase
      .from('rpa_sessions')
      .delete()
      .eq('organization_id', organizationId)
      .eq('platform', platformLc);
  } catch { /* swallow */ }
  try {
    await fs.unlink(sessionPath(organizationId, platformLc));
  } catch { /* swallow — missing file is fine */ }
}
