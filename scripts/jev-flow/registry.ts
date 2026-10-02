/**
 * gov verification registry (D-4): the ONLY commands `gov verify` may run.
 *
 * Loaded from verification-registry.json and validated strictly; any schema
 * violation throws. Commands are argv arrays executed without a shell, and
 * argv[0] must be `node` (run as process.execPath).
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  REGISTRY_ID_RE,
  REGISTRY_SCHEMA,
  canonicalHash,
  type EvidenceKind,
  type Sha256Ref,
  type VerificationRegistry,
  type VerificationRegistryEntry,
} from './types';

export const DEFAULT_REGISTRY_FILE = path.join(__dirname, 'verification-registry.json');
export const MAX_TIMEOUT_MS = 3_600_000;
const EVIDENCE_KINDS: readonly EvidenceKind[] = ['test_run', 'typecheck', 'build'];
const ENTRY_KEYS = ['id', 'description', 'argv', 'evidence_kind', 'timeout_ms'];

function fail(msg: string): never {
  throw new Error(`invalid verification registry: ${msg}`);
}

/** Validate an already-parsed registry value; throws on any violation. */
export function validateRegistry(value: unknown): VerificationRegistry {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail('not an object');
  const reg = value as Record<string, unknown>;
  if (reg.schema !== REGISTRY_SCHEMA) fail(`schema must be ${REGISTRY_SCHEMA}`);
  if (!Array.isArray(reg.entries) || reg.entries.length === 0) fail('entries must be a non-empty array');
  const seen = new Set<string>();
  const entries: VerificationRegistryEntry[] = [];
  (reg.entries as unknown[]).forEach((raw, i) => {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) fail(`entries[${i}] is not an object`);
    const e = raw as Record<string, unknown>;
    for (const k of Object.keys(e)) if (!ENTRY_KEYS.includes(k)) fail(`entries[${i}] has unknown key ${k}`);
    if (typeof e.id !== 'string' || !REGISTRY_ID_RE.test(e.id)) fail(`entries[${i}].id is invalid`);
    if (seen.has(e.id)) fail(`duplicate id ${e.id}`);
    seen.add(e.id);
    if (typeof e.description !== 'string' || e.description.trim() === '') fail(`${e.id}: description is empty`);
    if (!Array.isArray(e.argv) || e.argv.length === 0) fail(`${e.id}: argv must be non-empty`);
    (e.argv as unknown[]).forEach((a, j) => {
      if (typeof a !== 'string' || a === '' || a.includes('\0')) fail(`${e.id}: argv[${j}] must be a non-empty string without NUL`);
    });
    if (e.argv[0] !== 'node') fail(`${e.id}: argv[0] must be "node"`);
    if (!EVIDENCE_KINDS.includes(e.evidence_kind as EvidenceKind)) fail(`${e.id}: evidence_kind is invalid`);
    if (typeof e.timeout_ms !== 'number' || !Number.isInteger(e.timeout_ms) || e.timeout_ms <= 0 || e.timeout_ms > MAX_TIMEOUT_MS) {
      fail(`${e.id}: timeout_ms must be a positive integer <= ${MAX_TIMEOUT_MS}`);
    }
    entries.push({
      id: e.id,
      description: e.description,
      argv: [...(e.argv as string[])],
      evidence_kind: e.evidence_kind as EvidenceKind,
      timeout_ms: e.timeout_ms,
    });
  });
  return { schema: REGISTRY_SCHEMA, entries };
}

/** Read + validate the registry file (default: verification-registry.json beside this module). */
export function loadRegistry(file: string = DEFAULT_REGISTRY_FILE): VerificationRegistry {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    fail(`cannot read ${path.basename(file)}: ${(e as Error).message}`);
  }
  return validateRegistry(parsed);
}

export type ResolveResult = { ok: true; entries: VerificationRegistryEntry[] } | { ok: false; unknown: string[] };

/** Entries for `ids`, in the given order; unknown ids are a refusal, never skipped. */
export function resolveEntries(registry: VerificationRegistry, ids: string[]): ResolveResult {
  const byId = new Map(registry.entries.map((e) => [e.id, e] as const));
  const unknown = ids.filter((id) => !byId.has(id));
  if (unknown.length > 0) return { ok: false, unknown: [...new Set(unknown)] };
  return { ok: true, entries: ids.map((id) => byId.get(id)) };
}

/**
 * SHARED FORMULA (Track 1 packet generation uses the identical one):
 * canonicalHash of the full entry objects for `ids`, in `ids` order.
 * Unknown ids hash as null so drift (an id removed) still changes the digest.
 */
export function registryDigest(registry: VerificationRegistry, ids: string[]): Sha256Ref {
  return canonicalHash(ids.map((id) => registry.entries.find((e) => e.id === id) ?? null));
}
