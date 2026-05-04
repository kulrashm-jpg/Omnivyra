import { applyAuthGuard } from '@/backend/middleware/applyAuthGuard';
import type { NextApiRequest, NextApiResponse } from 'next';

import {
  IntegrationNotFoundError,
  IntegrationSyncPersistenceError,
  loadUnifiedIntegration,
  markIntegrationSyncCompleted,
  markIntegrationSyncFailed,
  markIntegrationSyncStarted,
} from '../../../backend/services/integrationSyncService';
import {
  sourceAdapterRegistry,
  SourceAdapterNotFoundError,
} from '../../../backend/services/sourceAdapterRegistry';
import { ingestUnifiedData } from '../../../backend/services/unifiedIngestionService';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';

type IntegrationSyncBody = {
  integration_id?: unknown;
  integrationId?: unknown;
  idempotency_key?: unknown;
};

function bodyText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function payloadFromCredentials(credentials: Record<string, unknown>): Record<string, unknown> {
  const explicitPayload = credentials.sync_payload ?? credentials.mock_payload;
  const objectPayload = asObject(explicitPayload);
  if (Object.keys(objectPayload).length > 0) {
    return objectPayload;
  }

  if (credentials.mock === true) {
    return { mock: true };
  }

  return {};
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = (req.body || {}) as IntegrationSyncBody;
  const integrationId = bodyText(body.integration_id) || bodyText(body.integrationId);
  const idempotencyKey = bodyText(body.idempotency_key) || undefined;

  if (!integrationId) {
    return res.status(400).json({ error: 'integration_id is required' });
  }

  let integration;
  try {
    integration = await loadUnifiedIntegration(integrationId);
  } catch (error) {
    if (error instanceof IntegrationNotFoundError) {
      return res.status(error.statusCode).json({ error: error.message });
    }

    if (error instanceof IntegrationSyncPersistenceError) {
      return res.status(error.statusCode).json({ error: error.message });
    }

    console.error('[integrations/sync:load]', error);
    return res.status(500).json({ error: 'Failed to load integration. Please try again.' });
  }

  const access = await enforceCompanyAccess({
    req,
    res,
    companyId: integration.company_id,
    requireCampaignId: false,
  });
  if (!access) return;

  try {
    await markIntegrationSyncStarted(integration);

    const adapter = sourceAdapterRegistry.resolve(integration.provider);
    const auth = await adapter.authenticate({
      companyId: integration.company_id,
      provider: integration.provider,
      integration,
      credentials: integration.credentials,
    });

    if (!auth.authenticated) {
      throw new Error(auth.message ?? `Authentication failed for ${integration.provider}`);
    }

    const payload = payloadFromCredentials(integration.credentials);
    const fetchedPayload = await adapter.fetch({
      companyId: integration.company_id,
      provider: integration.provider,
      payload,
      credentials: integration.credentials,
      integration,
      metadata: {
        integration_id: integration.id,
        integration_entry: 'api_integrations_sync',
      },
    });
    const ingestionPayload = await adapter.map({
      companyId: integration.company_id,
      provider: integration.provider,
      payload: fetchedPayload,
      rawPayload: payload,
      credentials: integration.credentials,
      integration,
      metadata: {
        integration_id: integration.id,
        integration_entry: 'api_integrations_sync',
        auth_type: integration.auth_type,
      },
    });
    const result = await ingestUnifiedData(ingestionPayload, {
      idempotencyKey,
      context: {
        integrationId: integration.id,
        integrationProvider: integration.provider,
        integrationEntry: 'api_integrations_sync',
      },
    });

    await markIntegrationSyncCompleted(integration, result);

    return res.status(200).json({
      success: true,
      integration_id: integration.id,
      company_id: integration.company_id,
      provider: integration.provider,
      auth: {
        authenticated: auth.authenticated,
        auth_type: auth.authType,
      },
      records_mapped: ingestionPayload.records.length,
      ingestion: result,
    });
  } catch (error) {
    const message = errorMessage(error);
    await markIntegrationSyncFailed(integration, message);

    if (error instanceof SourceAdapterNotFoundError) {
      return res.status(error.statusCode).json({
        error: error.message,
        supported_providers: sourceAdapterRegistry.listProviders(),
      });
    }

    return res.status(500).json({
      error: 'Failed to sync integration. Please try again.',
      details: message,
    });
  }
}

export default applyAuthGuard({
  requiresAuth: true,
})(handler);

