/**
 * AUTH-ENFORCEMENT Phase 1 (Task 3a) — Observation Gate.
 * Design: docs/security/AUTH-ENFORCEMENT-ARCHITECTURE.md v3, §3.2/§6 Phase 1;
 * Decision 2 (approved 2026-08-02): Phase 1 is an OBSERVATION gate —
 * fail-safe, logging only, never blocks, never changes responses. The
 * fail-CLOSED Enforcement Gate (INV-10) arrives in Phase 2 and reuses the
 * same pure evaluator (./routePolicy evaluatePolicy); only the runtime mode
 * differs.
 *
 * Load-weight contract: this module is dynamically imported by the route
 * factory ONLY for routes that declare a policy, and it dynamically imports
 * the security graph (IdentityResolver pulls a module-load capability
 * invariant that THROWS on violation) ONLY when the rollout flag is non-off.
 * A route with no policy — every route after Task 3a — never loads any of it.
 */
import type { NextApiRequest } from 'next';
import { defineRolloutFlag, resolveRolloutSync } from './rollout';
import { setPrincipal } from './requestContext';
import { recordRawCounter } from '../../backend/observability';
import { logger } from '../../backend/services/logger';
import {
  evaluatePolicy,
  type PolicyDecision,
  type PolicyPrincipalView,
  type PolicyRequestView,
  type RoutePolicy,
} from './routePolicy';

export const ROUTE_POLICY_GATE_FLAG = defineRolloutFlag({
  key: 'route-policy-gate',
  description:
    'AUTH-ENFORCEMENT Phase 1 observation gate: evaluate declared route policies and log would-allow/would-deny. Observation only — never blocks. Default off.',
  defaultMode: 'off',
});

/** Resolve identity into the pure principal view. Heavy imports stay lazy. */
async function buildPrincipalView(req: NextApiRequest): Promise<PolicyPrincipalView> {
  const [identity, contentArchitect] = await Promise.all([
    import('../../backend/security/IdentityResolver'),
    import('../../backend/services/contentArchitectService'),
  ]);
  const isContentArchitect = contentArchitect.isContentArchitectSession(req);
  const result = await identity.resolvePrincipal(req);
  if (!result.ok) {
    return { authenticated: false, isContentArchitect };
  }
  const p = result.principal;
  const organizationRoles: Record<string, string> = {};
  for (const m of p.organizations) {
    if (m.status === 'active' || m.status === 'invited') {
      organizationRoles[m.organizationId] = m.role;
    }
  }
  const isPlatformSuperAdmin =
    p.legacyCookieSuperAdmin || Object.values(organizationRoles).includes('SUPER_ADMIN');
  // INV-8: memoise the resolved principal in the request context (fail-safe).
  try {
    setPrincipal({ userId: p.userId, orgId: p.activeOrgId ?? undefined });
  } catch {
    /* observation must not depend on context availability */
  }
  return {
    authenticated: true,
    userId: p.userId,
    organizationRoles,
    isPlatformSuperAdmin,
    isContentArchitect,
    capabilities: p.capabilities,
  };
}

function buildRequestView(route: string, req: NextApiRequest): PolicyRequestView {
  return {
    route,
    method: req.method ?? undefined,
    query: req.query as PolicyRequestView['query'],
    body: req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : undefined,
    // secretValid / signatureValid deliberately absent in Phase 1: machine-auth
    // categories ABSTAIN under observation; fact verification ships with Phase 2.
  };
}

function logObservation(route: string, decision: PolicyDecision): void {
  logger.info('route_policy_shadow_observation', {
    route,
    category: decision.category,
    wouldAllow: decision.wouldAllow,
    wouldDeny: decision.wouldDeny,
    reason: decision.reason,
    outcome: decision.outcome,
    decision_schema: decision.decisionSchemaVersion,
    policy_version: decision.policyVersion,
  });
  recordRawCounter('route_policy.shadow', 1, {
    route,
    category: decision.category,
    result: decision.outcome === 'abstain' ? 'abstain' : decision.wouldDeny ? 'would_deny' : 'would_allow',
  });
}

/**
 * Observe a declared policy for one request. Never throws, never writes to the
 * response, never blocks. In Phase 1 EVERY non-off mode (shadow AND enforce)
 * observes only — enforcement semantics do not exist until Phase 2, so a
 * premature 'enforce' flag cannot change behavior.
 */
export async function observePolicy(
  policy: RoutePolicy,
  route: string,
  req: NextApiRequest,
): Promise<void> {
  try {
    const { mode } = resolveRolloutSync(ROUTE_POLICY_GATE_FLAG, {});
    if (mode === 'off') return;
    const principalView = await buildPrincipalView(req);
    const requestView = buildRequestView(route, req);
    const decision = evaluatePolicy(policy, principalView, requestView);
    logObservation(route, decision);
  } catch (err) {
    try {
      logger.warn('route_policy_observation_error', {
        route,
        message: err instanceof Error ? err.message : String(err),
      });
      recordRawCounter('route_policy.observe_error', 1, { route });
    } catch {
      /* observation errors must never surface */
    }
  }
}
