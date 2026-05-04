import { applyAuthGuard } from '@/backend/middleware/applyAuthGuard';
import type { NextApiRequest, NextApiResponse } from 'next';

import {
  sourceAdapterRegistry,
  SourceAdapterNotFoundError,
} from '../../../backend/services/sourceAdapterRegistry';
import { ingestUnifiedData } from '../../../backend/services/unifiedIngestionService';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';

type IntegrationIngestBody = {
  provider?: unknown;
  company_id?: unknown;
  companyId?: unknown;
  payload?: unknown;
  idempotency_key?: unknown;
};

function bodyText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizePayload(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('payload object is required');
  }

  return value as Record<string, unknown>;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = (req.body || {}) as IntegrationIngestBody;
  const provider = bodyText(body.provider).toLowerCase();
  const companyId = bodyText(body.company_id) || bodyText(body.companyId);
  const idempotencyKey = bodyText(body.idempotency_key) || undefined;

  if (!provider) {
    return res.status(400).json({ error: 'provider is required' });
  }

  if (!companyId) {
    return res.status(400).json({ error: 'company_id is required' });
  }

  let payload: Record<string, unknown>;
  try {
    payload = normalizePayload(body.payload);
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : 'payload object is required' });
  }

  const access = await enforceCompanyAccess({
    req,
    res,
    companyId,
    requireCampaignId: false,
  });
  if (!access) return;

  try {
    const adapter = sourceAdapterRegistry.resolve(provider);
    const fetchedPayload = await adapter.fetch({
      companyId,
      provider,
      payload,
    });
    const ingestionPayload = await adapter.map({
      companyId,
      provider,
      payload: fetchedPayload,
      rawPayload: payload,
      metadata: {
        integration_entry: 'api_integrations_ingest',
      },
    });
    const result = await ingestUnifiedData(ingestionPayload, {
      idempotencyKey,
      context: {
        integrationProvider: provider,
        integrationEntry: 'api_integrations_ingest',
      },
    });

    return res.status(200).json({
      success: true,
      provider,
      company_id: companyId,
      records_mapped: ingestionPayload.records.length,
      ingestion: result,
    });
  } catch (error) {
    if (error instanceof SourceAdapterNotFoundError) {
      return res.status(error.statusCode).json({
        error: error.message,
        supported_providers: sourceAdapterRegistry.listProviders(),
      });
    }

    console.error('[integrations/ingest]', error);
    return res.status(500).json({
      error: 'Failed to ingest integration payload. Please try again.',
    });
  }
}

export default applyAuthGuard({
  requiresAuth: true,
})(handler);

