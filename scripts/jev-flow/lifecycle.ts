/**
 * gov lifecycle predicate engine (OMNI-44). PURE: no I/O, no clock, no JEV.
 *
 * Every Acceptance Criterion is evaluated on its own against the registry id
 * that proves it, never against the bundle-wide result:
 *
 *  1. Judgment AC                     → NEEDS_HUMAN (deterministic evidence never settles it)
 *  2. AC → registry id                → the `Registry check <id> passes` statement gov intake
 *                                       writes, else the unique packet id producing the AC's
 *                                       evidence kind; ambiguity → NEEDS_HUMAN, contradiction → CONFLICT
 *  3. no evidence / not intact        → INSUFFICIENT_EVIDENCE (missing evidence never passes)
 *  4. any freshness dimension moved   → STALE (stale evidence is never current, even a PASS)
 *  5. the AC's own item               → VERIFIABLE (PASS) · FAILED (FAIL) · CONFLICT (duplicate /
 *                                       wrong kind / result disagrees with exit code) ·
 *                                       INSUFFICIENT_EVIDENCE (no item)
 *
 * Freshness dimensions: bundle hash (the evidence is the current bundle), governed
 * HEAD (and a clean tree), packet hash (bound packet, still matching Jira),
 * verification-registry digest, automation-policy digest and the session/Story binding.
 */
import { createHash } from 'node:crypto';
import { normalizeWorktree } from './verify';
import {
  AC_EVIDENCE_KIND_TO_BJC,
  FRESHNESS_DIMENSIONS,
  LIFECYCLE_SCHEMA,
  REGISTRY_ID_RE,
  bundleHash,
  type AcLifecycle,
  type AcLifecycleState,
  type EvidenceItem,
  type EvidenceKind,
  type FreshnessCheck,
  type FreshnessDimension,
  type LifecycleResult,
  type PacketAc,
  type SessionBinding,
  type Sha256Ref,
  type StoredEvidenceBundle,
  type StoredPacket,
} from './types';

/** The current governed state evidence must still match. Gathered read-only by the caller. */
export interface GovernedState {
  /** The packet the Story is currently bound to (already integrity-checked when loaded). */
  packet: StoredPacket;
  /** Reasons the bound packet no longer matches Jira (packet.ts detectStale); empty = current. */
  packet_stale_reasons: string[];
  /** Latest binding of the Story, or null. */
  binding: SessionBinding | null;
  /** Governed worktree HEAD and cleanliness; null when unknown (fails closed). */
  head: string | null;
  clean: boolean | null;
  /** registryDigest(current registry, packet ids). */
  registry_digest: Sha256Ref | null;
  /** policyDigest of the automation policy now in force; null when it cannot be read. */
  automation_policy_digest: Sha256Ref | null;
  /** registry id → evidence kind, from the current registry. */
  registry_kinds: Readonly<Record<string, EvidenceKind>>;
}

export interface EvidenceUnderTest {
  stored: StoredEvidenceBundle | null;
  /** The bundle that is current for the Story; defaults to `stored` itself. */
  expected_bundle_hash?: Sha256Ref | null;
  /** policyDigest of the automation policy at the bundle's head commit; null when absent. */
  automation_policy_digest: Sha256Ref | null;
}

/** sha256 of the policy text with line endings normalized (a CRLF checkout and its LF blob agree). */
export function policyDigest(text: string): Sha256Ref {
  return `sha256:${createHash('sha256').update(text.replace(/\r\n/g, '\n'), 'utf8').digest('hex')}`;
}

/** The exact statement form gov intake writes for a registry-proven AC. */
const STATEMENT_RE = /^Registry check ([a-z0-9][a-z0-9._-]{1,63}) passes\b/;

function issueNumber(key: string): number {
  const n = Number(key.slice(key.indexOf('-') + 1));
  return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
}

export type AcMapping =
  | { ok: true; registry_id: string; mapping: 'statement' | 'evidence_kind' }
  | { ok: false; state: 'NEEDS_HUMAN' | 'CONFLICT'; reason: string };

/** Which registry id proves a Deterministic AC. Pure; never guesses between candidates. */
export function mapAcToRegistryId(ac: PacketAc, registryIds: readonly string[], kinds: Readonly<Record<string, EvidenceKind>>): AcMapping {
  const want = AC_EVIDENCE_KIND_TO_BJC[ac.evidence_kind];
  if (!want) return { ok: false, state: 'NEEDS_HUMAN', reason: 'AC_EVIDENCE_KIND_NOT_DETERMINISTIC' };
  const named = STATEMENT_RE.exec(String(ac.statement ?? '').trim());
  if (named && REGISTRY_ID_RE.test(named[1])) {
    const id = named[1];
    if (!registryIds.includes(id)) return { ok: false, state: 'CONFLICT', reason: 'AC_REGISTRY_ID_NOT_IN_PACKET' };
    if (kinds[id] !== want) return { ok: false, state: 'CONFLICT', reason: 'AC_EVIDENCE_KIND_MISMATCH' };
    return { ok: true, registry_id: id, mapping: 'statement' };
  }
  const candidates = registryIds.filter((id) => kinds[id] === want);
  if (candidates.length === 1) return { ok: true, registry_id: candidates[0], mapping: 'evidence_kind' };
  return { ok: false, state: 'NEEDS_HUMAN', reason: candidates.length === 0 ? 'AC_NO_REGISTRY_ID' : 'AC_REGISTRY_ID_AMBIGUOUS' };
}

/** Recomputes the bundle hash; a mismatch or an uncanonicalizable bundle is not intact. */
export function evidenceIntegrity(stored: StoredEvidenceBundle | null): { ok: boolean; reason: string | null } {
  if (!stored) return { ok: false, reason: 'NO_EVIDENCE' };
  if (!stored.bundle || typeof stored.bundle !== 'object') return { ok: false, reason: 'EVIDENCE_MALFORMED' };
  let actual: Sha256Ref;
  try {
    actual = bundleHash(stored.bundle);
  } catch {
    return { ok: false, reason: 'EVIDENCE_NOT_CANONICAL' };
  }
  return actual === stored.bundle_hash ? { ok: true, reason: null } : { ok: false, reason: 'EVIDENCE_HASH_MISMATCH' };
}

const bindingIdentity = (story: string, worktree: string, branch: string, base: string) => `${story} ${normalizeWorktree(worktree)} ${branch} ${base}`;

/** Every freshness dimension for an intact bundle, in FRESHNESS_DIMENSIONS order. Pure. */
export function evaluateFreshness(state: GovernedState, evidence: EvidenceUnderTest): FreshnessCheck[] {
  const stored = evidence.stored;
  if (!stored) return [];
  const b = stored.bundle;
  const packet = state.packet;
  const expectedBundle = evidence.expected_bundle_hash ?? stored.bundle_hash;
  const bound = state.binding;
  const checks: Record<FreshnessDimension, FreshnessCheck> = {
    bundle_hash: { dimension: 'bundle_hash', expected: expectedBundle, observed: stored.bundle_hash, fresh: expectedBundle === stored.bundle_hash },
    head: {
      dimension: 'head',
      expected: state.head === null ? null : `${state.head}${state.clean === true ? '' : state.clean === false ? ' (dirty)' : ' (tree state unknown)'}`,
      observed: b.head_commit,
      fresh: state.head !== null && state.clean === true && state.head === b.head_commit,
    },
    packet_hash: {
      dimension: 'packet_hash',
      expected: `${bound ? bound.packet_hash : packet.packet_hash}${state.packet_stale_reasons.length > 0 ? ' (packet no longer matches Jira)' : ''}`,
      observed: b.packet_hash,
      fresh: b.packet_hash === packet.packet_hash && (!bound || bound.packet_hash === packet.packet_hash) && state.packet_stale_reasons.length === 0,
    },
    registry_digest: {
      dimension: 'registry_digest',
      expected: state.registry_digest,
      observed: b.registry_digest,
      fresh: state.registry_digest !== null && state.registry_digest === b.registry_digest && packet.packet.verification.registry_digest === b.registry_digest,
    },
    automation_policy_digest: {
      dimension: 'automation_policy_digest',
      expected: state.automation_policy_digest,
      observed: evidence.automation_policy_digest,
      fresh: state.automation_policy_digest !== null && state.automation_policy_digest === evidence.automation_policy_digest,
    },
    binding: {
      dimension: 'binding',
      expected: bound ? bindingIdentity(bound.story_key, bound.worktree, bound.branch, bound.base_commit) : null,
      observed: bindingIdentity(b.story_key, b.worktree, b.branch, b.base_commit),
      fresh:
        bound !== null &&
        bound.story_key === packet.packet.story.key &&
        bindingIdentity(bound.story_key, bound.worktree, bound.branch, bound.base_commit) === bindingIdentity(b.story_key, b.worktree, b.branch, b.base_commit),
    },
  };
  return FRESHNESS_DIMENSIONS.map((d) => checks[d]);
}

function itemConsistent(item: EvidenceItem): boolean {
  const passed = item.exit_code === 0 && item.timed_out !== true;
  return (item.result === 'PASS') === passed && (item.result === 'PASS' || item.result === 'FAIL');
}

/** One AC, evaluated on its own. Pure. */
export function evaluateAc(
  ac: PacketAc,
  state: GovernedState,
  evidence: EvidenceUnderTest,
  integrity: { ok: boolean; reason: string | null },
  freshness: FreshnessCheck[],
): AcLifecycle {
  const out = (s: AcLifecycleState, reasons: string[], extra: Partial<AcLifecycle> = {}): AcLifecycle => ({
    ac_key: ac.key,
    ac_id: ac.ac_id,
    kind: ac.kind,
    evidence_kind: ac.evidence_kind,
    state: s,
    reasons: [...reasons].sort(),
    registry_id: null,
    mapping: null,
    deterministic: null,
    human_decision_required: s === 'NEEDS_HUMAN',
    stale_dimensions: [],
    ...extra,
  });

  if (ac.kind === 'Judgment') return out('NEEDS_HUMAN', ['HUMAN_JUDGMENT_REQUIRED']);
  if (ac.kind !== 'Deterministic') return out('NEEDS_HUMAN', ['UNSUPPORTED_AC_KIND']);

  const mapped = mapAcToRegistryId(ac, state.packet.packet.verification.registry_ids, state.registry_kinds);
  if (mapped.ok === false) return out(mapped.state, [mapped.reason]);
  const ids = { registry_id: mapped.registry_id, mapping: mapped.mapping };

  const stored = evidence.stored;
  if (!stored) return out('INSUFFICIENT_EVIDENCE', ['NO_EVIDENCE'], ids);
  if (integrity.ok !== true) return out('INSUFFICIENT_EVIDENCE', [integrity.reason ?? 'EVIDENCE_NOT_INTACT'], ids);

  const stale = freshness.filter((c) => !c.fresh).map((c) => c.dimension);
  if (stale.length > 0) return out('STALE', stale.map((d) => `STALE_${d.toUpperCase()}`), { ...ids, stale_dimensions: stale });

  const b = stored.bundle;
  if (!b.scope || b.scope.ok !== true || !Array.isArray(b.items) || b.items.length === 0) return out('INSUFFICIENT_EVIDENCE', ['EVIDENCE_NOT_FROM_VERIFY'], ids);
  const items = b.items.filter((i) => i && i.registry_id === mapped.registry_id);
  if (items.length === 0) return out('INSUFFICIENT_EVIDENCE', ['NO_ITEM_FOR_REGISTRY_ID'], ids);
  if (items.length > 1) return out('CONFLICT', ['DUPLICATE_ITEMS_FOR_REGISTRY_ID'], ids);
  const item = items[0];
  if (item.evidence_kind !== state.registry_kinds[mapped.registry_id]) return out('CONFLICT', ['ITEM_KIND_MISMATCH'], ids);
  if (!itemConsistent(item)) return out('CONFLICT', ['ITEM_RESULT_DISAGREES_WITH_EXIT'], ids);
  const deterministic = { bundle_hash: stored.bundle_hash, head_commit: b.head_commit, item_id: item.id, registry_id: item.registry_id, result: item.result };
  return item.result === 'PASS'
    ? out('VERIFIABLE', ['ITEM_PASS'], { ...ids, deterministic })
    : out('FAILED', [item.timed_out ? 'ITEM_TIMED_OUT' : 'ITEM_FAIL'], { ...ids, deterministic });
}

/** Every packet AC against one evidence bundle (or none), sorted by Jira key. Pure and deterministic. */
export function evaluateLifecycle(state: GovernedState, evidence: EvidenceUnderTest): LifecycleResult {
  const integrity = evidence.stored ? evidenceIntegrity(evidence.stored) : { ok: false, reason: 'NO_EVIDENCE' };
  const freshness = integrity.ok ? evaluateFreshness(state, evidence) : [];
  const acs = [...state.packet.packet.acceptance_criteria].sort((a, b) => issueNumber(a.key) - issueNumber(b.key) || a.key.localeCompare(b.key));
  return {
    schema: LIFECYCLE_SCHEMA,
    story_key: state.packet.packet.story.key,
    packet_hash: state.packet.packet_hash,
    bundle_hash: evidence.stored ? evidence.stored.bundle_hash : null,
    integrity,
    freshness,
    per_ac: acs.map((ac) => evaluateAc(ac, state, evidence, integrity, freshness)),
  };
}

/** Per-AC submission value: the AC's own registry item, never the bundle-wide result. Pure. */
export type AcSubmission =
  | { kind: 'deterministic'; registry_id: string; item_id: string; result: 'PASS' | 'FAIL' }
  | { kind: 'human'; reason: string }
  | { kind: 'none'; reason: string };

export function acSubmission(ac: PacketAc, stored: StoredEvidenceBundle, packet: StoredPacket, kinds: Readonly<Record<string, EvidenceKind>>): AcSubmission {
  if (ac.kind !== 'Deterministic') return { kind: 'human', reason: ac.kind === 'Judgment' ? 'HUMAN_JUDGMENT_REQUIRED' : 'UNSUPPORTED_AC_KIND' };
  const mapped = mapAcToRegistryId(ac, packet.packet.verification.registry_ids, kinds);
  if (mapped.ok === false) return mapped.state === 'NEEDS_HUMAN' ? { kind: 'human', reason: mapped.reason } : { kind: 'none', reason: mapped.reason };
  const items = stored.bundle.items.filter((i) => i.registry_id === mapped.registry_id);
  if (items.length !== 1) return { kind: 'none', reason: items.length === 0 ? 'NO_ITEM_FOR_REGISTRY_ID' : 'DUPLICATE_ITEMS_FOR_REGISTRY_ID' };
  if (!itemConsistent(items[0])) return { kind: 'none', reason: 'ITEM_RESULT_DISAGREES_WITH_EXIT' };
  return { kind: 'deterministic', registry_id: items[0].registry_id, item_id: items[0].id, result: items[0].result };
}
