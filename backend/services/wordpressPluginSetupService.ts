import crypto from 'crypto';
import { ownedDbTable } from '../db/writeOwner';
import { createWebsite, createWebsiteConnection, normalizeWebsiteUrl } from './websiteService';
import { registerWordPressPlugin, exchangeWordPressPluginToken, syncWordPressPluginEvent } from './wordpressPluginService';
import { recordAuditEvent } from './auditEventService';

function hash(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function token(): string {
  return `ovsetup_${crypto.randomBytes(30).toString('base64url')}`;
}

export async function createWordPressSetupSession(input: {
  companyId: string;
  websiteId?: string | null;
  connectionId?: string | null;
  createdBy?: string | null;
  expectedDomain?: string | null;
  expiresInMinutes?: number;
  metadata?: Record<string, unknown>;
}) {
  const setupToken = token();
  const expiresAt = new Date(Date.now() + (input.expiresInMinutes ?? 60) * 60_000).toISOString();
  const { data, error } = await ownedDbTable('wordpress_plugin_setup_sessions')
    .insert({
      company_id: input.companyId,
      website_id: input.websiteId ?? null,
      connection_id: input.connectionId ?? null,
      setup_token_hash: hash(setupToken),
      expected_domain: input.expectedDomain ?? null,
      created_by: input.createdBy ?? null,
      expires_at: expiresAt,
      metadata: input.metadata ?? {},
    })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  await recordAuditEvent({
    companyId: input.companyId,
    websiteId: input.websiteId,
    actorUserId: input.createdBy ?? null,
    actorType: input.createdBy ? 'user' : 'system',
    action: 'wordpress_plugin.setup_session.create',
    resourceType: 'wordpress_plugin_setup_session',
    resourceId: data.id,
    severity: 'warning',
    metadata: { expires_at: expiresAt },
  });
  return { session: data, setupToken, expiresAt };
}

export async function consumeWordPressSetupSession(input: {
  setupToken: string;
  siteUrl: string;
  pluginSiteId: string;
  pluginVersion?: string | null;
  wpVersion?: string | null;
  phpVersion?: string | null;
  capabilities?: Record<string, unknown>;
  settings?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}) {
  const now = new Date().toISOString();
  const { data: session, error } = await ownedDbTable('wordpress_plugin_setup_sessions')
    .select('*')
    .eq('setup_token_hash', hash(input.setupToken))
    .eq('status', 'pending')
    .gt('expires_at', now)
    .maybeSingle();
  if (error || !session) throw new Error('Setup token is invalid or expired');

  const canonicalUrl = normalizeWebsiteUrl(input.siteUrl);
  const expectedDomain = String((session as any).expected_domain || '');
  if (expectedDomain && !canonicalUrl.includes(expectedDomain.replace(/^https?:\/\//, ''))) {
    await markSessionFailed((session as any).id, 'Setup token is not valid for this domain');
    throw new Error('Setup token is not valid for this domain');
  }

  let websiteId = (session as any).website_id as string | null;
  if (!websiteId) {
    const website = await createWebsite({
      companyId: (session as any).company_id,
      createdBy: (session as any).created_by ?? null,
      name: hostName(canonicalUrl),
      canonicalUrl,
      cmsProvider: 'wordpress',
      metadata: { created_by_wordpress_plugin: true },
      settings: { tracking_auto_inject: true },
    });
    websiteId = website.id;
  }

  let connectionId = (session as any).connection_id as string | null;
  if (!connectionId) {
    const connection = await createWebsiteConnection({
      websiteId,
      provider: 'wordpress',
      authType: 'plugin_token',
      status: 'connected',
      healthStatus: 'healthy',
      nonSecretConfig: {
        site_url: canonicalUrl,
        plugin_site_id: input.pluginSiteId,
        auth_mode: 'wordpress_plugin',
      },
    });
    connectionId = connection.id;
  }

  const registration = await registerWordPressPlugin({
    companyId: (session as any).company_id,
    websiteId,
    siteUrl: canonicalUrl,
    pluginSiteId: input.pluginSiteId,
    connectionId,
  });
  const exchange = await exchangeWordPressPluginToken({
    registrationId: registration.id,
    nonce: registration.nonce,
    pluginVersion: input.pluginVersion,
    wpVersion: input.wpVersion,
    phpVersion: input.phpVersion,
    capabilities: input.capabilities,
    settings: input.settings,
  });

  await ownedDbTable('wordpress_plugin_setup_sessions')
    .update({
      website_id: websiteId,
      connection_id: connectionId,
      registration_id: registration.id,
      site_url: canonicalUrl,
      plugin_site_id: input.pluginSiteId,
      status: 'connected',
      consumed_at: now,
      metadata: { ...(input.metadata ?? {}), compatibility_status: exchange.compatibilityStatus },
      updated_at: now,
    })
    .eq('id', (session as any).id);

  await ownedDbTable('websites')
    .update({
      cms_provider: 'wordpress',
      status: 'active',
      metadata: { plugin_auto_verified: true, plugin_site_id: input.pluginSiteId },
      updated_at: now,
    })
    .eq('id', websiteId)
    .eq('company_id', (session as any).company_id);

  await recordAuditEvent({
    companyId: (session as any).company_id,
    websiteId,
    actorType: 'plugin',
    action: 'wordpress_plugin.setup_session.consume',
    resourceType: 'wordpress_plugin_setup_session',
    resourceId: (session as any).id,
    severity: 'warning',
    metadata: { connection_id: connectionId, registration_id: registration.id },
  });

  await syncWordPressPluginEvent({
    accessToken: exchange.accessToken,
    eventType: 'settings.sync',
    payload: input.settings ?? {},
    idempotencyKey: `setup-settings:${registration.id}`,
  });

  return {
    accessToken: exchange.accessToken,
    registrationId: registration.id,
    websiteId,
    connectionId,
    compatibilityStatus: exchange.compatibilityStatus,
    tracking: {
      website_id: websiteId,
      endpoint: '/api/website-events/track',
    },
  };
}

async function markSessionFailed(id: string, message: string) {
  await ownedDbTable('wordpress_plugin_setup_sessions')
    .update({ status: 'failed', last_error: message, updated_at: new Date().toISOString() })
    .eq('id', id);
}

function hostName(canonicalUrl: string): string {
  try {
    return new URL(canonicalUrl).hostname.replace(/^www\./, '');
  } catch {
    return 'WordPress Website';
  }
}
