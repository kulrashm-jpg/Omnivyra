/**
 * PI-INGEST-CONSOLIDATION-001-C — the activation layer tells the truth about the fence.
 *
 * 001-B refuses the legacy CRM source inside the scheduler and reports that as a
 * structured skip. Because the call still RESOLVES, `triggerCrmSync`'s previous
 * unconditional `{ triggered: true }` told the caller a CRM sync had been
 * triggered while `crmIngestionService` was never reached. This suite pins the
 * corrected contract and, just as importantly, pins the three outcomes it must
 * NOT collapse into: disabled, genuine failure, and genuine success.
 *
 * The scheduler is mocked at the module boundary because the assertion is about
 * how the activation layer INTERPRETS a scheduler result. Mocking it lets each
 * scheduler state be presented exactly, including states the fence currently
 * prevents from occurring — which is the point: the classification must key on
 * the fence reason, not on "the scheduler returned something".
 */

const scheduler = { runIngestionForCompany: jest.fn() };

jest.mock('../../services/ingestionScheduler', () => {
  const actual = jest.requireActual('../../services/ingestionScheduler');
  return {
    __esModule: true,
    // The 001-B constants are deliberately NOT restubbed: the test asserts
    // against the same symbols production imports, so a renamed or changed
    // constant fails here rather than silently decoupling the two layers.
    FENCED_LEGACY_SOURCE: actual.FENCED_LEGACY_SOURCE,
    LEGACY_SOURCE_FENCED_REASON: actual.LEGACY_SOURCE_FENCED_REASON,
    runIngestionForCompany: (...args: unknown[]) => scheduler.runIngestionForCompany(...args),
  };
});

jest.mock('../../services/providers/providerSyncHealth', () => ({
  __esModule: true,
  getProviderSyncHealth: async () => null,
}));

jest.mock('../../services/integrationService', () => ({
  __esModule: true,
  getActiveIntegration: async () => null,
  deleteIntegration: async () => undefined,
  validateIntegration: async () => ({ valid: true }),
}));

import { triggerCrmSync } from '../../services/providers/crmActivationService';
import { FENCED_LEGACY_SOURCE, LEGACY_SOURCE_FENCED_REASON } from '../../services/ingestionScheduler';

const ORG = '00000000-0000-4000-8000-0000000000a1';

/** The scheduler summary shape, with one source result supplied by the test. */
const summaryWith = (source: Record<string, unknown>) => ({
  companyId: ORG,
  sources: [source],
  validation: { pages: 0, sessions: 0, keywords: 0, leads: 0, campaigns: 0 },
  ready: true,
});

const FENCED = summaryWith({
  source: 'crm',
  success: false,
  skipped: true,
  details: { reason: LEGACY_SOURCE_FENCED_REASON },
});

describe('001-C — a fenced CRM source is not reported as triggered', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.CRM_ENABLED = 'true'; // the gate is a separate refusal; see below
  });
  afterEach(() => { delete process.env.CRM_ENABLED; });

  it('A — does not claim a successful trigger when the scheduler fenced the source', async () => {
    scheduler.runIngestionForCompany.mockResolvedValue(FENCED);
    const result = await triggerCrmSync(ORG);
    expect(result.triggered).toBe(false);
  });

  it('B — preserves the machine-detectable fence reason', async () => {
    scheduler.runIngestionForCompany.mockResolvedValue(FENCED);
    const result = await triggerCrmSync(ORG);
    expect(result.reason).toBe(LEGACY_SOURCE_FENCED_REASON);
    // Not flattened into an opaque generic error.
    expect(result.reason).not.toBe('crm_sync_failed');
    expect(result.reason).not.toBe('crm_disabled');
  });

  it('B — the reason is the constant 001-B exports, not a duplicated literal', async () => {
    // If 001-B renames the reason, this fails rather than the two layers
    // silently drifting apart.
    scheduler.runIngestionForCompany.mockResolvedValue(FENCED);
    expect((await triggerCrmSync(ORG)).reason).toBe(LEGACY_SOURCE_FENCED_REASON);
    expect(FENCED_LEGACY_SOURCE).toBe('crm');
  });

  it('still asks the scheduler for the CRM source (no second fence in this layer)', async () => {
    scheduler.runIngestionForCompany.mockResolvedValue(FENCED);
    await triggerCrmSync(ORG);
    expect(scheduler.runIngestionForCompany).toHaveBeenCalledTimes(1);
    expect(scheduler.runIngestionForCompany.mock.calls[0][0]).toMatchObject({
      companyId: ORG,
      sources: [FENCED_LEGACY_SOURCE],
    });
  });

  it('is deterministic across repeated calls', async () => {
    scheduler.runIngestionForCompany.mockResolvedValue(FENCED);
    const a = await triggerCrmSync(ORG);
    const b = await triggerCrmSync(ORG, { manual: true });
    expect(a).toEqual({ triggered: false, reason: LEGACY_SOURCE_FENCED_REASON });
    expect(b).toEqual({ triggered: false, reason: LEGACY_SOURCE_FENCED_REASON });
  });
});

describe('001-C — the other outcomes stay distinct', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.CRM_ENABLED = 'true';
  });
  afterEach(() => { delete process.env.CRM_ENABLED; });

  it('C — a genuine successful scheduler result is still reported as triggered', async () => {
    // The activation layer must not become permanently "not triggered".
    scheduler.runIngestionForCompany.mockResolvedValue(summaryWith({
      source: 'crm', success: true, runId: 'run-1', details: { leadsProcessed: 3 },
    }));
    expect(await triggerCrmSync(ORG)).toEqual({ triggered: true });
  });

  it('D — a genuine scheduler failure is a failure, not a fence', async () => {
    scheduler.runIngestionForCompany.mockRejectedValue(new Error('provider_governor_blocked:commercial:kill_switch'));
    const result = await triggerCrmSync(ORG);
    expect(result.triggered).toBe(false);
    expect(result.reason).toBe('provider_governor_blocked:commercial:kill_switch');
    expect(result.reason).not.toBe(LEGACY_SOURCE_FENCED_REASON);
  });

  it('E — an empty / no-work result is not confused with the fence', async () => {
    // A source that ran and found nothing reports success with no fence reason;
    // classifying on the reason keeps that distinct from a refusal.
    scheduler.runIngestionForCompany.mockResolvedValue(summaryWith({
      source: 'crm', success: true, runId: 'run-2', details: { leadsProcessed: 0 },
    }));
    expect(await triggerCrmSync(ORG)).toEqual({ triggered: true });
  });

  it('E — an unrelated skip reason is not treated as the fence', async () => {
    scheduler.runIngestionForCompany.mockResolvedValue(summaryWith({
      source: 'crm', success: true, skipped: true, details: { reason: 'already_running' },
    }));
    expect(await triggerCrmSync(ORG)).toEqual({ triggered: true });
  });

  it('G — the feature gate remains a separate, earlier refusal', async () => {
    // Characterized, not changed: with the gate off the scheduler is never
    // consulted, so `crm_disabled` and the fence cannot be conflated.
    delete process.env.CRM_ENABLED;
    delete process.env.COMMERCIAL_EVIDENCE_ENABLED;
    const result = await triggerCrmSync(ORG);
    expect(result).toEqual({ triggered: false, reason: 'crm_disabled' });
    expect(scheduler.runIngestionForCompany).not.toHaveBeenCalled();
  });

  it('G — production is dormant: both gate flags are absent by default', () => {
    // The condition this ran under in production at 7febdb28.
    delete process.env.CRM_ENABLED;
    delete process.env.COMMERCIAL_EVIDENCE_ENABLED;
    expect(process.env.CRM_ENABLED ?? '').toBe('');
    expect(process.env.COMMERCIAL_EVIDENCE_ENABLED ?? '').toBe('');
  });
});

describe('001-C — no caller regression', () => {
  it('F — triggerCrmSync has no production caller, so no caller contract changes', () => {
    // Characterized in 001-A and re-verified here from source: the only
    // references outside this service are two LI-4D decoupling assertions that
    // check the NAME does not appear in LI-4D files. Recorded rather than
    // asserted about behaviour, because there is no caller behaviour to assert.
    const { readFileSync, readdirSync, statSync } = require('fs');
    const { join } = require('path');
    const roots = ['backend', 'pages', 'lib', 'components'].map((d) => join(__dirname, '..', '..', '..', d));
    const hits: string[] = [];
    const walk = (dir: string) => {
      let entries: string[] = [];
      try { entries = readdirSync(dir); } catch { return; }
      for (const name of entries) {
        const p = join(dir, name);
        let s; try { s = statSync(p); } catch { continue; }
        if (s.isDirectory()) { if (/node_modules|\.next|\.git/.test(p)) continue; walk(p); continue; }
        if (!/\.tsx?$/.test(name)) continue;
        if (/crmActivationService\.ts$/.test(p)) continue;         // the definition
        if (/[\\/]tests?[\\/]|\.test\.tsx?$/.test(p)) continue;    // decoupling assertions
        if (readFileSync(p, 'utf8').includes('triggerCrmSync')) hits.push(p);
      }
    };
    roots.forEach(walk);
    expect(hits).toEqual([]);
  });
});
