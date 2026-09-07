/**
 * Report 2 — the 45s deadline now cancels the work behind it.
 *
 * THE DEFECT (production capture 3878545e, elapsed 45,010 ms)
 * `runDedupedReport` raced composition against its 45s boundary and REJECTED. It cancelled nothing,
 * so the stage still running — `provider_and_snapshot` — kept executing after the customer's report
 * had already been failed. The statically proven consumer of that budget:
 *
 *   getAnalyticsEnterpriseSnapshot -> computeAnalyticsEnterpriseSnapshot
 *     -> discoverAndPersistCompetitorDomains / bootstrapCompetitorDataset
 *       -> getProfile(companyId)              (no options, so autoRefine defaults ON)
 *         -> refineProfileWithAI -> runProfileRefinement
 *             - cleanEvidenceWithAi            (profileEnrichment, 6,053 ms observed)
 *             - profileExtraction              (7,774 ms observed)
 *             - generateMissingFieldQuestions  (profileEnrichment, 4,550 ms observed)
 *             - discoverRefineCompetitorCandidates -> SERP (429s, one failure AFTER the boundary)
 *
 * THE CONTRACT UNDER TEST
 *   - the SAME 45,000 ms timer that fails the report now also aborts a signal; no second timeout;
 *   - that signal reaches the snapshot computation, and terminates it;
 *   - it reaches the AI gateway calls inside the profile refinement, through the gateway's OWN
 *     existing `signal` seam;
 *   - it reaches the SERP fetch, through axios's OWN existing abort seam;
 *   - a cancelled snapshot cannot remain the authoritative in-flight promise for the next request;
 *   - callers that pass no signal (cron, super-admin, Report 1) are completely unaffected.
 *
 * Nothing here waits 45 real seconds: `timeoutMs` is the injected clock, and every hand-off is a
 * deferred promise resolved by the test. No real AI call and no real SERP call is made.
 */
import fs from 'fs';
import path from 'path';

// The snapshot service transitively imports the competitor engine, which loads `@/config` at
// module scope and validates the full runtime env. Stubbed the same way the rest of the unit
// suite does — this test is about the deadline, not configuration.
jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }));

// -- Collaborators stubbed so the deadline is the only variable ----------------
const mockGateway = jest.fn(async () => ({ output: '{}', metadata: {} }));
jest.mock('../../services/aiGateway', () => ({
  __esModule: true,
  runCompletionWithOperation: (...args: unknown[]) => mockGateway(...(args as [])),
}));

const mockAxiosGet = jest.fn(async () => ({ data: { organic_results: [] } }));
jest.mock('axios', () => ({
  __esModule: true,
  default: { get: (...args: unknown[]) => mockAxiosGet(...(args as [])) },
}));

jest.mock('../../services/providerCredentialResolver', () => ({
  __esModule: true,
  resolveProviderCredential: async () => ({ value: 'test-only-not-a-credential', reason: null }),
}));

/** A PostgREST/supabase-shaped chain that is thenable and always empty. */
const dbStub = (): any => {
  const builder: any = new Proxy({}, {
    get: (_t, prop) => (prop === 'then'
      ? (resolve: (v: unknown) => void) => resolve({ data: null, error: null })
      : () => builder),
  });
  return builder;
};
jest.mock('../../db/writeOwner', () => ({ __esModule: true, ownedDbTable: () => dbStub() }));
jest.mock('../../db/supabaseClient', () => ({ __esModule: true, supabase: { from: () => dbStub() } }));
jest.mock('../../services/analyticsDataReadinessService', () => ({
  __esModule: true,
  getAnalyticsReadiness: async () => null,
}));
jest.mock('../../services/omnivyraGscAnalyticsService', () => ({
  __esModule: true,
  getOmnivyraGscDashboardSummary: async () => null,
}));

const mockCorrelation = jest.fn(async () => ({ provenance: { ga: 'missing', gsc: 'missing' }, insights: [] }));
jest.mock('../../services/analyticsCorrelationService', () => ({
  __esModule: true,
  buildAnalyticsCorrelationContext: () => mockCorrelation(),
}));

const mockGscIntelligence = jest.fn(async () => null);
jest.mock('../../services/gscSeoIntelligenceService', () => ({
  __esModule: true,
  buildGscSeoIntelligence: () => mockGscIntelligence(),
}));

/**
 * The call that reaches getProfile -> autoRefine -> runProfileRefinement. It must never be launched
 * once the deadline has passed: that is the abandoned work being fixed.
 */
const mockDiscoverCompetitors = jest.fn(async () => ({ status: 'unavailable', discovered: [], suppressed: 0 }));
jest.mock('../../services/competitorDiscoveryEngineService', () => ({
  __esModule: true,
  discoverAndPersistCompetitorDomains: (...args: unknown[]) => mockDiscoverCompetitors(...(args as [])),
}));

/** The SECOND getProfile path into the same default-on refinement. Same rule applies. */
const mockBootstrapDataset = jest.fn(async () => ({ status: 'skipped', persisted: [], suppressed: [], errors: [] }));
jest.mock('../../services/competitiveDatasetBootstrapService', () => ({
  __esModule: true,
  bootstrapCompetitorDataset: (...args: unknown[]) => mockBootstrapDataset(...(args as [])),
}));

import { runDedupedReport } from '../../services/reportConcurrencyService';
import {
  runWithReportDeadline,
  getReportDeadlineSignal,
  throwIfReportDeadlineExceeded,
  ReportDeadlineExceededError,
} from '../../services/intelligence/reportDeadlineContext';
import { getAnalyticsEnterpriseSnapshot } from '../../services/analyticsEnterpriseSnapshotService';
import { cleanEvidenceWithAi } from '../../services/companyProfile/refinementPrompts';
import { fetchSerpResultsForKeyword } from '../../services/reportCompetitorIntelligenceServiceHelpers';

const read = (rel: string) => fs.readFileSync(path.join(__dirname, '../../services', rel), 'utf8');
const PERFORMANCE_SOURCE = read('performanceReportService.ts');
const CONCURRENCY_SOURCE = read('reportConcurrencyService.ts');
const REFINEMENT_SOURCE = read('companyProfileServiceRest1Rest2Competitors.ts');
const PROMPTS_SOURCE = read('companyProfile/refinementPrompts.ts');

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
};
const tick = () => new Promise((r) => setImmediate(r));

let companyCounter = 0;
/** A fresh company id per test: the snapshot dedupe map is module-scoped and keyed by company. */
const nextCompany = () => `company-${++companyCounter}`;

beforeEach(() => {
  jest.clearAllMocks();
  mockGateway.mockImplementation(async () => ({ output: '{}', metadata: {} }));
  mockCorrelation.mockImplementation(async () => ({ provenance: { ga: 'missing', gsc: 'missing' }, insights: [] }));
  mockGscIntelligence.mockImplementation(async () => null);
  mockAxiosGet.mockImplementation(async () => ({ data: { organic_results: [] } }));
});

describe('Report 2 — deadline cancellation', () => {
  // -- 1. The existing boundary produces the signal ----------------------------
  describe('1. the 45s boundary is what creates the cancellation', () => {
    it('aborts the signal handed to run when the boundary fires', async () => {
      let observed: AbortSignal | null = null;
      const attempt = runDedupedReport({
        key: 'k1',
        timeoutMs: 20, // the injected clock; production still passes 45_000 (guarded below)
        run: (signal) => { observed = signal; return new Promise<string>(() => {}); },
      });
      await expect(attempt).rejects.toThrow('Report generation exceeded 20ms concurrency boundary');
      expect(observed).not.toBeNull();
      expect((observed as unknown as AbortSignal).aborted).toBe(true);
    });

    it('adds no second timer — one setTimeout still owns the boundary', () => {
      expect((CONCURRENCY_SOURCE.match(/setTimeout\(/g) || [])).toHaveLength(1);
      // The abort happens in the SAME callback that rejects.
      const callback = CONCURRENCY_SOURCE.slice(
        CONCURRENCY_SOURCE.indexOf('timer = setTimeout('),
        CONCURRENCY_SOURCE.indexOf('}, params.timeoutMs);'),
      );
      expect(callback).toContain('controller.abort();');
      expect(callback).toContain('Report generation exceeded');
    });

    it('keeps the 45,000 ms production boundary exactly as it was', () => {
      expect((PERFORMANCE_SOURCE.match(/timeoutMs: 45_000/g) || [])).toHaveLength(1);
      expect((PERFORMANCE_SOURCE.match(/runDedupedReport\(/g) || [])).toHaveLength(1);
    });
  });

  // -- 2. The signal reaches, and stops, the snapshot computation --------------
  describe('2. the signal reaches the snapshot computation and terminates it', () => {
    it('stops the computation at the deadline instead of continuing to the next phase', async () => {
      const gate = deferred<null>();
      mockGscIntelligence.mockImplementation(() => gate.promise as Promise<null>);
      const controller = new AbortController();

      const attempt = getAnalyticsEnterpriseSnapshot(nextCompany(), { signal: controller.signal });
      await tick();
      controller.abort();
      gate.resolve(null); // the in-flight phase settles AFTER the deadline

      await expect(attempt).rejects.toBeInstanceOf(ReportDeadlineExceededError);
      // The phase that reaches getProfile -> autoRefine -> runProfileRefinement never launched.
      expect(mockDiscoverCompetitors).not.toHaveBeenCalled();
      expect(mockBootstrapDataset).not.toHaveBeenCalled();
    });

    it('runs the competitor phase normally when there is no deadline pressure', async () => {
      await getAnalyticsEnterpriseSnapshot(nextCompany()).catch(() => null);
      expect(mockDiscoverCompetitors).toHaveBeenCalledTimes(1);
      expect(mockBootstrapDataset).toHaveBeenCalledTimes(1);
    });
  });

  // -- 3. The signal reaches the profile-refinement path -----------------------
  describe('3. the signal reaches the profile auto-refinement', () => {
    it('is readable from deeply nested async frames, as the 8-frame call graph requires', async () => {
      const controller = new AbortController();
      const deep = async (depth: number): Promise<AbortSignal | null> =>
        (depth === 0 ? getReportDeadlineSignal() : deep(depth - 1));
      const seen = await runWithReportDeadline(controller.signal, () => deep(8));
      expect(seen).toBe(controller.signal);
    });

    it('supplies the deadline to every AI operation inside runProfileRefinement', () => {
      // cleanEvidenceWithAi + generateMissingFieldQuestions (both profileEnrichment)...
      expect((PROMPTS_SOURCE.match(/signal: getReportDeadlineSignal\(\) \?\? undefined/g) || [])).toHaveLength(2);
      // ...and profileExtraction.
      const extraction = REFINEMENT_SOURCE.slice(REFINEMENT_SOURCE.indexOf("operation: 'profileExtraction'"));
      expect(extraction.slice(0, extraction.indexOf('}),'))).toContain('signal: getReportDeadlineSignal() ?? undefined');
    });
  });

  // -- 4. AI cancellation, through the gateway's existing seam -----------------
  describe('4. an in-flight AI operation receives the parent signal', () => {
    const summaries = [{ label: 'home', url: 'https://example.com', summary: 'about us' }];

    it('hands the exact parent signal to the gateway', async () => {
      const controller = new AbortController();
      await runWithReportDeadline(controller.signal, () => cleanEvidenceWithAi('c', summaries));
      expect(mockGateway).toHaveBeenCalledTimes(1);
      const request = (mockGateway.mock.calls[0] as unknown as Array<{ signal?: AbortSignal; operation: string }>)[0];
      expect(request.operation).toBe('profileEnrichment');
      expect(request.signal).toBe(controller.signal);
    });

    it('the operation observes the abort while still in flight', async () => {
      const controller = new AbortController();
      const inFlight = deferred<{ output: string; metadata: unknown }>();
      let abortedDuringCall = false;
      mockGateway.mockImplementation(((request: { signal?: AbortSignal }) => {
        request.signal?.addEventListener('abort', () => { abortedDuringCall = true; }, { once: true });
        return inFlight.promise;
      }) as never);

      const call = runWithReportDeadline(controller.signal, () => cleanEvidenceWithAi('c', summaries));
      await tick();
      controller.abort();
      expect(abortedDuringCall).toBe(true);
      inFlight.resolve({ output: '{}', metadata: null });
      await call;
    });

    it('passes no signal when there is no report scope — every other caller is unchanged', async () => {
      await cleanEvidenceWithAi('c', summaries);
      const request = (mockGateway.mock.calls[0] as unknown as Array<{ signal?: AbortSignal }>)[0];
      expect(request.signal).toBeUndefined();
    });
  });

  // -- 5. SERP cancellation, through axios's existing seam ---------------------
  describe('5. an in-flight SERP attempt receives the parent signal', () => {
    it('hands the exact parent signal to the SERP request', async () => {
      const controller = new AbortController();
      await runWithReportDeadline(controller.signal, () => fetchSerpResultsForKeyword('k', null));
      expect(mockAxiosGet).toHaveBeenCalledTimes(1);
      const config = (mockAxiosGet.mock.calls[0] as unknown as Array<{ signal?: AbortSignal; timeout: number }>)[1];
      expect(config.signal).toBe(controller.signal);
      expect(config.timeout).toBe(8000); // the existing per-request timeout is untouched
    });

    it('surfaces an aborted request as a failed SERP attempt, not a fabricated result', async () => {
      const controller = new AbortController();
      mockAxiosGet.mockImplementation(((_url: string, config: { signal?: AbortSignal }) => new Promise(
        (_resolve, reject) => config.signal?.addEventListener('abort', () => reject(new Error('canceled')), { once: true }),
      )) as never);
      const attempt = runWithReportDeadline(controller.signal, () => fetchSerpResultsForKeyword('k', null));
      await tick();
      controller.abort();
      const result = await attempt;
      expect(result.status).toBe('failed');
      expect(result.rows).toEqual([]);
    });

    it('passes no signal outside a report scope — Report 1 SERP is unchanged', async () => {
      await fetchSerpResultsForKeyword('k', null);
      const config = (mockAxiosGet.mock.calls[0] as unknown as Array<{ signal?: AbortSignal; timeout: number }>)[1];
      expect(config.signal).toBeUndefined();
      expect(config.timeout).toBe(8000);
    });
  });

  // -- 6-7. inflightSnapshots lifecycle ----------------------------------------
  describe('6-7. a cancelled snapshot cannot stay authoritative', () => {
    /**
     * `inflightSnapshots` is module-private, so its eviction is observed through its only
     * externally visible consequence: whether the NEXT request for the same fingerprint starts its
     * own computation or silently awaits the abandoned one.
     */
    it('evicts the cancelled computation so a later request does not inherit it', async () => {
      const companyId = nextCompany();
      const gate = deferred<null>();
      mockGscIntelligence.mockImplementation(() => gate.promise as Promise<null>);
      const controller = new AbortController();

      const abandoned = getAnalyticsEnterpriseSnapshot(companyId, { signal: controller.signal });
      await tick();
      expect(mockCorrelation).toHaveBeenCalledTimes(1);
      controller.abort();
      gate.resolve(null);
      await expect(abandoned).rejects.toBeInstanceOf(ReportDeadlineExceededError);

      // Request B, same company and therefore the same fingerprint.
      mockGscIntelligence.mockImplementation(async () => null);
      await getAnalyticsEnterpriseSnapshot(companyId).catch(() => null);
      expect(mockCorrelation).toHaveBeenCalledTimes(2); // its own computation, not A's
    });

    it('still dedupes two concurrent uncancelled requests', async () => {
      const companyId = nextCompany();
      const gate = deferred<null>();
      mockGscIntelligence.mockImplementation(() => gate.promise as Promise<null>);

      const first = getAnalyticsEnterpriseSnapshot(companyId).catch(() => null);
      await tick();
      const second = getAnalyticsEnterpriseSnapshot(companyId).catch(() => null);
      gate.resolve(null);
      await Promise.all([first, second]);
      expect(mockCorrelation).toHaveBeenCalledTimes(1); // existing dedupe semantics preserved
    });

    it('eviction is identity-checked so a late finally cannot delete a newer entry', () => {
      const source = read('analyticsEnterpriseSnapshotService.ts');
      expect(source).toContain('if (inflightSnapshots.get(inflightKey) === computePromise) inflightSnapshots.delete(inflightKey);');
      expect((source.match(/inflightSnapshots\.delete\(/g) || [])).toHaveLength(1);
    });
  });

  // -- 8-9. Nothing else moved -------------------------------------------------
  describe('8-9. success and signal-free callers are unchanged', () => {
    it('returns the result and metadata untouched when the run beats the deadline', async () => {
      const { result, metadata } = await runDedupedReport({
        key: 'k-success',
        timeoutMs: 5_000,
        run: async (signal) => { expect(signal.aborted).toBe(false); return 'value'; },
      });
      expect(result).toBe('value');
      expect(metadata).toEqual({ dedupe_key: 'k-success', reused_inflight: false, timeout_ms: 5_000 });
    });

    it('accepts a legacy zero-argument run callback', async () => {
      const { result, metadata } = await runDedupedReport({
        key: 'k-legacy',
        timeoutMs: 5_000,
        run: async () => 'legacy',
      });
      expect(result).toBe('legacy');
      expect(metadata.reused_inflight).toBe(false);
    });

    it('leaves a snapshot caller that passes no signal fully uncancellable', async () => {
      const snapshot = await getAnalyticsEnterpriseSnapshot(nextCompany()).catch((error) => error);
      expect(snapshot).not.toBeInstanceOf(ReportDeadlineExceededError);
    });

    it('is inert outside a report scope', () => {
      expect(getReportDeadlineSignal()).toBeNull();
      expect(() => throwIfReportDeadlineExceeded('anything')).not.toThrow();
    });
  });
});
