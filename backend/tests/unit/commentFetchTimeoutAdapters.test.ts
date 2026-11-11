/**
 * Hotfix: every comment fetch on the recentPublishedPostsIngest path is aborted after
 * COMMENT_FETCH_TIMEOUT_MS. That timer re-arms only after its body returns and its lease
 * keeps renewing while the body runs, so one provider request that never answered used
 * to stop comment ingestion for EVERY tenant until a restart (Orchestration finding).
 * This suite: the LinkedIn, X and YouTube adapters (the first-choice fetchers).
 */
import { linkedinAdapter } from '../../services/platformAdapters/linkedinAdapter';
import { twitterAdapter } from '../../services/platformAdapters/twitterAdapter';
import { youtubeAdapter } from '../../services/platformAdapters/youtubeAdapter';
import { COMMENT_FETCH_TIMEOUT_MS } from '../../services/platformAdapters/baseAdapter';

const realFetch = global.fetch;
afterEach(() => { (global as any).fetch = realFetch; });

/** A provider that never answers: only the request's abort signal ends it. */
function hangingFetch() {
  const inits: Array<{ signal?: AbortSignal } | undefined> = [];
  (global as any).fetch = jest.fn((_url: string, init?: { signal?: AbortSignal }) => {
    inits.push(init);
    return new Promise((_res, rej) => {
      init?.signal?.addEventListener('abort', () => rej(init.signal!.reason ?? new Error('aborted')));
    });
  });
  return inits;
}

const ADAPTERS = [['linkedin', linkedinAdapter], ['x', twitterAdapter], ['youtube', youtubeAdapter]] as const;

it('the default is 15 seconds', () => {
  expect(COMMENT_FETCH_TIMEOUT_MS).toBe(15_000);
});

it.each(ADAPTERS)('%s: a request that never answers is aborted instead of hanging', async (_name, adapter) => {
  hangingFetch();
  const t0 = Date.now();
  await expect(adapter.fetchComments({ platformPostId: 'p1', accessToken: 't', timeoutMs: 50 })).rejects.toBeTruthy();
  expect(Date.now() - t0).toBeLessThan(5_000);
});

it.each(ADAPTERS)('%s: the default call carries an abort signal (the 15 s default applies)', async (_name, adapter) => {
  const inits = hangingFetch();
  const p = adapter.fetchComments({ platformPostId: 'p1', accessToken: 't' });
  p.catch(() => undefined);
  await new Promise((r) => setTimeout(r, 0));
  expect(inits).toHaveLength(1);
  expect(inits[0]?.signal).toBeInstanceOf(AbortSignal);
  expect(inits[0]?.signal?.aborted).toBe(false);
});
