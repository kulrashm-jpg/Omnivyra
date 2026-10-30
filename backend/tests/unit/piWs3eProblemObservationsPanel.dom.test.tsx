/**
 * @jest-environment jsdom
 *
 * WS-3E — the Observed Problems panel.
 *
 * The panel reads `GET /api/prospects/[id]/problems` and renders what a prospect
 * has been recorded as saying. The backend contract is already covered by
 * `piWs3dProblemObservationRoute` (65 tests) and `piWs3dProblemObservationCapture`
 * (56) — method gating, tenant validation, capability, server-owned-field
 * refusal, the 400 vocabulary, the cross-tenant 404 and idempotency are NOT
 * re-litigated here. What is tested here is only what the DOM can get wrong.
 *
 * ─── SCOPING IS LOAD-BEARING ──────────────────────────────────────────────
 * `ProspectIntelligencePanel` renders, on the same page and with no testids of
 * its own, a "Confidence" table column, em-dash absence cells, an "As of" row
 * and state badges reading "Nothing recorded" / "Unavailable". Every one of
 * those collides with this panel's vocabulary. So every assertion below is
 * scoped to the `problem-observations` root with `within(...)`; a document-wide
 * query here would pass or fail for the wrong reason.
 *
 * ─── CAPTURE EXISTS, AND IT IS A CHOICE AMONG VERIFIED MESSAGES ────────
 * An earlier revision of this suite said there was no capture form, because a
 * free-text origin is a citation nobody can follow. That reasoning still holds
 * and there are still no source text boxes — what changed is that the server
 * now publishes the messages it would accept, and takes only a message id.
 *
 * The invariant pinned below is therefore no longer "this panel never writes"
 * but the narrower, truer one: rendering, toggling the subject, opening the
 * picker and choosing a message are all READS, and only an explicit submit
 * writes — once, with a body carrying no statement, no time and no origin.
 */

import React from 'react';
import { render, screen, waitFor, fireEvent, act, within } from '@testing-library/react';
// Imported for `toHaveAttribute`, the idiom `scoreCoveragePanel.dom.test.tsx`
// uses for the same aria-busy assertion. Absence is still asserted with
// `queryBy… → toBeNull()`, which needs no matcher extension.
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

// eslint-disable-next-line @typescript-eslint/no-var-requires
import ProblemObservationsPanel from '@/components/prospects/ProblemObservationsPanel';

const ORG = '11111111-1111-4111-8111-111111111111';
const PROSPECT = '22222222-2222-4222-8222-222222222222';
const PERSON = '33333333-3333-4333-8333-333333333333';

type Row = Record<string, unknown>;

const observation = (over: Row = {}): Row => ({
  id: 'ppo-1',
  organizationId: ORG,
  subjectType: 'person',
  subjectId: PERSON,
  statement: 'Our onboarding takes six weeks and we lose half the cohort before day one.',
  statementLanguage: null,
  originStore: 'crm_notes',
  originRecordId: 'note-8841',
  originKind: 'human',
  recordedByUserId: '44444444-4444-4444-8444-444444444444',
  sourceRecordId: null,
  confidence: null,
  observedAt: '2026-09-14T08:15:00.000Z',
  recordedAt: '2026-10-28T19:02:00.000Z',
  ...over,
});

const ok = (observations: Row[]): Reply => ({
  status: 200,
  body: {
    version: 'ws10.1',
    contract: 'pi-problem-obs.1',
    subjectType: 'person',
    subjectId: PERSON,
    state: 'available',
    observations,
  },
});

const MSG = '55555555-5555-4555-8555-555555555555';

const eligibleOk = (messages: Row[] = [{
  messageId: MSG,
  threadId: 'thread-1',
  channel: 'linkedin',
  preview: 'Our onboarding takes six weeks and we lose half the cohort.',
  truncated: false,
  observedAt: '2026-09-14T08:15:00.000Z',
}]): Reply => ({
  status: 200,
  body: {
    version: 'ws10.1', contract: 'pi-problem-obs.1',
    eligibility: 'pi-problem-obs-eligible.1',
    subjectType: 'person', subjectId: PERSON, reason: null,
    messages,
    ineligible: { examined: 3, subjectMismatch: 1, notProspectAuthored: 1, observationTimeAbsent: 0, statementAbsent: 0 },
  },
});

/**
 * Routes BOTH reads and the write by url/method, rather than one blanket reply.
 * A single blanket responder answered the second read with the first read's
 * body in an earlier suite and an assertion then passed for the wrong reason.
 */
const routed = (over: {
  observations?: Row[];
  eligible?: Reply;
  post?: Reply;
} = {}) => {
  responder = (url: string, init?: RequestInit) => {
    if ((init?.method ?? 'GET').toUpperCase() === 'POST') {
      return over.post ?? { status: 201, body: { version: 'ws10.1', contract: 'pi-problem-obs.1', observationId: 'ppo-new', duplicate: false } };
    }
    if (url.includes('/eligible-messages')) return over.eligible ?? eligibleOk();
    return ok(over.observations ?? [observation()]);
  };
};

const openPicker = async () => {
  await act(async () => { fireEvent.click(panel().getByTestId('problems-capture-open')); });
  await waitFor(() => expect(panel().getByTestId('problems-capture-options')).toBeTruthy());
};

const choose = async (id = MSG) => {
  await act(async () => { fireEvent.click(panel().getByTestId(`problems-capture-option-${id}`)); });
};

const writes = () => fetchCalls.filter((c) => (c.init?.method ?? 'GET').toUpperCase() !== 'GET');

const mount = (companyId = ORG) => render(
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    <ProblemObservationsPanel companyId={companyId} prospectId={PROSPECT} />
  </SWRConfig>,
);

/** Every query is scoped to this panel. See the header. */
const panel = () => within(screen.getByTestId('problem-observations'));
const panelText = (): string => screen.getByTestId('problem-observations').textContent ?? '';

beforeEach(() => {
  fetchCalls.length = 0;
  responder = () => ok([observation()]);
});

// ═══════════════════════════════════════════════════════════════════════════
describe('WS-3E · recorded statements render faithfully', () => {
  it('renders SEVERAL statements for one subject, each as its own record', async () => {
    responder = () => ok([
      observation({ id: 'ppo-1', statement: 'Onboarding takes six weeks.' }),
      observation({ id: 'ppo-2', statement: 'Our reporting is manual every month.', originRecordId: 'note-8842' }),
      observation({ id: 'ppo-3', statement: 'We cannot see which accounts are at risk.', originRecordId: 'note-8843' }),
    ]);
    mount();

    await waitFor(() => expect(panel().getByTestId('problems-list')).toBeTruthy());
    expect(panel().getAllByTestId(/^problem-ppo-/)).toHaveLength(3);
    expect(panel().getByTestId('problem-statement-ppo-1').textContent).toBe('Onboarding takes six weeks.');
    expect(panel().getByTestId('problem-statement-ppo-2').textContent).toBe('Our reporting is manual every month.');
    expect(panel().getByTestId('problem-statement-ppo-3').textContent)
      .toBe('We cannot see which accounts are at risk.');
  });

  it('reproduces the statement verbatim — no truncation, no summary', async () => {
    const words = 'Procurement blocks every renewal and nobody can tell us why, so we re-negotiate from zero.';
    responder = () => ok([observation({ statement: words })]);
    mount();
    await waitFor(() => expect(panel().getByTestId('problem-statement-ppo-1').textContent).toBe(words));
  });

  it('names the source the words can be re-read from', async () => {
    mount();
    await waitFor(() => expect(panel().getByTestId('problem-origin-ppo-1').textContent)
      .toContain('crm_notes'));
    expect(panel().getByTestId('problem-origin-ppo-1').textContent).toContain('note-8841');
  });

  it('keeps the SOURCE clock and OUR clock visibly apart', async () => {
    mount();
    await waitFor(() => expect(panel().getByTestId('problem-observed-ppo-1')).toBeTruthy());
    // Different values, each under its own label.
    expect(panel().getByTestId('problem-observed-ppo-1').textContent).toContain('2026-09-14');
    expect(panel().getByTestId('problem-recorded-ppo-1').textContent).toContain('2026-10-28');
    expect(panelText()).toMatch(/Stated \(per source\)/);
    expect(panelText()).toMatch(/Recorded by Omnivyra/);
  });

  it('an unknown source time stays unknown while our recording time still shows', async () => {
    // The contract keeps these two columns apart precisely so one is never read
    // for the other. A null source time must not borrow `recordedAt`.
    responder = () => ok([observation({ observedAt: null })]);
    mount();
    await waitFor(() => expect(panel().getByTestId('problem-observed-ppo-1').textContent).toBe('—'));
    expect(panel().getByTestId('problem-recorded-ppo-1').textContent).toContain('2026-10-28');
  });
});

describe('WS-3E · confidence is the source’s, or absent', () => {
  it('an unrecorded confidence reads "not stated", never 0%', async () => {
    mount();
    await waitFor(() => expect(panel().getByTestId('problem-confidence-ppo-1').textContent)
      .toMatch(/not stated/i));
    expect(panelText()).not.toMatch(/0\s?%/);
  });

  it('a genuine 0 is a value the source stated, not an absence', async () => {
    responder = () => ok([observation({ confidence: 0 })]);
    mount();
    await waitFor(() => expect(panel().getByTestId('problem-confidence-ppo-1').textContent).toMatch(/0%/));
    expect(panel().getByTestId('problem-confidence-ppo-1').textContent).not.toMatch(/not stated/i);
  });

  it('a stated confidence is attributed to the source, not to Omnivyra', async () => {
    responder = () => ok([observation({ confidence: 0.8 })]);
    mount();
    await waitFor(() => expect(panel().getByTestId('problem-confidence-ppo-1').textContent)
      .toMatch(/80%.*source-reported/i));
  });
});

describe('WS-3E · empty, loading and unreadable are three different answers', () => {
  it('no statements recorded is an absence of records, not a finding', async () => {
    responder = () => ok([]);
    mount();
    await waitFor(() => expect(panel().getByTestId('problems-empty')).toBeTruthy());
    expect(panel().getByTestId('problems-empty').textContent)
      .toMatch(/absence of\s+records, not a finding/i);
    expect(panel().queryByTestId('problems-error')).toBeNull();
    expect(panel().queryByTestId('problems-list')).toBeNull();
  });

  it('loading is distinguishable from both empty and unreadable', async () => {
    responder = () => new Promise<never>(() => { /* never settles */ });
    mount();
    await waitFor(() => expect(screen.getByTestId('problem-observations'))
      .toHaveAttribute('aria-busy', 'true'));
    expect(panel().getByTestId('problems-loading')).toBeTruthy();
    expect(panel().queryByTestId('problems-empty')).toBeNull();
    expect(panel().queryByTestId('problems-error')).toBeNull();
  });

  it('a 503 is "we could not look" and is NEVER rendered as "nothing recorded"', async () => {
    responder = () => ({ status: 503, body: { error: 'problem_observations_unavailable', retryable: true } });
    mount();
    await waitFor(() => expect(panel().getByTestId('problems-error')).toBeTruthy());
    expect(panel().getByTestId('problems-error').textContent)
      .toMatch(/could not be read.*not been altered/i);
    // The load-bearing negative: absence must not be manufactured from a failure.
    expect(panel().queryByTestId('problems-empty')).toBeNull();
    expect(panel().queryByTestId('problems-list')).toBeNull();
  });

  it('the error is announced to assistive technology', async () => {
    responder = () => ({ status: 503, body: { error: 'problem_observations_unavailable' } });
    mount();
    await waitFor(() => expect(panel().getByRole('alert')).toBeTruthy());
  });

  it('Retry re-reads, and the statements appear once the store answers', async () => {
    let healthy = false;
    responder = () => (healthy
      ? ok([observation()])
      : { status: 503, body: { error: 'problem_observations_unavailable' } });
    mount();

    await waitFor(() => expect(panel().getByTestId('problems-error')).toBeTruthy());
    const before = fetchCalls.length;

    healthy = true;
    await act(async () => { fireEvent.click(panel().getByTestId('problems-retry')); });

    await waitFor(() => expect(panel().getByTestId('problems-list')).toBeTruthy());
    expect(fetchCalls.length).toBeGreaterThan(before);
    expect(panel().queryByTestId('problems-error')).toBeNull();
  });
});

describe('WS-3E · failures are never dressed as success', () => {
  const cases: Array<[string, Reply, RegExp]> = [
    ['401', { status: 401, body: { error: 'Not authenticated', code: 'NOT_AUTHENTICATED' } }, /session has expired/i],
    ['403', { status: 403, body: { error: 'Tenant access denied', code: 'NOT_A_MEMBER' } }, /do not have permission/i],
    ['404', { status: 404, body: { error: 'prospect_not_found' } }, /not available in this workspace/i],
  ];

  for (const [label, reply, expected] of cases) {
    it(`${label} shows a reason and no statements`, async () => {
      responder = () => reply;
      mount();
      await waitFor(() => expect(panel().getByTestId('problems-error')).toBeTruthy());
      expect(panel().getByTestId('problems-error').textContent).toMatch(expected);
      expect(panel().queryByTestId('problems-list')).toBeNull();
      expect(panel().queryByTestId('problems-empty')).toBeNull();
    });
  }

  it('a 404 never claims the prospect exists elsewhere', async () => {
    // The route answers `subject_other_tenant` identically to `subject_not_found`
    // so that the API is not a cross-tenant existence oracle. A UI that said
    // "you do not have access to this prospect" would rebuild that oracle.
    responder = () => ({ status: 404, body: { error: 'prospect_not_found' } });
    mount();
    await waitFor(() => expect(panel().getByTestId('problems-error')).toBeTruthy());
    expect(panelText()).not.toMatch(/do not have access|another workspace|belongs to/i);
  });

  it('a transport failure is an error, not an empty list', async () => {
    responder = () => { throw new Error('network down'); };
    mount();
    await waitFor(() => expect(panel().getByTestId('problems-error')).toBeTruthy());
    expect(panel().queryByTestId('problems-empty')).toBeNull();
  });
});

describe('WS-3E · the tenant and the prospect come from context, never from a field', () => {
  it('reads nothing at all until a company is selected', async () => {
    mount('');
    expect(panel().getByTestId('problems-no-tenant')).toBeTruthy();
    expect(fetchCalls).toHaveLength(0);
  });

  it('carries the verified tenant and prospect in the URL', async () => {
    mount();
    await waitFor(() => expect(fetchCalls.length).toBeGreaterThan(0));
    expect(fetchCalls[0].url).toBe(
      `/api/prospects/${PROSPECT}/problems?companyId=${ORG}&subjectType=person`,
    );
  });

  it('offers no input a user could use to name a tenant, prospect or subject id', async () => {
    mount();
    await waitFor(() => expect(panel().getByTestId('problems-list')).toBeTruthy());
    const root = screen.getByTestId('problem-observations');
    const named = Array.from(root.querySelectorAll('input, select, textarea'))
      .filter((el) => /company|organi[sz]ation|tenant|prospect|subject/i.test(
        `${el.getAttribute('id') ?? ''} ${el.getAttribute('name') ?? ''}`,
      ));
    expect(named).toHaveLength(0);
  });

  it('the subject toggle changes the read, not the identifiers', async () => {
    mount();
    await waitFor(() => expect(fetchCalls.length).toBeGreaterThan(0));
    await act(async () => { fireEvent.click(panel().getByTestId('problems-subject-account')); });
    await waitFor(() => expect(fetchCalls.some((c) => c.url.includes('subjectType=account'))).toBe(true));
    // The prospect and the tenant are unchanged; only the subject leg moved.
    for (const c of fetchCalls) {
      expect(c.url).toContain(`/api/prospects/${PROSPECT}/problems`);
      expect(c.url).toContain(`companyId=${ORG}`);
    }
  });
});

describe('WS-3E · rendering statements is not scoring them', () => {
  it('issues no write until the operator submits a chosen message', async () => {
    // The original assertion is KEPT verbatim and then extended. Its point was
    // never "this panel cannot write" — it was "nothing writes by accident". So
    // the interaction set now covers every affordance that is NOT the submit:
    // rendering, toggling the subject, opening the picker, and choosing a row.
    routed();
    mount();
    await waitFor(() => expect(panel().getByTestId('problems-list')).toBeTruthy());
    await act(async () => { fireEvent.click(panel().getByTestId('problems-subject-account')); });
    expect(writes()).toHaveLength(0);

    await act(async () => { fireEvent.click(panel().getByTestId('problems-subject-person')); });
    await waitFor(() => expect(panel().getByTestId('problems-capture-open')).toBeTruthy());
    await openPicker();
    expect(writes()).toHaveLength(0);
    await choose();
    expect(writes()).toHaveLength(0);
  });

  it('renders no quality verdict anywhere in the panel', async () => {
    responder = () => ok([
      observation({ id: 'ppo-1', confidence: 0.9 }),
      observation({ id: 'ppo-2', confidence: 0.1, originRecordId: 'note-8842' }),
    ]);
    mount();
    await waitFor(() => expect(panel().getAllByTestId(/^problem-ppo-/)).toHaveLength(2));
    expect(panelText())
      .not.toMatch(/\b(score|scored|scoring|rating|ranked?|priority|weight|dimension|strong|weak|poor|qualified)\b/i);
  });

  it('aggregates nothing — no count-as-strength and no averaged confidence', async () => {
    responder = () => ok([
      observation({ id: 'ppo-1', confidence: 0.9 }),
      observation({ id: 'ppo-2', confidence: 0.1, originRecordId: 'note-8842' }),
    ]);
    mount();
    await waitFor(() => expect(panel().getAllByTestId(/^problem-ppo-/)).toHaveLength(2));
    // Each source value is reproduced; their mean (50%) is never shown.
    expect(panelText()).toContain('90%');
    expect(panelText()).toContain('10%');
    expect(panelText()).not.toContain('50%');
    expect(panelText()).not.toMatch(/average|overall|total|combined/i);
  });

  it('picks no winner — several statements are a history, not a current problem', async () => {
    responder = () => ok([
      observation({ id: 'ppo-1', observedAt: '2026-09-14T08:15:00.000Z' }),
      observation({ id: 'ppo-2', observedAt: '2026-03-02T08:15:00.000Z', originRecordId: 'note-8842' }),
    ]);
    mount();
    await waitFor(() => expect(panel().getAllByTestId(/^problem-ppo-/)).toHaveLength(2));
    // Both rows survive; nothing is marked current, latest, primary or superseded.
    expect(panelText()).not.toMatch(/\b(current|latest|most recent|primary|superseded|outdated)\b/i);
  });

  it('says plainly that whether a statement matches the offering is not assessed', async () => {
    mount();
    await waitFor(() => expect(panel().getByTestId('problems-list')).toBeTruthy());
    expect(panelText()).toMatch(/separate assessment that Omnivyra does not yet make/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
/**
 * WS-3E/3I · capture is a choice among messages the SERVER verified.
 *
 * The backend contract is covered by `piWs3dProblemObservationRoute` and
 * `piWs3hEligibleProspectMessages`; none of that is re-litigated here. What is
 * tested is only what the DOM can get wrong: writing without being asked,
 * sending words the server is supposed to derive, claiming a success the server
 * did not report, and fabricating a row.
 */
describe('WS-3E · capture from a verified message', () => {
  it('the submit sends ONE post naming only the message, and no statement', async () => {
    routed();
    mount();
    await waitFor(() => expect(panel().getByTestId('problems-list')).toBeTruthy());
    await openPicker();
    await choose();
    await act(async () => { fireEvent.click(panel().getByTestId('problems-capture-submit')); });

    expect(writes()).toHaveLength(1);
    const post = writes()[0];
    expect(post.url).toBe(`/api/prospects/${PROSPECT}/problems?companyId=${ORG}`);
    const body = JSON.parse(String(post.init?.body)) as Record<string, unknown>;
    // EXACT shape: the server derives everything else from the message.
    expect(body).toEqual({ subjectType: 'person', source: { messageId: MSG } });
    for (const forbidden of [
      'statement', 'observedAt', 'origin', 'originKind', 'sourceRecordId',
      'statementLanguage', 'confidence', 'recordedAt', 'recordedByUserId',
      'derivedFrom', 'id', 'statementHash', 'subjectId',
      'organizationId', 'organization_id', 'companyId', 'company_id',
    ]) {
      expect(Object.keys(body)).not.toContain(forbidden);
    }
  });

  it('re-reads the history only after the server confirms, and renders what came back', async () => {
    let stored = [observation({ id: 'ppo-1' })];
    responder = (url: string, init?: RequestInit) => {
      if ((init?.method ?? 'GET').toUpperCase() === 'POST') {
        stored = [observation({ id: 'ppo-1' }), observation({ id: 'ppo-2', statement: 'Reporting is manual.' })];
        return { status: 201, body: { version: 'ws10.1', contract: 'pi-problem-obs.1', observationId: 'ppo-2', duplicate: false } };
      }
      if (url.includes('/eligible-messages')) return eligibleOk();
      return ok(stored);
    };
    mount();
    await waitFor(() => expect(panel().getAllByTestId(/^problem-ppo-/)).toHaveLength(1));
    await openPicker();
    await choose();
    await act(async () => { fireEvent.click(panel().getByTestId('problems-capture-submit')); });

    await waitFor(() => expect(panel().getAllByTestId(/^problem-ppo-/)).toHaveLength(2));
    expect(panel().getByTestId('problems-capture-recorded')).toBeTruthy();
  });

  it('a duplicate is a success that adds nothing, and does not claim a new record', async () => {
    routed({ post: { status: 200, body: { version: 'ws10.1', contract: 'pi-problem-obs.1', observationId: 'ppo-1', duplicate: true } } });
    mount();
    await waitFor(() => expect(panel().getAllByTestId(/^problem-ppo-/)).toHaveLength(1));
    await openPicker();
    await choose();
    await act(async () => { fireEvent.click(panel().getByTestId('problems-capture-submit')); });

    await waitFor(() => expect(panel().getByTestId('problems-capture-already')).toBeTruthy());
    expect(panel().getByTestId('problems-capture-already').textContent).toMatch(/already recorded/i);
    expect(panel().getByTestId('problems-capture-already').textContent).toMatch(/nothing was added/i);
    // The list did not grow, and no row was synthesised locally.
    expect(panel().getAllByTestId(/^problem-ppo-/)).toHaveLength(1);
    expect(panel().queryByTestId('problems-capture-recorded')).toBeNull();
  });

  const failures: Array<[string, Reply]> = [
    ['400 refusal', { status: 400, body: { error: 'source_not_prospect_authored', detail: 'stored evidence does not establish the prospect wrote it', rejections: [] } }],
    ['404', { status: 404, body: { error: 'prospect_not_found' } }],
    ['503', { status: 503, body: { error: 'problem_observations_unavailable', retryable: true } }],
  ];
  for (const [label, reply] of failures) {
    it(`${label} is never shown as a successful capture`, async () => {
      routed({ post: reply });
      mount();
      await waitFor(() => expect(panel().getAllByTestId(/^problem-ppo-/)).toHaveLength(1));
      await openPicker();
      await choose();
      await act(async () => { fireEvent.click(panel().getByTestId('problems-capture-submit')); });

      await waitFor(() => expect(panel().getByTestId('problems-capture-refused')).toBeTruthy());
      expect(panel().queryByTestId('problems-capture-recorded')).toBeNull();
      expect(panel().queryByTestId('problems-capture-already')).toBeNull();
      // No row was added, and the failure is announced.
      expect(panel().getAllByTestId(/^problem-ppo-/)).toHaveLength(1);
      expect(panel().getByRole('alert')).toBeTruthy();
    });
  }

  it('offers only what the server returned — there is no field to type a source into', async () => {
    routed();
    mount();
    await waitFor(() => expect(panel().getByTestId('problems-list')).toBeTruthy());
    await openPicker();
    // Exactly one option, matching the one message the server published.
    expect(panel().getAllByTestId(/^problems-capture-option-/)).toHaveLength(1);
    const root = screen.getByTestId('problem-observations');
    const typeable = Array.from(root.querySelectorAll('input, select, textarea'))
      .filter((el) => el.getAttribute('type') !== 'radio');
    expect(typeable).toHaveLength(0);
  });

  it('submit is unavailable until a message is chosen', async () => {
    routed();
    mount();
    await waitFor(() => expect(panel().getByTestId('problems-list')).toBeTruthy());
    await openPicker();
    expect(panel().getByTestId('problems-capture-submit')).toBeDisabled();
    // A disabled button proves nothing about a programmatic click, so assert
    // the real invariant too: nothing was sent.
    await act(async () => { fireEvent.click(panel().getByTestId('problems-capture-submit')); });
    expect(writes()).toHaveLength(0);
  });

  it('an unreadable message store leaves the history intact and blocks the choice', async () => {
    routed({ eligible: { status: 503, body: { error: 'eligible_messages_unavailable', retryable: true } } });
    mount();
    await waitFor(() => expect(panel().getByTestId('problems-list')).toBeTruthy());
    await act(async () => { fireEvent.click(panel().getByTestId('problems-capture-open')); });

    await waitFor(() => expect(panel().getByTestId('problems-capture-error')).toBeTruthy());
    expect(panel().queryByTestId('problems-capture-options')).toBeNull();
    expect(panel().getByTestId('problems-capture-submit')).toBeDisabled();
    // The statements already read are untouched by a picker failure.
    expect(panel().getAllByTestId(/^problem-ppo-/)).toHaveLength(1);
  });

  it('no eligible message is an absence, not a failure', async () => {
    routed({ eligible: eligibleOk([]) });
    mount();
    await waitFor(() => expect(panel().getByTestId('problems-list')).toBeTruthy());
    await act(async () => { fireEvent.click(panel().getByTestId('problems-capture-open')); });

    await waitFor(() => expect(panel().getByTestId('problems-capture-none')).toBeTruthy());
    expect(panel().queryByTestId('problems-capture-error')).toBeNull();
  });

  it('the account leg offers no capture and reads no messages', async () => {
    routed();
    mount();
    await waitFor(() => expect(panel().getByTestId('problems-list')).toBeTruthy());
    await act(async () => { fireEvent.click(panel().getByTestId('problems-subject-account')); });

    await waitFor(() => expect(panel().getByTestId('problems-capture-account')).toBeTruthy());
    expect(panel().queryByTestId('problems-capture-open')).toBeNull();
    // Not merely hidden: no eligibility read is issued for an account at all.
    expect(fetchCalls.filter((c) => c.url.includes('/eligible-messages'))).toHaveLength(0);
    expect(writes()).toHaveLength(0);
  });

  it('the picker is absent when the statements themselves could not be read', async () => {
    responder = () => ({ status: 503, body: { error: 'problem_observations_unavailable', retryable: true } });
    mount();
    await waitFor(() => expect(panel().getByTestId('problems-error')).toBeTruthy());
    // We could not look, so we cannot know what is capturable.
    expect(panel().queryByTestId('problems-capture')).toBeNull();
    expect(panel().queryByTestId('problems-capture-open')).toBeNull();
  });
});
