import { ingestUnifiedData, type UnifiedIngestionPayload, type UnifiedIngestionResult } from './unifiedIngestionService';
import type {
  AdapterAuthenticateInput,
  AdapterAuthenticateResult,
  AdapterFetchInput,
  AdapterIngestInput,
  AdapterMapInput,
  AdapterSyncInput,
  IntegrationSourceAdapter,
} from './sourceAdapterRegistry';

type HubspotObject = {
  id?: string;
  properties?: Record<string, unknown>;
  associations?: Record<string, unknown>;
  [key: string]: unknown;
};

type HubspotPayload = {
  contacts?: HubspotObject[];
  deals?: HubspotObject[];
  results?: HubspotObject[];
  objectType?: 'contact' | 'deal';
  mock?: boolean;
  [key: string]: unknown;
};

type HubspotFetchedPayload = {
  contacts: HubspotObject[];
  deals: HubspotObject[];
};

const MOCK_HUBSPOT_PAYLOAD: HubspotFetchedPayload = {
  contacts: [
    {
      id: 'mock-contact-1',
      properties: {
        email: 'mock.lead@example.com',
        firstname: 'Mock',
        lastname: 'Lead',
        phone: '+15555550100',
        lifecyclestage: 'lead',
        createdate: '2026-05-03T00:00:00.000Z',
      },
    },
  ],
  deals: [
    {
      id: 'mock-deal-1',
      properties: {
        dealname: 'Mock Deal',
        amount: '2500',
        dealstage: 'closedwon',
        pipeline: 'default',
        closedate: '2026-05-03T00:00:00.000Z',
        deal_currency_code: 'USD',
      },
    },
  ],
};

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function asArray(value: unknown): HubspotObject[] {
  return Array.isArray(value) ? (value as HubspotObject[]) : [];
}

function text(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function numberValue(value: unknown): number | null {
  if (value == null || value === '') {
    return null;
  }

  const parsed = typeof value === 'number' ? value : Number(String(value).replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function timestamp(value: unknown): string | null {
  const raw = text(value);
  if (!raw) {
    return null;
  }

  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function propertiesOf(object: HubspotObject): Record<string, unknown> {
  return {
    ...asObject(object.properties),
  };
}

function normalizeHubspotPayload(payload: unknown): HubspotFetchedPayload {
  const objectPayload = asObject(payload) as HubspotPayload;
  if (objectPayload.mock === true) {
    return MOCK_HUBSPOT_PAYLOAD;
  }

  if (objectPayload.objectType === 'contact') {
    return {
      contacts: asArray(objectPayload.results),
      deals: [],
    };
  }

  if (objectPayload.objectType === 'deal') {
    return {
      contacts: [],
      deals: asArray(objectPayload.results),
    };
  }

  return {
    contacts: asArray(objectPayload.contacts),
    deals: asArray(objectPayload.deals),
  };
}

function syncPayloadFromCredentials(credentials: Record<string, unknown>): HubspotPayload {
  const syncPayload = credentials.sync_payload ?? credentials.mock_payload;
  if (syncPayload && typeof syncPayload === 'object' && !Array.isArray(syncPayload)) {
    return syncPayload as HubspotPayload;
  }

  if (credentials.mock === true) {
    return { mock: true };
  }

  return {
    contacts: [],
    deals: [],
  };
}

function contactName(properties: Record<string, unknown>): string | null {
  const directName = text(properties.name) ?? text(properties.fullname) ?? text(properties.full_name);
  if (directName) {
    return directName;
  }

  const firstName = text(properties.firstname) ?? text(properties.first_name);
  const lastName = text(properties.lastname) ?? text(properties.last_name);
  return [firstName, lastName].filter(Boolean).join(' ') || null;
}

function mapContact(contact: HubspotObject): Record<string, unknown> {
  const properties = propertiesOf(contact);
  const externalId = text(contact.id) ?? text(properties.hs_object_id);

  return {
    provider: 'hubspot',
    object_type: 'contact',
    external_object_id: externalId,
    external_contact_id: externalId,
    email: text(properties.email),
    phone: text(properties.phone) ?? text(properties.mobilephone),
    name: contactName(properties),
    lifecycle_stage: text(properties.lifecyclestage) ?? text(properties.lifecycle_stage),
    created_at: timestamp(properties.createdate) ?? timestamp(properties.created_at),
    updated_at: timestamp(properties.lastmodifieddate) ?? timestamp(properties.updated_at),
    source: 'hubspot',
    metadata: {
      hubspot_object_type: 'contact',
      hubspot_properties: properties,
    },
  };
}

function associationIds(deal: HubspotObject): string[] {
  const associations = asObject(deal.associations);
  const contacts = asObject(associations.contacts);
  const results = asArray(contacts.results);

  return results
    .map((item) => text(item.id))
    .filter((id): id is string => Boolean(id));
}

function mapDeal(deal: HubspotObject): Record<string, unknown> {
  const properties = propertiesOf(deal);
  const externalId = text(deal.id) ?? text(properties.hs_object_id);

  return {
    provider: 'hubspot',
    object_type: 'deal',
    external_object_id: externalId,
    external_deal_id: externalId,
    deal_name: text(properties.dealname) ?? text(properties.deal_name),
    amount: numberValue(properties.amount),
    currency: text(properties.deal_currency_code) ?? text(properties.currency) ?? 'USD',
    deal_stage: text(properties.dealstage) ?? text(properties.deal_stage),
    pipeline: text(properties.pipeline),
    closed_at: timestamp(properties.closedate) ?? timestamp(properties.close_date),
    created_at: timestamp(properties.createdate) ?? timestamp(properties.created_at),
    updated_at: timestamp(properties.hs_lastmodifieddate) ?? timestamp(properties.updated_at),
    associated_contact_ids: associationIds(deal),
    source: 'hubspot',
    metadata: {
      hubspot_object_type: 'deal',
      hubspot_properties: properties,
    },
  };
}

export const hubspotAdapter: IntegrationSourceAdapter<HubspotPayload, HubspotFetchedPayload> = {
  provider: 'hubspot',

  canHandle(provider: string): boolean {
    return provider.trim().toLowerCase() === 'hubspot';
  },

  async authenticate(input: AdapterAuthenticateInput): Promise<AdapterAuthenticateResult> {
    const credentials = input.credentials ?? {};
    const hasApiKey = Boolean(
      text(credentials.api_key) ??
      text(credentials.private_app_token) ??
      text(credentials.access_token)
    );
    const hasOauthToken = Boolean(text(credentials.access_token) ?? text(credentials.refresh_token));
    const isMock = credentials.mock === true;
    const authenticated = isMock || (input.integration.auth_type === 'oauth' ? hasOauthToken : hasApiKey);

    return {
      authenticated,
      authType: input.integration.auth_type,
      message: authenticated
        ? 'HubSpot credentials accepted by placeholder authenticator.'
        : 'HubSpot credentials missing api_key or OAuth token.',
    };
  },

  async fetch(input: AdapterFetchInput<HubspotPayload>): Promise<HubspotFetchedPayload> {
    return normalizeHubspotPayload(input.payload);
  },

  async map(input: AdapterMapInput<HubspotFetchedPayload>): Promise<UnifiedIngestionPayload> {
    const contacts = input.payload.contacts.map(mapContact);
    const deals = input.payload.deals.map(mapDeal);

    return {
      companyId: input.companyId,
      source: 'crm',
      sourceType: 'integration',
      records: [...contacts, ...deals],
      metadata: {
        ...(input.metadata ?? {}),
        provider: 'hubspot',
        adapter: 'csv',
        integration_adapter: 'hubspot',
        integration_category: 'crm',
        object_counts: {
          contacts: contacts.length,
          deals: deals.length,
        },
      },
      ingestionTimestamp: new Date().toISOString(),
    };
  },

  async ingest(input: AdapterIngestInput<HubspotPayload>): Promise<UnifiedIngestionResult> {
    const fetchedPayload = await this.fetch(input);
    const ingestionPayload = await this.map({
      companyId: input.companyId,
      provider: input.provider,
      payload: fetchedPayload,
      rawPayload: input.payload,
      metadata: input.metadata,
    });

    return ingestUnifiedData(ingestionPayload, {
      ...(input.options ?? {}),
      idempotencyKey: input.idempotencyKey,
      context: {
        ...(input.options?.context ?? {}),
        integrationProvider: 'hubspot',
        integrationEntry: 'adapter.ingest',
      },
    });
  },

  async sync(input: AdapterSyncInput<HubspotPayload>): Promise<UnifiedIngestionResult> {
    const auth = await this.authenticate({
      companyId: input.companyId,
      provider: input.provider,
      integration: input.integration,
      credentials: input.credentials,
    });

    if (!auth.authenticated) {
      throw new Error(auth.message ?? 'HubSpot authentication failed');
    }

    const fetchedPayload = await this.fetch({
      companyId: input.companyId,
      provider: input.provider,
      payload: input.payload ?? syncPayloadFromCredentials(input.credentials),
      credentials: input.credentials,
      integration: input.integration,
    });
    const ingestionPayload = await this.map({
      companyId: input.companyId,
      provider: input.provider,
      payload: fetchedPayload,
      rawPayload: input.payload,
      credentials: input.credentials,
      integration: input.integration,
      metadata: {
        integration_id: input.integration.id,
        integration_sync: true,
      },
    });

    return ingestUnifiedData(ingestionPayload, {
      ...(input.options ?? {}),
      idempotencyKey: input.idempotencyKey,
      context: {
        ...(input.options?.context ?? {}),
        integrationId: input.integration.id,
        integrationProvider: input.provider,
        integrationEntry: 'adapter.sync',
      },
    });
  },
};
