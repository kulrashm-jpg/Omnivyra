// Supabase Edge Function: send-transactional-email
//
// Single entry point for app-level transactional emails that aren't auth
// events. Auth-event emails (signup confirm, magic link, password reset,
// invite-by-email) go through Supabase Auth's own SMTP setting; only emails
// that need custom HTML / custom URLs come through here.
//
// Templates supported (see render() below):
//   • team_invite             — invitation with custom token URL
//   • company_referral        — "your company is already on Omnivyra"
//   • inbound_signup_notice   — admin notice when prospect from same domain joins
//
// Secrets (set via `supabase secrets set --project-ref <ref> KEY=VALUE`):
//   EMAIL_FROM            — verified SES sender (e.g. "noreply@omnivyra.com")
//   AWS_SES_REGION        — e.g. "us-east-1"
//   AWS_ACCESS_KEY_ID     — IAM credential with ses:SendEmail
//   AWS_SECRET_ACCESS_KEY — IAM credential
//   APP_URL               — public base URL for CTA links (e.g. "https://omnivyra.com")
//
// Caller (Next.js API): supabase.functions.invoke('send-transactional-email', { body })
// The function is invoked with the service-role key, so JWT verification is
// implicit — we only check that the bearer matches the project's anon/service key.

import { SESClient, SendEmailCommand } from "npm:@aws-sdk/client-ses@3.658.1";

type Template =
  | { type: "team_invite"; recipientEmail: string; inviteUrl: string }
  | {
      type: "company_referral";
      recipientEmail: string;
      admin: { name: string | null; email: string } | null;
      companyName: string | null;
      supportEmail: string;
    }
  | {
      type: "inbound_signup_notice";
      recipientEmail: string;
      prospectEmail: string;
      companyName: string | null;
      supportEmail: string;
    }
  | {
      type: "domain_verification_reminder";
      recipientEmail: string;
      finalDomain: string;
      dashboardUrl: string;
    };

type Envelope = { to: string; subject: string; html: string };

function getAppUrl(): string {
  return (Deno.env.get("APP_URL") ?? "https://omnivyra.com").replace(/\/$/, "");
}

function actionLayout(title: string, body: string, ctaLabel: string, ctaUrl: string): string {
  return [
    `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#10233d">`,
    `<h2 style="margin:0 0 16px">${title}</h2>`,
    `<p style="margin:0 0 20px;line-height:1.6">${body}</p>`,
    `<p style="margin:0 0 24px">`,
    `<a href="${ctaUrl}" style="display:inline-block;background:#0A66C2;color:#fff;padding:12px 18px;border-radius:999px;text-decoration:none;font-weight:600">${ctaLabel}</a>`,
    `</p>`,
    `<p style="margin:0;color:#6B7C93;font-size:13px">If you did not request this, you can ignore this email.</p>`,
    `</div>`,
  ].join("");
}

function render(t: Template): Envelope {
  switch (t.type) {
    case "team_invite":
      return {
        to: t.recipientEmail,
        subject: "You have been invited to Omnivyra",
        html: actionLayout(
          "You have been invited",
          "Use the invitation link below to accept access to your organization account.",
          "Accept invitation",
          t.inviteUrl,
        ),
      };

    case "company_referral": {
      const who = t.admin?.name?.trim() || t.admin?.email || null;
      const companyLine = t.companyName
        ? `Your company <strong>${t.companyName}</strong> already has an Omnivyra account.`
        : `Your company already has an Omnivyra account.`;
      const body = t.admin
        ? `${companyLine} Please reach out to your administrator to request access:<br/><br/>` +
          `<strong>${who}</strong><br/>` +
          `<a href="mailto:${t.admin.email}">${t.admin.email}</a>`
        : `${companyLine} Its administrator is not currently active. ` +
          `Please email <a href="mailto:${t.supportEmail}">${t.supportEmail}</a> for help joining your team.`;
      return {
        to: t.recipientEmail,
        subject: "Your company is already using Omnivyra",
        html: actionLayout(
          "Your company is already on Omnivyra",
          body,
          "Go to log in",
          `${getAppUrl()}/login?email=${encodeURIComponent(t.recipientEmail)}`,
        ),
      };
    }

    case "inbound_signup_notice": {
      const companyClause = t.companyName ? ` for <strong>${t.companyName}</strong>` : "";
      const body =
        `<strong>${t.prospectEmail}</strong> just verified their email and tried to create an Omnivyra account${companyClause}. ` +
        `Because your account already owns this domain, we did not auto-add them to your company.<br/><br/>` +
        `If they should have access, please invite them from your team settings. ` +
        `If not, no action is needed — their account stays unattached.<br/><br/>` +
        `Need help? Reach out at <a href="mailto:${t.supportEmail}">${t.supportEmail}</a>.`;
      return {
        to: t.recipientEmail,
        subject: "Someone tried to join your Omnivyra company",
        html: actionLayout(
          "A new sign-up matched your domain",
          body,
          "Open team settings",
          `${getAppUrl()}/settings/team`,
        ),
      };
    }

    case "domain_verification_reminder": {
      const body =
        `You're almost done setting up <strong>${t.finalDomain}</strong>.<br/><br/>` +
        `To complete setup:<br/>` +
        `1. Add your verification record<br/>` +
        `2. Click verify in your dashboard<br/><br/>` +
        `If you've already verified your domain, you can ignore this message.`;
      return {
        to: t.recipientEmail,
        subject: "Verify your domain to unlock full access",
        html: actionLayout(
          "Verify your domain",
          body,
          "Go to dashboard",
          t.dashboardUrl,
        ),
      };
    }
  }
}

async function sendViaSES(envelope: Envelope): Promise<void> {
  // Region is sourced EXCLUSIVELY from AWS_SES_REGION. No fallback to
  // AWS_REGION, no hardcoded default, no `||` chain. If unset, fail loud.
  // .trim() defends against whitespace pasted into the Supabase secrets UI.
  const from            = Deno.env.get("EMAIL_FROM");
  const region          = Deno.env.get("AWS_SES_REGION")?.trim();
  const accessKeyId     = Deno.env.get("AWS_ACCESS_KEY_ID");
  const secretAccessKey = Deno.env.get("AWS_SECRET_ACCESS_KEY");

  if (!region) {
    throw new Error("AWS_SES_REGION is missing or empty");
  }

  if (!from || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "SES_NOT_CONFIGURED: EMAIL_FROM, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY all required",
    );
  }

  // ───── TEMPORARY DIAGNOSTIC ────────────────────────────────────────────
  // Logs the exact region string that will be passed to SESClient AND
  // hard-fails if it doesn't match the expected eu-north-1 — proves
  // whether the runtime is still seeing the wrong value despite the
  // secret being set correctly. Remove the assertion once verified.
  console.log("FINAL REGION USED:", region);
  if (region !== "eu-north-1") {
    throw new Error(`REGION MISMATCH: Expected eu-north-1 but got ${region}`);
  }
  // ───── END TEMPORARY DIAGNOSTIC ────────────────────────────────────────

  const client = new SESClient({
    region: region,
    credentials: { accessKeyId, secretAccessKey },
  });

  const command = new SendEmailCommand({
    Source: from,
    Destination: { ToAddresses: [envelope.to] },
    Message: {
      Subject: { Charset: "UTF-8", Data: envelope.subject },
      Body: { Html: { Charset: "UTF-8", Data: envelope.html } },
    },
  });

  await client.send(command);
}

Deno.serve(async (req) => {
  // ───── TEMPORARY ENV DEBUG ─────────────────────────────────────────────
  // Diagnoses the SES wrong-region bug. Remove once region drift is
  // resolved. Logs once per request so we capture state even on warm
  // invocations (cold-start-only logging would miss most events).
  console.log("ENV DEBUG START");
  console.log("AWS_SES_REGION:",     Deno.env.get("AWS_SES_REGION"));
  console.log("AWS_REGION:",         Deno.env.get("AWS_REGION"));
  console.log("AWS_DEFAULT_REGION:", Deno.env.get("AWS_DEFAULT_REGION"));
  console.log("ENV DEBUG END");
  // ───── END TEMPORARY ENV DEBUG ─────────────────────────────────────────

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Missing bearer token" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body: Template;
  try {
    body = (await req.json()) as Template;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!body || typeof body !== "object" || !("type" in body)) {
    return new Response(JSON.stringify({ error: "Missing 'type' field" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Fail loudly on unknown template types — render() falls through to
  // undefined for an unrecognized string, which would otherwise reach SES
  // with a half-built envelope. Keep the allowlist in sync with Template.
  const KNOWN_TYPES = new Set([
    "team_invite",
    "company_referral",
    "inbound_signup_notice",
    "domain_verification_reminder",
  ]);
  const requestedType = (body as { type?: string }).type;
  if (!requestedType || !KNOWN_TYPES.has(requestedType)) {
    console.error("EMAIL_TEMPLATE_NOT_FOUND", { type: requestedType ?? null });
    return new Response(
      JSON.stringify({ error: "EMAIL_TEMPLATE_NOT_FOUND", type: requestedType ?? null }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  try {
    const envelope = render(body);
    await sendViaSES(envelope);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
