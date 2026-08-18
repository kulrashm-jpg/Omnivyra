/**
 * P1.9 — Server-Timing seam.
 *
 * The decisive assertions are that timing never alters behaviour and never
 * carries anything but a duration: no ids, tokens, SQL or PII.
 */
import { appendServerTiming, timeStage } from '../../../lib/platform/serverTiming';

function mockRes() {
  const headers: Record<string, unknown> = {};
  return {
    headersSent: false,
    setHeader: (k: string, v: unknown) => { headers[k] = v; },
    getHeader: (k: string) => headers[k],
    _headers: headers,
  } as never;
}
const timing = (res: never) => String((res as unknown as { _headers: Record<string, string> })._headers['Server-Timing'] ?? '');

describe('appendServerTiming', () => {
  it('emits a numeric duration', () => {
    const res = mockRes(); appendServerTiming(res, 'auth', 123.6);
    expect(timing(res)).toBe('auth;dur=124');
  });

  it('accumulates stages in order', () => {
    const res = mockRes();
    appendServerTiming(res, 'auth', 1); appendServerTiming(res, 'company', 2); appendServerTiming(res, 'service', 3);
    expect(timing(res)).toBe('auth;dur=1, company;dur=2, service;dur=3');
  });

  it('rejects unsafe names and invalid durations', () => {
    const res = mockRes();
    appendServerTiming(res, 'user@acme.com', 5);
    appendServerTiming(res, 'select * from users', 5);
    appendServerTiming(res, 'auth', Number.NaN);
    appendServerTiming(res, 'auth', -1);
    expect(timing(res)).toBe('');
  });

  it('never writes after headers are sent', () => {
    const res = mockRes(); (res as unknown as { headersSent: boolean }).headersSent = true;
    appendServerTiming(res, 'auth', 5);
    expect(timing(res)).toBe('');
  });
});

describe('timeStage', () => {
  it('returns the value untouched and records the stage', async () => {
    const res = mockRes();
    const out = await timeStage(res, 'service', async () => ({ reports: [1, 2] }));
    expect(out).toEqual({ reports: [1, 2] });
    expect(timing(res)).toMatch(/^service;dur=\d+$/);
  });

  it('records the stage on the failure path and rethrows unchanged', async () => {
    const res = mockRes();
    const boom = new Error('downstream failed');
    await expect(timeStage(res, 'service', async () => { throw boom; })).rejects.toBe(boom);
    expect(timing(res)).toMatch(/^service;dur=\d+$/);
  });

  it('emits only a duration — no payload content reaches the header', async () => {
    const res = mockRes();
    await timeStage(res, 'company', async () => 'company-4bdbec26-4f7e-4e77-a965-d499e1472f5c');
    expect(timing(res)).not.toMatch(/4bdbec26|company-/);
    expect(timing(res)).toMatch(/^company;dur=\d+$/);
  });
});

describe('reports handler wiring', () => {
  const src = require('fs').readFileSync(
    require('path').resolve(__dirname, '../../../pages/api/reports/index.ts'), 'utf8');

  it('wraps auth, company and service', () => {
    expect(src).toContain("timeStage(res, 'auth'");
    expect(src).toContain("timeStage(res, 'company'");
    expect(src).toContain("timeStage(res, 'service'");
  });

  it('emits total on every exit path', () => {
    const exits = (src.match(/return res\.status\(/g) || []).length;
    const totals = (src.match(/appendServerTiming\(res, 'total'/g) || []).length;
    expect(totals).toBeGreaterThanOrEqual(exits - 1); // 405 pre-dates the timer
  });
});
