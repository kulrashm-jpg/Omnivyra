/**
 * BETA-REPORT-EXEC-006 — Canonical Commercial Adapter → ROI activation.
 *
 * Proves the chain: Commercial Adapter (reusing the commercial bridge consolidation) → CommercialResult →
 * resolveReportRoiDeterminability. Measured revenue upgrades ROI to "Quantified"; conversions-only to
 * "Estimated (native units)"; no credentials / no rows / no measured signal stays "Not Quantifiable". No
 * revenue, conversion, or ROI is ever fabricated. Deterministic; no DB (loader injected).
 */
import {
  CommercialAdapter,
  registerCommercialSourceLoader,
} from '../../services/intelligence/adapters/commercialAdapter';
import { resolveReportRoiDeterminability } from '../../services/canonicalReport/reportRoiDeterminability';
import type { CommercialSourcePayload } from '../../services/commercialProviderBridge';

const OBSERVED = '2026-02-01T12:00:00.000Z';
const companyId = 'company-1';

const withEnv = (env: Record<string, string | undefined>, fn: () => Promise<void>) => async () => {
  const saved = { ...process.env };
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    await fn();
  } finally {
    process.env = saved;
  }
};

const loader = (sources: CommercialSourcePayload[]) => async () => ({ sources, observedAt: OBSERVED });
const roiFor = (r: { state: string; quantified: { value: number; unit: string } | null; measuredRevenue: boolean }) =>
  resolveReportRoiDeterminability({ hasCommercialEvidence: r.state === 'measured', quantified: r.quantified, measuredRevenue: r.measuredRevenue });

afterEach(() => registerCommercialSourceLoader(null));

describe('BETA-REPORT-EXEC-006 — commercial adapter → ROI', () => {
  it('measured revenue → CommercialResult measured → ROI Quantified', withEnv({ CRM_ENABLED: 'true' }, async () => {
    registerCommercialSourceLoader(loader([{ source: 'crm', revenue: 42000, conversions: 210 }]));
    const res = await new CommercialAdapter().lookup({ companyId });
    expect(res.state).toBe('measured');
    expect(res.measuredRevenue).toBe(true);
    expect(res.quantified).toEqual({ value: 42000, unit: 'revenue' });
    const roi = roiFor(res);
    expect(roi.status).toBe('measured');
    expect(roi.label).toBe('Quantified');
  }));

  it('conversions only (no revenue) → ROI Estimated (native units), never Quantified', withEnv({ COMMERCIAL_EVIDENCE_ENABLED: 'true' }, async () => {
    registerCommercialSourceLoader(loader([{ source: 'ga4', conversions: 300 }]));
    const res = await new CommercialAdapter().lookup({ companyId });
    expect(res.state).toBe('measured');
    expect(res.measuredRevenue).toBe(false);
    expect(res.quantified).toEqual({ value: 300, unit: 'conversions' });
    const roi = roiFor(res);
    expect(roi.status).toBe('estimated');
    expect(roi.label).toBe('Estimated (native units)');
  }));

  it('no credentials → unavailable → ROI Not Quantifiable (graceful)', withEnv({ CRM_ENABLED: undefined, COMMERCIAL_EVIDENCE_ENABLED: undefined }, async () => {
    registerCommercialSourceLoader(loader([{ source: 'crm', revenue: 9000 }]));
    const res = await new CommercialAdapter().lookup({ companyId });
    expect(res.state).toBe('unavailable');
    expect(roiFor(res).label).toBe('Not Quantifiable');
  }));

  it('configured but no loader → unavailable', withEnv({ CRM_ENABLED: 'true' }, async () => {
    registerCommercialSourceLoader(null);
    const res = await new CommercialAdapter().lookup({ companyId });
    expect(res.state).toBe('unavailable');
  }));

  it('configured but empty rows → unavailable (no fabrication)', withEnv({ CRM_ENABLED: 'true' }, async () => {
    registerCommercialSourceLoader(loader([]));
    const res = await new CommercialAdapter().lookup({ companyId });
    expect(res.state).toBe('unavailable');
    expect(res.quantified).toBeNull();
  }));

  it('sources with no measured revenue/conversions → unavailable', withEnv({ CRM_ENABLED: 'true' }, async () => {
    registerCommercialSourceLoader(loader([{ source: 'x' }]));
    const res = await new CommercialAdapter().lookup({ companyId });
    expect(res.state).toBe('unavailable');
    expect(res.quantified).toBeNull();
  }));

  it('is deterministic', withEnv({ CRM_ENABLED: 'true' }, async () => {
    registerCommercialSourceLoader(loader([{ source: 'crm', revenue: 1000, conversions: 5 }]));
    const a = await new CommercialAdapter().lookup({ companyId });
    const b = await new CommercialAdapter().lookup({ companyId });
    expect(b.state).toBe(a.state);
    expect(b.quantified).toEqual(a.quantified);
  }));
});
