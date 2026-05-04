import { createServiceRoleMigrationProxy } from '../db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');
import { logger } from './logger';
import type { IntegrationConnection, UnifiedIntegrationSyncStatus } from './sourceAdapterRegistry';
import type { UnifiedIngestionResult } from './unifiedIngestionService';

export class IntegrationNotFoundError extends Error {
  statusCode = 404;

  constructor(integrationId: string) {
    super(`Integration "${integrationId}" was not found`);
    this.name = 'IntegrationNotFoundError';
  }
}

export class IntegrationSyncPersistenceError extends Error {
  statusCode = 500;

  constructor(message: string) {
    super(message);
    this.name = 'IntegrationSyncPersistenceError';
  }
}

function asCredentials(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function syncLogContext(integration: IntegrationConnection): Record<string, unknown> {
  return {
    integrationId: integration.id,
    companyId: integration.company_id,
    provider: integration.provider,
  };
}

export async function loadUnifiedIntegration(integrationId: string): Promise<IntegrationConnection> {
  const { data, error } = await supabase
    .from('integrations')
    .select('id, company_id, provider, status, auth_type, credentials, last_sync_at, last_sync_status, created_at')
    .eq('id', integrationId)
    .maybeSingle();

  if (error) {
    throw new IntegrationSyncPersistenceError(`Failed to load integration: ${error.message}`);
  }

  if (!data) {
    throw new IntegrationNotFoundError(integrationId);
  }

  return {
    id: data.id,
    company_id: data.company_id,
    provider: String(data.provider || '').trim().toLowerCase(),
    status: data.status,
    auth_type: data.auth_type,
    credentials: asCredentials(data.credentials),
    last_sync_at: data.last_sync_at ?? null,
    last_sync_status: data.last_sync_status ?? null,
    created_at: data.created_at,
  };
}

export async function markIntegrationSyncStarted(integration: IntegrationConnection): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('integrations')
    .update({
      last_sync_at: now,
      last_sync_status: 'running' satisfies UnifiedIntegrationSyncStatus,
    })
    .eq('id', integration.id);

  if (error) {
    throw new IntegrationSyncPersistenceError(`Failed to mark integration sync started: ${error.message}`);
  }

  logger.info('sync_started', syncLogContext(integration));
}

export async function markIntegrationSyncCompleted(
  integration: IntegrationConnection,
  result: UnifiedIngestionResult
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('integrations')
    .update({
      status: 'connected',
      last_sync_at: now,
      last_sync_status: 'completed' satisfies UnifiedIntegrationSyncStatus,
    })
    .eq('id', integration.id);

  if (error) {
    throw new IntegrationSyncPersistenceError(`Failed to mark integration sync completed: ${error.message}`);
  }

  logger.info('sync_completed', {
    ...syncLogContext(integration),
    ingestionRunId: result.ingestionRunId,
    recordsReceived: result.recordsReceived,
    recordsTransformed: result.recordsTransformed,
  });
}

export async function markIntegrationSyncFailed(
  integration: IntegrationConnection,
  message: string
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('integrations')
    .update({
      status: 'error',
      last_sync_at: now,
      last_sync_status: 'failed' satisfies UnifiedIntegrationSyncStatus,
    })
    .eq('id', integration.id);

  if (error) {
    logger.error('sync_failed_status_update_failed', {
      ...syncLogContext(integration),
      message: error.message,
    });
    return;
  }

  logger.error('sync_failed', {
    ...syncLogContext(integration),
    message,
  });
}
