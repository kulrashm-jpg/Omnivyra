/**
 * Structural pin (e9 + 05, 2026-11-14): every pages/api catch of TenantSeamError answers through seamDenial
 * (backend/db/seamDenial.ts) - no local copies - so a RETRYABLE seam error (a failed parent read) is a 503 +
 * Retry-After everywhere, never a permanent 404/403. And seamDenial itself: retryable -> 503 + Retry-After with a
 * body that carries neither the id nor the error; otherwise the route's own denial.
 */
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { seamDenial, SEAM_RETRY_BODY } from '../../db/seamDenial';
import { TenantSeamError } from '../../db/tenantTable';

const ROOT = path.resolve(__dirname, '../../..');
/** Reviewed exemptions: a catch that sends NO response (best-effort background work). */
const EXEMPT: Record<string, string> = {
  'pages/api/campaigns/metrics.ts': 'updateCampaignCompletion is best-effort background bookkeeping: it logs the seam code and returns, no response',
};

/** Returns the offending `file:line` list for a source (pure, so the positive control can feed fixtures). */
export function rawSeamCatches(rel: string, src: string): string[] {
  if (EXEMPT[rel]) return [];
  const lines = src.split('\n');
  const usesDenial = /instanceof TenantSeamError\) return seamDeni(al|ed)\(/.test(src);
  const out: string[] = [];
  lines.forEach((l, i) => {
    if (!/instanceof TenantSeamError/.test(l)) return;
    if (/seamDeni(al|ed)\(/.test(l)) return;
    if (/instanceof TenantSeamError\) return \w+;\s*$/.test(l) && usesDenial) return; // helper hands the error to a seamDenial check
    if (/\{\s*$/.test(l) && /seamDeni(al|ed)\(/.test(lines.slice(i + 1, i + 4).join('\n'))) return;
    out.push(`${rel}:${i + 1}`);
  });
  return out;
}

describe('every pages/api TenantSeamError catch goes through seamDenial', () => {
  const files = execFileSync('git', ['grep', '-l', 'instanceof TenantSeamError', '--', 'pages/api'], { cwd: ROOT, encoding: 'utf8' })
    .trim().split('\n').filter(Boolean);
  it('the scan sees the converted routes (positive control on the corpus)', () => {
    expect(files.length).toBeGreaterThanOrEqual(40);
  });
  it('no raw catch remains', () => {
    const raw = files.flatMap((rel) => rawSeamCatches(rel, fs.readFileSync(path.join(ROOT, rel), 'utf8')));
    expect(raw).toEqual([]);
  });
  it('POSITIVE CONTROL: the scan flags a raw 404, a raw 403 block and a null-returning helper with a raw denial', () => {
    expect(rawSeamCatches('x.ts', "  if (err instanceof TenantSeamError) return res.status(404).json({ error: 'Campaign not found' });")).toEqual(['x.ts:1']);
    expect(rawSeamCatches('x.ts', 'if (e instanceof TenantSeamError) {\n  return res.status(403).json({});\n}')).toEqual(['x.ts:1']);
    expect(rawSeamCatches('x.ts', '  if (err instanceof TenantSeamError) return null;\n  if (!h) return res.status(403).json({});')).toEqual(['x.ts:1']);
  });
});

describe('seamDenial behaviour', () => {
  const fakeRes = () => {
    const r: any = { headers: {} as Record<string, string>, statusCode: 0, body: undefined };
    r.setHeader = (k: string, v: string) => { r.headers[k] = v; };
    r.status = (s: number) => { r.statusCode = s; return r; };
    r.json = (b: unknown) => { r.body = b; return r; };
    return r;
  };
  it('a retryable (unreadable parent) error -> 503 + Retry-After, plain body without id or error text', () => {
    const err = new TenantSeamError('TENANT_PARENT_UNREADABLE', 'daily_content_plans: parent campaigns unreadable (57014) camp-secret-id');
    expect(err.retryable).toBe(true);
    const res = fakeRes();
    seamDenial(res, err, 404, { error: 'Campaign not found' });
    expect(res.statusCode).toBe(503);
    expect(res.headers['Retry-After']).toBe('5');
    expect(res.body).toEqual(SEAM_RETRY_BODY);
    expect(JSON.stringify(res.body)).not.toMatch(/camp-secret-id|57014|unreadable/);
  });
  it.each(['TENANT_MISMATCH', 'TENANT_CONTEXT_MISSING', 'TENANT_TABLE_UNKNOWN', 'TENANT_PAYLOAD_INVALID', 'TENANT_PARENT_FANOUT'] as const)(
    '%s -> not retryable -> the route\'s own denial', (code) => {
      const err = new TenantSeamError(code, 'x');
      expect(err.retryable).toBe(false);
      const res = fakeRes();
      seamDenial(res, err, 404, { error: 'Campaign not found' });
      expect(res.statusCode).toBe(404);
      expect(res.body).toEqual({ error: 'Campaign not found' });
      expect(res.headers['Retry-After']).toBeUndefined();
    });
});
