import { brandRuntimeToCreatorBrandKit } from '../../services/brand/brandRuntimeAdapter';
import { assembleBrandRuntime } from '../../services/brand/brandRuntime';
import { resolveCreatorBrandKit } from '../../services/creatorBrandKit';

const NOW = '2026-06-16T00:00:00.000Z';
const DEFAULT_PALETTE = ['#111827', '#2563eb', '#14b8a6'];
const defaultsRt = () => assembleBrandRuntime('co1', { version: null, profile: null }, {}, NOW);

describe('adapter — defaults parity (ZERO DRIFT)', () => {
  it('a defaults-only runtime maps to the exact current default kit', () => {
    const adapted = brandRuntimeToCreatorBrandKit(defaultsRt());
    const baseline = resolveCreatorBrandKit({
      companyId: 'co1', tenantId: 'co1',
      assetPayload: { color_palette: DEFAULT_PALETTE },
      metadata: { brand_context: { profile: {} } },
    });
    expect(adapted).toEqual(baseline); // full deep equality across ALL fields
  });

  it('shape parity + default typography/palette/companyName preserved', () => {
    const k = brandRuntimeToCreatorBrandKit(defaultsRt());
    for (const f of [
      'companyName', 'logoUrl', 'palette', 'normalizedPalette', 'typography', 'accentColor',
      'contrastProfile', 'overlayStrategy', 'layoutVariantId', 'renderIdentityHash', 'resolvedBrandMark',
    ]) {
      expect(k).toHaveProperty(f);
    }
    expect(k.typography.fontFamily).toBe('Arial, Helvetica, sans-serif');
    expect(k.typography.headingWeight).toBe(900);
    expect(k.typography.bodyWeight).toBe(600);
    expect(k.typography.pdfFont).toBe('Helvetica');
    expect(k.palette).toEqual(DEFAULT_PALETTE);
    expect(k.companyName).toBe('OMNIVYRA'); // resolver default preserved (not 'Brand')
  });
});

describe('adapter — accent mapping (Section D)', () => {
  it('accentColor comes from runtime.colors.accent', () => {
    const rt = assembleBrandRuntime('co1', {
      version: { version: 1, status: 'published', colors: { palette: ['#ffffff', '#123456', '#abcdef'] } }, profile: null,
    }, {}, NOW);
    const k = brandRuntimeToCreatorBrandKit(rt);
    expect(k.accentColor).toBe(rt.colors.accent);
  });
});

describe('adapter — populated runtime mappings', () => {
  const rt = assembleBrandRuntime('co1', {
    version: {
      version: 4, status: 'published',
      colors: { palette: ['#ff0000', '#00ff00', '#0000ff'] },
      typography: { bodyFont: 'Poppins', bodyWeight: 500 },
      logo_assets: { primary: 'https://cdn/acme.png' },
      voice: { tone: 'bold' },
    },
    profile: { name: 'Acme' },
  }, {}, NOW);
  const k = brandRuntimeToCreatorBrandKit(rt);

  it('palette mapping (brand colors first, defaults padded)', () => {
    expect(k.normalizedPalette).toEqual(['#ff0000', '#00ff00', '#0000ff']);
    expect(k.palette.slice(0, 3)).toEqual(['#ff0000', '#00ff00', '#0000ff']);
  });
  it('typography mapping uses the brand font + brand weight, defaults preserved', () => {
    expect(k.typography.fontFamily).toBe('Poppins');
    expect(k.typography.bodyWeight).toBe(500);
    expect(k.typography.headingWeight).toBe(900);
  });
  it('logo mapping', () => {
    expect(k.logoUrl).toBe('https://cdn/acme.png');
    expect(k.resolvedBrandMarkType).toBe('logo');
  });
  it('metadata mapping', () => {
    expect(k.companyName).toBe('Acme');
    expect(k.companyId).toBe('co1');
    expect(k.tenantId).toBe('co1');
  });
});
