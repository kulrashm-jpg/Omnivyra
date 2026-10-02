/**
 * gov evidence bundles + command logs, stored under GOV_HOME only.
 *
 * Bundles are content-addressed by bundleHash (canonical JSON) and re-hashed
 * on every load; logs are content-addressed by the sha256 of their bytes.
 * Nothing here is written to the repo or sent to Jira.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { canonicalJson } from '../jev-bjc/canonical';
import { findSecretShapes } from '../jev-bjc/redaction';
import {
  EVIDENCE_SCHEMA,
  GOVERNANCE_VERSION,
  SHA256_REF_RE,
  bundleHash,
  type EvidenceBundle,
  type GovLayout,
  type Sha256Ref,
  type StoredEvidenceBundle,
} from './types';

export type BundleInput = Omit<EvidenceBundle, 'schema' | 'governance_version' | 'deterministic_result'>;

/** deterministic_result = PASS iff scope.ok and every item PASS (an empty item list is FAIL). */
export function buildBundle(input: BundleInput): EvidenceBundle {
  const pass = input.scope.ok === true && input.items.length > 0 && input.items.every((i) => i.result === 'PASS');
  return {
    schema: EVIDENCE_SCHEMA,
    governance_version: GOVERNANCE_VERSION,
    story_key: input.story_key,
    packet_hash: input.packet_hash,
    worktree: input.worktree,
    branch: input.branch,
    base_commit: input.base_commit,
    head_commit: input.head_commit,
    registry_digest: input.registry_digest,
    scope: input.scope,
    items: input.items,
    deterministic_result: pass ? 'PASS' : 'FAIL',
    verified_at: input.verified_at,
  };
}

function integrity(msg: string): Error {
  return new Error(`INTEGRITY_FAILED: ${msg}`);
}

/** Write via a temp file + rename so a reader never sees a partial file. */
function writeAtomic(file: string, data: string | Buffer): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

/** Store the canonical StoredEvidenceBundle; refuses credential shapes; idempotent. */
export function storeBundle(layout: GovLayout, bundle: EvidenceBundle): StoredEvidenceBundle {
  const stored: StoredEvidenceBundle = { bundle, bundle_hash: bundleHash(bundle) };
  const findings = findSecretShapes(stored);
  if (findings.length > 0) {
    throw new Error(`evidence bundle refused: credential-shaped value at ${findings.map((f) => `${f.path} (${f.pattern})`).join(', ')}`);
  }
  const text = canonicalJson(stored);
  const file = layout.evidenceFile(bundle.story_key, stored.bundle_hash);
  if (fs.existsSync(file)) {
    if (fs.readFileSync(file, 'utf8') !== text) throw integrity(`existing evidence file differs: ${path.basename(file)}`);
    return stored;
  }
  writeAtomic(file, text);
  return stored;
}

/** Load a bundle by hash; recomputes bundleHash and checks the filename, recorded hash and content agree. */
export function loadBundle(layout: GovLayout, storyKey: string, hash: Sha256Ref): StoredEvidenceBundle {
  if (!SHA256_REF_RE.test(hash)) throw integrity('not a sha256 ref');
  const file = layout.evidenceFile(storyKey, hash);
  if (!fs.existsSync(file)) throw new Error(`evidence bundle not found: ${path.basename(file)}`);
  let stored: StoredEvidenceBundle;
  try {
    stored = JSON.parse(fs.readFileSync(file, 'utf8')) as StoredEvidenceBundle;
  } catch {
    throw integrity('evidence file is not valid JSON');
  }
  if (!stored || typeof stored !== 'object' || !stored.bundle || typeof stored.bundle !== 'object') throw integrity('evidence file is malformed');
  if (stored.bundle_hash !== hash) throw integrity('recorded bundle_hash does not match the requested hash');
  let actual: Sha256Ref;
  try {
    actual = bundleHash(stored.bundle);
  } catch {
    throw integrity('evidence bundle cannot be canonicalized');
  }
  if (actual !== hash) throw integrity('bundle content does not match its hash');
  if (stored.bundle.story_key !== storyKey) throw integrity('bundle story_key does not match');
  return { bundle: stored.bundle, bundle_hash: stored.bundle_hash };
}

/** Store captured stdout+stderr content-addressed by sha256 of the bytes. */
export function storeLog(layout: GovLayout, storyKey: string, bytes: Buffer): { sha256: Sha256Ref; bytes: number } {
  const sha256 = `sha256:${createHash('sha256').update(bytes).digest('hex')}` as Sha256Ref;
  const file = layout.logFile(storyKey, sha256);
  if (!fs.existsSync(file)) writeAtomic(file, bytes);
  return { sha256, bytes: bytes.length };
}
