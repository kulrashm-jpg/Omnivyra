/**
 * Community execution safety — RPA path.
 *
 *   - Runner classifies outcomes by consequence: anything failing after the
 *     submit interaction started (post-condition miss, throw, cancel) is
 *     may_have_acted=true; failures before it are may_have_acted=false.
 *   - Runner refuses to navigate to a URL the policy rejects (no browser).
 *   - In-process queue never re-runs a may-have-acted / thrown task.
 *   - executeRpaTask validates the URL before anything else and only
 *     reports `deferred` when the durable retry row was really queued.
 *
 * No real browser is launched: Playwright is a fake injected via the
 * runner's deps seam; the selector resolver is mocked.
 */

jest.mock('../../db/supabaseClient', () => ({ supabase: { from: jest.fn(), rpc: jest.fn() } }));
jest.mock('../../queue/bullmqClient', () => ({ withHeavyJobSlot: (fn: () => any) => fn() }));
jest.mock('../../services/communityAiPlatformPolicyService', () => ({
  getCommunityAiPlatformPolicy: jest.fn(async () => ({ execution_enabled: true, require_human_approval: false })),
}));

const resolveMock = jest.fn();
const waitAnyMock = jest.fn();
jest.mock('../../services/rpaWorker/selectorResolver', () => ({
  resolveSelector: (...a: any[]) => resolveMock(...a),
  waitForAny: (...a: any[]) => waitAnyMock(...a),
}));

const envReadyMock = jest.fn(async () => ({ ok: true }));
jest.mock('../../services/rpaWorker/rpaEnv', () => ({
  rpaEnvReady: () => envReadyMock(),
  assertRpaEnvReady: jest.fn(),
  isProbeFailure: (r: any) => r && r.ok === false,
}));
const admitMock = jest.fn(async () => ({ admit: true, status: 'READY' }));
jest.mock('../../services/rpaWorker/rpaQueueState', () => ({
  admitRpaTask: (...a: any[]) => (admitMock as any)(...a),
  observeAllActiveOrgs: jest.fn(),
}));
const enqueueRetryMock = jest.fn(async () => ({ queued: true, attempts: 1, next_retry_at: 'x' }));
jest.mock('../../services/rpaWorker/rpaRetryQueue', () => ({
  enqueueRpaRetry: (...a: any[]) => (enqueueRetryMock as any)(...a),
  flushRpaRetryQueueRoundRobin: jest.fn(),
}));
const runScriptMock = jest.fn();
jest.mock('../../services/rpaWorker/rpaPlaywrightRunner', () => {
  const actual = jest.requireActual('../../services/rpaWorker/rpaPlaywrightRunner');
  return { ...actual, runRpaScript: (...a: any[]) => runScriptMock(...a) };
});

import type { RpaScript } from '../../services/rpaWorker/rpaPlaywrightRunner';
import { executeRpaTask, rpaResultMayHaveActed } from '../../services/rpaWorker/rpaWorkerService';
import { enqueueRpaTask, startRpaWorker, isInProcessRetryable } from '../../services/rpaWorker/rpaTaskQueue';

const { runRpaScript } = jest.requireActual('../../services/rpaWorker/rpaPlaywrightRunner') as
  typeof import('../../services/rpaWorker/rpaPlaywrightRunner');

const URL_OK = 'https://www.linkedin.com/feed/update/urn:li:activity:1/';
const task = (over: Record<string, any> = {}) => ({
  tenant_id: 't1', organization_id: 'o1', platform: 'linkedin', action_type: 'like' as const,
  target_url: URL_OK, text: null, action_id: 'a1', ...over,
});

function fakePlaywright() {
  const calls = { launches: 0, gotos: [] as string[], clicks: 0 };
  const page = {
    goto: jest.fn(async (u: string) => { calls.gotos.push(u); }),
    url: jest.fn(() => calls.gotos[calls.gotos.length - 1]),
    waitForTimeout: jest.fn(async () => undefined),
    screenshot: jest.fn(async () => { throw new Error('no screenshots in tests'); }),
    keyboard: { insertText: jest.fn(async () => undefined) },
    close: jest.fn(async () => undefined),
  };
  const pw = {
    chromium: {
      launch: jest.fn(async () => {
        calls.launches += 1;
        return {
          newContext: async () => ({ newPage: async () => page, close: async () => undefined }),
          close: async () => undefined,
        };
      }),
    },
  };
  return { pw, page, calls };
}

const handle = (onClick: () => Promise<void> = async () => undefined) => ({
  click: jest.fn(onClick), fill: jest.fn(async () => undefined), press: jest.fn(async () => undefined),
});

const likeScript = (targetUrl = URL_OK): RpaScript => ({
  targetUrl,
  steps: [
    { kind: 'wait_for_any', selectors: ['button.like'] },
    { kind: 'click', selectors: ['button.like:not([aria-pressed="true"])'], commit: true },
  ],
  postCondition: { kind: 'selector_visible', selectors: ['button.like[aria-pressed="true"]'] },
});

function deps(fake: ReturnType<typeof fakePlaywright>, cancelled: () => Promise<boolean> = async () => false) {
  return {
    envReady: async () => ({ ok: true as const }),
    loadPlaywright: async () => fake.pw,
    loadSession: async () => ({ cookies: [] } as any),
    makeCancellationChecker: () => cancelled,
    saveArtifact: async () => null,
  };
}

beforeEach(() => {
  resolveMock.mockReset();
  waitAnyMock.mockReset();
  runScriptMock.mockReset();
  enqueueRetryMock.mockClear();
  admitMock.mockClear();
  envReadyMock.mockClear();
});

describe('RPA runner — consequence classification', () => {
  it('post-condition failure AFTER the submit click is may_have_acted (never retryable)', async () => {
    const fake = fakePlaywright();
    waitAnyMock.mockResolvedValueOnce(true).mockResolvedValueOnce(false); // step ok, post-condition missing
    resolveMock.mockResolvedValue(handle());
    const r = await runRpaScript(task(), likeScript(), deps(fake));
    expect(r).toMatchObject({ success: false, error: 'RPA_POST_CONDITION_FAILED', may_have_acted: true });
    expect(rpaResultMayHaveActed(r)).toBe(true);
    expect(isInProcessRetryable(r)).toBe(false);
  });

  it('throw DURING the submit click is may_have_acted', async () => {
    const fake = fakePlaywright();
    waitAnyMock.mockResolvedValue(true);
    resolveMock.mockResolvedValue(handle(async () => { throw new Error('Target closed'); }));
    const r = await runRpaScript(task(), likeScript(), deps(fake));
    expect(r).toMatchObject({ success: false, error: 'Target closed', may_have_acted: true });
  });

  it('selector missing BEFORE the submit interaction is provably not acted', async () => {
    const fake = fakePlaywright();
    waitAnyMock.mockResolvedValueOnce(false);
    const r = await runRpaScript(task(), likeScript(), deps(fake));
    expect(r).toMatchObject({ success: false, error: 'SELECTOR_NOT_FOUND', may_have_acted: false });
    expect(isInProcessRetryable(r)).toBe(true);
  });

  it('commit element not found (e.g. already liked) never clicked: not acted', async () => {
    const fake = fakePlaywright();
    waitAnyMock.mockResolvedValue(true);
    resolveMock.mockResolvedValue(null);
    const r = await runRpaScript(task(), likeScript(), deps(fake));
    expect(r).toMatchObject({ success: false, error: 'SELECTOR_NOT_FOUND', may_have_acted: false });
  });

  it('cancel after the submit interaction is may_have_acted; before it is not', async () => {
    const fake = fakePlaywright();
    waitAnyMock.mockResolvedValue(true);
    resolveMock.mockResolvedValue(handle());
    let n = 0;
    // checkpoints: launch, goto, step1 x2, step2 x2, post-condition -> cancel at post-condition
    const late = await runRpaScript(task(), likeScript(), deps(fake, async () => (++n >= 7)));
    expect(late).toMatchObject({ success: false, error: 'RPA_CANCELLED', may_have_acted: true });

    const fake2 = fakePlaywright();
    const early = await runRpaScript(task(), likeScript(), deps(fake2, async () => true));
    expect(early).toMatchObject({ success: false, error: 'RPA_CANCELLED', may_have_acted: false });
    expect(fake2.calls.gotos).toHaveLength(0);
  });

  it('a script with no declared commit step is may_have_acted from its first step', async () => {
    const fake = fakePlaywright();
    waitAnyMock.mockResolvedValueOnce(false);
    const s: RpaScript = { targetUrl: URL_OK, steps: [{ kind: 'wait_for_any', selectors: ['x'] }] };
    const r = await runRpaScript(task(), s, deps(fake));
    expect(r.may_have_acted).toBe(true);
  });

  it('refuses to navigate to a URL the policy rejects (no browser launched)', async () => {
    for (const bad of ['https://linkedin.com.evil.com/x', 'http://www.linkedin.com/x', 'https://www.facebook.com/x']) {
      const fake = fakePlaywright();
      const r = await runRpaScript(task({ target_url: bad }), likeScript(bad), deps(fake));
      expect(r).toMatchObject({ success: false, may_have_acted: false });
      expect(fake.calls.launches).toBe(0);
      expect(fake.calls.gotos).toHaveLength(0);
    }
  });

  it('refuses a script whose targetUrl differs from the validated task URL', async () => {
    const fake = fakePlaywright();
    const other = 'https://www.linkedin.com/feed/update/urn:li:activity:2/';
    const r = await runRpaScript(task(), likeScript(other), deps(fake));
    expect(r).toEqual({ success: false, error: 'RPA_SCRIPT_TARGET_MISMATCH', may_have_acted: false });
    expect(fake.calls.launches).toBe(0);
  });

  it('success navigates exactly once to the validated URL', async () => {
    const fake = fakePlaywright();
    waitAnyMock.mockResolvedValue(true);
    resolveMock.mockResolvedValue(handle());
    const r = await runRpaScript(task(), likeScript(), deps(fake));
    expect(r.success).toBe(true);
    expect(fake.calls.gotos).toEqual([URL_OK]);
  });
});

describe('RPA runner — redirect after navigation', () => {
  it.each([
    ['another host', 'https://evil.example/landing', 'RPA_TARGET_URL_HOST_NOT_ALLOWED'],
    ['a lookalike host', 'https://linkedin.com.evil.com/x', 'RPA_TARGET_URL_HOST_NOT_ALLOWED'],
    ['another platform', 'https://www.facebook.com/x', 'RPA_TARGET_URL_CROSS_PLATFORM'],
    ['plain http', 'http://www.linkedin.com/x', 'RPA_TARGET_URL_NOT_HTTPS'],
  ])('a redirect to %s refuses with no interaction', async (_name, landed, code) => {
    const fake = fakePlaywright();
    fake.page.url.mockReturnValue(landed);
    const h = handle();
    waitAnyMock.mockResolvedValue(true);
    resolveMock.mockResolvedValue(h);
    const r = await runRpaScript(task(), likeScript(), deps(fake));
    expect(r).toEqual({ success: false, error: `RPA_REDIRECT_REFUSED:${code}`, may_have_acted: false });
    expect(waitAnyMock).not.toHaveBeenCalled();
    expect(resolveMock).not.toHaveBeenCalled();
    expect(h.click).not.toHaveBeenCalled();
    expect(fake.page.close).toHaveBeenCalledTimes(1);
  });

  it('a redirect that stays on the platform policy proceeds', async () => {
    const fake = fakePlaywright();
    fake.page.url.mockReturnValue('https://linkedin.com/posts/redirected');
    waitAnyMock.mockResolvedValue(true);
    resolveMock.mockResolvedValue(handle());
    const r = await runRpaScript(task(), likeScript(), deps(fake));
    expect(r.success).toBe(true);
  });
});

describe('RPA runner — screenshot evidence', () => {
  const ACCESS_URL = 'https://storage.example/signed?token=SECRET';
  const saved = (over: Record<string, any> = {}) => ({
    object_path: 'o1/2026-11-02/a1.png', public_url: ACCESS_URL, bytes: 1, kind: 'screenshot' as const, durable: true, ...over,
  });
  const withShot = (fake: ReturnType<typeof fakePlaywright>) => {
    fake.page.screenshot.mockImplementation(async () => Buffer.from('png') as any);
  };
  const throwingClick = () => handle(async () => { throw new Error('Target closed'); });
  const spies: jest.SpyInstance[] = [];
  const mirror = () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fsp = require('fs/promises');
    const mkdir = jest.spyOn(fsp, 'mkdir').mockResolvedValue(undefined as never);
    const writeFile = jest.spyOn(fsp, 'writeFile').mockResolvedValue(undefined as never);
    spies.push(mkdir, writeFile);
    return { mkdir, writeFile };
  };

  afterEach(() => {
    spies.splice(0).forEach((s) => s.mockRestore());
    delete process.env.RPA_SCREENSHOT_DIR;
  });

  it('a throw after the submit started still captures evidence and keeps its outcome', async () => {
    const fake = fakePlaywright();
    withShot(fake);
    waitAnyMock.mockResolvedValue(true);
    resolveMock.mockResolvedValue(throwingClick());
    const saveArtifact = jest.fn(async () => saved());
    const r = await runRpaScript(task(), likeScript(), { ...deps(fake), saveArtifact });
    expect(saveArtifact).toHaveBeenCalledTimes(1);
    expect(r).toEqual({ success: false, error: 'Target closed', may_have_acted: true, screenshot_path: 'o1/2026-11-02/a1.png' });
  });

  it('a cancel after the submit started also captures evidence', async () => {
    const fake = fakePlaywright();
    withShot(fake);
    waitAnyMock.mockResolvedValue(true);
    resolveMock.mockResolvedValue(handle());
    let n = 0;
    const saveArtifact = jest.fn(async () => saved());
    const r = await runRpaScript(task(), likeScript(), { ...deps(fake, async () => (++n >= 7)), saveArtifact });
    expect(r).toEqual({ success: false, error: 'RPA_CANCELLED', may_have_acted: true, screenshot_path: 'o1/2026-11-02/a1.png' });
  });

  it('a failure before the submit takes no screenshot', async () => {
    const fake = fakePlaywright();
    withShot(fake);
    waitAnyMock.mockResolvedValueOnce(false);
    const saveArtifact = jest.fn(async () => saved());
    const r = await runRpaScript(task(), likeScript(), { ...deps(fake), saveArtifact });
    expect(r.may_have_acted).toBe(false);
    expect(fake.page.screenshot).not.toHaveBeenCalled();
    expect(saveArtifact).not.toHaveBeenCalled();
  });

  it('a screenshot failure in the catch path cannot change the outcome', async () => {
    const fake = fakePlaywright(); // its screenshot rejects
    waitAnyMock.mockResolvedValue(true);
    resolveMock.mockResolvedValue(throwingClick());
    const r = await runRpaScript(task(), likeScript(), deps(fake));
    expect(fake.page.screenshot).toHaveBeenCalledTimes(1);
    expect(r).toEqual({ success: false, error: 'Target closed', may_have_acted: true });
  });

  it('a storage failure in the catch path cannot change the outcome', async () => {
    const fake = fakePlaywright();
    withShot(fake);
    waitAnyMock.mockResolvedValue(true);
    resolveMock.mockResolvedValue(throwingClick());
    const saveArtifact = jest.fn(async () => { throw new Error('storage down'); });
    const r = await runRpaScript(task(), likeScript(), { ...deps(fake), saveArtifact });
    expect(r).toEqual({ success: false, error: 'Target closed', may_have_acted: true });
  });

  it.each([
    ['a failure after the submit', () => throwingClick(), { success: false, may_have_acted: true }],
    ['a success', () => handle(), { success: true }],
  ])('a screenshot that never settles cannot hold up %s', async (_name, makeHandle, expected) => {
    const fake = fakePlaywright();
    fake.page.screenshot.mockImplementation(() => new Promise(() => undefined) as any);
    waitAnyMock.mockResolvedValue(true);
    resolveMock.mockResolvedValue(makeHandle());
    const r = await runRpaScript(task(), likeScript(), { ...deps(fake), evidenceTimeoutMs: 5 });
    expect(r).toMatchObject(expected);
    expect(fake.page.close).toHaveBeenCalledTimes(1);
  });

  it('the signed URL is never returned, so it cannot reach execution_result', async () => {
    const fake = fakePlaywright();
    withShot(fake);
    waitAnyMock.mockResolvedValue(true);
    resolveMock.mockResolvedValue(handle());
    const ok = await runRpaScript(task(), likeScript(), { ...deps(fake), saveArtifact: async () => saved() });
    expect(ok.screenshot_path).toBe('o1/2026-11-02/a1.png');
    expect(JSON.stringify(ok)).not.toContain(ACCESS_URL);

    waitAnyMock.mockReset();
    waitAnyMock.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const missed = await runRpaScript(task(), likeScript(), { ...deps(fake), saveArtifact: async () => saved() });
    expect(missed.error).toBe('RPA_POST_CONDITION_FAILED');
    expect(JSON.stringify(missed)).not.toContain(ACCESS_URL);
  });

  it('writes no local mirror by default', async () => {
    const m = mirror();
    const fake = fakePlaywright();
    withShot(fake);
    waitAnyMock.mockResolvedValue(true);
    resolveMock.mockResolvedValue(handle());
    await runRpaScript(task(), likeScript(), { ...deps(fake), saveArtifact: async () => saved() });
    expect(fake.page.screenshot).toHaveBeenCalledTimes(1);
    expect(m.mkdir).not.toHaveBeenCalled();
    expect(m.writeFile).not.toHaveBeenCalled();
  });

  it('writes the local mirror only when RPA_SCREENSHOT_DIR opts in', async () => {
    process.env.RPA_SCREENSHOT_DIR = 'mirror-dir';
    const m = mirror();
    const fake = fakePlaywright();
    withShot(fake);
    waitAnyMock.mockResolvedValue(true);
    resolveMock.mockResolvedValue(handle());
    await runRpaScript(task(), likeScript(), { ...deps(fake), saveArtifact: async () => saved() });
    expect(m.writeFile).toHaveBeenCalledTimes(1);
  });
});

describe('in-process RPA queue — no duplicate attempts', () => {
  it('post-submit failure is returned after exactly one attempt', async () => {
    const h = jest.fn(async () => ({ success: false, error: 'RPA_POST_CONDITION_FAILED', may_have_acted: true }));
    startRpaWorker(h);
    const r = await enqueueRpaTask(task());
    expect(r.error).toBe('RPA_POST_CONDITION_FAILED');
    expect(h).toHaveBeenCalledTimes(1);
  });

  it('an UNCLASSIFIED failure is treated as may-have-acted (one attempt)', async () => {
    const h = jest.fn(async () => ({ success: false, error: 'SOMETHING' }));
    startRpaWorker(h);
    await enqueueRpaTask(task());
    expect(h).toHaveBeenCalledTimes(1);
  });

  it('a thrown handler is rejected after exactly one attempt', async () => {
    const h = jest.fn(async () => { throw new Error('crash'); });
    startRpaWorker(h);
    await expect(enqueueRpaTask(task())).rejects.toThrow('crash');
    expect(h).toHaveBeenCalledTimes(1);
  });

  it('a provably-not-acted failure may be retried once in-process', async () => {
    const h = jest.fn(async () => ({ success: false, error: 'SELECTOR_NOT_FOUND', may_have_acted: false }));
    startRpaWorker(h);
    await enqueueRpaTask(task());
    expect(h).toHaveBeenCalledTimes(2);
  });

  it('a pre-commit cancel is not retried', async () => {
    const h = jest.fn(async () => ({ success: false, error: 'RPA_CANCELLED', may_have_acted: false }));
    startRpaWorker(h);
    await enqueueRpaTask(task());
    expect(h).toHaveBeenCalledTimes(1);
  });
});

describe('executeRpaTask', () => {
  it('rejects an invalid target URL before env / admission / queue / browser', async () => {
    const r = await executeRpaTask(task({ target_url: 'https://evillinkedin.com/x' }));
    expect(r).toEqual({ success: false, error: 'RPA_TARGET_URL_HOST_NOT_ALLOWED', may_have_acted: false });
    expect(envReadyMock).not.toHaveBeenCalled();
    expect(admitMock).not.toHaveBeenCalled();
    expect(enqueueRetryMock).not.toHaveBeenCalled();
    expect(runScriptMock).not.toHaveBeenCalled();
  });

  it('defers (not acted) to the durable queue when the env is not ready', async () => {
    envReadyMock.mockResolvedValueOnce({ ok: false, reason: 'no chromium' } as any);
    const r = await executeRpaTask(task());
    expect(r).toMatchObject({ success: false, deferred: true, may_have_acted: false });
    expect(enqueueRetryMock).toHaveBeenCalledTimes(1);
    expect(runScriptMock).not.toHaveBeenCalled();
  });

  it('reports a plain not-acted failure (not deferred) when the retry row could not be queued', async () => {
    envReadyMock.mockResolvedValueOnce({ ok: false, reason: 'no chromium' } as any);
    enqueueRetryMock.mockResolvedValueOnce({ queued: false, attempts: 5, next_retry_at: 'x', error: 'MAX_ATTEMPTS_EXCEEDED' } as any);
    const r = await executeRpaTask(task());
    expect(r.deferred).toBeUndefined();
    expect(r.may_have_acted).toBe(false);
    expect(r.error).toContain('MAX_ATTEMPTS_EXCEEDED');
  });

  it('applies per-org admission and defers when refused', async () => {
    admitMock.mockResolvedValueOnce({ admit: false, status: 'BLOCKED' } as any);
    const r = await executeRpaTask(task());
    expect(r).toMatchObject({ success: false, deferred: true, error: 'RPA_DEFERRED:BLOCKED' });
    expect(runScriptMock).not.toHaveBeenCalled();
  });

  it('a post-submit runner failure is returned once, never re-run, never queued for retry', async () => {
    runScriptMock.mockResolvedValue({ success: false, error: 'RPA_POST_CONDITION_FAILED', may_have_acted: true });
    const r = await executeRpaTask(task());
    expect(r).toMatchObject({ success: false, may_have_acted: true });
    expect(runScriptMock).toHaveBeenCalledTimes(1);
    expect(enqueueRetryMock).not.toHaveBeenCalled();
  });
});
