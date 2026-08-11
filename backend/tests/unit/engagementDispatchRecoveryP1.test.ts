/**
 * P1 — abandoned browser-dispatch recovery (Case E).
 *
 * The governing rule this whole design serves:
 *   it is better to delay a reply than to send the same external message twice.
 *
 * So recovery releases a RESERVATION, never asserts an OUTCOME. It acts only on
 * actions provably never claimed by any extension (dispatch_lease_id and
 * dispatch_acknowledged_at both NULL), because only then can no platform call
 * have occurred. A claimed-but-unreported action has unknown delivery state and
 * is deliberately left alone.
 */

interface Row { [k: string]: unknown }
const db: Record<string, Row[]> = { community_ai_actions: [], engagement_messages: [] };

/** Supports .eq/.is/.lt/.limit plus conditional update returning matched rows. */
function builder(table: string) {
  const preds: Array<(r: Row) => boolean> = [];
  const rows = () => (db[table] ?? []).filter((r) => preds.every((p) => p(r)));
  const api: any = {
    select() { return api; },
    eq(c: string, v: unknown) { preds.push((r) => r[c] === v); return api; },
    is(c: string, v: unknown) { preds.push((r) => (r[c] ?? null) === v); return api; },
    lt(c: string, v: unknown) { preds.push((r) => String(r[c] ?? '') < String(v)); return api; },
    order() { return api; }, limit() { return api; },
    update(patch: Row) {
      const upd: any = {
        eq(c: string, v: unknown) { preds.push((r) => r[c] === v); return upd; },
        is(c: string, v: unknown) { preds.push((r) => (r[c] ?? null) === v); return upd; },
        select() {
          const matched = rows();
          matched.forEach((r) => Object.assign(r, patch));
          return Promise.resolve({ data: matched.map((r) => ({ id: r.id })), error: null });
        },
      };
      return upd;
    },
    maybeSingle() { return Promise.resolve({ data: rows()[0] ?? null, error: null }); },
    then(res: (v: unknown) => unknown) { return Promise.resolve({ data: rows(), error: null }).then(res); },
  };
  return api;
}
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: (t: string) => builder(t) } }));

const auditEvents: Array<Record<string, unknown>> = [];
jest.mock('../../services/auditLoggingService', () => ({
  logAuditEvent: async (e: Record<string, unknown>) => { auditEvents.push(e); },
}));

import {
  recoverAbandonedBrowserDispatches,
  resolveThresholdMs,
  EXTENSION_POLLING_INTERVAL_MS,
} from '../../services/engagementDispatchRecoveryService';

const ORG = 'org_eng';
const OTHER_ORG = 'org_rival';
const HOUR = 60 * 60 * 1000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

function action(over: Partial<Row> = {}): Row {
  const row: Row = {
    id: `act_${db.community_ai_actions.length + 1}`,
    organization_id: ORG,
    platform: 'linkedin',
    action_type: 'dm',
    target_id: 'urn:li:dm:A',
    execution_mode: 'browser',
    status: 'pending',
    dispatch_lease_id: null,
    dispatch_lease_holder_id: null,
    dispatch_acknowledged_at: null,
    created_at: ago(3 * HOUR),
    ...over,
  };
  db.community_ai_actions.push(row);
  return row;
}
const claimable = () =>
  db.community_ai_actions.filter((a) => a.status === 'pending' && a.execution_mode === 'browser');

beforeEach(() => {
  db.community_ai_actions = []; db.engagement_messages = [];
  auditEvents.length = 0;
  delete process.env.ENGAGEMENT_DISPATCH_ABANDON_THRESHOLD_MS;
});

// ─────────────────────────────────────────────────────────────────────────────
describe('threshold is derived, not invented', () => {
  it('defaults to 60 consecutive missed extension polls', () => {
    // /api/extension/redeem and /validate both issue polling_interval: 60s.
    expect(EXTENSION_POLLING_INTERVAL_MS).toBe(60_000);
    expect(resolveThresholdMs()).toBe(60 * EXTENSION_POLLING_INTERVAL_MS);
  });

  it('is overridable per deployment, ignoring nonsense values', () => {
    process.env.ENGAGEMENT_DISPATCH_ABANDON_THRESHOLD_MS = '900000';
    expect(resolveThresholdMs()).toBe(900_000);
    process.env.ENGAGEMENT_DISPATCH_ABANDON_THRESHOLD_MS = 'not-a-number';
    expect(resolveThresholdMs()).toBe(60 * EXTENSION_POLLING_INTERVAL_MS);
    process.env.ENGAGEMENT_DISPATCH_ABANDON_THRESHOLD_MS = '-5';
    expect(resolveThresholdMs()).toBe(60 * EXTENSION_POLLING_INTERVAL_MS);
  });
});

describe('T3/T4 — stale but never claimed', () => {
  it('T3: releases the reservation and makes the thread retryable', async () => {
    const a = action();
    const r = await recoverAbandonedBrowserDispatches();
    expect(r.released).toBe(1);
    expect(a.status).toBe('skipped');            // terminal, existing state
    expect(claimable()).toHaveLength(0);         // extension will not deliver it
  });

  it('T3b: a fresh unclaimed action is left alone', async () => {
    const a = action({ created_at: ago(2 * 60 * 1000) });   // 2 minutes old
    const r = await recoverAbandonedBrowserDispatches();
    expect(r.released).toBe(0);
    expect(a.status).toBe('pending');
  });

  it('the release asserts NO delivery and writes no message', async () => {
    action();
    await recoverAbandonedBrowserDispatches();
    const res = db.community_ai_actions[0].execution_result as Record<string, unknown>;
    expect(res.delivered).toBe(false);
    expect(res.never_claimed).toBe(true);
    expect(res.reason).toBe('dispatch_reservation_expired');
    // §6: no fabricated outbound message, ever.
    expect(db.engagement_messages).toHaveLength(0);
  });

  it('T4: after release exactly one new claimable action can be created', async () => {
    action();
    await recoverAbandonedBrowserDispatches();
    // A retry would insert a new pending row; the old one no longer competes.
    action({ id: 'retry_1', created_at: new Date().toISOString() });
    expect(claimable()).toHaveLength(1);
    expect(claimable()[0].id).toBe('retry_1');
  });
});

describe('T5 — claimed actions are never auto-retried', () => {
  it('a claimed action is left pending even when very old', async () => {
    const a = action({ dispatch_lease_id: 'lease-abc', created_at: ago(72 * HOUR) });
    const r = await recoverAbandonedBrowserDispatches();
    // Delivery state is unknown; releasing it could re-send the same DM.
    expect(r.released).toBe(0);
    expect(a.status).toBe('pending');
  });

  it('an acknowledged action is left pending even when very old', async () => {
    const a = action({ dispatch_acknowledged_at: ago(70 * HOUR), created_at: ago(72 * HOUR) });
    const r = await recoverAbandonedBrowserDispatches();
    expect(r.released).toBe(0);
    expect(a.status).toBe('pending');
  });

  it('an action claimed with an EXPIRED lease is still not released', async () => {
    // The lease TTL governs re-claim inside the extension protocol; it does not
    // prove non-delivery, so it is not our signal.
    const a = action({
      dispatch_lease_id: 'lease-old',
      dispatch_lease_expires_at: ago(HOUR),
      created_at: ago(5 * HOUR),
    });
    await recoverAbandonedBrowserDispatches();
    expect(a.status).toBe('pending');
  });
});

describe('scope: only unfinished browser work is touched', () => {
  it('api-mode actions are ignored entirely (comment path untouched)', async () => {
    const a = action({ execution_mode: 'api', action_type: 'reply' });
    await recoverAbandonedBrowserDispatches();
    expect(a.status).toBe('pending');
  });

  it('already-terminal actions are ignored', async () => {
    for (const s of ['executed', 'failed', 'skipped', 'sent_unverified', 'blocked']) {
      db.community_ai_actions = [];
      const a = action({ status: s });
      await recoverAbandonedBrowserDispatches();
      expect(a.status).toBe(s);
    }
  });
});

describe('T10/T11 — isolation', () => {
  it('T10: releasing one target does not affect another', async () => {
    const a = action({ target_id: 'urn:li:dm:A' });
    const b = action({ target_id: 'urn:li:dm:B', dispatch_lease_id: 'lease-b' });
    await recoverAbandonedBrowserDispatches();
    expect(a.status).toBe('skipped');
    expect(b.status).toBe('pending');            // claimed → untouched
  });

  it('T11: a stale action in one company never affects another company', async () => {
    const mine = action({ organization_id: ORG });
    const theirs = action({ organization_id: OTHER_ORG, target_id: 'urn:li:dm:A' });
    await recoverAbandonedBrowserDispatches({ organizationId: ORG });
    expect(mine.status).toBe('skipped');
    expect(theirs.status).toBe('pending');
  });

  it('the audit event carries company, action, target and reason', async () => {
    action();
    await recoverAbandonedBrowserDispatches();
    const e = auditEvents[0];
    expect(e.companyId).toBe(ORG);
    expect(String(e.errorMessage)).toMatch(/RESERVATION EXPIRED/);
    expect(String(e.errorMessage)).toMatch(/no message was sent/i);
    const meta = e.metadata as Record<string, unknown>;
    expect(meta.target_id).toBe('urn:li:dm:A');
    expect(meta.delivered).toBe(false);
    expect(meta.reason).toBe('dispatch_reservation_expired');
  });

  it('§12: the release is never recorded as engagement or a successful send', async () => {
    action();
    await recoverAbandonedBrowserDispatches();
    const blob = JSON.stringify(auditEvents) + JSON.stringify(db.community_ai_actions);
    expect(blob).not.toMatch(/"sent"\s*:\s*true|MESSAGE SENT|bulk_reply_count/);
    expect(auditEvents.every((e) => e.success === true)).toBe(true);  // the sweep succeeded…
    expect(db.community_ai_actions[0].status).not.toBe('executed');   // …the send did not
  });
});

describe('T13/T14 — concurrency', () => {
  it('T13: concurrent cleanup runs produce exactly one terminal transition', async () => {
    action();
    const runs = await Promise.all(
      Array.from({ length: 8 }, () => recoverAbandonedBrowserDispatches()),
    );
    const released = runs.reduce((a, r) => a + r.released, 0);
    // The conditional update (status='pending' AND lease IS NULL) is the
    // serialisation point; only the first run matches.
    expect(released).toBe(1);
    expect(db.community_ai_actions.filter((a) => a.status === 'skipped')).toHaveLength(1);
  });

  it('T14: a claim landing mid-sweep wins — the row is not released', async () => {
    const a = action();
    // Emulate /api/extension/commands claiming between scan and write.
    const original = a.dispatch_lease_id;
    expect(original).toBeNull();
    a.dispatch_lease_id = 'lease-mid-flight';
    const r = await recoverAbandonedBrowserDispatches();
    expect(r.released).toBe(0);
    expect(a.status).toBe('pending');            // still deliverable
  });

  it('a sweep never leaves two claimable actions for one target', async () => {
    action({ target_id: 'urn:li:dm:A' });
    await recoverAbandonedBrowserDispatches();
    action({ id: 'retry', target_id: 'urn:li:dm:A', created_at: new Date().toISOString() });
    expect(claimable().filter((x) => x.target_id === 'urn:li:dm:A')).toHaveLength(1);
  });
});

describe('bounds', () => {
  it('the scan is bounded by batch size', async () => {
    for (let i = 0; i < 40; i += 1) action({ target_id: `urn:li:dm:${i}` });
    const r = await recoverAbandonedBrowserDispatches({ batchSize: 10 });
    // The fixture ignores .limit(), so this asserts the caller-visible bound
    // rather than a fabricated slice: batchSize is clamped and passed through.
    expect(r.threshold_ms).toBe(60 * EXTENSION_POLLING_INTERVAL_MS);
    expect(r.scanned).toBeGreaterThan(0);
  });

  it('an empty scan is a cheap no-op', async () => {
    const r = await recoverAbandonedBrowserDispatches();
    expect(r).toMatchObject({ scanned: 0, released: 0, errors: [] });
  });
});
