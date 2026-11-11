/**
 * report_settings unit 1 (e9 ruling 2026-11-12: BLOCKING data loss).
 *
 * company_profiles.report_settings is ONE JSONB column shared by many writers. Each system writer used
 * to read the column client-side and write `{ ...read, my_key }` back over the WHOLE column, so
 *   (1) a FAILED read ({data: null, error}; the client never throws) became `{}` and the write wiped
 *       every other key of the company, and
 *   (2) two writers of different keys racing lost the earlier key.
 * Writes now go through merge_report_settings_keys (one statement, only the named keys).
 *
 * The fake below can do BOTH kinds of write: a legacy whole-column `.update({report_settings})` is
 * APPLIED (as PostgREST would), and the rpc is the faithful mirror of the SQL. So the negative control
 * (these writers at origin/main) shows the wipe for real instead of failing on a missing method.
 */
import { applyMerge, migrationAllowList } from '../helpers/reportSettingsRpcFake';

type Row = { report_settings: unknown; updated_at?: string | null };
const db = {
  row: null as Row | null,
  readError: null as null | { code: string; message: string },
  wholeColumnWrites: 0,
  rpcPatches: [] as Array<Record<string, unknown>>,
  /** When set, every company_profiles READ returns this snapshot (taken before a concurrent write),
   *  while writes land on the live `row`: a real stale read, not a timing trick. */
  staleRead: undefined as Row | null | undefined,
};

/** A chainable PostgREST-like builder over the single company_profiles row (other tables: one hit). */
function builder(table: string) {
  let pendingUpdate: Record<string, unknown> | null = null;
  const settle = () => {
    if (pendingUpdate) {
      if (table === 'company_profiles' && db.row) {
        if ('report_settings' in pendingUpdate) db.wholeColumnWrites += 1;
        Object.assign(db.row, JSON.parse(JSON.stringify(pendingUpdate)));
        return { data: [{ company_id: 'co1' }], error: null };
      }
      return { data: [], error: null };
    }
    if (table !== 'company_profiles') return { data: [{ id: 'x' }], error: null };
    if (db.readError) return { data: null, error: db.readError };
    const seen = db.staleRead !== undefined ? db.staleRead : db.row;
    return { data: seen ? JSON.parse(JSON.stringify(seen)) : null, error: null };
  };
  const b: any = new Proxy({}, {
    get(_t, prop) {
      if (prop === 'then') return (res: any, rej: any) => Promise.resolve(settle()).then(res, rej);
      if (prop === 'maybeSingle' || prop === 'single') return async () => settle();
      if (prop === 'update') return (patch: Record<string, unknown>) => { pendingUpdate = patch; return b; };
      return () => b;
    },
  });
  return b;
}
const fakeClient = {
  from: (t: string) => builder(t),
  rpc: async (fn: string, args: Record<string, unknown>) => {
    if (fn !== 'merge_report_settings_keys') return { data: null, error: { code: 'PGRST202', message: fn } };
    db.rpcPatches.push(args.p_patch as Record<string, unknown>);
    return applyMerge(db.row, args);
  },
};

jest.mock('../../db/supabaseClient', () => ({ supabase: { from: (t: string) => fakeClient.from(t), rpc: (f: string, a: any) => fakeClient.rpc(f, a) } }));
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => fakeClient.from(t), ownedDbRpc: (f: string, a: any) => fakeClient.rpc(f, a) }));
jest.mock('../../services/logger', () => ({ logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() } }));
jest.mock('../../services/cms/registry', () => ({ listCmsProviders: () => ['wordpress'] }));

import {
  REPORT_SETTINGS_SYSTEM_KEYS, readReportSettingsChecked, mergeReportSettingsKeys,
  ReportSettingsUnreadableError, ReportSettingsWriteError,
} from '../../db/reportSettingsKeys';
import { upsertTasks } from '../../services/orchestration/orchestrationLedgerStore';
import { reportSettingsAgentStore } from '../../services/aiAgent/agentStateStore';
import { recordRefresh } from '../../services/crawl/knowledgeVersionStore';
import { appendRollback, writeSnapshots } from '../../services/knowledge/knowledgeSnapshotStore';
import { saveWebsiteFingerprint } from '../../services/crawl/fingerprintStore';
import { buildActivationReadiness } from '../../services/activationReadinessService';
import { refreshDiscoveredMetadata } from '../../services/crawl/incrementalMetadataStore';
import { makeSupabaseShadowDeps } from '../../services/companyIntelligence/production/canonicalShadowJob';
import { bootstrapCompanyProfile } from '../../services/companyBootstrapService';

const SIBLINGS = { brand_voice: { tone: 'warm' }, user_report_pref: 42, market_pulse: { keep: true } }; // owned by none of these writers
const NOW = '2026-11-12T00:00:00.000Z';
const READ_FAILS = { code: '57014', message: 'canceling statement due to statement timeout' };
const flush = () => new Promise((r) => setImmediate(r));

beforeEach(() => {
  db.row = { report_settings: JSON.parse(JSON.stringify(SIBLINGS)), updated_at: null };
  db.readError = null;
  db.wholeColumnWrites = 0;
  db.rpcPatches = [];
  db.staleRead = undefined;
});

const settings = () => db.row!.report_settings as Record<string, unknown>;
const expectSiblingsIntact = () => {
  expect(settings()).toMatchObject(SIBLINGS);
  expect(db.wholeColumnWrites).toBe(0);
};

const checkpoint = (runId: string) => ({ runId, state: 'RUNNING', executionMetadata: { updatedAt: NOW } }) as any;
const META = { title: 't', description: 'd', siteName: 's', language: 'en', country: 'US', brandColor: null, keywords: [], openGraph: {}, logoUrl: null, faviconUrl: null } as any;

/** Every class-A writer, driven once. `reads` = it reads report_settings before writing. */
const WRITERS: Array<[string, boolean, () => Promise<unknown>]> = [
  ['orchestrationLedgerStore.upsertTasks', true, () => upsertTasks('co1', [{ id: 't1', state: 'PENDING', priority: 1 } as any], NOW)],
  ['agentStateStore.save', true, () => reportSettingsAgentStore.save('co1', checkpoint('r1'))],
  ['knowledgeVersionStore.recordRefresh', true, () => recordRefresh({ companyId: 'co1', createVersion: true, refreshReason: 'x', action: 'REFRESH_FULL' as any, verdict: null, affectedSections: [], historyLimit: 5, now: NOW })],
  ['knowledgeSnapshotStore.appendRollback', true, () => appendRollback('co1', { at: NOW, fromVersion: 1, targetVersion: 1, reason: 'x', validated: true }, NOW)],
  ['knowledgeSnapshotStore.writeSnapshots', false, () => writeSnapshots('co1', [], NOW)],
  ['fingerprintStore.saveWebsiteFingerprint', false, () => saveWebsiteFingerprint('co1', { hash: 'h' } as any)],
  ['activationReadinessService latch', true, async () => { await buildActivationReadiness('co1'); await flush(); await flush(); }],
  ['incrementalMetadataStore.refreshDiscoveredMetadata', false, () => refreshDiscoveredMetadata('co1', META, NOW)],
  ['canonicalShadowJob deps', true, async () => {
    const deps = makeSupabaseShadowDeps(fakeClient);
    const rs = await deps.readReportSettings('co1');
    await deps.writeReportSettings('co1', { ...(rs ?? {}), canonical_understanding: { v: 1 } });
  }],
];

describe('the allow-list is ONE contract across SQL and TS', () => {
  it('REPORT_SETTINGS_SYSTEM_KEYS equals the migration c_allowed list', () => {
    expect([...REPORT_SETTINGS_SYSTEM_KEYS]).toEqual(migrationAllowList());
  });
});

describe.each(WRITERS)('%s', (_name, reads, run) => {
  it('a FAILED read never touches any other key (and never writes the whole column)', async () => {
    db.readError = READ_FAILS;
    await run().catch(() => undefined);
    expectSiblingsIntact();
    if (reads) expect(db.rpcPatches).toHaveLength(0); // it refused to write from an unread column
  });

  it('a readable column: writes ONLY its own keys, server-side; siblings intact', async () => {
    await run();
    expectSiblingsIntact();
    expect(db.rpcPatches.length).toBeGreaterThan(0);
    for (const p of db.rpcPatches) {
      for (const k of Object.keys(p)) expect(REPORT_SETTINGS_SYSTEM_KEYS as readonly string[]).toContain(k);
    }
  });

  it('a key landed by ANOTHER writer after this one read survives (no lost update)', async () => {
    // Every read returns the snapshot taken BEFORE the concurrent write lands...
    db.staleRead = JSON.parse(JSON.stringify(db.row));
    // ...while the stored row already carries the concurrent key.
    (db.row!.report_settings as Record<string, unknown>).concurrent_key = 'landed';
    await run();
    expect(settings().concurrent_key).toBe('landed');
    expectSiblingsIntact();
  });
});

describe('bootstrap (reads the profile CHECKED already; now writes its keys server-side)', () => {
  it('owned keys merge server-side; a concurrent key survives; columns written without report_settings', async () => {
    db.row = { ...(db.row as Row), company_id: 'co1', name: 'Acme', website_url: null, logo_url: null } as any;
    db.staleRead = JSON.parse(JSON.stringify(db.row)); // bootstrap's read predates the concurrent write
    const client = fakeClient;
    (db.row!.report_settings as Record<string, unknown>).concurrent_key = 'landed';
    const r = await bootstrapCompanyProfile('co1', { supabase: client as never, verifiedWebsite: 'https://acme.com', now: NOW });
    expect(r.ok).toBe(true);
    expect(settings().concurrent_key).toBe('landed');
    expect(settings().bootstrap).toBeTruthy();
    expectSiblingsIntact();
  });
});

describe('discovered_metadata has ONE replacer (e9 2026-11-12): bootstrap only fills a hole', () => {
  it('a bundle landed by incrementalMetadataStore after bootstrap read "absent" is NOT overwritten', async () => {
    db.row = { ...(db.row as Row), company_id: 'co1', name: 'Acme', website_url: 'https://acme.com' } as any;
    db.staleRead = JSON.parse(JSON.stringify(db.row)); // bootstrap's read predates the concurrent write
    const client = fakeClient;
    (db.row!.report_settings as Record<string, unknown>).discovered_metadata = { from: 'incremental' };
    const r = await bootstrapCompanyProfile('co1', { supabase: client as never, discovered: META, verifiedWebsite: 'https://acme.com', now: NOW });
    expect(r.ok).toBe(true);
    expect(settings().discovered_metadata).toEqual({ from: 'incremental' });
    expect(settings().bootstrap).toBeTruthy();
  });
  it('ifAbsent naming a key outside the patch throws before any call', async () => {
    await expect(mergeReportSettingsKeys('co1', { bootstrap: {} }, { ifAbsent: ['discovered_metadata'] })).rejects.toThrow(/not in the patch/);
    expect(db.rpcPatches).toHaveLength(0);
  });
});

describe('the shared helper', () => {
  it('a read error THROWS a named error (never `{}`)', async () => {
    db.readError = READ_FAILS;
    await expect(readReportSettingsChecked('co1')).rejects.toBeInstanceOf(ReportSettingsUnreadableError);
  });
  it('an absent row is { exists: false, settings: {} }; a non-object column reads as {}', async () => {
    db.row = null;
    await expect(readReportSettingsChecked('co1')).resolves.toEqual({ exists: false, settings: {} });
    db.row = { report_settings: [1, 2] };
    await expect(readReportSettingsChecked('co1')).resolves.toEqual({ exists: true, settings: {} });
  });
  it('a key outside the allow-list throws BEFORE any database call', async () => {
    await expect(mergeReportSettingsKeys('co1', { brand_voice: 'x' } as never)).rejects.toBeInstanceOf(ReportSettingsWriteError);
    expect(db.rpcPatches).toHaveLength(0);
  });
  it('an empty patch throws; no row is false; a written row is true', async () => {
    await expect(mergeReportSettingsKeys('co1', {})).rejects.toBeInstanceOf(ReportSettingsWriteError);
    db.row = null;
    await expect(mergeReportSettingsKeys('co1', { bootstrap: {} })).resolves.toBe(false);
    db.row = { report_settings: {} };
    await expect(mergeReportSettingsKeys('co1', { bootstrap: {} })).resolves.toBe(true);
  });
  it('a database refusal and a MISSING row count are both errors, never "written"', async () => {
    const refusing = { from: fakeClient.from, rpc: async () => ({ data: null, error: { code: '42501', message: 'permission denied' } }) };
    await expect(mergeReportSettingsKeys('co1', { bootstrap: {} }, { client: refusing })).rejects.toThrow(/42501/);
    const blank = { from: fakeClient.from, rpc: async () => ({ data: null, error: null }) }; // postgrest-js 204 rewrite
    await expect(mergeReportSettingsKeys('co1', { bootstrap: {} }, { client: blank })).rejects.toThrow(/no row count/);
  });
  it('a stored non-object report_settings is refused by the merge (22023), not concatenated', async () => {
    db.row = { report_settings: ['legacy'] };
    await expect(mergeReportSettingsKeys('co1', { bootstrap: {} })).rejects.toThrow(/22023/);
    expect(db.row.report_settings).toEqual(['legacy']);
  });
});
