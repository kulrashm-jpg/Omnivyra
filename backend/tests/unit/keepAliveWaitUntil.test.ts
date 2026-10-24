/**
 * keepAliveAfterResponse — reply first, keep working in the background.
 *
 * Production 2026-10-24: the string-built `import('@vercel/functions')` was not
 * shipped with the function, so every report generation held the HTTP request
 * open until it finished (88 s) and the browser connection reset first.
 */
import { keepAliveAfterResponse, platformWaitUntil } from '../../../lib/runtime/keepAlive';

const KEY = Symbol.for('@vercel/request-context');
const g = globalThis as unknown as Record<symbol, unknown>;

afterEach(() => {
  delete g[KEY];
  delete process.env.VERCEL;
});

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
};

describe('keepAliveAfterResponse', () => {
  it('on Vercel with a request context, hands the work to waitUntil and returns immediately', async () => {
    process.env.VERCEL = '1';
    const received: Promise<unknown>[] = [];
    g[KEY] = { get: () => ({ waitUntil: (p: Promise<unknown>) => { received.push(p); } }) };
    const work = deferred();
    const mode = await keepAliveAfterResponse(work.promise); // resolves although work is still pending
    expect(mode).toBe('wait_until');
    expect(received).toEqual([work.promise]);
    work.resolve();
  });

  it('reads the context per call (it is per request)', () => {
    process.env.VERCEL = '1';
    expect(platformWaitUntil()).toBeNull();
    g[KEY] = { get: () => ({ waitUntil: () => undefined }) };
    expect(platformWaitUntil()).not.toBeNull();
  });

  it('on Vercel WITHOUT a request context, awaits the work instead of silently dropping it', async () => {
    process.env.VERCEL = '1';
    let done = false;
    const mode = await keepAliveAfterResponse(new Promise<void>((r) => setTimeout(() => { done = true; r(); }, 10)));
    expect(mode).toBe('awaited');
    expect(done).toBe(true);
  });

  it('off Vercel, awaits even if a context exists', async () => {
    g[KEY] = { get: () => ({ waitUntil: () => { throw new Error('must not be used off Vercel'); } }) };
    let done = false;
    const mode = await keepAliveAfterResponse(new Promise<void>((r) => setTimeout(() => { done = true; r(); }, 5)));
    expect(mode).toBe('awaited');
    expect(done).toBe(true);
  });

  it('no longer uses a string-built dynamic import (invisible to bundling and tracing)', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const src: string = require('fs').readFileSync('lib/runtime/keepAlive.ts', 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''); // the header explains the old form
    expect(code).not.toMatch(/Function\(\s*['"]s['"]/);
    expect(code).not.toMatch(/import\(\s*s\s*\)/);
  });
});
