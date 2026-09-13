// Caller authorization for send-transactional-email.
//
// Only backend callers holding one of the project's SECRET API keys may send
// email. The platform's verify_jwt gate cannot enforce that: it understands
// only the legacy JWT keys, and it lets requests carrying the PUBLIC
// publishable key through to this code. Before this check existed the only
// test was `Authorization.startsWith("Bearer ")`, so anyone holding the
// publishable key (it ships in the browser bundle) could send templated
// email — including invites with an arbitrary URL — from our SES sender.
//
// The platform injects every secret key into the function environment as
// SUPABASE_SECRET_KEYS, a JSON object keyed by key name. The caller presents
// its key on the `apikey` header (supabase-js always sets it; a server client
// without a session also repeats it as the Bearer token). The legacy
// service_role JWT is deliberately NOT accepted — legacy keys are disabled.
//
// Fails closed: if the key set is missing or unparseable, every request is
// refused with 500 rather than allowed.
//
// Dependency-free and Deno-free so it can be unit-tested under Node.

export type AuthResult =
  | { ok: true }
  | { ok: false; status: 401 | 500; error: string };

export function parseSecretKeys(raw: string | null | undefined): string[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
  return Object.values(parsed as Record<string, unknown>).filter(
    (v): v is string => typeof v === "string" && v.length > 0,
  );
}

async function sha256(value: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return new Uint8Array(digest);
}

// Compares SHA-256 digests so neither the content nor the length of a
// secret leaks through timing.
async function constantTimeEquals(a: string, b: string): Promise<boolean> {
  const [da, db] = await Promise.all([sha256(a), sha256(b)]);
  let diff = 0;
  for (let i = 0; i < da.length; i++) diff |= da[i] ^ db[i];
  return diff === 0;
}

function presentedCredentials(headers: Headers): string[] {
  const out: string[] = [];
  const apikey = headers.get("apikey")?.trim();
  if (apikey) out.push(apikey);
  const auth = headers.get("Authorization") ?? "";
  if (auth.startsWith("Bearer ")) {
    const bearer = auth.slice("Bearer ".length).trim();
    if (bearer) out.push(bearer);
  }
  return out;
}

export async function authorizeServiceCaller(
  headers: Headers,
  rawSecretKeys: string | null | undefined,
): Promise<AuthResult> {
  const secretKeys = parseSecretKeys(rawSecretKeys);
  if (secretKeys.length === 0) {
    return { ok: false, status: 500, error: "AUTH_NOT_CONFIGURED" };
  }
  const presented = presentedCredentials(headers);
  if (presented.length === 0) {
    return { ok: false, status: 401, error: "Missing API key" };
  }
  let matched = false;
  // Evaluate every pair (no early exit) to keep timing independent of which
  // key, if any, matched.
  for (const candidate of presented) {
    for (const key of secretKeys) {
      if (await constantTimeEquals(candidate, key)) matched = true;
    }
  }
  return matched ? { ok: true } : { ok: false, status: 401, error: "Unauthorized" };
}
