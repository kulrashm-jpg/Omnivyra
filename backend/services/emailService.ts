/**
 * Transactional email helpers.
 *
 * Auth-event emails (signup confirm, magic link, password reset) are sent
 * by Supabase Auth itself via the SMTP configured at the project level —
 * this file does NOT touch those.
 *
 * The three helpers below are for emails Supabase Auth cannot send:
 *
 *   sendInvite                       — team invitation with our custom token URL
 *   sendCompanyAdminReferral         — "your company is already on Omnivyra"
 *   sendInboundSignupNoticeToAdmin   — admin notice when a prospect from the
 *                                      same domain tries to sign up
 *
 * All three delegate to the `send-transactional-email` Supabase Edge
 * Function, which holds the SES credentials and renders the HTML. Callers
 * remain best-effort: a delivery failure throws, and the caller decides
 * whether to retry, surface to the user, or swallow it.
 *
 * ═══ THE EMAIL / CONTACT-GOVERNANCE BOUNDARY (Phase 4C-5B) ═════════════════
 *
 * Every outbound email in this repository leaves through ONE chokepoint — the
 * `send-transactional-email` Edge Function — and it has FOUR production
 * invokers. Only one of them evaluates contact governance. This note records
 * that distinction so it is visible where email is written, rather than only in
 * an audit report.
 *
 * THIS COMMENT ENFORCES NOTHING. It describes the current implementation. The
 * only runtime enforcement that exists is Path B's, below; the inventory itself
 * is held by `backend/tests/unit/w2c5bEmailGovernanceBoundary.test.ts`, which
 * fails when a new invoker appears unclassified.
 *
 * ─── 1. PROSPECT OUTREACH — governed ──────────────────────────────────────
 * `leadOutreachExecution/emailTransport` only, reached through `dispatch.ts`.
 * Authorization is evaluated at dispatch, IMMEDIATELY BEFORE external delivery,
 * against canonical `contact_governance_records` (via `mayContact`) and then
 * `outreach_suppressions`. It FAILS CLOSED: an unreadable store blocks, and the
 * provider is never called on a block or a deferral.
 *
 * ─── 2. ACCOUNT / TRANSACTIONAL — ungoverned, and only PARTLY decided ─────
 * The helpers in THIS file (team invite, credentials, company referral, inbound
 * signup notice, credit alert), `domainReminderService`, and the queue drain at
 * `pages/api/cron/email-jobs.ts`. None consults contact governance.
 *
 * 2a. DECIDED — the domain-verification reminder (`domainReminderService`, E4).
 * The owner has ruled it an account/transactional communication about the
 * recipient's own platform account and verification status, and therefore
 * EXEMPT from the current prospect-contact governance restrictions. That is a
 * decision, not an inference, and it is why this path correctly does not call
 * `mayContact`.
 *
 * THE EXEMPTION IS E4 ONLY. It must not be generalised to the queue drain, to
 * the helpers in this file, or to any other transactional category. Each of
 * those remains the UNRESOLVED question described in 2b.
 *
 * 2b. UNDECIDED — everything else in this category. There is a real argument
 * for exempting account mail — a prospect who unsubscribed but is also a
 * platform admin must still receive credentials and billing notices — but
 * nobody has decided it, and the code enforces no boundary between the two
 * categories. Until that decision exists, do not add a marketing-shaped or
 * prospect-shaped email to this file or to the queue on the assumption that it
 * is exempt.
 *
 * WHY THE DISTINCTION CANNOT CURRENTLY BE RECORDED IN DATA. `mayContact` is
 * purpose-unaware: no governance type or column says "this restriction applies
 * to outreach but not to account mail", and the one category-shaped type,
 * `campaign_exclusion`, is storable but never evaluated. So enforcing
 * `mayContact` on an account email would apply a prospect-derived restriction
 * to it — which is precisely why 2a had to be an owner decision rather than a
 * code change.
 *
 * PG-001 (Phase 4C-6B) has since APPROVED purpose-aware governance as the
 * architectural direction that will eventually let 2b be answered in data
 * rather than per path: a restriction declares the scope it covers, a delivery
 * declares the purpose it serves, and an unlabelled restriction or undeclared
 * delivery defaults to `all`. See `prospectIdentity/contactPurpose`.
 *
 * THAT CHANGES NOTHING HERE YET. The model is approved, NOT enforced and NOT
 * wired; how existing records classify is still an open legal decision; and
 * 2a/2b above stand exactly as written. Do not treat PG-001 as resolving the
 * undecided category, and do not add a purpose argument to a send path on the
 * strength of it.
 *
 * ─── 3. ACTIVATION OUTREACH — outreach-shaped, no caller ──────────────────
 * `sendActivationOutreach` here, orchestrated by
 * `activationOutreachService.sendGovernedActivationOutreach`. Its gate checks
 * company classification, an active admin and remaining milestones — NOT
 * `mayContact`. It currently has NO production caller, which is the only reason
 * it cannot send ungoverned. Giving it one is a GOVERNANCE DECISION, not a
 * wiring detail; two tests in the suite above exist as that tripwire.
 *
 * ─── 4. DRY RUN — cannot send ─────────────────────────────────────────────
 * `execution/emailExecutionConnector.dispatchEmail` returns
 * `{ dispatched: false, dryRun: true }` with no live branch and no invocation
 * of this Edge Function. It must stay that way.
 *
 * ─── KNOWN REACHABILITY LIMIT ─────────────────────────────────────────────
 * The Edge Function's `KNOWN_TYPES` allow-list does NOT include
 * `lead_outreach`, the payload type Path B sends, so a prospect email is
 * rejected template-side with `EMAIL_TEMPLATE_NOT_FOUND` even when the
 * transport flag is on. Path B is therefore governed AND not currently
 * deliverable. Adding that template makes the governed path live; it does not
 * make any of category 2 governed.
 */
import { supabase } from '../db/supabaseClient';
import { logger } from './logger';

type InvitePayload = {
  type: 'team_invite';
  recipientEmail: string;
  inviteUrl: string;
};

type CompanyReferralPayload = {
  type: 'company_referral';
  recipientEmail: string;
  admin: { name: string | null; email: string } | null;
  companyName: string | null;
  supportEmail: string;
};

type InboundSignupNoticePayload = {
  type: 'inbound_signup_notice';
  recipientEmail: string;
  prospectEmail: string;
  companyName: string | null;
  supportEmail: string;
};

type InviteCredentialsPayload = {
  type: 'team_invite_credentials';
  recipientEmail: string;
  fullName: string | null;
  companyName: string | null;
  role: string;
  loginUrl: string;
  temporaryPassword: string;
};

type ActivationOutreachPayload = {
  type: 'activation_outreach';
  recipientEmail: string;
  companyName: string | null;
  missingMilestones: string[];
  ctaUrl: string;
};

type CreditAlertPayload = {
  type: 'credit_alert';
  recipientEmail: string;
  companyName: string | null;
  consumedPercent: number;
  remainingCredits: number;
  projectedRequiredCredits: number;
  ctaUrl: string;
};

type EmailPayload =
  | InvitePayload
  | CompanyReferralPayload
  | InboundSignupNoticePayload
  | InviteCredentialsPayload
  | ActivationOutreachPayload
  | CreditAlertPayload;

async function invokeEdgeFunction(payload: EmailPayload, context: { idempotencyKey?: string }): Promise<void> {
  const { error } = await supabase.functions.invoke('send-transactional-email', {
    body: payload,
  });

  if (error) {
    logger.warn('transactional_email_send_failed', {
      type: payload.type,
      recipient: payload.recipientEmail,
      idempotencyKey: context.idempotencyKey ?? null,
      message: error.message,
    });
    throw new Error(`TRANSACTIONAL_EMAIL_FAILED:${payload.type}:${error.message}`);
  }
}

export async function sendInvite(
  email: string,
  inviteLink: string,
  idempotencyKey?: string,
): Promise<void> {
  await invokeEdgeFunction(
    { type: 'team_invite', recipientEmail: email, inviteUrl: inviteLink },
    { idempotencyKey },
  );
}

export async function sendCompanyAdminReferral(
  recipientEmail: string,
  opts: {
    admin: { name: string | null; email: string } | null;
    companyName: string | null;
    supportEmail: string;
  },
  idempotencyKey?: string,
): Promise<void> {
  await invokeEdgeFunction(
    {
      type: 'company_referral',
      recipientEmail,
      admin: opts.admin,
      companyName: opts.companyName,
      supportEmail: opts.supportEmail,
    },
    { idempotencyKey },
  );
}

/**
 * Send an invite that contains a one-time temporary password.
 *
 * Used by the Super-Admin "Create User" flow when `inviteMode === 'temp_password'`.
 * The temporary password is rendered in the email body and MUST never appear
 * in any other log, audit, or persisted record — the caller's responsibility
 * is to generate it server-side, hand it to Supabase Auth via admin.createUser,
 * pass it here for one-shot delivery, and then discard it.
 */
export async function sendInviteWithCredentials(
  opts: {
    recipientEmail: string;
    fullName: string | null;
    companyName: string | null;
    role: string;
    loginUrl: string;
    temporaryPassword: string;
  },
  idempotencyKey?: string,
): Promise<void> {
  await invokeEdgeFunction(
    {
      type: 'team_invite_credentials',
      recipientEmail: opts.recipientEmail,
      fullName: opts.fullName,
      companyName: opts.companyName,
      role: opts.role,
      loginUrl: opts.loginUrl,
      temporaryPassword: opts.temporaryPassword,
    },
    { idempotencyKey },
  );
}

export async function sendInboundSignupNoticeToAdmin(
  adminEmail: string,
  opts: {
    prospectEmail: string;
    companyName: string | null;
    supportEmail: string;
  },
  idempotencyKey?: string,
): Promise<void> {
  await invokeEdgeFunction(
    {
      type: 'inbound_signup_notice',
      recipientEmail: adminEmail,
      prospectEmail: opts.prospectEmail,
      companyName: opts.companyName,
      supportEmail: opts.supportEmail,
    },
    { idempotencyKey },
  );
}

/**
 * activation_outreach — LOW-LEVEL primitive. Mirrors the deployed Edge Function template.
 *
 * GOVERNANCE: this primitive takes a raw `recipientEmail` and performs NO recipient
 * validation. Operational callers MUST NOT call it directly — use
 * `activationOutreachService.sendGovernedActivationOutreach(companyId)`, which resolves the
 * recipient from the company's active admin and enforces CUSTOMER classification. This export
 * exists only so the governed service has a single send seam.
 *
 * @internal governed callers only
 */
export async function sendActivationOutreach(
  opts: {
    recipientEmail: string;
    companyName: string | null;
    missingMilestones: string[];
    ctaUrl: string;
  },
  idempotencyKey?: string,
): Promise<void> {
  await invokeEdgeFunction(
    {
      type: 'activation_outreach',
      recipientEmail: opts.recipientEmail,
      companyName: opts.companyName,
      missingMilestones: opts.missingMilestones,
      ctaUrl: opts.ctaUrl,
    },
    { idempotencyKey },
  );
}

/**
 * credit_alert — low-credit forecast email (consumed ≥ 85% AND forecast insufficient before
 * period end). Renders server-side via the existing Edge Function. Best-effort. Governed callers
 * resolve the recipient from the company admin; do not pass arbitrary emails.
 */
export async function sendCreditAlert(
  opts: {
    recipientEmail: string;
    companyName: string | null;
    consumedPercent: number;
    remainingCredits: number;
    projectedRequiredCredits: number;
    ctaUrl: string;
  },
  idempotencyKey?: string,
): Promise<void> {
  await invokeEdgeFunction(
    {
      type: 'credit_alert',
      recipientEmail: opts.recipientEmail,
      companyName: opts.companyName,
      consumedPercent: opts.consumedPercent,
      remainingCredits: opts.remainingCredits,
      projectedRequiredCredits: opts.projectedRequiredCredits,
      ctaUrl: opts.ctaUrl,
    },
    { idempotencyKey },
  );
}
