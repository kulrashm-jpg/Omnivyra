/**
 * Report view page client behaviour (2026-10-24 regression):
 *  - the snapshot HTML request is retried when its body is dropped in transit
 *    (`net::ERR_CONNECTION_RESET 200 (OK)`) or the server answers 5xx;
 *  - the Regenerate button opens the in-flight report named by a
 *    REPORT_IN_PROGRESS 409 instead of dead-ending.
 */
import {
  extractSnapshotHtml,
  fetchSnapshotHtml,
  resolveRegenerateOutcome,
} from '../../../lib/reports/snapshotViewClient';

const DOC = '<html><head><style>.a{color:red}</style></head><body><div class="report-page"><p>ok</p></div></body></html>';

function okResponse(body: string): Response {
  return { ok: true, status: 200, text: async () => body } as unknown as Response;
}
function droppedBodyResponse(): Response {
  // Headers arrived (200) but the body stream broke — what the browser saw.
  return {
    ok: true,
    status: 200,
    text: async () => { throw new TypeError('network error'); },
  } as unknown as Response;
}
function statusResponse(status: number): Response {
  return { ok: false, status, text: async () => '{}' } as unknown as Response;
}

const noSleep = async () => {};

describe('fetchSnapshotHtml', () => {
  it('returns the extracted styles and page markup', async () => {
    const r = await fetchSnapshotHtml(async () => okResponse(DOC), '/x', { sleep: noSleep });
    expect(r).toEqual({ ok: true, html: { styles: '.a{color:red}', markup: '<p>ok</p>' } });
  });

  it('retries a 200 whose body is dropped mid-transfer, then succeeds', async () => {
    const responses = [droppedBodyResponse(), okResponse(DOC)];
    const fetcher = jest.fn(async () => responses.shift() as Response);
    const r = await fetchSnapshotHtml(fetcher, '/x', { sleep: noSleep });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(r.ok).toBe(true);
  });

  it('retries a thrown fetch and a 5xx (apiFetch synthetic 503)', async () => {
    const steps: Array<() => Response> = [
      () => { throw new TypeError('Failed to fetch'); },
      () => statusResponse(503),
      () => okResponse(DOC),
    ];
    const fetcher = jest.fn(async () => (steps.shift() as () => Response)());
    const r = await fetchSnapshotHtml(fetcher, '/x', { sleep: noSleep });
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(r.ok).toBe(true);
  });

  it('gives up after the attempt budget with a network failure', async () => {
    const fetcher = jest.fn(async () => droppedBodyResponse());
    const sleeps: number[] = [];
    const r = await fetchSnapshotHtml(fetcher, '/x', {
      attempts: 3,
      baseDelayMs: 100,
      sleep: async (ms) => { sleeps.push(ms); },
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([100, 200]);
    expect(r).toEqual({ ok: false, reason: 'network', status: null });
  });

  it('does not retry a 4xx — retrying cannot fix auth or not-found', async () => {
    const fetcher = jest.fn(async () => statusResponse(404));
    const r = await fetchSnapshotHtml(fetcher, '/x', { sleep: noSleep });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(r).toEqual({ ok: false, reason: 'http', status: 404 });
  });

  it('treats an empty 200 body as a failed transfer', async () => {
    const fetcher = jest.fn(async () => okResponse('   '));
    const r = await fetchSnapshotHtml(fetcher, '/x', { attempts: 2, sleep: noSleep });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(r.ok).toBe(false);
  });

  it('stops once cancelled (page navigated away)', async () => {
    let cancelled = false;
    const fetcher = jest.fn(async () => { cancelled = true; return droppedBodyResponse(); });
    await fetchSnapshotHtml(fetcher, '/x', { sleep: noSleep, isCancelled: () => cancelled });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('falls back to the whole document when the page wrapper is absent', () => {
    expect(extractSnapshotHtml('<p>bare</p>')).toEqual({ styles: '', markup: '<p>bare</p>' });
  });
});

describe('resolveRegenerateOutcome', () => {
  it('202 with a reportId opens the new report', () => {
    expect(resolveRegenerateOutcome({ ok: true, status: 202 }, { reportId: 'new' }, 'cur'))
      .toEqual({ kind: 'open', reportId: 'new' });
  });

  it('409 REPORT_IN_PROGRESS with another report id opens the in-flight report', () => {
    expect(resolveRegenerateOutcome(
      { ok: false, status: 409 },
      { code: 'REPORT_IN_PROGRESS', reportId: 'running', error: 'Report already in progress' },
      'cur',
    )).toEqual({ kind: 'open', reportId: 'running' });
  });

  it('409 naming the report on screen (or no id) explains instead of looping', () => {
    for (const reportId of ['cur', undefined]) {
      const o = resolveRegenerateOutcome(
        { ok: false, status: 409 },
        { code: 'REPORT_IN_PROGRESS', reportId, error: 'Report already in progress' },
        'cur',
      );
      expect(o.kind).toBe('error');
      if (o.kind === 'error') expect(o.message).toMatch(/already being generated/);
    }
  });

  it('other failures surface the server message', () => {
    expect(resolveRegenerateOutcome({ ok: false, status: 402 }, { error: 'Not enough credits' }, 'cur'))
      .toEqual({ kind: 'error', message: 'Not enough credits' });
    expect(resolveRegenerateOutcome({ ok: false, status: 500 }, null, 'cur'))
      .toEqual({ kind: 'error', message: 'Failed to regenerate report' });
  });
});
