/**
 * AUTH-ENFORCEMENT Phase 1 (Task 3a) — Route Policy schema + pure evaluation.
 * Design: docs/security/AUTH-ENFORCEMENT-ARCHITECTURE.md v3 (§3.4 schema,
 * §4 validation matrix).
 *
 * PURITY CONTRACT (approved refinement, 2026-08-02): everything in this module
 * is pure. No identity resolution, no rollout flags, no logging, no metrics,
 * no AsyncLocalStorage, no runtime imports, no response writes, no time or
 * randomness. `evaluatePolicy(policy, principalView, requestView)` is a total,
 * deterministic function — identical inputs always produce an identical
 * PolicyDecision. The Observation Gate (Phase 1, ./policyGate) and the
 * Enforcement Gate (Phase 2) both consume THIS evaluator; only the runtime
 * mode differs.
 *
 * Secret material never enters this module: machine-auth categories receive
 * pre-verified boolean FACTS (`secretValid` / `signatureValid`) computed by the
 * caller, and ABSTAIN when a fact is absent — Phase 1 supplies none.
 */
import type { Capability } from '../../shared/contracts/security';

// ── Policy schema (v1) ───────────────────────────────────────────────────────

/** Where a tenant ASSERTION arrives in the request (INV-1: never an authority). */
export type PolicySource =
  | `query.${string}`
  | `path.${string}`
  | `body.${string}`
  | 'context';

/** Reference to a shared secret BY ENV VAR NAME — never the value itself. */
export interface SecretRef {
  env: string;
}

/** Signature schemes with in-repo reference implementations (paymentWebhookVerifier). */
export type SignatureScheme = 'hmac-sha256' | 'stripe' | 'razorpay' | 'cashfree' | 'phonepe';

/**
 * Roles accepted by role-gated categories. String-literal mirror of the
 * rbacPrimitives Role values so this module stays dependency-free; the
 * validator/tests pin the correspondence.
 */
export type AdminRole = 'ADMIN' | 'COMPANY_ADMIN' | 'SUPER_ADMIN';

export type RoutePolicy =
  | { v: 1; category: 'public'; justification: string }
  | { v: 1; category: 'authenticated-user' }
  | { v: 1; category: 'tenant-scoped'; tenantFrom: 'context'; capability?: Capability }
  | { v: 1; category: 'company-scoped'; companyIdFrom: PolicySource; capability?: Capability }
  | { v: 1; category: 'admin'; companyIdFrom: PolicySource; role: AdminRole }
  | { v: 1; category: 'super-admin'; audit: true }
  | { v: 1; category: 'internal'; secret: SecretRef }
  | { v: 1; category: 'worker-cron'; secret: SecretRef }
  | { v: 1; category: 'webhook-receiver'; provider: string; signature: SignatureScheme; replayWindowSec: number }
  | { v: 1; category: 'webhook-management'; companyIdFrom: PolicySource; role: AdminRole }
  | { v: 1; category: 'system-health'; exposure: 'public' | 'secret' };

export type PolicyCategory = RoutePolicy['category'];

const CATEGORIES: readonly PolicyCategory[] = [
  'public', 'authenticated-user', 'tenant-scoped', 'company-scoped', 'admin',
  'super-admin', 'internal', 'worker-cron', 'webhook-receiver',
  'webhook-management', 'system-health',
];

// ── Validation (§4.1 rejection matrix — the statically checkable rows) ───────

export interface PolicyIssue {
  /** Matrix row id from the design doc (V-1 … V-13). */
  rule: string;
  /** Canonical severity per §4.1. Phase 1 CI REPORTS errors as warnings (C-3). */
  severity: 'error' | 'warn';
  message: string;
}

const SOURCE_RE = /^(query|path|body)\.[A-Za-z0-9_]+$|^context$/;
const PLACEHOLDER_JUSTIFICATION_RE = /^(\s*|todo|tbd|placeholder|n\/a|none|x+|\.+)$/i;

function issue(rule: string, message: string, severity: 'error' | 'warn' = 'error'): PolicyIssue {
  return { rule, severity, message };
}

/**
 * Semantic validation of a policy value. The discriminated union already makes
 * most invalid shapes a COMPILE error; this runtime pass covers JS callers,
 * dynamic construction, and the rows the type system cannot express (V-8
 * unknown version, V-10 placeholder justification, V-5 non-positive window).
 * Rows needing repo context (V-6 cache headers, V-7 import-graph reach, V-9
 * one-per-file, V-11/V-12 handler-body analysis) belong to the CI scanner.
 */
export function validateRoutePolicy(policy: unknown): PolicyIssue[] {
  const issues: PolicyIssue[] = [];
  if (typeof policy !== 'object' || policy === null) {
    return [issue('V-8', 'policy must be an object literal')];
  }
  const p = policy as Record<string, unknown>;

  if (p.v !== 1) {
    issues.push(issue('V-8', `unknown or missing policy schema version v=${String(p.v)} (expected 1)`));
  }
  const category = p.category as PolicyCategory;
  if (!CATEGORIES.includes(category)) {
    issues.push(issue('V-8', `unknown category '${String(p.category)}'`));
    return issues;
  }

  const hasTenantSource = 'companyIdFrom' in p || 'tenantFrom' in p;
  if (category === 'public') {
    if (hasTenantSource) issues.push(issue('V-1', 'public policy cannot carry a tenant source'));
    if (typeof p.justification !== 'string' || PLACEHOLDER_JUSTIFICATION_RE.test(p.justification)) {
      issues.push(issue('V-10', 'public policy requires a non-placeholder justification'));
    }
  }
  if ((category === 'tenant-scoped' && p.tenantFrom !== 'context') ||
      (category === 'company-scoped' && typeof p.companyIdFrom !== 'string')) {
    issues.push(issue('V-2', `${category} policy requires its tenant source`));
  }
  if ((category === 'admin' || category === 'webhook-management') && typeof p.companyIdFrom !== 'string') {
    issues.push(issue('V-2', `${category} policy requires companyIdFrom`));
  }
  for (const key of ['companyIdFrom'] as const) {
    if (typeof p[key] === 'string' && !SOURCE_RE.test(p[key] as string)) {
      issues.push(issue('V-2', `${key} '${String(p[key])}' is not a valid PolicySource`));
    }
  }
  if ((category === 'worker-cron' || category === 'internal') &&
      (typeof p.secret !== 'object' || p.secret === null || typeof (p.secret as SecretRef).env !== 'string')) {
    issues.push(issue('V-3', `${category} policy requires a secret reference`));
  }
  if (category === 'webhook-receiver') {
    if (typeof p.signature !== 'string') issues.push(issue('V-4', 'webhook-receiver policy requires a signature scheme'));
    if (typeof p.replayWindowSec !== 'number' || !(p.replayWindowSec > 0)) {
      issues.push(issue('V-5', 'webhook-receiver policy requires a positive replayWindowSec'));
    }
    if ('role' in p) issues.push(issue('V-1', 'webhook-receiver policy cannot carry a role'));
  }
  if (category === 'super-admin' && p.audit !== true) {
    issues.push(issue('V-13', 'super-admin policy requires audit: true'));
  }
  return issues;
}

// ── Pure evaluation ──────────────────────────────────────────────────────────

export const POLICY_DECISION_SCHEMA_VERSION = 1 as const;

/**
 * The principal FACTS the caller has already resolved. This is a plain value —
 * the evaluator never resolves anything itself.
 */
export interface PolicyPrincipalView {
  authenticated: boolean;
  userId?: string;
  /** organizationId → role for the principal's memberships. */
  organizationRoles?: Readonly<Record<string, string>>;
  isPlatformSuperAdmin?: boolean;
  isContentArchitect?: boolean;
  capabilities?: readonly string[];
}

/** The request FACTS relevant to evaluation. Never carries secret material. */
export interface PolicyRequestView {
  route: string;
  method?: string;
  /** Query params (Next.js folds path params into query). */
  query?: Readonly<Record<string, string | readonly string[] | undefined>>;
  body?: Readonly<Record<string, unknown>>;
  /** Pre-verified machine-auth facts (computed by the gate, Phase 2+). */
  secretValid?: boolean;
  signatureValid?: boolean;
}

export type PolicyOutcome = 'allow' | 'deny' | 'abstain';

export interface PolicyDecision {
  /** Version of THIS result shape — independent of the policy's `v`. */
  decisionSchemaVersion: typeof POLICY_DECISION_SCHEMA_VERSION;
  policyVersion: 1;
  category: PolicyCategory;
  outcome: PolicyOutcome;
  wouldAllow: boolean;
  wouldDeny: boolean;
  /** Stable machine-readable reason code (INV-9 attribution). */
  reason: string;
  /** The tenant id the request ASSERTED, when the category carries one (INV-1). */
  assertedTenantId?: string;
}

function decision(
  policy: RoutePolicy,
  outcome: PolicyOutcome,
  reason: string,
  assertedTenantId?: string,
): PolicyDecision {
  const d: PolicyDecision = {
    decisionSchemaVersion: POLICY_DECISION_SCHEMA_VERSION,
    policyVersion: policy.v,
    category: policy.category,
    outcome,
    wouldAllow: outcome === 'allow',
    wouldDeny: outcome === 'deny',
    reason,
  };
  if (assertedTenantId !== undefined) d.assertedTenantId = assertedTenantId;
  return d;
}

/** Read a PolicySource assertion out of the request view. `context` → undefined. */
function readAssertedId(source: PolicySource, view: PolicyRequestView): string | undefined {
  if (source === 'context') return undefined;
  const dot = source.indexOf('.');
  const kind = source.slice(0, dot);
  const field = source.slice(dot + 1);
  if (kind === 'query' || kind === 'path') {
    const v = view.query?.[field];
    if (Array.isArray(v)) return typeof v[0] === 'string' ? v[0] : undefined;
    return typeof v === 'string' ? v : undefined;
  }
  const v = view.body?.[field];
  return typeof v === 'string' ? v : undefined;
}

function capabilityCheck(
  policy: { capability?: Capability },
  principal: PolicyPrincipalView,
): { ok: boolean; abstain: boolean } {
  if (!policy.capability) return { ok: true, abstain: false };
  if (principal.capabilities === undefined) return { ok: false, abstain: true };
  return { ok: principal.capabilities.includes(policy.capability), abstain: false };
}

function evaluateMembership(
  policy: Extract<RoutePolicy, { companyIdFrom: PolicySource }>,
  principal: PolicyPrincipalView,
  request: PolicyRequestView,
  roleRequirement?: AdminRole,
): PolicyDecision {
  const asserted = readAssertedId(policy.companyIdFrom, request);
  if (policy.companyIdFrom !== 'context' && asserted === undefined) {
    return decision(policy, 'deny', 'missing_tenant_assertion');
  }
  if (!principal.authenticated) {
    if (principal.isContentArchitect) return decision(policy, 'allow', 'content_architect', asserted);
    return decision(policy, 'deny', 'unauthenticated', asserted);
  }
  if (principal.isPlatformSuperAdmin) return decision(policy, 'allow', 'platform_super_admin', asserted);
  if (principal.isContentArchitect) return decision(policy, 'allow', 'content_architect', asserted);
  if (principal.organizationRoles === undefined) {
    return decision(policy, 'abstain', 'membership_facts_unavailable', asserted);
  }
  if (asserted === undefined) {
    // context-bound: the server derives the tenant; an authenticated member acts in it.
    return decision(policy, 'allow', 'tenant_context_server_derived');
  }
  const role = principal.organizationRoles[asserted];
  if (role === undefined) return decision(policy, 'deny', 'not_a_member', asserted);
  if (roleRequirement !== undefined && role !== roleRequirement && role !== 'SUPER_ADMIN') {
    return decision(policy, 'deny', 'insufficient_role', asserted);
  }
  const cap = capabilityCheck(policy as { capability?: Capability }, principal);
  if (cap.abstain) return decision(policy, 'abstain', 'capability_facts_unavailable', asserted);
  if (!cap.ok) return decision(policy, 'deny', 'missing_capability', asserted);
  return decision(policy, 'allow', roleRequirement ? 'role_confirmed' : 'membership_confirmed', asserted);
}

function evaluateVerifiedFact(
  policy: RoutePolicy,
  fact: boolean | undefined,
  kind: 'secret' | 'signature',
): PolicyDecision {
  if (fact === true) return decision(policy, 'allow', `${kind}_verified`);
  if (fact === false) return decision(policy, 'deny', `${kind}_invalid`);
  return decision(policy, 'abstain', `${kind}_facts_unavailable`);
}

/**
 * (policy, principalView, requestView) → PolicyDecision. Pure and total:
 * every category returns exactly one decision; unknown facts ABSTAIN rather
 * than guess (wouldAllow and wouldDeny both false).
 */
export function evaluatePolicy(
  policy: RoutePolicy,
  principal: PolicyPrincipalView,
  request: PolicyRequestView,
): PolicyDecision {
  switch (policy.category) {
    case 'public':
      return decision(policy, 'allow', 'public_route');
    case 'authenticated-user':
      return principal.authenticated
        ? decision(policy, 'allow', 'authenticated')
        : decision(policy, 'deny', 'unauthenticated');
    case 'tenant-scoped': {
      if (!principal.authenticated) return decision(policy, 'deny', 'unauthenticated');
      const cap = capabilityCheck(policy, principal);
      if (cap.abstain) return decision(policy, 'abstain', 'capability_facts_unavailable');
      if (!cap.ok) return decision(policy, 'deny', 'missing_capability');
      return decision(policy, 'allow', 'tenant_context_server_derived');
    }
    case 'company-scoped':
      return evaluateMembership(policy, principal, request);
    case 'admin':
      return evaluateMembership(policy, principal, request, policy.role);
    case 'webhook-management':
      return evaluateMembership(policy, principal, request, policy.role);
    case 'super-admin':
      if (principal.isPlatformSuperAdmin === undefined) {
        return decision(policy, 'abstain', 'super_admin_facts_unavailable');
      }
      return principal.isPlatformSuperAdmin
        ? decision(policy, 'allow', 'platform_super_admin')
        : decision(policy, 'deny', 'not_super_admin');
    case 'internal':
    case 'worker-cron':
      return evaluateVerifiedFact(policy, request.secretValid, 'secret');
    case 'webhook-receiver':
      return evaluateVerifiedFact(policy, request.signatureValid, 'signature');
    case 'system-health':
      return policy.exposure === 'public'
        ? decision(policy, 'allow', 'public_route')
        : evaluateVerifiedFact(policy, request.secretValid, 'secret');
  }
}
