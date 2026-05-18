import { ownedDbTable } from '../db/writeOwner';
import { getCmsAdapter, isCmsProvider } from './cms/registry';
import { getIntegration } from './integrationService';
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
