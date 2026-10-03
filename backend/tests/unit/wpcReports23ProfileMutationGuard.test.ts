/**
 * WP-C (pre-T3) — REGRESSION TRIPWIRE: Reports 2 and 3 must not mutate the Company Profile either.
 *
 * WHAT WP-11 LEFT OPEN
 * WP-11 proved and closed the mutation for Report 1 (snapshot) and deliberately scoped itself
 * there, deferring the analytics categories because "Report 2's `getProfile(autoRefine)` chain
 * genuinely does refine the profile by design". That is true — and it is a DIFFERENT chain:
 *
 *   composePerformanceIntelligenceReport → getAnalyticsEnterpriseSnapshot
 *     → discoverAndPersistCompetitorDomains / bootstrapCompetitorDataset
 *       → getProfile(companyId)                      (no options ⇒ autoRefine defaults ON)
 *         → refineProfileWithAI → runProfileRefinement
 *           → upsert with `source: 'ai_refined'`, honouring `user_locked_fields`
 *
 * documented verbatim in `backend/services/intelligence/reportDeadlineContext.ts`. That refinement
 * is intentional, is attributed to the machine, and is NOT touched by this guard.
 *
 * THE DEFECT THIS LOCKS OUT is the other one: `persistAnalyticsReportInputs` →
 * `persistResolvedReportInputs` → `saveProfile(..., { source: 'user' })`. It performed no
 * inference whatsoever — it echoed the report form straight back onto the durable profile as
 * though a human had typed it there, carrying the identical five mutations WP-11 removed from
 * Report 1, because `resolveAnalyticsReportInput` resolves through the very same
 * `resolveReportInput` the snapshot resolver uses.
 *
 * WHY THIS IS A TRIPWIRE AND NOT AN ASSERTION ABOUT TODAY
 * Case B pins the EXACT key set written to `company_profiles` against the shared runtime
 * allowlist, so re-adding ANY durable column fails here. Case G replays every assertion against
 * the pre-fix writer and proves it FAILS them. Case H scans the resolver sources this workstream
 * owns and fails if the mutating writer is wired back into any report path. Every guard input is
 * additionally pinned by content and asserted non-empty, so no case can pass vacuously.
 */
jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }));

const saveProfileMock = jest.fn(async () => undefined);
const upsertMock = jest.fn(async () => ({ data: null, error: null, omittedSchemaFields: [] }));
jest.mock('../../services/companyProfileService', () => ({
  __esModule: true,
  saveProfile: (...args: unknown[]) => saveProfileMock(...(args as [])),
  upsertCompanyProfilePayload: (...args: unknown[]) => upsertMock(...(args as [])),
}));

// Only the persistence write is under test; the analytics/AI surface the resolver pulls in at
// import time is stubbed (same pattern as wp11ReportProfileMutationGuard / g8SocialOwnershipProvenance).
jest.mock('../../db/supabaseClient', () => ({ __esModule: true, supabase: { from: () => ({}) } }));
jest.mock('../../services/googleProviderReadinessService', () => ({
  __esModule: true,
  getGoogleSearchConsoleReadiness: async () => null,
  getGoogleAnalyticsCapabilityReadiness: async () => null,
}));
jest.mock('@/backend/services/context/canonicalProfileAdapter', () => ({
  __esModule: true,
  getCanonicalProfile: async () => null,
}));

import { readFileSync } from 'fs';
import { join } from 'path';

import { persistAnalyticsReportInputs } from '../../services/analyticsInputResolver';
import { persistResolvedReportInputs } from '../../services/reportInputResolver';
import {
  REPORT_OBSERVATION_WRITABLE_COLUMNS,
  assertReportObservationPayload,
} from '../../services/companyProfile/reportObservation';

/** The two analytics report categories this workstream owns. */
const ANALYTICS_CATEGORIES = ['performance', 'growth'] as const;

/**
 * The durable Company Profile surface a report run must never write. `industry_list` heads the
 * list because it is the ICP generator's input (d99cf962).
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

/** Input keys that make `saveProfile.shouldRefreshClassification` re-run `classifyCompanyBusiness`. */
const CLASSIFICATION_TRIGGERS = [
  'industry', 'industry_list', 'category', 'category_list',
  'products_services', 'products_services_list', 'target_audience', 'target_audience_list',
  'goals', 'goals_list', 'unique_value', 'content_themes', 'content_themes_list',
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
const analyticsInput = (overrides?: Record<string, unknown>): never =>
  ({
    companyId: 'company-1',
    reportCategory: 'performance',
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

describe('WP-C — Reports 2/3 generation performs no Company Profile mutation', () => {
  // -- A. the mutating writer is not reached at all ----------------------------
  describe('A. the mutating writer is unreachable from Reports 2/3', () => {
    it.each(ANALYTICS_CATEGORIES)('never calls saveProfile for the %s report', async (reportCategory) => {
      await persistAnalyticsReportInputs(analyticsInput({ reportCategory }));
      expect(saveProfileMock).not.toHaveBeenCalled();
    });

    it.each(ANALYTICS_CATEGORIES)('writes the profile row exactly once for the %s report', async (reportCategory) => {
      await persistAnalyticsReportInputs(analyticsInput({ reportCategory }));
      expect(upsertMock).toHaveBeenCalledTimes(1);
    });
  });

  // -- B. THE TRIPWIRE: the written column set is pinned -----------------------
  describe('B. the written column set is pinned (tripwire)', () => {
    it.each(ANALYTICS_CATEGORIES)(
      '%s writes ONLY company_id and report_settings — any durable column re-added fails here',
      async (reportCategory) => {
        await persistAnalyticsReportInputs(analyticsInput({ reportCategory }));
        expect(Object.keys(writtenPayload()).sort()).toEqual([...REPORT_OBSERVATION_WRITABLE_COLUMNS].sort());
      },
    );

    it.each(DURABLE_PROFILE_FIELDS)('does not write the durable field %s', async (field) => {
      await persistAnalyticsReportInputs(analyticsInput());
      expect(Object.prototype.hasOwnProperty.call(writtenPayload(), field)).toBe(false);
    });

    // Repository convention: a guard must not be able to pass vacuously. This pins the guard's own
    // inputs BY CONTENT, so an empty allowlist, an empty forbidden-field list, an empty category
    // list or an empty payload — each of which would make every case above trivially green —
    // fails here instead.
    it('cannot pass vacuously — the guard inputs are non-empty and pinned by content', async () => {
      expect([...REPORT_OBSERVATION_WRITABLE_COLUMNS].sort()).toEqual(['company_id', 'report_settings']);
      expect([...ANALYTICS_CATEGORIES]).toEqual(['performance', 'growth']);
      expect(DURABLE_PROFILE_FIELDS.length).toBeGreaterThanOrEqual(30);
      expect(DURABLE_PROFILE_FIELDS).toContain('industry_list');
      expect(CLASSIFICATION_TRIGGERS).toContain('category');
      await persistAnalyticsReportInputs(analyticsInput());
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
    it.each(ANALYTICS_CATEGORIES)('%s never sends industry_list — the field the ICP generator reads', async (reportCategory) => {
      await persistAnalyticsReportInputs(analyticsInput({ reportCategory }));
      expect(writtenPayload()).not.toHaveProperty('industry_list');
      // Not smuggled in under another key either.
      expect(JSON.stringify(writtenPayload())).not.toContain('Process Control');
    });

    it.each(ANALYTICS_CATEGORIES)('%s supplies no field that would re-trigger saveProfile classification', async (reportCategory) => {
      await persistAnalyticsReportInputs(analyticsInput({ reportCategory }));
      const payload = writtenPayload();
      expect(CLASSIFICATION_TRIGGERS.filter((k) => Object.prototype.hasOwnProperty.call(payload, k))).toEqual([]);
    });
  });

  // -- D. attribution: no machine may write as the user ------------------------
  /**
   * A machine writing as the user is a distinct harm from the write itself: `{ source: 'user' }`
   * is what let a report run add `competitors` to `user_locked_fields` and stamp
   * `last_edited_by = 'user'`. The legitimate Report 2 refinement writes `source: 'ai_refined'`
   * and is unaffected; what must never recur is a report claiming human authorship.
   */
  describe('D. no report write claims human authorship', () => {
    it.each(ANALYTICS_CATEGORIES)('%s never reaches the user-attributed write seam at all', async (reportCategory) => {
      await persistAnalyticsReportInputs(analyticsInput({ reportCategory }));
      expect(saveProfileMock).not.toHaveBeenCalled();
      const serialized = JSON.stringify(writtenPayload());
      expect(serialized).not.toContain('"last_edited_by"');
      expect(serialized).not.toContain('"user_locked_fields"');
      expect(writtenPayload()).not.toHaveProperty('source');
    });
  });

  // -- E. report bookkeeping and sibling settings survive ----------------------
  describe('E. report continuity is preserved', () => {
    it.each(ANALYTICS_CATEGORIES)('%s still records default_inputs, integrations and the run source', async (reportCategory) => {
      await persistAnalyticsReportInputs(analyticsInput({ reportCategory }));
      const settings = writtenPayload().report_settings as Record<string, any>;
      expect(settings.default_inputs.company_name).toBe('Northwind GmbH');
      expect(settings.default_inputs.business_type).toBe('SaaS');
      expect(settings.default_inputs.geography).toBe('France');
      expect(settings.default_inputs.competitors).toEqual(['Globex', 'Initech']);
      expect(settings.integrations).toEqual({ google_analytics: true, website_crawl: false });
      expect(settings.last_report_source).toBe('manual');
    });

    it('preserves every unrelated report_settings key verbatim', async () => {
      await persistAnalyticsReportInputs(analyticsInput());
      const settings = writtenPayload().report_settings as Record<string, any>;
      expect(settings.market_pulse).toEqual({ business_model: 'B2B' });
      expect(settings.industry_review).toEqual({ conflict: false, user_industry: 'Industrial Automation' });
    });

    it('creates no profile row when the company has none', async () => {
      await persistAnalyticsReportInputs(analyticsInput({ profile: null }));
      expect(upsertMock).not.toHaveBeenCalled();
      expect(saveProfileMock).not.toHaveBeenCalled();
    });
  });

  // -- F. divergence is proposed, never applied --------------------------------
  describe('F. divergence is proposed, never applied', () => {
    it.each(ANALYTICS_CATEGORIES)('%s records each differing field as a recommendation-only observation', async (reportCategory) => {
      await persistAnalyticsReportInputs(analyticsInput({ reportCategory }));
      const observation = (writtenPayload().report_settings as Record<string, any>).report_input_observation;
      expect(observation.source).toBe('report_input_resolution');
      expect(observation.report_category).toBe(reportCategory);
      expect(observation.conflict).toBe(true);
      expect(observation.fields.name).toEqual({
        profile_value: 'Northwind Traders',
        observed_value: 'Northwind GmbH',
        conflict: true,
      });
      expect(observation.fields.category.observed_value).toBe('SaaS');
      expect(observation.fields.geography.observed_value).toBe('France');
    });
  });

  // -- G. NEGATIVE CONTROL: the pre-fix implementation fails this guard --------
  /**
   * Proof that the cases above are a TRIPWIRE and not a restatement of today's behaviour.
   * `persistResolvedReportInputs` IS the pre-fix Reports 2/3 write, still in the tree as the
   * pinned negative control, so it can be exercised here without weakening any source file.
   */
  describe('G. negative control — the pre-fix write violates every guard above', () => {
    const legacyPayload = async (reportCategory: string): Promise<Record<string, unknown>> => {
      await persistResolvedReportInputs(analyticsInput({ reportCategory }));
      expect(saveProfileMock).toHaveBeenCalledTimes(1); // A would fail: saveProfile IS reached
      return (saveProfileMock.mock.calls[0] as unknown as Record<string, unknown>[])[0];
    };

    it.each(ANALYTICS_CATEGORIES)('%s writes durable identity columns the guard forbids', async (reportCategory) => {
      const payload = await legacyPayload(reportCategory);
      expect(Object.keys(payload).sort()).not.toEqual([...REPORT_OBSERVATION_WRITABLE_COLUMNS].sort());
      const leaked = DURABLE_PROFILE_FIELDS.filter((f) => Object.prototype.hasOwnProperty.call(payload, f));
      expect(leaked.length).toBeGreaterThan(0);
      expect(leaked).toEqual(expect.arrayContaining([
        'name', 'website_url', 'category', 'geography', 'geography_list',
        'competitors', 'competitors_list', 'social_profiles', 'other_social_links',
      ]));
    });

    it('supplies category, which is what makes saveProfile replace industry_list', async () => {
      const payload = await legacyPayload('performance');
      expect(payload.category).toBe('SaaS');
      expect(payload.category).not.toBe(EXISTING_PROFILE().category);
    });

    it('writes with source: user — the machine claiming human authorship', async () => {
      await persistResolvedReportInputs(analyticsInput({ reportCategory: 'growth' }));
      expect(saveProfileMock).toHaveBeenCalledTimes(1);
      const options = (saveProfileMock.mock.calls[0] as unknown as unknown[])[1];
      expect(options).toEqual({ source: 'user' });
    });

    it('is rejected by the runtime allowlist the fixed path enforces', async () => {
      const payload = await legacyPayload('performance');
      expect(() => assertReportObservationPayload(payload)).toThrow(/may not write durable/);
    });
  });

  // -- H. the mutating writer stays out of every report path -------------------
  /**
   * Call-site tripwire, scoped to the three resolver files this workstream owns. The runtime
   * allowlist cannot catch a re-wiring to `persistResolvedReportInputs`, because that function
   * writes through `saveProfile` and never reaches `assertReportObservationPayload`. This closes
   * that gap by content: the ONLY permitted occurrences of the symbol in these files are its own
   * `export async function` definition and prose inside comments.
   */
  describe('H. no resolver calls the mutating writer (call-site tripwire)', () => {
    const SERVICES_DIR = join(__dirname, '..', '..', 'services');
    const OWNED_RESOLVERS = [
      'reportInputResolver.ts',
      'analyticsInputResolver.ts',
      'snapshotInputResolver.ts',
    ];

    /** Source lines with `//`-style comment bodies removed, so prose cannot satisfy or trip a check. */
    const codeLines = (file: string): string[] => {
      const raw = readFileSync(join(SERVICES_DIR, file), 'utf8');
      expect(raw.length).toBeGreaterThan(0); // non-vacuous: the file was actually read
      let inBlockComment = false;
      const out: string[] = [];
      for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (inBlockComment) {
          if (trimmed.includes('*/')) inBlockComment = false;
          continue;
        }
        if (trimmed.startsWith('/*')) {
          if (!trimmed.includes('*/')) inBlockComment = true;
          continue;
        }
        if (trimmed.startsWith('*') || trimmed.startsWith('//')) continue;
        out.push(line);
      }
      return out;
    };

    it('reads a non-empty code body from each owned resolver', () => {
      expect(OWNED_RESOLVERS).toHaveLength(3);
      for (const file of OWNED_RESOLVERS) {
        expect(codeLines(file).join('\n').trim().length).toBeGreaterThan(0);
      }
    });

    it('mentions persistResolvedReportInputs in code ONLY as its own definition', () => {
      const occurrences: string[] = [];
      for (const file of OWNED_RESOLVERS) {
        for (const line of codeLines(file)) {
          if (line.includes('persistResolvedReportInputs')) occurrences.push(`${file}: ${line.trim()}`);
        }
      }
      // Non-vacuous: the symbol must still exist, or the negative control has been deleted.
      expect(occurrences.length).toBeGreaterThan(0);
      expect(occurrences).toEqual([
        'reportInputResolver.ts: export async function persistResolvedReportInputs(input: ResolvedReportInput): Promise<void> {',
      ]);
    });

    it('routes both analytics and snapshot persists through the non-mutating writer', () => {
      const analytics = codeLines('analyticsInputResolver.ts').join('\n');
      const snapshot = codeLines('snapshotInputResolver.ts').join('\n');
      expect(analytics).toContain('await persistReportInputsWithoutProfileMutation(input);');
      expect(snapshot).toContain('await persistReportInputsWithoutProfileMutation(input);');
    });

    it('keeps saveProfile out of the non-mutating writer', () => {
      const resolver = codeLines('reportInputResolver.ts');
      const saveProfileLines = resolver.filter((line) => line.includes('saveProfile'));
      // Non-vacuous: the import and the negative control's single call must both still be present.
      expect(saveProfileLines.length).toBe(2);
      expect(saveProfileLines.some((line) => line.trim().startsWith('import {'))).toBe(true);
      expect(saveProfileLines.some((line) => line.trim() === 'await saveProfile(')).toBe(true);
    });
  });
});
