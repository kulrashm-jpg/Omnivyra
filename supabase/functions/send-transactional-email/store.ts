/**
 * The idempotency store for send-transactional-email: the four database functions of migration
 * transactional_email_idempotency, called through PostgREST with the platform-injected SECRET key (the same key
 * family auth.ts verifies). No client library: one POST per call, each with a hard timeout - a hung database call
 * must never hold an email send (and its caller) open.
 *
 * Every method THROWS on a non-2xx answer, a timeout or an unreadable body: idempotency.ts turns a reserve failure
 * into "nothing sent" (503) and treats later failures as fail-safe (never a resend).
 */
import type { IdempotencyStore, ReserveOutcome } from "./idempotency.ts";

export const STORE_TIMEOUT_MS = 5_000;
const OUTCOMES: ReadonlySet<string> = new Set(["reserved", "duplicate_sent", "duplicate_inflight", "duplicate_uncertain", "stale_marked_uncertain"]);

export function rpcStore(opts: { url: string; key: string; fetchImpl?: typeof fetch; timeoutMs?: number }): IdempotencyStore {
  const base = String(opts.url ?? "").replace(/\/+$/, "");
  if (!base || !opts.key) throw new Error("IDEMPOTENCY_STORE_NOT_CONFIGURED");
  const doFetch = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? STORE_TIMEOUT_MS;

  async function rpc(fn: string, args: Record<string, unknown>): Promise<unknown> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await doFetch(`${base}/rest/v1/rpc/${fn}`, {
        method: "POST",
        headers: { apikey: opts.key, Authorization: `Bearer ${opts.key}`, "Content-Type": "application/json" },
        body: JSON.stringify(args),
        signal: ctrl.signal,
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`IDEMPOTENCY_STORE_${fn}_HTTP_${res.status}`);
      return text ? JSON.parse(text) : null;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async reserve({ key, emailType, recipientSha256, ttlSeconds, staleSeconds }) {
      const data = await rpc("transactional_email_reserve", {
        p_key: key, p_email_type: emailType, p_recipient_sha256: recipientSha256, p_ttl_seconds: ttlSeconds, p_stale_seconds: staleSeconds,
      });
      const row = (Array.isArray(data) ? data[0] : data) as { outcome?: unknown; message_id?: unknown; frees_at?: unknown } | null;
      if (!row || typeof row.outcome !== "string" || !OUTCOMES.has(row.outcome)) throw new Error("IDEMPOTENCY_STORE_RESERVE_UNREADABLE");
      return {
        outcome: row.outcome as ReserveOutcome,
        messageId: typeof row.message_id === "string" ? row.message_id : null,
        freesAt: typeof row.frees_at === "string" ? row.frees_at : null,
      };
    },
    async confirm({ key, messageId }) {
      await rpc("transactional_email_confirm", { p_key: key, p_message_id: messageId });
    },
    async release({ key }) {
      await rpc("transactional_email_release", { p_key: key });
    },
    async markUncertain({ key, reason }) {
      const freesAt = await rpc("transactional_email_mark_uncertain", { p_key: key, p_reason: reason });
      return typeof freesAt === "string" ? freesAt : null;
    },
  };
}
