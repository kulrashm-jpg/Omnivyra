import crypto from 'crypto';
import { ownedDbTable } from '../db/writeOwner';

export function createPluginNonce(): { nonce: string; hash: string } {
  const nonce = crypto.randomBytes(24).toString('hex');
  return { nonce, hash: crypto.createHash('sha256').update(nonce).digest('hex') };
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
      updated_at: new Date().toISOString(),
    }, { onConflict: 'website_id,plugin_site_id' })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  return { id: data.id, nonce: nonce.nonce };
}

export async function verifyWordPressPlugin(input: {
  registrationId: string;
  nonce: string;
}): Promise<boolean> {
  const hash = crypto.createHash('sha256').update(input.nonce).digest('hex');
  const { data } = await ownedDbTable('wordpress_plugin_registrations')
    .select('id, auth_nonce_hash')
    .eq('id', input.registrationId)
    .maybeSingle();
  if (!data?.auth_nonce_hash) return false;
  const ok = crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(String(data.auth_nonce_hash)));
  if (ok) {
    await ownedDbTable('wordpress_plugin_registrations')
      .update({ status: 'verified', updated_at: new Date().toISOString() })
      .eq('id', input.registrationId);
  }
  return ok;
}

export async function recordWordPressPluginHeartbeat(input: {
  registrationId: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await ownedDbTable('wordpress_plugin_registrations')
    .update({
      status: 'connected',
      last_heartbeat_at: new Date().toISOString(),
      metadata: input.metadata ?? {},
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.registrationId);
}
