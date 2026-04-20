import { createHmac, timingSafeEqual } from 'crypto';

type ExtensionSessionPayload = {
  userId: string;
  orgId: string;
  expiresAt: number;
};

function getExtensionSessionSecret() {
  return (
    process.env.EXTENSION_SESSION_SECRET ||
    process.env.AUTH_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    'omnivyra-extension-session-secret'
  );
}

function toBase64Url(value: string) {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function fromBase64Url(value: string) {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function signPayload(payloadBase64: string) {
  return createHmac('sha256', getExtensionSessionSecret()).update(payloadBase64).digest('base64url');
}

export function issueExtensionSessionToken(input: ExtensionSessionPayload) {
  const payloadBase64 = toBase64Url(JSON.stringify(input));
  const signature = signPayload(payloadBase64);
  return `${payloadBase64}.${signature}`;
}

export function verifyExtensionSessionToken(token: string | null | undefined): ExtensionSessionPayload | null {
  if (!token) return null;

  const [payloadBase64, signature] = token.split('.');
  if (!payloadBase64 || !signature) return null;

  const expectedSignature = signPayload(payloadBase64);
  const provided = Buffer.from(signature);
  const expected = Buffer.from(expectedSignature);
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return null;
  }

  try {
    const payload = JSON.parse(fromBase64Url(payloadBase64)) as ExtensionSessionPayload;
    if (!payload.userId || !payload.orgId || !payload.expiresAt) {
      return null;
    }
    if (Date.now() > payload.expiresAt) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}
