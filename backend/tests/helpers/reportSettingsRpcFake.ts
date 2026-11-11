/**
 * A faithful in-memory mirror of public.merge_report_settings_keys (report_settings unit 1).
 *
 * NOT kinder than the real thing: the allow-list is PARSED FROM THE MIGRATION (its c_allowed array),
 * not copied, and every refusal the SQL makes is made here with the same SQLSTATE:
 *   22004 null company id; 22023 empty / non-object patch, a key outside the allow-list, or a stored
 *   report_settings that is a JSON non-object. 0 rows when there is no company_profiles row.
 * The real SQL is proven against PostgreSQL in backend/tests/realschema/report_settings_key_merge.test.ts.
 */
import fs from 'fs';
import path from 'path';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../../supabase/migrations');
const SLUG = '_report_settings_key_merge_rpc.sql';
/** Located by slug, not version: the version is assigned by the migration registry owner. */
export const MIGRATION_FILE = (() => {
  const hits = fs.readdirSync(MIGRATIONS_DIR).filter((f) => /^\d{14}_/.test(f) && f.endsWith(SLUG));
  if (hits.length !== 1) throw new Error(`reportSettingsRpcFake: expected ONE *${SLUG}, found ${hits.length}`);
  return path.join(MIGRATIONS_DIR, hits[0]);
})();

/** The function's c_allowed list, read from the migration text. */
export function migrationAllowList(): string[] {
  const sql = fs.readFileSync(MIGRATION_FILE, 'utf8');
  const m = sql.match(/c_allowed CONSTANT text\[\] := ARRAY\[([\s\S]*?)\];/);
  if (!m) throw new Error('reportSettingsRpcFake: c_allowed not found in the migration');
  return [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
}

export type StoredProfile = { report_settings: unknown; updated_at?: string | null } | null;

export interface MergeOutcome {
  data: number | null;
  error: { code: string; message: string } | null;
}

/** Applies the merge to `row` IN PLACE (as the UPDATE would) and answers like PostgREST. */
export function applyMerge(row: StoredProfile, args: Record<string, unknown>): MergeOutcome {
  const allowed = migrationAllowList();
  const companyId = args.p_company_id;
  const patch = args.p_patch as unknown;
  const fail = (code: string, message: string): MergeOutcome => ({ data: null, error: { code, message } });
  if (companyId === null || companyId === undefined) return fail('22004', 'p_company_id is required');
  if (!patch || typeof patch !== 'object' || Array.isArray(patch) || Object.keys(patch).length === 0) {
    return fail('22023', 'p_patch must be a non-empty JSON object');
  }
  const bad = Object.keys(patch).filter((k) => !allowed.includes(k)).sort();
  if (bad.length > 0) return fail('22023', `not an owned report_settings key: {${bad.join(',')}}`);
  const ifAbsent = (args.p_if_absent as unknown[] | null | undefined) ?? [];
  const nested = (args.p_merge_nested as unknown[] | null | undefined) ?? [];
  if ([...ifAbsent, ...nested].some((k) => k === null || k === undefined)) return fail('22023', 'NULL element');
  const badLists = [...ifAbsent, ...nested].filter((k) => typeof k !== 'string' || !allowed.includes(k) || !(k in (patch as object)));
  if (badLists.length > 0) return fail('22023', 'p_if_absent / p_merge_nested keys must be allow-listed keys of p_patch');
  if (ifAbsent.some((k) => nested.includes(k))) return fail('22023', 'a key cannot be both p_if_absent and p_merge_nested');
  const p = patch as Record<string, unknown>;
  if (nested.some((k) => !p[k as string] || typeof p[k as string] !== 'object' || Array.isArray(p[k as string]))) {
    return fail('22023', 'p_merge_nested values must be JSON objects');
  }
  if (!row) return { data: 0, error: null };
  const rs = row.report_settings;
  if (rs !== null && rs !== undefined && (typeof rs !== 'object' || Array.isArray(rs))) {
    return fail('22023', 'report_settings is not an object; refusing to merge');
  }
  const current = (rs as Record<string, unknown> | null) ?? {};
  const isObj = (v: unknown) => v !== null && typeof v === 'object' && !Array.isArray(v);
  if (nested.some((k) => current[k as string] !== undefined && current[k as string] !== null && !isObj(current[k as string]))) {
    return fail('22023', 'a p_merge_nested key holds a non-object; refusing to merge');
  }
  // jsonb `||` on objects: right-hand keys replace, all others kept; nested keys merge one level deep.
  const effective = Object.fromEntries(Object.entries(p)
    .filter(([k]) => !(ifAbsent.includes(k) && k in current))
    .map(([k, v]) => [k, nested.includes(k) ? { ...(isObj(current[k]) ? (current[k] as object) : {}), ...(v as object) } : v]));
  row.report_settings = JSON.parse(JSON.stringify({ ...current, ...effective }));
  if (args.p_updated_at) row.updated_at = args.p_updated_at as string;
  return { data: 1, error: null };
}

/** A `supabase.rpc` double over a single stored row (null = no company_profiles row). */
export function rpcOver(getRow: () => StoredProfile, onMerged?: (row: NonNullable<StoredProfile>, args: Record<string, unknown>) => void) {
  return jest.fn(async (fn: string, args: Record<string, unknown>) => {
    if (fn !== 'merge_report_settings_keys') {
      return { data: null, error: { code: 'PGRST202', message: `Could not find the function public.${fn}` } };
    }
    const row = getRow();
    const out = applyMerge(row, args);
    if (!out.error && row && out.data) onMerged?.(row, args);
    return out;
  });
}
