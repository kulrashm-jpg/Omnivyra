/**
 * ONBOARD-001R §2/§3/§4 — provenance, freshness, review classification.
 */

jest.mock('../../db/supabaseClient', () => ({ supabase: { from: jest.fn() } }));

import { supabase } from '../../db/supabaseClient';
import {
  buildDiscoveredProvenance,
  isFieldStale,
  selectStaleFields,
  shouldRefreshDiscovery,
  getFreshnessConfig,
  type FieldProvenance,
} from '../../services/companyProfile/enrichmentProvenance';
import { getCompanyProfileProvenance } from '../../services/companyProfileProvenanceService';
import type { DiscoveredWebsiteMetadata } from '../../services/companyProfile/websiteMetadataExtractor';

const mockFrom = (supabase as any).from as jest.Mock;

const META: DiscoveredWebsiteMetadata = {
  title: 'Acme', description: 'We build things', siteName: 'Acme Inc',
  faviconUrl: 'https://acme.com/favicon.ico', logoUrl: 'https://acme.com/logo.png',
  language: 'en', country: 'US', brandColor: '#0A66C2', keywords: [], openGraph: {},
};

describe('ONBOARD-001R §2 — buildDiscoveredProvenance', () => {
  test('every present field carries full provenance', () => {
    const prov = buildDiscoveredProvenance(META, '2026-07-14T00:00:00.000Z');
    for (const f of ['favicon_url', 'logo_url', 'geography', 'description', 'language', 'brand_color', 'title', 'site_name']) {
      expect(prov[f]).toMatchObject({
        source: 'website_crawl',
        discoveredAt: '2026-07-14T00:00:00.000Z',
        lastVerified: '2026-07-14T00:00:00.000Z',
        verificationStatus: 'verified',
        fieldOrigin: 'system_discovered',
      });
      expect(['low', 'medium', 'high']).toContain(prov[f].confidence);
    }
  });

  test('absent fields are omitted', () => {
    const prov = buildDiscoveredProvenance({ ...META, logoUrl: null, country: null }, 'now');
    expect(prov.logo_url).toBeUndefined();
    expect(prov.geography).toBeUndefined();
    expect(prov.favicon_url).toBeDefined();
  });
});

describe('ONBOARD-001R §3 — freshness / incremental enrichment', () => {
  const now = Date.parse('2026-07-14T00:00:00.000Z');
  const cfg = { maxAgeMs: 30 * 24 * 60 * 60 * 1000 };
  const prov = (over: Partial<FieldProvenance>): FieldProvenance => ({
    source: 'website_crawl', confidence: 'medium', discoveredAt: '2026-07-14T00:00:00.000Z',
    lastVerified: '2026-07-14T00:00:00.000Z', verificationStatus: 'verified', fieldOrigin: 'system_discovered', ...over,
  });

  test('fresh field not stale; old field stale; missing provenance stale', () => {
    expect(isFieldStale(prov({}), now, cfg)).toBe(false);
    expect(isFieldStale(prov({ lastVerified: '2026-05-01T00:00:00.000Z' }), now, cfg)).toBe(true);
    expect(isFieldStale(undefined, now, cfg)).toBe(true);
  });

  test('user-edited fields are NEVER stale (never auto-overwritten)', () => {
    expect(isFieldStale(prov({ fieldOrigin: 'user_edited', lastVerified: '2020-01-01T00:00:00.000Z' }), now, cfg)).toBe(false);
  });

  test('selectStaleFields returns only stale ones; shouldRefreshDiscovery gates the crawl', () => {
    const map = {
      favicon_url: prov({}),                                           // fresh
      logo_url: prov({ lastVerified: '2026-05-01T00:00:00.000Z' }),    // stale
    };
    expect(selectStaleFields(map, ['favicon_url', 'logo_url', 'description'], now, cfg))
      .toEqual(['logo_url', 'description']); // stale + unknown
    expect(shouldRefreshDiscovery(map, ['favicon_url'], now, cfg)).toBe(false);
    expect(shouldRefreshDiscovery(map, ['favicon_url', 'logo_url'], now, cfg)).toBe(true);
  });

  test('freshness is configurable via env', () => {
    const prev = process.env.ENRICHMENT_FRESHNESS_DAYS;
    try {
      process.env.ENRICHMENT_FRESHNESS_DAYS = '7';
      expect(getFreshnessConfig().maxAgeMs).toBe(7 * 24 * 60 * 60 * 1000);
      process.env.ENRICHMENT_FRESHNESS_DAYS = 'garbage';
      expect(getFreshnessConfig().maxAgeMs).toBe(30 * 24 * 60 * 60 * 1000); // safe default
    } finally {
      if (prev === undefined) delete process.env.ENRICHMENT_FRESHNESS_DAYS;
      else process.env.ENRICHMENT_FRESHNESS_DAYS = prev;
    }
  });
});

describe('ONBOARD-001R §4 — company review provenance classification', () => {
  function stubProfile(row: Record<string, unknown> | null) {
    mockFrom.mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          maybeSingle: jest.fn().mockResolvedValue({ data: row }),
        }),
      }),
    });
  }

  test('classifies system_discovered / ai_enriched / user_edited / empty', async () => {
    stubProfile({
      name: 'Acme',                    // user-entered at onboarding (no trace) → user_edited
      industry: 'SaaS',                // ai_refined source → ai_enriched
      geography: 'US',                 // discovered provenance → system_discovered
      logo_url: 'https://acme.com/l.png',
      favicon_url: null,               // empty
      products_services: 'Widgets',    // user_locked → user_edited (wins)
      target_audience: null,
      brand_voice: null,
      competitors: null,
      unique_value: null,
      source: 'ai_refined',
      field_confidence: { industry: { confidence: 'high' } },
      user_locked_fields: ['products_services'],
      report_settings: { discovered_metadata: { provenance: {
        geography: { confidence: 'low', fieldOrigin: 'system_discovered' },
        logo_url: { confidence: 'medium', fieldOrigin: 'system_discovered' },
      } } },
    });

    const result = await getCompanyProfileProvenance('org1');
    const f = (name: string) => result.fields.find((x) => x.field === name)!;

    expect(f('geography').origin).toBe('system_discovered');
    expect(f('geography').confidence).toBe('low');
    expect(f('logo_url').origin).toBe('system_discovered');
    expect(f('industry').origin).toBe('ai_enriched');
    expect(f('industry').confidence).toBe('high');
    expect(f('products_services').origin).toBe('user_edited'); // locked wins
    expect(f('name').origin).toBe('ai_enriched'); // source=ai_refined, has value, no discovery/lock
    expect(f('favicon_url').origin).toBe('empty');
    // Every field is editable and carries a "why".
    for (const field of result.fields) {
      expect(field.editable).toBe(true);
      expect(field.why.length).toBeGreaterThan(0);
    }
  });

  test('missing profile → empty fields, no throw', async () => {
    stubProfile(null);
    const result = await getCompanyProfileProvenance('org1');
    expect(result.fields).toEqual([]);
  });
});
