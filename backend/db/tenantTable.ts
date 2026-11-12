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
import { TENANT_TABLES, TENANT_CHILD_TABLES, type TenantTableName, type TenantChildTableName } from './tenantTables';

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
  return {
    select(columns?: string, options?: { count?: 'exact' | 'planned' | 'estimated'; head?: boolean }) {
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
 * INDIRECT tenancy (a table with no tenant column, owned through its parent, e.g. daily_content_plans via
 * campaign_id → campaigns). The parent is read UNDER the tenant first; only if it belongs to the tenant are the
 * verbs returned, each constrained to that parent (`.eq(via, parentId)`); insert/upsert stamp `via` and refuse a
 * payload naming another parent. Unknown / foreign / unreadable parent → TENANT_MISMATCH (fail closed: a read
 * error is never "no parent, so no check").
 */
export async function tenantChildTable(table: TenantChildTableName, ctx: TenantContext, parentId: string) {
  const c = requireCtx(ctx);
  const spec = (TENANT_CHILD_TABLES as Record<string, { via: string; parent: TenantTableName } | undefined>)[table];
  if (!spec) throw new TenantSeamError('TENANT_TABLE_UNKNOWN', `${table} is not a registered child tenant table`);
  if (typeof parentId !== 'string' || parentId.length === 0) throw new TenantSeamError('TENANT_MISMATCH', `${table}: no parent id`);
  const { data, error } = await tenantTable(spec.parent, c).select('id').eq('id', parentId).maybeSingle();
  if (error) throw new TenantSeamError('TENANT_MISMATCH', `${table}: parent ${spec.parent} unreadable (${(error as { code?: string }).code ?? 'error'})`);
  if (!data) throw new TenantSeamError('TENANT_MISMATCH', `${table}: parent ${spec.parent} is not in this tenant`);
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
