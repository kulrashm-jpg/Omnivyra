/**
 * Bounded pruning of rpa_auth_token_redemptions (single-use nonce ledger).
 *
 * Invariant: a nonce is deleted only when its token expired MORE than
 * RPA_TOKEN_REDEMPTION_PRUNE_MARGIN_MS ago (strict). Such a token is already
 * refused by verifyRpaAuthToken (TOKEN_EXPIRED), and consumeRpaAuthToken
 * re-checks expiry after its nonce insert, so pruning can never re-enable a
 * token. Pruning is bounded per call, tenant-scopable, and runs best-effort on
 * redemption (no schedule).
 *
 * In-memory PostgREST fake; no network.
 */
import { createFakeDb, type FakeDb } from './helpers/communityExecutionFakeDb';

let mockDb: FakeDb = createFakeDb();
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => mockDb.from(t) }));
jest.mock('../../services/rbacService', () => ({
  isSuperAdmin: async (u: string) => u === 'admin_a',
  isPlatformSuperAdmin: async () => false,
  getUserRole: async () => ({ role: null, error: 'COMPANY_ACCESS_DENIED' }),
}));

/* eslint-disable @typescript-eslint/no-var-requires */
const tokens = require('../../services/rpaWorker/rpaAuthTokens');
/* eslint-enable @typescript-eslint/no-var-requires */

const MARGIN: number = tokens.RPA_TOKEN_REDEMPTION_PRUNE_MARGIN_MS;
const MAX: number = tokens.RPA_TOKEN_REDEMPTION_PRUNE_MAX;
const ORG_A = '00000000-0000-0000-0000-00000000000a';
const ORG_B = '00000000-0000-0000-0000-00000000000b';
const NOW = Date.parse('2026-10-28T12:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();
const TABLE = 'rpa_auth_token_redemptions';

let clock = NOW;
let nowSpy: jest.SpyInstance;

const row = (nonce: string, expiresMs: number, org = ORG_A) => ({
  nonce,
  organization_id: org,
  platform: 'linkedin',
  user_id: 'admin_a',
  token_expires_at: iso(expiresMs),
  redeemed_at: iso(expiresMs - 10 * 60 * 1000),
});
const nonces = () => (mockDb.tables[TABLE] ?? []).map((r) => r.nonce).sort();

beforeEach(() => {
  mockDb = createFakeDb({ [TABLE]: [] });
  mockDb.unique[TABLE] = ['nonce'];
  process.env.RPA_AUTH_SECRET = 'rpa-test-signing-secret-0123456789';
  clock = NOW;
  nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => clock);
});
afterEach(() => nowSpy.mockRestore());

describe('expiry boundary (strict: token_expires_at < now - margin)', () => {
  it('exactly at the margin is kept; just inside is kept; just past is pruned', async () => {
    mockDb.tables[TABLE].push(
      row('at-margin', NOW - MARGIN),
      row('inside-margin', NOW - MARGIN + 1),
      row('past-margin', NOW - MARGIN - 1),
    );
    const r = await tokens.pruneExpiredRpaAuthTokenRedemptions({ nowMs: NOW });
    expect(r).toEqual({ deleted: 1, cutoff: iso(NOW - MARGIN) });
    expect(nonces()).toEqual(['at-margin', 'inside-margin']);
  });

  it('the margin is at least the token TTL plus skew (pruned tokens are long dead)', () => {
    // TTL is 30 min; the margin must exceed it so a pruned nonce's token
    // expired well before — verifyRpaAuthToken refuses it on any sane clock.
    expect(MARGIN).toBeGreaterThanOrEqual(60 * 60 * 1000);
  });
});

describe('active tokens are never pruned', () => {
  it('unexpired and recently-expired (within margin) rows survive any limit', async () => {
    mockDb.tables[TABLE].push(
      row('active-far', NOW + 30 * 60 * 1000),
      row('active-edge', NOW),
      row('expired-recent', NOW - 1),
      row('expired-old', NOW - MARGIN - 60 * 1000),
    );
    await tokens.pruneExpiredRpaAuthTokenRedemptions({ nowMs: NOW, limit: MAX });
    expect(nonces()).toEqual(['active-edge', 'active-far', 'expired-recent']);
  });

  it('replay of a still-valid token is refused even after a prune ran', async () => {
    const { token } = tokens.issueRpaAuthToken({ organization_id: ORG_A, platform: 'linkedin', user_id: 'admin_a' });
    const first = await tokens.consumeRpaAuthToken(token);
    expect(first.ok).toBe(true);
    // Prune as aggressively as allowed, at a time the token is still valid.
    clock = NOW + 29 * 60 * 1000;
    await tokens.pruneExpiredRpaAuthTokenRedemptions({ limit: MAX });
    expect(mockDb.tables[TABLE]).toHaveLength(1);
    const replay = await tokens.consumeRpaAuthToken(token);
    expect(replay).toEqual({ ok: false, reason: 'TOKEN_ALREADY_USED', status: 401 });
  });

  it('a pruned nonce cannot be redeemed again: verification refuses the expired token', async () => {
    const { token, expires_at } = tokens.issueRpaAuthToken({ organization_id: ORG_A, platform: 'linkedin', user_id: 'admin_a' });
    expect((await tokens.consumeRpaAuthToken(token)).ok).toBe(true);
    clock = expires_at + MARGIN + 1;
    const pruned = await tokens.pruneExpiredRpaAuthTokenRedemptions({});
    expect(pruned.deleted).toBe(1);
    expect(mockDb.tables[TABLE]).toHaveLength(0);
    const replay = await tokens.consumeRpaAuthToken(token);
    expect(replay).toEqual({ ok: false, reason: 'TOKEN_EXPIRED', status: 401 });
    expect(mockDb.tables[TABLE]).toHaveLength(0); // refused before any insert
  });

  it('a redemption that verified in time but inserted after a prune is refused (post-insert expiry re-check)', async () => {
    const { token, expires_at } = tokens.issueRpaAuthToken({ organization_id: ORG_A, platform: 'linkedin', user_id: 'admin_a' });
    expect((await tokens.consumeRpaAuthToken(token)).ok).toBe(true);
    // The original nonce is pruned long after expiry...
    clock = expires_at + MARGIN + 1;
    expect((await tokens.pruneExpiredRpaAuthTokenRedemptions({})).deleted).toBe(1);
    // ...while a stalled replay verified at the last valid instant and only
    // reaches its insert now.
    clock = expires_at;
    const origFrom = mockDb.from;
    mockDb.from = (t: string) => {
      const q = origFrom(t);
      if (t === TABLE) {
        const ins = q.insert.bind(q);
        q.insert = (r: unknown) => {
          clock = expires_at + MARGIN + 2;
          return ins(r);
        };
      }
      return q;
    };
    const replay = await tokens.consumeRpaAuthToken(token);
    expect(replay).toEqual({ ok: false, reason: 'TOKEN_EXPIRED', status: 401 });
  });
});

describe('bounded and tenant-scoped', () => {
  it('deletes at most `limit` rows per call, oldest first', async () => {
    for (let i = 0; i < 30; i += 1) mockDb.tables[TABLE].push(row(`n${String(i).padStart(2, '0')}`, NOW - MARGIN - 1000 * (i + 1)));
    const r = await tokens.pruneExpiredRpaAuthTokenRedemptions({ nowMs: NOW, limit: 10 });
    expect(r.deleted).toBe(10);
    expect(mockDb.tables[TABLE]).toHaveLength(20);
    // the 10 OLDEST (largest i) are gone
    for (let i = 20; i < 30; i += 1) expect(nonces()).not.toContain(`n${i}`);
  });

  it('a huge limit is capped at RPA_TOKEN_REDEMPTION_PRUNE_MAX; a bad limit falls back to >= 1', async () => {
    for (let i = 0; i < MAX + 25; i += 1) mockDb.tables[TABLE].push(row(`m${i}`, NOW - MARGIN - 1000 - i));
    const r = await tokens.pruneExpiredRpaAuthTokenRedemptions({ nowMs: NOW, limit: 1_000_000 });
    expect(r.deleted).toBe(MAX);
    expect(mockDb.tables[TABLE]).toHaveLength(25);
    const z = await tokens.pruneExpiredRpaAuthTokenRedemptions({ nowMs: NOW, limit: 0 });
    expect(z.deleted).toBe(1);
  });

  it('tenant scope never touches another organization', async () => {
    mockDb.tables[TABLE].push(row('a-old', NOW - MARGIN - 5000, ORG_A), row('b-old', NOW - MARGIN - 5000, ORG_B));
    const r = await tokens.pruneExpiredRpaAuthTokenRedemptions({ nowMs: NOW, organizationId: ORG_A });
    expect(r.deleted).toBe(1);
    expect(nonces()).toEqual(['b-old']);
  });

  it('a DB error never throws and deletes nothing', async () => {
    const r = await tokens.pruneExpiredRpaAuthTokenRedemptions({
      nowMs: NOW,
      db: { from: () => { throw new Error('db down'); } },
    });
    expect(r.deleted).toBe(0);
  });
});

describe('invoked best-effort on redemption (no schedule)', () => {
  it('a successful redemption prunes the SAME tenant, bounded at 20', async () => {
    // 'old-' prefix: real nonces are hex, so they can never collide with it.
    for (let i = 0; i < 25; i += 1) mockDb.tables[TABLE].push(row(`old-${i}`, NOW - MARGIN - 1000 - i, ORG_A));
    mockDb.tables[TABLE].push(row('b-old', NOW - MARGIN - 1000, ORG_B), row('a-active', NOW + 60_000, ORG_A));
    const { token } = tokens.issueRpaAuthToken({ organization_id: ORG_A, platform: 'linkedin', user_id: 'admin_a' });
    const r = await tokens.consumeRpaAuthToken(token);
    expect(r.ok).toBe(true);
    const left = mockDb.tables[TABLE];
    expect(left.filter((x) => String(x.nonce).startsWith('old-'))).toHaveLength(5);
    expect(left.some((x) => x.nonce === 'b-old')).toBe(true);
    expect(left.some((x) => x.nonce === 'a-active')).toBe(true);
    expect(tokens.RPA_TOKEN_REDEMPTION_PRUNE_ON_REDEEM).toBe(20);
  });

  it('a failing cleanup never affects the redemption', async () => {
    const origFrom = mockDb.from;
    mockDb.from = (t: string) => {
      const q = origFrom(t);
      if (t === TABLE) q.delete = () => { throw new Error('delete refused'); };
      return q;
    };
    mockDb.tables[TABLE].push(row('old', NOW - MARGIN - 1000));
    const { token } = tokens.issueRpaAuthToken({ organization_id: ORG_A, platform: 'linkedin', user_id: 'admin_a' });
    expect((await tokens.consumeRpaAuthToken(token)).ok).toBe(true);
  });

  it('a refused redemption does not prune', async () => {
    mockDb.tables[TABLE].push(row('old', NOW - MARGIN - 1000));
    const r = await tokens.consumeRpaAuthToken('garbage.token');
    expect(r.ok).toBe(false);
    expect(nonces()).toEqual(['old']);
  });
});
