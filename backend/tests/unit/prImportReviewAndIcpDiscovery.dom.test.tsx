/**
 * @jest-environment jsdom
 *
 * R3 review panel and R2 ICP discovery panel, rendered.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { SWRConfig } from 'swr';

const mockApiFetch = jest.fn();
jest.mock('@/lib/apiFetch', () => ({ apiFetch: (u: string, init?: unknown) => mockApiFetch(u, init) }));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const ImportReviewPanel = require('../../../components/prospects/ImportReviewPanel').default;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const IcpDiscoveryPanel = require('../../../components/prospects/icp/IcpDiscoveryPanel').default;

const withSwr = (ui: React.ReactElement) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{ui}</SWRConfig>
);
const json = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

const ITEM = {
  source: 'apollo', providerRecordId: 'ap-1', reason: 'name_match', matchedPersonIds: ['p1'],
  createdAt: '2026-11-01T00:00:00.000Z', expiresAt: new Date(Date.now() + 5 * 86_400_000).toISOString(),
  candidate: {
    name: 'Jane Doe', title: 'VP Marketing', company: 'Acme', location: 'London',
    profile: { shown: 'https://www.linkedin.com/in/%D1%98ane', mixedScript: true, form: 'vanity' },
    matchedOn: 'Same first and last name as an existing person. Nothing else agrees.',
  },
};

beforeEach(() => mockApiFetch.mockReset());

describe('ImportReviewPanel', () => {
  it('renders nothing when there is nothing to review', async () => {
    mockApiFetch.mockResolvedValue(json(200, { items: [], queue: { pendingRows: 0, oldestCreatedAt: null } }));
    const { container } = render(withSwr(<ImportReviewPanel companyId="c1" />));
    await waitFor(() => expect(mockApiFetch).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('shows the candidate, the basis of the hold, the mixed-script warning, and never a merge action', async () => {
    mockApiFetch.mockResolvedValue(json(200, { items: [ITEM], queue: { pendingRows: 1, oldestCreatedAt: ITEM.createdAt } }));
    render(withSwr(<ImportReviewPanel companyId="c1" />));
    expect(await screen.findByText('Jane Doe')).toBeInTheDocument();
    expect(screen.getByText(/VP Marketing · Acme · London/)).toBeInTheDocument();
    expect(screen.getByText(/Same first and last name/)).toBeInTheDocument();
    expect(screen.getByText(/Mixed scripts/)).toBeInTheDocument();
    expect(screen.getByText('https://www.linkedin.com/in/%D1%98ane', { exact: false })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /merge/i })).not.toBeInTheDocument();
    expect(screen.getByText(/never merges two people/)).toBeInTheDocument();
  });

  it('IMPORT posts one decision for that record and reports the outcome', async () => {
    mockApiFetch
      .mockResolvedValueOnce(json(200, { items: [ITEM], queue: { pendingRows: 1, oldestCreatedAt: null } }))
      .mockResolvedValueOnce(json(200, { outcomes: [{ providerRecordId: 'ap-1', status: 'imported' }] }))
      .mockResolvedValue(json(200, { items: [], queue: { pendingRows: 0, oldestCreatedAt: null } }));
    render(withSwr(<ImportReviewPanel companyId="c1" />));
    fireEvent.click(await screen.findByRole('button', { name: 'Import' }));
    await waitFor(() => expect(mockApiFetch).toHaveBeenCalledTimes(3));
    const [url, init] = mockApiFetch.mock.calls[1];
    expect(url).toBe('/api/prospect-sources/review-items?companyId=c1');
    expect(JSON.parse((init as { body: string }).body)).toEqual({ source: 'apollo', providerRecordIds: ['ap-1'], decision: 'import' });
  });

  it('a decision someone else already made is reported as such', async () => {
    mockApiFetch
      .mockResolvedValueOnce(json(200, { items: [ITEM], queue: { pendingRows: 1, oldestCreatedAt: null } }))
      .mockResolvedValueOnce(json(200, { outcomes: [{ providerRecordId: 'ap-1', status: 'not_pending' }] }))
      .mockResolvedValue(json(200, { items: [ITEM], queue: { pendingRows: 1, oldestCreatedAt: null } }));
    render(withSwr(<ImportReviewPanel companyId="c1" />));
    fireEvent.click(await screen.findByRole('button', { name: 'Skip' }));
    expect(await screen.findByText(/already decided this one, or it expired/)).toBeInTheDocument();
  });
});

describe('IcpDiscoveryPanel: nothing runs until the tenant acknowledges what the server reported', () => {
  const approxRefusal = json(400, {
    code: 'approximations_unacknowledged', error: 'x',
    blocking: [{ criterionId: 'ind', subject: 'account', attribute: 'industry', kind: 'mandatory', reason: 'industry is searched through keyword tags' }],
  });

  it('first ask -> refusal listed; confirm disabled until acknowledged; confirm re-posts WITH the acknowledgement', async () => {
    mockApiFetch
      .mockResolvedValueOnce(approxRefusal)
      .mockResolvedValueOnce(json(201, { execution: { id: 'e1' }, run: {
        status: 'completed', outcome: 'discovered', stopReason: 'provider_exhausted', resultsObserved: 10, resultsIngested: 7,
        screening: { skippedDuplicates: 2, heldForReview: 1, probeUnknown: 0 },
      } }));
    render(<IcpDiscoveryPanel companyId="c1" versionId="v1" version={3} />);
    fireEvent.click(screen.getByRole('button', { name: 'Find people' }));
    expect(await screen.findByText(/industry is searched through keyword tags/)).toBeInTheDocument();
    const confirm = screen.getByRole('button', { name: 'Confirm and search' });
    expect(confirm).toBeDisabled();
    expect(JSON.parse(mockApiFetch.mock.calls[0][1].body)).not.toHaveProperty('acknowledgeApproximations');

    fireEvent.click(screen.getByLabelText(/searched approximately/));
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    expect(await screen.findByTestId('icp-discovery-result')).toHaveTextContent(
      'Found 10, imported 7, skipped 2 duplicate(s), held 1 for review');
    const second = JSON.parse(mockApiFetch.mock.calls[1][1].body);
    expect(second).toMatchObject({ provider: 'apollo', icpVersionId: 'v1', acknowledgeApproximations: true });
    expect(second).not.toHaveProperty('acknowledgeOmissions');
  });

  it('bounds are clamped to the server caps', async () => {
    mockApiFetch.mockResolvedValueOnce(approxRefusal);
    render(<IcpDiscoveryPanel companyId="c1" versionId="v1" version={3} />);
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '99999' } });
    fireEvent.click(screen.getByRole('button', { name: 'Find people' }));
    await waitFor(() => expect(mockApiFetch).toHaveBeenCalled());
    expect(JSON.parse(mockApiFetch.mock.calls[0][1].body).bounds).toEqual({ maxPages: 5, maxResults: 500, maxProviderCalls: 5 });
  });
});

// eslint-disable-next-line @typescript-eslint/no-var-requires
const ApolloEnrichBar = require('../../../components/prospects/ApolloEnrichBar').default;

describe('ApolloEnrichBar: cost first, then the exact estimate', () => {
  const preview = { fieldGroups: ['job_role', 'company_firmographics'], funding: 'tenant_apollo_key', omnivyraCredits: 0,
    estimate: { estimatedProviderCalls: 2, calls: [], unreadable: [], estimateHash: 'h1' } };

  it('preview shows calls, groups and funding; confirm sends the SAME hash', async () => {
    mockApiFetch
      .mockResolvedValueOnce(json(200, preview))
      .mockResolvedValueOnce(json(200, { result: { providerCalls: 2, budgetExhausted: false } }));
    render(<ApolloEnrichBar companyId="c1" prospectIds={['p1', 'p2']} />);
    fireEvent.click(screen.getByRole('button', { name: 'Enrich with Apollo…' }));
    const box = await screen.findByTestId('apollo-enrich-preview');
    expect(box).toHaveTextContent('This makes 2 Apollo calls, filling: job and role, company firmographics.');
    expect(box).toHaveTextContent('billed to your own Apollo account. No Omnivyra credits are charged.');
    expect(JSON.parse(mockApiFetch.mock.calls[0][1].body)).toMatchObject({ mode: 'preview', prospectIds: ['p1', 'p2'] });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByText(/Done: 2 Apollo call\(s\) made/)).toBeInTheDocument();
    expect(JSON.parse(mockApiFetch.mock.calls[1][1].body)).toMatchObject({ mode: 'run', estimateHash: 'h1' });
  });

  it('a changed estimate (409) is shown again, and the user is told nothing was spent', async () => {
    mockApiFetch
      .mockResolvedValueOnce(json(200, preview))
      .mockResolvedValueOnce(json(409, { code: 'estimate_changed', estimate: { ...preview.estimate, estimatedProviderCalls: 3, estimateHash: 'h2' } }));
    render(<ApolloEnrichBar companyId="c1" prospectIds={['p1']} />);
    fireEvent.click(screen.getByRole('button', { name: 'Enrich with Apollo…' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm' }));
    expect(await screen.findByText(/Nothing was spent/)).toBeInTheDocument();
    expect(screen.getByTestId('apollo-enrich-preview')).toHaveTextContent('This makes 3 Apollo calls');
  });
});

describe('ApolloEnrichBar: the conversion is shown before running (owner point 3)', () => {
  it('central access shows Apollo credits = Omnivyra credits', async () => {
    mockApiFetch.mockResolvedValueOnce(json(200, { fieldGroups: ['job_role'], funding: 'central_apollo_access', vendorUnits: 3, omnivyraCredits: 45,
      estimate: { estimatedProviderCalls: 3, calls: [], unreadable: [], estimateHash: 'h' } }));
    render(<ApolloEnrichBar companyId="c1" prospectIds={['p1']} />);
    fireEvent.click(screen.getByRole('button', { name: 'Enrich with Apollo…' }));
    expect(await screen.findByTestId('apollo-enrich-cost')).toHaveTextContent('This run: ~3 Apollo credit(s) = 45 Omnivyra credits');
  });

  it('central access without a configured cost cannot be confirmed', async () => {
    mockApiFetch.mockResolvedValueOnce(json(200, { fieldGroups: ['job_role'], funding: 'central_apollo_access', vendorUnits: 1, omnivyraCredits: null,
      estimate: { estimatedProviderCalls: 1, calls: [], unreadable: [], estimateHash: 'h' } }));
    render(<ApolloEnrichBar companyId="c1" prospectIds={['p1']} />);
    fireEvent.click(screen.getByRole('button', { name: 'Enrich with Apollo…' }));
    expect(await screen.findByText(/not priced yet/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled();
  });

  it('no Apollo access at all says how to get it, and cannot be confirmed', async () => {
    mockApiFetch.mockResolvedValueOnce(json(200, { fieldGroups: ['job_role'], funding: 'no_apollo_access', vendorUnits: 1, omnivyraCredits: 0,
      estimate: { estimatedProviderCalls: 1, calls: [], unreadable: [], estimateHash: 'h' } }));
    render(<ApolloEnrichBar companyId="c1" prospectIds={['p1']} />);
    fireEvent.click(screen.getByRole('button', { name: 'Enrich with Apollo…' }));
    expect(await screen.findByText(/add your own Apollo key, or opt into central Apollo access/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled();
  });
});

// eslint-disable-next-line @typescript-eslint/no-var-requires
const CentralVendorAccessLine = require('../../../components/billing/CentralVendorAccessLine').default;

describe('public pricing line: central vendor access', () => {
  it('shows the conversion only for a vendor whose cost is configured', async () => {
    mockApiFetch.mockResolvedValueOnce(json(200, { vendors: [{ vendor: 'apollo', unit: 'credit', creditsPerUnit: 30, available: true }] }));
    render(<CentralVendorAccessLine />);
    expect(await screen.findByTestId('central-vendor-access')).toHaveTextContent('Centralized Apollo access: 30 Omnivyra credits = 1 Apollo credit.');
  });

  it('renders nothing when no vendor is priced (never advertises an unavailable option)', async () => {
    mockApiFetch.mockResolvedValueOnce(json(200, { vendors: [{ vendor: 'apollo', unit: 'credit', creditsPerUnit: null, available: false }] }));
    const { container } = render(<CentralVendorAccessLine />);
    await waitFor(() => expect(mockApiFetch).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
