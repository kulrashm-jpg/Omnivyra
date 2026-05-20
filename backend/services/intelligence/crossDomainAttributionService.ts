/**
 * Cross-domain attribution continuity.
 *
 * Issues + verifies HMAC-signed attribution tokens so a visitor's journey
 * survives leaving the origin domain (external landing page, embedded form,
 * SPA route, iframe). The token is COMPACT JSON + HMAC-SHA256 base64url; it
 * is tamper-aware (signature verification), replay-aware (nonce + expiry +
 * UNIQUE(company_id, nonce) handoff row), and tenant-safe (every token is
 * stamped with companyId; verify rejects mismatches).
 *
 * Persistence: `attribution_handoffs` WHEN PRESENT (20260695), else the
 * append-only `audit_events` substrate. No new hard dependency. The hardened
 * public ingress routes are NOT touched.
 *
 * Token format:  base64url(payload) + '.' + base64url(hmac)
 *   payload = { v:1, cid, n (nonce), a (anonymousId), s (sessionId),
 *               w (websiteId), u (utm subset), exp (epoch sec) }
 */
import crypto from 'crypto';
import { ownedDbTable } from '../../db/writeOwner';
import { recordComplianceAudit } from '../audit/complianceAuditService';

export type HandoffVerifyState =
  | 'verified'
  | 'expired'
  | 'tampered'
  | 'replayed'
  | 'company_mismatch'
  | 'malformed'
  | 'not_configured';

export interface AttributionTokenPayload {
  v: 1;
  cid: string;            // companyId
  n: string;              // nonce
  a?: string;             // anonymous_id
  s?: string;             // session_id
  w?: string;             // website_id
  u?: Record<string, string>; // utm subset
  exp: number;            // epoch seconds
}

export interface IssueResult {
  state: 'issued' | 'not_configured';
  token?: string;
  nonce?: string;
  expiresAt?: string;
  detail: string;
}

export interface VerifyResult {
  state: HandoffVerifyState;
  payload?: AttributionTokenPayload;
  detail: string;
  recorded: boolean;
}

const DEFAULT_TTL_SEC = 30 * 60; // 30 minutes — funnel hand-off window
const SECRET_ENV = 'CROSS_DOMAIN_ATTR_SECRET';

let probe: boolean | null = null;
async function hasTable(): Promise<boolean> {
  if (probe !== null) return probe;
  try {
    const { error } = await ownedDbTable('attribution_handoffs')
      .select('id', { count: 'exact', head: true })
      .limit(1);
    probe = !error;
  } catch {
    probe = false;
  }
  return probe;
}

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf as any).toString('base64url');
}

function sign(payload: AttributionTokenPayload, secret: string): string {
  const body = b64url(JSON.stringify(payload));
  const mac = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${mac}`;
}

function verifySig(token: string, secret: string): AttributionTokenPayload | null {
  const idx = token.indexOf('.');
  if (idx < 0) return null;
  const body = token.slice(0, idx);
  const mac = token.slice(idx + 1);
  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  if (!crypto.timingSafeEqual(a, b)) return null;
  try {
    const json = Buffer.from(body, 'base64url').toString('utf8');
    const p = JSON.parse(json);
    if (typeof p !== 'object' || p === null || p.v !== 1 || typeof p.cid !== 'string') return null;
    return p as AttributionTokenPayload;
  } catch {
    return null;
  }
}

export function isCrossDomainAttrConfigured(): boolean {
  return Boolean(process.env[SECRET_ENV]);
}

export async function issueAttributionToken(args: {
  companyId: string;
  anonymousId?: string;
  sessionId?: string;
  websiteId?: string;
  utm?: Record<string, string>;
  originUrl?: string;
  destinationUrl?: string;
  ttlSec?: number;
}): Promise<IssueResult> {
  const secret = process.env[SECRET_ENV];
  if (!secret) {
    return { state: 'not_configured', detail: `${SECRET_ENV} unset — cross-domain attribution is disabled (lineage/export only).` };
  }
  const nonce = crypto.randomBytes(8).toString('base64url');
  const exp = Math.floor(Date.now() / 1000) + (args.ttlSec ?? DEFAULT_TTL_SEC);
  const payload: AttributionTokenPayload = {
    v: 1,
    cid: args.companyId,
    n: nonce,
    a: args.anonymousId,
    s: args.sessionId,
    w: args.websiteId,
    u: args.utm,
    exp,
  };
  const token = sign(payload, secret);
  const expiresAtIso = new Date(exp * 1000).toISOString();

  if (await hasTable()) {
    await ownedDbTable('attribution_handoffs')
      .upsert(
        {
          company_id: args.companyId,
          token_nonce: nonce,
          anonymous_id: args.anonymousId ?? null,
          session_id: args.sessionId ?? null,
          website_id: args.websiteId ?? null,
          origin_url: args.originUrl ?? null,
          destination_url: args.destinationUrl ?? null,
          utm: args.utm ?? {},
          expires_at: expiresAtIso,
        },
        { onConflict: 'company_id,token_nonce', ignoreDuplicates: true },
      )
      .then(() => undefined, () => undefined);
  } else {
    await recordComplianceAudit({
      companyId: args.companyId,
      actor: { userId: null, type: 'system', label: 'cross-domain-attribution' },
      action: 'attribution_handoff.issued',
      resourceType: 'attribution_handoff',
      resourceId: nonce,
      severity: 'info',
      entityLineage: ['company', 'attribution_handoff', 'issued'],
      detail: { nonce, expiresAt: expiresAtIso, originUrl: args.originUrl, destinationUrl: args.destinationUrl },
    }).catch(() => undefined);
  }

  return { state: 'issued', token, nonce, expiresAt: expiresAtIso, detail: 'token issued' };
}

export async function verifyAttributionToken(args: {
  companyId: string;
  token: string;
  destinationUrl?: string;
}): Promise<VerifyResult> {
  const secret = process.env[SECRET_ENV];
  if (!secret) return { state: 'not_configured', detail: 'cross-domain attribution disabled', recorded: false };
  const p = verifySig(args.token, secret);
  if (!p) {
    await recordComplianceAudit({
      companyId: args.companyId,
      actor: { userId: null, type: 'system', label: 'cross-domain-attribution' },
      action: 'attribution_handoff.tampered',
      resourceType: 'attribution_handoff',
      resourceId: 'tampered',
      severity: 'warning',
      entityLineage: ['company', 'attribution_handoff', 'tampered'],
      detail: { destinationUrl: args.destinationUrl ?? null },
    }).catch(() => undefined);
    return { state: 'tampered', detail: 'signature invalid or malformed', recorded: true };
  }
  if (p.cid !== args.companyId) {
    return { state: 'company_mismatch', detail: 'token bound to a different company', recorded: false };
  }
  if (p.exp * 1000 < Date.now()) {
    return { state: 'expired', payload: p, detail: 'token expired', recorded: false };
  }

  // Replay detection: an existing verified_at marks reuse. UNIQUE constraint
  // also makes a re-INSERT a no-op on the receiving side.
  if (await hasTable()) {
    try {
      const { data } = await ownedDbTable('attribution_handoffs')
        .select('verified_at')
        .eq('company_id', args.companyId)
        .eq('token_nonce', p.n)
        .maybeSingle();
      if ((data as any)?.verified_at) {
        return { state: 'replayed', payload: p, detail: 'token already verified previously', recorded: true };
      }
      await ownedDbTable('attribution_handoffs')
        .update({ verified_at: new Date().toISOString(), destination_url: args.destinationUrl ?? null })
        .eq('company_id', args.companyId)
        .eq('token_nonce', p.n)
        .then(() => undefined, () => undefined);
    } catch {
      /* fall through to audit lineage */
    }
  }
  await recordComplianceAudit({
    companyId: args.companyId,
    actor: { userId: null, type: 'system', label: 'cross-domain-attribution' },
    action: 'attribution_handoff.verified',
    resourceType: 'attribution_handoff',
    resourceId: p.n,
    severity: 'info',
    entityLineage: ['company', 'attribution_handoff', 'verified'],
    detail: { nonce: p.n, anonymousId: p.a, sessionId: p.s, destinationUrl: args.destinationUrl ?? null },
  }).catch(() => undefined);
  return { state: 'verified', payload: p, detail: 'token verified', recorded: true };
}

export interface AttributionContinuityReport {
  companyId: string;
  generatedAt: string;
  configured: boolean;
  issued24h: number;
  verified24h: number;
  tampered24h: number;
  expiredOrReplayed24h: number;
  continuityRate: number; // 0..1 verified / issued
}

export async function buildContinuityDiagnostics(companyId: string): Promise<AttributionContinuityReport> {
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const out = {
    companyId,
    generatedAt: new Date().toISOString(),
    configured: isCrossDomainAttrConfigured(),
    issued24h: 0,
    verified24h: 0,
    tampered24h: 0,
    expiredOrReplayed24h: 0,
    continuityRate: 0,
  };
  try {
    if (await hasTable()) {
      const { count: iCount } = await ownedDbTable('attribution_handoffs')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', companyId)
        .gte('issued_at', since);
      out.issued24h = typeof iCount === 'number' ? iCount : 0;
      const { count: vCount } = await ownedDbTable('attribution_handoffs')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', companyId)
        .not('verified_at', 'is', null)
        .gte('verified_at', since);
      out.verified24h = typeof vCount === 'number' ? vCount : 0;
    }
    const { count: tampered } = await ownedDbTable('audit_events')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .eq('action', 'attribution_handoff.tampered')
      .gte('created_at', since);
    out.tampered24h = typeof tampered === 'number' ? tampered : 0;
  } catch { /* defaults */ }
  out.continuityRate = out.issued24h > 0 ? Number((out.verified24h / out.issued24h).toFixed(3)) : 0;
  return out;
}
