/**
 * RELEASE-R3D — Governance Runtime Consumer Abstraction Layer.
 *
 * The single reusable seam through which application code interacts with the
 * FROZEN Governance Runtime v1.0.0. It is invoke-only and consumes ONLY the
 * runtime's PUBLISHED contracts:
 *   - the published admission entrypoint (`gateway.mjs --json`, GOV-AUTO-022),
 *     spawned as a child process and read as documented JSON — never imported;
 *   - the published release manifests (`docs/governance-runtime-v1.0.0/
 *     VERSION.json` + `MANIFEST.json`) for version compatibility.
 *
 * Hard boundaries (Release R3D constraints):
 *   - It NEVER imports runtime internals (no `import … from '…/runtime/*.mjs'`).
 *     The only coupling is the published CLI contract + published JSON.
 *   - It duplicates NO governance logic — the runtime alone decides admission.
 *   - It is additive and independently removable: nothing in the frozen runtime,
 *     the constitution, or any deterministic digest is touched.
 *   - It is NEVER placed on the standard request path (the adapter that consumes
 *     it is feature-flagged OFF by default and scoped to designated workflows).
 *
 * This module defines the invocation / response / error interfaces, timeout and
 * retry handling, and version-compatibility verification. It performs no
 * feature-flag or fail-open/closed policy — that is the adapter's job.
 */
import { execFile } from 'child_process';
import { readFileSync } from 'fs';
import path from 'path';

// ── Published-contract locations (repo-root relative) ──────────────────────────
// Resolve the repo root from this file: backend/services/governance → repo root.
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
/** The runtime's single published admission entrypoint (WP-23 / GOV-AUTO-022). */
export const GOVERNANCE_ADMISSION_ENTRYPOINT = path.join(
  REPO_ROOT,
  'docs',
  'company-intelligence',
  'governance-automation',
  'runtime',
  'gateway.mjs',
);
const VERSION_JSON = path.join(REPO_ROOT, 'docs', 'governance-runtime-v1.0.0', 'VERSION.json');
const MANIFEST_JSON = path.join(REPO_ROOT, 'docs', 'governance-runtime-v1.0.0', 'MANIFEST.json');

// ── Version compatibility contract the consumer is built against ───────────────
/** The consumer's own semantic version (independent of the runtime version). */
export const CONSUMER_VERSION = '1.0.0';
/**
 * The published Governance Runtime this consumer is certified against. A runtime
 * with a different MAJOR version, or a release digest that does not match the
 * frozen baseline, is rejected as incompatible (§6 — reject incompatible
 * versions). Minor/patch increments within the same major are accepted.
 */
export const SUPPORTED_RUNTIME = {
  expectedVersion: '1.0.0',
  minMajor: 1,
  maxMajor: 1,
  expectedReleaseDigest: '4903e8fb',
} as const;

// ── Interfaces ─────────────────────────────────────────────────────────────────

/** A single admission invocation request against the published entrypoint. */
export interface GovernanceInvocation {
  /** Opaque execution reference for the operation seeking admission. */
  executionRef: string;
  /** Constitutional generation the operation targets (active generation is 3). */
  generation: number;
}

/** Options controlling timeout and retry for one invocation. */
export interface GovernanceInvokeOptions {
  /** Hard per-attempt timeout in ms (the child is killed on timeout). Default 45000. */
  timeoutMs?: number;
  /** Number of RETRIES after the first attempt (total attempts = retries + 1). Default 1. */
  retries?: number;
  /** Backoff between attempts in ms. Default 250. */
  retryBackoffMs?: number;
  /**
   * Injectable low-level invoker (published-entrypoint spawner). Defaults to the
   * real child-process spawn. Tests supply a deterministic stub so the abstraction
   * can be exercised without a 40 s runtime spawn — no governance logic is mocked,
   * only the transport.
   */
  invoker?: RuntimeInvoker;
  /** Skip the compatibility gate (used only by the compatibility check itself). */
  skipCompatibility?: boolean;
}

/** The normalized, documented response the abstraction returns. */
export interface GovernanceResponse {
  /** The runtime's admission decision, verbatim from published JSON. */
  decision: 'Admitted' | 'Rejected' | 'Deferred';
  /** Whether the operation may enter the execution pipeline. */
  entersPipeline: boolean;
  /** Runtime-supplied reason (present for Rejected/Deferred). */
  reason: string | null;
  /** Admission id from the published admission registry. */
  admissionId: string | null;
  /** Runtime version reported by the live entrypoint. */
  runtimeVersion: string;
  /** Wall-clock duration of the successful attempt (ms). */
  durationMs: number;
  /** Attempts consumed (1 = first attempt succeeded). */
  attempts: number;
  /** The compatibility report resolved before invocation. */
  compatibility: CompatibilityReport;
  /** The raw published JSON, retained for diagnostics/provenance. */
  raw: unknown;
}

/** Stable, typed error codes for every consumer failure mode. */
export type GovernanceConsumerErrorCode =
  | 'GOV_CONSUMER_INCOMPATIBLE'   // published runtime version/digest not supported
  | 'GOV_CONSUMER_TIMEOUT'        // entrypoint exceeded the per-attempt timeout
  | 'GOV_CONSUMER_INVOKE_FAILED'  // entrypoint failed to run / non-zero exit
  | 'GOV_CONSUMER_BAD_OUTPUT';    // stdout was not the documented JSON contract

export class GovernanceConsumerError extends Error {
  readonly code: GovernanceConsumerErrorCode;
  readonly attempts: number;
  readonly detail?: string;
  constructor(code: GovernanceConsumerErrorCode, message: string, opts?: { attempts?: number; detail?: string }) {
    super(message);
    this.name = 'GovernanceConsumerError';
    this.code = code;
    this.attempts = opts?.attempts ?? 0;
    this.detail = opts?.detail;
  }
}

/** Result of comparing the published runtime against the consumer's contract. */
export interface CompatibilityReport {
  compatible: boolean;
  runtimeVersion: string | null;
  releaseDigest: string | null;
  consumerVersion: string;
  expectedVersion: string;
  expectedReleaseDigest: string;
  /** Human-readable reasons when incompatible (empty when compatible). */
  reasons: string[];
}

/** Low-level transport: run the published entrypoint, resolve to raw stdout. */
export type RuntimeInvoker = (
  entrypoint: string,
  args: string[],
  timeoutMs: number,
) => Promise<{ stdout: string; stderr: string }>;

// ── Default transport (real child-process spawn of the published entrypoint) ───

const defaultInvoker: RuntimeInvoker = (entrypoint, args, timeoutMs) =>
  new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [entrypoint, ...args],
      { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => {
        if (err) {
          // execFile sets err.killed when the timeout fired — that IS a transport
          // failure. A NON-ZERO exit is NOT: the admission gateway exits non-zero
          // to signal a blocked (Rejected/Deferred) decision while still printing
          // the documented admission JSON to stdout. So when the timeout did not
          // fire and stdout carries the contract, resolve it and let the parser
          // read the decision — the exit code is a secondary signal only.
          const killed = (err as NodeJS.ErrnoException & { killed?: boolean }).killed === true;
          const out = String(stdout ?? '');
          if (!killed && out.trim().length > 0) {
            resolve({ stdout: out, stderr: String(stderr ?? '') });
            return;
          }
          const e = new Error(err.message) as Error & { killed?: boolean };
          e.killed = killed;
          reject(e);
          return;
        }
        resolve({ stdout: String(stdout), stderr: String(stderr) });
      },
    );
  });

// ── Compatibility verification (§6) ────────────────────────────────────────────

function readJson(file: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function majorOf(version: string | null): number | null {
  if (!version) return null;
  const n = Number(String(version).split('.')[0]);
  return Number.isFinite(n) ? n : null;
}

/**
 * Verify the PUBLISHED runtime is compatible with this consumer, using only the
 * published VERSION.json / MANIFEST.json (no runtime execution). Reject on
 * unsupported major version or a release digest that does not match the frozen
 * baseline. Missing published contracts are treated as incompatible (fail closed).
 */
export function checkCompatibility(): CompatibilityReport {
  const version = readJson(VERSION_JSON);
  const manifest = readJson(MANIFEST_JSON);
  const runtimeVersion =
    (version?.runtimeVersion as string) ?? (manifest?.runtimeVersion as string) ?? null;
  const releaseDigest = (version?.releaseDigest as string) ?? null;
  const reasons: string[] = [];

  if (!version) reasons.push('published VERSION.json is missing or unreadable');
  const major = majorOf(runtimeVersion);
  if (major === null) {
    reasons.push('runtime version could not be resolved from published contracts');
  } else if (major < SUPPORTED_RUNTIME.minMajor || major > SUPPORTED_RUNTIME.maxMajor) {
    reasons.push(
      `runtime major ${major} outside supported range ` +
        `${SUPPORTED_RUNTIME.minMajor}..${SUPPORTED_RUNTIME.maxMajor}`,
    );
  }
  if (releaseDigest && releaseDigest !== SUPPORTED_RUNTIME.expectedReleaseDigest) {
    reasons.push(
      `release digest ${releaseDigest} != expected ${SUPPORTED_RUNTIME.expectedReleaseDigest}`,
    );
  }
  if (!releaseDigest) reasons.push('release digest absent from published VERSION.json');

  return {
    compatible: reasons.length === 0,
    runtimeVersion,
    releaseDigest,
    consumerVersion: CONSUMER_VERSION,
    expectedVersion: SUPPORTED_RUNTIME.expectedVersion,
    expectedReleaseDigest: SUPPORTED_RUNTIME.expectedReleaseDigest,
    reasons,
  };
}

// ── Response parsing (published JSON contract) ─────────────────────────────────

function parseResponse(stdout: string): {
  decision: GovernanceResponse['decision'];
  entersPipeline: boolean;
  reason: string | null;
  admissionId: string | null;
  runtimeVersion: string;
  raw: unknown;
} | null {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(stdout) as Record<string, unknown>;
  } catch {
    return null;
  }
  const ad = raw.admissionDecision as Record<string, unknown> | undefined;
  const decision = ad?.gatewayDecision as string | undefined;
  if (decision !== 'Admitted' && decision !== 'Rejected' && decision !== 'Deferred') return null;
  return {
    decision,
    entersPipeline: ad?.entersPipeline === true,
    reason: (ad?.reason as string) ?? null,
    admissionId: (ad?.admissionId as string) ?? null,
    runtimeVersion: (raw.runtimeVersion as string) ?? 'unknown',
    raw,
  };
}

// ── Invocation (timeout + retry, compatibility-gated) ──────────────────────────

/**
 * Invoke the published admission entrypoint and return the normalized response.
 * Verifies compatibility first (rejects incompatible runtimes). Applies a hard
 * per-attempt timeout and a bounded retry policy. Throws a typed
 * GovernanceConsumerError on any failure; the CALLER (adapter) decides whether a
 * failure is fatal (fail-closed) — this layer holds no policy.
 */
export async function invokeGovernanceRuntime(
  invocation: GovernanceInvocation,
  options: GovernanceInvokeOptions = {},
): Promise<GovernanceResponse> {
  const timeoutMs = options.timeoutMs ?? 45_000;
  const retries = Math.max(0, options.retries ?? 1);
  const backoff = options.retryBackoffMs ?? 250;
  const invoker = options.invoker ?? defaultInvoker;

  // Always resolve a compatibility report (it rides on the response for
  // diagnostics); `skipCompatibility` only skips the hard gate below.
  const compatibility = checkCompatibility();
  if (!options.skipCompatibility && !compatibility.compatible) {
    throw new GovernanceConsumerError(
      'GOV_CONSUMER_INCOMPATIBLE',
      `Governance Runtime incompatible: ${compatibility.reasons.join('; ')}`,
      { attempts: 0, detail: compatibility.reasons.join('; ') },
    );
  }

  const args = [
    '--execute',
    invocation.executionRef,
    '--generation',
    String(invocation.generation),
    '--json',
  ];

  let lastErr: GovernanceConsumerError | null = null;
  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    const startedAt = Date.now();
    try {
      const { stdout } = await invoker(GOVERNANCE_ADMISSION_ENTRYPOINT, args, timeoutMs);
      const parsed = parseResponse(stdout);
      if (!parsed) {
        lastErr = new GovernanceConsumerError(
          'GOV_CONSUMER_BAD_OUTPUT',
          'Published entrypoint did not return the documented admission JSON contract.',
          { attempts: attempt },
        );
        // A malformed contract is not transiently retryable — stop.
        break;
      }
      return {
        decision: parsed.decision,
        entersPipeline: parsed.entersPipeline,
        reason: parsed.reason,
        admissionId: parsed.admissionId,
        runtimeVersion: parsed.runtimeVersion,
        durationMs: Date.now() - startedAt,
        attempts: attempt,
        compatibility,
        raw: parsed.raw,
      };
    } catch (err) {
      const killed = (err as Error & { killed?: boolean })?.killed === true;
      lastErr = new GovernanceConsumerError(
        killed ? 'GOV_CONSUMER_TIMEOUT' : 'GOV_CONSUMER_INVOKE_FAILED',
        killed
          ? `Governance admission timed out after ${timeoutMs}ms.`
          : `Governance admission invocation failed: ${(err as Error)?.message ?? 'unknown'}`,
        { attempts: attempt, detail: (err as Error)?.message },
      );
      if (attempt <= retries && backoff > 0) {
        await new Promise((r) => setTimeout(r, backoff));
      }
    }
  }
  throw lastErr ?? new GovernanceConsumerError('GOV_CONSUMER_INVOKE_FAILED', 'Unknown invocation failure.');
}
