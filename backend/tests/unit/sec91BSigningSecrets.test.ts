/**
 * SEC91-B1 — signing-secret fallback chains.
 *
 * THE DEFECT: the HMAC secrets for extension session tokens (and the per-session request
 * signing secret derived from them), extension claim codes, RPA auth-bootstrap tokens and
 * invitation tokens fell back to the browser-public Supabase anon key, to the Supabase
 * service-role key, and finally to literals committed in this repository. With the
 * dedicated secret and AUTH_SECRET unset, anyone could mint valid tokens.
 *
 * NOW: dedicated secret -> AUTH_SECRET (invitations: INVITATION_TOKEN_SECRET only), else
 * FAIL CLOSED. Production (AUTH_SECRET / INVITATION_TOKEN_SECRET set) keeps resolving the
 * same value, so already-issued tokens still verify.
 *
 * All values below are fake test fixtures.
 */
import { createHmac } from 'crypto';

jest.mock('@/config', () => ({
  config: new Proxy({}, { get: (_t, k: string) => process.env[k] }),
}));
jest.mock('../../db/supabaseClient', () => ({ supabase: {} }));
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: () => ({}) }));
jest.mock('../../services/emailJobsService', () => ({ enqueueEmailJob: jest.fn() }));
jest.mock('../../services/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));

const MANAGED = [
  'EXTENSION_SESSION_SECRET', 'AUTH_SECRET', 'NEXTAUTH_SECRET', 'RPA_AUTH_SECRET',
  'INVITATION_TOKEN_SECRET', 'SUPABASE_SERVICE_ROLE_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
];
const saved: Record<string, string | undefined> = {};
beforeAll(() => { for (const k of MANAGED) saved[k] = process.env[k]; });
beforeEach(() => { for (const k of MANAGED) delete process.env[k]; });
afterAll(() => {
  for (const k of MANAGED) {
    if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
  }
});

const PUBLIC_ANON = 'fake-public-anon-key-shipped-to-every-browser';
const SERVICE_ROLE = 'fake-service-role-api-key';
const AUTH = 'fake-auth-secret-value';
const DEDICATED = 'fake-dedicated-extension-secret';

const ext = () => require('../../services/extensionSessionService') as typeof import('../../services/extensionSessionService');
const claim = () => require('../../services/extensionClaimCodeService') as typeof import('../../services/extensionClaimCodeService');
const rpa = () => require('../../services/rpaWorker/rpaAuthTokens') as typeof import('../../services/rpaWorker/rpaAuthTokens');
const inv = () => require('../../services/invitationService') as typeof import('../../services/invitationService');

/** Forge an extension session token the way an attacker who knows `secret` would. */
function forgeExtensionToken(secret: string) {
  const payload = Buffer.from(JSON.stringify({ userId: 'victim-user', orgId: 'victim-org', expiresAt: Date.now() + 60_000 }), 'utf8').toString('base64url');
  return `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`;
}
function forgeRpaToken(secret: string) {
  const now = Date.now();
  const payload = Buffer.from(JSON.stringify({ organization_id: 'victim-org', platform: 'linkedin', user_id: null, nonce: 'n', issued_at: now, expires_at: now + 60_000 }), 'utf8').toString('base64url');
  return `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`;
}

describe('extension session tokens', () => {
  it('a token signed with the browser-public anon key is NOT accepted', () => {
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = PUBLIC_ANON;
    expect(ext().verifyExtensionSessionToken(forgeExtensionToken(PUBLIC_ANON))).toBeNull();
  });

  it('a token signed with the committed literal is NOT accepted', () => {
    expect(ext().verifyExtensionSessionToken(forgeExtensionToken('omnivyra-extension-session-secret'))).toBeNull();
  });

  it('a token signed with the service-role key is NOT accepted', () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_ROLE;
    expect(ext().verifyExtensionSessionToken(forgeExtensionToken(SERVICE_ROLE))).toBeNull();
  });

  it('issuing fails closed when neither the dedicated secret nor AUTH_SECRET is set', () => {
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = PUBLIC_ANON;
    process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_ROLE;
    expect(() => ext().issueExtensionSessionToken({ userId: 'u', orgId: 'o', expiresAt: Date.now() + 1000 }))
      .toThrow(/SIGNING_SECRET_UNAVAILABLE/);
    expect(() => ext().deriveExtensionHmacSecret({ userId: 'u', orgId: 'o', expiresAt: 1, nonce: 'n' }))
      .toThrow(/SIGNING_SECRET_UNAVAILABLE/);
  });

  it('the error names variables, never a value', () => {
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = PUBLIC_ANON;
    try {
      ext().issueExtensionSessionToken({ userId: 'u', orgId: 'o', expiresAt: Date.now() + 1000 });
      throw new Error('expected throw');
    } catch (e) {
      expect(String((e as Error).message)).not.toContain(PUBLIC_ANON);
    }
  });

  it('request-signature verification fails closed (no throw) when no secret is configured', () => {
    const r = ext().verifyExtensionRequestSignature({
      method: 'POST', path: '/api/x', rawBody: '{}',
      timestampHeader: String(Math.floor(Date.now() / 1000)), nonceHeader: 'nonce-1', signatureHeader: 'deadbeef',
      session: { userId: 'u', orgId: 'o', expiresAt: Date.now() + 1000, hmacNonce: 'h' },
    });
    expect(r.ok).toBe(false);
  });

  it('COMPAT: with AUTH_SECRET set (production), tokens are HMAC(AUTH_SECRET) exactly as before', () => {
    process.env.AUTH_SECRET = AUTH;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = PUBLIC_ANON;
    const token = ext().issueExtensionSessionToken({ userId: 'u', orgId: 'o', expiresAt: Date.now() + 60_000 });
    const [p, sig] = token.split('.');
    expect(sig).toBe(createHmac('sha256', AUTH).update(p).digest('base64url'));
    expect(ext().verifyExtensionSessionToken(forgeExtensionToken(AUTH))).not.toBeNull();
  });

  it('COMPAT: the dedicated secret still wins over AUTH_SECRET', () => {
    process.env.AUTH_SECRET = AUTH;
    process.env.EXTENSION_SESSION_SECRET = DEDICATED;
    expect(ext().verifyExtensionSessionToken(forgeExtensionToken(DEDICATED))).not.toBeNull();
    expect(ext().verifyExtensionSessionToken(forgeExtensionToken(AUTH))).toBeNull();
  });
});

describe('extension claim codes', () => {
  it('creating a claim code fails closed with no secret (no committed literal)', () => {
    expect(() => claim().createClaimCode('u', 'o')).toThrow(/SIGNING_SECRET_UNAVAILABLE/);
  });

  it('COMPAT: works with AUTH_SECRET and is single-use', () => {
    process.env.AUTH_SECRET = AUTH;
    const c = claim().createClaimCode('u', 'o');
    expect(claim().redeemClaimCode(c.code)).toEqual({ userId: 'u', orgId: 'o' });
    expect(claim().redeemClaimCode(c.code)).toBeNull();
  });
});

describe('RPA auth-bootstrap tokens', () => {
  it('a token signed with the service-role key is NOT accepted', () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_ROLE;
    expect(rpa().verifyRpaAuthToken(forgeRpaToken(SERVICE_ROLE)).ok).toBe(false);
  });

  it('a token signed with the committed literal is NOT accepted', () => {
    expect(rpa().verifyRpaAuthToken(forgeRpaToken('omnivyra-rpa-auth-secret')).ok).toBe(false);
  });

  it('issuing fails closed with no secret', () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_ROLE;
    expect(() => rpa().issueRpaAuthToken({ organization_id: 'o', platform: 'linkedin', user_id: null }))
      .toThrow(/SIGNING_SECRET_UNAVAILABLE/);
  });

  it('COMPAT: AUTH_SECRET-signed tokens verify as before', () => {
    process.env.AUTH_SECRET = AUTH;
    expect(rpa().verifyRpaAuthToken(forgeRpaToken(AUTH)).ok).toBe(true);
    const issued = rpa().issueRpaAuthToken({ organization_id: 'o', platform: 'linkedin', user_id: null });
    expect(rpa().verifyRpaAuthToken(issued.token).ok).toBe(true);
  });
});

describe('invitation tokens', () => {
  it('the service-role key is not an invitation signing secret', () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_ROLE;
    expect(() => inv().getInvitationSigningSecret()).toThrow(/SIGNING_SECRET_UNAVAILABLE/);
  });

  it('fails closed with nothing configured (no committed literal)', () => {
    expect(() => inv().getInvitationSigningSecret()).toThrow(/SIGNING_SECRET_UNAVAILABLE/);
  });

  it('COMPAT: INVITATION_TOKEN_SECRET resolves trimmed, exactly as before', () => {
    process.env.INVITATION_TOKEN_SECRET = '  fake-invite-secret  ';
    expect(inv().getInvitationSigningSecret()).toBe('fake-invite-secret');
  });

  it('the super-admin resend route uses the shared resolver (no private fallback chain)', () => {
    const src = require('fs').readFileSync('pages/api/super-admin/invitations/[invitationId]/resend.ts', 'utf8') as string;
    expect(src).toContain('getInvitationSigningSecret');
    expect(src).not.toMatch(/local-dev-invite-secret/);
    expect(src).not.toMatch(/process\.env\.SUPABASE_SERVICE_ROLE_KEY/);
  });
});

describe('no signing-secret source file ends a chain in a public key or a literal', () => {
  const FILES = [
    'backend/services/extensionSessionService.ts',
    'backend/services/extensionClaimCodeService.ts',
    'backend/services/rpaWorker/rpaAuthTokens.ts',
    'backend/services/invitationService.ts',
    'pages/api/super-admin/invitations/[invitationId]/resend.ts',
  ];
  it.each(FILES)('%s', (f) => {
    const src = require('fs').readFileSync(f, 'utf8') as string;
    expect(src).not.toMatch(/NEXT_PUBLIC_SUPABASE_ANON_KEY/);
    expect(src).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
    expect(src).not.toMatch(/'omnivyra-(extension-session|extension-claim-code|rpa-auth)-secret'|'local-dev-invite-secret'/);
  });
});
