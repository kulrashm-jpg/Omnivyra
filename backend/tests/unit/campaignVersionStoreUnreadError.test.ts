/**
 * unread-error pkg 2: campaign_versions readers and their consumers. PostgREST returns an error, never
 * throws; these readers turned ANY error into "no version" / "no campaigns":
 *   - getLatestCampaignVersion / getCompanyCampaignIds / getLatestCampaignVersionByCampaignId now throw
 *     CampaignVersionReadError ("no row" still answers null);
 *   - getLatestApprovedCampaignVersion (e9: BLOCKING): a FAILED approved read fell back to the latest,
 *     possibly UNAPPROVED, version, and campaignOptimizationService then SAVED a blueprint from it;
 *   - governance ledger verification: a failed read was valid:true (events) or "corrupted" (anything
 *     else); it is now a distinct 'unverifiable' status (e9's value-for-unreadable rule);
 *   - syncCampaignVersionStage stays best-effort (never throws) but logs both failures.
 *
 * Hostile fake: a key this suite does not configure THROWS. Keys: `<table>:<op>` plus ':approved' for a
 * campaign_versions read filtered on status = 'approved'.
 */
type Result = { data: unknown; error: { message: string; code?: string } | null };

let results: Record<string, Result> = {};
const writes: string[] = [];

function makeBuilder(table: string) {
  let op = 'select';
  let approved = false;
  const key = () => `${table}:${op}${approved ? ':approved' : ''}`;
  const settle = (): Result => {
    const k = key();
    if (op !== 'select') writes.push(k);
    const r = results[k];
    if (!r) throw new Error(`hostile fake: unconfigured ${k}`);
    return r;
  };
  const b: any = {
    select: () => b,
    update: () => { op = 'update'; return b; },
    insert: () => { op = 'insert'; return b; },
    eq: (col: string, val: unknown) => { if (col === 'status' && val === 'approved') approved = true; return b; },
    in: () => b, gte: () => b, order: () => b, limit: () => b,
    single: async () => settle(),
    maybeSingle: async () => settle(),
    then: (ok: (v: Result) => unknown, ko?: (e: unknown) => unknown) => {
      try { return Promise.resolve(settle()).then(ok, ko); } catch (e) { return Promise.reject(e).then(ok, ko); }
    },
  };
  return b;
}

jest.mock('../../db/supabaseClient', () => ({ supabase: { from: (t: string) => makeBuilder(t) } }));

import {
  CampaignVersionReadError,
  getLatestCampaignVersion,
  getCompanyCampaignIds,
  getLatestCampaignVersionByCampaignId,
  syncCampaignVersionStage,
} from '../../db/campaignVersionStore';
import { getLatestApprovedCampaignVersion } from '../../db/campaignApprovedVersionStore';
import { verifyCampaignLedger, verifyCompanyLedger } from '../../services/GovernanceLedgerVerificationService';

const ok = (data: unknown): Result => ({ data, error: null });
const boom = (code?: string): Result => ({ data: null, error: { message: 'boom', ...(code ? { code } : {}) } });
const NO_ROW = boom('PGRST116');

beforeEach(() => {
  writes.length = 0;
  results = {};
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'debug').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('campaign_versions readers', () => {
  it('getLatestCampaignVersion: CONTROL "no row" (PGRST116) is null; a row is returned', async () => {
    results['campaign_versions:select'] = NO_ROW;
    await expect(getLatestCampaignVersion('co', 'c')).resolves.toBeNull();
    results['campaign_versions:select'] = ok({ id: 'v1' });
    await expect(getLatestCampaignVersion('co', 'c')).resolves.toEqual({ id: 'v1' });
  });

  it('getLatestCampaignVersion: a FAILED read throws, never "no version"', async () => {
    results['campaign_versions:select'] = boom();
    await expect(getLatestCampaignVersion('co', 'c')).rejects.toBeInstanceOf(CampaignVersionReadError);
  });

  it('getCompanyCampaignIds: a FAILED read throws, never [] ("no campaigns")', async () => {
    results['campaign_versions:select'] = boom();
    await expect(getCompanyCampaignIds('co')).rejects.toMatchObject({ code: 'CAMPAIGN_VERSION_READ_FAILED' });
    results['campaign_versions:select'] = ok([{ campaign_id: 'a' }, { campaign_id: 'a' }, { campaign_id: 'b' }]);
    await expect(getCompanyCampaignIds('co')).resolves.toEqual(['a', 'b']);
  });

  it('getLatestCampaignVersionByCampaignId: a FAILED read throws; "no row" is null', async () => {
    results['campaign_versions:select'] = boom();
    await expect(getLatestCampaignVersionByCampaignId('c')).rejects.toBeInstanceOf(CampaignVersionReadError);
    results['campaign_versions:select'] = ok(null);
    await expect(getLatestCampaignVersionByCampaignId('c')).resolves.toBeNull();
  });
});

describe('getLatestApprovedCampaignVersion (e9: BLOCKING)', () => {
  it('a FAILED approved read throws, never the latest (possibly UNAPPROVED) version', async () => {
    results['campaign_versions:select:approved'] = boom();
    results['campaign_versions:select'] = ok({ id: 'v-proposed', status: 'proposed' });
    await expect(getLatestApprovedCampaignVersion('co', 'c')).rejects.toBeInstanceOf(CampaignVersionReadError);
  });

  it('CONTROL: an approved version is returned when one exists', async () => {
    results['campaign_versions:select:approved'] = ok({ id: 'v-approved', status: 'approved' });
    results['campaign_versions:select'] = ok({ id: 'v-approved', status: 'approved' });
    await expect(getLatestApprovedCampaignVersion('co', 'c')).resolves.toMatchObject({ id: 'v-approved' });
  });

  it('CONTROL (designed, unchanged): when NO approved version exists (read succeeded), the latest is returned', async () => {
    results['campaign_versions:select:approved'] = ok(null);
    results['campaign_versions:select'] = ok({ id: 'v-draft', status: 'draft' });
    await expect(getLatestApprovedCampaignVersion('co', 'c')).resolves.toMatchObject({ id: 'v-draft' });
  });

  it('a failed reapproval-audit dedupe read writes NO (duplicate) audit row', async () => {
    results['campaign_versions:select:approved'] = ok({ id: 'v-approved', status: 'approved' });
    results['campaign_versions:select'] = ok({ id: 'v-proposed', status: 'proposed' });
    results['audit_logs:select'] = boom();
    results['audit_logs:insert'] = ok(null);
    await getLatestApprovedCampaignVersion('co', 'c');
    expect(writes).toEqual([]);
  });
});

describe('governance ledger verification (value-for-unreadable)', () => {
  it('verifyCampaignLedger: a FAILED events read is unverifiable, never valid:true', async () => {
    results['campaign_governance_events:select'] = boom();
    await expect(verifyCampaignLedger('c')).resolves.toEqual({ valid: false, status: 'unverifiable' });
  });

  it('verifyCampaignLedger: CONTROL no events is verified', async () => {
    results['campaign_governance_events:select'] = ok([]);
    await expect(verifyCampaignLedger('c')).resolves.toEqual({ valid: true, status: 'verified' });
  });

  it('verifyCampaignLedger: CONTROL a broken chain is corrupted (not unverifiable)', async () => {
    results['campaign_governance_events:select'] = ok([
      { id: 'e1', campaign_id: 'c', event_type: 't', event_status: 's', metadata: {}, event_hash: 'tampered', previous_event_hash: null, created_at: '2026-01-01' },
    ]);
    await expect(verifyCampaignLedger('c')).resolves.toMatchObject({ valid: false, status: 'corrupted', corruptedEventIds: ['e1'] });
  });

  it('verifyCompanyLedger: an UNREADABLE campaign list is unverifiable, never "corrupted" and never valid', async () => {
    results['campaign_versions:select'] = boom();
    await expect(verifyCompanyLedger('co')).resolves.toMatchObject({ valid: false, status: 'unverifiable', corruptedCampaigns: [] });
  });

  it('verifyCompanyLedger: one unreadable campaign makes the company unverifiable (no campaign left unchecked as valid)', async () => {
    results['campaign_versions:select'] = ok([{ campaign_id: 'a' }]);
    results['campaign_governance_events:select'] = boom();
    await expect(verifyCompanyLedger('co')).resolves.toMatchObject({ valid: false, status: 'unverifiable', unverifiableCampaigns: ['a'], corruptedCampaigns: [] });
  });
});

describe('syncCampaignVersionStage (best-effort, never throws, never silent)', () => {
  it('a FAILED version read is logged and nothing is updated', async () => {
    results['campaign_versions:select'] = boom();
    await expect(syncCampaignVersionStage('c', 'schedule', 'co')).resolves.toBeUndefined();
    expect(writes).toEqual([]);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('version unreadable'), expect.objectContaining({ campaignId: 'c' }));
  });

  it('a FAILED stage update is logged', async () => {
    results['campaign_versions:select'] = ok([{ id: 'v1' }]);
    results['campaign_versions:update'] = boom();
    await expect(syncCampaignVersionStage('c', 'schedule', 'co')).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('stage not synced'), expect.objectContaining({ newStage: 'schedule' }));
  });
});
