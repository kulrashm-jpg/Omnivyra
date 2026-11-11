/**
 * report_settings unit 2 (e9 rulings 2026-11-12, BLOCKING data loss): the PROFILE writers.
 *
 * Every profile write used to send the WHOLE report_settings column, built from an earlier read:
 *   - saveProfile's upsert always carried `input.report_settings ?? existing.report_settings`, so every
 *     save (POST /company-profile, forced-context, strategy, problem-transformation, refine) reverted
 *     every key, the 11 system keys included, to that read;
 *   - the base was often getProfile(), which BLANKS competitor fields for display, so persisting it
 *     erased refine's market_pulse competitor_details / quality / alternatives (every report run and
 *     every guidance save did this);
 *   - report runs replaced default_inputs whole, dropping setup-company's industry and
 *     canonical_website_source.
 * Now: the profile upsert never writes report_settings; each writer sends only the keys it owns
 * (REPORT_SETTINGS_OWNERS), in the mode the map gives it (replace / nested / ifAbsent).
 *
 * The fake APPLIES a legacy whole-column write (upsert/update carrying report_settings), as PostgREST
 * would, so the negative control (these writers at origin/main) shows the loss itself.
 */
import { applyMerge } from '../helpers/reportSettingsRpcFake';

type Row = Record<string, unknown> & { report_settings: unknown };
const db = {
  row: null as Row | null,
  wholeColumnWrites: 0,
  rpcCalls: [] as Array<Record<string, unknown>>,
  /** When set, company_profiles READS return this pre-write snapshot; writes land on the live row. */
  staleRead: undefined as Row | null | undefined,
};

function builder(table: string) {
  let write: Record<string, unknown> | null = null;
  const settle = () => {
    if (write) {
      if (table === 'company_profiles') {
        if ('report_settings' in write) db.wholeColumnWrites += 1;
        db.row = { ...(db.row ?? { report_settings: {} }), ...JSON.parse(JSON.stringify(write)) } as Row;
        return { data: JSON.parse(JSON.stringify(db.row)), error: null };
      }
      return { data: null, error: null };
    }
    if (table !== 'company_profiles') return { data: [], error: null };
    const seen = db.staleRead !== undefined ? db.staleRead : db.row;
    return { data: seen ? JSON.parse(JSON.stringify(seen)) : null, error: null };
  };
  const b: any = new Proxy({}, {
    get(_t, prop) {
      if (prop === 'then') return (res: any, rej: any) => Promise.resolve(settle()).then(res, rej);
      if (prop === 'maybeSingle' || prop === 'single') return async () => settle();
      if (prop === 'update' || prop === 'upsert' || prop === 'insert') {
        return (patch: Record<string, unknown>) => { write = patch; return b; };
      }
      return () => b;
    },
  });
  return b;
}
const fakeClient = {
  from: (t: string) => builder(t),
  rpc: async (fn: string, args: Record<string, unknown>) => {
    if (fn !== 'merge_report_settings_keys') return { data: null, error: { code: 'PGRST202', message: fn } };
    db.rpcCalls.push(args);
    return applyMerge(db.row as never, args);
  },
};

jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }));
jest.mock('../../db/supabaseClient', () => ({ __esModule: true, supabase: { from: (t: string) => fakeClient.from(t), rpc: (f: string, a: any) => fakeClient.rpc(f, a) } }));
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => fakeClient.from(t), ownedDbRpc: (f: string, a: any) => fakeClient.rpc(f, a) }));
// Guidance route collaborators: access granted, and getProfile returns what it returns in prod: a
// SANITIZED profile (competitor fields blanked), read before the write.
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('../../services/contentArchitectService', () => ({ resolveCompanyAccess: async () => ({ role: 'ADMIN' }) }));
jest.mock('../../services/companyProfileService', () => {
  const actual = jest.requireActual('../../services/companyProfileService');
  return { ...actual, getProfile: async () => (globalThis as any).__sanitizedProfile() };
});

import {
  REPORT_SETTINGS_KEYS, REPORT_SETTINGS_OWNERS, REPORT_SETTINGS_SYSTEM_KEYS, PROFILE_UI_SUBFIELDS,
  mergeReportSettingsKeys, ReportSettingsWriteError,
} from '../../db/reportSettingsKeys';

/** A company row as the DATABASE holds it: system keys, refine's competitor data, onboarding inputs. */
const STORED = () => ({
  company_id: 'co1',
  name: 'Acme',
  report_settings: {
    orchestration_tasks: [{ id: 't1' }],
    website_fingerprint: { hash: 'h' },
    canonical_understanding: { v: 1 },
    discovered_metadata: { title: 'Acme' },
    market_pulse: {
      business_model: 'b2b',
      exclusions: ['old'],
      named_competitors: ['Globex'],
      competitor_details: [{ name: 'Globex' }],
      competitor_quality: { score: 0.9 },
      market_alternatives: ['Initech'],
    },
    default_inputs: { company_name: 'Acme', industry: 'Robotics', canonical_website_source: 'user_input', competitors: ['Globex'] },
    user_guidance: { messaging: 'keep' },
    company_facts: { team_size: '10', founded_year: '2001' },
  },
});

/** What getProfile() hands a writer: the competitor fields BLANKED for display (Pulse.ts:741). */
const SANITIZED = () => {
  const r = STORED();
  const rs = r.report_settings as any;
  rs.market_pulse = { ...rs.market_pulse, named_competitors: [], competitor_details: null, competitor_quality: null, market_alternatives: null };
  rs.default_inputs = { ...rs.default_inputs, competitors: [] };
  return r;
};

const rs = () => db.row!.report_settings as Record<string, any>;
const expectSystemAndCompetitorDataIntact = () => {
  expect(rs().orchestration_tasks).toEqual([{ id: 't1' }]);
  expect(rs().website_fingerprint).toEqual({ hash: 'h' });
  expect(rs().canonical_understanding).toEqual({ v: 1 });
  expect(rs().discovered_metadata).toEqual({ title: 'Acme' });
  expect(rs().market_pulse.competitor_details).toEqual([{ name: 'Globex' }]);
  expect(rs().market_pulse.competitor_quality).toEqual({ score: 0.9 });
  expect(rs().market_pulse.market_alternatives).toEqual(['Initech']);
  expect(rs().market_pulse.named_competitors).toEqual(['Globex']);
};

beforeEach(() => {
  db.row = STORED() as Row;
  db.wholeColumnWrites = 0;
  db.rpcCalls = [];
  db.staleRead = undefined;
});

describe('the ownership map (e9 D1: one function, per-writer key sets, pinned)', () => {
  const entries = Object.entries(REPORT_SETTINGS_OWNERS) as Array<[string, Record<string, string>]>;
  it('every allow-listed key has at least one owner, and no writer owns an unknown key', () => {
    const owned = new Set(entries.flatMap(([, keys]) => Object.keys(keys)));
    expect([...owned].sort()).toEqual([...REPORT_SETTINGS_KEYS].sort());
  });
  it('at most ONE writer may `replace` any key (shared keys are nested or ifAbsent)', () => {
    const replacers: Record<string, string[]> = {};
    for (const [w, keys] of entries) for (const [k, m] of Object.entries(keys)) if (m === 'replace') (replacers[k] ??= []).push(w);
    expect(Object.entries(replacers).filter(([, ws]) => ws.length > 1)).toEqual([]);
  });
  it('profile writers own NO system key, except onboarding filling discovered_metadata ifAbsent', () => {
    const profileWriters = ['profile_ui', 'profile_guidance', 'profile_refine', 'report_run', 'onboarding_create'];
    const hits = entries.filter(([w]) => profileWriters.includes(w))
      .flatMap(([w, keys]) => Object.entries(keys).filter(([k]) => (REPORT_SETTINGS_SYSTEM_KEYS as readonly string[]).includes(k)).map(([k, m]) => `${w}:${k}:${m}`));
    expect(hits).toEqual(['onboarding_create:discovered_metadata:ifAbsent']);
  });
  it('refine no longer owns canonical_understanding (e9 D4: the shadow job is its sole writer)', () => {
    expect(Object.keys(REPORT_SETTINGS_OWNERS.profile_refine)).not.toContain('canonical_understanding');
    const writers = entries.filter(([, keys]) => 'canonical_understanding' in keys).map(([w]) => w);
    expect(writers).toEqual(['canonical_shadow']);
  });
  it('the map is pinned: a new writer, key or mode is a visible, reviewed change', () => {
    expect(REPORT_SETTINGS_OWNERS).toEqual({
      orchestration_ledger: { orchestration_tasks: 'replace' },
      agent_state: { agent_checkpoints: 'replace' },
      knowledge_version: { knowledge_version: 'replace', refresh_history: 'replace' },
      knowledge_snapshot: { knowledge_snapshots: 'replace', knowledge_rollbacks: 'replace' },
      website_fingerprint: { website_fingerprint: 'replace' },
      activation_latch: { activation_latch: 'replace' },
      incremental_metadata: { discovered_metadata: 'replace' },
      canonical_shadow: { canonical_understanding: 'replace' },
      company_bootstrap: { bootstrap: 'replace', discovered_metadata: 'ifAbsent' },
      profile_ui: { company_facts: 'nested', profile_review: 'replace', market_pulse: 'nested', intelligence: 'nested' },
      profile_guidance: { user_guidance: 'replace' },
      profile_refine: { entity_archetype: 'replace', competitor_intelligence: 'replace', industry_review: 'replace', market_pulse: 'nested' },
      report_run: { default_inputs: 'nested', integrations: 'replace', last_report_source: 'replace', last_uploaded_file_name: 'replace', report_input_observation: 'replace', updated_at: 'replace' },
      onboarding_create: { default_inputs: 'nested', market_pulse: 'nested', company_facts: 'nested', profile_review: 'ifAbsent', discovered_metadata: 'ifAbsent' },
    });
  });
  it('a writer sending a key it does not own is refused BEFORE any database call', async () => {
    await expect(mergeReportSettingsKeys('co1', 'report_run', { market_pulse: {} } as never)).rejects.toBeInstanceOf(ReportSettingsWriteError);
    await expect(mergeReportSettingsKeys('co1', 'profile_ui', { orchestration_tasks: [] } as never)).rejects.toThrow(/does not own/);
    expect(db.rpcCalls).toHaveLength(0);
  });
  it('a nested key with a non-object value is refused before any call', async () => {
    await expect(mergeReportSettingsKeys('co1', 'profile_ui', { market_pulse: ['x'] })).rejects.toThrow(/must be objects/);
    expect(db.rpcCalls).toHaveLength(0);
  });
});

describe('the profile upsert never writes report_settings (P1: the choke point)', () => {
  it('a STALE, sanitized report_settings in a save payload leaves every stored key intact', async () => {
    const { upsertCompanyProfilePayload } = await import('../../services/companyProfileServiceRest1Rest2Pulse');
    const stale = SANITIZED();
    (stale.report_settings as any).orchestration_tasks = []; // the read predates a ledger write
    const { error } = await upsertCompanyProfilePayload({ ...stale, name: 'Acme Corp' }, STORED() as never, 'save');
    expect(error).toBeNull();
    expect(db.row!.name).toBe('Acme Corp');      // the columns ARE written
    expectSystemAndCompetitorDataIntact();       // the property, asserted FIRST (the control fails here)
    expect(db.wholeColumnWrites).toBe(0);        // and the mechanism: report_settings is NOT written
  });
});

describe('POST /api/company-profile: only UI-owned sub-fields are written (e9 D2)', () => {
  it('the whitelist drops system keys, response-only fields, user_guidance and blanked competitor fields', async () => {
    const { buildProfileUiReportSettingsPatch } = await import('../../services/companyProfile/governance');
    const posted = SANITIZED().report_settings as any;
    posted.market_pulse = { ...posted.market_pulse, exclusions: ['new'], unified_competitor_intelligence: { x: 1 } };
    posted.intelligence = { primary_objective: 'grow', injected: 'no' };
    const patch = buildProfileUiReportSettingsPatch({ existingReportSettings: STORED().report_settings as never, incomingReportSettings: posted, confirmedByRole: null });
    expect(Object.keys(patch).sort()).toEqual(['company_facts', 'intelligence', 'market_pulse', 'profile_review']);
    expect(Object.keys(patch.market_pulse as object).sort()).toEqual(['business_model', 'exclusions']);
    expect(patch.intelligence).toEqual({ primary_objective: 'grow' });
    for (const k of Object.keys(patch.company_facts as object)) {
      expect([...PROFILE_UI_SUBFIELDS.company_facts, 'updated_at']).toContain(k);
    }
  });

  it('a stale profile save leaves system keys and competitor data intact; the edit lands', async () => {
    const { buildProfileUiReportSettingsPatch } = await import('../../services/companyProfile/governance');
    const posted = SANITIZED().report_settings as any;
    posted.market_pulse.exclusions = ['new'];
    const patch = buildProfileUiReportSettingsPatch({ existingReportSettings: SANITIZED().report_settings as never, incomingReportSettings: posted, confirmedByRole: null });
    expect(await mergeReportSettingsKeys('co1', 'profile_ui', patch)).toBe(true);
    expectSystemAndCompetitorDataIntact();
    expect(rs().market_pulse.exclusions).toEqual(['new']);
    expect(rs().user_guidance).toEqual({ messaging: 'keep' });
    expect(rs().default_inputs.industry).toBe('Robotics');
  });
});

describe('report runs (W5): competitor data and onboarding inputs survive', () => {
  const input = (profile: unknown) => ({
    companyId: 'co1',
    reportCategory: 'snapshot',
    profile,
    integrations: { google_analytics: { connected: true }, website_crawl: { connected: false } },
    resolved: {
      companyName: 'Acme GmbH', websiteDomain: 'acme.com', businessType: 'B2B', geography: 'DE',
      socialLinks: [], competitors: ['Globex', 'Initech'], source: 'manual', uploadedFileName: null,
    },
  }) as never;

  it('a report run from a SANITIZED read leaves competitor_details, default_inputs.industry and canonical_website_source intact', async () => {
    const { persistReportInputsWithoutProfileMutation } = await import('../../services/reportInputResolver');
    await persistReportInputsWithoutProfileMutation(input(SANITIZED()));
    expect(rs().default_inputs.industry).toBe('Robotics');
    expect(rs().default_inputs.canonical_website_source).toBe('user_input');
    expectSystemAndCompetitorDataIntact();
    expect(db.wholeColumnWrites).toBe(0);
    expect(rs().default_inputs.company_name).toBe('Acme GmbH');      // its own sub-field lands
    expect(rs().integrations).toEqual({ google_analytics: true, website_crawl: false });
    expect(rs().report_input_observation).toBeTruthy();
  });
  it('writes no profile COLUMN at all, and never creates a row', async () => {
    const { persistReportInputsWithoutProfileMutation } = await import('../../services/reportInputResolver');
    const before = { ...db.row };
    await persistReportInputsWithoutProfileMutation(input(SANITIZED()));
    for (const k of Object.keys(before)) if (k !== 'report_settings') expect(db.row![k]).toEqual(before[k]);
    db.row = null;
    await persistReportInputsWithoutProfileMutation(input(null));
    expect(db.row).toBeNull();
  });
});

describe('concurrent NESTED writers to market_pulse (e9 D2)', () => {
  it('profile UI and refine, each from a stale read, write different sub-fields: BOTH survive', async () => {
    await mergeReportSettingsKeys('co1', 'profile_refine', { market_pulse: { competitor_details: [{ name: 'Hooli' }] } });
    await mergeReportSettingsKeys('co1', 'profile_ui', { market_pulse: { exclusions: ['ui'] } });
    expect(rs().market_pulse.competitor_details).toEqual([{ name: 'Hooli' }]);
    expect(rs().market_pulse.exclusions).toEqual(['ui']);
    expect(rs().market_pulse.business_model).toBe('b2b');
  });
});

describe('POST /api/company-profile/guidance (W3): writes ONLY user_guidance', () => {
  beforeAll(() => { (globalThis as any).__sanitizedProfile = () => SANITIZED(); });
  const call = async (body: Record<string, unknown>) => {
    const handler = (await import('../../../pages/api/company-profile/guidance')).default as any;
    const out: { status?: number; body?: any } = {};
    const res: any = { status(c: number) { out.status = c; return res; }, json(b: unknown) { out.body = b; return res; } };
    await handler({ method: 'POST', body, query: {} }, res);
    return out;
  };
  it('a guidance save from a SANITIZED read leaves competitor data and system keys intact', async () => {
    const r = await call({ companyId: 'co1', user_guidance: { messaging: 'new' }, action: 'update_guidance' });
    expect(r.status).toBe(200);
    expectSystemAndCompetitorDataIntact();
    expect(db.wholeColumnWrites).toBe(0);
    expect(rs().user_guidance).toBeTruthy();
    expect(rs().user_guidance).not.toEqual({ messaging: 'keep' });
  });
});
