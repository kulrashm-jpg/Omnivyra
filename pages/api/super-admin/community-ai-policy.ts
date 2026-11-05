import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import { isPlatformSuperAdmin } from '../../../backend/services/rbacService';
import { getLegacySuperAdminSession } from '../../../backend/services/superAdminSession';
import { requireCapability } from '../../../backend/security/requireCapability';
import { requireAdminRateLimit } from '../../../backend/services/requestAccessService';
import { INTELLIGENCE_OVERRIDE_MANAGE } from '../../../shared/contracts/security';
import { getTrustedClientIpOrNull } from '../../../lib/security/clientIp';
import { logSecurityEvent } from '../../../backend/security/audit/SecurityAuditService';
import {
  readCommunityPolicyRow,
  invalidateCommunityExecutionPolicyCache,
  type CommunityPolicyRow,
} from '../../../backend/services/communityAiPlatformPolicyService';

/**
 * Community AI execution policy — the platform row (organization_id omitted / null: the
 * platform kill switch, which must exist and be enabled for any tenant to execute) or one tenant's row (organization_id).
 *
 * Prompt 3:
 *   - OD-1: nothing permissive by default. A row created here is CLOSED for every field it
 *     does not name, and is never created open (the DB refuses an open INSERT). Nothing is
 *     auto-created. require_human_approval cannot be turned off: no AI flag, score or
 *     policy waives the human approval (400 HUMAN_APPROVAL_NOT_WAIVABLE).
 *   - OD-2 / LD-5: a change that LOOSENS (execution_enabled or auto_rules_enabled
 *     false → true) needs two different authorised operators. The initiator's POST records
 *     a request (requested_execution_enabled / requested_auto_rules_enabled / requested_by;
 *     requested_at is stamped by the database) and loosens nothing. A DIFFERENT operator
 *     confirms it (action 'confirm', request_id = the request's requested_at) and exactly the
 *     requested values are applied. The trigger community_ai_platform_policy_two_person
 *     (20270126000003) enforces the same: confirmer (updated_by) ≠ requester, request under
 *     1 hour old, applied = requested; it clears the request. A change that only TIGHTENS
 *     applies at once, single operator.
 *   - F2 (stale request): a request records the flags it was made against
 *     (requested_base_execution_enabled / requested_base_auto_rules_enabled). A confirmation
 *     applies only while the row's CURRENT flags still equal that base (checked here and by
 *     compare-and-set; the trigger enforces it too), and any tightening clears a pending
 *     request. So a request made before a kill switch can never re-open it.
 *   - Every step: requireCapability(INTELLIGENCE_OVERRIDE_MANAGE) with its step-up, plus
 *     logSecurityEvent, plus the existing audit_logs / super_admin_audit_logs rows.
 *   - The override changes this policy only; approval, passkey and expiry still apply.
 */

type PolicyFlags = {
  execution_enabled: boolean;
  auto_rules_enabled: boolean;
};

type PolicyInput = Partial<PolicyFlags> & {
  require_human_approval?: boolean;
  organization_id?: string | null;
  action?: 'request' | 'confirm' | 'cancel';
  request_id?: string;
};

const FLAG_KEYS = ['execution_enabled', 'auto_rules_enabled'] as const;
const ALLOWED_KEYS = [...FLAG_KEYS, 'require_human_approval', 'organization_id', 'action', 'request_id'];

/** Closed values for any field a NEW row does not name (OD-1). */
const CLOSED_FLAGS: PolicyFlags = { execution_enabled: false, auto_rules_enabled: false };

/** How long a pending request may wait for its second operator (= the DB trigger's TTL). */
const OVERRIDE_REQUEST_TTL_MS = 60 * 60_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CAPABILITY = INTELLIGENCE_OVERRIDE_MANAGE;

// READ guard: bridge accepted via centralized helper (signature-validated +
// dry-run-aware). Mutations gate separately on `requireCapability`.
const requireSuperAdminRead = async (
  req: NextApiRequest,
  res: NextApiResponse
): Promise<{ userId: string; email: string | null } | null> => {
  const { user, error } = await getSupabaseUserFromRequest(req);
  if (!error && user?.id) {
    const isAdmin = await isPlatformSuperAdmin(user.id);
    if (isAdmin) return { userId: user.id, email: user.email || null };
  }
  const legacy = getLegacySuperAdminSession(req);
  if (legacy) {
    return { userId: legacy.userId, email: 'superadmin' };
  }
  res.status(401).json({ error: 'UNAUTHORIZED' });
  return null;
};

const resolveUpdatedByEmail = async (userId?: string | null) => {
  if (!userId) return null;
  const { data, error } = await supabase.from('users').select('email').eq('id', userId).maybeSingle();
  if (error) return null;
  return data?.email || null;
};

const readOrgParam = (raw: unknown): { ok: true; organizationId: string | null } | { ok: false } => {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (v === undefined || v === null || v === '') return { ok: true, organizationId: null };
  if (typeof v !== 'string' || !UUID.test(v)) return { ok: false };
  return { ok: true, organizationId: v };
};

const flagsOf = (row: CommunityPolicyRow | null): PolicyFlags | null =>
  row
    ? { execution_enabled: row.execution_enabled === true, auto_rules_enabled: row.auto_rules_enabled === true }
    : null;

/** True when `next` grants anything `current` (or a missing row) does not. */
const isLoosening = (current: PolicyFlags | null, next: PolicyFlags): boolean => {
  const base = current ?? CLOSED_FLAGS;
  return (next.execution_enabled && !base.execution_enabled) || (next.auto_rules_enabled && !base.auto_rules_enabled);
};

/**
 * A pending request: a requester AND at least one requested value. A request that asks
 * for nothing is a withdrawal (the two-person trigger clears it the same way), never a
 * request that can be confirmed.
 */
const hasPendingRequest = (row: CommunityPolicyRow | null | undefined): boolean =>
  !!row && !!row.requested_by
  && (typeof row.requested_execution_enabled === 'boolean' || typeof row.requested_auto_rules_enabled === 'boolean');

const pendingView = (row: CommunityPolicyRow | null) =>
  hasPendingRequest(row) && row
    ? {
        request_id: row.requested_at ?? null,
        requested_by: row.requested_by,
        requested_at: row.requested_at ?? null,
        change: {
          execution_enabled: row.requested_execution_enabled ?? null,
          auto_rules_enabled: row.requested_auto_rules_enabled ?? null,
        },
        base: {
          execution_enabled: row.requested_base_execution_enabled ?? null,
          auto_rules_enabled: row.requested_base_auto_rules_enabled ?? null,
        },
      }
    : null;

/** Every pending-request column, cleared together (cancel, or a tightening). */
const CLEARED_REQUEST = {
  requested_execution_enabled: null,
  requested_auto_rules_enabled: null,
  requested_base_execution_enabled: null,
  requested_base_auto_rules_enabled: null,
  requested_by: null,
  requested_at: null,
} as const;

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    const admin = await requireSuperAdminRead(req, res);
    if (!admin) return;
    const scope = readOrgParam(req.query?.organization_id);
    if (!scope.ok) return res.status(400).json({ error: 'INVALID_ORGANIZATION_ID' });
    const read = await readCommunityPolicyRow(scope.organizationId);
    if (read.ok !== true) {
      // No permissive interpretation: an unreadable policy is reported as such.
      return res.status(200).json({ policy: null, pending_override: null, updated_by_email: null, read_error: read.code, organization_id: scope.organizationId });
    }
    const updatedByEmail = await resolveUpdatedByEmail(read.row?.updated_by);
    return res.status(200).json({
      policy: read.row || null,
      pending_override: pendingView(read.row),
      updated_by_email: updatedByEmail,
      organization_id: scope.organizationId,
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Closure-014 (D): per-route write rate limit (before authorization and any business work).
  if (!(await requireAdminRateLimit(req, res, 'rl:super-admin:community-ai-policy', 10, 60, { sensitive: true }))) return;

  const input = (req.body || {}) as PolicyInput;
  const step = input.action ?? 'request';
  const knownStep = step === 'request' || step === 'confirm' || step === 'cancel';

  // Phase 2 mutation gate, before any input validation: an unauthorized
  // caller learns nothing about the body. INTELLIGENCE_OVERRIDE_MANAGE is held
  // only by canonical SUPER_ADMIN (step-up required); bridge principals
  // receive 403 CAPABILITY_NOT_HELD.
  const guard = await requireCapability(req, res, {
    capability: CAPABILITY,
    reason: `community-AI policy ${knownStep ? step : 'invalid-action'}`,
  });
  if (guard.ok !== true) return;

  const hasUnknownKey = Object.keys(input).some((key) => !ALLOWED_KEYS.includes(key));
  if (hasUnknownKey) {
    return res.status(400).json({ error: 'INVALID_FIELDS' });
  }
  const scope = readOrgParam(input.organization_id);
  if (!scope.ok) return res.status(400).json({ error: 'INVALID_ORGANIZATION_ID' });
  const organizationId = scope.organizationId;
  if (!knownStep) {
    return res.status(400).json({ error: 'INVALID_ACTION' });
  }
  if (input.require_human_approval === false) {
    return res.status(400).json({
      error: 'HUMAN_APPROVAL_NOT_WAIVABLE',
      reason: 'human approval of external community execution cannot be turned off',
    });
  }
  const operatorId = typeof guard.principal.userId === 'string' && UUID.test(guard.principal.userId)
    ? guard.principal.userId
    : null;
  const admin = { userId: guard.principal.userId, email: guard.principal.email || null };
  const ip = getTrustedClientIpOrNull(req);
  const userAgent = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null;
  const security = (decision: 'allowed' | 'denied', reason: string, resourceId?: string | null) =>
    logSecurityEvent({
      capability: CAPABILITY,
      decision,
      reason: `community_ai_policy:${reason}`,
      actorUserId: operatorId,
      principalUserId: operatorId,
      organizationId,
      resourceId: resourceId ?? null,
      ip,
      userAgent,
    });

  const loaded = await readCommunityPolicyRow(organizationId);
  if (loaded.ok !== true) {
    await security('denied', `load_failed:${loaded.code}`);
    return res.status(loaded.code === 'POLICY_AMBIGUOUS' ? 409 : 500).json({ error: 'FAILED_TO_LOAD_POLICY', code: loaded.code });
  }
  const existing = loaded.row;

  const audit = async (event: string, previous: unknown, next: unknown) => {
    await supabase.from('audit_logs').insert({
      actor_user_id: operatorId,
      action: 'UPDATE_COMMUNITY_AI_PLATFORM_POLICY',
      metadata: { event, organization_id: organizationId, previous: previous ?? null, next: next ?? null },
      created_at: new Date().toISOString(),
    });
    await supabase.from('super_admin_audit_logs').insert({
      username: admin.email || admin.userId,
      action: 'update_policy',
      // SEC91-W2E: platform-trusted client IP, or null (was the raw client-written XFF header).
      ip_address: ip,
      user_agent: req.headers['user-agent'] || null,
      created_at: new Date().toISOString(),
    });
  };

  const respond = async (saved: CommunityPolicyRow | null, status = 200, extra: Record<string, unknown> = {}) => {
    invalidateCommunityExecutionPolicyCache(organizationId);
    const updatedByEmail = await resolveUpdatedByEmail(saved?.updated_by);
    return res.status(status).json({
      policy: saved,
      pending_override: pendingView(saved),
      updated_by_email: updatedByEmail,
      organization_id: organizationId,
      ...extra,
    });
  };

  // request_id is the request's server-stamped requested_at; compared as an instant (ms),
  // since its textual form depends on the client library.
  const matchesPending = (requestId: unknown) => {
    if (!hasPendingRequest(existing) || typeof requestId !== 'string' || requestId === '') return false;
    const a = Date.parse(String(existing.requested_at ?? ''));
    const b = Date.parse(requestId);
    return Number.isFinite(a) && Number.isFinite(b) && a === b;
  };
  /** CAS on exactly the pending request that was read (requester, requested values and base). */
  const samePending = (q: any) => {
    let out = q.eq('id', existing!.id).eq('requested_by', existing!.requested_by);
    for (const col of [
      'requested_execution_enabled', 'requested_auto_rules_enabled',
      'requested_base_execution_enabled', 'requested_base_auto_rules_enabled',
    ] as const) {
      const v = existing![col];
      out = typeof v === 'boolean' ? out.eq(col, v) : out.is(col, null);
    }
    return out;
  };

  // ── cancel a pending request (single operator; it loosens nothing) ─────────
  if (step === 'cancel') {
    if (!matchesPending(input.request_id)) {
      return res.status(409).json({ error: 'NO_MATCHING_OVERRIDE_REQUEST' });
    }
    const { data, error } = await samePending(
      supabase
        .from('community_ai_platform_policy')
        .update({ ...CLEARED_REQUEST }),
    )
      .select('*')
      .maybeSingle();
    if (error || !data) return res.status(409).json({ error: 'NO_MATCHING_OVERRIDE_REQUEST' });
    await security('allowed', 'override_cancelled', String(input.request_id));
    await audit('override_cancelled', pendingView(existing), null);
    return respond(data as CommunityPolicyRow);
  }

  // ── confirm: the independent second operator applies exactly the request ──
  if (step === 'confirm') {
    const requestId = typeof input.request_id === 'string' ? input.request_id : '';
    if (FLAG_KEYS.some((k) => input[k] !== undefined) || input.require_human_approval !== undefined) {
      return res.status(400).json({ error: 'CONFIRM_TAKES_NO_CHANGE', reason: 'the confirmed change is the one requested' });
    }
    if (!matchesPending(requestId)) {
      await security('denied', 'override_confirm_no_request', requestId || null);
      return res.status(409).json({ error: 'NO_MATCHING_OVERRIDE_REQUEST' });
    }
    if (!operatorId) {
      await security('denied', 'override_confirm_unattributable', requestId);
      return res.status(403).json({ error: 'OVERRIDE_REQUIRES_ATTRIBUTABLE_OPERATOR' });
    }
    if (existing!.requested_by === operatorId) {
      await security('denied', 'override_self_confirm', requestId);
      return res.status(403).json({ error: 'OVERRIDE_SELF_CONFIRM_FORBIDDEN', reason: 'a second, different operator must confirm' });
    }
    const requestedMs = Date.parse(String(existing!.requested_at ?? ''));
    if (!Number.isFinite(requestedMs) || Date.now() - requestedMs >= OVERRIDE_REQUEST_TTL_MS) {
      await security('denied', 'override_request_expired', requestId);
      return res.status(409).json({ error: 'OVERRIDE_REQUEST_EXPIRED' });
    }
    const current = flagsOf(existing)!;
    // F2: the request is valid only against the flags it was made on. A request with no
    // recorded base (or whose base no longer matches the row) is stale: refused.
    const baseExec = existing!.requested_base_execution_enabled;
    const baseAuto = existing!.requested_base_auto_rules_enabled;
    if (typeof baseExec !== 'boolean' || typeof baseAuto !== 'boolean'
      || existing!.execution_enabled !== baseExec || existing!.auto_rules_enabled !== baseAuto) {
      await security('denied', 'override_request_stale', requestId);
      return res.status(409).json({
        error: 'OVERRIDE_REQUEST_STALE',
        reason: 'the policy changed after this request was made; request again',
      });
    }
    const reqExec = existing!.requested_execution_enabled;
    const reqAuto = existing!.requested_auto_rules_enabled;
    const applied: PolicyFlags = {
      execution_enabled: typeof reqExec === 'boolean' ? reqExec : current.execution_enabled,
      auto_rules_enabled: typeof reqAuto === 'boolean' ? reqAuto : current.auto_rules_enabled,
    };
    // The requested_* columns are NOT written here: the trigger refuses a request and its
    // confirmation in one statement, and clears the request when it applies it. The CAS
    // also pins the CURRENT flags to the request's base.
    const { data, error } = await samePending(
      supabase
        .from('community_ai_platform_policy')
        .update({ ...applied, updated_at: new Date().toISOString(), updated_by: operatorId }),
    )
      .eq('execution_enabled', baseExec)
      .eq('auto_rules_enabled', baseAuto)
      .select('*')
      .maybeSingle();
    if (error || !data) {
      await security('denied', 'override_confirm_write_refused', requestId);
      return res.status(409).json({ error: 'OVERRIDE_CONFIRM_REFUSED' });
    }
    await security('allowed', 'override_confirmed', requestId);
    await audit('override_confirmed', current, applied);
    return respond(data as CommunityPolicyRow);
  }

  // ── request (default): a direct change ─────────────────────────────────────
  const hasValidValue = FLAG_KEYS.some((k) => typeof input[k] === 'boolean') || input.require_human_approval === true;
  if (!hasValidValue) {
    return res.status(400).json({ error: 'NO_VALID_FIELDS' });
  }
  const current = flagsOf(existing);
  // An omitted field keeps the stored value; with no stored row it is CLOSED (OD-1).
  const base = current ?? CLOSED_FLAGS;
  const nextPolicy: PolicyFlags = {
    execution_enabled: typeof input.execution_enabled === 'boolean' ? input.execution_enabled : base.execution_enabled,
    auto_rules_enabled: typeof input.auto_rules_enabled === 'boolean' ? input.auto_rules_enabled : base.auto_rules_enabled,
  };
  const nowIso = new Date().toISOString();
  const scopeColumns = organizationId ? { organization_id: organizationId, tenant_id: organizationId } : {};

  if (isLoosening(current, nextPolicy)) {
    // A change that loosens one flag and tightens another would hold the tightening
    // back behind the second operator; tighten first (immediately), then request.
    if (current && ((current.execution_enabled && !nextPolicy.execution_enabled)
      || (current.auto_rules_enabled && !nextPolicy.auto_rules_enabled))) {
      return res.status(400).json({
        error: 'MIXED_POLICY_CHANGE',
        reason: 'apply the tightening on its own (it takes effect at once), then request the loosening',
      });
    }
    // OD-2: two-person control. Record the request; nothing is loosened yet.
    if (!operatorId) {
      await security('denied', 'override_request_unattributable');
      return res.status(403).json({ error: 'OVERRIDE_REQUIRES_ATTRIBUTABLE_OPERATOR' });
    }
    const requestBase = current ?? CLOSED_FLAGS;
    const pending = {
      requested_execution_enabled: nextPolicy.execution_enabled,
      requested_auto_rules_enabled: nextPolicy.auto_rules_enabled,
      // F2: the flags this request was made against; a confirmation needs them unchanged.
      requested_base_execution_enabled: requestBase.execution_enabled,
      requested_base_auto_rules_enabled: requestBase.auto_rules_enabled,
      requested_by: operatorId,
      // Re-stamped by the database clock (two-person trigger).
      requested_at: nowIso,
    };
    let saved: CommunityPolicyRow | null = null;
    if (existing?.id) {
      const { data, error } = await supabase
        .from('community_ai_platform_policy')
        .update(pending)
        .eq('id', existing.id)
        .select('*')
        .maybeSingle();
      if (error) return res.status(500).json({ error: 'FAILED_TO_RECORD_OVERRIDE_REQUEST' });
      saved = data as CommunityPolicyRow;
    } else {
      // The row the request waits on is created CLOSED; only the confirmation opens it.
      const { data, error } = await supabase
        .from('community_ai_platform_policy')
        .insert({ ...CLOSED_FLAGS, require_human_approval: true, ...scopeColumns, ...pending, updated_at: nowIso, updated_by: operatorId })
        .select('*')
        .maybeSingle();
      if (error) return res.status(500).json({ error: 'FAILED_TO_RECORD_OVERRIDE_REQUEST' });
      saved = (Array.isArray(data) ? data[0] : data) as CommunityPolicyRow;
    }
    const requestId = saved?.requested_at ? String(saved.requested_at) : null;
    await security('allowed', 'override_requested', requestId);
    await audit('override_requested', current, nextPolicy);
    return respond(saved, 202, { status: 'pending_second_operator', request_id: requestId });
  }

  // Tightening (or no change): single operator, immediate. F2: a real tightening
  // (any flag true → false) also clears a pending request, so a request made before a
  // kill switch can never be confirmed after it.
  const updatedBy = operatorId;
  const tightens = !!current
    && ((current.execution_enabled && !nextPolicy.execution_enabled)
      || (current.auto_rules_enabled && !nextPolicy.auto_rules_enabled));
  const clearsPending = tightens && !!existing?.requested_by;
  let savedPolicy: CommunityPolicyRow | null = null;
  if (existing?.id) {
    const { data, error } = await supabase
      .from('community_ai_platform_policy')
      .update({
        ...nextPolicy,
        require_human_approval: true,
        ...(clearsPending ? CLEARED_REQUEST : {}),
        updated_at: nowIso,
        updated_by: updatedBy,
      })
      .eq('id', existing.id)
      .select('*')
      .maybeSingle();
    if (error) {
      await security('denied', 'update_failed');
      return res.status(500).json({ error: 'FAILED_TO_UPDATE_POLICY' });
    }
    savedPolicy = data as CommunityPolicyRow;
  } else {
    const { data, error } = await supabase
      .from('community_ai_platform_policy')
      .insert({
        ...nextPolicy,
        require_human_approval: true,
        ...scopeColumns,
        updated_at: nowIso,
        updated_by: updatedBy,
      })
      .select('*')
      .maybeSingle();
    if (error) {
      await security('denied', 'create_failed');
      return res.status(500).json({ error: 'FAILED_TO_CREATE_POLICY' });
    }
    savedPolicy = (Array.isArray(data) ? data[0] : data) as CommunityPolicyRow;
  }

  await security('allowed', existing ? 'tightened' : 'created_closed', savedPolicy?.id ?? null);
  if (clearsPending) await security('allowed', 'override_request_cleared_by_tightening', String(existing!.requested_at ?? ''));
  await audit('applied', existing || null, savedPolicy || null);
  return respond(savedPolicy);
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/super-admin/community-ai-policy' });
