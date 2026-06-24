/**
 * activationOutreachService.ts
 *
 * GOVERNED activation-outreach send path (Phase 25C). Converts the raw `activation_outreach`
 * email primitive into a customer-activation operation that can ONLY target a valid CUSTOMER
 * company's active admin.
 *
 * The recipient is NEVER caller-supplied: it is resolved from the company's active admin. The
 * caller supplies only a `company_id`. Eligibility is a pure function (hermetically testable);
 * the async sender wires loaders + audit logging + the low-level email seam.
 *
 * This phase builds the path but does NOT send (no real outreach, no OUTREACH_SENT/CONTACTED).
 */

import {
  buildRow,
  type CustomerActivationInput,
  type MilestoneKey,
} from './customerActivationWorkbenchService';
import { sendActivationOutreach } from './emailService';

export type TenantClassification =
  | 'CUSTOMER' | 'QA' | 'TEST' | 'INTERNAL' | 'DEMO' | 'UNKNOWN' | null;

export type OutreachRejectReason =
  | 'COMPANY_NOT_FOUND'
  | 'NOT_CUSTOMER'          // covers QA / TEST / INTERNAL / DEMO / UNKNOWN / untracked
  | 'NO_ACTIVE_ADMIN'
  | 'ALREADY_ACTIVATED';   // nothing to nudge

/** Fully-resolved context for a governance decision (loaded server-side). */
export interface OutreachContext {
  company_id: string;
  company_exists: boolean;
  company_name: string | null;
  classification: TenantClassification;
  admin_email: string | null;            // resolved from the active admin, never caller input
  activation: CustomerActivationInput | null;
  app_url: string;
}

export type OutreachDecision =
  | {
      ok: true;
      // `reason` is declared (optional, always absent) on the success branch so
      // `decision.reason` is a valid property of the whole union. The worker
      // tsconfig runs with `strict:false`, which does NOT narrow the `ok`
      // discriminant — without this, the `!decision.ok` reject branch reads of
      // `.reason` fail to compile (TS2339). Behavior is unchanged: success
      // returns never set it.
      reason?: undefined;
      company_id: string;
      recipientEmail: string;
      companyName: string | null;
      missingMilestones: MilestoneKey[];
      ctaUrl: string;
    }
  | { ok: false; reason: OutreachRejectReason };

/** PURE governance gate. Order matters: existence → CUSTOMER → admin → has-work. */
export function evaluateOutreach(ctx: OutreachContext): OutreachDecision {
  if (!ctx.company_exists) return { ok: false, reason: 'COMPANY_NOT_FOUND' };
  // Only CUSTOMER passes — QA / TEST / INTERNAL / DEMO / UNKNOWN / untracked all reject here.
  if (ctx.classification !== 'CUSTOMER') return { ok: false, reason: 'NOT_CUSTOMER' };
  if (!ctx.admin_email || !ctx.admin_email.includes('@')) return { ok: false, reason: 'NO_ACTIVE_ADMIN' };

  const remaining = ctx.activation ? buildRow(ctx.activation).remaining : [];
  if (remaining.length === 0) return { ok: false, reason: 'ALREADY_ACTIVATED' };

  return {
    ok: true,
    company_id: ctx.company_id,
    recipientEmail: ctx.admin_email,   // resolved, not supplied
    companyName: ctx.company_name,
    missingMilestones: remaining,
    ctaUrl: `${ctx.app_url.replace(/\/$/, '')}/integrations`,
  };
}

// ── Async governed sender (loaders + audit injected) ─────────────────────────

const ADMIN_ROLE = /owner|admin/i;

export interface GovernedOutreachDeps {
  db: { from: (t: string) => any };
  appUrl: string;
  now: () => string;
  /** the low-level send seam (emailService.sendActivationOutreach) — injectable for tests */
  send?: typeof sendActivationOutreach;
  /** audit sink — defaults to writing customer_activation_activity_log */
  audit?: (entry: { company_id: string; activity_type: string; status: string; notes: string }) => Promise<void>;
}

/** Resolve the full governance context for a company_id (server-side reads only). */
export async function loadOutreachContext(companyId: string, deps: GovernedOutreachDeps): Promise<OutreachContext> {
  const db = deps.db;
  const [clsRes, coRes, rolesRes, profRes, domRes, integRes] = await Promise.all([
    db.from('customer_population_classification').select('classification').eq('company_id', companyId).maybeSingle(),
    db.from('companies').select('id, name').eq('id', companyId).maybeSingle(),
    db.from('user_company_roles').select('user_id, role, status, created_at').eq('company_id', companyId).eq('status', 'active'),
    db.from('company_profiles').select('overall_confidence').eq('company_id', companyId).maybeSingle(),
    db.from('company_domains').select('verified, verification_status').eq('company_id', companyId),
    db.from('analytics_integrations').select('provider, status').eq('company_id', companyId),
  ]);

  const company = coRes?.data ?? null;
  // Resolve admin: active member, prefer owner/admin role, else earliest active member.
  const activeRoles: any[] = (rolesRes?.data ?? []).slice().sort((a: any, b: any) => String(a.created_at).localeCompare(String(b.created_at)));
  const adminRole = activeRoles.find((r) => ADMIN_ROLE.test(String(r.role ?? ''))) ?? activeRoles[0] ?? null;
  let admin_email: string | null = null;
  if (adminRole?.user_id) {
    const userRes = await db.from('users').select('email').eq('id', adminRole.user_id).maybeSingle();
    admin_email = userRes?.data?.email ?? null;
  }

  const domains: any[] = domRes?.data ?? [];
  const activation: CustomerActivationInput | null = company
    ? {
        company_id: companyId,
        company_name: company.name ?? companyId,
        profile_confidence: profRes?.data?.overall_confidence ?? null,
        domain_verified: domains.some((d) => d.verified === true || d.verification_status === 'verified' || d.verification_status === 'admin_override'),
        ga_status: (integRes?.data ?? []).find((a: any) => a.provider === 'GA4')?.status ?? null,
        gsc_status: (integRes?.data ?? []).find((a: any) => a.provider === 'GSC')?.status ?? null,
        active_team_members: activeRoles.length,
      }
    : null;

  return {
    company_id: companyId,
    company_exists: Boolean(company),
    company_name: company?.name ?? null,
    classification: (clsRes?.data?.classification ?? null) as TenantClassification,
    admin_email,
    activation,
    app_url: deps.appUrl,
  };
}

export interface GovernedOutreachResult {
  company_id: string;
  sent: boolean;
  reason?: OutreachRejectReason;
  recipientEmail?: string;
  error?: string;
}

/**
 * Governed send. Resolves the company → enforces CUSTOMER + active admin → derives milestones →
 * audits the attempt → sends via the low-level seam → audits the result.
 */
export async function sendGovernedActivationOutreach(companyId: string, deps: GovernedOutreachDeps): Promise<GovernedOutreachResult> {
  const send = deps.send ?? sendActivationOutreach;
  const audit = deps.audit ?? (async (entry) => {
    await deps.db.from('customer_activation_activity_log').insert({
      company_id: entry.company_id, activity_type: entry.activity_type, activity_date: deps.now(),
      owner: 'governed-activation-outreach', notes: entry.notes, status: entry.status,
    });
  });

  const ctx = await loadOutreachContext(companyId, deps);
  const decision = evaluateOutreach(ctx);

  if (!decision.ok) {
    await audit({ company_id: companyId, activity_type: 'OUTREACH_ATTEMPT', status: `rejected:${decision.reason}`, notes: `governed outreach rejected: ${decision.reason}` });
    return { company_id: companyId, sent: false, reason: decision.reason };
  }

  await audit({ company_id: companyId, activity_type: 'OUTREACH_ATTEMPT', status: 'attempted', notes: `governed outreach → ${decision.recipientEmail} (${decision.missingMilestones.join(', ')})` });
  try {
    await send(
      { recipientEmail: decision.recipientEmail, companyName: decision.companyName, missingMilestones: decision.missingMilestones, ctaUrl: decision.ctaUrl },
      `governed-outreach:${companyId}`,
    );
    await audit({ company_id: companyId, activity_type: 'OUTREACH_RESULT', status: 'success', notes: `sent to ${decision.recipientEmail}` });
    return { company_id: companyId, sent: true, recipientEmail: decision.recipientEmail };
  } catch (e: any) {
    await audit({ company_id: companyId, activity_type: 'OUTREACH_RESULT', status: 'failed', notes: String(e?.message ?? e).slice(0, 200) });
    return { company_id: companyId, sent: false, error: String(e?.message ?? e).slice(0, 200) };
  }
}
