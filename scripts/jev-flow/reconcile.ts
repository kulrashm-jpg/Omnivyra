/**
 * `gov reconcile` (OMNI-44) — read-only, dry-run reconciliation.
 *
 * For every governed Story in the local ledger (or the ones asked for) it
 * gathers, READ-ONLY: the bound packet, Jira readiness (reader identity), the
 * governed worktree HEAD, every stored evidence bundle (each integrity-checked),
 * the automation policy in force and the one at the evidence's HEAD, and every
 * AC's recorded Jira values. lifecycle.ts evaluates each AC on its own; the pure
 * `proposeAc` then compares that with Jira and proposes changes ONLY a human
 * may make. If Jira already matches, nothing is proposed.
 *
 * There is no apply mode. This module writes nothing: no Jira write, no ledger
 * append, no evidence or packet store, no git write, no JEV. The JEV verdict in
 * Jira is reported as advisory and never changes a state or a proposal.
 */
import fs from 'node:fs';
import { AC_FETCH_FIELDS, extractAcContext } from '../jev-jira/context';
import type { JiraIssue } from '../jev-jira/jiraClient';
import { readBindings } from './binding';
import { loadBundle } from './evidence';
import { evaluateLifecycle, policyDigest, type GovernedState } from './lifecycle';
import { detectStale, loadPacket } from './packet';
import { registryDigest } from './registry';
import {
  AUTOMATION_POLICY_PATH,
  COMMIT_RE,
  GOVERNANCE_VERSION,
  RECONCILE_SCHEMA,
  canonicalHash,
  type AcDeterministicFact,
  type AcLifecycle,
  type AcReconcile,
  type EvidenceKind,
  type FreshnessDimension,
  type GitProbe,
  type GovLayout,
  type ProposedFieldChange,
  type ReadinessResult,
  type ReconcileReport,
  type SessionBinding,
  type Sha256Ref,
  type StoredEvidenceBundle,
  type StoryReconcile,
  type VerificationRegistry,
} from './types';

/** Fields read per AC (the same set gov judge reads). */
export const RECONCILE_AC_FIELDS = AC_FETCH_FIELDS;

/** Everything reconcile reads, injected so the command stays read-only and testable. */
export interface ReconcilePorts {
  layout: GovLayout;
  registry: VerificationRegistry;
  git: GitProbe;
  /** Text of `relPath` at `commit` in `worktree` (read-only `git show`), or null when absent. */
  readCommitFile: (worktree: string, commit: string, relPath: string) => Promise<string | null>;
  /** The automation policy in force (this tool's AUTOMATION-POLICY.md), or null when unreadable. */
  currentPolicyText: string | null;
  /** Readiness of the Story through the reader identity. */
  readiness: (storyKey: string) => Promise<ReadinessResult>;
  /** One AC, read through the reader identity. */
  readAc: (key: string) => Promise<JiraIssue>;
}

// ---------------------------------------------------------------- pure helpers

/** `gov-evidence <bundle> head <12 hex> <id>=<PASS|FAIL> …` — the pinned Evidence References form. */
const REF_RE = /^gov-evidence (sha256:[0-9a-f]{64}) head ([0-9a-f]{12})((?: [a-z0-9][a-z0-9._-]{1,63}=(?:PASS|FAIL))*)$/;

export interface ParsedEvidenceReference {
  bundle_hash: Sha256Ref;
  head12: string;
  items: Record<string, 'PASS' | 'FAIL'>;
}

/** Parses a gov Evidence References value; null for anything else. Pure. */
export function parseEvidenceReference(text: string | null): ParsedEvidenceReference | null {
  if (typeof text !== 'string') return null;
  const m = REF_RE.exec(text.trim());
  if (!m) return null;
  const items: Record<string, 'PASS' | 'FAIL'> = {};
  for (const pair of m[3].trim().split(' ').filter(Boolean)) {
    const [id, result] = pair.split('=');
    if (id in items) return null;
    items[id] = result as 'PASS' | 'FAIL';
  }
  return { bundle_hash: m[1] as Sha256Ref, head12: m[2], items };
}

/** The per-AC Evidence References line: this AC's own registry item only. */
export function acEvidenceReferenceLine(fact: AcDeterministicFact): string {
  return `gov-evidence ${fact.bundle_hash} head ${fact.head_commit.slice(0, 12)} ${fact.registry_id}=${fact.result}`;
}

export interface JiraAcView {
  deterministic_result: string | null;
  evidence_references: string | null;
  verification: string | null;
  jev_verdict: string | null;
}

/** What Jira's Evidence References points at, after looking it up locally. */
export type CitedEvidence =
  | { status: 'none' }
  | { status: 'unrecognized' }
  | { status: 'unknown'; bundle_hash: Sha256Ref }
  | { status: 'not_intact'; bundle_hash: Sha256Ref }
  | {
      status: 'evaluated';
      bundle_hash: Sha256Ref;
      ac: AcLifecycle;
      recorded: ParsedEvidenceReference;
      /** Bundle-level dimensions that moved — independent of whether the AC could be mapped to an item. */
      bundle_stale: FreshnessDimension[];
    };

const decided = (verification: string | null) => verification !== null && verification !== 'UNVERIFIED';
const settled = (s: AcLifecycle) => s.state === 'VERIFIABLE' || s.state === 'FAILED';

function freshValues(current: AcLifecycle): { result: string | null; refs: string | null } {
  return settled(current) && current.deterministic
    ? { result: current.deterministic.result, refs: acEvidenceReferenceLine(current.deterministic) }
    : { result: null, refs: null };
}

function changes(jira: JiraAcView, wanted: { result: string | null; refs: string | null; verification?: string | null }): ProposedFieldChange[] {
  const out: ProposedFieldChange[] = [];
  if (jira.deterministic_result !== wanted.result) out.push({ field: 'Deterministic Result', current: jira.deterministic_result, proposed: wanted.result });
  if (jira.evidence_references !== wanted.refs) out.push({ field: 'Evidence References', current: jira.evidence_references, proposed: wanted.refs });
  if (wanted.verification !== undefined && jira.verification !== wanted.verification) out.push({ field: 'Verification', current: jira.verification, proposed: wanted.verification });
  return out;
}

/**
 * Compares one AC's computed lifecycle with what Jira records. Pure and
 * deterministic. `current` is the AC evaluated against the Story's current
 * bundle; `cited` is the bundle Jira's Evidence References names.
 */
export function proposeAc(current: AcLifecycle, jira: JiraAcView, cited: CitedEvidence): AcReconcile {
  const out = (disposition: AcReconcile['disposition'], reasons: string[], proposed: ProposedFieldChange[] = []): AcReconcile => ({
    ac_key: current.ac_key,
    ac_id: current.ac_id,
    state: current.state,
    disposition,
    reasons: [...new Set(reasons)].sort(),
    changes: proposed,
    jev_advisory: jira.jev_verdict,
  });
  const citesGov = cited.status === 'evaluated' || cited.status === 'unknown' || cited.status === 'not_intact';

  // Human-judgment ACs: gov never records a deterministic result for them.
  if (current.kind === 'Judgment') {
    if (jira.deterministic_result !== null && citesGov) {
      return out('CONFLICT', ['BUNDLE_RESULT_ON_JUDGMENT_AC'], [{ field: 'Deterministic Result', current: jira.deterministic_result, proposed: null }]);
    }
    return decided(jira.verification) ? out('NO_OP', ['HUMAN_DECISION_RECORDED']) : out('HUMAN_DECISION', current.reasons);
  }
  // Stale evidence cited in Jira is invalidated whatever else holds for the AC (even an unmappable one).
  const staleReasons = (dims: FreshnessDimension[]) => dims.map((d) => `STALE_${d.toUpperCase()}`);
  const invalidate = (extra: string[]): AcReconcile => {
    const fresh = freshValues(current);
    const wanted = { ...fresh, ...(decided(jira.verification) ? { verification: 'UNVERIFIED' } : {}) };
    return out('INVALIDATE_STALE_EVIDENCE', ['JIRA_CITES_STALE_EVIDENCE', settled(current) ? 'FRESH_EVIDENCE_AVAILABLE' : 'REVERIFY_REQUIRED', ...extra], changes(jira, wanted));
  };
  const citedStale = cited.status === 'evaluated' && cited.bundle_stale.length > 0;

  if (current.state === 'CONFLICT' || current.state === 'NEEDS_HUMAN') {
    if (citedStale) return invalidate([...staleReasons(cited.bundle_stale), ...current.reasons]);
    return current.state === 'CONFLICT' ? out('CONFLICT', current.reasons) : out('HUMAN_DECISION', current.reasons);
  }

  switch (cited.status) {
    case 'none': {
      if (jira.deterministic_result !== null) return out('HUMAN_DECISION', ['JIRA_RESULT_WITHOUT_GOV_EVIDENCE']);
      // A recorded verification with no recorded result and no evidence is never left standing silently.
      if (decided(jira.verification)) return out('CONFLICT', ['JIRA_VERIFIED_WITHOUT_RECORDED_RESULT', ...current.reasons]);
      if (settled(current)) return out('HUMAN_DECISION', ['RECORD_RESULT', ...current.reasons], changes(jira, freshValues(current)));
      return out('INSUFFICIENT_EVIDENCE', ['NO_CURRENT_EVIDENCE', ...current.reasons]);
    }
    case 'unrecognized':
      return out('HUMAN_DECISION', ['JIRA_EVIDENCE_NOT_GOV']);
    case 'unknown':
      return out('CONFLICT', ['JIRA_CITES_UNKNOWN_EVIDENCE']);
    case 'not_intact':
      return out('CONFLICT', ['JIRA_CITES_EVIDENCE_NOT_INTACT']);
    case 'evaluated': {
      const was = cited.ac;
      if (was.state === 'STALE' || citedStale) return invalidate([...staleReasons(cited.bundle_stale), ...was.reasons]);
      if (settled(was) && was.deterministic) {
        const recordedItem = cited.recorded.items[was.deterministic.registry_id];
        const agrees = jira.deterministic_result === was.deterministic.result && (recordedItem === undefined || recordedItem === was.deterministic.result);
        return agrees ? out('NO_OP', ['JIRA_MATCHES_EVIDENCE']) : out('CONFLICT', ['JIRA_RESULT_DISAGREES_WITH_EVIDENCE']);
      }
      if (was.state === 'CONFLICT') return out('CONFLICT', was.reasons);
      if (was.state === 'NEEDS_HUMAN') return out('HUMAN_DECISION', was.reasons);
      return out('CONFLICT', ['JIRA_CITES_EVIDENCE_WITHOUT_AC_ITEM', ...was.reasons]);
    }
  }
}

function issueNumber(key: string): number {
  const n = Number(key.slice(key.indexOf('-') + 1));
  return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
}

/** Hash of the proposed change set; no timestamps, so an unchanged world gives the same hash. */
export function changeSetHash(stories: StoryReconcile[]): Sha256Ref {
  return canonicalHash({ schema: RECONCILE_SCHEMA, stories });
}

// ---------------------------------------------------------------- read-only gathering

/** Every stored bundle of a Story, each loaded through loadBundle (re-hashed). Reads only. */
export function readStoredBundles(layout: GovLayout, storyKey: string): { intact: StoredEvidenceBundle[]; failures: string[] } {
  const dir = layout.evidenceDir(storyKey);
  let names: string[];
  try {
    names = fs.readdirSync(dir).filter((n) => /^[0-9a-f]{64}\.json$/.test(n)).sort();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { intact: [], failures: [] };
    throw err;
  }
  const intact: StoredEvidenceBundle[] = [];
  const failures: string[] = [];
  for (const name of names) {
    const hash = `sha256:${name.slice(0, 64)}` as Sha256Ref;
    try {
      intact.push(loadBundle(layout, storyKey, hash));
    } catch (err) {
      failures.push(`${hash}: ${(err as Error).message}`);
    }
  }
  return { intact, failures };
}

/** The Story's current bundle: the latest verified_at, ties broken by hash. */
export function currentBundle(bundles: StoredEvidenceBundle[]): StoredEvidenceBundle | null {
  let best: StoredEvidenceBundle | null = null;
  for (const b of bundles) {
    if (!best) best = b;
    else if (b.bundle.verified_at > best.bundle.verified_at || (b.bundle.verified_at === best.bundle.verified_at && b.bundle_hash > best.bundle_hash)) best = b;
  }
  return best;
}

async function policyAt(ports: ReconcilePorts, stored: StoredEvidenceBundle): Promise<Sha256Ref | null> {
  const b = stored.bundle;
  if (!COMMIT_RE.test(b.head_commit)) return null;
  try {
    const text = await ports.readCommitFile(b.worktree, b.head_commit, AUTOMATION_POLICY_PATH);
    return text === null ? null : policyDigest(text);
  } catch {
    return null;
  }
}

function emptyStory(storyKey: string, error: string, extra: Partial<StoryReconcile> = {}): StoryReconcile {
  return { story_key: storyKey, packet_hash: null, bundle_hash: null, error, integrity_failures: [], freshness: [], per_ac: [], ...extra };
}

/** One Story, read-only. Never throws for expected failures. */
export async function reconcileStory(storyKey: string, binding: SessionBinding | null, ports: ReconcilePorts): Promise<StoryReconcile> {
  if (!binding) return emptyStory(storyKey, 'no binding in the governance ledger');
  let packet;
  try {
    packet = loadPacket(ports.layout, storyKey, binding.packet_hash);
  } catch (err) {
    return emptyStory(storyKey, `bound packet unusable: ${(err as Error).message}`, { integrity_failures: [`packet ${binding.packet_hash}: ${(err as Error).message}`] });
  }
  const { intact, failures } = readStoredBundles(ports.layout, storyKey);
  const base = { packet_hash: packet.packet_hash, integrity_failures: failures };

  let readiness: ReadinessResult;
  try {
    readiness = await ports.readiness(storyKey);
  } catch (err) {
    return emptyStory(storyKey, `Jira readiness read failed: ${(err as Error).message}`, base);
  }

  let head: string | null = null;
  let clean: boolean | null = null;
  try {
    head = await ports.git.headCommit(binding.worktree);
    clean = await ports.git.isClean(binding.worktree);
    if (!COMMIT_RE.test(head)) head = null;
  } catch {
    head = null;
    clean = null;
  }

  const ids = packet.packet.verification.registry_ids;
  const kinds: Record<string, EvidenceKind> = {};
  for (const e of ports.registry.entries) kinds[e.id] = e.evidence_kind;
  const state: GovernedState = {
    packet,
    packet_stale_reasons: detectStale(packet.packet, readiness),
    binding,
    head,
    clean,
    registry_digest: registryDigest(ports.registry, ids),
    automation_policy_digest: ports.currentPolicyText === null ? null : policyDigest(ports.currentPolicyText),
    registry_kinds: kinds,
  };

  const latest = currentBundle(intact);
  const current = evaluateLifecycle(state, { stored: latest, expected_bundle_hash: latest?.bundle_hash ?? null, automation_policy_digest: latest ? await policyAt(ports, latest) : null });
  const byHash = new Map(intact.map((b) => [b.bundle_hash, b] as const));
  const failedHashes = new Set(failures.map((f) => f.slice(0, 'sha256:'.length + 64)));
  const citedCache = new Map<Sha256Ref, ReturnType<typeof evaluateLifecycle>>();

  const perAc: AcReconcile[] = [];
  for (const ac of current.per_ac) {
    let issue: JiraIssue;
    try {
      issue = await ports.readAc(ac.ac_key);
    } catch (err) {
      return emptyStory(storyKey, `Jira read of ${ac.ac_key} failed: ${(err as Error).message}`, base);
    }
    const ctx = extractAcContext(issue);
    if (ctx.ok === false) return emptyStory(storyKey, `${ac.ac_key} is not a valid Acceptance Criterion (${ctx.code})`, base);
    const jira: JiraAcView = {
      deterministic_result: ctx.value.deterministicResult,
      evidence_references: ctx.value.evidenceReferences,
      verification: ctx.value.verification,
      jev_verdict: ctx.value.advisory.jevVerdict,
    };
    let cited: CitedEvidence;
    const parsed = parseEvidenceReference(jira.evidence_references);
    if (jira.evidence_references === null) cited = { status: 'none' };
    else if (!parsed) cited = { status: 'unrecognized' };
    else if (failedHashes.has(parsed.bundle_hash)) cited = { status: 'not_intact', bundle_hash: parsed.bundle_hash };
    else if (!byHash.has(parsed.bundle_hash)) cited = { status: 'unknown', bundle_hash: parsed.bundle_hash };
    else {
      let evaluated = parsed.bundle_hash === latest?.bundle_hash ? current : citedCache.get(parsed.bundle_hash);
      if (!evaluated) {
        const stored = byHash.get(parsed.bundle_hash) as StoredEvidenceBundle;
        evaluated = evaluateLifecycle(state, { stored, expected_bundle_hash: latest?.bundle_hash ?? null, automation_policy_digest: await policyAt(ports, stored) });
        citedCache.set(parsed.bundle_hash, evaluated);
      }
      cited = {
        status: 'evaluated',
        bundle_hash: parsed.bundle_hash,
        ac: evaluated.per_ac.find((a) => a.ac_key === ac.ac_key) as AcLifecycle,
        recorded: parsed,
        bundle_stale: evaluated.freshness.filter((c) => !c.fresh).map((c) => c.dimension),
      };
    }
    perAc.push(proposeAc(ac, jira, cited));
  }
  return { story_key: storyKey, ...base, bundle_hash: latest?.bundle_hash ?? null, error: null, freshness: current.freshness, per_ac: perAc };
}

/** Governed Stories from the ledger (latest binding each), or the requested ones; sorted by key. */
export function governedStories(layout: GovLayout, only: string[] | null): Array<{ story: string; binding: SessionBinding | null }> {
  const latest = new Map<string, SessionBinding>();
  for (const b of readBindings(layout)) latest.set(b.story_key, b);
  const keys = only && only.length > 0 ? [...new Set(only)] : [...latest.keys()];
  return keys.sort((a, b) => issueNumber(a) - issueNumber(b) || a.localeCompare(b)).map((story) => ({ story, binding: latest.get(story) ?? null }));
}

/** The full dry-run report. Writes nothing. */
export async function runReconcile(only: string[] | null, ports: ReconcilePorts): Promise<ReconcileReport> {
  const stories: StoryReconcile[] = [];
  for (const { story, binding } of governedStories(ports.layout, only)) stories.push(await reconcileStory(story, binding, ports));
  return { schema: RECONCILE_SCHEMA, governance_version: GOVERNANCE_VERSION, dry_run: true, stories, change_set_hash: changeSetHash(stories) };
}
