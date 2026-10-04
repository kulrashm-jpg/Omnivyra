/**
 * WP-11 (Track J) — REGRESSION TRIPWIRE: Report 1 generation must not mutate the Company Profile.
 *
 * THE DEFECT THIS LOCKS OUT
 * Every Report 1 entry point — `pages/api/reports/generate.ts` (snapshot branch),
 * `reportCardServiceAssembly.ts` and the `reportAutomationService` cron — calls
 * `persistSnapshotReportInputs`. That used to delegate to `persistResolvedReportInputs`, which
 * wrote the report's resolved inputs onto the profile row via `saveProfile(..., { source: 'user' })`:
 *
 *   • `name` / `website_url` / `category` / `geography` / `geography_list` /
 *     `competitors` / `competitors_list` / `social_profiles` / `other_social_links` overwritten;
 *   • `saveProfile`'s `shouldRefreshClassification` branch fires whenever `category` is supplied —
 *     which this path always did — re-running `classifyCompanyBusiness` and REPLACING `industry`,
 *     `industry_list`, `category` and `category_list`. `industry_list` is the field the ICP
 *     generator reads (d99cf962), so a report run could silently change an ICP input;
 *   • `getFinalCompetitors({ useNetwork: true })` re-ran competitor discovery as a report side effect;
 *   • `{ source: 'user' }` let a report run add `competitors` to `user_locked_fields` and stamp
 *     `last_edited_by = 'user'`, making the write indistinguishable from a human edit.
 *
 * WHY THIS IS A TRIPWIRE AND NOT AN ASSERTION ABOUT TODAY
 * The central case asserts the EXACT key set of the payload sent to `company_profiles`. Re-adding
 * ANY durable column to the Report 1 write — by merge, refactor or revert — fails this test, even a
 * column that does not exist yet. The same allowlist is enforced at runtime by
 * `assertReportObservationPayload`, so the guarantee does not depend on this suite being run.
 *
 * Scope: Report 1 (snapshot) only. The analytics categories still use the legacy mutating write,
 * and case F pins that so this change is provably scoped.
 */
jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }));

const saveProfileMock = jest.fn(async () => undefined);
const upsertMock = jest.fn(async () => ({ data: null, error: null, omittedSchemaFields: [] }));
jest.mock('../../services/companyProfileService', () => ({
  __esModule: true,
  saveProfile: (...args: unknown[]) => saveProfileMock(...(args as [])),
  upsertCompanyProfilePayload: (...args: unknown[]) => upsertMock(...(args as [])),
}));

// The resolver pulls the analytics/AI surface in at import time; only the persistence write is
// under test here, so the heavy collaborators are stubbed (same pattern as g8SocialOwnershipProvenance).
jest.mock('../../db/supabaseClient', () => ({ __esModule: true, supabase: { from: () => ({}) } }));
jest.mock('../../services/googleProviderReadinessService', () => ({
  __esModule: true,
  getGoogleSearchConsoleReadiness: async () => null,
}));
jest.mock('@/backend/services/context/canonicalProfileAdapter', () => ({
  __esModule: true,
  getCanonicalProfile: async () => null,
}));

import { persistSnapshotReportInputs } from '../../services/snapshotInputResolver';
import { persistResolvedReportInputs } from '../../services/reportInputResolver';
import {
  REPORT_OBSERVATION_WRITABLE_COLUMNS,
  assertReportObservationPayload,
  buildReportInputObservation,
} from '../../services/companyProfile/reportObservation';

/**
 * The durable Company Profile surface a report run must never write. `industry_list` heads the
 * list because it is the ICP generator's input.
 */
const DURABLE_PROFILE_FIELDS = [
  'industry_list', 'industry', 'category', 'category_list', 'business_classification',
  'name', 'website_url', 'geography', 'geography_list',
  'competitors', 'competitors_list', 'social_profiles', 'other_social_links',
  'products_services', 'products_services_list', 'target_audience', 'target_audience_list',
  'goals', 'goals_list', 'brand_voice', 'brand_voice_list', 'content_themes', 'content_themes_list',
  'user_locked_fields', 'last_edited_by', 'last_refined_at', 'confidence_score', 'overall_confidence',
  'source', 'updated_at',
];

/** The durable profile as the ICP generator would read it. */
const EXISTING_PROFILE = () => ({
  company_id: 'company-1',
  name: 'Northwind Traders',
  website_url: 'northwind.example',
  industry: 'Industrial Automation',
  industry_list: ['Industrial Automation', 'Process Control'],
  category: 'Manufacturing',
  category_list: ['Manufacturing'],
  geography: 'Germany',
  geography_list: ['Germany'],
  competitors: 'Acme',
  competitors_list: ['Acme'],
  social_profiles: [{ platform: 'linkedin', url: 'https://www.linkedin.com/company/northwind', source: 'website', confidence: 'High' }],
  user_locked_fields: [],
  report_settings: {
    market_pulse: { business_model: 'B2B' },
    industry_review: { conflict: false, user_industry: 'Industrial Automation' },
    default_inputs: { company_name: 'Northwind Traders' },
  },
});

/** A ResolvedReportInput whose resolved values DISAGREE with the durable profile on every field. */
const snapshotInput = (overrides?: Record<string, unknown>): never =>
  ({
    companyId: 'company-1',
    reportCategory: 'snapshot',
    profile: EXISTING_PROFILE(),
    integrations: { google_analytics: { connected: true }, website_crawl: { connected: false } },
    resolved: {
      companyName: 'Northwind GmbH',
      websiteDomain: 'northwind-gmbh.example',
      businessType: 'SaaS',
      geography: 'France',
      socialLinks: ['https://www.linkedin.com/company/northwind-gmbh'],
      competitors: ['Globex', 'Initech'],
      source: 'manual',
      uploadedFileName: null,
    },
    ...(overrides ?? {}),
  }) as never;

const writtenPayload = (): Record<string, unknown> =>
  (upsertMock.mock.calls[0] as unknown as Record<string, unknown>[])[0];

beforeEach(() => jest.clearAllMocks());

describe('WP-11 — Report 1 generation performs no Company Profile mutation', () => {
  // -- A. the mutating writer is not reached at all ----------------------------
  describe('A. the mutating writer is unreachable from Report 1', () => {
    it('never calls saveProfile', async () => {
      await persistSnapshotReportInputs(snapshotInput());
      expect(saveProfileMock).not.toHaveBeenCalled();
    });

    it('writes the profile row exactly once', async () => {
      await persistSnapshotReportInputs(snapshotInput());
      expect(upsertMock).toHaveBeenCalledTimes(1);
    });
  });

  // -- B. THE TRIPWIRE: the written column set is pinned -----------------------
  describe('B. the written column set is pinned (tripwire)', () => {
    it('writes ONLY company_id and report_settings — any durable column re-added fails here', async () => {
      await persistSnapshotReportInputs(snapshotInput());
      expect(Object.keys(writtenPayload()).sort()).toEqual([...REPORT_OBSERVATION_WRITABLE_COLUMNS].sort());
    });

    it.each(DURABLE_PROFILE_FIELDS)('does not write the durable field %s', async (field) => {
      await persistSnapshotReportInputs(snapshotInput());
      expect(Object.prototype.hasOwnProperty.call(writtenPayload(), field)).toBe(false);
    });

    // Repository convention: a guard must not be able to pass vacuously. This pins the guard's own
    // inputs by CONTENT, so an empty allowlist, an empty forbidden-field list or an empty payload
    // — each of which would make every case above trivially green — fails here instead.
    it('cannot pass vacuously — the guard inputs are non-empty and pinned by content', async () => {
      expect([...REPORT_OBSERVATION_WRITABLE_COLUMNS].sort()).toEqual(['company_id', 'report_settings']);
      expect(DURABLE_PROFILE_FIELDS.length).toBeGreaterThanOrEqual(30);
      expect(DURABLE_PROFILE_FIELDS).toContain('industry_list');
      await persistSnapshotReportInputs(snapshotInput());
      expect(Object.keys(writtenPayload())).toHaveLength(2);
      expect(Object.keys(writtenPayload().report_settings as Record<string, unknown>).length).toBeGreaterThan(0);
    });

    it('rejects a payload carrying a durable column, at runtime and not only in tests', () => {
      expect(() => assertReportObservationPayload({ company_id: 'c', industry_list: ['X'] }))
        .toThrow(/industry_list/);
      expect(() => assertReportObservationPayload({ company_id: 'c', report_settings: {} })).not.toThrow();
    });
  });

  // -- C. ICP generation sees an unchanged durable profile ---------------------
  describe('C. ICP generation sees an unchanged durable profile', () => {
    it('never sends industry_list — the field the ICP generator reads', async () => {
      await persistSnapshotReportInputs(snapshotInput());
      const serialized = JSON.stringify(writtenPayload());
      expect(writtenPayload()).not.toHaveProperty('industry_list');
      // Not smuggled in under another key either.
      expect(serialized).not.toContain('Process Control');
    });

    it('supplies no field that would re-trigger saveProfile classification', async () => {
      // saveProfile re-runs classifyCompanyBusiness — replacing industry/industry_list/category/
      // category_list — when ANY of these is present in its input.
      const classificationTriggers = [
        'industry', 'industry_list', 'category', 'category_list',
        'products_services', 'products_services_list', 'target_audience', 'target_audience_list',
        'goals', 'goals_list', 'unique_value', 'content_themes', 'content_themes_list',
      ];
      await persistSnapshotReportInputs(snapshotInput());
      const payload = writtenPayload();
      expect(classificationTriggers.filter((k) => Object.prototype.hasOwnProperty.call(payload, k))).toEqual([]);
    });
  });

  // -- D. report bookkeeping and sibling settings survive ----------------------
  describe('D. report continuity is preserved', () => {
    it('still records default_inputs, integrations and the run source', async () => {
      await persistSnapshotReportInputs(snapshotInput());
      const settings = writtenPayload().report_settings as Record<string, any>;
      expect(settings.default_inputs.company_name).toBe('Northwind GmbH');
      expect(settings.default_inputs.competitors).toEqual(['Globex', 'Initech']);
      expect(settings.integrations).toEqual({ google_analytics: true, website_crawl: false });
      expect(settings.last_report_source).toBe('manual');
    });

    it('preserves every unrelated report_settings key verbatim', async () => {
      await persistSnapshotReportInputs(snapshotInput());
      const settings = writtenPayload().report_settings as Record<string, any>;
      expect(settings.market_pulse).toEqual({ business_model: 'B2B' });
      expect(settings.industry_review).toEqual({ conflict: false, user_industry: 'Industrial Automation' });
    });

    it('creates no profile row when the company has none', async () => {
      await persistSnapshotReportInputs(snapshotInput({ profile: null }));
      expect(upsertMock).not.toHaveBeenCalled();
      expect(saveProfileMock).not.toHaveBeenCalled();
    });
  });

  // -- E. what the report observed is proposed, not applied --------------------
  describe('E. divergence is proposed, never applied', () => {
    it('records each differing field as a recommendation-only observation', async () => {
      await persistSnapshotReportInputs(snapshotInput());
      const observation = (writtenPayload().report_settings as Record<string, any>).report_input_observation;
      expect(observation.source).toBe('report_input_resolution');
      expect(observation.conflict).toBe(true);
      expect(observation.fields.name).toEqual({
        profile_value: 'Northwind Traders',
        observed_value: 'Northwind GmbH',
        conflict: true,
      });
      expect(observation.fields.category.observed_value).toBe('SaaS');
      expect(observation.fields.geography.observed_value).toBe('France');
    });

    it('proposes nothing when the report agrees with the profile', () => {
      const observation = buildReportInputObservation({
        profile: EXISTING_PROFILE() as never,
        reportCategory: 'snapshot',
        resolved: {
          companyName: 'Northwind Traders',
          websiteDomain: 'northwind.example',
          geography: 'Germany',
          competitors: ['Acme'],
          socialLinks: ['https://www.linkedin.com/company/northwind'],
        },
      });
      expect(observation).toBeNull();
    });

    it('marks a field the profile has never held as a gap, not a conflict', () => {
      const observation = buildReportInputObservation({
        profile: { company_id: 'c', name: null } as never,
        reportCategory: 'snapshot',
        resolved: { companyName: 'Northwind GmbH' },
      });
      expect(observation?.fields.name.conflict).toBe(false);
      expect(observation?.conflict).toBe(false);
    });
  });

  // -- F. the change is scoped to Report 1 ------------------------------------
  describe('F. scope', () => {
    it('leaves the analytics (performance/growth) persist on the legacy mutating writer', async () => {
      await persistResolvedReportInputs(snapshotInput({ reportCategory: 'performance' }));
      expect(saveProfileMock).toHaveBeenCalledTimes(1);
      expect(upsertMock).not.toHaveBeenCalled();
    });
  });

  // -- G. NEGATIVE CONTROL: the pre-fix implementation fails this guard --------
  /**
   * Proof that the cases above are a TRIPWIRE and not a restatement of today's behaviour.
   *
   * `persistResolvedReportInputs` IS the pre-fix Report 1 write — reverting `snapshotInputResolver`
   * to call it is exactly how the defect returns, and it is still in the tree for the analytics
   * categories, so it can be exercised here without weakening any source file. Every assertion the
   * guard makes is replayed against it and shown to FAIL, by content. If a future change made the
   * guard vacuous, these cases would stop failing-as-expected and this block would break.
   */
  describe('G. negative control — the pre-fix write violates every guard above', () => {
    const legacyPayload = async (): Promise<Record<string, unknown>> => {
      await persistResolvedReportInputs(snapshotInput());
      expect(saveProfileMock).toHaveBeenCalledTimes(1); // A would fail: saveProfile IS reached
      return (saveProfileMock.mock.calls[0] as unknown as Record<string, unknown>[])[0];
    };

    it('writes durable identity columns the guard forbids', async () => {
      const payload = await legacyPayload();
      // B would fail: the key set is not the allowlist.
      expect(Object.keys(payload).sort()).not.toEqual([...REPORT_OBSERVATION_WRITABLE_COLUMNS].sort());
      // Non-vacuous: name the durable columns actually present.
      const leaked = DURABLE_PROFILE_FIELDS.filter((f) => Object.prototype.hasOwnProperty.call(payload, f));
      expect(leaked.length).toBeGreaterThan(0);
      expect(leaked).toEqual(expect.arrayContaining([
        'name', 'website_url', 'category', 'geography', 'geography_list',
        'competitors', 'competitors_list', 'social_profiles', 'other_social_links',
      ]));
    });

    it('supplies category, which is what makes saveProfile replace industry_list', async () => {
      const payload = await legacyPayload();
      // saveProfile.shouldRefreshClassification fires on `category`, re-running
      // classifyCompanyBusiness, which overwrites industry / industry_list / category / category_list.
      expect(payload.category).toBe('SaaS');
      expect(payload.category).not.toBe(EXISTING_PROFILE().category);
    });

    it('is rejected by the runtime allowlist the fixed path enforces', async () => {
      const payload = await legacyPayload();
      expect(() => assertReportObservationPayload(payload)).toThrow(/may not write durable/);
    });
  });
});
