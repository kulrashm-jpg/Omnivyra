/**
 * G-8 — a declared social link must not be stored as a public observation.
 *
 * THE DEFECT
 * `persistResolvedReportInputs` stamped every resolved social URL with
 * `source: 'report_input', confidence: 'high'`. Two failures in one write:
 *
 *   1. `resolved.socialLinks` is a BLEND. `buildDefaults` flattens the crawl-populated typed
 *      fields (`profile.linkedin_url`, ...) together with stored report defaults and
 *      `other_social_links`; `resolveSocialLinks` then merges in whatever the customer typed into
 *      the report form. After that flattening a single URL's origin is unrecoverable — so calling
 *      the whole set high-confidence asserted ownership evidence that does not exist for the typed
 *      ones.
 *   2. The write REPLACED `profile.social_profiles`, discarding the per-entry `source` /
 *      `confidence` that `buildSocialProfileList` already carried through from extraction
 *      ('website' | 'social' | 'inferred' | 'user'). Real provenance was overwritten by a constant.
 *
 * WHAT IS UNDER TEST
 *   - a company-declared URL is recorded as declared, never as publicly observed;
 *   - a genuinely website-observed entry keeps its observed provenance;
 *   - a URL whose shape does not establish ownership is not promoted to high confidence merely
 *     because its hostname contains a platform name;
 *   - normalization / platform bucketing and the resolved-link SET are unchanged, so the legacy
 *     social-link count signal is untouched.
 *
 * Scope is G-8 only: no scoring, no acquisition, no canonical Report 1 social section.
 */
jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }));

const saveProfileMock = jest.fn(async () => undefined);
jest.mock('../../services/companyProfileService', () => ({
  __esModule: true,
  saveProfile: (...args: unknown[]) => saveProfileMock(...(args as [])),
}));

// The resolver pulls the analytics/AI surface in at import time; only the persistence write is
// under test here, so the heavy collaborators are stubbed.
jest.mock('../../db/supabaseClient', () => ({ __esModule: true, supabase: { from: () => ({}) } }));
jest.mock('../../services/googleProviderReadinessService', () => ({
  __esModule: true,
  getGoogleSearchConsoleReadiness: async () => null,
}));
jest.mock('@/backend/services/context/canonicalProfileAdapter', () => ({
  __esModule: true,
  getCanonicalProfile: async () => null,
}));

import { persistResolvedReportInputs } from '../../services/reportInputResolver';
import { provenanceForSocialProfileSource } from '../../services/evidenceProvenance';

type PersistedEntry = { platform: string; url: string; source: string; confidence: string };

/** A minimal ResolvedReportInput carrying only what the persistence write reads. */
const inputWith = (
  socialLinks: string[],
  existingProfiles?: Array<{ platform?: string; url: string; source?: string; confidence?: string }>,
): never =>
  ({
    companyId: 'company-1',
    profile: existingProfiles ? { social_profiles: existingProfiles } : null,
    integrations: {},
    resolved: {
      companyName: 'Northwind',
      websiteDomain: 'northwind.test',
      businessType: null,
      geography: null,
      socialLinks,
      competitors: [],
      source: 'form',
      uploadedFileName: null,
    },
  }) as never;

const persistedProfiles = (): PersistedEntry[] => {
  const payload = saveProfileMock.mock.calls[0] as unknown as Array<{ social_profiles?: PersistedEntry[] }>;
  return payload[0].social_profiles ?? [];
};

beforeEach(() => jest.clearAllMocks());

describe('G-8 — social ownership provenance', () => {
  // -- A. A declared URL is not a public observation ---------------------------
  describe('A. company-declared links', () => {
    it('records a form-supplied link as declared, not as observed', async () => {
      await persistResolvedReportInputs(inputWith(['https://www.linkedin.com/company/northwind']));
      const [entry] = persistedProfiles();
      expect(entry.source).toBe('user');
      expect(entry.source).not.toBe('website');
      expect(provenanceForSocialProfileSource(entry.source)).toBe('COMPANY_CONFIRMED');
      expect(provenanceForSocialProfileSource(entry.source)).not.toBe('PUBLIC_OBSERVED');
    });

    it('no longer stamps the fabricated report_input/high constant on every entry', async () => {
      await persistResolvedReportInputs(inputWith([
        'https://www.linkedin.com/company/northwind',
        'https://twitter.com/search?q=northwind',
      ]));
      const entries = persistedProfiles();
      expect(entries.every((e) => e.source === 'report_input')).toBe(false);
      expect(entries.every((e) => e.confidence === 'high')).toBe(false);
    });
  });

  // -- B. A genuinely observed entry keeps its observation --------------------
  describe('B. publicly observed links', () => {
    it('preserves an existing website-sourced entry rather than overwriting it', async () => {
      await persistResolvedReportInputs(inputWith(
        ['https://www.linkedin.com/company/northwind'],
        [{ platform: 'linkedin', url: 'https://www.linkedin.com/company/northwind', source: 'website', confidence: 'High' }],
      ));
      const [entry] = persistedProfiles();
      expect(entry.source).toBe('website');
      expect(entry.confidence).toBe('High');
      expect(provenanceForSocialProfileSource(entry.source)).toBe('PUBLIC_OBSERVED');
    });

    it('does not downgrade an observation to a declaration', async () => {
      await persistResolvedReportInputs(inputWith(
        ['https://instagram.com/northwind'],
        [{ platform: 'instagram', url: 'https://instagram.com/northwind', source: 'social', confidence: 'Medium' }],
      ));
      const [entry] = persistedProfiles();
      expect(provenanceForSocialProfileSource(entry.source)).toBe('PUBLIC_OBSERVED');
      expect(entry.confidence).toBe('Medium');
    });
  });

  // -- C. Weak / unverified ownership -----------------------------------------
  describe('C. links that do not establish ownership', () => {
    it('does not promote a platform hostname to high confidence', async () => {
      // A LinkedIn URL that is not a /company/ page: the hostname says linkedin, the shape does
      // not establish that this company owns it.
      await persistResolvedReportInputs(inputWith(['https://www.linkedin.com/feed/']));
      const [entry] = persistedProfiles();
      expect(entry.platform).toBe('linkedin');
      expect(entry.confidence).toBe('Low');
      expect(entry.confidence).not.toBe('High');
    });

    it('accepts a well-formed owned profile shape as high confidence', async () => {
      await persistResolvedReportInputs(inputWith(['https://x.com/northwind']));
      const [entry] = persistedProfiles();
      expect(entry.platform).toBe('x');
      expect(entry.confidence).toBe('High');
    });

    it('treats an unknown source as unavailable rather than observed', () => {
      expect(provenanceForSocialProfileSource(undefined)).toBe('UNAVAILABLE');
      expect(provenanceForSocialProfileSource('missing')).toBe('UNAVAILABLE');
      expect(provenanceForSocialProfileSource('something-new')).toBe('UNAVAILABLE');
      expect(provenanceForSocialProfileSource('inferred')).toBe('INFERRED');
    });
  });

  // -- D. Existing behaviour is unchanged --------------------------------------
  describe('D. normalization and bucketing are unchanged', () => {
    it('keeps the same platform buckets for the same URLs', async () => {
      await persistResolvedReportInputs(inputWith([
        'https://www.linkedin.com/company/northwind',
        'https://instagram.com/northwind',
        'https://facebook.com/northwind',
        'https://youtube.com/@northwind',
        'https://tiktok.com/@northwind',
        'https://reddit.com/r/northwind',
        'https://x.com/northwind',
        'https://example.test/blog',
      ]));
      expect(persistedProfiles().map((e) => e.platform)).toEqual([
        'linkedin', 'instagram', 'facebook', 'youtube', 'tiktok', 'reddit', 'x', 'other',
      ]);
    });

    it('stores the URL exactly as resolved', async () => {
      const url = 'https://www.linkedin.com/company/northwind';
      await persistResolvedReportInputs(inputWith([url]));
      expect(persistedProfiles()[0].url).toBe(url);
    });
  });

  // -- E. No scoring regression -----------------------------------------------
  describe('E. the legacy social-link count signal is untouched', () => {
    it('persists the same set, order and 20-entry cap', async () => {
      const links = Array.from({ length: 25 }, (_, i) => `https://x.com/handle${i}`);
      await persistResolvedReportInputs(inputWith(links));
      const entries = persistedProfiles();
      expect(entries).toHaveLength(20);
      expect(entries.map((e) => e.url)).toEqual(links.slice(0, 20));
    });

    it('writes default_inputs.social_links unchanged — the count signal reads this', async () => {
      const links = ['https://www.linkedin.com/company/northwind', 'https://x.com/northwind'];
      await persistResolvedReportInputs(inputWith(links));
      const payload = saveProfileMock.mock.calls[0] as unknown as Array<{
        report_settings?: { default_inputs?: { social_links?: string[] } };
      }>;
      expect(payload[0].report_settings?.default_inputs?.social_links).toEqual(links);
    });
  });
});
