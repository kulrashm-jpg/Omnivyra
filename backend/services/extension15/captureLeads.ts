/**
 * Sales Navigator saved-lead capture: the Outreach side of the route
 * (EXTENSION-1.5.0-CONTRACT.md §5.3; contract agreed with PI / virality-e1,
 * 2026-11-10; owner E-2: user-triggered, DARK until written acceptance).
 *
 * Built as a factory so the page route can bind PI's `ingestCapturedSavedLeads`
 * once PI's module lands, and so the verification can be tested in isolation.
 * Everything is verified BEFORE PI is called:
 * - the issuance switch (dark);
 * - the version gate;
 * - a live dispatched li.salesnav.capture_saved_leads command bound to this
 *   session and binding;
 * - the batch cap;
 * - lead_key shape (never a full fs_salesProfile tuple);
 * - no /sales/ URL in any field.
 * PI's own gates (its code constant, the lead-ingestion gate, the tenant flag)
 * run on top. The response passes PI's per-lead statuses through, with no ids
 * and no PII.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { checkExtensionVersion } from '../../../lib/extension/version';
import { __brandVerifiedCaptureContext, type VerifiedCaptureContext } from '../../../lib/extension/captureContext';
import { SALESNAV_CAPTURE_ISSUABLE, verifyResultCommand, finishCommand, type ExtSession } from './index';

export const MAX_LEADS_PER_BATCH = 25;
const LEAD_KEY = /^[A-Za-z0-9_-]{6,128}$/;
const FORBIDDEN_URL = /\/sales\//i;

export type PerLeadStatus = { key: string; status: 'created' | 'updated' | 'unchanged' | 'rejected'; reason?: string };
export type IngestCapturedSavedLeads = (ctx: VerifiedCaptureContext, payload: Record<string, unknown>) =>
  Promise<{ ok: true; results: PerLeadStatus[] } | { ok: false; status: number; code: string }>;

type Auth = (req: NextApiRequest, res: NextApiResponse) => Promise<{ session: ExtSession } | null>;

/** Returns null when the batch is acceptable, or the refusal code. */
export function checkCaptureBatch(body: Record<string, unknown>): string | null {
  if (body.provider !== 'linkedin_salesnav_extension' || body.contract_version !== 1) return 'UNSUPPORTED_CONTRACT';
  const leads = body.leads;
  if (!Array.isArray(leads) || leads.length === 0) return 'LEADS_REQUIRED';
  if (leads.length > MAX_LEADS_PER_BATCH) return 'TOO_MANY_LEADS';
  for (const raw of leads) {
    const l = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    if (typeof l.lead_key !== 'string' || !LEAD_KEY.test(l.lead_key)) return 'INVALID_LEAD_KEY';
    if (typeof l.full_name !== 'string' || l.full_name.trim() === '') return 'FULL_NAME_REQUIRED';
    for (const v of Object.values(l)) {
      if (typeof v === 'string' && FORBIDDEN_URL.test(v)) return 'SALES_URL_REFUSED';
    }
    const url = l.public_profile_url;
    // Aligned with PI's normalizeLinkedinUrl: http or https, any linkedin.com subdomain, an /in/ path.
    if (url !== undefined && url !== null && (typeof url !== 'string' || !/^https?:\/\/([a-z0-9-]+\.)*linkedin\.com\/in\/[^/?#\s]+/i.test(url))) {
      return 'INVALID_PROFILE_URL';
    }
  }
  return null;
}

export function createCaptureLeadsHandler(deps: { auth: Auth; ingest: IngestCapturedSavedLeads; issuable?: () => boolean }) {
  const issuable = deps.issuable ?? (() => SALESNAV_CAPTURE_ISSUABLE);
  return async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ success: false, error: 'Method not allowed' });
    }
    if (!issuable()) return res.status(403).json({ success: false, error: 'SALESNAV_CAPTURE_DISABLED' });
    const auth = await deps.auth(req, res);
    if (!auth) return;
    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
    const gate = checkExtensionVersion(body.extension_version);
    if (gate.ok !== true) return res.status(gate.status).json({ success: false, error: gate.code, minimum: gate.minimum });
    const cmd = await verifyResultCommand(auth.session, body.command_id, 'li.salesnav.capture_saved_leads');
    if (cmd.ok !== true) return res.status(cmd.status).json({ success: false, error: cmd.code });
    const bad = checkCaptureBatch(body);
    if (bad) {
      await finishCommand(auth.session, body.command_id as string, 'refused', { code: bad });
      return res.status(400).json({ success: false, error: bad });
    }
    const ctx = __brandVerifiedCaptureContext({
      orgId: auth.session.orgId,
      userId: auth.session.userId,
      socialAccountId: null,
      actingMemberUrn: cmd.actingMemberUrn,
      commandId: body.command_id as string,
      extensionVersion: gate.version,
    });
    const out = await deps.ingest(ctx, body);
    if (out.ok !== true) {
      await finishCommand(auth.session, ctx.commandId, 'failed', { code: out.code });
      return res.status(out.status).json({ success: false, error: out.code });
    }
    const counts: Record<string, number> = { created: 0, updated: 0, unchanged: 0, rejected: 0 };
    for (const r of out.results) counts[r.status] = (counts[r.status] ?? 0) + 1;
    await finishCommand(auth.session, ctx.commandId, 'completed', counts);
    // Only key, status and reason pass through: no ids, no PII.
    return res.status(200).json({
      success: true,
      results: out.results.map((r) => ({ key: r.key, status: r.status, ...(r.reason ? { reason: r.reason } : {}) })),
    });
  };
}
