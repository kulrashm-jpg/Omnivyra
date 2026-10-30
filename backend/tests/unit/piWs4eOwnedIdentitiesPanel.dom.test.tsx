/**
 * @jest-environment jsdom
 *
 * WS-4E — the owned engagement identities panel.
 *
 * The panel is a minimal company-admin surface over two already-shipped routes:
 * `GET /api/prospect-identity/owned-identity-candidates` and
 * `GET/POST/DELETE /api/prospect-identity/owned-identities`.
 *
 * ─── WHAT IS NOT RE-LITIGATED HERE ────────────────────────────────────────
 * The backend contract is already covered by `piWs4bOwnedIdentityRoutes`,
 * `piWs4aAttestedIdentityRegistry` and `piWs4cOwnedIdentityNormalization`:
 * method gating, uuid validation, tenant verification, the `PROSPECT_INGEST`
 * capability on every method, the named `server_owned_field` 400, the
 * `confirmed: true` requirement, the cross-tenant 404, the fail-closed 503 and
 * the server-side re-resolution of the candidate id.
 *
 * In particular, THAT AN ORDINARY MEMBER CANNOT CIRCUMVENT THIS UI BY CALLING
 * THE ROUTES DIRECTLY IS PROVEN ON THE BACKEND — `piWs4bOwnedIdentityRoutes`
 * drives the real `requireTenantAccess` + `requireCapability` guard for every
 * method. It is deliberately not re-asserted in jsdom, where both guards are
 * out of process and any "proof" would be a mock agreeing with itself.
 *
 * What is tested here is only what the DOM can get wrong: enumerating third
 * parties nobody asked about, writing without being asked, sending a field the
 * server owns, claiming a success the server did not report, rendering a
 * failure as an absence, inventing a field the API does not return, and
 * claiming an authorization no status supports.
 *
 * ─── SCOPING IS LOAD-BEARING ──────────────────────────────────────────────
 * The panel is mounted on `pages/settings/company-admin-access.tsx`, a page
 * whose own copy contains "Loading configuration...", "Reset To Default" and
 * several unlabelled checkboxes. Every assertion below is scoped to the
 * `owned-identities` root with `within(...)`, and that root is present in EVERY
 * branch so the scope never disappears.
 */

import React from 'react';
import { render, screen, waitFor, fireEvent, act, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { SWRConfig } from 'swr';

const fetchCalls: { url: string; init?: RequestInit }[] = [];
type Reply = { status: number; body: unknown };
let responder: (url: string, init?: RequestInit) => Reply | Promise<never>;

jest.mock('@/lib/apiFetch', () => ({
  apiFetch: jest.fn(async (url: string, init?: RequestInit) => {
    fetchCalls.push({ url, init });
    const r = responder(url, init);
    if (r instanceof Promise) return r;
    const { status, body } = r;
    return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
  }),
}));

import OwnedIdentitiesPanel from '@/components/prospects/OwnedIdentitiesPanel';

const ORG = '11111111-1111-4111-8111-111111111111';
const OTHER_ORG = '99999999-9999-4999-8999-999999999999';
const ENTRY = '22222222-2222-4222-8222-222222222222';
const AUTHOR = '33333333-3333-4333-8333-333333333333';
const AUTHOR_2 = '44444444-4444-4444-8444-444444444444';
const ACTOR = '55555555-5555-4555-8555-555555555555';

/** Case is significant in a profile URL path, so the fixture has mixed case. */
const IDENTITY = 'https://www.linkedin.com/in/AvaQ-Mehta';
const IDENTITY_2 = 'https://www.linkedin.com/company/DrishiQ-Labs';

type Row = Record<string, unknown>;

/**
 * A repository row as the registry projects it, PLUS the fields the projection
 * deliberately drops. The extras are here so the "only five fields" assertion
 * is a real test rather than a tautology.
 */
const entry = (over: Row = {}): Row => ({
  id: ENTRY,
  platform: 'linkedin',
  platformUserId: IDENTITY,
  attestedAt: '2026-10-20T09:30:00.000Z',
  attestedByUserId: ACTOR,
  // NOT in the projection:
  statement: 'this is our brand account and we post from it',
  revokedAt: null,
  revokedByUserId: null,
  organizationId: ORG,
  ...over,
});

const registryOk = (entries: Row[]): Reply => ({
  status: 200,
  body: {
    version: 'ws10.1',
    contract: 'pi-owned-identity.1',
    entries,
    state: 'available',
  },
});

/**
 * A candidate as the route projects it, PLUS third-party fields the service
 * never selects. If any of them reaches the DOM the panel invented it.
 */
const candidate = (over: Row = {}): Row => ({
  authorId: AUTHOR,
  platform: 'linkedin',
  platformUserId: IDENTITY,
  messageCount: 7,
  threadCount: 3,
  firstObservedAt: '2026-08-02T11:00:00.000Z',
  lastObservedAt: '2026-10-18T16:45:00.000Z',
  // NOT in the projection:
  display_name: 'Ava Mehta',
  username: 'avamehta',
  profile_url: 'https://example.invalid/avatar-source',
  avatar_url: 'https://example.invalid/avatar.png',
  raw_payload: { note: 'never rendered' },
  ...over,
});

const EXCLUDED = {
  examined: 9,
  identityBlank: 1,
  anonymousFallback: 2,
  extensionFallback: 1,
  identityNotAProfileUrl: 2,
  platformNotAttestable: 0,
};

/** The server's own prose, quoted as `ownedIdentityCandidates.ts` emits it. */
const REASON_WITH_ROWS =
  'every identity below was observed on a message in a thread belonging to this tenant; '
  + 'listing one is not a claim that the tenant owns it';
const REASON_EMPTY =
  'identities were observed in this tenant, but none of them carries an identity stable '
  + 'enough to attest — the counts say which requirement each one failed';

const candidatesOk = (candidates: Row[] = [candidate()], reason?: string): Reply => ({
  status: 200,
  body: {
    version: 'ws10.1',
    contract: 'pi-owned-identity.1',
    reason: reason ?? (candidates.length > 0 ? REASON_WITH_ROWS : REASON_EMPTY),
    candidates,
    excluded: EXCLUDED,
  },
});

/**
 * Routed by URL **and** METHOD, never one blanket reply.
 *
 * Three methods share one URL here. A single blanket responder would answer the
 * DELETE with the GET's body, and the "nothing changed" assertions would then
 * pass for the wrong reason.
 */
const routed = (over: {
  entries?: Row[];
  registry?: Reply;
  candidates?: Reply;
  post?: Reply;
  del?: Reply;
} = {}) => {
  responder = (url: string, init?: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    if (method === 'POST') {
      return over.post ?? { status: 201, body: { version: 'ws10.1', contract: 'pi-owned-identity.1', entryId: ENTRY, alreadyActive: false } };
    }
    if (method === 'DELETE') {
      return over.del ?? { status: 200, body: { version: 'ws10.1', contract: 'pi-owned-identity.1', revoked: true } };
    }
    if (url.includes('/owned-identity-candidates')) return over.candidates ?? candidatesOk();
    return over.registry ?? registryOk(over.entries ?? [entry()]);
  };
};

const writes = () => fetchCalls.filter((c) => (c.init?.method ?? 'GET').toUpperCase() !== 'GET');
const deletes = () => fetchCalls.filter((c) => (c.init?.method ?? '').toUpperCase() === 'DELETE');
const posts = () => fetchCalls.filter((c) => (c.init?.method ?? '').toUpperCase() === 'POST');

const mount = (companyId: string | null = ORG) => render(
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    <OwnedIdentitiesPanel companyId={companyId} />
  </SWRConfig>,
);

/** Every query is scoped to this root. See the header. */
const panel = () => within(screen.getByTestId('owned-identities'));
const panelText = (): string => screen.getByTestId('owned-identities').textContent ?? '';

const openPicker = async () => {
  await act(async () => { fireEvent.click(panel().getByTestId('owned-identities-attest-open')); });
  await waitFor(() => expect(panel().getByTestId('owned-identities-candidates')).toBeTruthy());
};

const choose = async (authorId = AUTHOR) => {
  await act(async () => { fireEvent.click(panel().getByTestId(`owned-identities-candidate-${authorId}`)); });
};

const say = async (text = 'this is our brand account') => {
  await act(async () => {
    fireEvent.change(panel().getByTestId('owned-identities-statement'), { target: { value: text } });
  });
};

const confirm = async () => {
  await act(async () => { fireEvent.click(panel().getByTestId('owned-identities-confirm')); });
};

const submit = async () => {
  await act(async () => { fireEvent.click(panel().getByTestId('owned-identities-attest-submit')); });
};

beforeEach(() => {
  fetchCalls.length = 0;
  routed();
});

// ═══════════════════════════════════════════════════════════════════════════
describe('WS-4E · the tenant comes from the page, never from a field', () => {
  it('reads nothing at all until a company is selected', async () => {
    mount(null);
    expect(panel().getByTestId('owned-identities-no-tenant')).toBeTruthy();
    expect(fetchCalls).toHaveLength(0);
  });

  it('carries the verified tenant in the QUERY STRING on the registry read', async () => {
    mount();
    await waitFor(() => expect(fetchCalls.length).toBeGreaterThan(0));
    expect(fetchCalls[0].url).toBe(`/api/prospect-identity/owned-identities?companyId=${ORG}`);
    expect(fetchCalls[0].init?.method ?? 'GET').toBe('GET');
  });

  it('offers no input a user could use to name a tenant, a platform or a pair', async () => {
    mount();
    await waitFor(() => expect(panel().getByTestId('owned-identities-list')).toBeTruthy());
    await openPicker();
    const root = screen.getByTestId('owned-identities');
    const named = Array.from(root.querySelectorAll('input, select, textarea'))
      .filter((el) => /company|organi[sz]ation|tenant|platform/i.test(
        `${el.getAttribute('id') ?? ''} ${el.getAttribute('name') ?? ''}`,
      ));
    expect(named).toHaveLength(0);

    // The only typeable fields on the whole surface are the attestation's own
    // stated basis and, when a revocation is opened, its reason. Neither names
    // an identity: the pair is read off the stored author row the server
    // re-resolves from the candidate id.
    const typeable = Array.from(root.querySelectorAll('input, textarea'))
      .filter((el) => !['radio', 'checkbox'].includes(el.getAttribute('type') ?? ''));
    expect(typeable.map((el) => el.getAttribute('id'))).toEqual(['owned-identity-statement']);
  });

  it('discards everything when the tenant changes', async () => {
    const view = mount();
    await waitFor(() => expect(panel().getByTestId('owned-identities-list')).toBeTruthy());
    await openPicker();
    await choose();
    await say('typed against the first company');

    view.rerender(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <OwnedIdentitiesPanel companyId={OTHER_ORG} />
      </SWRConfig>,
    );

    // The picker closed, so the half-built attestation cannot be submitted
    // against the company that did not author it.
    await waitFor(() => expect(panel().queryByTestId('owned-identities-candidates')).toBeNull());
    expect(panel().queryByTestId('owned-identities-statement')).toBeNull();
    expect(writes()).toHaveLength(0);
  });
});

describe('WS-4E · loading, empty and unreadable are three different answers', () => {
  it('loading is its own branch and is announced', async () => {
    responder = () => new Promise<never>(() => { /* never settles */ });
    mount();
    await waitFor(() => expect(screen.getByTestId('owned-identities')).toHaveAttribute('aria-busy', 'true'));
    expect(panel().getByTestId('owned-identities-loading')).toBeTruthy();
    expect(panel().queryByTestId('owned-identities-empty')).toBeNull();
    expect(panel().queryByTestId('owned-identities-error')).toBeNull();
    expect(panel().queryByTestId('owned-identities-list')).toBeNull();
  });

  it('an empty registry is an absence of records, reached ONLY from a real 200', async () => {
    routed({ entries: [] });
    mount();
    await waitFor(() => expect(panel().getByTestId('owned-identities-empty')).toBeTruthy());
    expect(panel().getByTestId('owned-identities-empty').textContent)
      .toMatch(/absence of\s+attestation records/i);
    // Never a claim about what the organization does or does not own.
    expect(panelText()).not.toMatch(/owns no|no identities|does not own/i);
    expect(panel().queryByTestId('owned-identities-error')).toBeNull();
    expect(panel().queryByTestId('owned-identities-list')).toBeNull();
  });

  it('a 503 from the registry is "could not look" and NEVER the empty branch', async () => {
    routed({ registry: { status: 503, body: { error: 'owned_identities_unavailable', retryable: true } } });
    mount();
    await waitFor(() => expect(panel().getByTestId('owned-identities-error')).toBeTruthy());
    expect(panel().getByTestId('owned-identities-error').textContent)
      .toMatch(/could not be read.*not been altered/i);
    // The load-bearing negative: an absence must not be manufactured from a failure.
    expect(panel().queryByTestId('owned-identities-empty')).toBeNull();
    expect(panel().queryByTestId('owned-identities-list')).toBeNull();
    expect(panel().getByRole('alert')).toBeTruthy();
  });

  it('a dead network is told apart from the route refusing to answer', async () => {
    // `apiFetch` synthesises a 503 with its OWN body when fetch throws. The two
    // are distinguished by `error`, which only the route sets.
    routed({ registry: { status: 503, body: { error: 'Network unreachable', detail: 'Failed to fetch' } } });
    mount();
    await waitFor(() => expect(panel().getByTestId('owned-identities-error')).toBeTruthy());
    expect(panel().getByTestId('owned-identities-error').textContent)
      .toMatch(/could not reach omnivyra/i);
    expect(panel().getByTestId('owned-identities-error').textContent).not.toMatch(/registry could not be read/i);
  });

  it('Retry re-reads, and the entries appear once the store answers', async () => {
    let healthy = false;
    responder = (url: string, init?: RequestInit) => {
      if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return { status: 500, body: {} };
      return healthy
        ? registryOk([entry()])
        : { status: 503, body: { error: 'owned_identities_unavailable', retryable: true } };
    };
    mount();
    await waitFor(() => expect(panel().getByTestId('owned-identities-error')).toBeTruthy());
    const before = fetchCalls.length;

    healthy = true;
    await act(async () => { fireEvent.click(panel().getByTestId('owned-identities-retry')); });

    await waitFor(() => expect(panel().getByTestId('owned-identities-list')).toBeTruthy());
    expect(fetchCalls.length).toBeGreaterThan(before);
    expect(panel().queryByTestId('owned-identities-error')).toBeNull();
    expect(panel().queryByTestId('owned-identities-empty')).toBeNull();
  });
});

describe('WS-4E · a permission sentence only ever comes from the server', () => {
  it('401 says the session expired, and offers no retry', async () => {
    routed({ registry: { status: 401, body: { error: 'Not authenticated', code: 'NOT_AUTHENTICATED' } } });
    mount();
    await waitFor(() => expect(panel().getByTestId('owned-identities-unauthorized')).toBeTruthy());
    expect(panel().getByTestId('owned-identities-unauthorized').textContent).toMatch(/session has expired/i);
    expect(panel().queryByTestId('owned-identities-retry')).toBeNull();
    expect(panel().queryByTestId('owned-identities-list')).toBeNull();
    expect(panel().queryByTestId('owned-identities-empty')).toBeNull();
    expect(panel().getByRole('alert')).toBeTruthy();
  });

  it('403 names the refusal the SERVER made, not a role the client guessed', async () => {
    routed({ registry: { status: 403, body: { error: 'Capability denied', code: 'CAPABILITY_DENIED' } } });
    mount();
    await waitFor(() => expect(panel().getByTestId('owned-identities-unauthorized')).toBeTruthy());
    expect(panel().getByTestId('owned-identities-unauthorized').textContent)
      .toMatch(/do not have permission to administer this company’s owned engagement identities/i);
    // `CompanyContext` can report COMPANY_ADMIN for a principal the server
    // refuses, so the panel must never say the reader IS an administrator.
    expect(panelText()).not.toMatch(/you are an administrator|as an administrator you/i);
    expect(panel().queryByTestId('owned-identities-attest-open')).toBeNull();
  });

  it('a 404 never claims the entry exists somewhere else', async () => {
    routed({ registry: { status: 404, body: { error: 'entry_not_found' } } });
    mount();
    await waitFor(() => expect(panel().getByTestId('owned-identities-error')).toBeTruthy());
    expect(panel().getByTestId('owned-identities-error').textContent)
      .toMatch(/not available in this workspace/i);
    expect(panelText()).not.toMatch(/do not have access|another workspace|belongs to/i);
  });
});

describe('WS-4E · the candidate read is lazy, and reading it writes nothing', () => {
  it('no candidate read is issued until the picker is opened', async () => {
    mount();
    await waitFor(() => expect(panel().getByTestId('owned-identities-list')).toBeTruthy());
    // The panel does not enumerate third parties nobody asked about.
    expect(fetchCalls.filter((c) => c.url.includes('/owned-identity-candidates'))).toHaveLength(0);

    await openPicker();
    const reads = fetchCalls.filter((c) => c.url.includes('/owned-identity-candidates'));
    expect(reads).toHaveLength(1);
    expect(reads[0].url).toBe(`/api/prospect-identity/owned-identity-candidates?companyId=${ORG}`);
  });

  it('renders the identity VERBATIM with its case intact, in the server’s order', async () => {
    routed({
      candidates: candidatesOk([
        candidate({ authorId: AUTHOR, platformUserId: IDENTITY }),
        candidate({ authorId: AUTHOR_2, platformUserId: IDENTITY_2, messageCount: 41, threadCount: 9 }),
      ]),
    });
    mount();
    await waitFor(() => expect(panel().getByTestId('owned-identities-list')).toBeTruthy());
    await openPicker();

    expect(panel().getByTestId(`owned-identities-candidate-identity-${AUTHOR}`).textContent).toBe(IDENTITY);
    expect(panel().getByTestId(`owned-identities-candidate-identity-${AUTHOR_2}`).textContent).toBe(IDENTITY_2);

    // The order is the server's. A panel that re-sorted would be forming an
    // opinion about people it has no basis to form.
    const rendered = panel().getAllByTestId(/^owned-identities-candidate-identity-/)
      .map((el) => el.textContent);
    expect(rendered).toEqual([IDENTITY, IDENTITY_2]);
  });

  it('shows no field the API does not return', async () => {
    mount();
    await waitFor(() => expect(panel().getByTestId('owned-identities-list')).toBeTruthy());
    await openPicker();
    for (const leaked of ['Ava Mehta', 'avamehta', 'avatar-source', 'avatar.png', 'never rendered']) {
      expect(panelText()).not.toContain(leaked);
    }
  });

  it('reproduces the observation proof without grading it', async () => {
    mount();
    await waitFor(() => expect(panel().getByTestId('owned-identities-list')).toBeTruthy());
    await openPicker();
    expect(panelText()).toContain('7');
    expect(panelText()).toContain('3');
    expect(panelText())
      .not.toMatch(/\b(score|scored|scoring|rating|ranked?|priority|weight|dimension|strong|weak|poor|qualified)\b/i);
    expect(panelText()).not.toMatch(/average|overall|total|combined/i);
    expect(panelText()).not.toMatch(/\b(current|latest|most recent|primary|superseded|outdated)\b/i);
  });

  it('no candidate is an absence with the server’s own words and counts only', async () => {
    routed({ candidates: candidatesOk([]) });
    mount();
    await waitFor(() => expect(panel().getByTestId('owned-identities-list')).toBeTruthy());
    await act(async () => { fireEvent.click(panel().getByTestId('owned-identities-attest-open')); });

    await waitFor(() => expect(panel().getByTestId('owned-identities-candidates-none')).toBeTruthy());
    // VERBATIM — emptiness here is never mute.
    expect(panel().getByTestId('owned-identities-candidates-reason').textContent).toBe(REASON_EMPTY);
    // Counts, and nothing that could name an excluded third party.
    expect(panel().getByTestId('owned-identities-excluded-anonymousFallback').textContent).toBe('2');
    expect(panel().getByTestId('owned-identities-excluded-examined').textContent).toBe('9');
    expect(panelText()).not.toContain(IDENTITY_2);
    expect(panel().queryByTestId('owned-identities-candidates-error')).toBeNull();
    expect(panel().getByTestId('owned-identities-attest-submit')).toBeDisabled();
  });

  it('an unreadable candidate store blocks the choice and leaves the registry intact', async () => {
    routed({ candidates: { status: 503, body: { error: 'owned_identity_candidates_unavailable', retryable: true } } });
    mount();
    await waitFor(() => expect(panel().getByTestId('owned-identities-list')).toBeTruthy());
    await act(async () => { fireEvent.click(panel().getByTestId('owned-identities-attest-open')); });

    await waitFor(() => expect(panel().getByTestId('owned-identities-candidates-error')).toBeTruthy());
    expect(panel().getByTestId('owned-identities-candidates-error').textContent)
      .toMatch(/could not be read.*only unread/i);
    expect(panel().queryByTestId('owned-identities-candidates')).toBeNull();
    expect(panel().getByTestId('owned-identities-attest-submit')).toBeDisabled();
    // The attestations already read are untouched by a picker failure.
    expect(panel().getAllByTestId(/^owned-identity-2{8}/)).toHaveLength(1);
  });

  it('opening the picker and choosing a candidate issue NO write', async () => {
    mount();
    await waitFor(() => expect(panel().getByTestId('owned-identities-list')).toBeTruthy());
    await openPicker();
    expect(writes()).toHaveLength(0);
    await choose();
    expect(writes()).toHaveLength(0);
    await say();
    expect(writes()).toHaveLength(0);
    await confirm();
    expect(writes()).toHaveLength(0);
  });
});

describe('WS-4E · the attestation is explicit, and its body is exactly three keys', () => {
  it('submit stays unavailable until a candidate is chosen AND confirmed', async () => {
    mount();
    await waitFor(() => expect(panel().getByTestId('owned-identities-list')).toBeTruthy());
    await openPicker();
    expect(panel().getByTestId('owned-identities-attest-submit')).toBeDisabled();

    await choose();
    await say();
    // Chosen and stated, but not confirmed.
    expect(panel().getByTestId('owned-identities-attest-submit')).toBeDisabled();
    // A disabled button proves nothing about a programmatic click, so assert
    // the real invariant: nothing was sent.
    await submit();
    expect(writes()).toHaveLength(0);

    await confirm();
    expect(panel().getByTestId('owned-identities-attest-submit')).not.toBeDisabled();
  });

  it('a confirmation with no candidate chosen is still unavailable and still silent', async () => {
    mount();
    await waitFor(() => expect(panel().getByTestId('owned-identities-list')).toBeTruthy());
    await openPicker();
    await say();
    await confirm();
    expect(panel().getByTestId('owned-identities-attest-submit')).toBeDisabled();
    await submit();
    expect(writes()).toHaveLength(0);
  });

  it('a blank basis is pre-checked and costs no request', async () => {
    mount();
    await waitFor(() => expect(panel().getByTestId('owned-identities-list')).toBeTruthy());
    await openPicker();
    await choose();
    await confirm();
    await submit();

    expect(writes()).toHaveLength(0);
    expect(panel().getByTestId('owned-identities-attest-error')).toBeTruthy();
    expect(panel().queryByTestId('owned-identities-notice-recorded')).toBeNull();
  });

  it('sends ONE post whose body is exactly { candidateAuthorId, statement, confirmed }', async () => {
    mount();
    await waitFor(() => expect(panel().getByTestId('owned-identities-list')).toBeTruthy());
    await openPicker();
    await choose();
    await say('this is our brand account');
    await confirm();
    await submit();

    expect(posts()).toHaveLength(1);
    const post = posts()[0];
    expect(post.url).toBe(`/api/prospect-identity/owned-identities?companyId=${ORG}`);
    const body = JSON.parse(String(post.init?.body)) as Record<string, unknown>;
    expect(body).toEqual({
      candidateAuthorId: AUTHOR,
      statement: 'this is our brand account',
      confirmed: true,
    });
    // Every field the route names in a 400. None may be sent, not even the
    // tenant the query string already carries.
    for (const owned of [
      'platform', 'platformUserId', 'platform_user_id',
      'organizationId', 'organization_id', 'companyId', 'company_id',
      'attestedByUserId', 'attested_by_user_id', 'attestedAt', 'attested_at',
      'id', 'attestedAs', 'attested_as',
      'revokedAt', 'revoked_at', 'revokedByUserId', 'revoked_by_user_id',
    ]) {
      expect(Object.keys(body)).not.toContain(owned);
    }
    // The identity string never leaves the browser.
    expect(String(post.init?.body)).not.toContain(IDENTITY);
  });

  it('a server_owned_field refusal NAMES the fields and attests nothing', async () => {
    routed({
      post: {
        status: 400,
        body: { error: 'server_owned_field', fields: ['platform', 'platformUserId'] },
      },
    });
    mount();
    await waitFor(() => expect(panel().getByTestId('owned-identities-list')).toBeTruthy());
    await openPicker();
    await choose();
    await say();
    await confirm();
    await submit();

    await waitFor(() => expect(panel().getByTestId('owned-identities-notice-refused')).toBeTruthy());
    const text = panel().getByTestId('owned-identities-notice-refused').textContent ?? '';
    expect(text).toContain('platform');
    expect(text).toContain('platformUserId');
    expect(text).toMatch(/nothing was attested/i);
    expect(panel().queryByTestId('owned-identities-notice-recorded')).toBeNull();
    expect(panel().getByRole('alert')).toBeTruthy();
  });

  const postFailures: Array<[string, Reply]> = [
    ['404 candidate_not_found', { status: 404, body: { error: 'candidate_not_found' } }],
    ['400 candidate_not_attestable', { status: 400, body: { error: 'candidate_not_attestable', detail: 'the stored identity is an anonymous placeholder', requirement: 'anonymousFallback' } }],
    ['503 unavailable', { status: 503, body: { error: 'owned_identities_unavailable', retryable: true } }],
  ];
  for (const [label, reply] of postFailures) {
    it(`${label} is never dressed as a successful attestation`, async () => {
      routed({ post: reply });
      mount();
      await waitFor(() => expect(panel().getByTestId('owned-identities-list')).toBeTruthy());
      await openPicker();
      await choose();
      await say();
      await confirm();
      await submit();

      await waitFor(() => expect(panel().getByTestId('owned-identities-notice-refused')).toBeTruthy());
      expect(panel().queryByTestId('owned-identities-notice-recorded')).toBeNull();
      expect(panel().queryByTestId('owned-identities-notice-already')).toBeNull();
      // The list did not grow and no row was synthesised locally.
      expect(panel().getAllByTestId(/^owned-identity-2{8}/)).toHaveLength(1);
    });
  }

  it('announces nothing while the server has not answered', async () => {
    let settle = false;
    responder = (url: string, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase();
      if (method === 'POST') {
        return settle
          ? { status: 201, body: { entryId: ENTRY, alreadyActive: false } }
          : new Promise<never>(() => { /* in flight */ });
      }
      if (url.includes('/owned-identity-candidates')) return candidatesOk();
      return registryOk([entry()]);
    };
    mount();
    await waitFor(() => expect(panel().getByTestId('owned-identities-list')).toBeTruthy());
    await openPicker();
    await choose();
    await say();
    await confirm();
    await submit();

    // In flight: no success, no duplicate, no refusal.
    expect(panel().queryByTestId('owned-identities-notice-recorded')).toBeNull();
    expect(panel().queryByTestId('owned-identities-notice-already')).toBeNull();
    expect(panel().queryByTestId('owned-identities-notice-refused')).toBeNull();
    expect(panel().getByTestId('owned-identities-attest-submit').textContent).toMatch(/attesting/i);
    settle = true;
  });

  it('re-reads the registry only after the server confirms, and renders what came back', async () => {
    let stored = [entry({ id: ENTRY })];
    responder = (url: string, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase();
      if (method === 'POST') {
        stored = [
          entry({ id: ENTRY }),
          entry({ id: '66666666-6666-4666-8666-666666666666', platformUserId: IDENTITY_2 }),
        ];
        return { status: 201, body: { entryId: '66666666-6666-4666-8666-666666666666', alreadyActive: false } };
      }
      if (url.includes('/owned-identity-candidates')) return candidatesOk();
      return registryOk(stored);
    };
    mount();
    await waitFor(() => expect(panel().getAllByTestId(/^owned-identity-[0-9]/)).toHaveLength(1));
    await openPicker();
    await choose();
    await say();
    await confirm();
    await submit();

    await waitFor(() => expect(panel().getAllByTestId(/^owned-identity-[0-9]/)).toHaveLength(2));
    expect(panel().getByTestId('owned-identities-notice-recorded')).toBeTruthy();
    // The second row came from the SERVER, verbatim.
    expect(panel().getByTestId('owned-identity-identity-66666666-6666-4666-8666-666666666666').textContent)
      .toBe(IDENTITY_2);
  });

  it('alreadyActive:true says "already" and does NOT claim a new record', async () => {
    routed({ post: { status: 200, body: { entryId: ENTRY, alreadyActive: true } } });
    mount();
    await waitFor(() => expect(panel().getAllByTestId(/^owned-identity-[0-9]/)).toHaveLength(1));
    await openPicker();
    await choose();
    await say();
    await confirm();
    await submit();

    await waitFor(() => expect(panel().getByTestId('owned-identities-notice-already')).toBeTruthy());
    const text = panel().getByTestId('owned-identities-notice-already').textContent ?? '';
    expect(text).toMatch(/already attested/i);
    expect(text).toMatch(/nothing changed/i);
    expect(text).not.toMatch(/recorded/i);
    expect(panel().queryByTestId('owned-identities-notice-recorded')).toBeNull();
    // The list did not grow.
    expect(panel().getAllByTestId(/^owned-identity-[0-9]/)).toHaveLength(1);
  });
});

describe('WS-4E · the registry list projects five fields and nothing else', () => {
  it('renders the identity verbatim, the platform, and both provenance fields', async () => {
    mount();
    await waitFor(() => expect(panel().getByTestId('owned-identities-list')).toBeTruthy());
    expect(panel().getByTestId(`owned-identity-identity-${ENTRY}`).textContent).toBe(IDENTITY);
    expect(panel().getByTestId(`owned-identity-platform-${ENTRY}`).textContent).toBe('linkedin');
    expect(panel().getByTestId(`owned-identity-attested-at-${ENTRY}`).textContent).toContain('2026-10-20');
    expect(panel().getByTestId(`owned-identity-attested-by-${ENTRY}`).textContent).toBe(ACTOR);
  });

  it('shows nothing the projection drops', async () => {
    mount();
    await waitFor(() => expect(panel().getByTestId('owned-identities-list')).toBeTruthy());
    // `statement` and the revocation columns are on the repository row and are
    // NOT in the entry projection — the list is about which identities are
    // claimed, not about what was written when claiming them.
    expect(panelText()).not.toContain('this is our brand account and we post from it');
    expect(panelText()).not.toMatch(/revokedAt|revokedByUserId/);
  });

  it('an absent attestation time stays absent rather than borrowing a clock', async () => {
    routed({ entries: [entry({ attestedAt: null, attestedByUserId: null })] });
    mount();
    await waitFor(() => expect(panel().getByTestId(`owned-identity-attested-at-${ENTRY}`)).toBeTruthy());
    expect(panel().getByTestId(`owned-identity-attested-at-${ENTRY}`).textContent).toBe('—');
    expect(panel().getByTestId(`owned-identity-attested-by-${ENTRY}`).textContent).toBe('—');
  });

  it('implies no verdict about the person behind an attested identity', async () => {
    mount();
    await waitFor(() => expect(panel().getByTestId('owned-identities-list')).toBeTruthy());
    expect(panelText())
      .not.toMatch(/\b(score|scored|scoring|rating|ranked?|priority|weight|dimension|strong|weak|poor|qualified)\b/i);
    expect(panelText()).not.toMatch(/average|overall|total|combined/i);
    expect(panelText()).not.toMatch(/\b(current|latest|most recent|primary|superseded|outdated)\b/i);
    expect(panelText()).not.toMatch(/do not have access|another workspace|belongs to/i);
  });
});

describe('WS-4E · revocation is inline, reasoned, and by the entry’s own uuid', () => {
  const openRevoke = async () => {
    await act(async () => { fireEvent.click(panel().getByTestId(`owned-identity-revoke-${ENTRY}`)); });
    await waitFor(() => expect(panel().getByTestId(`owned-identity-revoke-confirm-${ENTRY}`)).toBeTruthy());
  };
  const reason = async (text: string) => {
    await act(async () => {
      fireEvent.change(panel().getByTestId(`owned-identity-revoke-reason-${ENTRY}`), { target: { value: text } });
    });
  };

  it('asking to revoke opens an INLINE confirmation and sends nothing', async () => {
    mount();
    await waitFor(() => expect(panel().getByTestId('owned-identities-list')).toBeTruthy());
    await openRevoke();
    // Inline, inside the row, not a modal somewhere else in the document.
    expect(screen.getByTestId(`owned-identity-${ENTRY}`)
      .contains(screen.getByTestId(`owned-identity-revoke-confirm-${ENTRY}`))).toBe(true);
    expect(writes()).toHaveLength(0);
  });

  it('a blank reason is refused before any request is made', async () => {
    mount();
    await waitFor(() => expect(panel().getByTestId('owned-identities-list')).toBeTruthy());
    await openRevoke();
    await act(async () => { fireEvent.click(panel().getByTestId(`owned-identity-revoke-yes-${ENTRY}`)); });

    expect(writes()).toHaveLength(0);
    expect(panel().getByTestId(`owned-identity-error-${ENTRY}`).textContent).toMatch(/reason/i);
  });

  it('cancelling sends nothing and keeps the entry', async () => {
    mount();
    await waitFor(() => expect(panel().getByTestId('owned-identities-list')).toBeTruthy());
    await openRevoke();
    await reason('the account was retired');
    await act(async () => { fireEvent.click(panel().getByTestId(`owned-identity-revoke-cancel-${ENTRY}`)); });

    expect(writes()).toHaveLength(0);
    expect(panel().queryByTestId(`owned-identity-revoke-confirm-${ENTRY}`)).toBeNull();
    expect(panel().getByTestId(`owned-identity-${ENTRY}`)).toBeTruthy();
  });

  it('confirming sends exactly one DELETE carrying id and reason, and no identity', async () => {
    mount();
    await waitFor(() => expect(panel().getByTestId('owned-identities-list')).toBeTruthy());
    await openRevoke();
    await reason('the account was retired');
    await act(async () => { fireEvent.click(panel().getByTestId(`owned-identity-revoke-yes-${ENTRY}`)); });

    await waitFor(() => expect(deletes()).toHaveLength(1));
    const del = deletes()[0];
    expect(del.url).toContain(`companyId=${ORG}`);
    expect(del.url).toContain(`id=${ENTRY}`);
    expect(del.url).toContain(`reason=${encodeURIComponent('the account was retired')}`);
    // A profile URL in a query string lands in an access log, a proxy log and a
    // browser history. Revocation is by the registry row's uuid only.
    expect(del.url).not.toContain('linkedin.com');
    expect(del.url).not.toContain(encodeURIComponent(IDENTITY));
    expect(del.init?.body).toBeUndefined();
    expect(deletes()).toHaveLength(1);
  });

  it('revoked:false is "already revoked", not an error', async () => {
    routed({ del: { status: 200, body: { revoked: false } } });
    mount();
    await waitFor(() => expect(panel().getByTestId('owned-identities-list')).toBeTruthy());
    await openRevoke();
    await reason('duplicate entry');
    await act(async () => { fireEvent.click(panel().getByTestId(`owned-identity-revoke-yes-${ENTRY}`)); });

    await waitFor(() => expect(panel().getByTestId('owned-identities-notice-already-revoked')).toBeTruthy());
    expect(panel().getByTestId('owned-identities-notice-already-revoked').textContent)
      .toMatch(/already revoked.*nothing changed/i);
    expect(panel().queryByTestId('owned-identities-notice-revoked')).toBeNull();
    expect(panel().queryByTestId(`owned-identity-error-${ENTRY}`)).toBeNull();
  });

  it('a 404 on revoke is reported on the row and revokes nothing', async () => {
    routed({ del: { status: 404, body: { error: 'entry_not_found' } } });
    mount();
    await waitFor(() => expect(panel().getByTestId('owned-identities-list')).toBeTruthy());
    await openRevoke();
    await reason('duplicate entry');
    await act(async () => { fireEvent.click(panel().getByTestId(`owned-identity-revoke-yes-${ENTRY}`)); });

    await waitFor(() => expect(panel().getByTestId(`owned-identity-error-${ENTRY}`)).toBeTruthy());
    expect(panel().getByTestId(`owned-identity-error-${ENTRY}`).textContent)
      .toMatch(/not available in this workspace/i);
    expect(panel().queryByTestId('owned-identities-notice-revoked')).toBeNull();
    expect(panelText()).not.toMatch(/do not have access|another workspace|belongs to/i);
  });

  it('a success is announced only after the server confirms it', async () => {
    mount();
    await waitFor(() => expect(panel().getByTestId('owned-identities-list')).toBeTruthy());
    await openRevoke();
    await reason('the account was retired');
    expect(panel().queryByTestId('owned-identities-notice-revoked')).toBeNull();

    await act(async () => { fireEvent.click(panel().getByTestId(`owned-identity-revoke-yes-${ENTRY}`)); });
    await waitFor(() => expect(panel().getByTestId('owned-identities-notice-revoked')).toBeTruthy());
    expect(panel().getByTestId('owned-identities-notice-revoked')).toHaveAttribute('role', 'status');
  });
});

describe('WS-4E · accessibility', () => {
  it('every field the admin types into has a label', async () => {
    mount();
    await waitFor(() => expect(panel().getByTestId('owned-identities-list')).toBeTruthy());
    await openPicker();
    await act(async () => { fireEvent.click(panel().getByTestId(`owned-identity-revoke-${ENTRY}`)); });

    const root = screen.getByTestId('owned-identities');
    const fields = Array.from(root.querySelectorAll('input, textarea, select'));
    expect(fields.length).toBeGreaterThan(0);
    for (const el of fields) {
      const id = el.getAttribute('id');
      expect(id).toBeTruthy();
      expect(root.querySelector(`label[for="${id}"]`)).toBeTruthy();
    }
  });

  it('decorative icons are hidden from assistive technology', async () => {
    routed({ registry: { status: 503, body: { error: 'owned_identities_unavailable' } } });
    mount();
    await waitFor(() => expect(panel().getByTestId('owned-identities-error')).toBeTruthy());
    const svgs = Array.from(screen.getByTestId('owned-identities').querySelectorAll('svg'));
    expect(svgs.length).toBeGreaterThan(0);
    for (const svg of svgs) expect(svg.getAttribute('aria-hidden')).toBe('true');
  });
});
