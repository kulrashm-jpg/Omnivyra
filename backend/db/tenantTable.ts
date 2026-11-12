/**
 * THE tenant seam (tenant-seam plan S1, owner-approved 2026-11-12 via virality-e9).
 *
 * `ownedDbTable` runs as service_role (BYPASSRLS) and applies NO tenant filter: isolation depends on every
 * caller remembering `.eq('company_id', …)`. `tenantTable` makes the tenant predicate structural:
 *
 *  - select / update / delete: the tenant predicate is applied by the seam, before any caller filter.
 *  - insert / upsert: the tenant column is stamped by the seam; a payload carrying a DIFFERENT tenant value
 *    is refused (TENANT_MISMATCH), never silently overwritten.
 *  - no context → TENANT_CONTEXT_MISSING (fail closed). A context is only made by `tenantContextFor`
 *    (an authenticated principal's resolved company) or `systemTenantContext` (a job acting for one tenant,
 *    with a stated reason) — never from a request body.
 *
 * It wraps `ownedDbTable`, so observability and every existing test double of writeOwner still apply.
 * Cross-tenant access stays on `ownedDbTable` and must name an entry in crossTenantAllowList.ts.
 */
import { ownedDbTable, ownedDbRpc } from './writeOwner';
import { TENANT_TABLES, TENANT_CHILD_TABLES, TENANT_OR_PLATFORM_TABLES, type TenantTableName, type TenantChildTableName } from './tenantTables';

declare const TENANT_CONTEXT_BRAND: unique symbol;
export type TenantContext = {
  readonly companyId: string;
  readonly origin: 'principal' | 'system';
  readonly reason: string | null;
  readonly [TENANT_CONTEXT_BRAND]: true;
};

export class TenantSeamError extends Error {
  constructor(readonly code: 'TENANT_CONTEXT_MISSING' | 'TENANT_MISMATCH' | 'TENANT_TABLE_UNKNOWN' | 'TENANT_PAYLOAD_INVALID', message: string) {
    super(`${code}: ${message}`);
    this.name = 'TenantSeamError';
  }
}

const UUIDISH = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function make(companyId: unknown, origin: TenantContext['origin'], reason: string | null): TenantContext {
  if (typeof companyId !== 'string' || !UUIDISH.test(companyId)) {
    throw new TenantSeamError('TENANT_CONTEXT_MISSING', 'a tenant context needs a resolved company id (uuid)');
  }
  return Object.freeze({ companyId: companyId.toLowerCase(), origin, reason }) as TenantContext;
}

/**
 * A context for an authenticated request. Pass the company the access check RESOLVED (enforceCompanyAccess /
 * resolveUserContext), together with the principal it was resolved for; never a value read from the body.
 */
export function tenantContextFor(access: { userId: string | null | undefined }, resolvedCompanyId: string): TenantContext {
  if (!access || typeof access.userId !== 'string' || access.userId.length === 0) {
    throw new TenantSeamError('TENANT_CONTEXT_MISSING', 'no authenticated principal for this tenant context');
  }
  return make(resolvedCompanyId, 'principal', null);
}

/** A context for a background job acting for ONE tenant (a cron fan-out iterating companies, a queue job). */
export function systemTenantContext(companyId: string, reason: string): TenantContext {
  if (typeof reason !== 'string' || reason.trim().length < 3) {
    throw new TenantSeamError('TENANT_CONTEXT_MISSING', 'a system tenant context must state its reason');
  }
  return make(companyId, 'system', reason.trim());
}

function columnOf(table: string): string {
  const entry = (TENANT_TABLES as Record<string, { column: string } | undefined>)[table];
  if (!entry) throw new TenantSeamError('TENANT_TABLE_UNKNOWN', `${table} is not a registered tenant table (backend/db/tenantTables.ts)`);
  return entry.column;
}

function requireCtx(ctx: TenantContext | null | undefined): TenantContext {
  if (!ctx || typeof ctx.companyId !== 'string' || !UUIDISH.test(ctx.companyId)) {
    throw new TenantSeamError('TENANT_CONTEXT_MISSING', 'tenantTable called without a tenant context');
  }
  return ctx;
}

type Row = Record<string, unknown>;

/**
 * Embedded selects (`'*, other(*)'`) are REFUSED (05, S1 review): the tenant predicate constrains the base
 * table only, and an embed of a PARENT / belongs-to row (outbound FK) returns that row whatever tenant it
 * belongs to; `!inner` does not help. Read the other table through its own tenantTable / tenantChildTable.
 * A `->` JSON path is not an embed and stays allowed.
 */
function refuseEmbed(table: string, columns: string | undefined) {
  if (typeof columns === 'string' && /\(/.test(columns.replace(/->>?/g, ''))) {
    throw new TenantSeamError('TENANT_PAYLOAD_INVALID', `${table}: embedded selects are not allowed through the tenant seam (read the related table through its own seam)`);
  }
}
function stamp(rows: Row | Row[], column: string, companyId: string): Row | Row[] {
  const one = (r: Row): Row => {
    if (!r || typeof r !== 'object' || Array.isArray(r)) throw new TenantSeamError('TENANT_PAYLOAD_INVALID', 'insert/upsert payload must be an object');
    const given = r[column];
    if (given !== undefined && given !== null && String(given).toLowerCase() !== companyId) {
      throw new TenantSeamError('TENANT_MISMATCH', `payload ${column} does not match the tenant context`);
    }
    return { ...r, [column]: companyId };
  };
  return Array.isArray(rows) ? rows.map(one) : one(rows);
}

/**
 * The tenant-scoped builder. Only the five verbs are exposed; each returns the underlying PostgREST builder
 * already constrained to the tenant, so callers chain their own filters / modifiers after it.
 */
export function tenantTable(table: TenantTableName, ctx: TenantContext) {
  const c = requireCtx(ctx);
  const column = columnOf(table);
  if ((TENANT_OR_PLATFORM_TABLES as readonly string[]).includes(table)) {
    // e9 on C28: a catalog table's platform (NULL-tenant) rows are readable by every tenant; tenantTable would hide
    // them. Use tenantOrPlatformTable so the choice is explicit.
    throw new TenantSeamError('TENANT_TABLE_UNKNOWN', `${table} is TENANT_OR_PLATFORM: use tenantOrPlatformTable`);
  }
  return {
    select(columns?: string, options?: { count?: 'exact' | 'planned' | 'estimated'; head?: boolean }) {
      refuseEmbed(table, columns);
      return (ownedDbTable(table) as any).select(columns ?? '*', options).eq(column, c.companyId);
    },
    update(values: Row, options?: Record<string, unknown>) {
      if (values && Object.prototype.hasOwnProperty.call(values, column) && String(values[column]).toLowerCase() !== c.companyId) {
        throw new TenantSeamError('TENANT_MISMATCH', `update may not move a row to another tenant (${column})`);
      }
      return (ownedDbTable(table) as any).update(values, options).eq(column, c.companyId);
    },
    delete(options?: Record<string, unknown>) {
      return (ownedDbTable(table) as any).delete(options).eq(column, c.companyId);
    },
    insert(values: Row | Row[], options?: Record<string, unknown>) {
      return (ownedDbTable(table) as any).insert(stamp(values, column, c.companyId), options);
    },
    upsert(values: Row | Row[], options?: Record<string, unknown>) {
      return (ownedDbTable(table) as any).upsert(stamp(values, column, c.companyId), options);
    },
  };
}

/**
 * TENANT_OR_PLATFORM catalog tables (e9 on C28): READS return the tenant's rows PLUS platform rows (tenant column
 * NULL); WRITES are tenant-stamped and update/delete reach ONLY the tenant's own rows, so a tenant can never modify a
 * platform row through the seam (platform rows: allow-listed Super Admin paths on ownedDbTable only).
 */
export function tenantOrPlatformTable(table: TenantTableName, ctx: TenantContext) {
  const c = requireCtx(ctx);
  if (!(TENANT_OR_PLATFORM_TABLES as readonly string[]).includes(table)) {
    throw new TenantSeamError('TENANT_TABLE_UNKNOWN', `${table} is not TENANT_OR_PLATFORM (use tenantTable)`);
  }
  const column = columnOf(table);
  return {
    select(columns?: string, options?: { count?: 'exact' | 'planned' | 'estimated'; head?: boolean }) {
      refuseEmbed(table, columns);
      // companyId is a validated uuid (requireCtx), so it is safe inside the PostgREST or-filter.
      return (ownedDbTable(table) as any).select(columns ?? '*', options).or(`${column}.eq.${c.companyId},${column}.is.null`);
    },
    update(values: Row, options?: Record<string, unknown>) {
      if (values && Object.prototype.hasOwnProperty.call(values, column) && String(values[column]).toLowerCase() !== c.companyId) {
        throw new TenantSeamError('TENANT_MISMATCH', `update may not move a row to another tenant or to the platform (${column})`);
      }
      return (ownedDbTable(table) as any).update(values, options).eq(column, c.companyId);
    },
    delete(options?: Record<string, unknown>) {
      return (ownedDbTable(table) as any).delete(options).eq(column, c.companyId);
    },
    insert(values: Row | Row[], options?: Record<string, unknown>) {
      return (ownedDbTable(table) as any).insert(stamp(values, column, c.companyId), options);
    },
    upsert(values: Row | Row[], options?: Record<string, unknown>) {
      return (ownedDbTable(table) as any).upsert(stamp(values, column, c.companyId), options);
    },
  };
}

/**
 * INDIRECT tenancy (a table with no tenant column, owned through its parent, e.g. daily_content_plans via
 * campaign_id → campaigns). The parent is read UNDER the tenant first; only if it belongs to the tenant are the
 * verbs returned, each constrained to that parent (`.eq(via, parentId)`); insert/upsert stamp `via` and refuse a
 * payload naming another parent. Unknown / foreign / unreadable parent → TENANT_MISMATCH (fail closed: a read
 * error is never "no parent, so no check").
 */
type ChildSpec = { via: string; parent: string; parentKey?: string };
const childSpec = (t: string): ChildSpec | undefined => (TENANT_CHILD_TABLES as Record<string, ChildSpec | undefined>)[t];
/** Deepest parent chain the seam will walk (e.g. platform_override -> attachment -> core_asset is 2). */
const MAX_HOPS = 4;
/** A non-unique parent key may match several parent rows; more than this is refused (fail closed, never truncated). */
const MAX_PARENT_ROWS = 50;

/**
 * Proves that the parent row(s) identified by `key = value` in `parentTable` belong to the tenant.
 *  - direct parent keyed by 'id' (unique): one read UNDER the tenant (unchanged S1 behaviour).
 *  - direct parent keyed by a NON-id column (may be non-unique, e.g. content_core_asset.content_core_id): every
 *    row carrying that key is read and EVERY one must be this tenant's (a key shared with another tenant, or a NULL
 *    tenant, is refused: the child filter `.eq(via, value)` cannot tell whose parent a child hangs off).
 *  - CHILD parent (multi-hop, e.g. content_asset_versions -> content_assets -> campaigns): the parent rows' own link
 *    values are read and each is verified recursively against ITS parent, up to MAX_HOPS.
 * Missing, unreadable, over-wide or NULL-linked parents all throw TENANT_MISMATCH (fail closed).
 */
async function verifyParent(child: string, c: TenantContext, parentTable: string, key: string, value: string, hop: number): Promise<void> {
  if (hop > MAX_HOPS) throw new TenantSeamError('TENANT_MISMATCH', `${child}: parent chain deeper than ${MAX_HOPS}`);
  const unreadable = (e: unknown) => new TenantSeamError('TENANT_MISMATCH', `${child}: parent ${parentTable} unreadable (${(e as { code?: string }).code ?? 'error'})`);
  const absent = () => new TenantSeamError('TENANT_MISMATCH', `${child}: parent ${parentTable} is not in this tenant`);
  const parentSpec = childSpec(parentTable);
  if (!parentSpec) {
    if (!(parentTable in TENANT_TABLES)) throw new TenantSeamError('TENANT_TABLE_UNKNOWN', `${child}: parent ${parentTable} is not a registered tenant table`);
    if (key === 'id') {
      const { data, error } = await tenantTable(parentTable as TenantTableName, c).select('id').eq('id', value).maybeSingle();
      if (error) throw unreadable(error);
      if (!data) throw absent();
      return;
    }
    const column = columnOf(parentTable as TenantTableName);
    const { data, error } = await (ownedDbTable(parentTable as TenantTableName) as any).select(column).eq(key, value).limit(MAX_PARENT_ROWS + 1);
    if (error) throw unreadable(error);
    const rows = (data ?? []) as Row[];
    if (rows.length === 0 || rows.length > MAX_PARENT_ROWS) throw absent();
    if (!rows.every((r) => typeof r[column] === 'string' && String(r[column]).toLowerCase() === c.companyId)) throw absent();
    return;
  }
  const { data, error } = await (ownedDbTable(parentTable as TenantTableName) as any).select(parentSpec.via).eq(key, value).limit(MAX_PARENT_ROWS + 1);
  if (error) throw unreadable(error);
  const rows = (data ?? []) as Row[];
  if (rows.length === 0 || rows.length > MAX_PARENT_ROWS) throw absent();
  const links = new Set<string>();
  for (const r of rows) {
    const v = r[parentSpec.via];
    if (v === null || v === undefined || String(v).length === 0) throw absent();
    links.add(String(v));
  }
  for (const v of links) await verifyParent(child, c, parentSpec.parent, parentSpec.parentKey ?? 'id', v, hop + 1);
}

export async function tenantChildTable(table: TenantChildTableName, ctx: TenantContext, parentId: string) {
  const c = requireCtx(ctx);
  const spec = childSpec(table);
  if (!spec) throw new TenantSeamError('TENANT_TABLE_UNKNOWN', `${table} is not a registered child tenant table`);
  if (typeof parentId !== 'string' || parentId.length === 0) throw new TenantSeamError('TENANT_MISMATCH', `${table}: no parent id`);
  await verifyParent(table, c, spec.parent, spec.parentKey ?? 'id', parentId, 1);
  const via = spec.via;
  const pin = (rows: Row | Row[]): Row | Row[] => {
    const one = (r: Row): Row => {
      if (!r || typeof r !== 'object' || Array.isArray(r)) throw new TenantSeamError('TENANT_PAYLOAD_INVALID', 'insert/upsert payload must be an object');
      if (r[via] !== undefined && r[via] !== null && String(r[via]) !== parentId) throw new TenantSeamError('TENANT_MISMATCH', `${table}: payload ${via} names another parent`);
      return { ...r, [via]: parentId };
    };
    return Array.isArray(rows) ? rows.map(one) : one(rows);
  };
  return {
    select(columns?: string, options?: { count?: 'exact' | 'planned' | 'estimated'; head?: boolean }) {
      refuseEmbed(table, columns);
      return (ownedDbTable(table) as any).select(columns ?? '*', options).eq(via, parentId);
    },
    update(values: Row, options?: Record<string, unknown>) {
      if (values && Object.prototype.hasOwnProperty.call(values, via) && String(values[via]) !== parentId) {
        throw new TenantSeamError('TENANT_MISMATCH', `${table}: update may not move a row to another parent (${via})`);
      }
      return (ownedDbTable(table) as any).update(values, options).eq(via, parentId);
    },
    delete(options?: Record<string, unknown>) {
      return (ownedDbTable(table) as any).delete(options).eq(via, parentId);
    },
    insert(values: Row | Row[], options?: Record<string, unknown>) {
      return (ownedDbTable(table) as any).insert(pin(values), options);
    },
    upsert(values: Row | Row[], options?: Record<string, unknown>) {
      return (ownedDbTable(table) as any).upsert(pin(values), options);
    },
  };
}

/**
 * BOOTSTRAP for background work (queue / worker jobs, reconcilers, webhook processors) whose payload carries only a
 * row id: "which tenant owns this row?". The single by-id read happens HERE, inside the seam (the only place allowed
 * to read a tenant table without a context). It returns a SYSTEM context for the row's own tenant; every later access
 * (including re-reading the same row) goes through tenantTable(..., ctx). A NULL tenant, a missing row or an unreadable
 * row returns null (the caller refuses the job; never "no tenant, so no filter").
 *
 * Request handlers must NOT use this: their tenant comes from the authenticated principal (tenantContextFor). The
 * tenant-seam gate flags resolveTenantOfRow under pages/api (rule R9) unless the call site is allow-listed (webhooks).
 */
export async function resolveTenantOfRow(table: TenantTableName, id: string, reason: string): Promise<TenantContext | null> {
  if (typeof reason !== 'string' || reason.trim().length < 3) {
    throw new TenantSeamError('TENANT_CONTEXT_MISSING', 'resolveTenantOfRow must state its reason');
  }
  if (typeof id !== 'string' || id.length === 0) return null;
  const column = columnOf(table);
  const { data, error } = await (ownedDbTable(table) as any).select(column).eq('id', id).maybeSingle();
  if (error || !data) return null;
  const tenant = (data as Record<string, unknown>)[column];
  if (typeof tenant !== 'string' || !UUIDISH.test(tenant)) return null;
  return systemTenantContext(tenant, `${reason.trim()} (resolved from ${table}.${column} of row ${id})`);
}

/**
 * A tenant RPC: the tenant argument is supplied by the seam from the context, never by the caller.
 * `tenantArg` names the function's tenant parameter (e.g. 'p_company_id', 'p_org_id').
 */
export function tenantRpc(fn: string, tenantArg: string, ctx: TenantContext, args: Record<string, unknown> = {}) {
  const c = requireCtx(ctx);
  if (Object.prototype.hasOwnProperty.call(args, tenantArg) && String(args[tenantArg]).toLowerCase() !== c.companyId) {
    throw new TenantSeamError('TENANT_MISMATCH', `rpc ${fn}: ${tenantArg} does not match the tenant context`);
  }
  return ownedDbRpc(fn, { ...args, [tenantArg]: c.companyId });
}
