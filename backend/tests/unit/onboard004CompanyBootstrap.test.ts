/**
 * ONBOARD-004 — canonical company bootstrap + auto-population.
 *
 * Proves the bootstrap is deterministic, fill-empty (never overwrites a
 * user/AI value), idempotent (retry/resume/replay-safe), reuses the existing
 * crawl extraction (no AI, no re-crawl), classifies fields for the profile UI
 * (§4), reads completeness from the canonical authority (§7), and never
 * creates a company (§1/§9).
 */

import {
  deriveBootstrapFields,
  classifyProfileFields,
  bootstrapCompleteness,
  bootstrapCompanyProfile,
  buildDiscoveredBundle,
  COMPANY_BOOTSTRAP_VERSION,
  type ExistingProfileSnapshot,
} from '../../services/companyBootstrapService';
import type { DiscoveredWebsiteMetadata } from '../../services/companyProfile/websiteMetadataExtractor';

const NOW = '2026-07-13T00:00:00.000Z';

const META = (over: Partial<DiscoveredWebsiteMetadata> = {}): DiscoveredWebsiteMetadata => ({
  title: 'Acme Analytics',
  description: 'Analytics for teams',
  siteName: 'Acme',
  faviconUrl: 'https://acme.com/favicon.ico',
  logoUrl: 'https://acme.com/logo.png',
  language: 'en',
  country: 'US',
  brandColor: '#1122ff',
  keywords: ['analytics', 'saas'],
  openGraph: { url: 'https://acme.com' },
  ...over,
});

/** A minimal in-memory company_profiles stub with maybeSingle/update. */
function makeSupabase(initialRow: Record<string, unknown> | null) {
  const state = { row: initialRow ? { ...initialRow } : null, updates: [] as Record<string, unknown>[] };
  const api = {
    from() {
      return {
        select() {
          return {
            eq() {
              return { maybeSingle: async () => ({ data: state.row, error: null }) };
            },
          };
        },
        update(patch: Record<string, unknown>) {
          state.updates.push(patch);
          state.row = { ...(state.row ?? {}), ...patch };
          return { eq: async () => ({ error: null }) };
        },
      };
    },
  };
  return { supabase: api as never, state };
}

describe('ONBOARD-004 §2 — deterministic fill-empty derivation (no AI)', () => {
  test('derives canonical columns from discovered metadata for an empty profile', () => {
    const d = deriveBootstrapFields({
      discovered: META(),
      existingProfile: { name: 'Acme', industry: 'SaaS' },
      verifiedWebsite: 'https://acme.com',
      now: NOW,
    });
    expect(d.columnUpdates).toEqual({
      website_url: 'https://acme.com',
      geography: 'US',
      logo_url: 'https://acme.com/logo.png',
      favicon_url: 'https://acme.com/favicon.ico',
    });
    // Columnless discovered values are preserved in the bundle (§2/§3).
    expect(d.discoveredBundle?.description).toBe('Analytics for teams');
    expect(d.discoveredBundle?.brand_color).toBe('#1122ff');
    expect(d.discoveredBundle?.seo_keywords).toEqual(['analytics', 'saas']);
  });

  test('is deterministic — same input yields byte-identical output', () => {
    const input = {
      discovered: META(),
      existingProfile: { name: 'Acme' } as ExistingProfileSnapshot,
      verifiedWebsite: 'https://acme.com',
      now: NOW,
    };
    expect(JSON.stringify(deriveBootstrapFields(input))).toBe(
      JSON.stringify(deriveBootstrapFields(input)),
    );
  });

  test('unknown/absent values leave fields empty (never fabricated)', () => {
    const d = deriveBootstrapFields({
      discovered: META({ logoUrl: null, country: null }),
      existingProfile: {},
      verifiedWebsite: null,
      now: NOW,
    });
    expect(d.columnUpdates).not.toHaveProperty('logo_url');
    expect(d.columnUpdates).not.toHaveProperty('geography');
    expect(d.columnUpdates).not.toHaveProperty('website_url');
  });
});

describe('ONBOARD-004 §2/§8 — never overwrites a user/AI value', () => {
  test('fill-empty only: present columns are untouched', () => {
    const d = deriveBootstrapFields({
      discovered: META(),
      existingProfile: {
        name: 'Acme',
        website_url: 'https://custom.example',
        logo_url: 'https://user/logo.svg',
      },
      verifiedWebsite: 'https://acme.com',
      now: NOW,
    });
    expect(d.columnUpdates).not.toHaveProperty('website_url');
    expect(d.columnUpdates).not.toHaveProperty('logo_url');
    expect(d.columnUpdates).toHaveProperty('geography', 'US');
  });

  test('user-locked fields are never proposed even when empty', () => {
    const d = deriveBootstrapFields({
      discovered: META(),
      existingProfile: { user_locked_fields: ['geography', 'logo_url'] },
      verifiedWebsite: 'https://acme.com',
      now: NOW,
    });
    expect(d.columnUpdates).not.toHaveProperty('geography');
    expect(d.columnUpdates).not.toHaveProperty('logo_url');
    expect(d.columnUpdates).toHaveProperty('favicon_url');
  });
});

describe('ONBOARD-004 §4 — field classification read-model', () => {
  test('buckets present-derived / critical-empty / optional-empty', () => {
    const bundle = buildDiscoveredBundle(META(), NOW);
    const c = classifyProfileFields(
      { name: 'Acme', website_url: 'https://acme.com', logo_url: 'https://acme.com/logo.png', favicon_url: 'https://acme.com/favicon.ico', geography: 'US' },
      bundle,
    );
    expect(c.autoFilled).toEqual(expect.arrayContaining(['website_url', 'logo_url', 'favicon_url', 'geography']));
    expect(c.userRequired).toContain('industry'); // critical + empty
    expect(c.optional).toEqual(expect.arrayContaining(['brand_voice', 'unique_value']));
    // A field that is auto-filled is not also listed as optional.
    expect(c.optional).not.toContain('geography');
  });

  test('all critical fields present → userRequired empty', () => {
    const c = classifyProfileFields(
      { name: 'Acme', website_url: 'https://acme.com', industry: 'SaaS' },
      null,
    );
    expect(c.userRequired).toEqual([]);
  });
});

describe('ONBOARD-004 §7 — completeness from the canonical authority', () => {
  test('reuses profileGaps/isComplete (no duplicate calc)', () => {
    const complete = bootstrapCompleteness('c1', 'Acme', {
      name: 'Acme', website_url: 'https://acme.com', industry: 'SaaS', overall_confidence: 80,
    });
    expect(complete.isComplete).toBe(true);

    const incomplete = bootstrapCompleteness('c2', 'Beta', { name: 'Beta' });
    expect(incomplete.isComplete).toBe(false);
    expect(incomplete.gaps).toEqual(expect.arrayContaining(['MISSING_WEBSITE', 'MISSING_INDUSTRY']));
  });
});

describe('ONBOARD-004 §1/§8 — apply: bootstrap, idempotency, resume', () => {
  test('bootstraps an empty profile, fills columns + stamps marker', async () => {
    const { supabase, state } = makeSupabase({
      company_id: 'c1', name: 'Acme', industry: 'SaaS', website_url: null,
      logo_url: null, favicon_url: null, geography: null, report_settings: {},
    });
    const r = await bootstrapCompanyProfile('c1', { supabase, discovered: META(), verifiedWebsite: 'https://acme.com', now: NOW });
    expect(r.ok).toBe(true);
    expect(r.applied).toBe(true);
    expect(r.reason).toBe('bootstrapped');
    expect(r.appliedFields).toEqual(expect.arrayContaining(['website_url', 'geography', 'logo_url', 'favicon_url']));
    const written = state.updates[0];
    expect((written.report_settings as Record<string, unknown>).bootstrap).toMatchObject({
      version: COMPANY_BOOTSTRAP_VERSION, source: 'company_bootstrap_service',
    });
    expect((written.report_settings as Record<string, unknown>).discovered_metadata).toBeTruthy();
  });

  test('idempotent: a second identical run writes nothing', async () => {
    const { supabase, state } = makeSupabase({
      company_id: 'c1', name: 'Acme', industry: 'SaaS', website_url: null,
      logo_url: null, favicon_url: null, geography: null, report_settings: {},
    });
    await bootstrapCompanyProfile('c1', { supabase, discovered: META(), verifiedWebsite: 'https://acme.com', now: NOW });
    const countAfterFirst = state.updates.length;
    const second = await bootstrapCompanyProfile('c1', { supabase, discovered: META(), verifiedWebsite: 'https://acme.com', now: NOW });
    expect(second.reason).toBe('already_bootstrapped');
    expect(second.applied).toBe(false);
    expect(state.updates.length).toBe(countAfterFirst); // no additional write
  });

  test('resume/replay: a profile already fully filled just stamps the marker once', async () => {
    const { supabase, state } = makeSupabase({
      company_id: 'c1', name: 'Acme', industry: 'SaaS',
      website_url: 'https://acme.com', logo_url: 'https://acme.com/logo.png',
      favicon_url: 'https://acme.com/favicon.ico', geography: 'US',
      report_settings: { discovered_metadata: buildDiscoveredBundle(META(), NOW) },
    });
    const r = await bootstrapCompanyProfile('c1', { supabase, discovered: META(), verifiedWebsite: 'https://acme.com', now: NOW });
    expect(r.applied).toBe(false);
    expect(r.reason).toBe('no_write_needed'); // marker stamped, no columns filled
    expect(state.updates.length).toBe(1);
  });
});

describe('ONBOARD-004 §1/§9 — never creates a company', () => {
  test('no profile row → no-op, no write', async () => {
    const { supabase, state } = makeSupabase(null);
    const r = await bootstrapCompanyProfile('missing', { supabase, discovered: META(), now: NOW });
    expect(r.reason).toBe('no_profile');
    expect(r.applied).toBe(false);
    expect(state.updates.length).toBe(0);
  });
});

describe('ONBOARD-004 §5/§6 — reuse existing assets/social (idempotent)', () => {
  test('existing social/asset columns are treated as already-filled', () => {
    const d = deriveBootstrapFields({
      discovered: META(),
      existingProfile: {
        name: 'Acme',
        logo_url: 'https://acme.com/existing-logo.png',
        linkedin_url: 'https://linkedin.com/company/acme',
      },
      verifiedWebsite: 'https://acme.com',
      now: NOW,
    });
    expect(d.columnUpdates).not.toHaveProperty('logo_url');
    // classification still recognises the pre-existing social/asset as auto-filled
    expect(d.classification.autoFilled).toEqual(expect.arrayContaining(['logo_url', 'linkedin_url']));
  });
});
