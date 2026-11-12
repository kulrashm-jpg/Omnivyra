/**
 * Autonomous scheduler credit gate (2026-11-12, e9 ruling 6).
 * The gate was hard-coded `sufficient: true` with a fake balance of 10x cost:
 * it never closed, and the low-credit flag never fired. It now reads the real
 * balance via hasEnoughCredits. Also: a failed active-campaign read must not
 * read as "no active campaign" (that generates and charges a duplicate).
 *
 * Hostile defaults: every table read FAILS unless a test makes it clean, so a
 * test can only pass on the path it names.
 */
export {};
type Res = { data: unknown; error: { message: string } | null };
let mockClean = new Set<string>();
let mockRows: Record<string, unknown> = {};
function builder(table: string) {
  const b: any = {};
  const result = (): Res => (mockClean.has(table) ? { data: mockRows[table] ?? [], error: null } : { data: null, error: { message: `${table} down` } });
  for (const m of ['select', 'eq', 'in', 'or', 'limit', 'lt', 'gte', 'update', 'insert']) b[m] = () => b;
  b.maybeSingle = async () => result();
  b.then = (ok: (v: Res) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(result()).then(ok, ko);
  return b;
}
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => builder(t) }));
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: (t: string) => builder(t) } }));
jest.mock('../../services/autonomousCampaignAgent', () => ({
  generateNextCampaign: jest.fn(async () => ({ name: 'p', generation_meta: {} })),
  getAutonomousSettings: jest.fn(),
}));
jest.mock('../../services/campaignLearningsStore', () => ({ distilCampaignLearnings: jest.fn(async () => 0) }));
jest.mock('../../services/autonomousDecisionLogger', () => ({ logDecision: jest.fn(async () => undefined) }));
jest.mock('../../services/creditDeductionService', () => ({
  getCreditCost: jest.fn(async () => 50),
  hasEnoughCredits: jest.fn(),
}));

import { runAutonomousScheduler } from '../../services/autonomousScheduler';
import { generateNextCampaign } from '../../services/autonomousCampaignAgent';
import { hasEnoughCredits } from '../../services/creditDeductionService';

const gen = generateNextCampaign as jest.Mock;
const credits = hasEnoughCredits as jest.Mock;
let errSpy: jest.SpyInstance;

beforeEach(() => {
  gen.mockClear();
  credits.mockReset();
  mockClean = new Set(['pending_campaigns', 'campaigns', 'company_settings', 'notifications']);
  mockRows = { company_settings: [{ company_id: 'org1', autonomous_mode: true, approval_required: true }], campaigns: [], pending_campaigns: [{ id: 'pc1' }] };
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => errSpy.mockRestore());

it('insufficient real balance -> no generation (the gate CLOSES)', async () => {
  credits.mockResolvedValue({ sufficient: false, balance: 10, required: 50 });
  const r = await runAutonomousScheduler();
  expect(credits).toHaveBeenCalledWith('org1', 'campaign_generation');
  expect(gen).not.toHaveBeenCalled();
  expect(r.errors.join(' ')).toMatch(/Insufficient credits \(10\/50\)/);
});

it('wallet read error -> company skipped, never generated on an unread balance', async () => {
  credits.mockRejectedValue(new Error('[creditPriority] wallet read failed for org1: down'));
  const r = await runAutonomousScheduler();
  expect(gen).not.toHaveBeenCalled();
  expect(r.errors.join(' ')).toMatch(/wallet read failed/);
});

it('control: sufficient balance -> generates', async () => {
  credits.mockResolvedValue({ sufficient: true, balance: 1000, required: 50 });
  const r = await runAutonomousScheduler();
  expect(gen).toHaveBeenCalledTimes(1);
  expect(r.campaigns_generated).toBe(1);
});

it('low real balance -> low-credit note is attached (it never fired before)', async () => {
  credits.mockResolvedValue({ sufficient: true, balance: 100, required: 50 });
  let planSeen: any;
  gen.mockImplementationOnce(async () => { planSeen = { name: 'p', generation_meta: {} }; return planSeen; });
  await runAutonomousScheduler();
  expect(planSeen.generation_meta.optimization_notes.join(' ')).toMatch(/Credit balance low/);
});

it('active-campaign read error -> no generation (never "no active campaign")', async () => {
  credits.mockResolvedValue({ sufficient: true, balance: 1000, required: 50 });
  mockClean.delete('campaigns');
  const r = await runAutonomousScheduler();
  expect(gen).not.toHaveBeenCalled();
  expect(r.errors.join(' ')).toMatch(/active campaign read failed/);
});

it('settings read error -> "Scheduler failed", never a clean zero', async () => {
  mockClean.delete('company_settings');
  const r = await runAutonomousScheduler();
  expect(r.errors.join(' ')).toMatch(/Scheduler failed: autonomous settings read failed/);
  expect(gen).not.toHaveBeenCalled();
});

// 05 residual (2026-11-12): a failed pending-expiry update was reported as
// expired_pending: 0 (a fabricated number). It is now null + an error line.
it('pending expiry update error -> expired_pending is null (unknown), never 0', async () => {
  credits.mockResolvedValue({ sufficient: true, balance: 1000, required: 50 });
  mockClean.delete('pending_campaigns');
  const r = await runAutonomousScheduler();
  expect(r.expired_pending).toBeNull();
  expect(r.errors.join(' ')).toMatch(/pending campaign expiry failed/);
});
it('control: clean expiry reports the real count', async () => {
  credits.mockResolvedValue({ sufficient: true, balance: 1000, required: 50 });
  mockRows.pending_campaigns = [{ id: 'a' }, { id: 'b' }];
  const r = await runAutonomousScheduler();
  expect(r.expired_pending).toBe(2);
});
