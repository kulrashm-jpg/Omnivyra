/**
 * Super Admin — Google PageSpeed Insights provider configuration.
 *
 * One application-level key shared by every tenant's report jobs (PageSpeed measures public pages,
 * so tenants never supply a Google key). Stored with the EXISTING encrypted credential mechanism:
 *
 *   external_api_sources  row "Google PageSpeed Insights" (platform, company_id null)
 *                         is_active      = enabled / disabled for report jobs
 *                         required_metadata.pagespeed_last_check = last admin check (non-secret)
 *                         category 'others', not whitelisted, is_enabled_global false → never
 *                         picked up by the external-API / trend executors.
 *   api_provider_accounts one account; credentials_encrypted via buildCredentialEnvelope
 *                         (AES-256-GCM api_key_value). Read only by providerCredentialResolver.
 *
 * Nothing here returns, logs or echoes the key: the summary says only whether one is stored and
 * where the runtime resolves it from.
 */
import { ownedDbTable } from '../db/writeOwner';
import { supabase } from '../db/supabaseClient';
import { PAGESPEED_SOURCE_NAME, resolveProviderCredential } from './providerCredentialResolver';
import { buildCredentialEnvelope, createProviderAccount, getActiveAccountForApi, resolveAccountCredentials, updateProviderAccount, type ProviderAccount } from './providerAccountService';
import { invalidatePageSpeedAccess, PAGESPEED_ISSUE_TEXT, pageSpeedFailure, runPageSpeed, type PageSpeedIssue } from './pageSpeedClient';
import { updateApiHealth } from './externalApiHealthService';

export const PAGESPEED_ENV_NAME = 'PAGESPEED_API_KEY';
/** A stable public page Google can always measure; the check never sends a tenant URL. */
export const PAGESPEED_CHECK_URL = 'https://developers.google.com/speed/docs/insights/v5/about';

export type PageSpeedLastCheck = { ok: boolean; issue: PageSpeedIssue | null; detail: string; at: string; keySource: string };

export type PageSpeedConfigSummary = {
  provider: 'google_pagespeed';
  /** Super Admin toggle. True when no row exists yet (the environment fallback is then in force). */
  enabled: boolean;
  /** A key resolves right now (Super Admin, else environment). */
  configured: boolean;
  keySource: 'super_admin' | 'environment' | 'none';
  hasStoredKey: boolean;
  /** Masked display only — never a fragment of the key. */
  keyDisplay: string | null;
  envFallback: { name: string; present: boolean };
  keylessEnabled: boolean;
  status: 'active' | 'disabled' | 'not_configured' | 'error';
  /** What report jobs will do, in one sentence. */
  statusDetail: string;
  lastCheck: PageSpeedLastCheck | null;
};

type SourceRow = { id: string; is_active: boolean | null; required_metadata: Record<string, unknown> | null };

async function findSource(): Promise<SourceRow | null> {
  const { data } = await supabase.from('external_api_sources').select('id, is_active, required_metadata')
    .eq('name', PAGESPEED_SOURCE_NAME).is('company_id', null).limit(1).maybeSingle();
  return (data as SourceRow | null) ?? null;
}

async function ensureSource(enabled: boolean): Promise<SourceRow> {
  const existing = await findSource();
  if (existing) {
    if ((existing.is_active !== false) !== enabled) {
      const { error } = await ownedDbTable('external_api_sources').update({ is_active: enabled }).eq('id', existing.id);
      if (error) throw new Error(`Could not update the PageSpeed provider: ${error.message}`);
    }
    return { ...existing, is_active: enabled };
  }
  const { data, error } = await ownedDbTable('external_api_sources').insert({
    name: PAGESPEED_SOURCE_NAME, base_url: 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed', purpose: 'report_performance',
    category: 'others', is_active: enabled, is_whitelisted: false, is_enabled_global: false, is_preset: false,
    method: 'GET', auth_type: 'query', api_key_name: 'key', api_key_env_name: PAGESPEED_ENV_NAME, platform_type: 'api',
    requires_admin: true, company_id: null, required_metadata: {}, created_at: new Date().toISOString(),
  }).select('id, is_active, required_metadata').single();
  if (error || !data) throw new Error(`Could not create the PageSpeed provider: ${error?.message ?? 'no row returned'}`);
  return data as SourceRow;
}

const lastCheckOf = (row: SourceRow | null): PageSpeedLastCheck | null => {
  const v = row?.required_metadata && (row.required_metadata as Record<string, unknown>).pagespeed_last_check;
  return v && typeof v === 'object' ? v as PageSpeedLastCheck : null;
};

export async function getPageSpeedConfigSummary(): Promise<PageSpeedConfigSummary> {
  const row = await findSource();
  const account = row ? await getActiveAccountForApi(row.id) : null;
  const hasStoredKey = Boolean(account && resolveAccountCredentials(account).api_key_value);
  const resolved = await resolveProviderCredential('pagespeed');
  const envPresent = Boolean(process.env[PAGESPEED_ENV_NAME]?.trim());
  const keylessEnabled = /^(1|true|on|yes)$/i.test(process.env.PAGESPEED_ENABLED ?? '');
  const enabled = row ? row.is_active !== false : true;
  const keySource = resolved.source === 'managed' ? 'super_admin' : resolved.source === 'environment' ? 'environment' : 'none';
  const lastCheck = lastCheckOf(row);
  const status: PageSpeedConfigSummary['status'] = !enabled ? 'disabled' : keySource === 'none' ? 'not_configured' : lastCheck && !lastCheck.ok && lastCheck.issue !== 'timeout' ? 'error' : 'active';
  const statusDetail = !enabled ? 'Disabled: report jobs make no PageSpeed request and show page speed as not measured.'
    : keySource === 'super_admin' ? 'Active: every eligible tenant report uses the Super Admin key.'
      : keySource === 'environment' ? `Active: report jobs use the ${PAGESPEED_ENV_NAME} environment fallback. Save a key here to manage it in Super Admin.`
        : keylessEnabled ? 'No key: report jobs use Google’s shared keyless quota, which is often exhausted. Add a key for a dedicated quota.'
          : 'Not configured: report jobs make no PageSpeed request. Add an API key to measure page speed.';
  return {
    provider: 'google_pagespeed', enabled, configured: keySource !== 'none', keySource, hasStoredKey,
    keyDisplay: hasStoredKey ? '•••••••• (encrypted)' : null,
    envFallback: { name: PAGESPEED_ENV_NAME, present: envPresent }, keylessEnabled, status, statusDetail, lastCheck,
  };
}

/** A Google API key's shape: refuse obvious paste errors before storing anything. */
export function validatePageSpeedKeyShape(key: string): string | null {
  const k = key.trim();
  if (!k) return 'The API key is empty.';
  if (/\s/.test(k)) return 'The API key contains spaces.';
  if (k.length < 20 || k.length > 200) return 'That does not look like a Google API key.';
  return null;
}

/**
 * Save the configuration. `apiKey` undefined/empty keeps the stored key; `clearKey` removes it
 * (the environment fallback then applies). Never returns the key.
 */
export async function savePageSpeedConfig(input: { enabled: boolean; apiKey?: string | null; clearKey?: boolean }): Promise<PageSpeedConfigSummary> {
  const key = typeof input.apiKey === 'string' ? input.apiKey.trim() : '';
  if (key) {
    const bad = validatePageSpeedKeyShape(key);
    if (bad) throw new Error(bad);
  }
  const row = await ensureSource(input.enabled);
  const account: ProviderAccount | null = await getActiveAccountForApi(row.id);
  if (input.clearKey && account) {
    await updateProviderAccount(account.id, { is_active: false });
  } else if (key) {
    // Merge onto the existing envelope; the value is encrypted (AES-256-GCM) before it is stored.
    const envelope = buildCredentialEnvelope({ existing: account?.credentials_encrypted ?? null, supplied: { api_key_value: key } });
    if (account) await updateProviderAccount(account.id, { credentials_encrypted: envelope });
    else await createProviderAccount({ api_source_id: row.id, account_name: 'Application key', credentials_encrypted: envelope, priority: 1 });
  }
  invalidatePageSpeedAccess();
  return getPageSpeedConfigSummary();
}

/**
 * One free PageSpeed request against a fixed public page, with the credential report jobs would
 * use now. Records the outcome (non-secret) on the provider row and in the API health record.
 */
export async function checkPageSpeedConfig(opts: { fetchImpl?: typeof fetch } = {}): Promise<PageSpeedConfigSummary> {
  invalidatePageSpeedAccess();
  const startedAt = Date.now();
  // A cached result would not test the key, so the check always asks Google.
  const r = await runPageSpeed({ url: PAGESPEED_CHECK_URL, strategy: 'mobile', timeoutMs: 60_000, fetchImpl: opts.fetchImpl, noCache: true });
  const keySource = r.source === 'managed' ? 'Super Admin key' : r.source === 'environment' ? `${PAGESPEED_ENV_NAME} fallback` : r.source;
  const fail = pageSpeedFailure(r);
  const check: PageSpeedLastCheck = !fail
    ? { ok: true, issue: null, detail: 'Google answered with a performance result.', at: new Date().toISOString(), keySource }
    : { ok: false, issue: fail.issue, detail: fail.detail || PAGESPEED_ISSUE_TEXT[fail.issue], at: new Date().toISOString(), keySource };
  const row = await findSource();
  if (row) {
    await ownedDbTable('external_api_sources').update({ required_metadata: { ...(row.required_metadata ?? {}), pagespeed_last_check: check } }).eq('id', row.id);
    // A check that made no request (disabled / no key) says nothing about the provider's health.
    if (!fail || !['disabled', 'not_configured'].includes(fail.issue)) {
      await updateApiHealth({ apiId: row.id, success: r.ok, latencyMs: Date.now() - startedAt, last_test_status: r.ok ? 'SUCCESS' : 'FAILED' });
    }
  }
  return { ...(await getPageSpeedConfigSummary()), lastCheck: check };
}
