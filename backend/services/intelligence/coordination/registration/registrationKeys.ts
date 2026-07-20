/**
 * Registration idempotency-key derivation (WS-2B) — deterministic, replay-safe.
 *
 * A registration is identified by its logical identity: the tenant, the semantic
 * root (the intent seed), the artifact type + stage, and the distinguishing
 * coordinates (platform, campaign, audience, content ref). Two calls with the
 * same identity — a retry, a duplicate request, a replay — derive the SAME key
 * and therefore collapse onto the same registry row.
 *
 * This is KEY GENERATION (hashing), not text comparison.
 */
import { createHash } from 'crypto';

export interface IdempotencyKeyParts {
  companyId: string;
  semanticRootId: string;
  artifactType?: string | null;
  generationStage?: string | null;
  platform?: string | null;
  campaignId?: string | null;
  audience?: string | null;
  contentRefId?: string | null;
}

/** Derive the deterministic idempotency key. Format: `cidem_<24-hex>`. */
export function deriveIdempotencyKey(parts: IdempotencyKeyParts): string {
  const signature = [
    parts.companyId,
    parts.semanticRootId,
    parts.artifactType ?? '',
    parts.generationStage ?? '',
    parts.platform ?? '',
    parts.campaignId ?? '',
    parts.audience ?? '',
    parts.contentRefId ?? '',
  ].join('|');
  const digest = createHash('sha256').update(signature).digest('hex').slice(0, 24);
  return `cidem_${digest}`;
}
