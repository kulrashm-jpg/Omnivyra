/**
 * PHASE 13Z — Vercel font provisioning tests (A: ensureRenderFonts, B: probe mode).
 * Uses the REAL modules (no mocks) — exercises actual path resolution, config
 * writing, and a real sharp render via the ?probe=1 handler branch.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ensureRenderFonts, __resetRenderFontsCacheForTest } from '../../services/creatorRenderFonts';

const PRIOR_FC = process.env.FONTCONFIG_FILE;

beforeEach(() => {
  __resetRenderFontsCacheForTest();
});
afterAll(() => {
  // Don't leak FONTCONFIG_FILE into sibling test files in the same worker.
  if (PRIOR_FC === undefined) delete process.env.FONTCONFIG_FILE;
  else process.env.FONTCONFIG_FILE = PRIOR_FC;
  __resetRenderFontsCacheForTest();
});

describe('A. ensureRenderFonts()', () => {
  it('resolves the vendored assets/fonts dir and counts the .ttf files', () => {
    const d = ensureRenderFonts();
    expect(d.resolvedFontDir).toMatch(/assets[\\/]fonts$/);
    expect(d.fontCount).toBeGreaterThanOrEqual(4); // 4 vendored Inter weights
    expect(process.env.FONTCONFIG_FILE).toBe(path.join(os.tmpdir(), 'fonts.conf'));
  });

  it('writes a fonts.conf with the bundled dir, cachedir, and Arial→Inter alias', () => {
    const d = ensureRenderFonts();
    const conf = fs.readFileSync(d.configPath, 'utf8');
    expect(conf).toContain('<dir>');
    expect(conf).toContain('<cachedir>');
    expect(conf).toContain('<family>Arial</family>');
    expect(conf).toContain('<family>Inter</family>');
  });

  it('is idempotent and never throws on repeat calls', () => {
    const a = ensureRenderFonts();
    const b = ensureRenderFonts();
    expect(b).toEqual(a);
    expect(() => ensureRenderFonts()).not.toThrow();
  });
});

describe('B. render-inline ?probe=1 mode', () => {
  function mockRes() {
    const res: Record<string, unknown> = {};
    res.status = jest.fn((c: number) => { (res as { statusCode?: number }).statusCode = c; return res; });
    res.json = jest.fn((b: unknown) => { (res as { body?: unknown }).body = b; return res; });
    res.setHeader = jest.fn();
    return res as { status: jest.Mock; json: jest.Mock; setHeader: jest.Mock; body?: { ok: boolean; inkRatio: number; resolvedFontDir: string | null; fontCount: number } };
  }

  it('returns font diagnostics + ok, executing real font init + probe in-function', async () => {
    const handler = (await import('../../../pages/api/command-center/creator-content/render-inline')).default;
    const req = { query: { probe: '1' }, method: 'GET' } as never;
    const res = mockRes();
    await handler(req, res as never);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.body).toBeDefined();
    expect(typeof res.body!.ok).toBe('boolean');
    expect(res.body!.fontCount).toBeGreaterThanOrEqual(4);
    expect(res.body!.resolvedFontDir).toMatch(/assets[\\/]fonts$/);
    expect(res.body!.ok).toBe(true);            // vendored Inter resolves locally
    expect(res.body!.inkRatio).toBeGreaterThan(0);
  });
});
