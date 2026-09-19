// U1 evaluation-tree identity (CPG_U1_PROTOCOL_004 §7.1, approved CPG-047). The evaluated resolver is the repository
// CONTENT at the pinned commit, identified by three values the protocol itself declares: the commit id, the git tree
// object id, and a content manifest aggregate over `git ls-files`.
//
// Content is authoritative. A clone whose content differs is refused — that is what stops a later mainline state from
// silently becoming the treatment. A clone whose commit or tree id differs while the content aggregate matches is
// accepted with a recorded note, because a rewritten history does not change what was evaluated (§7.1).
//
// The instrument is NOT the treatment: a clone whose tracked files include `research/cpg-u1` is refused, so the tooling
// can never be folded into the resolver identity even when both live in one repository.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sha256 } from './canonical.mjs';

export const EVALUATION_TREE_DOMAIN = 'cpg-u1-evaluation-tree/v1';
/** The instrument's path. Its presence in a treatment clone is a conflation of instrument with treatment. */
export const INSTRUMENT_PATH = 'research/cpg-u1';
const HEX40 = /^[0-9a-f]{40}$/;
const HEX64 = /^[0-9a-f]{64}$/;

const git = (repoDir, ...args) => execFileSync('git', ['-C', repoDir, ...args], { encoding: 'utf8', maxBuffer: 1 << 28 }).trim();

/**
 * The content manifest: one `"<sha256>  <path>\n"` line per tracked path, sorted by path, aggregated with sha256.
 * Same construction as the tooling aggregate (§24), applied to the resolver's tracked tree.
 */
export function treeManifest(repoDir) {
  const paths = git(repoDir, 'ls-files').split('\n').filter(Boolean).sort();
  const text = paths.map((p) => `${sha256(readFileSync(join(repoDir, p)))}  ${p}\n`).join('');
  return { files: paths.length, paths, text, aggregate: sha256(text) };
}

/** What the clone actually is: commit, tree object, cleanliness, and the content manifest of the working tree. */
export function repoIdentity(repoDir) {
  const manifest = treeManifest(repoDir);
  return {
    commit: git(repoDir, 'rev-parse', 'HEAD'),
    tree: git(repoDir, 'rev-parse', 'HEAD^{tree}'),
    clean: git(repoDir, 'status', '--porcelain') === '',
    files: manifest.files,
    aggregate: manifest.aggregate,
    instrument_paths: manifest.paths.filter((p) => p === INSTRUMENT_PATH || p.startsWith(`${INSTRUMENT_PATH}/`)),
  };
}

/** The three values the protocol declares in §7.1. The protocol is the single source of truth; nothing is hard-coded here. */
export function declaredIdentity(protocolText) {
  const section = /###\s*7\.1[\s\S]*?(?=\n##\s)/.exec(protocolText ?? '');
  if (!section) throw new Error('protocol does not state §7.1 (evaluated software identity)');
  const body = section[0];
  if (!body.includes(EVALUATION_TREE_DOMAIN)) throw new Error(`§7.1 does not state the ${EVALUATION_TREE_DOMAIN} domain`);
  const commit = /commit `([0-9a-f]{40})`/.exec(body)?.[1];
  const tree = /tree object id `([0-9a-f]{40})`/.exec(body)?.[1];
  const agg = /`([0-9a-f]{64})` \((\d+) files\)/.exec(body);
  const missing = [];
  if (!HEX40.test(commit ?? '')) missing.push('commit id');
  if (!HEX40.test(tree ?? '')) missing.push('git tree object id');
  if (!agg || !HEX64.test(agg[1])) missing.push('content manifest aggregate with its file count');
  if (missing.length) throw new Error(`§7.1 is incomplete: ${missing.join('; ')}`);
  return { commit, tree, aggregate: agg[1], files: Number(agg[2]) };
}

/**
 * Verify a clone against the protocol's §7.1 declaration.
 * Returns `{ ok, refusals, notes, declared, identity }`; `ok` is false when any refusal applies.
 */
export function verifyEvaluationTree({ repoDir, protocolText }) {
  const refusals = []; const notes = [];
  let declared;
  try { declared = declaredIdentity(protocolText); } catch (e) { return { ok: false, refusals: [{ code: 'PROTOCOL_IDENTITY_INCOMPLETE', message: e.message }], notes, declared: null, identity: null }; }
  const identity = repoIdentity(repoDir);
  if (identity.instrument_paths.length) {
    refusals.push({ code: 'INSTRUMENT_IN_TREATMENT', message: `the clone's tracked files include the instrument (${INSTRUMENT_PATH}): ${identity.instrument_paths.length} path(s). The instrument is pinned separately by the tooling aggregate (§19.1) and is never part of the evaluated resolver identity (§7.1)` });
  }
  if (!identity.clean) refusals.push({ code: 'WORKING_TREE_DIRTY', message: 'the clone has working-tree changes, so its content is not the committed content' });
  if (identity.aggregate !== declared.aggregate) {
    refusals.push({ code: 'CONTENT_MISMATCH', message: `content manifest aggregate ${identity.aggregate} is not the declared ${declared.aggregate} — this clone is not the U1 evaluation tree (§7.1: later mainline states never become the treatment)` });
  }
  if (identity.files !== declared.files) refusals.push({ code: 'FILE_COUNT_MISMATCH', message: `tracked file count ${identity.files} is not the declared ${declared.files}` });
  // Content is authoritative: a differing commit or tree id over identical content is recorded, not refused (§7.1).
  if (identity.commit !== declared.commit) notes.push({ code: 'COMMIT_ID_DIFFERS', message: `clone HEAD ${identity.commit} is not the declared commit ${declared.commit}${identity.aggregate === declared.aggregate ? ' — the content aggregate matches, so this is the evaluated content under a different commit id (e.g. a rewritten history)' : ''}` });
  if (identity.tree !== declared.tree) notes.push({ code: 'TREE_ID_DIFFERS', message: `clone tree ${identity.tree} is not the declared tree ${declared.tree}${identity.aggregate === declared.aggregate ? ' — the content aggregate matches' : ''}` });
  return { ok: refusals.length === 0, refusals, notes, declared, identity };
}
