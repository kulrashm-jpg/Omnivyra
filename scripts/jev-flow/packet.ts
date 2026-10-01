/**
 * gov packet: the frozen, hashed work order for one governed Story.
 *
 * Built only from a READY readiness result plus the base commit/branch/
 * worktree; stored under GOV_HOME as `<hash>.json` (canonical) and `<hash>.md`
 * (readable). Storing refuses credential-shaped text; loading re-hashes.
 * Everything here is deterministic — no timestamps.
 */
import fs from 'node:fs';
import { canonicalJson } from '../jev-bjc/canonical';
import { findSecretShapes } from '../jev-bjc/redaction';
import {
  COMMIT_RE,
  GOVERNANCE_VERSION,
  HUMAN_ONLY_RULES,
  PACKET_SCHEMA,
  SHA256_REF_RE,
  STORY_KEY_RE,
  TRAILER_GOVERNED_BY,
  TRAILER_GOV_PACKET,
  canonicalHash,
  packetHash,
  type GovLayout,
  type GovernedPacket,
  type PacketBase,
  type ReadinessResult,
  type Sha256Ref,
  type StoredPacket,
} from './types';

export function buildPacket(readiness: ReadinessResult, base: PacketBase): GovernedPacket {
  if (readiness.ready !== true || !readiness.story || !readiness.acceptance_criteria || !readiness.scope || !readiness.verification) {
    throw new Error('cannot build a packet: Story is not ready');
  }
  if (!base || typeof base.commit !== 'string' || !COMMIT_RE.test(base.commit)) throw new Error('base commit must be a full 40-hex commit id');
  if (typeof base.branch !== 'string' || base.branch.trim() === '') throw new Error('base branch is required');
  if (typeof base.worktree !== 'string' || base.worktree.trim() === '') throw new Error('base worktree is required');
  return {
    schema: PACKET_SCHEMA,
    governance_version: GOVERNANCE_VERSION,
    story: readiness.story,
    acceptance_criteria: readiness.acceptance_criteria,
    scope: readiness.scope,
    verification: readiness.verification,
    base: { commit: base.commit, branch: base.branch.trim(), worktree: base.worktree.trim().replace(/\\/g, '/') },
    rules: [...HUMAN_ONLY_RULES],
  };
}

const bullets = (items: readonly string[], empty = '_(none)_') => (items.length === 0 ? [empty] : items.map((i) => `- ${i}`));
const code = (items: readonly string[]) => (items.length === 0 ? ['_(none)_'] : items.map((i) => `- \`${i}\``));

export function renderPacketMarkdown(stored: StoredPacket): string {
  const p = stored.packet;
  const s = p.story;
  const out: string[] = [
    `# Governed packet — ${s.key}: ${s.summary}`,
    '',
    `- Packet hash: \`${stored.packet_hash}\``,
    `- Schema: ${p.schema} (${p.governance_version})`,
    `- Story status at packet time: ${s.status} (updated ${s.updated})`,
    '',
    '## Objective',
    '',
    s.objective,
    '',
    '## Architecture',
    '',
    s.architecture ?? '_(none)_',
    '',
    '## Invariants',
    '',
    ...bullets(s.invariants),
    '',
    '## Scope',
    '',
    'Authorized paths (change only files matching these):',
    '',
    ...code(p.scope.authorized_paths),
    '',
    'Prohibited paths (never touch; prohibited wins over authorized):',
    '',
    ...code(p.scope.prohibited_paths),
    '',
    '## Acceptance Criteria',
    '',
  ];
  for (const ac of p.acceptance_criteria) {
    out.push(`### ${ac.key} — ${ac.ac_id}`, '', `- Kind: ${ac.kind}`, `- Evidence kind: ${ac.evidence_kind}`, `- Status: ${ac.status}`, '', ac.statement, '');
  }
  out.push(
    '## Verification',
    '',
    'Registry ids (run only through `gov verify`):',
    '',
    ...code(p.verification.registry_ids),
    '',
    `Registry digest: \`${p.verification.registry_digest}\``,
    '',
    '## Base',
    '',
    `- Commit: \`${p.base.commit}\``,
    `- Branch: \`${p.base.branch}\``,
    `- Worktree: \`${p.base.worktree}\``,
    '',
    '## Human-only rules',
    '',
    ...bullets(p.rules),
    '',
    '## How to proceed',
    '',
    `1. Implement the Acceptance Criteria in \`${p.base.worktree}\` on branch \`${p.base.branch}\`, changing only authorized paths.`,
    `2. Commit with the trailers \`${TRAILER_GOVERNED_BY}: ${s.key}\` and \`${TRAILER_GOV_PACKET}: ${stored.packet_hash}\` on every commit.`,
    '3. Run `gov verify` and report its result; humans record results, verify, integrate and release.',
    '',
  );
  return out.join('\n');
}

/** Atlassian API token shapes — not covered by the BJC redaction list. */
const ATLASSIAN_TOKEN_RE = /\bAT[AC]TT[A-Za-z0-9_=+/-]{20,}/;

function credentialFindings(stored: StoredPacket, markdown: string): Array<{ path: string; pattern: string }> {
  const found = [...findSecretShapes(stored, '$packet'), ...findSecretShapes(markdown, '$markdown')];
  const json = canonicalJson(stored);
  if (ATLASSIAN_TOKEN_RE.test(json)) found.push({ path: '$packet', pattern: 'atlassian-api-token' });
  if (ATLASSIAN_TOKEN_RE.test(markdown)) found.push({ path: '$markdown', pattern: 'atlassian-api-token' });
  return found;
}

function writeOnce(file: string, content: string): void {
  if (fs.existsSync(file)) {
    if (fs.readFileSync(file, 'utf8') !== content) throw new Error(`packet file exists with different content: ${file}`);
    return;
  }
  fs.writeFileSync(file, content, { encoding: 'utf8', flag: 'wx' });
}

function storedJson(stored: StoredPacket): string {
  return `${canonicalJson(stored)}\n`;
}

/** Hashes, refuses credential-shaped text, writes `<hash>.json` + `<hash>.md`; idempotent. */
export function storePacket(layout: GovLayout, packet: GovernedPacket): StoredPacket {
  const stored: StoredPacket = { packet, packet_hash: packetHash(packet) };
  const markdown = renderPacketMarkdown(stored);
  const secrets = credentialFindings(stored, markdown);
  if (secrets.length > 0) {
    throw new Error(`refusing to store packet: credential-shaped text at ${secrets.map((x) => `${x.path} (${x.pattern})`).join(', ')}`);
  }
  fs.mkdirSync(layout.packetsDir(packet.story.key), { recursive: true });
  writeOnce(layout.packetFile(packet.story.key, stored.packet_hash, 'json'), storedJson(stored));
  writeOnce(layout.packetFile(packet.story.key, stored.packet_hash, 'md'), markdown);
  return stored;
}

/** Loads `<hash>.json` and re-hashes it; throws on any integrity mismatch. */
export function loadPacket(layout: GovLayout, storyKey: string, hash: Sha256Ref): StoredPacket {
  if (!STORY_KEY_RE.test(storyKey)) throw new Error('invalid story key');
  if (!SHA256_REF_RE.test(hash)) throw new Error('invalid packet hash');
  const file = layout.packetFile(storyKey, hash, 'json');
  if (!fs.existsSync(file)) throw new Error(`packet not found: ${file}`);
  let stored: StoredPacket;
  try {
    stored = JSON.parse(fs.readFileSync(file, 'utf8')) as StoredPacket;
  } catch {
    throw new Error('packet integrity failed: not valid JSON');
  }
  if (!stored || !stored.packet || stored.packet_hash !== hash) throw new Error('packet integrity failed: recorded hash mismatch');
  if (packetHash(stored.packet) !== hash) throw new Error('packet integrity failed: content does not match its hash');
  if (!stored.packet.story || stored.packet.story.key !== storyKey) throw new Error('packet integrity failed: wrong story');
  return stored;
}

/** Reasons the packet no longer matches Jira / the registry (sorted); empty = fresh. */
export function detectStale(packet: GovernedPacket, fresh: ReadinessResult): string[] {
  if (fresh.ready !== true || !fresh.story || !fresh.acceptance_criteria || !fresh.scope || !fresh.verification) {
    const codes = [...new Set(fresh.findings.map((f) => f.code))].sort();
    return [`Story ${packet.story.key} is no longer ready (${codes.join(', ') || 'unknown'})`];
  }
  const reasons: string[] = [];
  if (fresh.story.updated !== packet.story.updated) reasons.push(`Story ${packet.story.key} updated changed (${packet.story.updated} -> ${fresh.story.updated})`);
  const before = new Map(packet.acceptance_criteria.map((a) => [a.key, a]));
  const after = new Map(fresh.acceptance_criteria.map((a) => [a.key, a]));
  for (const key of after.keys()) if (!before.has(key)) reasons.push(`Acceptance Criterion ${key} added`);
  for (const [key, ac] of before) {
    const now = after.get(key);
    if (!now) reasons.push(`Acceptance Criterion ${key} removed`);
    else if (now.updated !== ac.updated) reasons.push(`Acceptance Criterion ${key} updated changed (${ac.updated} -> ${now.updated})`);
  }
  if (canonicalHash(fresh.scope) !== canonicalHash(packet.scope)) reasons.push('Scope (authorized / prohibited paths) changed');
  if (canonicalHash(fresh.verification.registry_ids) !== canonicalHash(packet.verification.registry_ids)) reasons.push('Verification registry ids changed');
  if (fresh.verification.registry_digest !== packet.verification.registry_digest) reasons.push('Verification registry digest changed');
  return reasons.sort();
}
