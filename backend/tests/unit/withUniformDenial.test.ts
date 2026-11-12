/**
 * withUniformDenial: ANY guard's 403/404 denial -> the byte-identical UNIFORM_NOT_FOUND 404 (no
 * headers leaked); 401 / 503 replayed verbatim with headers; a grant returns the guard's result
 * and writes nothing.
 */
import { withUniformDenial } from '../../security/withUniformDenial';
import { UNIFORM_NOT_FOUND } from '../../services/userContextService';
function resStub() {
  const r: any = { statusCode: 0, body: undefined, headers: {} as Record<string, string> };
  r.status = (c: number) => { r.statusCode = c; return r; };
  r.json = (b: unknown) => { r.body = b; return r; };
  r.setHeader = (k: string, v: string) => { r.headers[k] = v; return r; };
  return r;
}
it('403 -> uniform 404, no headers leaked', async () => {
  const res = resStub();
  const out = await withUniformDenial(res, async (p) => { p.setHeader('x-corr', 'c1'); p.status(403).json({ code: 'FORBIDDEN' }); return null; });
  expect(out).toBeNull();
  expect(res.statusCode).toBe(404);
  expect(JSON.stringify(res.body)).toBe(JSON.stringify(UNIFORM_NOT_FOUND));
  expect(res.headers).toEqual({});
});
it('503 is replayed verbatim with its headers (an outage is never "not found")', async () => {
  const res = resStub();
  await withUniformDenial(res, async (p) => { p.setHeader('retry-after', '5'); p.status(503).json({ code: 'UNAVAILABLE' }); return null; });
  expect(res.statusCode).toBe(503);
  expect(res.body).toEqual({ code: 'UNAVAILABLE' });
  expect(res.headers['retry-after']).toBe('5');
});
it('a grant returns the result and writes nothing', async () => {
  const res = resStub();
  const out = await withUniformDenial(res, async () => ({ userId: 'u1' }));
  expect(out).toEqual({ userId: 'u1' });
  expect(res.statusCode).toBe(0);
});
