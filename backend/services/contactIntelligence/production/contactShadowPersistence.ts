/**
 * CONTACT-INTELLIGENCE-PROGRAM-009 · Phase 4 — Contact shadow persistence (store-agnostic).
 *
 * The repository seam for the canonical contact shadow record: a pure merge, a semantic-idempotency
 * decision, and an orchestrator that performs its single write through INJECTED dependencies. It has
 * no knowledge of any table, client or column.
 *
 * ─── WHY THERE IS NO SUPABASE BINDING HERE ─────────────────────────────────────────────────────────
 * The sibling programs bind their shadow record to an existing JSONB column
 * (`company_profiles.report_settings.canonical_understanding`). `contacts` has no such column — it
 * stores id, organization_id, platform, platform_user_id, contact_key, display_name, profile_url,
 * timestamps and unified_person_id, and nothing else. Providing a concrete store would therefore
 * require a schema change, which is out of scope for this phase. Rather than invent a host location,
 * this module ships the seam and stops. Binding it is a Phase 5 prerequisite, and the decision about
 * WHERE the record lives belongs to whoever owns that schema — not to this layer.
 *
 * ─── SEMANTIC IDEMPOTENCY ──────────────────────────────────────────────────────────────────────────
 * Persistence is gated on the MEANINGFUL contact identity changing, never on metadata. `built_at`,
 * evidence refs, confidence, parity, scores, version and producer are all excluded from the decision:
 * a rebuild that produced the same identity must not write, or every scheduled rebuild would churn the
 * store and every audit trail would fill with noise.
 *
 * The per-field policy matches the certified company evolution policy:
 *    abstention → grounded   IMPROVED   persist (knowledge gained)
 *    grounded   → same       —          no signal
 *    grounded   → different  CHANGED    persist (identity evolved)
 *    grounded   → abstention DEGRADATION_PROTECTED — do NOT overwrite. An identity is never erased by
 *                            a transient loss of evidence; a real removal needs an explicit policy.
 * ANY degradation blocks the whole write even when other fields improved — a later stable production
 * persists cleanly.
 *
 * FLAG-DARK: `runContactShadowPersist` is the only function here with a side effect, and it refuses to
 * act unless the Contact ENABLED flag is on. It never activates automatically.
 */

import type { CanonicalContactRecord, ContactWriteInputs } from './canonicalContactProducer';
import { produceCanonicalContact } from './canonicalContactProducer';
import { isContactUnderstandingEnabled } from '../flags';

/**
 * Pure isolation merge: returns the shadow container with ONLY `canonical_contact` set or replaced.
 * Every sibling key is preserved verbatim, so this can never clobber a neighbour's data.
 */
export function applyCanonicalContactOnly(
  existing: Record<string, unknown> | null | undefined,
  record: CanonicalContactRecord,
): Record<string, unknown> {
  return { ...(existing ?? {}), canonical_contact: record };
}

// ── Semantic identity — the ONLY thing that gates persistence ──────────────────────────────────────
interface SemanticContactIdentity {
  platform: string | null;
  platformUserId: string | null;
  contactKey: string | null;
  displayName: string | null;
  profileUrl: string | null;
  unifiedPersonId: string | null;
  channels: string[] | null;
}

const normStr = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
  return s ? s : null;
};
const normList = (v: unknown): string[] | null => {
  if (!Array.isArray(v)) return null;
  const out = v.map((x) => String(x).trim().toLowerCase()).filter(Boolean).sort(); // order-insensitive
  return out.length ? out : null;
};

/**
 * Extract the semantic identity from a canonical record. Deliberately EXCLUDES built_at, version,
 * producer, parity, confidence, scores and evidence refs — none may trigger a write.
 */
export function extractSemanticContactIdentity(rec: unknown): SemanticContactIdentity {
  const facets = ((rec as { understanding?: { facets?: Record<string, { value?: Record<string, unknown> | null }> } })?.understanding?.facets) ?? {};
  const id = (facets.identity?.value ?? {}) as Record<string, unknown>;
  const profile = (facets.profile?.value ?? {}) as Record<string, unknown>;
  const channels = (facets.channels?.value ?? {}) as Record<string, unknown>;
  const entries = Array.isArray(channels.channels) ? (channels.channels as Array<{ channel?: unknown }>) : null;
  return {
    platform: normStr(id.platform),
    platformUserId: normStr(id.platformUserId),
    contactKey: normStr(id.contactKey),
    displayName: normStr(profile.displayName),
    profileUrl: normStr(profile.profileUrl),
    unifiedPersonId: normStr(id.unifiedPersonId),
    channels: entries ? normList(entries.map((c) => c?.channel)) : null,
  };
}

const grounded = (v: string | string[] | null): boolean => v !== null && (Array.isArray(v) ? v.length > 0 : v.length > 0);
const fieldEqual = (a: string | string[] | null, b: string | string[] | null): boolean =>
  (Array.isArray(a) || Array.isArray(b)) ? JSON.stringify(a) === JSON.stringify(b) : a === b;

export type ContactEvolutionReason = 'INITIAL' | 'IMPROVED' | 'CHANGED' | 'IDENTICAL' | 'DEGRADATION_PROTECTED';
export interface ContactPersistenceDecision { persist: boolean; reason: ContactEvolutionReason; }

/** Compose the per-field evolution policy into one whole-record decision. Pure. */
export function decideContactPersistence(prior: unknown, next: CanonicalContactRecord): ContactPersistenceDecision {
  if (prior == null) return { persist: true, reason: 'INITIAL' };

  const a = extractSemanticContactIdentity(prior);
  const b = extractSemanticContactIdentity(next);
  const keys = Object.keys(b) as Array<keyof SemanticContactIdentity>;

  let improved = false;
  let changed = false;
  for (const k of keys) {
    const before = a[k];
    const after = b[k];
    if (grounded(before) && !grounded(after)) return { persist: false, reason: 'DEGRADATION_PROTECTED' };
    if (!grounded(before) && grounded(after)) { improved = true; continue; }
    if (grounded(before) && grounded(after) && !fieldEqual(before, after)) changed = true;
  }

  if (improved) return { persist: true, reason: 'IMPROVED' };
  if (changed) return { persist: true, reason: 'CHANGED' };
  return { persist: false, reason: 'IDENTICAL' };
}

// ── Repository seam (injected; this module binds to no store) ───────────────────────────────────────
export interface ContactShadowPersistDeps {
  readShadow: (companyId: string, contactId: string) => Promise<Record<string, unknown> | null>;
  writeShadow: (companyId: string, contactId: string, container: Record<string, unknown>) => Promise<void>;
}

export interface ContactShadowPersistResult {
  companyId: string;
  contactId: string;
  /** false when the flag is OFF — nothing was produced and nothing was read. */
  executed: boolean;
  wrote: boolean;
  reason: ContactEvolutionReason | 'DISABLED';
  parity: number | null;
  version: number | null;
  builtAt: string | null;
}

/**
 * Orchestrate the shadow persist: produce canonical from write-path evidence, then write ONLY when the
 * meaningful identity evolved. Flag-gated — the guard is the first statement, so a dark call performs
 * no production, no read and no write.
 */
export async function runContactShadowPersist(
  input: ContactWriteInputs,
  deps: ContactShadowPersistDeps,
): Promise<ContactShadowPersistResult> {
  if (!isContactUnderstandingEnabled()) {
    return { companyId: input.companyId, contactId: input.contactId, executed: false, wrote: false, reason: 'DISABLED', parity: null, version: null, builtAt: null };
  }

  const { record } = produceCanonicalContact(input);
  const existing = await deps.readShadow(input.companyId, input.contactId);
  const decision = decideContactPersistence((existing ?? {})['canonical_contact'], record);

  if (decision.persist) {
    await deps.writeShadow(input.companyId, input.contactId, applyCanonicalContactOnly(existing, record));
  }

  return {
    companyId: input.companyId,
    contactId: input.contactId,
    executed: true,
    wrote: decision.persist,
    reason: decision.reason,
    parity: record.parity,
    version: record.version,
    builtAt: record.built_at,
  };
}
