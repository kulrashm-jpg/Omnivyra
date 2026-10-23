/**
 * @jest-environment jsdom
 */
/**
 * PHASE 3 — existing provider capabilities, exposed truthfully through the Hub.
 *
 * WHAT THESE DEFEND. Phase 3 added no capability, so the risk is not a broken
 * feature — it is a surface that OVERSTATES one. Every test below pins something
 * the UI must not claim: no connect action without a connectable capability, no
 * "operational" without layer-D evidence, no second Apollo identity, no Clearbit
 * regression, and no tenant-owned state before a tenant is chosen.
 *
 * NO PROVIDER IS CALLED. `apiFetch` is mocked and several tests assert zero calls.
 */
import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, act, waitFor } from '@testing-library/react';

const apiFetchMock = jest.fn();
jest.mock('../../../lib/apiFetch', () => ({
  apiFetch: (...args: unknown[]) => apiFetchMock(...args),
}));

let ctx: Record<string, unknown> = {};
jest.mock('../../../components/CompanyContext', () => ({
  useCompanyContext: () => ctx,
}));

import ProspectSourcesPage from '../../../pages/integrations/prospect-sources';
import EnrichmentProvidersPage from '../../../pages/integrations/enrichment';
import {
  buildCapabilityCard,
  buildCapabilityCards,
  isCapabilityConnectable,
  mayOfferCredentialForm,
  describeBlockedReason,
} from '../../services/integrations/providerCapabilityModel';

const TENANT_A = { company_id: '0eda0896-7814-4613-8b49-4a8f408e45f1', name: 'Ingestion Activation Test' };
const TENANT_B = { company_id: '4bdbec26-4f7e-4e77-a965-d499e1472f5c', name: 'Omnivyra' };
const TENANT_OWNER = { company_id: '11111111-2222-4333-8444-555555555555', name: 'Drishiq Labs' };

const status = (providerId: string, displayName: string, over: Record<string, unknown> = {}) => ({
  providerId, displayName, sourceType: 'external_api', authMode: 'api_key',
  configured: false, credentialFields: {}, operational: false,
  operationalReason: 'the tenant holds the subscription', ...over,
});

const ALL_PROVIDERS = [
  status('apollo', 'Apollo'), status('clearbit', 'Clearbit'),
  status('zoominfo', 'ZoomInfo'), status('crunchbase', 'Crunchbase'),
  status('rapidapi', 'RapidAPI', { sourceType: 'gateway_api', authMode: 'gateway_api_key' }),
];

const ok = (providers: unknown[]) => ({ ok: true, status: 200, json: async () => ({ providers }) });

function selected(company: { company_id: string; name: string }) {
  ctx = {
    companies: [company], selectedCompanyId: company.company_id,
    selectedCompanyName: company.name, companySelectionAmbiguous: false,
    setSelectedCompanyId: jest.fn(), isLoading: false,
  };
}
function unselected(companies: Array<{ company_id: string; name: string }>) {
  ctx = {
    companies, selectedCompanyId: '', selectedCompanyName: null,
    companySelectionAmbiguous: companies.length > 1,
    setSelectedCompanyId: jest.fn(), isLoading: false,
  };
}

beforeEach(() => { apiFetchMock.mockReset(); ctx = {}; });

// ═══════════════════════════════════════════════════════════════════════════
describe('Phase 3 — the canonical card view model', () => {
  it('a card carries all four layers and never invents one', () => {
    const card = buildCapabilityCard('apollo', 'enrichment')!;
    expect(card.providerId).toBe('apollo');
    expect(card.capability).toBe('enrichment');
    expect(card.implemented).toBe(true);     // B
    expect(card.executable).toBe(true);      // B
    expect(card.tenantConfigurable).toBe(true); // C
    expect(card.status).toBe('not_operational'); // D says unverified
    expect(card.connectable).toBe(true);
    expect(card.action).toBe('configure');
  });

  it('credential state is the CALLER\'s fact — unknown without a tenant', () => {
    expect(buildCapabilityCard('apollo', 'enrichment')!.credentialState).toBe('unknown');
    expect(buildCapabilityCard('apollo', 'enrichment', { credentialed: false })!.credentialState)
      .toBe('not_configured');
    expect(buildCapabilityCard('apollo', 'enrichment', { credentialed: true })!.credentialState)
      .toBe('configured');
  });

  it('a stored credential does NOT change capability, status or action', () => {
    const without = buildCapabilityCard('apollo', 'enrichment', { credentialed: false })!;
    const withKey = buildCapabilityCard('apollo', 'enrichment', { credentialed: true })!;
    // The credential ⇒ capability inference, refused.
    expect(withKey.status).toBe(without.status);
    expect(withKey.implemented).toBe(without.implemented);
    expect(withKey.executable).toBe(without.executable);
    expect(withKey.action).toBe(without.action);
    expect(withKey.status).not.toBe('operational');
  });

  it('a provider taking no credential reports not_applicable, not "none stored"', () => {
    for (const id of ['manual', 'csv', 'crm']) {
      const card = buildCapabilityCard(id, 'acquisition')!;
      expect(card.credentialState).toBe('not_applicable');
      expect(card.action).toBe('none');
      expect(card.status).toBe('operational');
    }
  });

  it('an undeclared pair has no card at all', () => {
    expect(buildCapabilityCard('apollo', 'engagement')).toBeNull();
    expect(buildCapabilityCard('marketpulse', 'enrichment')).toBeNull();
  });

  it('CONNECTABLE is per CAPABILITY, not per provider', () => {
    // Until Phase 4, Apollo demonstrated this by contrast: the provider was
    // configurable while its discovery capability was not connectable. Discovery
    // is now implemented, so BOTH of Apollo's capabilities are connectable and
    // that contrast is gone.
    expect(mayOfferCredentialForm('apollo')).toBe(true);       // provider-level
    expect(isCapabilityConnectable('apollo', 'enrichment')).toBe(true);
    expect(isCapabilityConnectable('apollo', 'discovery')).toBe(true);

    // The distinction still holds and is still load-bearing: a capability the
    // provider does not declare is not connectable, however configurable the
    // provider is. Provider-level true, capability-level false.
    expect(isCapabilityConnectable('apollo', 'engagement')).toBe(false);
    expect(isCapabilityConnectable('apollo', 'acquisition')).toBe(false);
  });

  it('only an implemented AND executable discovery capability is connectable', () => {
    const byId = Object.fromEntries(buildCapabilityCards('discovery').map((c) => [c.providerId, c]));
    // Phase 4 implemented exactly one.
    expect(byId.apollo.connectable).toBe(true);
    expect(byId.apollo.action).toBe('configure');
    // Everything else still has no adapter, so no connect action is offered.
    for (const id of ['zoominfo', 'crunchbase', 'linkedin_sales_navigator']) {
      expect(byId[id].connectable).toBe(false);
      expect(byId[id].action).toBe('none');
    }
  });

  it('a blocked capability explains itself in the frozen vocabulary', () => {
    const card = buildCapabilityCard('linkedin_sales_navigator', 'discovery')!;
    expect(card.status).toBe('blocked');
    expect(card.reason).toBe(describeBlockedReason('provider_terms_review'));
    expect(card.reason).toMatch(/not an engineering task/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('Phase 3 — Prospect Sources exposes capability, not availability', () => {
  it('renders the five canonical statuses, never an "available/unavailable" flag', () => {
    render(<ProspectSourcesPage />);
    expect(screen.getByTestId('status-manual-acquisition')).toHaveTextContent('Operational');
    // PHASE 4 — Apollo discovery moved from `Planned` to `Not operational`.
    expect(screen.getByTestId('status-apollo-discovery')).toHaveTextContent('Not operational');
    expect(screen.getByTestId('status-zoominfo-discovery')).toHaveTextContent('Planned');
    expect(screen.getByTestId('status-linkedin_sales_navigator-discovery'))
      .toHaveTextContent('Blocked');
    expect(screen.queryByText(/^Unavailable$/)).toBeNull();
    expect(screen.queryByText(/^Available$/)).toBeNull();
  });

  it('offers a CONFIGURE action only for the implemented discovery provider', () => {
    render(<ProspectSourcesPage />);
    // PHASE 4 — Apollo discovery is connectable, so it gets a configure action
    // that points at the single Apollo credential surface.
    expect(screen.getByTestId('action-apollo-discovery')).toHaveTextContent('Configure Apollo key');
    // Everything with no adapter still gets no configure action.
    for (const id of ['linkedin_sales_navigator', 'zoominfo', 'crunchbase']) {
      expect(screen.queryByTestId(`action-${id}-discovery`)).toBeNull();
    }
    // ZoomInfo and Crunchbase have nowhere to send anyone, so they say so.
    // Sales Navigator instead links across to the social surface, which is a
    // different capability — so it has a link rather than a no-action label.
    for (const id of ['zoominfo', 'crunchbase']) {
      expect(screen.getByTestId(`noaction-${id}-discovery`)).toBeInTheDocument();
    }
    expect(screen.getByTestId('source-linkedin_sales_navigator-discovery'))
      .toHaveTextContent(/Social Platforms/);
    // Configuring is not executing: no EXECUTION affordance exists on this page,
    // and the page still reaches no API.
    expect(screen.queryByText(/Execute|Enrich now|Test connection|Run discovery|Search now/i)).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  it('shows the blocked reason for Sales Navigator rather than hiding it', () => {
    render(<ProspectSourcesPage />);
    expect(screen.getByTestId('reason-linkedin_sales_navigator-discovery'))
      .toHaveTextContent(/provider terms review/i);
  });

  it('ZoomInfo and Crunchbase are visible with NO action', () => {
    render(<ProspectSourcesPage />);
    for (const id of ['zoominfo', 'crunchbase']) {
      expect(screen.getByTestId(`source-${id}-discovery`)).toBeInTheDocument();
      expect(screen.getByTestId(`noaction-${id}-discovery`)).toHaveTextContent('No action available');
    }
  });

  it('Apollo discovery points at the ONE Apollo credential, not a second form', () => {
    render(<ProspectSourcesPage />);
    const row = screen.getByTestId('source-apollo-discovery');
    // One provider identity, two capabilities, one credential — so the discovery
    // row sends the operator to the existing credential surface.
    expect(row).toHaveTextContent(/Configure Apollo key/);
    expect(screen.getByTestId('action-apollo-discovery')).toHaveAttribute(
      'href', '/integrations/enrichment');
    expect(screen.getByTestId('status-apollo-discovery')).toHaveTextContent('Not operational');
  });

  it('does NOT list MarketPulse', () => {
    render(<ProspectSourcesPage />);
    expect(screen.queryByText(/MarketPulse/i)).toBeNull();
  });

  it('the page asserts no state of its own', () => {
    const src = require('fs').readFileSync(
      require('path').join(process.cwd(), 'pages/integrations/prospect-sources.tsx'), 'utf8');
    expect(src).toMatch(/buildCapabilityCard/);
    // No hand-written status, and no local availability flag.
    expect(src).not.toMatch(/state:\s*'(available|planned|blocked)'/);
    expect(src).not.toMatch(/available:\s*(true|false)/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('Phase 3 — Enrichment exposes Apollo and Clearbit truthfully', () => {
  it('both implemented providers show capability, callability and runtime apart', async () => {
    selected(TENANT_A);
    apiFetchMock.mockResolvedValue(ok(ALL_PROVIDERS));
    await act(async () => { render(<EnrichmentProvidersPage />); });
    for (const id of ['apollo', 'clearbit']) {
      const card = screen.getByTestId(`enrichment-${id}`);
      expect(card).toHaveTextContent('Implemented');
      expect(card).toHaveTextContent('Not verified');
      expect(screen.getByTestId(`status-${id}-enrichment`)).toHaveTextContent('Not operational');
    }
  });

  it('Clearbit is NOT regressed to "not implemented" by being unverified', async () => {
    selected(TENANT_A);
    apiFetchMock.mockResolvedValue(ok(ALL_PROVIDERS));
    await act(async () => { render(<EnrichmentProvidersPage />); });
    const card = screen.getByTestId('enrichment-clearbit');
    expect(card).toHaveTextContent('Implemented');
    expect(card).not.toHaveTextContent('Not implemented');
    // And it reaches the credential panel.
    await waitFor(() => expect(screen.getByTestId('lead-source-clearbit')).toBeInTheDocument());
  });

  it('planned providers are visible and actionless', async () => {
    selected(TENANT_A);
    apiFetchMock.mockResolvedValue(ok(ALL_PROVIDERS));
    await act(async () => { render(<EnrichmentProvidersPage />); });
    for (const id of ['zoominfo', 'rapidapi']) {
      expect(screen.getByTestId(`status-${id}-enrichment`)).toHaveTextContent('Planned');
      expect(screen.getByTestId(`noaction-${id}-enrichment`)).toBeInTheDocument();
      expect(screen.queryByTestId(`lead-source-${id}`)).toBeNull();
    }
  });

  it('no Execute / Test connection / Enrich now affordance exists anywhere', async () => {
    selected(TENANT_A);
    apiFetchMock.mockResolvedValue(ok(ALL_PROVIDERS));
    await act(async () => { render(<EnrichmentProvidersPage />); });
    expect(screen.queryByText(/Execute|Test connection|Enrich now|Run enrichment/i)).toBeNull();
  });

  it('the page asserts no provider state of its own', () => {
    const src = require('fs').readFileSync(
      require('path').join(process.cwd(), 'pages/integrations/enrichment.tsx'), 'utf8');
    expect(src).toMatch(/credentialFormProviderIds\(\)/);
    expect(src).toMatch(/buildCapabilityCards\('enrichment'\)/);
    // No literal provider allowlist, and no second credential mechanism.
    expect(src).not.toMatch(/\['apollo',\s*'clearbit'\]/);
    expect(src).not.toMatch(/apiFetch|integration_credentials|encryptCredential/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('Phase 3 — tenant isolation on the exposed surface', () => {
  it('NO tenant: the picker shows and no credential is fetched', async () => {
    unselected([TENANT_A, TENANT_B]);
    await act(async () => { render(<EnrichmentProvidersPage />); });
    expect(screen.getByTestId('lead-sources-choose-company')).toBeInTheDocument();
    expect(apiFetchMock).not.toHaveBeenCalled();
    // Capability cards still render — they are static, platform-owned facts.
    expect(screen.getByTestId('enrichment-apollo')).toBeInTheDocument();
    // But nothing claims a configuration state for a tenant nobody chose.
    expect(screen.queryByText(/^Configured$/)).toBeNull();
  });

  it('Tenant A: the request carries A and not B', async () => {
    selected(TENANT_A);
    apiFetchMock.mockResolvedValue(ok(ALL_PROVIDERS));
    await act(async () => { render(<EnrichmentProvidersPage />); });
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalled());
    const url = String(apiFetchMock.mock.calls[0][0]);
    expect(url).toContain(TENANT_A.company_id);
    expect(url).not.toContain(TENANT_B.company_id);
  });

  it('switching tenant re-requests for the new tenant and renames the surface', async () => {
    selected(TENANT_A);
    apiFetchMock.mockResolvedValue(ok(ALL_PROVIDERS));
    const view = render(<EnrichmentProvidersPage />);
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalled());

    selected(TENANT_B);
    await act(async () => { view.rerender(<EnrichmentProvidersPage />); });
    await waitFor(() =>
      expect(screen.getByTestId('lead-sources-tenant-name')).toHaveTextContent(TENANT_B.name));
    expect(apiFetchMock.mock.calls.map((c) => String(c[0])).some((u) => u.includes(TENANT_B.company_id)))
      .toBe(true);
  });

  it('Drishiq Labs follows exactly the same path as any other tenant', async () => {
    selected(TENANT_OWNER);
    apiFetchMock.mockResolvedValue(ok(ALL_PROVIDERS));
    await act(async () => { render(<EnrichmentProvidersPage />); });
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalled());
    expect(apiFetchMock).toHaveBeenCalledTimes(1);
    expect(String(apiFetchMock.mock.calls[0][0])).toContain(TENANT_OWNER.company_id);
    // Same cards, same narrowing, no extra provider.
    expect(screen.getByTestId('enrichment-apollo')).toBeInTheDocument();
    expect(screen.queryByTestId('lead-source-zoominfo')).toBeNull();
  });

  it('neither Hub page imports anything but the capability model from the backend', () => {
    const read = (p: string) =>
      require('fs').readFileSync(require('path').join(process.cwd(), p), 'utf8');
    for (const p of ['pages/integrations/prospect-sources.tsx', 'pages/integrations/enrichment.tsx']) {
      const imports = [...read(p).matchAll(/from '([^']*\/backend\/[^']*)'/g)].map((m) => m[1]);
      for (const i of imports) expect(i).toMatch(/services\/integrations\/providerCapabilityModel$/);
    }
  });
});
