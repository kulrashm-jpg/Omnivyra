import {
  assembleBrandRuntime,
  resolveBrand,
  scoreBrandCompleteness,
  selectAccentColor,
  brandCacheKey,
  resetBrandRuntimeCache,
  invalidateBrandRuntime,
  isValidHex,
  type BrandDataLoad,
  type BrandDataLoader,
} from '../../services/brand/brandRuntime';

const NOW = '2026-06-16T00:00:00.000Z';
const empty: BrandDataLoad = { version: null, profile: null };

describe('BrandRuntime — defaults parity', () => {
  it('a defaults-only tenant resolves to the current constants', () => {
    const rt = assembleBrandRuntime('co1', empty, {}, NOW);
    expect(rt.colors.palette).toEqual(['#111827', '#2563eb', '#14b8a6']);
    expect(rt.colors.background).toBe('#0f172a');
    expect(rt.colors.surface).toBe('#ffffff');
    expect(rt.colors.text).toBe('#111827');
    expect(rt.colors.mutedText).toBe('#334155');
    expect(rt.typography.headingFont).toBe('Arial, Helvetica, sans-serif');
    expect(rt.typography.bodyFont).toBe('Inter, Arial');
    expect(rt.typography.headingWeight).toBe(900);
    expect(rt.typography.bodyWeight).toBe(600);
    expect(rt.typography.pdfFont).toBe('Helvetica');
    expect(isValidHex(rt.colors.accent)).toBe(true);
    expect(rt.meta.source).toBe('defaults');
    expect(rt.meta.completeness).toBe(0);
    expect(rt.meta.warnings).toEqual([]);
  });

  it('profile layer fills name/logo/voice over defaults', () => {
    const rt = assembleBrandRuntime('co1', {
      version: null,
      profile: { name: 'Acme', logoUrl: 'https://cdn/acme.png', brandVoice: 'dry, direct' },
    }, {}, NOW);
    expect(rt.name).toBe('Acme');
    expect(rt.logo.primary).toBe('https://cdn/acme.png');
    expect(rt.voice.tone).toBe('dry, direct');
    expect(rt.meta.source).toBe('company_profiles');
  });
});

describe('BrandRuntime — version-row layering', () => {
  const versionLoad: BrandDataLoad = {
    version: {
      version: 3, status: 'published',
      colors: { palette: ['#ff0000', '#0000ff'], primary: '#ff0000' },
      typography: { bodyFont: 'Poppins' },
      voice: { tone: 'bold', ctaStyle: 'direct ask' },
      tagline: 'Be bold', updated_at: '2026-06-15T00:00:00Z', published_at: '2026-06-15T00:00:00Z',
    },
    profile: { name: 'Acme', logoUrl: 'https://cdn/acme.png' },
  };

  it('brand_identity row wins over defaults', () => {
    const rt = assembleBrandRuntime('co1', versionLoad, {}, NOW);
    expect(rt.colors.palette).toEqual(['#ff0000', '#0000ff']);
    expect(rt.typography.bodyFont).toBe('Poppins');
    expect(rt.voice.tone).toBe('bold');
    expect(rt.tagline).toBe('Be bold');
    expect(rt.meta.version).toBe(3);
    expect(rt.meta.source).toBe('brand_identity');
    expect(rt.meta.completeness).toBeGreaterThan(0);
  });
});

describe('BrandRuntime — validation (normalize/warn/default, never blocks)', () => {
  it('drops invalid hex to defaults with a warning', () => {
    const rt = assembleBrandRuntime('co1', {
      version: { version: 1, status: 'published', colors: { palette: ['#ff0000', 'notacolor', '#0000ff'], background: 'bad' } },
      profile: null,
    }, {}, NOW);
    expect(rt.colors.palette).toEqual(['#ff0000', '#0000ff']); // invalid dropped
    expect(rt.colors.background).toBe('#0f172a');               // defaulted
    expect(rt.meta.warnings).toContain('dropped_invalid_color:notacolor');
    expect(rt.meta.warnings).toContain('dropped_invalid_color:background');
  });

  it('quote-sanitizes the brand font (SVG-attribute safety)', () => {
    const rt = assembleBrandRuntime('co1', {
      version: { version: 1, status: 'published', typography: { bodyFont: 'My "Brand" Font, serif' } }, profile: null,
    }, {}, NOW);
    expect(rt.typography.bodyFont).toBe("My 'Brand' Font, serif");
  });

  it('drops a non-http logo url with a warning', () => {
    const rt = assembleBrandRuntime('co1', {
      version: { version: 1, status: 'published', logo_assets: { primary: 'ftp://x/y.png' } }, profile: null,
    }, {}, NOW);
    expect(rt.logo.primary).toBeUndefined();
    expect(rt.meta.warnings).toContain('dropped_invalid_logo_url');
  });
});

describe('BrandRuntime — completeness scoring', () => {
  it('ranges 0..1 and rewards populated brands', () => {
    const full = assembleBrandRuntime('co1', {
      version: {
        version: 1, status: 'published',
        colors: { palette: ['#ff0000', '#00ff00'] }, typography: { bodyFont: 'Poppins' },
        voice: { tone: 'bold', ctaStyle: 'try it' }, tagline: 'Be bold',
        logo_assets: { primary: 'https://cdn/x.png' },
      }, profile: null,
    }, {}, NOW);
    expect(full.meta.completeness).toBeGreaterThan(0.9);
    expect(full.meta.completeness).toBeLessThanOrEqual(1);
    expect(scoreBrandCompleteness(assembleBrandRuntime('c', empty, {}, NOW))).toBe(0);
  });

  it('regulated tenants are scored against compliance; non-regulated are not penalized', () => {
    const base = (regulated: boolean) => assembleBrandRuntime('co1', {
      version: {
        version: 1, status: 'published',
        colors: { palette: ['#ff0000', '#00ff00'] }, typography: { bodyFont: 'Poppins' },
        voice: { tone: 'bold' }, compliance: { regulated, disclaimers: [] },
      }, profile: null,
    }, {}, NOW);
    expect(base(true).meta.completeness).toBeLessThan(base(false).meta.completeness);
  });
});

describe('BrandRuntime — accent + cache keys', () => {
  it('selectAccentColor returns a hex from the palette/default', () => {
    expect(isValidHex(selectAccentColor(['#2563eb', '#14b8a6']))).toBe(true);
    expect(isValidHex(selectAccentColor([]))).toBe(true);
  });
  it('cache keys: head by status, pinned by version', () => {
    expect(brandCacheKey('c', 'published')).toBe('brand:rt:c:published');
    expect(brandCacheKey('c', 'published', 3)).toBe('brand:rt:c:v:3');
    expect(brandCacheKey('c', 'draft')).not.toBe(brandCacheKey('c', 'published'));
  });
});

describe('BrandRuntime — resolveBrand (published/preview/version + cache)', () => {
  beforeEach(() => resetBrandRuntimeCache());
  const now = () => Date.parse(NOW);

  it('resolves published by default and caches (loader called once)', async () => {
    let calls = 0;
    const load: BrandDataLoader = async () => { calls += 1; return { version: { version: 5, status: 'published', voice: { tone: 'x' } }, profile: { name: 'Acme' } }; };
    const a = await resolveBrand('co1', {}, { load, now });
    const b = await resolveBrand('co1', {}, { load, now });
    expect(a.meta.status).toBe('published');
    expect(a.meta.version).toBe(5);
    expect(b).toBe(a);     // cache hit (same object)
    expect(calls).toBe(1);
  });

  it('preview resolves the draft and is isolated from published cache', async () => {
    const load: BrandDataLoader = async (_c, opts) =>
      opts.preview
        ? { version: { version: 6, status: 'draft', tagline: 'draft tag' }, profile: null }
        : { version: { version: 5, status: 'published', tagline: 'pub tag' }, profile: null };
    const pub = await resolveBrand('co1', {}, { load, now });
    const pre = await resolveBrand('co1', { preview: true }, { load, now });
    expect(pub.meta.status).toBe('published');
    expect(pub.tagline).toBe('pub tag');
    expect(pre.meta.status).toBe('draft');
    expect(pre.tagline).toBe('draft tag');   // preview did not serve the published payload
  });

  it('version-pins via options.version', async () => {
    const load: BrandDataLoader = async (_c, opts) => ({ version: { version: opts.version ?? 0, status: 'published' }, profile: null });
    const rt = await resolveBrand('co1', { version: 2 }, { load, now });
    expect(rt.meta.version).toBe(2);
  });

  it('invalidateBrandRuntime forces a reload on the next resolve', async () => {
    let calls = 0;
    const load: BrandDataLoader = async () => { calls += 1; return { version: { version: 5, status: 'published' }, profile: null }; };
    await resolveBrand('co1', {}, { load, now });
    invalidateBrandRuntime('co1');
    await resolveBrand('co1', {}, { load, now });
    expect(calls).toBe(2);
  });

  it('never throws when the loader fails — falls back to defaults', async () => {
    const load: BrandDataLoader = async () => { throw new Error('db down'); };
    const rt = await resolveBrand('co1', {}, { load, now });
    expect(rt.meta.source).toBe('defaults');
    expect(rt.colors.palette).toEqual(['#111827', '#2563eb', '#14b8a6']);
  });
});
