import crypto from 'crypto';
import { ownedDbTable } from '../db/writeOwner';
import { recordAuditEvent } from './auditEventService';

export function createPluginNonce(): { nonce: string; hash: string } {
  const nonce = crypto.randomBytes(24).toString('hex');
  return { nonce, hash: crypto.createHash('sha256').update(nonce).digest('hex') };
}

function hashSecret(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function createPluginAccessToken(): string {
  return `ovwp_${crypto.randomBytes(32).toString('base64url')}`;
}

function safeTimingEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function compatibilityStatus(input: {
  pluginVersion?: string | null;
  wpVersion?: string | null;
  phpVersion?: string | null;
}): { status: 'unknown' | 'compatible' | 'warning' | 'unsupported'; report: Record<string, unknown> } {
  const checks: Array<Record<string, unknown>> = [];
  const report: Record<string, unknown> = {
    plugin_version: input.pluginVersion ?? null,
    wp_version: input.wpVersion ?? null,
    php_version: input.phpVersion ?? null,
    checks,
  };
  const wpMajor = Number(String(input.wpVersion || '').split('.')[0]);
  const [phpMajor, phpMinor] = String(input.phpVersion || '').split('.').map((part) => Number(part || 0));

  if (!input.pluginVersion || !input.wpVersion || !input.phpVersion) {
    checks.push({ name: 'version_metadata', status: 'warning', message: 'Plugin did not provide complete version metadata.' });
    return { status: 'warning', report };
  }
  if (wpMajor && wpMajor < 6) {
    checks.push({ name: 'wordpress_version', status: 'warning', message: 'WordPress 6.x or newer is recommended.' });
  }
  if (phpMajor && (phpMajor < 8 || (phpMajor === 8 && (phpMinor || 0) < 1))) {
    checks.push({ name: 'php_version', status: 'unsupported', message: 'PHP 8.1 or newer is required for supported plugin operation.' });
    return { status: 'unsupported', report };
  }
  checks.push({ name: 'baseline', status: 'compatible', message: 'Baseline plugin compatibility checks passed.' });
  return { status: checks.some((check) => check.status === 'warning') ? 'warning' : 'compatible', report };
}

export async function registerWordPressPlugin(input: {
  companyId: string;
  websiteId: string;
  siteUrl: string;
  pluginSiteId: string;
  connectionId?: string | null;
}): Promise<{ id: string; nonce: string }> {
  const nonce = createPluginNonce();
  const { data, error } = await ownedDbTable('wordpress_plugin_registrations')
    .upsert({
      company_id: input.companyId,
      website_id: input.websiteId,
      connection_id: input.connectionId ?? null,
      site_url: input.siteUrl,
      plugin_site_id: input.pluginSiteId,
      status: 'pending',
      auth_nonce_hash: nonce.hash,
      access_token_hash: null,
      revoked_at: null,
      revoked_reason: null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'website_id,plugin_site_id' })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  await recordAuditEvent({
    companyId: input.companyId,
    websiteId: input.websiteId,
    actorType: 'plugin',
    action: 'wordpress_plugin.register',
    resourceType: 'wordpress_plugin_registration',
    resourceId: data.id,
    metadata: { site_url: input.siteUrl, plugin_site_id: input.pluginSiteId },
  });
  return { id: data.id, nonce: nonce.nonce };
}

export async function verifyWordPressPlugin(input: {
  registrationId: string;
  nonce: string;
}): Promise<boolean> {
  const hash = hashSecret(input.nonce);
  const { data } = await ownedDbTable('wordpress_plugin_registrations')
    .select('id, company_id, website_id, auth_nonce_hash')
    .eq('id', input.registrationId)
    .maybeSingle();
  if (!data?.auth_nonce_hash) return false;
  const ok = safeTimingEqual(hash, String(data.auth_nonce_hash));
  if (ok) {
    await ownedDbTable('wordpress_plugin_registrations')
      .update({ status: 'verified', verified_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', input.registrationId);
    await recordAuditEvent({
      companyId: (data as any).company_id,
      websiteId: (data as any).website_id,
      actorType: 'plugin',
      action: 'wordpress_plugin.verify',
      resourceType: 'wordpress_plugin_registration',
      resourceId: input.registrationId,
    });
  }
  return ok;
}

export async function exchangeWordPressPluginToken(input: {
  registrationId: string;
  nonce: string;
  pluginVersion?: string | null;
  wpVersion?: string | null;
  phpVersion?: string | null;
  capabilities?: Record<string, unknown>;
  settings?: Record<string, unknown>;
}): Promise<{ accessToken: string; registrationId: string; compatibilityStatus: string }> {
  const { data, error } = await ownedDbTable('wordpress_plugin_registrations')
    .select('*')
    .eq('id', input.registrationId)
    .maybeSingle();
  if (error || !data) throw new Error(error?.message || 'Registration not found');
  if ((data as any).revoked_at) throw new Error('Plugin registration has been revoked');
  const expected = hashSecret(input.nonce);
  if (!safeTimingEqual(expected, String((data as any).auth_nonce_hash || ''))) {
    throw new Error('Invalid plugin nonce');
  }

  const accessToken = createPluginAccessToken();
  const compatibility = compatibilityStatus(input);
  const { error: updateError } = await ownedDbTable('wordpress_plugin_registrations')
    .update({
      access_token_hash: hashSecret(accessToken),
      token_rotated_at: new Date().toISOString(),
      status: 'connected',
      verified_at: (data as any).verified_at ?? new Date().toISOString(),
      last_heartbeat_at: new Date().toISOString(),
      plugin_version: input.pluginVersion ?? null,
      wp_version: input.wpVersion ?? null,
      php_version: input.phpVersion ?? null,
      compatibility_status: compatibility.status,
      compatibility_report: compatibility.report,
      capabilities: input.capabilities ?? {},
      settings: input.settings ?? {},
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.registrationId);
  if (updateError) throw new Error(updateError.message);

  await recordAuditEvent({
    companyId: (data as any).company_id,
    websiteId: (data as any).website_id,
    actorType: 'plugin',
    action: 'wordpress_plugin.token_exchange',
    resourceType: 'wordpress_plugin_registration',
    resourceId: input.registrationId,
    severity: 'warning',
    metadata: { compatibility_status: compatibility.status },
  });
  return { accessToken, registrationId: input.registrationId, compatibilityStatus: compatibility.status };
}

export async function authenticateWordPressPluginToken(accessToken: string): Promise<{
  registrationId: string;
  companyId: string;
  websiteId: string;
  connectionId?: string | null;
} | null> {
  if (!accessToken || !accessToken.startsWith('ovwp_')) return null;
  const { data, error } = await ownedDbTable('wordpress_plugin_registrations')
    .select('id, company_id, website_id, connection_id, status, revoked_at')
    .eq('access_token_hash', hashSecret(accessToken))
    .is('revoked_at', null)
    .limit(1);
  if (error || !data?.length) return null;
  const row = data[0] as any;
  if (row.status === 'revoked' || row.status === 'disabled') return null;
  return {
    registrationId: row.id,
    companyId: row.company_id,
    websiteId: row.website_id,
    connectionId: row.connection_id ?? null,
  };
}

export async function recordWordPressPluginHeartbeat(input: {
  registrationId?: string;
  accessToken?: string;
  metadata?: Record<string, unknown>;
  pluginVersion?: string | null;
  wpVersion?: string | null;
  phpVersion?: string | null;
  healthStatus?: 'healthy' | 'warning' | 'degraded' | 'failed' | 'reauth_required';
  settings?: Record<string, unknown>;
  capabilities?: Record<string, unknown>;
}): Promise<void> {
  let registrationId = input.registrationId;
  if (!registrationId && input.accessToken) {
    const auth = await authenticateWordPressPluginToken(input.accessToken);
    registrationId = auth?.registrationId;
  }
  if (!registrationId) throw new Error('registration_id or plugin bearer token is required');
  const compatibility = compatibilityStatus(input);
  await ownedDbTable('wordpress_plugin_registrations')
    .update({
      status: input.healthStatus === 'reauth_required' ? 'reauth_required' : 'connected',
      last_heartbeat_at: new Date().toISOString(),
      metadata: input.metadata ?? {},
      diagnostics: {
        health_status: input.healthStatus ?? 'healthy',
        last_heartbeat_message: (input.metadata?.message as string | undefined) ?? null,
      },
      plugin_version: input.pluginVersion ?? null,
      wp_version: input.wpVersion ?? null,
      php_version: input.phpVersion ?? null,
      compatibility_status: compatibility.status,
      compatibility_report: compatibility.report,
      settings: input.settings ?? {},
      capabilities: input.capabilities ?? {},
      updated_at: new Date().toISOString(),
    })
    .eq('id', registrationId);
}

export async function revokeWordPressPlugin(input: {
  registrationId: string;
  reason?: string | null;
  actorUserId?: string | null;
}): Promise<void> {
  const { data } = await ownedDbTable('wordpress_plugin_registrations')
    .select('company_id, website_id')
    .eq('id', input.registrationId)
    .maybeSingle();
  const { error } = await ownedDbTable('wordpress_plugin_registrations')
    .update({
      status: 'revoked',
      access_token_hash: null,
      revoked_at: new Date().toISOString(),
      revoked_reason: input.reason ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.registrationId);
  if (error) throw new Error(error.message);
  await recordAuditEvent({
    companyId: (data as any)?.company_id ?? null,
    websiteId: (data as any)?.website_id ?? null,
    actorUserId: input.actorUserId ?? null,
    actorType: input.actorUserId ? 'user' : 'plugin',
    action: 'wordpress_plugin.revoke',
    resourceType: 'wordpress_plugin_registration',
    resourceId: input.registrationId,
    severity: 'warning',
    metadata: { reason: input.reason ?? null },
  });
}

export async function syncWordPressPluginEvent(input: {
  accessToken: string;
  eventType: string;
  payload?: Record<string, unknown>;
  idempotencyKey?: string | null;
  nonce?: string | null;
  timestamp?: string | null;
}): Promise<{ accepted: boolean; registrationId?: string }> {
  const auth = await authenticateWordPressPluginToken(input.accessToken);
  if (!auth) return { accepted: false };
  const payload = input.payload ?? {};
  const eventKey = input.idempotencyKey ?? `${input.eventType}:${hashSecret(JSON.stringify(payload)).slice(0, 24)}`;
  const replay = validateReplay(input.timestamp);
  if (replay !== 'accepted') {
    await recordAuditEvent({
      companyId: auth.companyId,
      websiteId: auth.websiteId,
      actorType: 'plugin',
      action: 'wordpress_plugin.replay_rejected',
      resourceType: 'wordpress_plugin_registration',
      resourceId: auth.registrationId,
      severity: 'critical',
      metadata: { event_type: input.eventType, replay_state: replay },
    });
    return { accepted: false, registrationId: auth.registrationId };
  }
  const { error } = await ownedDbTable('wordpress_plugin_events').insert({
    company_id: auth.companyId,
    website_id: auth.websiteId,
    registration_id: auth.registrationId,
    event_type: input.eventType,
    idempotency_key: eventKey,
    payload,
    processed_state: 'received',
    nonce: input.nonce ?? null,
    expires_at: input.timestamp ? new Date(Number(input.timestamp) * 1000 + 5 * 60_000).toISOString() : null,
    replay_state: replay,
  });
  if (error) {
    if (error.message.toLowerCase().includes('duplicate')) return { accepted: true, registrationId: auth.registrationId };
    throw new Error(error.message);
  }

  const update: Record<string, unknown> = {
    last_event_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  if (input.eventType.startsWith('sync.')) update.last_sync_at = new Date().toISOString();
  if (input.eventType === 'settings.sync') update.settings = payload;
  if (input.eventType === 'health.sync') update.diagnostics = payload;
  await ownedDbTable('wordpress_plugin_registrations').update(update).eq('id', auth.registrationId);

  if (input.eventType === 'taxonomy.sync') await syncTaxonomyCache(auth.connectionId, payload);
  if (input.eventType === 'media.sync') await syncMediaMetadata(auth, payload);
  if (input.eventType === 'post.sync' || input.eventType === 'post.deleted') await syncExternalPosts(auth, payload, input.eventType);
  if (input.eventType === 'debug.log') await syncDebugLogs(auth, payload);

  await recordAuditEvent({
    companyId: auth.companyId,
    websiteId: auth.websiteId,
    actorType: 'plugin',
    action: `wordpress_plugin.${input.eventType}`,
    resourceType: 'wordpress_plugin_registration',
    resourceId: auth.registrationId,
    metadata: { idempotency_key: eventKey },
  });
  return { accepted: true, registrationId: auth.registrationId };
}

export async function rotateWordPressPluginToken(input: {
  accessToken: string;
}): Promise<{ accepted: boolean; accessToken?: string; registrationId?: string }> {
  const auth = await authenticateWordPressPluginToken(input.accessToken);
  if (!auth) return { accepted: false };
  const accessToken = createPluginAccessToken();
  const { error } = await ownedDbTable('wordpress_plugin_registrations')
    .update({
      access_token_hash: hashSecret(accessToken),
      token_rotated_at: new Date().toISOString(),
      token_expires_at: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString(),
      token_rotation_required_at: new Date(Date.now() + 150 * 24 * 60 * 60 * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', auth.registrationId);
  if (error) throw new Error(error.message);
  await recordAuditEvent({
    companyId: auth.companyId,
    websiteId: auth.websiteId,
    actorType: 'plugin',
    action: 'wordpress_plugin.token_rotate',
    resourceType: 'wordpress_plugin_registration',
    resourceId: auth.registrationId,
    severity: 'warning',
  });
  return { accepted: true, accessToken, registrationId: auth.registrationId };
}

export async function getWordPressPluginDiagnostics(input: {
  companyId: string;
  websiteId?: string | null;
}): Promise<{ registrations: any[]; recentEvents: any[] }> {
  let registrationQuery = ownedDbTable('wordpress_plugin_registrations')
    .select('*')
    .eq('company_id', input.companyId)
    .order('updated_at', { ascending: false });
  if (input.websiteId) registrationQuery = registrationQuery.eq('website_id', input.websiteId);
  const { data: registrations, error } = await registrationQuery.limit(25);
  if (error) throw new Error(error.message);

  let eventQuery = ownedDbTable('wordpress_plugin_events')
    .select('*')
    .eq('company_id', input.companyId)
    .order('received_at', { ascending: false });
  if (input.websiteId) eventQuery = eventQuery.eq('website_id', input.websiteId);
  const { data: recentEvents, error: eventError } = await eventQuery.limit(50);
  if (eventError) throw new Error(eventError.message);
  return { registrations: registrations ?? [], recentEvents: recentEvents ?? [] };
}

async function syncTaxonomyCache(connectionId: string | null | undefined, payload: Record<string, unknown>) {
  if (!connectionId) return;
  const items = Array.isArray(payload.items) ? payload.items : [];
  for (const item of items.slice(0, 500)) {
    const row = item as Record<string, unknown>;
    const externalId = String(row.id ?? row.external_id ?? '');
    const name = String(row.name ?? '');
    const taxonomyType = String(row.taxonomy_type ?? row.type ?? 'category');
    if (!externalId || !name) continue;
    await ownedDbTable('cms_taxonomy_cache').upsert({
      connection_id: connectionId,
      provider: 'wordpress',
      taxonomy_type: taxonomyType,
      external_id: externalId,
      name,
      slug: typeof row.slug === 'string' ? row.slug : null,
      metadata: row,
      synced_at: new Date().toISOString(),
    }, { onConflict: 'connection_id,taxonomy_type,external_id' });
  }
}

async function syncMediaMetadata(
  auth: { companyId: string; websiteId: string; connectionId?: string | null },
  payload: Record<string, unknown>
) {
  const items = Array.isArray(payload.items) ? payload.items : [];
  for (const item of items.slice(0, 200)) {
    const row = item as Record<string, unknown>;
    const externalId = String(row.id ?? row.external_id ?? '');
    if (!externalId) continue;
    await ownedDbTable('cms_media_assets').upsert({
      company_id: auth.companyId,
      website_id: auth.websiteId,
      connection_id: auth.connectionId ?? null,
      provider: 'wordpress',
      external_id: externalId,
      external_url: typeof row.url === 'string' ? row.url : null,
      content_type: typeof row.media_type === 'string' ? row.media_type : null,
      metadata: row,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'provider,external_id' });
  }
}

async function syncExternalPosts(
  auth: { companyId: string; websiteId: string; registrationId: string },
  payload: Record<string, unknown>,
  eventType: string,
) {
  const items = Array.isArray(payload.items) ? payload.items : [];
  for (const item of items.slice(0, 200)) {
    const row = item as Record<string, unknown>;
    const externalId = String(row.id ?? row.external_id ?? '');
    if (!externalId) continue;
    await ownedDbTable('wordpress_external_posts').upsert({
      company_id: auth.companyId,
      website_id: auth.websiteId,
      registration_id: auth.registrationId,
      external_id: externalId,
      title: typeof row.title === 'string' ? row.title : null,
      slug: typeof row.slug === 'string' ? row.slug : null,
      permalink: typeof row.permalink === 'string' ? row.permalink : null,
      status: typeof row.status === 'string' ? row.status : null,
      author_external_id: typeof row.author_external_id === 'string' ? row.author_external_id : null,
      modified_at: typeof row.modified_at === 'string' ? row.modified_at : null,
      deleted_at: eventType === 'post.deleted' ? new Date().toISOString() : (typeof row.deleted_at === 'string' ? row.deleted_at : null),
      raw_payload: row,
      synced_at: new Date().toISOString(),
    }, { onConflict: 'website_id,external_id' });
  }
  await upsertSyncCursor(auth, eventType, payload);
}

async function syncDebugLogs(
  auth: { companyId: string; websiteId: string; registrationId: string },
  payload: Record<string, unknown>,
) {
  const items = Array.isArray(payload.items) ? payload.items : [payload];
  for (const item of items.slice(0, 50)) {
    const row = item as Record<string, unknown>;
    await ownedDbTable('wordpress_plugin_debug_logs').insert({
      company_id: auth.companyId,
      website_id: auth.websiteId,
      registration_id: auth.registrationId,
      level: typeof row.level === 'string' ? row.level : 'info',
      message: typeof row.message === 'string' ? row.message.slice(0, 1000) : 'Plugin log',
      context: typeof row.context === 'object' && row.context !== null ? row.context : {},
      plugin_version: typeof row.plugin_version === 'string' ? row.plugin_version : null,
    });
  }
}

async function upsertSyncCursor(
  auth: { companyId: string; websiteId: string; registrationId: string },
  eventType: string,
  payload: Record<string, unknown>,
) {
  await ownedDbTable('wordpress_sync_cursors').upsert({
    company_id: auth.companyId,
    website_id: auth.websiteId,
    registration_id: auth.registrationId,
    sync_type: eventType,
    cursor_value: typeof payload.cursor === 'string' ? payload.cursor : null,
    last_synced_at: new Date().toISOString(),
    metadata: { item_count: Array.isArray(payload.items) ? payload.items.length : 0 },
    updated_at: new Date().toISOString(),
  }, { onConflict: 'website_id,sync_type' });
}

function validateReplay(timestamp?: string | null): 'accepted' | 'expired' | 'rejected' {
  if (!timestamp) return 'accepted';
  const numeric = Number(timestamp);
  if (!Number.isFinite(numeric)) return 'rejected';
  const ageMs = Math.abs(Date.now() - numeric * 1000);
  return ageMs > 5 * 60_000 ? 'expired' : 'accepted';
}
