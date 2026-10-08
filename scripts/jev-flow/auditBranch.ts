/**
 * `gov audit-branch` — read-only detection of commits that do not carry governance
 * (harness certification N-14, owner decision A1(b): detection, no new authority).
 *
 * Every commit in base..HEAD is classified from its trailers alone:
 *
 *   GOVERNED                    exactly one `Governed-By: OMNI-n` and exactly one
 *                               `Gov-Packet: sha256:…`, and that packet is stored
 *                               intact in GOV_HOME for that Story
 *   GOVERNED_UNVERIFIED_PACKET  well-formed trailers, but the packet is not in this
 *                               GOV_HOME (e.g. another machine) — cannot be confirmed
 *   ADOPTION_BASELINE           exactly `Governed-By: OMNI-n`, no Gov-Packet, and a
 *                               binding in the ledger records this commit as that
 *                               Story's PRE_GOVERNANCE_ADOPTION_BASELINE
 *   MALFORMED                   claims governance but the trailers are inconsistent
 *                               (several Stories / packets, a packet with no Story, an
 *                               invalid value, or Governed-By alone without a recorded
 *                               adoption baseline)
 *   UNGOVERNED                  no governance trailer at all (plain work)
 *
 * What GOVERNED does NOT prove: that the bound session wrote the commit, that it stayed
 * in scope, or that its evidence passed — those are `gov verify` / `gov check-merge`.
 *
 * Authority boundary: detection only. This module runs no process (git is the injected
 * read-only GitProbe), never writes git history, GOV_HOME, Jira or any file, never
 * invokes JEV, and never blocks, merges, releases or deploys anything. Making the result
 * a required merge check would be an authority change and is deliberately not done here.
 */
import { SHA256_REF_RE, STORY_KEY_RE, TRAILER_GOVERNED_BY, TRAILER_GOV_PACKET, type GitProbe } from './types';

export const AUDIT_BRANCH_SCHEMA = 'gov-audit-branch/1' as const;

export type AuditCommitClass = 'GOVERNED' | 'GOVERNED_UNVERIFIED_PACKET' | 'ADOPTION_BASELINE' | 'MALFORMED' | 'UNGOVERNED';

/** NO_COMMITS and ALL_GOVERNED are clean; any MALFORMED/UNGOVERNED → UNGOVERNED_DETECTED; otherwise any unverified packet → UNVERIFIABLE. */
export type AuditBranchVerdict = 'NO_COMMITS' | 'ALL_GOVERNED' | 'UNVERIFIABLE' | 'UNGOVERNED_DETECTED';

export const AUDIT_COMMIT_CLASSES: readonly AuditCommitClass[] = ['GOVERNED', 'GOVERNED_UNVERIFIED_PACKET', 'ADOPTION_BASELINE', 'MALFORMED', 'UNGOVERNED'];

export interface AuditedCommit {
  commit: string;
  classification: AuditCommitClass;
  story: string | null;
  packet_hash: string | null;
  detail: string;
}

export interface AuditBranchReport {
  schema: typeof AUDIT_BRANCH_SCHEMA;
  worktree: string;
  base_commit: string;
  head_commit: string;
  /** Oldest first. */
  commits: AuditedCommit[];
  counts: Record<AuditCommitClass, number>;
  verdict: AuditBranchVerdict;
}

export interface AuditBranchInput {
  git: GitProbe;
  worktree: string;
  base: string;
  head: string;
  /** True iff the packet is stored in GOV_HOME for the Story and passes its integrity check. Read-only. */
  packetIntact: (storyKey: string, packetHash: string) => boolean;
  /** True iff a ledger binding records `commit` as the Story's adoption baseline. Read-only. */
  isAdoptionBaseline: (storyKey: string, commit: string) => boolean;
}

const uniq = (xs: string[]) => [...new Set(xs.map((x) => x.trim()))];

/** Pure classification of one commit's trailers. */
export function classifyCommit(
  commit: string,
  trailers: Record<string, string[]>,
  lookups: Pick<AuditBranchInput, 'packetIntact' | 'isAdoptionBaseline'>,
): AuditedCommit {
  const governedBy = uniq(trailers[TRAILER_GOVERNED_BY] ?? []);
  const packets = uniq(trailers[TRAILER_GOV_PACKET] ?? []);
  const out = (classification: AuditCommitClass, detail: string, story: string | null = null, packet: string | null = null): AuditedCommit => ({
    commit,
    classification,
    story,
    packet_hash: packet,
    detail,
  });
  if (governedBy.length === 0 && packets.length === 0) return out('UNGOVERNED', 'no Governed-By or Gov-Packet trailer');
  if (governedBy.length === 0) return out('MALFORMED', `${TRAILER_GOV_PACKET} without ${TRAILER_GOVERNED_BY}`, null, packets.length === 1 ? packets[0] : null);
  if (governedBy.length !== 1 || !STORY_KEY_RE.test(governedBy[0])) return out('MALFORMED', `${TRAILER_GOVERNED_BY} must name exactly one Story (found ${governedBy.join(', ')})`);
  const story = governedBy[0];
  if (packets.length === 0) {
    return lookups.isAdoptionBaseline(story, commit)
      ? out('ADOPTION_BASELINE', `recorded PRE_GOVERNANCE_ADOPTION_BASELINE of ${story}`, story)
      : out('MALFORMED', `${TRAILER_GOVERNED_BY}: ${story} without ${TRAILER_GOV_PACKET}, and no binding records it as an adoption baseline`, story);
  }
  if (packets.length !== 1 || !SHA256_REF_RE.test(packets[0])) return out('MALFORMED', `${TRAILER_GOV_PACKET} must be exactly one sha256:<hex> (found ${packets.length})`, story);
  const packet = packets[0];
  return lookups.packetIntact(story, packet)
    ? out('GOVERNED', `${story} packet ${packet} stored and intact`, story, packet)
    : out('GOVERNED_UNVERIFIED_PACKET', `${story} packet ${packet} is not stored intact in this GOV_HOME`, story, packet);
}

export function auditVerdict(commits: readonly AuditedCommit[]): AuditBranchVerdict {
  if (commits.length === 0) return 'NO_COMMITS';
  if (commits.some((c) => c.classification === 'UNGOVERNED' || c.classification === 'MALFORMED')) return 'UNGOVERNED_DETECTED';
  if (commits.some((c) => c.classification === 'GOVERNED_UNVERIFIED_PACKET')) return 'UNVERIFIABLE';
  return 'ALL_GOVERNED';
}

/** Read-only audit of base..head. Git errors propagate to the caller (which fails closed). */
export async function auditBranch(input: AuditBranchInput): Promise<AuditBranchReport> {
  const ids = await input.git.commitsBetween(input.worktree, input.base, input.head);
  const commits: AuditedCommit[] = [];
  for (const c of ids) commits.push(classifyCommit(c, await input.git.commitTrailers(input.worktree, c), input));
  const counts = Object.fromEntries(AUDIT_COMMIT_CLASSES.map((k) => [k, commits.filter((c) => c.classification === k).length])) as Record<AuditCommitClass, number>;
  return {
    schema: AUDIT_BRANCH_SCHEMA,
    worktree: input.worktree,
    base_commit: input.base,
    head_commit: input.head,
    commits,
    counts,
    verdict: auditVerdict(commits),
  };
}
