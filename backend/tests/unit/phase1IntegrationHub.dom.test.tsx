/**
 * @jest-environment jsdom
 */
/**
 * PHASE 1 — the Integration Hub navigation spine and its four new sections.
 *
 * WHAT THESE TESTS ARE FOR. Phase 1 moved navigation and added presentation; it
 * added no capability. So the properties worth pinning are the ones a later
 * change could quietly break:
 *
 *   the retired URL still works and lands on the canonical one;
 *   a tenant-owned surface still refuses to act without a chosen tenant;
 *   the compatibility entry point on `/social-platforms` still exists;
 *   the new pages reach no API, no credential store and no provider;
 *   a provider whose credential can be stored but not used is NOT offered.
 *
 * NO PROVIDER IS CALLED and no credential is created. `apiFetch` is mocked, and
 * several tests assert its call count is zero.
 */
import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react';

const apiFetchMock = jest.fn();
jest.mock('../../../lib/apiFetch', () => ({
  apiFetch: (...args: unknown[]) => apiFetchMock(...args),
}));

let ctx: Record<string, unknown> = {};
jest.mock('../../../components/CompanyContext', () => ({
  useCompanyContext: () => ctx,
}));

import IntegrationHubNav, { INTEGRATION_HUB_AREAS } from '../../../components/integrations/IntegrationHubNav';
import ProspectSourcesPage from '../../../pages/integrations/prospect-sources';
import EnrichmentProvidersPage from '../../../pages/integrations/enrichment';
import OutreachConfigurationPage from '../../../pages/integrations/outreach';
import IntelligenceProvidersPage from '../../../pages/integrations/intelligence';
import * as DataSourcesLegacy from '../../../pages/integrations/data-sources';

const TENANT_A = { company_id: '0eda0896-7814-4613-8b49-4a8f408e45f1', name: 'Ingestion Activation Test' };
const TENANT_B = { company_id: '4bdbec26-4f7e-4e77-a965-d499e1472f5c', name: 'Omnivyra' };
/** The legal owner of Omnivyra. It must behave like any other company. */
const TENANT_OWNER = { company_id: '11111111-2222-4333-8444-555555555555', name: 'Drishiq Labs' };

/** The shape `GET /api/prospect-sources/credentials` returns. */
const status = (providerId: string, displayName: string, over: Record<string, unknown> = {}) => ({
  providerId,
  displayName,
  sourceType: 'external_api',
  authMode: 'api_key',
  configured: false,
  credentialFields: {},
  operational: false,
  operationalReason: 'the tenant holds the subscription',
  ...over,
});

/** Every provider the real API returns for a storable-credential source type. */
const ALL_PROVIDERS = [
  status('apollo', 'Apollo'),
  status('clearbit', 'Clearbit'),
  status('zoominfo', 'ZoomInfo'),
  status('crunchbase', 'Crunchbase'),
  status('rapidapi', 'RapidAPI', { sourceType: 'gateway_api', authMode: 'gateway_api_key' }),
];

const ok = (providers: unknown[]) => ({
  ok: true,
  status: 200,
  json: async () => ({ providers }),
});

function selected(company: { company_id: string; name: string }, companies = [company]) {
  ctx = {
    companies,
    selectedCompanyId: company.company_id,
    selectedCompanyName: company.name,
    companySelectionAmbiguous: false,
    setSelectedCompanyId: jest.fn(),
    isLoading: false,
  };
}

function unselected(companies: Array<{ company_id: string; name: string }>) {
  ctx = {
    companies,
    selectedCompanyId: '',
    selectedCompanyName: null,
    companySelectionAmbiguous: companies.length > 1,
    setSelectedCompanyId: jest.fn(),
    isLoading: false,
  };
}

beforeEach(() => {
  apiFetchMock.mockReset();
  ctx = {};
});

// ═══════════════════════════════════════════════════════════════════════════
describe('Phase 1 — the navigation spine', () => {
  it('exposes every canonical section exactly once', () => {
    const keys = INTEGRATION_HUB_AREAS.map((a) => a.key);
    expect(keys).toEqual([
      'api', 'prospect_sources', 'enrichment', 'social', 'outreach', 'intelligence',
    ]);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('every section is a real destination — none is a dead "#" link', () => {
    for (const area of INTEGRATION_HUB_AREAS) {
      expect(area.href).not.toBe('#');
      expect(area.href.startsWith('/')).toBe(true);
    }
  });

  it('the retired product terms are gone from the navigation labels', () => {
    const labels = INTEGRATION_HUB_AREAS.map((a) => a.label).join(' | ');
    expect(labels).not.toMatch(/Data Sources/);
    expect(labels).not.toMatch(/Lead Sources/);
    expect(labels).toMatch(/Prospect Sources/);
  });

  it('points Prospect Sources and Enrichment at their own routes, not at the legacy one', () => {
    const byKey = Object.fromEntries(INTEGRATION_HUB_AREAS.map((a) => [a.key, a.href]));
    expect(byKey.prospect_sources).toBe('/integrations/prospect-sources');
    expect(byKey.enrichment).toBe('/integrations/enrichment');
    expect(byKey.social).toBe('/social-platforms');
    expect(byKey.outreach).toBe('/integrations/outreach');
    expect(byKey.intelligence).toBe('/integrations/intelligence');
    // The legacy URL stays valid but is no longer a navigation target.
    expect(Object.values(byKey)).not.toContain('/integrations/data-sources');
  });

  it('marks the active section and renders the rest as links', () => {
    render(<IntegrationHubNav active="enrichment" />);
    expect(screen.getByText('Enrichment Providers')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText('Prospect Sources')).not.toHaveAttribute('aria-current');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('Phase 1 — the legacy Data Sources URL', () => {
  it('redirects to the canonical Prospect Sources route', async () => {
    const result = await (DataSourcesLegacy as any).getServerSideProps({} as never);
    expect(result).toEqual({
      redirect: { destination: '/integrations/prospect-sources', permanent: false },
    });
  });

  it('is a temporary redirect, so the URL can be given meaning again later', async () => {
    const result = await (DataSourcesLegacy as any).getServerSideProps({} as never);
    expect(result.redirect.permanent).toBe(false);
  });

  it('cannot create configuration — it renders nothing and calls nothing', () => {
    const { container } = render(React.createElement((DataSourcesLegacy as any).default));
    expect(container.textContent).toBe('');
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  it('no longer reads a tenant from the query string', () => {
    const src = require('fs').readFileSync(
      require('path').join(process.cwd(), 'pages/integrations/data-sources.tsx'), 'utf8');
    // `?company_id=` must not become the tenant-selection architecture. It may
    // be DISCUSSED in the header; it must not be read.
    expect(src).not.toMatch(/URLSearchParams/);
    expect(src).not.toMatch(/window\.location\.search/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('Phase 1 — Prospect Sources', () => {
  it('shows the three released import sources as operational', () => {
    // PHASE 3 — the badge vocabulary is the canonical five statuses now, so
    // 'Available' became 'Operational'. Asserted on the per-row status testid so
    // the row and its status cannot drift apart.
    render(<ProspectSourcesPage />);
    // Labels now come from the canonical model, so a provider is named in ONE
    // place. `crm`'s label is its full model label, not this test's shorthand.
    for (const name of ['Manual entry', 'CSV / Excel import', 'CRM record (operator-supplied)']) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
    for (const id of ['manual', 'csv', 'crm']) {
      expect(screen.getByTestId(`status-${id}-acquisition`)).toHaveTextContent('Operational');
    }
  });

  it('shows each discovery provider at its own true status', () => {
    render(<ProspectSourcesPage />);
    expect(screen.getByText('Apollo')).toBeInTheDocument();
    expect(screen.getByText('LinkedIn / Sales Navigator')).toBeInTheDocument();
    expect(screen.getByText('Blocked')).toBeInTheDocument();
    // PHASE 4 — Apollo discovery left the `Planned` group: it is implemented and
    // callable, and not yet verified against the provider. The two providers with
    // no adapter are still planned.
    expect(screen.getByTestId('status-apollo-discovery')).toHaveTextContent('Not operational');
    expect(screen.getAllByText('Planned').length).toBe(2);
  });

  it('does NOT present ZoomInfo or Crunchbase as connectable (O-2)', () => {
    render(<ProspectSourcesPage />);
    expect(screen.getByText('ZoomInfo')).toBeInTheDocument();
    expect(screen.getByText('Crunchbase')).toBeInTheDocument();
    // No credential affordance of any kind on this page.
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByText(/Save key/i)).toBeNull();
  });

  it('reaches no API — it is presentation only', () => {
    render(<ProspectSourcesPage />);
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  it('does NOT list MarketPulse as a prospect source', () => {
    render(<ProspectSourcesPage />);
    expect(screen.queryByText(/MarketPulse/i)).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('Phase 1 — Enrichment reuses the existing tenant gate and panel', () => {
  it('with NO tenant selected it renders the picker and calls NOTHING', async () => {
    unselected([TENANT_A, TENANT_B]);
    await act(async () => { render(<EnrichmentProvidersPage />); });
    expect(screen.getByTestId('lead-sources-choose-company')).toBeInTheDocument();
    // The property that matters: no tenant ⇒ no credential request at all.
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  it('with a tenant selected it requests THAT tenant, and names it', async () => {
    selected(TENANT_A);
    apiFetchMock.mockResolvedValue(ok(ALL_PROVIDERS));
    await act(async () => { render(<EnrichmentProvidersPage />); });
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalled());
    const url = String(apiFetchMock.mock.calls[0][0]);
    expect(url).toContain('/api/prospect-sources/credentials');
    expect(url).toContain(TENANT_A.company_id);
    expect(url).not.toContain(TENANT_B.company_id);
  });

  it('offers a credential form ONLY for providers with an implemented adapter (O-2)', async () => {
    selected(TENANT_A);
    apiFetchMock.mockResolvedValue(ok(ALL_PROVIDERS));
    await act(async () => { render(<EnrichmentProvidersPage />); });
    // PHASE 3 — the credential-storable providers are now VISIBLE as planned
    // capabilities, which is more honest than hiding them. O-2 is therefore
    // asserted where it actually bites: the credential PANEL.
    await waitFor(() => expect(screen.getByTestId('lead-source-apollo')).toBeInTheDocument());
    expect(screen.getByTestId('lead-source-clearbit')).toBeInTheDocument();
    // ZoomInfo and RapidAPI declare an enrichment capability (planned), so each
    // appears as an actionless card. Crunchbase declares NO enrichment capability
    // at all, so it correctly has no card here — absence is the truthful
    // rendering, and asserting a card for it would have invented one.
    for (const id of ['zoominfo', 'rapidapi']) {
      expect(screen.queryByTestId(`lead-source-${id}`)).toBeNull();   // no form
      expect(screen.getByTestId(`enrichment-${id}`)).toBeInTheDocument(); // but visible
      expect(screen.getByTestId(`noaction-${id}-enrichment`)).toBeInTheDocument();
    }
    expect(screen.queryByTestId('enrichment-crunchbase')).toBeNull();
    expect(screen.queryByTestId('lead-source-crunchbase')).toBeNull();
  });

  it('preserves configured ≠ operational', async () => {
    selected(TENANT_A);
    apiFetchMock.mockResolvedValue(ok([status('apollo', 'Apollo', {
      configured: true, credentialFields: { api_key: '••••1234' },
    })]));
    await act(async () => { render(<EnrichmentProvidersPage />); });
    await waitFor(() => expect(screen.getByTestId('lead-source-apollo')).toBeInTheDocument());
    // A stored key must never be rendered as a VERIFIED provider. Apollo's
    // capability badge reads `Not operational`, and nothing reads `Operational`.
    expect(screen.getByTestId('status-apollo-enrichment')).toHaveTextContent('Not operational');
    expect(screen.queryByText(/^Operational$/)).toBeNull();
  });

  it('changing the selected tenant re-requests for the NEW tenant only', async () => {
    selected(TENANT_A);
    apiFetchMock.mockResolvedValue(ok(ALL_PROVIDERS));
    const view = render(<EnrichmentProvidersPage />);
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalled());

    selected(TENANT_B);
    await act(async () => { view.rerender(<EnrichmentProvidersPage />); });
    await waitFor(() => {
      const urls = apiFetchMock.mock.calls.map((c) => String(c[0]));
      expect(urls.some((u) => u.includes(TENANT_B.company_id))).toBe(true);
    });
    // Tenant A's answer must not be what Tenant B is shown. Asserted on the
    // panel's own tenant-name element rather than on the bare text, which the
    // page also renders elsewhere.
    expect(screen.getByTestId('lead-sources-tenant-name')).toHaveTextContent(TENANT_B.name);
  });

  it('a tenant change DISCARDS the previous tenant\'s in-flight edit state', async () => {
    // The A7P-C16 property, pinned here because a mutation probe proved nothing
    // else pinned it: `LeadSourcesSection` keys the panel on the tenant id, so a
    // switch REMOUNTS it. Without that key the panel would keep its own state and
    // an open key field — begun for one company — would still be open under the
    // next company's name, which is the exact shape of the original incident.
    selected(TENANT_A);
    apiFetchMock.mockResolvedValue(ok([status('apollo', 'Apollo')]));
    const view = render(<EnrichmentProvidersPage />);
    await waitFor(() => expect(screen.getByTestId('lead-source-apollo')).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /configure/i }));
    });
    expect(screen.getByTestId('key-input-apollo')).toBeInTheDocument();

    selected(TENANT_B);
    await act(async () => { view.rerender(<EnrichmentProvidersPage />); });
    await waitFor(() =>
      expect(screen.getByTestId('lead-sources-tenant-name')).toHaveTextContent(TENANT_B.name));
    // The field must be gone: it belonged to the previous tenant.
    expect(screen.queryByTestId('key-input-apollo')).not.toBeInTheDocument();
  });

  it('gives Drishiq Labs no special path whatsoever', async () => {
    selected(TENANT_OWNER);
    apiFetchMock.mockResolvedValue(ok(ALL_PROVIDERS));
    await act(async () => { render(<EnrichmentProvidersPage />); });
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalled());
    const url = String(apiFetchMock.mock.calls[0][0]);
    // Exactly one tenant-scoped request, carrying its own id like any other.
    expect(url).toContain(TENANT_OWNER.company_id);
    expect(apiFetchMock).toHaveBeenCalledTimes(1);
    // And the owner company sees the same narrowed credential panel.
    await waitFor(() => expect(screen.getByTestId('lead-source-apollo')).toBeInTheDocument());
    expect(screen.queryByTestId('lead-source-zoominfo')).toBeNull();
  });

  it('the page itself owns no tenant resolution and no credential handling', () => {
    const src = require('fs').readFileSync(
      require('path').join(process.cwd(), 'pages/integrations/enrichment.tsx'), 'utf8');
    expect(src).toMatch(/LeadSourcesSection/);
    // No second company selector, fetch, endpoint or credential store.
    expect(src).not.toMatch(/useCompanyContext|selectedCompanyId/);
    expect(src).not.toMatch(/apiFetch|fetch\(|integration_credentials|api_key/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('Phase 1 — Outreach and Intelligence state the truth and enable nothing', () => {
  it('Outreach reports email as not operational and enables no channel', () => {
    render(<OutreachConfigurationPage />);
    expect(screen.getByText('Email')).toBeInTheDocument();
    expect(screen.getAllByText('Not operational').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText(/^Operational$/)).toBeInTheDocument(); // Internal only
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  it('Outreach lists WhatsApp as a separate product, NOT an outreach transport', () => {
    render(<OutreachConfigurationPage />);
    expect(screen.getByText('WhatsApp')).toBeInTheDocument();
    expect(screen.getByText('Separate product')).toBeInTheDocument();
    expect(screen.getByText(/Not an outreach transport/)).toBeInTheDocument();
  });

  it('Outreach shows SMS, Social and Voice as future, not registered', () => {
    render(<OutreachConfigurationPage />);
    for (const name of ['SMS', 'Social', 'Voice']) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
    expect(screen.getAllByText('Future').length).toBe(3);
  });

  it('Outreach touches no transport registry', () => {
    const src = require('fs').readFileSync(
      require('path').join(process.cwd(), 'pages/integrations/outreach.tsx'), 'utf8');
    // IMPORTS and CALLS, not the words. The page's header explains that it does
    // not touch `transportRegistry`, and that sentence must not be what trips
    // the assertion — a guard satisfied by prose proves nothing.
    expect(src).not.toMatch(/from '.*transportRegistry/);
    expect(src).not.toMatch(/\bregisterTransport\s*\(/);
    expect(src).not.toMatch(/\bregisterDefaultTransports\s*\(/);
  });

  it('Intelligence is read-only and offers no credential field', () => {
    render(<IntelligenceProvidersPage />);
    expect(screen.getByText(/Read only/i)).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  it('Intelligence keeps MarketPulse as tenant-market intelligence', () => {
    render(<IntelligenceProvidersPage />);
    expect(screen.getByText('MarketPulse')).toBeInTheDocument();
    expect(screen.getByText(/Tenant-market intelligence/)).toBeInTheDocument();
    expect(screen.getByText(/not a prospect source and not an enrichment provider/i)).toBeInTheDocument();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('Phase 1 — backward compatibility and no duplicated machinery', () => {
  const read = (p: string) =>
    require('fs').readFileSync(require('path').join(process.cwd(), p), 'utf8');

  it('the /social-platforms Lead Sources tab is still registered (O-1)', () => {
    expect(read('hooks/useSocialPlatforms.tsx')).toContain("id: 'lead-sources'");
    const view = read('components/SocialPlatformsView.tsx');
    expect(view).toContain("activeTab === 'lead-sources'");
    expect(view).toContain('LeadSourcesSection');
  });

  it('the panel still renders EVERY provider when no allowlist is given', () => {
    // The compatibility surface passes no allowlist, so it must be unaffected by
    // the narrowing the hub's Enrichment page applies.
    const section = read('components/prospects/LeadSourcesSection.tsx');
    expect(section).toMatch(/providerIds\?/);
    const panel = read('components/prospects/LeadSourcesPanel.tsx');
    expect(panel).toMatch(/providerIds\s*\?\s*\n?\s*\?\s*providers\.filter|providerIds\s*$/m);
    expect(panel).toContain('const visible = providerIds');
  });

  it('no new page introduces a second credential store or provider registry', () => {
    for (const p of [
      'pages/integrations/prospect-sources.tsx',
      'pages/integrations/enrichment.tsx',
      'pages/integrations/outreach.tsx',
      'pages/integrations/intelligence.tsx',
      'pages/integrations/data-sources.tsx',
    ]) {
      const src = read(p);
      // PHASE 2 narrowed this guard rather than dropping it. A hub page may now
      // import the canonical capability model — a pure constants module with no
      // imports of its own, which is how the UI stops inferring provider state
      // from registry fragments. It may import NOTHING ELSE from the backend, so
      // every credential store, registry, adapter and I/O module stays out.
      const backendImports = [...src.matchAll(/from '([^']*\/backend\/[^']*)'/g)].map((m) => m[1]);
      for (const imported of backendImports) {
        expect(imported).toMatch(/services\/integrations\/providerCapabilityModel$/);
      }
      expect(src).not.toMatch(/require\('[^']*\/backend\//);
      // And no write/ingest primitive is invoked.
      expect(src).not.toMatch(/\b(ownedDbTable|encryptCredential|resolveUnifiedPerson|ingestLeadBatch)\s*\(/);
    }
  });

  it('no new page imports or touches a provider adapter', () => {
    for (const p of [
      'pages/integrations/prospect-sources.tsx',
      'pages/integrations/enrichment.tsx',
      'pages/integrations/outreach.tsx',
      'pages/integrations/intelligence.tsx',
    ]) {
      const src = read(p);
      // IMPORTS, not names: the Enrichment page legitimately NAMES `clearbit` in
      // its presentation allowlist. Asserting the bare word would have forced
      // that allowlist out of the page and into a duplicate registry.
      expect(src).not.toMatch(/from '.*adapters\//);
      expect(src).not.toMatch(/require\(.*adapters\//);
      expect(src).not.toMatch(/apolloEnrichmentAdapter|clearbitEnrichmentAdapter/);
    }
  });

  it('no new page implements email sender or domain configuration', () => {
    const src = read('pages/integrations/outreach.tsx');
    // It must NAME the gap without implementing it: no form, no input, no verify action.
    expect(src).not.toMatch(/<input|<form|onSubmit|verifyDomain|createSenderIdentity/);
  });
});
