/**
 * CPG-012 slice — the production EvidenceFetcher over safeFetch (network mocked).
 * Proves: every request goes through safeFetch with the caller's host pins, a
 * product User-Agent and bounded timeouts; failures become "not retrieved";
 * once the run's budget is spent no further request is made.
 */

jest.mock('../../../lib/security/safeFetch', () => ({
  safeFetch: jest.fn(),
  readCapped: jest.fn(async () => Buffer.from('<p>ok</p>')),
}));

import { safeFetch } from '../../../lib/security/safeFetch';
import { createSafeEvidenceFetcher, GROUNDING_USER_AGENT } from '../../services/companyProfile/grounding/acquisition/safeEvidenceFetcher';

beforeEach(() => jest.clearAllMocks());

it('fetches through safeFetch with host pins, a product User-Agent (no personal contact) and a bounded timeout', async () => {
  (safeFetch as jest.Mock).mockResolvedValue({ ok: true, status: 200, url: 'https://acme.example.com/' });
  const f = createSafeEvidenceFetcher({ budgetMs: 45_000 });
  const r = await f('https://acme.example.com/', { allowedHosts: ['acme.example.com'], headers: { 'user-agent': 'Registry-UA' } });
  expect(r).toEqual({ ok: true, status: 200, url: 'https://acme.example.com/', text: '<p>ok</p>' });
  const [url, init, opts] = (safeFetch as jest.Mock).mock.calls[0];
  expect(url).toBe('https://acme.example.com/');
  expect(init.headers['user-agent']).toBe('Registry-UA'); // a source's declared UA wins
  expect(opts).toMatchObject({ allowedHosts: ['acme.example.com'], maxRedirects: 3 });
  expect(opts.timeoutMs).toBeLessThanOrEqual(8_000);
  expect(GROUNDING_USER_AGENT).not.toMatch(/@/);
});

it('a blocked or failing request is "not retrieved" (null), never a throw', async () => {
  (safeFetch as jest.Mock).mockRejectedValue(new Error('SSRF: host not allowed'));
  const f = createSafeEvidenceFetcher({ budgetMs: 45_000 });
  await expect(f('https://blocked.example/', {})).resolves.toBeNull();
});

it('once the budget is spent, no further request is made', async () => {
  let t = 0;
  const f = createSafeEvidenceFetcher({ budgetMs: 10_000, now: () => t });
  (safeFetch as jest.Mock).mockResolvedValue({ ok: true, status: 200, url: 'u' });
  t = 9_000;
  await f('https://acme.example.com/a', {});
  expect((safeFetch as jest.Mock).mock.calls[0][2].timeoutMs).toBe(1_000); // never beyond the budget
  t = 10_000;
  await expect(f('https://acme.example.com/b', {})).resolves.toBeNull();
  expect(safeFetch).toHaveBeenCalledTimes(1);
});
