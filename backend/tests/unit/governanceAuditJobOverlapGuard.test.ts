/**
 * Governance audit job — in-process overlap guard (Stage 33).
 *
 * runAllCompanyAudits() must never run two sweeps at once within a process.
 * OMNI-GOV-002 (27fec12d) inserted `await evaluateAdmission(...)` between the
 * `auditJobRunning` check and the point where the flag was set, so two
 * concurrent calls could both pass the check during that await and both sweep.
 *
 * Scope: this guard is a module-level boolean, so it only excludes overlap
 * inside one Node process. It does not (and never did) provide cross-process
 * exclusion.
 */

jest.mock('../../db/supabaseClient', () => ({ supabase: { from: jest.fn() } }));
jest.mock('../../services/GovernanceAuditService', () => ({ runGovernanceAudit: jest.fn() }));
jest.mock('../../services/governance', () => ({ evaluateAdmission: jest.fn() }));

import { supabase } from '../../db/supabaseClient';
import { runGovernanceAudit } from '../../services/GovernanceAuditService';
import { evaluateAdmission } from '../../services/governance';
import { runAllCompanyAudits } from '../../jobs/governanceAuditJob';

const fromMock = supabase.from as jest.Mock;
const runAuditMock = runGovernanceAudit as jest.Mock;
const admissionMock = evaluateAdmission as jest.Mock;

const ADMITTED = { admitted: true, mode: 'off', disposition: 'bypass', reason: null, durationMs: 0, diagnostic: {} };
const DENIED = { admitted: false, mode: 'enforce', disposition: 'blocked', reason: 'denied', durationMs: 0, diagnostic: {} };

const companiesQuery = (ids: string[]) => ({
  select: jest.fn().mockResolvedValue({ data: ids.map((company_id) => ({ company_id })), error: null }),
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

async function waitUntil(predicate: () => boolean) {
  for (let i = 0; i < 100 && !predicate(); i++) await new Promise((r) => setImmediate(r));
  if (!predicate()) throw new Error('condition not reached');
}

describe('governance audit job overlap guard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    fromMock.mockImplementation(() => companiesQuery(['co-1']));
    admissionMock.mockResolvedValue(ADMITTED);
    runAuditMock.mockResolvedValue({ companyId: 'co-1', auditStatus: 'OK' });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('two concurrent calls sweep once (overlap during the admission await)', async () => {
    await Promise.all([runAllCompanyAudits(), runAllCompanyAudits()]);

    expect(runAuditMock).toHaveBeenCalledTimes(1);
    expect(admissionMock).toHaveBeenCalledTimes(1);
  });

  it('a call made while a sweep is in progress is skipped', async () => {
    const gate = deferred<{ companyId: string; auditStatus: string }>();
    runAuditMock.mockImplementation(() => gate.promise);

    const first = runAllCompanyAudits();
    await waitUntil(() => runAuditMock.mock.calls.length === 1);

    await runAllCompanyAudits();
    expect(runAuditMock).toHaveBeenCalledTimes(1);

    gate.resolve({ companyId: 'co-1', auditStatus: 'OK' });
    await first;
    expect(runAuditMock).toHaveBeenCalledTimes(1);
  });

  it('releases the guard after a successful sweep', async () => {
    await runAllCompanyAudits();
    await runAllCompanyAudits();

    expect(runAuditMock).toHaveBeenCalledTimes(2);
  });

  it('releases the guard after a failed sweep', async () => {
    fromMock.mockImplementationOnce(() => { throw new Error('db unavailable'); });

    await expect(runAllCompanyAudits()).resolves.toBeUndefined();
    expect(runAuditMock).not.toHaveBeenCalled();

    await runAllCompanyAudits();
    expect(runAuditMock).toHaveBeenCalledTimes(1);
  });

  it('a denied admission skips the sweep and does not hold the guard', async () => {
    admissionMock.mockResolvedValueOnce(DENIED);

    await runAllCompanyAudits();
    expect(runAuditMock).not.toHaveBeenCalled();

    await runAllCompanyAudits();
    expect(runAuditMock).toHaveBeenCalledTimes(1);
  });

  it('an admission evaluation error does not hold the guard', async () => {
    admissionMock.mockRejectedValueOnce(new Error('admission runtime unavailable'));

    await runAllCompanyAudits().catch(() => undefined);
    expect(runAuditMock).not.toHaveBeenCalled();

    await runAllCompanyAudits();
    expect(runAuditMock).toHaveBeenCalledTimes(1);
  });
});
