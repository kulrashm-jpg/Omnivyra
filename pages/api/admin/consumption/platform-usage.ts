import { createApiRoute as __createApiRoute } from '@/lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireCapability } from '@/backend/security/requireCapability';
import { CONSUMPTION_VIEW_AGGREGATE } from '@/shared/contracts/security';
import { getPlatformUsageReport } from '@/backend/services/billing/platformUsageReportService';

/**
 * B7.8-C.5 — platform provider spend report (read-only).
 *
 *   GET ?from=&to=&page=&pageSize=
 *
 * ── AUTHORIZATION: CONSUMPTION_VIEW_AGGREGATE ──────────────────────────────
 * Chosen on evidence, not preference. It is the repository's existing
 * platform-tier aggregate-cost READ capability: granted in the platform-admin
 * block of capabilityRegistry, deliberately NOT inherited by COMPANY_ADMIN (the
 * same comment block warns that per-tenant BILLING_MANAGE must never satisfy a
 * platform billing route), and already gating six aggregate cost reads —
 * cost-accounting, railway-company-costs, railway-efficiency and the sibling
 * consumption/* routes this one sits beside.
 *
 * Rejected alternatives:
 *   · BILLING_AUDIT_VIEW — the obvious name by wording, and UNSAFE here. It
 *     names no role directly in capabilityRegistry, but it is a CHILD of
 *     BILLING_MANAGE in CAPABILITY_HIERARCHY (SecurityCapabilities.ts:225), and
 *     COMPANY_ADMIN is granted BILLING_MANAGE (capabilityRegistry.ts:98) — so
 *     every company admin receives BILLING_AUDIT_VIEW transitively. This route
 *     returns PLATFORM-WIDE provider spend with no tenant column to scope it,
 *     so gating on that capability would hand company-scoped administrators the
 *     platform's entire cost surface. Rejected as a cross-tier exposure, not as
 *     an unused capability.
 *   · SUPER_ADMIN_DASHBOARD_VIEW — platform-tier and granted, but a generic
 *     dashboard capability rather than a cost-view one.
 *   · INTELLIGENCE_OVERRIDE_MANAGE (used by the sibling embed-topic route) — a
 *     MUTATE capability; requiring it to read would over-privilege the report.
 *
 * CONSUMPTION_VIEW_AGGREGATE carries no such transitive path: it appears in no
 * CAPABILITY_HIERARCHY pair, so it reaches only the roles that name it — the
 * platform-admin block. That is precisely the property this route needs.
 *
 * No new capability, role or permission is introduced. No company-scoped
 * authorization is added: the data is tenant-less, so requiring a company would
 * invent the attribution this whole design exists to avoid.
 *
 * ── TRANSPORT ONLY ─────────────────────────────────────────────────────────
 * Query parsing and authorization live here; all filtering, aggregation and
 * ordering live in the service. This route has no database client and names no
 * table, so it cannot reach customer billing even by mistake.
 */

const FAILURE_STATUS: Record<string, number> = {
  invalid_from: 400,
  invalid_to: 400,
  reversed_range: 400,
  query_failed: 500,
};

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Authorization BEFORE any database access.
  const guard = await requireCapability(req, res, {
    capability: CONSUMPTION_VIEW_AGGREGATE,
    reason: 'platform usage report (GET)',
  });
  if (guard.ok !== true) return; // denied; requireCapability responded + audited

  const q = req.query;
  const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

  // companyId / organizationId are deliberately NOT read from the query. The
  // underlying table has no tenant column, so there is nothing they could
  // scope, and accepting them would imply an attribution that does not exist.
  const out = await getPlatformUsageReport({
    from: str(q.from),
    to: str(q.to),
    page: Number(str(q.page)) || 0,
    pageSize: Number(str(q.pageSize)) || undefined,
  });

  if ('reason' in out) {
    // `'reason' in out` — NOT `!out.ok`. The repo compiles with `strict: false`,
    // under which boolean-literal discriminated unions do not narrow.
    return res.status(FAILURE_STATUS[out.reason] ?? 500).json({
      error: out.reason,
      code: out.reason.toUpperCase(),
    });
  }

  return res.status(200).json({
    ...out.report,
    // The summary describes the RETURNED PAGE, not the whole table (a
    // whole-table aggregate would need an RPC, i.e. a migration this phase must
    // not add). Label it, so a page total is never misread as total platform
    // spend — an under-count here would look exactly like cheap infrastructure.
    //
    // `complete_for_range` requires BOTH conditions. `!hasMore` alone is not
    // enough: the LAST page of a multi-page range also has hasMore=false, and
    // labelling that page complete would claim range-completeness for a
    // trailing fragment. With 120 rows at pageSize 50, page 2 returns 20 rows —
    // 17% of the range's real spend — and the operator would read it as the
    // whole of it. Only page 0 with no further pages saw the entire range.
    summaryScope:
      out.report.page === 0 && !out.report.hasMore ? 'complete_for_range' : 'current_page',
  });
}

export default __createApiRoute(handler, { route: '/api/admin/consumption/platform-usage' });
