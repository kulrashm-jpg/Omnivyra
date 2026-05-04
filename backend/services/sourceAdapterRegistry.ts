import { hubspotAdapter } from './hubspotAdapter';
import type {
  UnifiedIngestionOptions,
  UnifiedIngestionPayload,
  UnifiedIngestionResult,
} from './unifiedIngestionService';

export type AdapterFetchInput<TPayload = unknown> = {
  companyId: string;
  provider: string;
  payload: TPayload;
  credentials?: Record<string, unknown>;
  integration?: IntegrationConnection;
  metadata?: Record<string, unknown>;
};

export type AdapterMapInput<TFetchedPayload = unknown> = {
  companyId: string;
  provider: string;
  payload: TFetchedPayload;
  rawPayload?: unknown;
  credentials?: Record<string, unknown>;
  integration?: IntegrationConnection;
  metadata?: Record<string, unknown>;
};

export type AdapterIngestInput<TPayload = unknown> = AdapterFetchInput<TPayload> & {
  idempotencyKey?: string;
  options?: Omit<UnifiedIngestionOptions, 'idempotencyKey'>;
};

export type IntegrationConnection = {
  id: string;
  company_id: string;
  provider: string;
  status: 'connected' | 'disconnected' | 'error';
  auth_type: 'api_key' | 'oauth';
  credentials: Record<string, unknown>;
  last_sync_at: string | null;
  last_sync_status: string | null;
  created_at: string;
};

export type UnifiedIntegrationSyncStatus = 'running' | 'completed' | 'failed';

export type AdapterAuthenticateInput = {
  companyId: string;
  provider: string;
  integration: IntegrationConnection;
  credentials: Record<string, unknown>;
};

export type AdapterAuthenticateResult = {
  authenticated: boolean;
  authType: IntegrationConnection['auth_type'];
  message?: string;
};

export type AdapterSyncInput<TPayload = unknown> = {
  companyId: string;
  provider: string;
  integration: IntegrationConnection;
  payload?: TPayload;
  credentials: Record<string, unknown>;
  idempotencyKey?: string;
  options?: Omit<UnifiedIngestionOptions, 'idempotencyKey'>;
};

export interface IntegrationSourceAdapter<TPayload = unknown, TFetchedPayload = unknown> {
  provider: string;
  canHandle(provider: string): boolean;
  authenticate(input: AdapterAuthenticateInput): Promise<AdapterAuthenticateResult>;
  fetch(input: AdapterFetchInput<TPayload>): Promise<TFetchedPayload>;
  map(input: AdapterMapInput<TFetchedPayload>): Promise<UnifiedIngestionPayload>;
  ingest(input: AdapterIngestInput<TPayload>): Promise<UnifiedIngestionResult>;
  sync(input: AdapterSyncInput<TPayload>): Promise<UnifiedIngestionResult>;
}

export class SourceAdapterNotFoundError extends Error {
  statusCode = 400;

  constructor(provider: string) {
    super(`No integration adapter registered for provider "${provider}"`);
    this.name = 'SourceAdapterNotFoundError';
  }
}

function normalizeProvider(provider: string): string {
  return provider.trim().toLowerCase();
}

export class SourceAdapterRegistry {
  private adapters = new Map<string, IntegrationSourceAdapter>();

  register(adapter: IntegrationSourceAdapter): void {
    const provider = normalizeProvider(adapter.provider);
    if (!provider) {
      throw new Error('Adapter provider is required');
    }

    this.adapters.set(provider, adapter);
  }

  resolve(provider: string): IntegrationSourceAdapter {
    const normalized = normalizeProvider(provider);
    const directMatch = this.adapters.get(normalized);
    if (directMatch) {
      return directMatch;
    }

    for (const adapter of this.adapters.values()) {
      if (adapter.canHandle(normalized)) {
        return adapter;
      }
    }

    throw new SourceAdapterNotFoundError(provider);
  }

  listProviders(): string[] {
    return [...this.adapters.keys()].sort();
  }
}

export const sourceAdapterRegistry = new SourceAdapterRegistry();
sourceAdapterRegistry.register(hubspotAdapter);
