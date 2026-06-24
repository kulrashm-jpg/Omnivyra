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

type EmailPayload =
  | InvitePayload
  | CompanyReferralPayload
  | InboundSignupNoticePayload
  | InviteCredentialsPayload
  | ActivationOutreachPayload;

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
