/**
 * reportSettingsKeys.ts — THE way code reads and writes company_profiles.report_settings
 * (e9 rulings 2026-11-12: BLOCKING data loss; unit 1 = system writers, unit 2 = profile writers).
 *
 * report_settings is ONE JSONB column shared by many independent writers. Each used to do a
 * read-modify-write of the WHOLE column, which lost data three ways:
 *   1. a failed read ({data: null, error}: the client never throws) became `{}`, and the write
 *      `{ ...{}, my_key }` REPLACED the column: every other key of the company was wiped;
 *   2. two writers of DIFFERENT keys racing: the later whole-column write dropped the earlier key;
 *   3. a writer whose base was a SANITIZED read (getProfile strips competitor fields for display)
 *      persisted the sanitized copy, erasing data another writer owned.
 *
 * Writes now go through the database function merge_report_settings_keys (migration
 * 20270217000000): one statement, only the named keys, and per key one of
 *   replace  — the key's value is replaced wholesale;
 *   nested   — merged ONE level deep (stored->k || patch->k): only the patched sub-fields change;
 *   ifAbsent — written only where the stored row lacks the key.
 * The MODE is not chosen by the caller: it comes from REPORT_SETTINGS_OWNERS, the per-writer
 * ownership map below. A writer may only send the keys it owns; mergeReportSettingsKeys refuses
 * anything else BEFORE any database call. Reads are CHECKED: an unreadable column throws
 * ReportSettingsUnreadableError; it is never answered as `{}`.
 *
 * STATED CONTRACTS (pinned by backend/tests/unit/reportSettingsKeyMerge.test.ts):
 *   - REPORT_SETTINGS_KEYS equals the migration's c_allowed list (parsed from the SQL);
 *   - every allowed key has at least one owner, and at most ONE writer may `replace` a key
 *     (two replacers of one key would be last-writer-wins on the whole value);
 *   - the ownership map itself is pinned, so a new writer or key is a visible, reviewed change.
 * Adding a key means a NEW migration (CREATE OR REPLACE with the longer list) AND this file, together.
 *
 * Still NOT protected: two writers of the same key or sub-field each compute its value from their
 * own read, so the later one wins for THAT value (e.g. two concurrent upserts into
 * orchestration_tasks; profile UI vs refine on the market_pulse sub-fields both own). It never
 * touches other keys or other sub-fields.
 */

/**
 * The shared client is loaded LAZILY, so pure modules (e.g. canonicalShadowJob, whose seam injects its
 * own client) can import this file without loading the database client.
 */
async function defaultClient(): Promise<ReportSettingsClient> {
  return (await import('./supabaseClient')).supabase as unknown as ReportSettingsClient;
}

export const MERGE_REPORT_SETTINGS_RPC = 'merge_report_settings_keys';

/** The SYSTEM-owned keys (sorted): written only by background/system code, never by profile paths. */
export const REPORT_SETTINGS_SYSTEM_KEYS = [
  'activation_latch',
  'agent_checkpoints',
  'bootstrap',
  'canonical_understanding',
  'discovered_metadata',
  'knowledge_rollbacks',
  'knowledge_snapshots',
  'knowledge_version',
  'orchestration_tasks',
  'refresh_history',
  'website_fingerprint',
] as const;

/** The PROFILE keys (sorted): written by the profile UI, refine, guidance, report runs, onboarding. */
export const REPORT_SETTINGS_PROFILE_KEYS = [
  'company_facts',
  'competitor_intelligence',
  'default_inputs',
  'entity_archetype',
  'industry_review',
  'integrations',
  'intelligence',
  'last_report_source',
  'last_uploaded_file_name',
  'market_pulse',
  'profile_review',
  'report_input_observation',
  'updated_at',
  'user_guidance',
] as const;

/** Every key the merge function accepts (sorted) — must equal the migration's c_allowed. */
export const REPORT_SETTINGS_KEYS = [...REPORT_SETTINGS_SYSTEM_KEYS, ...REPORT_SETTINGS_PROFILE_KEYS].sort() as Array<
  (typeof REPORT_SETTINGS_SYSTEM_KEYS)[number] | (typeof REPORT_SETTINGS_PROFILE_KEYS)[number]
>;

export type ReportSettingsSystemKey = (typeof REPORT_SETTINGS_SYSTEM_KEYS)[number];
export type ReportSettingsProfileKey = (typeof REPORT_SETTINGS_PROFILE_KEYS)[number];
export type ReportSettingsKey = ReportSettingsSystemKey | ReportSettingsProfileKey;
export type ReportSettingsPatch = Partial<Record<ReportSettingsKey, unknown>>;
export type ReportSettingsWriteMode = 'replace' | 'nested' | 'ifAbsent';

/**
 * WHO may write WHICH key, and HOW. One owner per key, except where writers legitimately share a
 * key: then they share it `nested` (each sends only its own sub-fields) or a creator fills it
 * `ifAbsent`. Never two `replace` owners of one key.
 */
export const REPORT_SETTINGS_OWNERS = {
  // ── system writers (unit 1) ──
  orchestration_ledger: { orchestration_tasks: 'replace' },
  agent_state: { agent_checkpoints: 'replace' },
  knowledge_version: { knowledge_version: 'replace', refresh_history: 'replace' },
  knowledge_snapshot: { knowledge_snapshots: 'replace', knowledge_rollbacks: 'replace' },
  website_fingerprint: { website_fingerprint: 'replace' },
  activation_latch: { activation_latch: 'replace' },
  incremental_metadata: { discovered_metadata: 'replace' },
  canonical_shadow: { canonical_understanding: 'replace' },
  company_bootstrap: { bootstrap: 'replace', discovered_metadata: 'ifAbsent' },
  // ── profile writers (unit 2) ──
  /** POST /api/company-profile (and the refine route's pre-save): UI-owned sub-fields only. */
  profile_ui: { company_facts: 'nested', profile_review: 'replace', market_pulse: 'nested', intelligence: 'nested' },
  profile_guidance: { user_guidance: 'replace' },
  profile_refine: { entity_archetype: 'replace', competitor_intelligence: 'replace', industry_review: 'replace', market_pulse: 'nested' },
  report_run: {
    default_inputs: 'nested', integrations: 'replace', last_report_source: 'replace',
    last_uploaded_file_name: 'replace', report_input_observation: 'replace', updated_at: 'replace',
  },
  /** setup-company: the initial create. Shares by nesting / filling, never replaces another's key. */
  onboarding_create: {
    default_inputs: 'nested', market_pulse: 'nested', company_facts: 'nested',
    profile_review: 'ifAbsent', discovered_metadata: 'ifAbsent',
  },
} as const satisfies Record<string, Partial<Record<ReportSettingsKey, ReportSettingsWriteMode>>>;

export type ReportSettingsWriter = keyof typeof REPORT_SETTINGS_OWNERS;
/** The patch a given writer may send: exactly its owned keys, all optional. */
export type ReportSettingsPatchFor<W extends ReportSettingsWriter> = Partial<Record<keyof (typeof REPORT_SETTINGS_OWNERS)[W], unknown>>;

/**
 * The market_pulse / intelligence / company_facts sub-fields the profile UI edits
 * (hooks/useCompanyProfileState.tsx handleMarketPulseSetting*, handleIntelligenceSettingChange,
 * handleCompanyFactChange). POST /api/company-profile takes ONLY these from a body; everything else in
 * a posted report_settings (system keys, response-only fields such as
 * market_pulse.unified_competitor_intelligence, competitor fields blanked by the read sanitizer) is ignored.
 */
export const PROFILE_UI_SUBFIELDS = {
  market_pulse: [
    'business_model', 'provider_type', 'domain_role', 'operating_model',
    'primary_operating_markets', 'target_expansion_markets', 'solution_domains', 'core_offerings',
    'growth_priorities', 'partnership_priorities', 'critical_hiring_functions',
    'regulatory_policy_sensitivity', 'default_categories', 'exclusions', 'preferred_regions',
  ],
  intelligence: ['primary_objective', 'primary_target_metric', 'target_value', 'time_horizon', 'target_note'],
  company_facts: ['team_size', 'founded_year', 'revenue_range'],
} as const;

/** The company_profiles read FAILED: report_settings is UNKNOWN, not empty. */
export class ReportSettingsUnreadableError extends Error {
  constructor(readonly companyId: string, readonly detail: string) {
    super(`report_settings unreadable for ${companyId}: ${detail}`);
    this.name = 'ReportSettingsUnreadableError';
  }
}

/** The merge did not happen, or its outcome is unknown. Never treat as written. */
export class ReportSettingsWriteError extends Error {
  constructor(readonly companyId: string, readonly detail: string) {
    super(`report_settings key merge failed for ${companyId}: ${detail}`);
    this.name = 'ReportSettingsWriteError';
  }
}

/** The minimal client surface used here (the shared client, or an injected one in a seam). */
export interface ReportSettingsClient {
  from: (table: string) => any;
  rpc: (fn: string, args: Record<string, unknown>) => any;
}

export interface CheckedReportSettings {
  /** false = no company_profiles row for this company (a genuine absence, not an error). */
  exists: boolean;
  /** {} when the row is absent or the column is NULL / not an object. */
  settings: Record<string, unknown>;
}

function errorText(error: { code?: string; message?: string } | null | undefined): string {
  return `${error?.code ?? 'error'}: ${error?.message ?? 'no message'}`;
}

/**
 * CHECKED read. Throws ReportSettingsUnreadableError on a read error. A missing row is
 * { exists: false, settings: {} }; it is the ONLY way this answers "nothing there".
 */
export async function readReportSettingsChecked(
  companyId: string,
  client?: ReportSettingsClient,
): Promise<CheckedReportSettings> {
  const { data, error } = await (client ?? (await defaultClient()))
    .from('company_profiles')
    .select('report_settings')
    .eq('company_id', companyId)
    .maybeSingle();
  if (error) throw new ReportSettingsUnreadableError(companyId, errorText(error));
  if (!data) return { exists: false, settings: {} };
  const rs = (data as { report_settings?: unknown }).report_settings;
  const settings = rs && typeof rs === 'object' && !Array.isArray(rs) ? (rs as Record<string, unknown>) : {};
  return { exists: true, settings };
}

/** Keeps only the listed sub-fields of an object value (undefined when nothing is left). */
export function pickSubfields(value: unknown, allowed: readonly string[]): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const out: Record<string, unknown> = {};
  for (const k of allowed) {
    if (Object.prototype.hasOwnProperty.call(value, k) && (value as Record<string, unknown>)[k] !== undefined) {
      out[k] = (value as Record<string, unknown>)[k];
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Write the keys `writer` owns, server-side, in one statement, each in the mode the ownership map
 * gives it. Returns true when a company_profiles row was written, false when there is no row.
 * THROWS ReportSettingsWriteError when the database refused or the outcome is unknown (a missing
 * row count is "no answer", never "written"), and BEFORE any call for a key the writer does not own,
 * a `nested` value that is not an object, or an empty patch. Undefined values are dropped first.
 */
export async function mergeReportSettingsKeys<W extends ReportSettingsWriter>(
  companyId: string,
  writer: W,
  patch: ReportSettingsPatchFor<W>,
  opts: { updatedAt?: string | null; client?: ReportSettingsClient } = {},
): Promise<boolean> {
  if (!companyId) throw new ReportSettingsWriteError(String(companyId), 'companyId is required');
  const owned = REPORT_SETTINGS_OWNERS[writer] as Record<string, ReportSettingsWriteMode> | undefined;
  if (!owned) throw new ReportSettingsWriteError(companyId, `unknown writer: ${String(writer)}`);
  const clean = Object.fromEntries(Object.entries(patch as Record<string, unknown>).filter(([, v]) => v !== undefined));
  const keys = Object.keys(clean);
  if (keys.length === 0) throw new ReportSettingsWriteError(companyId, 'empty patch');
  const notOwned = keys.filter((k) => !(k in owned)).sort();
  if (notOwned.length > 0) {
    throw new ReportSettingsWriteError(companyId, `writer ${String(writer)} does not own: ${notOwned.join(', ')}`);
  }
  const nested = keys.filter((k) => owned[k] === 'nested');
  const ifAbsent = keys.filter((k) => owned[k] === 'ifAbsent');
  const badNested = nested.filter((k) => !clean[k] || typeof clean[k] !== 'object' || Array.isArray(clean[k]));
  if (badNested.length > 0) {
    throw new ReportSettingsWriteError(companyId, `nested values must be objects: ${badNested.sort().join(', ')}`);
  }
  const client = opts.client ?? (await defaultClient());
  const { data, error } = await client.rpc(MERGE_REPORT_SETTINGS_RPC, {
    p_company_id: companyId,
    p_patch: clean,
    p_updated_at: opts.updatedAt ?? null,
    p_if_absent: ifAbsent.length > 0 ? ifAbsent : null,
    p_merge_nested: nested.length > 0 ? nested : null,
  });
  if (error) throw new ReportSettingsWriteError(companyId, errorText(error));
  if (typeof data !== 'number') throw new ReportSettingsWriteError(companyId, `no row count returned (${JSON.stringify(data)})`);
  return data > 0;
}
