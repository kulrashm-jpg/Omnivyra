/**
 * G-1 — public social profile observation, mediated by the approved SERP provider.
 *
 * WHY SERP AND NOT A DIRECT FETCH
 * The G-1 audit read the platforms' own robots.txt. For `User-agent: *`, LinkedIn, Instagram,
 * Facebook, X and Reddit all answer `Disallow: /`; LinkedIn adds an instruction to apply for
 * whitelisting. Only YouTube permits generic crawling. So nothing in this feature contacts a social
 * platform. It asks the SAME approved SERP provider Report 1 already pays for what the public index
 * holds — by construction only what each platform allows to be indexed.
 *
 * THE CONTRACT UNDER TEST
 *   - a candidate URL becomes `observed` ONLY when a returned result resolves to that same profile;
 *   - a company-declared URL with no matching public result stays `declared` and never acquires
 *     PUBLIC_OBSERVED provenance — the G-8 boundary, now enforced one layer further out;
 *   - a provider that could not answer yields `unreachable`, so "we did not look" is never readable
 *     as "nothing is there";
 *   - title/description are kept only when actually returned, and there is no follower field at all;
 *   - one query per report, not one per platform;
 *   - the observation reaches `CanonicalDeclaredEvidence.social_presence` and the renderer.
 *
 * Scope is G-1 only. No post acquisition, no engagement, no content analysis, no scoring.
 */
jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }));

import {
  observeSocialPresence,
  buildSocialObservationQuery,
  socialPlatformOf,
} from '../../services/socialPresenceObservation';
import { provenanceForSource } from '../../services/evidenceProvenance';
import { renderDeclaredEvidence } from '../../services/intelligence/exportRendererSectionsB';
import type { SerpKeywordResult } from '../../services/reportCompetitorIntelligenceServiceHelpers';

const LINKEDIN = 'https://www.linkedin.com/company/northwind';
const INSTAGRAM = 'https://www.instagram.com/northwind';
const X_URL = 'https://x.com/northwind';

const serpOk = (rows: Array<{ url: string; title?: string | null; snippet?: string | null }>): SerpKeywordResult => ({
  status: 'ok',
  rows: rows.map((row, index) => ({
    position: index + 1,
    url: row.url,
    domain: new URL(row.url).hostname,
    title: row.title ?? null,
    snippet: row.snippet ?? null,
  })),
  reason: null,
});

const serpDown = (status: 'unavailable' | 'failed'): SerpKeywordResult => ({ status, rows: [], reason: 'x' });

const observe = (
  candidateUrls: string[],
  result: SerpKeywordResult,
  fetchSpy = jest.fn(async (_keyword: string, _geography: string | null) => result),
) => ({
  fetchSpy,
  run: () => observeSocialPresence({
    candidateUrls,
    companyName: 'Northwind',
    websiteDomain: 'northwind.test',
    fetchSerp: fetchSpy as never,
    now: () => new Date('2026-09-07T00:00:00.000Z'),
  }),
});

describe('G-1 — public social presence observation', () => {
  // -- 1-2. Observed vs declared -----------------------------------------------
  describe('1-2. an observation requires a matching public result', () => {
    it('marks a declared LinkedIn URL observed when the public index returns it', async () => {
      const { run } = observe([LINKEDIN], serpOk([{ url: LINKEDIN, title: 'Northwind | LinkedIn', snippet: 'Analytics for ops teams.' }]));
      const [entry] = await run();
      expect(entry.status).toBe('observed');
      expect(entry.platform).toBe('linkedin');
      expect(entry.source).toBe('serp');
      expect(entry.observed_at).toBe('2026-09-07T00:00:00.000Z');
    });

    it('leaves the same URL declared when no matching public result exists', async () => {
      const { run } = observe([LINKEDIN], serpOk([{ url: 'https://northwind.test/about' }]));
      const [entry] = await run();
      expect(entry.status).toBe('declared');
      expect(entry.observed_at).toBeNull();
      expect(entry.source).toBe('unspecified');
    });
  });

  // -- 8. Provenance ------------------------------------------------------------
  describe('8. PUBLIC_OBSERVED is assigned only to real observations', () => {
    it('gives an observed entry PUBLIC_OBSERVED provenance', async () => {
      const { run } = observe([LINKEDIN], serpOk([{ url: LINKEDIN }]));
      const [entry] = await run();
      expect(provenanceForSource(entry.source)).toBe('PUBLIC_OBSERVED');
    });

    it('never gives a declared entry PUBLIC_OBSERVED provenance', async () => {
      const { run } = observe([LINKEDIN], serpOk([]));
      const [entry] = await run();
      expect(provenanceForSource(entry.source)).toBe('UNAVAILABLE');
      expect(provenanceForSource(entry.source)).not.toBe('PUBLIC_OBSERVED');
    });

    it('never gives an unreachable entry PUBLIC_OBSERVED provenance', async () => {
      for (const status of ['unavailable', 'failed'] as const) {
        const { run } = observe([LINKEDIN], serpDown(status));
        const [entry] = await run();
        expect(entry.status).toBe('unreachable');
        expect(provenanceForSource(entry.source)).not.toBe('PUBLIC_OBSERVED');
      }
    });
  });

  // -- 3-4. Only what was actually returned -------------------------------------
  describe('3-4. metadata is retained only when returned, and never fabricated', () => {
    it('keeps title and snippet when the provider returned them', async () => {
      const { run } = observe([LINKEDIN], serpOk([{ url: LINKEDIN, title: 'Northwind', snippet: 'Ops analytics.' }]));
      const [entry] = await run();
      expect(entry.name).toBe('Northwind');
      expect(entry.description).toBe('Ops analytics.');
    });

    it('leaves them null when the provider returned none', async () => {
      const { run } = observe([LINKEDIN], serpOk([{ url: LINKEDIN, title: null, snippet: '   ' }]));
      const [entry] = await run();
      expect(entry.name).toBeNull();
      expect(entry.description).toBeNull();
    });

    it('carries no follower or engagement field at all', async () => {
      const { run } = observe([LINKEDIN], serpOk([{ url: LINKEDIN, title: 'Northwind — 12,431 followers' }]));
      const [entry] = await run();
      const keys = Object.keys(entry).join(' ');
      expect(keys).not.toMatch(/follower|engagement|audience|reach|likes/i);
      // The provider's own title is preserved verbatim; nothing parses a number out of it.
      expect(entry).not.toHaveProperty('followers');
    });
  });

  // -- 5. Mismatch rejection ----------------------------------------------------
  describe('5. a mismatched result is rejected', () => {
    it('does not accept a different profile on the same platform', async () => {
      const { run } = observe([LINKEDIN], serpOk([{ url: 'https://www.linkedin.com/company/contoso', title: 'Contoso' }]));
      const [entry] = await run();
      expect(entry.status).toBe('declared');
      expect(entry.name).toBeNull();
    });

    it('does not accept a post/article URL as the profile', async () => {
      const { run } = observe([LINKEDIN], serpOk([{ url: 'https://www.linkedin.com/posts/northwind_activity-123' }]));
      const [entry] = await run();
      expect(entry.status).toBe('declared');
    });
  });

  // -- 6. Multiple platforms ----------------------------------------------------
  describe('6. platforms coexist without overwriting each other', () => {
    it('resolves each candidate independently', async () => {
      const { run } = observe(
        [LINKEDIN, INSTAGRAM, X_URL],
        serpOk([{ url: LINKEDIN, title: 'Northwind | LinkedIn' }, { url: X_URL, title: 'Northwind (@northwind)' }]),
      );
      const entries = await run();
      expect(entries.map((e) => `${e.platform}:${e.status}`)).toEqual([
        'linkedin:observed', 'instagram:declared', 'x:observed',
      ]);
    });
  });

  // -- 7. Normalization / de-duplication ----------------------------------------
  describe('7. normalization prevents duplicate representations', () => {
    it('collapses two spellings of the same profile into one entry', async () => {
      const { run } = observe(
        ['https://www.linkedin.com/company/northwind/', 'https://linkedin.com/company/northwind'],
        serpOk([{ url: LINKEDIN }]),
      );
      const entries = await run();
      expect(entries).toHaveLength(1);
      expect(entries[0].status).toBe('observed');
    });

    it('matches a result whose URL spelling differs from the candidate', async () => {
      const { run } = observe([LINKEDIN], serpOk([{ url: 'https://linkedin.com/company/northwind/?trk=abc' }]));
      const [entry] = await run();
      expect(entry.status).toBe('observed');
    });

    it('recognises the supported platforms and ignores unrelated hosts', () => {
      expect(socialPlatformOf(LINKEDIN)).toBe('linkedin');
      expect(socialPlatformOf('https://twitter.com/northwind')).toBe('x');
      expect(socialPlatformOf('https://youtu.be/abc')).toBe('youtube');
      expect(socialPlatformOf('https://www.tiktok.com/@northwind')).toBe('tiktok');
      expect(socialPlatformOf('https://www.reddit.com/r/northwind')).toBe('reddit');
      expect(socialPlatformOf('https://northwind.test/blog')).toBeNull();
    });
  });

  // -- Budget: one query, not one per platform ----------------------------------
  describe('budget — a single bounded query', () => {
    it('issues exactly one SERP query for many candidates', async () => {
      const { fetchSpy, run } = observe([LINKEDIN, INSTAGRAM, X_URL], serpOk([{ url: LINKEDIN }]));
      await run();
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('issues no query at all when there is no candidate', async () => {
      const fetchSpy = jest.fn(async (_keyword: string, _geography: string | null) => serpOk([]));
      const entries = await observeSocialPresence({ candidateUrls: [], fetchSerp: fetchSpy as never, companyName: 'Northwind' });
      expect(entries).toEqual([]);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('anchors the query on the company identity', () => {
      expect(buildSocialObservationQuery({ companyName: 'Northwind', websiteDomain: 'northwind.test' })).toBe('Northwind northwind.test');
      expect(buildSocialObservationQuery({ companyName: null, websiteDomain: 'northwind.test' })).toBe('northwind.test');
      expect(buildSocialObservationQuery({ companyName: null, websiteDomain: null })).toBeNull();
    });

    it('reports unreachable rather than declared when no query can be formed', async () => {
      const fetchSpy = jest.fn(async (_keyword: string, _geography: string | null) => serpOk([]));
      const entries = await observeSocialPresence({ candidateUrls: [LINKEDIN], fetchSerp: fetchSpy as never });
      expect(entries[0].status).toBe('unreachable');
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  // -- 10. Canonical field ------------------------------------------------------
  describe('10. the evidence reaches the canonical contract shape', () => {
    it('produces entries assignable to CanonicalDeclaredEvidence.social_presence', async () => {
      const { run } = observe([LINKEDIN], serpOk([{ url: LINKEDIN, title: 'Northwind' }]));
      const social_presence = await run();
      const declared = {
        same_as: { count: 0, domains: [], destination_types: {}, source: 'schema_org' as const },
        declared_certifications: { count: 0, items: [], source: 'schema_org' as const },
        legal_transparency: { items: [], present_count: 0, source: 'crawler' as const },
        social_presence,
      };
      expect(declared.social_presence[0]).toMatchObject({ platform: 'linkedin', status: 'observed', source: 'serp' });
    });
  });

  // -- 11. Renderer -------------------------------------------------------------
  describe('11. the renderer exposes the evidence', () => {
    const declaredEvidence = (social_presence: unknown) => ({
      same_as: { count: 0, domains: [], destination_types: {}, source: 'schema_org' },
      declared_certifications: { count: 0, items: [], source: 'schema_org' },
      legal_transparency: { items: [], present_count: 0, source: 'crawler' },
      social_presence,
    });

    it('renders observed, declared and unreachable distinctly', async () => {
      const { run } = observe(
        [LINKEDIN, INSTAGRAM],
        serpOk([{ url: LINKEDIN, title: 'Northwind' }]),
      );
      const social = await run();
      const html = renderDeclaredEvidence({ declared_evidence: declaredEvidence(social) } as never);
      expect(html).toContain('Social identity');
      expect(html).toContain('Publicly observed');
      expect(html).toContain('Northwind');
      expect(html).toContain('Declared but not found in public search');
      expect(html).toContain('instagram');
      // The claim is scoped honestly — indexed, not active.
      expect(html).toContain('not a measure of activity or audience');
    });

    it('renders the unreachable state rather than implying absence', async () => {
      const { run } = observe([LINKEDIN], serpDown('unavailable'));
      const html = renderDeclaredEvidence({ declared_evidence: declaredEvidence(await run()) } as never);
      expect(html).toContain('Not checked (observation unavailable)');
    });

    it('renders nothing new when there is no social evidence', () => {
      const html = renderDeclaredEvidence({ declared_evidence: declaredEvidence(undefined) } as never);
      expect(html).not.toContain('Social identity');
    });

    it('preserves the existing same_as row unchanged', () => {
      const html = renderDeclaredEvidence({
        declared_evidence: {
          same_as: { count: 2, domains: ['linkedin.com'], destination_types: { social: 2 }, source: 'schema_org' },
          declared_certifications: { count: 0, items: [], source: 'schema_org' },
          legal_transparency: { items: [], present_count: 0, source: 'crawler' },
        },
      } as never);
      expect(html).toContain('Declared identity links');
      expect(html).toContain('2 sameAs links');
    });
  });

  // -- 12-13. Scope guards ------------------------------------------------------
  describe('12-13. scope: no post acquisition, no direct platform fetch', () => {
    it('calls only the injected SERP fetcher — no other network seam', async () => {
      const { fetchSpy, run } = observe([LINKEDIN, INSTAGRAM, X_URL], serpOk([{ url: LINKEDIN }]));
      await run();
      // One provider call, and it is the SERP keyword fetch: no per-platform requests, no post feed.
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(fetchSpy.mock.calls[0][0]).toBe('Northwind northwind.test');
    });

    it('returns profile-level fields only — no posts, counts or engagement', async () => {
      const { run } = observe([LINKEDIN], serpOk([{ url: LINKEDIN, title: 'Northwind', snippet: 'Ops.' }]));
      const [entry] = await run();
      expect(Object.keys(entry).sort()).toEqual(
        ['description', 'name', 'observed_at', 'platform', 'source', 'status', 'url'],
      );
    });
  });
});
