/**
 * PHASE 13Z — render path ordering (C): ensureRenderFonts() must run BEFORE the
 * first renderAsset() call, so fontconfig is configured before sharp/librsvg
 * resolves any glyph. Uses mocks to observe call order without real rendering.
 */
const order: string[] = [];

jest.mock('../../services/creatorRenderFonts', () => ({
  ensureRenderFonts: jest.fn(() => {
    order.push('fonts');
    return { resolvedFontDir: '/x/assets/fonts', fontCount: 4, configPath: '/tmp/fonts.conf' };
  }),
}));
jest.mock('../../services/creatorAssetRenderer', () => ({
  renderAsset: jest.fn(async () => {
    order.push('render');
    return { url: 'https://storage/x.png', files: [], metadata: {} };
  }),
}));
jest.mock('../../services/supabaseAuthService', () => ({
  getSupabaseUserFromRequest: jest.fn(async () => ({ user: { id: 'u1' }, error: null })),
}));

function mockRes() {
  const res: Record<string, unknown> = {};
  res.status = jest.fn((c: number) => { (res as { statusCode?: number }).statusCode = c; return res; });
  res.json = jest.fn((b: unknown) => { (res as { body?: unknown }).body = b; return res; });
  res.setHeader = jest.fn();
  return res as { status: jest.Mock; json: jest.Mock; setHeader: jest.Mock };
}

describe('C. render-inline POST path', () => {
  beforeEach(() => { order.length = 0; });

  it('calls ensureRenderFonts() before renderAsset()', async () => {
    const handler = (await import('../../../pages/api/command-center/creator-content/render-inline')).default;
    const req = {
      method: 'POST',
      query: {},
      body: { asset_payload: { kind: 'infographic' }, company_id: 'c1', campaign_id: 'k1' },
    } as never;
    const res = mockRes();
    await handler(req, res as never);

    expect(order).toContain('fonts');
    expect(order).toContain('render');
    expect(order.indexOf('fonts')).toBeLessThan(order.indexOf('render'));
    expect(res.status).toHaveBeenCalledWith(200);
  });
});
