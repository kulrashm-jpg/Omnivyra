/**
 * RESILIENCE-BLOG-001 — characterization of blog ISR build-time resilience.
 *
 * `getStaticPaths` in pages/blog/[slug].tsx prebuilds the 50 most recent
 * published slugs. That query is an OPTIMIZATION, not a correctness
 * requirement: `fallback: 'blocking'` already generates any slug that was not
 * prebuilt on its first request, and `getStaticProps` re-fetches by slug
 * independently, so an on-demand page is byte-identical to a prebuilt one.
 *
 * Previously a database blip during `next build` failed the whole deploy for
 * the sake of that optimization. These tests pin the new fail-open behaviour
 * AND pin that the success path and all runtime behaviour are unchanged.
 */

// react-markdown and the rehype plugins are ESM-only; jest's CJS resolver
// cannot load them. The page imports them for RENDERING, which these tests do
// not exercise — they only call the exported data functions.
jest.mock('react-markdown', () => ({ __esModule: true, default: () => null }));
jest.mock('rehype-raw', () => ({ __esModule: true, default: () => undefined }));
jest.mock('rehype-sanitize', () => ({ __esModule: true, default: () => undefined }));

const listRecentPublishedSlugs = jest.fn();
const getPublishedBlogPost = jest.fn();
jest.mock('../../services/blog/publicBlogRead', () => ({
  listRecentPublishedSlugs: (...a: unknown[]) => listRecentPublishedSlugs(...a),
  getPublishedBlogPost: (...a: unknown[]) => getPublishedBlogPost(...a),
  listPublishedBlogPosts: jest.fn(),
}));

/* eslint-disable @typescript-eslint/no-var-requires */
const page = require('../../../pages/blog/[slug]');
const getStaticPaths = page.getStaticPaths as (c: unknown) => Promise<any>;
const getStaticProps = page.getStaticProps as (c: unknown) => Promise<any>;

let warnSpy: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => warnSpy.mockRestore());

describe('RESILIENCE-BLOG-001 — getStaticPaths success path is UNCHANGED', () => {
  it('prebuilds exactly the slugs the query returns, in order', async () => {
    listRecentPublishedSlugs.mockResolvedValue(['alpha', 'beta', 'gamma']);
    const result = await getStaticPaths({});
    expect(result.paths).toEqual([
      { params: { slug: 'alpha' } },
      { params: { slug: 'beta' } },
      { params: { slug: 'gamma' } },
    ]);
    expect(result.fallback).toBe('blocking');
  });

  it('still requests the same window of 50 recent slugs', async () => {
    listRecentPublishedSlugs.mockResolvedValue([]);
    await getStaticPaths({});
    expect(listRecentPublishedSlugs).toHaveBeenCalledWith(50);
  });

  it('does not log on the success path', async () => {
    listRecentPublishedSlugs.mockResolvedValue(['alpha']);
    await getStaticPaths({});
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('an empty database yields no prebuilt paths and still builds', async () => {
    listRecentPublishedSlugs.mockResolvedValue([]);
    const result = await getStaticPaths({});
    expect(result).toEqual({ paths: [], fallback: 'blocking' });
    expect(warnSpy).not.toHaveBeenCalled(); // empty is not a failure
  });
});

describe('RESILIENCE-BLOG-001 — getStaticPaths FAILURE path now fails open', () => {
  it('DB unavailable → resolves instead of throwing (the build survives)', async () => {
    listRecentPublishedSlugs.mockRejectedValue(
      new Error('SUPABASE_URL is missing in environment variables.'),
    );
    await expect(getStaticPaths({})).resolves.toBeDefined();
  });

  it('DB unavailable → paths is EMPTY', async () => {
    listRecentPublishedSlugs.mockRejectedValue(new Error('publicBlogRead.slugs failed: timeout'));
    const result = await getStaticPaths({});
    expect(result.paths).toEqual([]);
  });

  it('DB unavailable → fallback REMAINS blocking (ISR still generates on request)', async () => {
    listRecentPublishedSlugs.mockRejectedValue(new Error('connection refused'));
    const result = await getStaticPaths({});
    expect(result.fallback).toBe('blocking');
  });

  it('logs once, and only once, across repeated invocations', async () => {
    // The "log once" flag is module-level, so this needs a FRESH module
    // instance — earlier failure cases in this file already consumed the one
    // permitted log, which is itself the behaviour under test.
    listRecentPublishedSlugs.mockRejectedValue(new Error('connection refused'));
    let fresh: any;
    jest.isolateModules(() => {
      fresh = require('../../../pages/blog/[slug]');
    });
    await fresh.getStaticPaths({});
    await fresh.getStaticPaths({});
    await fresh.getStaticPaths({});
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0][0])).toContain('getStaticPaths prebuild skipped');
  });

  it('the log is suppressed on subsequent failures in the same process', async () => {
    // Continuation of the case above: this module instance has already logged.
    listRecentPublishedSlugs.mockRejectedValue(new Error('connection refused'));
    await getStaticPaths({});
    expect(warnSpy).not.toHaveBeenCalled();
    // ...but it still fails open.
    await expect(getStaticPaths({})).resolves.toEqual({ paths: [], fallback: 'blocking' });
  });

  it('a non-Error rejection is handled without throwing', async () => {
    listRecentPublishedSlugs.mockRejectedValue('bare string failure');
    const result = await getStaticPaths({});
    expect(result).toEqual({ paths: [], fallback: 'blocking' });
  });
});

describe('RESILIENCE-BLOG-001 — runtime (ISR) behaviour is UNCHANGED', () => {
  it('first-request generation still resolves the post by slug and sets revalidate', async () => {
    const post = { id: 'p1', slug: 'alpha', title: 'Alpha' };
    getPublishedBlogPost.mockResolvedValue(post);
    const result = await getStaticProps({ params: { slug: 'alpha' } });
    expect(getPublishedBlogPost).toHaveBeenCalledWith('alpha');
    expect(result).toEqual({ props: { post }, revalidate: 300 });
  });

  it('an unknown slug is still a real 404, with revalidate', async () => {
    getPublishedBlogPost.mockResolvedValue(null);
    await expect(getStaticProps({ params: { slug: 'nope' } })).resolves.toEqual({
      notFound: true,
      revalidate: 300,
    });
  });

  it('a blank slug still short-circuits to 404 without querying', async () => {
    await expect(getStaticProps({ params: { slug: '   ' } })).resolves.toEqual({
      notFound: true,
      revalidate: 300,
    });
    expect(getPublishedBlogPost).not.toHaveBeenCalled();
  });

  it('getStaticProps still PROPAGATES database errors — only the prebuild is fail-open', async () => {
    // The page body cannot be rendered without its post, so an ISR
    // revalidation failure must keep serving the last good page rather than
    // bake a broken one. That contract is deliberately untouched.
    getPublishedBlogPost.mockRejectedValue(new Error('publicBlogRead.get failed: timeout'));
    await expect(getStaticProps({ params: { slug: 'alpha' } })).rejects.toThrow(
      'publicBlogRead.get failed',
    );
  });
});
