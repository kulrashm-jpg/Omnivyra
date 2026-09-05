/**
 * @jest-environment jsdom
 *
 * A3R — the Lead Sources tab.
 *
 * The property under test is that this UI cannot overstate what it knows. It
 * renders the server's `configured` and `operational` as two separate facts and
 * never derives the second from the first, because every provider today is
 * configurable and none is usable — a card that showed "Connected" on a saved
 * key would be telling an operator something the cost gate will refuse.
 *
 * The secret tests are the other half: a typed key must reach the API and
 * nothing else — not the URL, not storage, not an error message, not a
 * telemetry call.
 *
 * SECRETS: every value here is synthetic and invented for this file.
 */

import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';

const fetchCalls: { url: string; init?: RequestInit }[] = [];
let responder: (url: string, init?: RequestInit) => { status: number; body: unknown };

jest.mock('../../../lib/apiFetch', () => ({
  apiFetch: jest.fn(async (url: string, init?: RequestInit) => {
    fetchCalls.push({ url, init });
    const { status, body } = responder(url, init);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as unknown as Response;
  }),
}));

import LeadSourcesPanel, { type LeadSourceStatus } from '../../../components/prospects/LeadSourcesPanel';

const ORG = '00000000-0000-4000-8000-0000000000aa';
/** Synthetic. Not a credential for anything that exists. */
const SECRET = 'synthetic-a3r-provider-key';

const apollo = (over: Partial<LeadSourceStatus> = {}): LeadSourceStatus => ({
  providerId: 'apollo',
  displayName: 'Apollo',
  sourceType: 'external_api',
  authMode: 'api_key',
  configured: false,
  credentialFields: {},
  operational: false,
  operationalReason: 'storing a credential does not activate this provider — still required: adapter, credit_action',
  ...over,
});

const rapidapi = (over: Partial<LeadSourceStatus> = {}): LeadSourceStatus => ({
  providerId: 'rapidapi',
  displayName: 'RapidAPI',
  sourceType: 'gateway_api',
  authMode: 'gateway_api_key',
  configured: false,
  credentialFields: {},
  operational: false,
  operationalReason: 'storing a credential does not activate this provider — still required: sub_provider_selected, adapter, credit_action',
  ...over,
});

/** A list response, as the A3P GET returns it. */
const listOf = (...providers: LeadSourceStatus[]) => ({ status: 200, body: { providers } });

async function renderPanel(companyId: string | null = ORG) {
  const view = render(<LeadSourcesPanel companyId={companyId} />);
  await waitFor(() => expect(screen.queryByTestId('lead-sources-loading')).not.toBeInTheDocument());
  return view;
}

beforeEach(() => {
  fetchCalls.length = 0;
  window.localStorage.clear();
  window.sessionStorage.clear();
  responder = () => listOf(apollo(), rapidapi());
});

// ───────────────────────────────────────────────────────────────────────────
describe('A3R — providers come from the server, not from this file', () => {
  it('renders exactly the providers the API returned', async () => {
    await renderPanel();
    expect(screen.getByTestId('lead-source-apollo')).toBeInTheDocument();
    expect(screen.getByTestId('lead-source-rapidapi')).toBeInTheDocument();
  });

  it('renders nothing extra when the API returns one provider', async () => {
    responder = () => listOf(apollo());
    await renderPanel();
    expect(screen.getByTestId('lead-source-apollo')).toBeInTheDocument();
    expect(screen.queryByTestId('lead-source-clearbit')).not.toBeInTheDocument();
    expect(screen.queryByTestId('lead-source-omnivyra_extension')).not.toBeInTheDocument();
  });

  it('a browser-session source is never offered an API-key form', async () => {
    // The A3P GET does not return it; were it ever returned, the auth mode
    // still bars the form. Both are asserted.
    responder = () => listOf({
      ...apollo(), providerId: 'omnivyra_extension', displayName: 'Omnivyra extension',
      sourceType: 'browser_extension', authMode: 'browser_session',
    });
    await renderPanel();
    expect(screen.queryByTestId('key-input-omnivyra_extension')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /configure/i })).not.toBeInTheDocument();
    expect(screen.getByText(/Authentication: Browser session/)).toBeInTheDocument();
  });

  it('RapidAPI is shown as a gateway with its prerequisite, not as a dataset', async () => {
    await renderPanel();
    const card = screen.getByTestId('lead-source-rapidapi');
    expect(card).toHaveTextContent('Gateway API key');
    expect(screen.getByTestId('not-operational-rapidapi')).toHaveTextContent('sub_provider_selected');
  });

  it('the company context is used verbatim and is not user-editable', async () => {
    await renderPanel();
    expect(fetchCalls[0].url).toContain(`companyId=${ORG}`);
    // no input exists through which a tenant id could be typed
    const inputs = document.querySelectorAll('input');
    inputs.forEach((i) => expect(i.getAttribute('id')).not.toMatch(/company/i));
  });

  it('asks for a company before fetching anything when none is selected', () => {
    render(<LeadSourcesPanel companyId={null} />);
    expect(screen.getByText(/Select a company/i)).toBeInTheDocument();
    expect(fetchCalls).toHaveLength(0);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('A3R — configured and operational are separate facts', () => {
  it('an unconfigured provider offers Configure and shows Not configured', async () => {
    await renderPanel();
    expect(screen.getByTestId('state-apollo')).toHaveTextContent('Not configured');
    // no key field until Configure is pressed
    expect(screen.queryByTestId('key-input-apollo')).not.toBeInTheDocument();
  });

  it('a CONFIGURED provider is still shown as not operational', async () => {
    responder = () => listOf(apollo({ configured: true, credentialFields: { api_key: '********' } }));
    await renderPanel();
    expect(screen.getByTestId('state-apollo')).toHaveTextContent('Configured');
    expect(screen.getByTestId('not-operational-apollo')).toHaveTextContent('Enrichment not yet available');
  });

  it('the backend’s reason is what is displayed', async () => {
    responder = () => listOf(apollo({ configured: true, operationalReason: 'a very specific server reason' }));
    await renderPanel();
    expect(screen.getByTestId('not-operational-apollo')).toHaveTextContent('a very specific server reason');
  });

  it('never says Connected, Operational, Ready or Active', async () => {
    responder = () => listOf(apollo({ configured: true, credentialFields: { api_key: '********' } }));
    await renderPanel();
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/\bConnected\b/);
    expect(text).not.toMatch(/\bOperational\b/);
    expect(text).not.toMatch(/\bReady\b/);
    expect(text).not.toMatch(/\bActive\b/);
  });

  it('offers no connection-test action, because none exists on the server', async () => {
    responder = () => listOf(apollo({ configured: true }));
    await renderPanel();
    expect(screen.queryByRole('button', { name: /test/i })).not.toBeInTheDocument();
  });

  it('when the server says operational, the banner disappears — the UI does not decide', async () => {
    responder = () => listOf(apollo({ configured: true, operational: true }));
    await renderPanel();
    expect(screen.queryByTestId('not-operational-apollo')).not.toBeInTheDocument();
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('A3R — credential lifecycle', () => {
  it('configure → PUT → masked configured state, and the field is cleared', async () => {
    let configured = false;
    responder = (url, init) => {
      if (init?.method === 'PUT') { configured = true; return { status: 200, body: { provider: apollo({ configured: true }) } }; }
      return listOf(apollo(configured ? { configured: true, credentialFields: { api_key: '********' } } : {}));
    };
    await renderPanel();

    fireEvent.click(screen.getByRole('button', { name: /Configure/i }));
    fireEvent.change(screen.getByTestId('key-input-apollo'), { target: { value: SECRET } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Save key/i })); });

    await waitFor(() => expect(screen.getByTestId('state-apollo')).toHaveTextContent('Configured'));
    expect(screen.getByTestId('masked-apollo')).toHaveTextContent('********');
    // the input is gone, so the typed value is no longer held anywhere
    expect(screen.queryByTestId('key-input-apollo')).not.toBeInTheDocument();
  });

  it('the PUT carries the provider and the key, and no company id in the body', async () => {
    responder = (url, init) => (init?.method === 'PUT'
      ? { status: 200, body: { provider: apollo({ configured: true }) } }
      : listOf(apollo()));
    await renderPanel();

    fireEvent.click(screen.getByRole('button', { name: /Configure/i }));
    fireEvent.change(screen.getByTestId('key-input-apollo'), { target: { value: SECRET } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Save key/i })); });

    const put = fetchCalls.find((c) => c.init?.method === 'PUT');
    const body = JSON.parse(String(put?.init?.body));
    expect(body).toEqual({ provider: 'apollo', credentials: { api_key: SECRET } });
    expect(Object.keys(body)).not.toContain('companyId');
    expect(Object.keys(body)).not.toContain('company_id');
  });

  it('revoke asks for confirmation before deleting', async () => {
    responder = () => listOf(apollo({ configured: true, credentialFields: { api_key: '********' } }));
    await renderPanel();

    fireEvent.click(screen.getByRole('button', { name: /Revoke/i }));
    expect(screen.getByTestId('confirm-revoke-apollo')).toBeInTheDocument();
    expect(fetchCalls.filter((c) => c.init?.method === 'DELETE')).toHaveLength(0);
  });

  it('confirmed revoke → DELETE → the card returns to Not configured with no stale state', async () => {
    let configured = true;
    responder = (url, init) => {
      if (init?.method === 'DELETE') { configured = false; return { status: 200, body: { provider: apollo() } }; }
      return listOf(apollo(configured ? { configured: true, credentialFields: { api_key: '********' } } : {}));
    };
    await renderPanel();

    fireEvent.click(screen.getByRole('button', { name: /Revoke/i }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Yes, revoke/i })); });

    await waitFor(() => expect(screen.getByTestId('state-apollo')).toHaveTextContent('Not configured'));
    expect(screen.queryByTestId('masked-apollo')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Configure/i })).toBeInTheDocument();
  });

  it('cancelling the confirmation deletes nothing', async () => {
    responder = () => listOf(apollo({ configured: true }));
    await renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /Revoke/i }));
    fireEvent.click(screen.getByRole('button', { name: /Keep it/i }));
    expect(screen.queryByTestId('confirm-revoke-apollo')).not.toBeInTheDocument();
    expect(fetchCalls.filter((c) => c.init?.method === 'DELETE')).toHaveLength(0);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('A3R — the secret goes to the API and nowhere else', () => {
  async function typeAndSave(status: number, body: unknown) {
    responder = (url, init) => (init?.method === 'PUT' ? { status, body } : listOf(apollo()));
    await renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /Configure/i }));
    fireEvent.change(screen.getByTestId('key-input-apollo'), { target: { value: SECRET } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Save key/i })); });
  }

  it('never appears in a request URL', async () => {
    await typeAndSave(200, { provider: apollo({ configured: true }) });
    for (const call of fetchCalls) expect(call.url).not.toContain(SECRET);
  });

  it('never reaches localStorage or sessionStorage', async () => {
    await typeAndSave(200, { provider: apollo({ configured: true }) });
    expect(JSON.stringify(window.localStorage)).not.toContain(SECRET);
    expect(JSON.stringify(window.sessionStorage)).not.toContain(SECRET);
  });

  it('never appears in the rendered document after a successful save', async () => {
    await typeAndSave(200, { provider: apollo({ configured: true }) });
    expect(document.body.innerHTML).not.toContain(SECRET);
  });

  it('never appears in an error message when the server rejects it', async () => {
    await typeAndSave(400, { error: 'invalid_credential_payload', reason: "credential field 'api_key' must be a non-empty string" });
    const error = screen.getByTestId('error-apollo');
    expect(error).toBeInTheDocument();
    expect(error.textContent ?? '').not.toContain(SECRET);

    // On a FAILED save the form deliberately stays open so the admin can
    // correct and retry, so their own typed value is still in the password
    // input — that is the user's input, not a leak. What must hold is that the
    // value exists NOWHERE ELSE in the document.
    const outsideTheInput = Array.from(document.querySelectorAll('body *'))
      .filter((el) => el.tagName !== 'INPUT')
      .map((el) => el.textContent ?? '')
      .join(' ');
    expect(outsideTheInput).not.toContain(SECRET);
  });

  it('the masked value is the server’s, never client-side masking of a plaintext', async () => {
    responder = () => listOf(apollo({ configured: true, credentialFields: { api_key: '###server###' } }));
    await renderPanel();
    expect(screen.getByTestId('masked-apollo')).toHaveTextContent('###server###');
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('A3R — failure states', () => {
  it('a GET failure shows an error with retry, and retry re-fetches', async () => {
    responder = () => ({ status: 500, body: { error: 'CREDENTIAL_OPERATION_FAILED' } });
    await renderPanel();
    expect(screen.getByText(/could not be completed/i)).toBeInTheDocument();

    responder = () => listOf(apollo());
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Retry/i })); });
    await waitFor(() => expect(screen.getByTestId('lead-source-apollo')).toBeInTheDocument());
  });

  it('401 is reported as an expired session', async () => {
    responder = () => ({ status: 401, body: { error: 'UNAUTHORIZED' } });
    await renderPanel();
    expect(screen.getByText(/session has expired/i)).toBeInTheDocument();
  });

  it('403 is reported as a permission problem, not a bug', async () => {
    responder = () => ({ status: 403, body: { error: 'FORBIDDEN_ROLE' } });
    await renderPanel();
    expect(screen.getByText(/do not have permission/i)).toBeInTheDocument();
  });

  it('a backend network failure (apiFetch 503) is reported as unreachable', async () => {
    responder = () => ({ status: 503, body: null });
    await renderPanel();
    expect(screen.getByText(/Could not reach Omnivyra/i)).toBeInTheDocument();
  });

  it('a PUT server failure leaves the provider unconfigured and shows a row error', async () => {
    responder = (url, init) => (init?.method === 'PUT'
      ? { status: 500, body: { error: 'CREDENTIAL_OPERATION_FAILED' } }
      : listOf(apollo()));
    await renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /Configure/i }));
    fireEvent.change(screen.getByTestId('key-input-apollo'), { target: { value: SECRET } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Save key/i })); });

    expect(screen.getByTestId('error-apollo')).toBeInTheDocument();
    expect(screen.getByTestId('state-apollo')).toHaveTextContent('Not configured');
  });

  it('a DELETE failure keeps the configured state rather than showing a false revoke', async () => {
    responder = (url, init) => (init?.method === 'DELETE'
      ? { status: 500, body: { error: 'CREDENTIAL_OPERATION_FAILED' } }
      : listOf(apollo({ configured: true, credentialFields: { api_key: '********' } })));
    await renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /Revoke/i }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Yes, revoke/i })); });

    expect(screen.getByTestId('error-apollo')).toBeInTheDocument();
    expect(screen.getByTestId('state-apollo')).toHaveTextContent('Configured');
  });

  it('an empty provider list is an honest empty state, not an invented one', async () => {
    responder = () => listOf();
    await renderPanel();
    expect(screen.getByText(/No lead sources are available/i)).toBeInTheDocument();
  });

  it('saving with a blank field never calls the API', async () => {
    responder = () => listOf(apollo());
    await renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /Configure/i }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Save key/i })); });
    expect(fetchCalls.filter((c) => c.init?.method === 'PUT')).toHaveLength(0);
    expect(screen.getByTestId('error-apollo')).toHaveTextContent(/Enter a key/i);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('A3R — the tab is a sibling, not a second connections surface', () => {
  it('the tab id is registered in the existing API Connections tab list', () => {
    const src = require('fs').readFileSync(
      require('path').join(process.cwd(), 'hooks/useSocialPlatforms.tsx'), 'utf8');
    expect(src).toContain("id: 'lead-sources'");
    // the pre-existing tabs are untouched
    for (const id of ['social', 'trend', 'community', 'image', 'request-new', 'queue']) {
      expect(src).toContain(`id: '${id}'`);
    }
  });

  it('the panel is rendered inside the existing view, not on a new page', () => {
    const view = require('fs').readFileSync(
      require('path').join(process.cwd(), 'components/SocialPlatformsView.tsx'), 'utf8');
    expect(view).toContain("activeTab === 'lead-sources'");
    expect(view).toContain('LeadSourcesPanel');
    const pages = require('fs').readdirSync(require('path').join(process.cwd(), 'pages'));
    expect(pages).not.toContain('lead-sources.tsx');
  });
});
