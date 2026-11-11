/**
 * reportSettingsKeys.ts — THE way system code reads and writes company_profiles.report_settings
 * (e9 ruling 2026-11-12: BLOCKING data loss, unit 1).
 *
 * report_settings is ONE JSONB column shared by many independent writers. Each used to do a
 * client-side read-modify-write of the WHOLE column, which lost data two ways:
 *   1. a failed read ({data: null, error}: the client never throws) became `{}`, and the write
 *      `{ ...{}, my_key }` REPLACED the column: every other key of the company was wiped;
 *   2. two writers of DIFFERENT keys racing: the later whole-column write dropped the earlier key.
 *
 * Writes now go through the database function merge_report_settings_keys (migration
 * 20270116000000, placeholder version), which replaces ONLY the named top-level keys in one
 * statement. Siblings are never read by the client and never rewritten. Reads are CHECKED: an
 * unreadable column throws ReportSettingsUnreadableError; it is never answered as `{}`.
 *
 * STATED CONTRACT with the migration: REPORT_SETTINGS_SYSTEM_KEYS must equal the function's
 * c_allowed list. reportSettingsKeys.test.ts parses the migration and pins the two equal. Adding a
 * key means a NEW migration (CREATE OR REPLACE with the longer list) AND this list, together.
 *
 * Still NOT protected (same-key race): two writers of the SAME array key (e.g. two concurrent
 * upserts into orchestration_tasks) each compute the array from their own read, so the later one
 * wins for that key. That is a narrower, pre-existing race; it never touches other keys.
 */

/**
 * The shared client is loaded LAZILY, so pure modules (e.g. canonicalShadowJob, whose seam injects its
 * own client) can import this file without loading the database client.
 */
async function defaultClient(): Promise<ReportSettingsClient> {
  return (await import('./supabaseClient')).supabase as unknown as ReportSettingsClient;
}

export const MERGE_REPORT_SETTINGS_RPC = 'merge_report_settings_keys';

/** The SYSTEM-owned keys (sorted). User-facing report settings are deliberately absent. */
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

export type ReportSettingsSystemKey = (typeof REPORT_SETTINGS_SYSTEM_KEYS)[number];
export type ReportSettingsPatch = Partial<Record<ReportSettingsSystemKey, unknown>>;

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

/**
 * Replace ONLY the given system keys, server-side, in one statement. Returns true when a
 * company_profiles row was written, false when there is no row for the company.
 * THROWS ReportSettingsWriteError when the database refused or the outcome is unknown (a missing
 * row count is "no answer", never "written"). A key outside the allow-list throws BEFORE any call.
 */
export async function mergeReportSettingsKeys(
  companyId: string,
  patch: ReportSettingsPatch,
  opts: {
    updatedAt?: string | null;
    client?: ReportSettingsClient;
    /** Keys of `patch` written ONLY where the stored column lacks them, decided in the same UPDATE. */
    ifAbsent?: ReportSettingsSystemKey[];
  } = {},
): Promise<boolean> {
  const keys = Object.keys(patch);
  if (!companyId) throw new ReportSettingsWriteError(String(companyId), 'companyId is required');
  if (keys.length === 0) throw new ReportSettingsWriteError(companyId, 'empty patch');
  const unknown = keys.filter((k) => !(REPORT_SETTINGS_SYSTEM_KEYS as readonly string[]).includes(k));
  if (unknown.length > 0) {
    throw new ReportSettingsWriteError(companyId, `not a system-owned key: ${unknown.sort().join(', ')}`);
  }
  const strayIfAbsent = (opts.ifAbsent ?? []).filter((k) => !keys.includes(k));
  if (strayIfAbsent.length > 0) {
    throw new ReportSettingsWriteError(companyId, `ifAbsent keys not in the patch: ${strayIfAbsent.sort().join(', ')}`);
  }
  const client = opts.client ?? (await defaultClient());
  const { data, error } = await client.rpc(MERGE_REPORT_SETTINGS_RPC, {
    p_company_id: companyId,
    p_patch: patch,
    p_updated_at: opts.updatedAt ?? null,
    p_if_absent: opts.ifAbsent && opts.ifAbsent.length > 0 ? opts.ifAbsent : null,
  });
  if (error) throw new ReportSettingsWriteError(companyId, errorText(error));
  if (typeof data !== 'number') throw new ReportSettingsWriteError(companyId, `no row count returned (${JSON.stringify(data)})`);
  return data > 0;
}
