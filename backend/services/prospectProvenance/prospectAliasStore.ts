/**
 * Tenant-scoped READ and WRITE path for `public.prospect_aliases`
 * (closure-B, 20270109000001). Pure resolution lives in
 * `lib/prospectProvenance/prospectAliases.ts`.
 *
 * WRITE (`recordProspectAlias`) — append-only. service_role holds SELECT +
 * INSERT only. The database refuses a self-alias (`pa_not_self`), a second
 * survivor for one alias (`uq_prospect_alias_org_alias`), a survivor that is
 * itself an alias (`pa_survivor_is_terminal`) and an alias that already has
 * aliases (`pa_alias_has_no_aliases`), and the composite FKs refuse a lead of
 * another tenant (23503). The writer maps each to an outcome; it never throws.
 *
 * READ (`readProspectAliases`) — one read per tenant (`.eq('organization_id')`),
 * capped, every row re-checked in memory. Fail-open, observably: a missing table
 * (42P01 / PGRST205, i.e. the migration is unapplied) yields no aliases and
 * `status: 'table_missing'`, reported once per process; never a throw.
 */
import { ownedDbTable } from '../../db/writeOwner';
import {
  PROSPECT_ALIAS_DB,
  type ProspectAlias,
  type ProspectAliasReason,
} from '../../../lib/prospectProvenance/prospectAliases';

type Row = Record<string, unknown>;
type DbError = { code?: string; message?: string; details?: string | null } | null;
type QueryResult = { data: unknown; error: DbError };

export type ProspectAliasReadStatus = 'ok' | 'table_missing' | 'error';

export interface ProspectAliasReadResult {
  status: ProspectAliasReadStatus;
  aliases: ProspectAlias[];
  truncated: boolean;
}

export interface ProspectAliasInput {
  organizationId: string;
  aliasLeadId: string;
  survivorLeadId: string;
  reason: ProspectAliasReason;
  ruleVersion: string;
  /** Why (no PII beyond what the contribution evidence already holds): rule, platform, normalized handle, person id. */
  evidence: Record<string, unknown>;
}

export type ProspectAliasWriteStatus =
  | 'inserted'      // a new alias row
  | 'duplicate'     // the same alias → survivor already recorded (idempotent replay)
  | 'conflict'      // the alias already points at a DIFFERENT survivor (never re-pointed)
  | 'refused'       // the database refused it (self / chain / cross-tenant)
  | 'table_missing' // migration unapplied
  | 'error';

export interface ProspectAliasWriteResult {
  status: ProspectAliasWriteStatus;
  code?: string;
  /** The survivor already recorded for this alias (duplicate / conflict). */
  existingSurvivorLeadId?: string | null;
}

/** Injectable query seam (tests). Default: PostgREST via the owned table seam. */
export interface ProspectAliasQueryPort {
  list(organizationId: string, limit: number): Promise<QueryResult>;
  insert(row: Row): Promise<QueryResult>;
  findByAlias(organizationId: string, aliasLeadId: string): Promise<QueryResult>;
}

export const ALIAS_READ_CAP = 5000;
const COLUMNS = 'id,organization_id,alias_lead_id,survivor_lead_id,reason,created_at';
const MISSING_TABLE_CODES = new Set(['42P01', 'PGRST205']);

const defaultPort: ProspectAliasQueryPort = {
  async list(organizationId, limit) {
    const { data, error } = await ownedDbTable(PROSPECT_ALIAS_DB.table)
      .select(COLUMNS)
      .eq('organization_id', organizationId)   // tenant boundary — never optional
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(limit);
    return { data, error };
  },
  async insert(row) {
    const { data, error } = await ownedDbTable(PROSPECT_ALIAS_DB.table).insert(row).select('id').maybeSingle();
    return { data, error };
  },
  async findByAlias(organizationId, aliasLeadId) {
    const { data, error } = await ownedDbTable(PROSPECT_ALIAS_DB.table)
      .select(COLUMNS)
      .eq('organization_id', organizationId)   // tenant boundary — never optional
      .eq('alias_lead_id', aliasLeadId)
      .maybeSingle();
    return { data, error };
  },
};

const reported = new Set<string>();
function reportOnce(key: string, ...args: unknown[]): void {
  if (reported.has(key)) return;
  reported.add(key);
  console.warn(`[prospectAliasStore] ${PROSPECT_ALIAS_DB.table}`, ...args);
}

/** Test seam: forget which conditions were already reported. */
export function resetProspectAliasReportsForTests(): void {
  reported.clear();
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

function mapRow(organizationId: string, row: Row): ProspectAlias | null {
  if (!row || row.organization_id !== organizationId) return null;
  const aliasLeadId = str(row.alias_lead_id);
  const survivorLeadId = str(row.survivor_lead_id);
  if (!aliasLeadId || !survivorLeadId || aliasLeadId === survivorLeadId) return null;
  return {
    organizationId,
    aliasLeadId,
    survivorLeadId,
    reason: str(row.reason) ?? undefined,
    createdAt: str(row.created_at),
  };
}

/** Every alias of ONE tenant. Never throws. */
export async function readProspectAliases(
  organizationId: string,
  opts: { port?: ProspectAliasQueryPort } = {},
): Promise<ProspectAliasReadResult> {
  if (!organizationId) return { status: 'ok', aliases: [], truncated: false };
  const port = opts.port ?? defaultPort;
  try {
    const { data, error } = await port.list(organizationId, ALIAS_READ_CAP + 1);
    if (error) {
      const code = String(error.code ?? 'unknown');
      const status: ProspectAliasReadStatus = MISSING_TABLE_CODES.has(code) ? 'table_missing' : 'error';
      reportOnce(`read|${code}`, 'read failed — no prospect is resolved onto a survivor:', code, error.message ?? '');
      return { status, aliases: [], truncated: false };
    }
    const rows = Array.isArray(data) ? (data as Row[]) : [];
    const aliases: ProspectAlias[] = [];
    for (const r of rows.slice(0, ALIAS_READ_CAP)) {
      const a = mapRow(organizationId, r);
      if (a) aliases.push(a);
      else reportOnce('foreign_row', 'returned a row outside the requested tenant (or malformed) — dropped');
    }
    const truncated = rows.length > ALIAS_READ_CAP;
    if (truncated) reportOnce(`truncated|${organizationId}`, `read hit its cap of ${ALIAS_READ_CAP} for tenant ${organizationId}`);
    return { status: 'ok', aliases, truncated };
  } catch (e) {
    reportOnce('read|exception', 'read threw — no prospect is resolved onto a survivor:', e instanceof Error ? e.message : String(e));
    return { status: 'error', aliases: [], truncated: false };
  }
}

const mentions = (e: DbError, name: string): boolean =>
  `${e?.message ?? ''} ${e?.details ?? ''}`.includes(name);

/**
 * Record `alias → survivor` (append-only). Never throws. An alias that already
 * exists is NEVER re-pointed: same survivor ⇒ `duplicate`, other ⇒ `conflict`.
 */
export async function recordProspectAlias(
  input: ProspectAliasInput,
  opts: { port?: ProspectAliasQueryPort } = {},
): Promise<ProspectAliasWriteResult> {
  const port = opts.port ?? defaultPort;
  const org = str(input.organizationId);
  const alias = str(input.aliasLeadId);
  const survivor = str(input.survivorLeadId);
  if (!org || !alias || !survivor) return { status: 'refused', code: 'invalid_input' };
  if (alias === survivor) return { status: 'refused', code: PROSPECT_ALIAS_DB.notSelf };
  try {
    const { error } = await port.insert({
      organization_id: org,
      alias_lead_id: alias,
      survivor_lead_id: survivor,
      reason: input.reason,
      rule_version: input.ruleVersion,
      evidence: input.evidence ?? {},
    });
    if (!error) return { status: 'inserted' };
    const code = String(error.code ?? 'unknown');
    if (MISSING_TABLE_CODES.has(code)) {
      reportOnce(`write|${code}`, 'write failed — the alias store is missing (migration unapplied):', code);
      return { status: 'table_missing', code };
    }
    if (code === '23505' && mentions(error, PROSPECT_ALIAS_DB.uniqueAlias)) {
      const found = await port.findByAlias(org, alias);
      const existing = found.error ? null : mapRow(org, (found.data ?? {}) as Row);
      if (existing && existing.survivorLeadId === survivor) return { status: 'duplicate', code, existingSurvivorLeadId: survivor };
      return { status: 'conflict', code, existingSurvivorLeadId: existing?.survivorLeadId ?? null };
    }
    // 23514 (not self / terminal survivor / alias without aliases), 23503 (cross-tenant composite FK).
    if (code === '23514' || code === '23503') {
      const named = [PROSPECT_ALIAS_DB.notSelf, PROSPECT_ALIAS_DB.survivorIsTerminal, PROSPECT_ALIAS_DB.aliasHasNoAliases]
        .find((n) => mentions(error, n));
      return { status: 'refused', code: named ?? code };
    }
    reportOnce(`write|${code}`, 'write failed:', code, error.message ?? '');
    return { status: 'error', code };
  } catch (e) {
    reportOnce('write|exception', 'write threw:', e instanceof Error ? e.message : String(e));
    return { status: 'error', code: 'exception' };
  }
}
