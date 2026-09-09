/**
 * @jest-environment jsdom
 */
/**
 * A7P-C16 — the Lead Sources UI names its tenant, and never guesses one.
 *
 * WHAT WENT WRONG. An Apollo API key was stored against the wrong company. No
 * server rule failed: the operator administers both companies,
 * `requireExternalApiAccess` verified the tenant it was handed, and the key was
 * written exactly where it was told. What failed was upstream of all of that —
 * the panel said "this company" without naming it, and the id it used came from
 * a fallback chain ending in `companyIds[0]`. The operator read a correct
 * status for one company while believing it described the other.
 *
 * These tests hold the two properties that make that impossible to repeat:
 * the tenant is VISIBLE, and an ambiguous tenant produces NO request at all.
 *
 * The scenario is the real one — the platform's only multi-membership user
 * administers exactly two companies, one of which is the pilot.
 */
import React from 'react';
import { render, screen, act, waitFor } from '@testing-library/react';

const apiFetchMock = jest.fn();
jest.mock('../../../lib/apiFetch', () => ({
  apiFetch: (...args: unknown[]) => apiFetchMock(...args),
}));

let ctx: Record<string, unknown> = {};
jest.mock('../../../components/CompanyContext', () => ({
  useCompanyContext: () => ctx,
}));

import LeadSourcesSection from '../../../components/prospects/LeadSourcesSection';
import LeadSourcesPanel from '../../../components/prospects/LeadSourcesPanel';

// The real pair, from production. TENANT_B is where the key wrongly landed.
const TENANT_A = { company_id: '0eda0896-7814-4613-8b49-4a8f408e45f1', name: 'Ingestion Activation Test' };
const TENANT_B = { company_id: '4bdbec26-4f7e-4e77-a965-d499e1472f5c', name: 'Omnivyra' };

const apolloStatus = (configured: boolean) => ({
  providerId: 'apollo',
  displayName: 'Apollo',
  authMode: 'api_key',
  configured,
  credentialFields: configured ? { api_key: '••••1234' } : {},
  operational: false,
  operationalReason: 'no credential configured',
});

/** Answer each GET according to the tenant the URL actually names. */
function respondPerTenant(configuredFor: string[]) {
  apiFetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (init?.method && init.method !== 'GET') {
      return { ok: true, status: 200, json: async () => ({ provider: apolloStatus(true) }) };
    }
    const configured = configuredFor.some((id) => url.includes(id));
    return { ok: true, status: 200, json: async () => ({ providers: [apolloStatus(configured)] }) };
  });
}

const baseCtx = (over: Record<string, unknown> = {}) => ({
  companies: [TENANT_A, TENANT_B],
  selectedCompanyId: '',
  selectedCompanyName: '',
  companySelectionAmbiguous: false,
  setSelectedCompanyId: jest.fn(),
  isLoading: false,
  ...over,
});

beforeEach(() => {
  apiFetchMock.mockReset();
  respondPerTenant([]);
  ctx = baseCtx();
});

// ───────────────────────────────────────────────────────────────────────────
describe('A7P-C16 / Test 1 — the tenant is visible', () => {
  it('names the selected company above the providers it governs', async () => {
    respondPerTenant([TENANT_A.company_id]);
    ctx = baseCtx({
      selectedCompanyId: TENANT_A.company_id,
      selectedCompanyName: TENANT_A.name,
    });

    await act(async () => { render(<LeadSourcesSection />); });

    await waitFor(() => expect(screen.getByTestId('lead-sources-tenant')).toBeTruthy());
    expect(screen.getByTestId('lead-sources-tenant-name').textContent).toBe(TENANT_A.name);
    // The id is carried in the DOM too, so the assertion is about identity and
    // not merely about a display string that happens to match.
    expect(screen.getByTestId('lead-sources-tenant').getAttribute('data-company-id'))
      .toBe(TENANT_A.company_id);
  });

  it('the panel alone still names whatever tenant it is handed', async () => {
    respondPerTenant([TENANT_B.company_id]);
    await act(async () => {
      render(<LeadSourcesPanel companyId={TENANT_B.company_id} companyName={TENANT_B.name} />);
    });
    await waitFor(() => expect(screen.getByTestId('lead-sources-tenant-name').textContent).toBe(TENANT_B.name));
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('A7P-C16 / Tests 2 + 7 — no silent first-company fallback', () => {
  it('MULTI-MEMBERSHIP, no choice: no request, no credential operation, no implicit companyIds[0]', async () => {
    ctx = baseCtx({ selectedCompanyId: '', companySelectionAmbiguous: true });

    await act(async () => { render(<LeadSourcesSection />); });

    // The decisive assertion: nothing was asked of the server at all.
    expect(apiFetchMock).not.toHaveBeenCalled();
    // And specifically not for the company that used to be picked implicitly.
    const urls = apiFetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes(TENANT_A.company_id))).toBe(false);
    expect(urls.some((u) => u.includes(TENANT_B.company_id))).toBe(false);

    expect(screen.getByTestId('lead-sources-choose-company')).toBeTruthy();
    // Both memberships are offered as an explicit choice.
    expect(screen.getByTestId(`choose-company-${TENANT_A.company_id}`)).toBeTruthy();
    expect(screen.getByTestId(`choose-company-${TENANT_B.company_id}`)).toBeTruthy();
  });

  it('the panel refuses to act without a tenant even if mounted directly', async () => {
    await act(async () => { render(<LeadSourcesPanel companyId={null} companyName={null} />); });
    expect(apiFetchMock).not.toHaveBeenCalled();
    expect(screen.getByTestId('lead-sources-no-tenant')).toBeTruthy();
  });

  it('choosing a company goes through the context’s membership-validating setter', async () => {
    const setSelectedCompanyId = jest.fn();
    ctx = baseCtx({ selectedCompanyId: '', companySelectionAmbiguous: true, setSelectedCompanyId });

    await act(async () => { render(<LeadSourcesSection />); });
    await act(async () => {
      screen.getByTestId(`choose-company-${TENANT_A.company_id}`).click();
    });

    expect(setSelectedCompanyId).toHaveBeenCalledWith(TENANT_A.company_id);
    // No second selection system: the component never sets an id itself.
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  it('a SINGLE membership still resolves without a prompt', async () => {
    respondPerTenant([TENANT_A.company_id]);
    ctx = baseCtx({
      companies: [TENANT_A],
      selectedCompanyId: TENANT_A.company_id,
      selectedCompanyName: TENANT_A.name,
    });
    await act(async () => { render(<LeadSourcesSection />); });
    await waitFor(() => expect(screen.getByTestId('lead-sources-tenant-name').textContent).toBe(TENANT_A.name));
    // One company is not ambiguous, so no switcher is offered.
    expect(screen.queryByTestId('lead-sources-company-switcher')).toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('A7P-C16 / Test 3 — switching tenant refetches for the new tenant', () => {
  it('re-requests status for B and never reuses A’s answer', async () => {
    respondPerTenant([TENANT_A.company_id]);   // A configured, B not
    const { rerender } = render(
      <LeadSourcesPanel companyId={TENANT_A.company_id} companyName={TENANT_A.name} />,
    );
    await waitFor(() => expect(screen.getByTestId('state-apollo').textContent).toContain('Configured'));

    apiFetchMock.mockClear();
    await act(async () => {
      rerender(<LeadSourcesPanel companyId={TENANT_B.company_id} companyName={TENANT_B.name} />);
    });

    await waitFor(() => expect(apiFetchMock).toHaveBeenCalled());
    const urls = apiFetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.every((u) => u.includes(TENANT_B.company_id))).toBe(true);
    expect(urls.some((u) => u.includes(TENANT_A.company_id))).toBe(false);

    // B is not configured, so A's badge must not survive the switch.
    await waitFor(() => expect(screen.getByTestId('state-apollo').textContent).toContain('Not configured'));
    expect(screen.getByTestId('lead-sources-tenant-name').textContent).toBe(TENANT_B.name);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('A7P-C16 / Test 4 — configured status is isolated per tenant', () => {
  it('A shows Configured and B shows Not configured, from the same store', async () => {
    respondPerTenant([TENANT_B.company_id]);   // matches production: B holds the key

    const a = render(<LeadSourcesPanel companyId={TENANT_A.company_id} companyName={TENANT_A.name} />);
    await waitFor(() => expect(a.getByTestId('state-apollo').textContent).toContain('Not configured'));
    a.unmount();

    const b = render(<LeadSourcesPanel companyId={TENANT_B.company_id} companyName={TENANT_B.name} />);
    await waitFor(() => expect(b.getByTestId('state-apollo').textContent).toContain('Configured'));
    // The status is rendered beside the tenant it describes — the pairing that
    // was missing when this defect occurred.
    expect(b.getByTestId('lead-sources-tenant-name').textContent).toBe(TENANT_B.name);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('A7P-C16 / Test 5 — a credential operation targets the displayed tenant', () => {
  it('the PUT carries the displayed company id and never the other one', async () => {
    respondPerTenant([]);
    await act(async () => {
      render(<LeadSourcesPanel companyId={TENANT_B.company_id} companyName={TENANT_B.name} />);
    });
    await waitFor(() => expect(screen.getByTestId('state-apollo')).toBeTruthy());

    await act(async () => { screen.getByText('Configure').click(); });
    const input = document.querySelector('input') as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, 'synthetic-not-a-real-key');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    apiFetchMock.mockClear();
    await act(async () => { screen.getByText('Save key').click(); });
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalled());

    const put = apiFetchMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === 'PUT');
    expect(put).toBeDefined();
    const url = String(put![0]);
    expect(url).toContain(`companyId=${TENANT_B.company_id}`);
    expect(url).not.toContain(TENANT_A.company_id);
    // The tenant travels in the URL only — never in the body beside the secret.
    const body = String((put![1] as RequestInit).body);
    expect(body).not.toContain(TENANT_A.company_id);
    expect(body).not.toContain(TENANT_B.company_id);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('A7P-C16 — the resolution rule itself', () => {
  const src = (): string => require('fs').readFileSync(
    require('path').join(__dirname, '../../../components/CompanyContext.tsx'), 'utf8');

  it('no resolution path ends in an unguarded companyIds[0]', () => {
    // A source guard, because the provider's own resolution runs behind auth,
    // storage and network seams that a component test cannot reach honestly.
    // Every surviving `companyIds[0]` must be the SINGLE-membership case.
    const lines = src().split('\n')
      .filter((l) => l.includes('companyIds[0]') && !l.trim().startsWith('*') && !l.trim().startsWith('//'));
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      // `defaultCompanyId` is a descriptive field on the user object, not a
      // selection; the selection sites must be length-gated.
      const isSelection = !line.includes('defaultCompanyId');
      if (isSelection) {
        expect([line, line.includes('companyIds.length === 1')]).toEqual([line, true]);
      }
    }
  });

  it('ambiguity is expressed, and cleared by an explicit choice', () => {
    const s = src();
    expect(s).toMatch(/companySelectionAmbiguous:\s*boolean/);
    expect(s).toMatch(/setCompanySelectionAmbiguous\(!resolvedId && companyIds\.length > 1\)/);
    // The explicit setter must clear it, or a chosen tenant would still read
    // as ambiguous and the panel would refuse to render.
    expect(s).toMatch(/setCompanySelectionAmbiguous\(false\)/);
  });
});
