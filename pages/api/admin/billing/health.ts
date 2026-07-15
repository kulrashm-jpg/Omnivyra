import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
/**
 * GET /api/admin/billing/health  (Phase F)
 *
 * Operational health endpoint for the billing schema. Reuses the SAME
 * shared prober the CI guard, the safe migration runner and the boot
 * validator use (billingSchemaSpec.buildBillingSchemaReport) — one source
 * of truth, no drift between "what CI checks" and "what the app reports".
 *
 * It answers, in one call, the questions an operator asks when billing
 * surfaces start 503-ing or hanging on a PostgREST schema-cache miss:
 *
 *   schema status        — overall ok | degraded | critical_missing
 *   migration status     — per-migration applied / partial / missing
 *   missing objects       — exact list (kind, name, severity, migration)
 *   trigger status       — immutability/guard triggers (inferred + verifySql)
 *   reconciliation ready  — billing_operations + reservation health view
 *   approval ready        — approval tables + approval RPCs
 *   postgrest ready       — was the failure a schema-cache miss (reload!)
 *                           vs the object genuinely never migrated
 *   rollout ready         — safe to advance billing rollout (all critical
 *                           present AND boot validator clean)
 *
 * Read-only. Zero mutation (mutating RPCs are INFERRED, never called).
 * Auth: FINANCE_AUDITOR+ — this exposes schema topology + remediation.
 *
 * Status code: 200 when overall='ok', 503 otherwise, so a uptime probe
 * or load balancer can treat a billing-schema gap as "degraded" without
 * parsing the body. The body always carries the full diagnostic.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { requireAuthenticatedInternalUser } from '../../../../backend/services/requestAccessService';
import { isFinanceAuditor } from '../../../../backend/services/billing/financeRbacService';
import {
  buildBillingSchemaReport,
  type BillingSchemaReport,
  type ProbeResult,
} from '../../../../backend/services/billing/bootstrap/billingSchemaSpec';
import { validateBillingBootstrap } from '../../../../backend/services/billing/bootstrap/billingBootstrapValidator';
import { logger } from '../../../../backend/services/logger';

type MigrationState = 'applied' | 'partial' | 'missing' | 'unknown';

interface MigrationStatus {
  migration: string;
  state:     MigrationState;
  present:   number;
  missing:   number;
  unverified:number;
}

/** A PostgREST schema-cache miss is REMEDIABLE by reloading the cache; a
 *  genuinely never-migrated object needs db:push. We distinguish them by
 *  the probe detail (the shared prober records the raw error message). */
const SCHEMA_CACHE_HINTS = ['schema cache', 'pgrst205', 'pgrst202'];

function isSchemaCacheMiss(r: ProbeResult): boolean {
  const d = (r.detail ?? '').toLowerCase();
  return SCHEMA_CACHE_HINTS.some(h => d.includes(h));
}

function perMigrationStatus(report: BillingSchemaReport): MigrationStatus[] {
  const byMig = new Map<string, MigrationStatus>();
  for (const r of report.results) {
    const e =
      byMig.get(r.migration) ??
      { migration: r.migration, state: 'unknown' as MigrationState, present: 0, missing: 0, unverified: 0 };
    if (r.status === 'present')    e.present += 1;
    if (r.status === 'missing')    e.missing += 1;
    if (r.status === 'unverified') e.unverified += 1;
    byMig.set(r.migration, e);
  }
  for (const e of byMig.values()) {
    e.state =
      e.missing === 0 && e.present > 0 ? 'applied' :
      e.missing > 0 && e.present > 0   ? 'partial' :
      e.missing > 0 && e.present === 0 ? 'missing' :
                                          'unknown';
  }
  return [...byMig.values()].sort((a, b) => a.migration.localeCompare(b.migration));
}

/** A named subsystem is "ready" iff every object it depends on is present. */
function subsystemReady(report: BillingSchemaReport, objects: string[]): {
  ready: boolean;
  missing: string[];
} {
  const status = new Map(report.results.map(r => [r.object, r.status]));
  const missing = objects.filter(o => status.get(o) === 'missing');
  // Unknown (not in spec) is treated as not-ready to avoid a false green.
  const unresolved = objects.filter(o => !status.has(o));
  return { ready: missing.length === 0 && unresolved.length === 0, missing: [...missing, ...unresolved] };
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const user = await requireAuthenticatedInternalUser(req, res);
  if (!user) return;
  if (!(await isFinanceAuditor(user.id))) {
    return res.status(403).json({ error: 'FINANCE_AUDITOR_REQUIRED' });
  }

  try {
    // Shared prober + boot validator (boot validator is process-cached, so
    // this is cheap after first call and reflects the same view startup saw).
    const [report, bootstrap] = await Promise.all([
      buildBillingSchemaReport(),
      validateBillingBootstrap(),
    ]);

    const migrations = perMigrationStatus(report);

    const missingObjects = report.results
      .filter(r => r.status === 'missing')
      .map(r => ({ object: r.object, kind: r.kind, severity: r.severity, migration: r.migration }));

    // Trigger / opaque status comes from the report's inferred opaque set
    // (PostgREST cannot see triggers; verifySql is the definitive check).
    const triggers = report.opaque.map(o => ({
      name:      o.name,
      status:    o.status,
      severity:  o.severity,
      migration: o.migration,
      verifySql: o.verifySql,
    }));

    const reconciliation = subsystemReady(report, [
      'billing_operations',
      'v_reservation_health',
      'v_billing_operations_health',
    ]);
    const approvals = subsystemReady(report, [
      'credit_action_approvals',
      'credit_action_approval_signatures',
      'required_approvals_for_action',
      'sign_credit_action_approval',
    ]);

    // PostgREST readiness: if every "missing" is actually a schema-cache
    // miss, the SQL is applied but the cache is stale → reload, not migrate.
    const missingResults = report.results.filter(r => r.status === 'missing');
    const cacheMisses = missingResults.filter(isSchemaCacheMiss);
    const postgrest = {
      ready: missingResults.length === 0,
      schemaCacheMissCount: cacheMisses.length,
      genuinelyMissingCount: missingResults.length - cacheMisses.length,
      remediation:
        missingResults.length === 0
          ? null
          : cacheMisses.length === missingResults.length
            ? 'All missing objects are PostgREST schema-cache misses — the SQL is applied. Reload the schema cache (see docs/audit/postgrest-schema-remediation.md), do NOT re-run migrations.'
            : 'One or more objects are genuinely un-migrated. Apply migrations (npm run db:push) THEN reload the PostgREST schema cache.',
    };

    // Rollout readiness: only safe to advance billing rollout when no
    // critical object is missing AND the boot validator is clean.
    const rollout = {
      ready: report.criticalMissing.length === 0 && bootstrap.ok,
      reason:
        report.criticalMissing.length > 0
          ? `Critical billing objects missing: ${report.criticalMissing.map(r => `${r.kind}:${r.object}`).join(', ')}`
          : !bootstrap.ok
            ? `Boot validator not clean (overall=${bootstrap.overall})`
            : null,
    };

    const body = {
      generatedAt: new Date().toISOString(),
      status: {
        overall:  report.overall,                         // ok | degraded | critical_missing
        healthy:  report.overall === 'ok',
        counts:   report.counts,
      },
      migrations,
      missingObjects,
      triggers,
      readiness: {
        reconciliation,
        approvals,
        postgrest,
        rollout,
      },
      bootstrap: {
        ok:              bootstrap.ok,
        overall:         bootstrap.overall,
        criticalMissing: bootstrap.criticalMissing,
        missing:         bootstrap.missing,
        remediation:     bootstrap.remediation,
        ranAt:           bootstrap.ranAt,
      },
    };

    if (report.overall !== 'ok') {
      logger.warn('billing_health_degraded', {
        overall: report.overall,
        criticalMissing: report.criticalMissing.map(r => r.object),
        missing: missingObjects.map(o => o.object),
      });
    }

    // 200 only when fully healthy; 503 lets a probe treat a billing-schema
    // gap as degraded without parsing the body. Body always has the detail.
    return res.status(report.overall === 'ok' ? 200 : 503).json(body);
  } catch (err: unknown) {
    // Probe itself failed (DB unreachable) — distinct from schema-missing.
    const message = err instanceof Error ? err.message : String(err);
    logger.error('billing_health_probe_failed', { message });
    return res.status(503).json({
      generatedAt: new Date().toISOString(),
      status: { overall: 'probe_unavailable', healthy: false },
      error: 'Billing schema probe failed — verify DB connectivity.',
      detail: message,
    });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/admin/billing/health' });
