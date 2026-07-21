/**
 * PROVIDER CAPABILITY DRIFT VERIFIER (PB-008 · Program B · Platform · TEST LAYER).
 *
 * WHY. PB-004 made provider capabilities queryable Platform metadata, hand-maintained
 * with mandatory `evidence` strings. PB-005 added a Product-side drift ALARM — it can
 * observe drift, it cannot prevent it. Nothing verified that the registry's
 * declarations still match Platform implementation. This module is that verifier.
 *
 * WHERE IT LIVES, AND WHY. Entirely in the test layer. `aiGatewayCapabilities.ts` must
 * keep its single, type-only import — so the registry may NOT reach for the transport
 * tables, and the transport tables may not reach for the registry. The comparison
 * therefore happens HERE: the test imports BOTH sides and cross-checks them. Nothing in
 * this file is reachable from runtime code.
 *
 * THE HONESTY CONTRACT (inherited from PB-004, and the reason this file is careful):
 *
 *   1. THREE-VALUED MODEL. `undeclared` means "the Platform makes no claim". That is
 *      NOT drift. Only a declaration that CONTRADICTS evidence is drift. Capabilities
 *      PB-004 deliberately under-claims (grounding · reasoning · provenance ·
 *      safetyMetadata · toolCalling — claimed by nobody) are never demanded.
 *
 *   2. NO SILENT PASSES. Every declaration is classified `machine-verified` (naming the
 *      evidence source) or `unverifiable` (naming the reason). The report carries a
 *      COVERAGE RATIO, so "all green" can never hide a registry half of which was
 *      merely present rather than checked.
 *
 *   3. ACTIONABLE DIAGNOSTICS. A finding names provider · capability · declared value ·
 *      observed evidence · evidence source · the remedy — as text, so a failing CI log
 *      is enough to act on.
 *
 * FULLY INJECTED. `verifyProviderCapabilityRegistry(snapshot, model)` reads NOTHING
 * global: both the registry snapshot and the evidence model are parameters. That is
 * what makes the negative controls possible — a synthetic snapshot/model exercises a
 * drift class without touching the real registry or any runtime module.
 *
 * Pure: no network, no I/O except the optional evidence-anchor corpus (read-only
 * `fs.readFileSync` of in-tree sources), no mutation of anything it is handed.
 */

// ── Registry snapshot (the thing under verification) ──────────────────────────

/** One declaration, flattened out of the registry (or synthesized by a fixture). */
export type CapabilityDeclarationSnapshot = {
  readonly capability: string;
  readonly supported: boolean;
  readonly evidence: string;
};

/** One provider's declarations. */
export type CapabilityProfileSnapshot = {
  readonly provider: string;
  readonly declarations: readonly CapabilityDeclarationSnapshot[];
};

/**
 * A plain, structurally-typed view of a capability registry. The real registry is
 * projected into this shape; a fixture builds one literally. The verifier cannot tell
 * the difference — which is exactly what lets the negative controls prove detection.
 */
export type CapabilityRegistrySnapshot = {
  readonly providers: readonly CapabilityProfileSnapshot[];
};

// ── Evidence model (what the Platform actually does) ──────────────────────────

/**
 * One observation of Platform reality for (provider, capability). `source` is the
 * machine-readable evidence source it came from and is reproduced verbatim in
 * diagnostics — a finding is worthless if the reader cannot go look at the source.
 */
export type EvidenceObservation = {
  readonly capability: string;
  readonly supported: boolean;
  /** e.g. "descriptor-table GATEWAY_PROVIDER_CAPABILITIES.gemini.supportsSeed". */
  readonly source: string;
  /** How the observation was obtained (probe / table read / registry lookup). */
  readonly method: EvidenceMethod;
  readonly detail?: string;
};

/**
 * How strong an observation is.
 *   `behavioral-probe`  — the real implementation was EXECUTED and observed.
 *   `descriptor-table`  — a canonical Platform descriptor table was read.
 *   `metadata-registry` — the live provider-metadata descriptor registry was queried.
 * Probes outrank tables when both exist; a disagreement between them is itself
 * reported (`evidence_conflict`) rather than silently resolved.
 */
export type EvidenceMethod = 'behavioral-probe' | 'descriptor-table' | 'metadata-registry';

export type ProviderEvidence = {
  readonly provider: string;
  readonly observations: readonly EvidenceObservation[];
};

/** Resolves the in-tree symbols an `evidence` string cites. */
export type EvidenceAnchorResolver = {
  /** True when the cited token still exists in-tree. */
  readonly resolves: (token: string) => boolean;
  /** Where the anchor corpus came from (reproduced in diagnostics). */
  readonly describe: string;
};

export type CapabilityEvidenceModel = {
  /** Canonical provider ids (GATEWAY_PROVIDER_IDS). Registry completeness is measured against this. */
  readonly canonicalProviders: readonly string[];
  /** Canonical capability vocabulary (PROVIDER_CAPABILITY_NAMES). */
  readonly knownCapabilities: readonly string[];
  /**
   * Capabilities a provider MUST take a position on. Deliberately narrow: only the
   * capabilities described for EVERY provider by a canonical descriptor table, i.e.
   * where the Platform demonstrably HAS the answer, so silence is an omission rather
   * than an honest non-claim. Everything else may be left undeclared.
   */
  readonly requiredClaims: readonly string[];
  readonly providers: readonly ProviderEvidence[];
  /** Optional: enables `stale_evidence_reference` detection. */
  readonly evidenceAnchors?: EvidenceAnchorResolver;
  /**
   * Strict mode: escalate a declaration with NO evidence source from `unverifiable`
   * to a hard `unsupported_declaration` finding. OFF for the real registry today
   * (PB-004 legitimately carries structurally-evidenced declarations); it exists so
   * the ratchet can be tightened later, and so the drift class is provably detectable.
   */
  readonly requireEvidenceSource?: boolean;
};

// ── Findings ──────────────────────────────────────────────────────────────────

export type DriftKind =
  /** A canonical provider has no registry profile at all. */
  | 'missing_profile'
  /** The registry profiles a provider the dispatcher does not know. */
  | 'unregistered_provider'
  /** Implementation evidence exists for a REQUIRED claim, the registry is silent. */
  | 'missing_declaration'
  /** The declaration contradicts the observed evidence. */
  | 'stale_declaration'
  /** The declaration has no evidence source at all (unknown capability / strict mode). */
  | 'unsupported_declaration'
  /** Two evidence sources disagree about the same (provider, capability). */
  | 'evidence_conflict'
  /** The `evidence` string cites an in-tree symbol that no longer exists. */
  | 'stale_evidence_reference';

export type DriftFinding = {
  readonly kind: DriftKind;
  readonly provider: string;
  readonly capability: string | null;
  /** The registry's declared value, or 'undeclared'/'n-a'. */
  readonly declared: boolean | 'undeclared' | 'n-a';
  /** The observed evidence value, or 'none'/'n-a'. */
  readonly observed: boolean | 'none' | 'n-a';
  readonly evidenceSource: string;
  readonly remedy: string;
  /** Fully self-contained, human-actionable diagnostic. */
  readonly message: string;
};

export type DeclarationCheck = {
  readonly provider: string;
  readonly capability: string;
  readonly declared: boolean;
  readonly status: 'machine-verified' | 'unverifiable';
  readonly evidenceSource: string | null;
  readonly method: EvidenceMethod | null;
  readonly observed: boolean | null;
  /** Why it could not be machine-verified. Always set when status is 'unverifiable'. */
  readonly reason: string | null;
  readonly evidenceAnchors: 'anchored' | 'unanchored' | 'not-checked';
};

export type DriftCoverage = {
  readonly declarations: number;
  readonly machineVerified: number;
  readonly unverifiable: number;
  /** machineVerified / declarations, 0 when there is nothing to verify. */
  readonly ratio: number;
};

export type DriftReport = {
  readonly ok: boolean;
  readonly findings: readonly DriftFinding[];
  readonly checks: readonly DeclarationCheck[];
  readonly coverage: DriftCoverage;
  /** Multi-line diagnostic block; '' when there are no findings. */
  readonly formatted: string;
};

const REGISTRY_FILE = 'backend/services/aiGatewayCapabilities.ts';

function fmt(value: boolean | string | null): string {
  return value === null ? 'null' : String(value);
}

function finding(f: Omit<DriftFinding, 'message'>): DriftFinding {
  const capability = f.capability === null ? '(profile)' : `'${f.capability}'`;
  return {
    ...f,
    message:
      `[capability-drift] ${f.kind} — provider '${f.provider}' capability ${capability}: ` +
      `registry declares ${fmt(f.declared)}, evidence observes ${fmt(f.observed)} ` +
      `(source: ${f.evidenceSource}). Fix: ${f.remedy}`,
  };
}

// ── Evidence-string anchors ───────────────────────────────────────────────────

/**
 * Tokens inside an `evidence` string that name something in-tree. Deliberately
 * conservative — it extracts only shapes that are unambiguously code references, so
 * prose can never be mistaken for a citation:
 *   `foo.ts`                → a module file
 *   `callGemini`            → a transport/caller function
 *   `SCREAMING_SNAKE_CASE`  → an exported constant (underscore REQUIRED, so prose
 *                             like "SURFACE NOTE" or "PB-001" is never extracted)
 *   `GatewayFooError`       → a gateway class/type
 *   `aiGatewayFoo`          → a gateway module
 */
const ANCHOR_PATTERNS: readonly RegExp[] = [
  /\b[A-Za-z][A-Za-z0-9_]*\.ts\b/g,
  /\bcall[A-Z][A-Za-z0-9]*\b/g,
  /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g,
  /\bGateway[A-Z][A-Za-z0-9]*\b/g,
  /\bai[A-Z][A-Za-z0-9]*\b/g,
];

/** Every in-tree symbol an evidence string claims to cite. Deduped, source order. */
export function extractEvidenceAnchors(evidence: string): readonly string[] {
  const out: string[] = [];
  for (const pattern of ANCHOR_PATTERNS) {
    for (const match of evidence.matchAll(pattern)) {
      const token = match[0];
      if (!out.includes(token)) out.push(token);
    }
  }
  return out;
}

// ── The verifier ──────────────────────────────────────────────────────────────

/**
 * Cross-check a capability registry snapshot against an evidence model.
 *
 * NEVER THROWS. It returns a report; the caller decides what is fatal. That is what
 * lets the negative controls assert on the CONTENT of a detection rather than on the
 * fact that something blew up.
 */
export function verifyProviderCapabilityRegistry(
  snapshot: CapabilityRegistrySnapshot,
  model: CapabilityEvidenceModel,
): DriftReport {
  const findings: DriftFinding[] = [];
  const checks: DeclarationCheck[] = [];

  const profiles = new Map(snapshot.providers.map((p) => [p.provider, p]));
  const evidenceByProvider = new Map(model.providers.map((p) => [p.provider, p]));

  // ── Registry completeness (both directions) ────────────────────────────────
  for (const provider of model.canonicalProviders) {
    if (!profiles.has(provider)) {
      findings.push(
        finding({
          kind: 'missing_profile',
          provider,
          capability: null,
          declared: 'undeclared',
          observed: 'n-a',
          evidenceSource: 'dispatcher GATEWAY_PROVIDER_IDS',
          remedy:
            `add a '${provider}' profile (with evidence per declaration) to ` +
            `BUILT_IN_PROVIDER_CAPABILITIES in ${REGISTRY_FILE}.`,
        }),
      );
    }
  }
  for (const profile of snapshot.providers) {
    if (!model.canonicalProviders.includes(profile.provider)) {
      findings.push(
        finding({
          kind: 'unregistered_provider',
          provider: profile.provider,
          capability: null,
          declared: 'n-a',
          observed: 'none',
          evidenceSource: 'dispatcher GATEWAY_PROVIDER_IDS',
          remedy:
            `remove the '${profile.provider}' profile from ${REGISTRY_FILE}, or register the ` +
            `provider with the dispatcher (GATEWAY_PROVIDER_IDS).`,
        }),
      );
    }
  }

  // ── Per-provider declaration checks ────────────────────────────────────────
  for (const profile of snapshot.providers) {
    const observations = evidenceByProvider.get(profile.provider)?.observations ?? [];
    const byCapability = new Map<string, EvidenceObservation[]>();
    for (const o of observations) {
      const list = byCapability.get(o.capability);
      if (list) list.push(o);
      else byCapability.set(o.capability, [o]);
    }
    const declared = new Map(profile.declarations.map((d) => [d.capability, d]));

    // MISSING DECLARATION — evidence exists for a REQUIRED claim, registry is silent.
    // Gated on evidence existing: the verifier never demands a claim it could not
    // itself check, which is what keeps `undeclared` legitimate everywhere else.
    for (const capability of model.requiredClaims) {
      if (declared.has(capability)) continue;
      const observed = byCapability.get(capability);
      if (!observed || observed.length === 0) continue;
      findings.push(
        finding({
          kind: 'missing_declaration',
          provider: profile.provider,
          capability,
          declared: 'undeclared',
          observed: observed[0].supported,
          evidenceSource: observed[0].source,
          remedy:
            `declare '${capability}' for '${profile.provider}' in ${REGISTRY_FILE} as ` +
            `supported: ${observed[0].supported}, citing ${observed[0].source}.`,
        }),
      );
    }

    for (const declaration of profile.declarations) {
      const capability = declaration.capability;
      const observed = byCapability.get(capability) ?? [];

      // UNSUPPORTED DECLARATION (a) — a capability outside the Platform vocabulary can
      // have no evidence source by construction.
      if (!model.knownCapabilities.includes(capability)) {
        findings.push(
          finding({
            kind: 'unsupported_declaration',
            provider: profile.provider,
            capability,
            declared: declaration.supported,
            observed: 'none',
            evidenceSource: 'PROVIDER_CAPABILITY_NAMES (canonical capability vocabulary)',
            remedy:
              `add '${capability}' to PROVIDER_CAPABILITIES in ${REGISTRY_FILE} (with a ` +
              `definition), or drop the declaration — an undefined capability cannot be evidenced.`,
          }),
        );
      }

      // EVIDENCE CONFLICT — two sources disagree about the same fact. Reported, never
      // silently resolved: the Platform is internally inconsistent and a human must say
      // which source is right.
      const values = new Set(observed.map((o) => o.supported));
      if (values.size > 1) {
        const truthy = observed.filter((o) => o.supported).map((o) => o.source);
        const falsy = observed.filter((o) => !o.supported).map((o) => o.source);
        findings.push(
          finding({
            kind: 'evidence_conflict',
            provider: profile.provider,
            capability,
            declared: declaration.supported,
            observed: 'none',
            evidenceSource: `true from [${truthy.join(', ')}] vs false from [${falsy.join(', ')}]`,
            remedy:
              `reconcile the Platform evidence sources for '${profile.provider}'.'${capability}' — ` +
              `they contradict each other, so the registry cannot be verified against them.`,
          }),
        );
      }

      // Strongest available observation wins for the pass/fail comparison.
      const primary =
        observed.find((o) => o.method === 'behavioral-probe') ??
        observed.find((o) => o.method === 'descriptor-table') ??
        observed[0];

      // STALE DECLARATION — the declaration contradicts observed reality.
      if (primary && values.size === 1 && primary.supported !== declaration.supported) {
        findings.push(
          finding({
            kind: 'stale_declaration',
            provider: profile.provider,
            capability,
            declared: declaration.supported,
            observed: primary.supported,
            evidenceSource: `${primary.method} ${primary.source}`,
            remedy:
              `set supported: ${primary.supported} for '${profile.provider}'.'${capability}' in ` +
              `${REGISTRY_FILE} (and refresh its evidence string), or restore the implementation ` +
              `so the declaration becomes true again.`,
          }),
        );
      }

      // UNSUPPORTED DECLARATION (b) — strict mode only.
      if (observed.length === 0 && model.requireEvidenceSource === true) {
        findings.push(
          finding({
            kind: 'unsupported_declaration',
            provider: profile.provider,
            capability,
            declared: declaration.supported,
            observed: 'none',
            evidenceSource: 'no machine-readable evidence source is wired for this capability',
            remedy:
              `wire a machine-readable evidence source for '${capability}' (descriptor table, ` +
              `behavioral probe, or metadata registry) or withdraw the declaration from ${REGISTRY_FILE}.`,
          }),
        );
      }

      // STALE EVIDENCE REFERENCE — the citation itself has rotted.
      let anchorStatus: DeclarationCheck['evidenceAnchors'] = 'not-checked';
      if (model.evidenceAnchors) {
        const anchors = extractEvidenceAnchors(declaration.evidence);
        const dangling = anchors.filter((a) => !model.evidenceAnchors!.resolves(a));
        anchorStatus = dangling.length === 0 ? 'anchored' : 'unanchored';
        if (dangling.length > 0) {
          findings.push(
            finding({
              kind: 'stale_evidence_reference',
              provider: profile.provider,
              capability,
              declared: declaration.supported,
              observed: 'none',
              evidenceSource: `${model.evidenceAnchors.describe}; dangling citation(s): ${dangling.join(', ')}`,
              remedy:
                `the evidence for '${profile.provider}'.'${capability}' cites ${dangling.join(', ')}, ` +
                `which no longer exists in-tree — re-establish the claim against current code and ` +
                `rewrite the evidence string in ${REGISTRY_FILE}.`,
            }),
          );
        }
      }

      checks.push(
        primary
          ? {
              provider: profile.provider,
              capability,
              declared: declaration.supported,
              status: 'machine-verified',
              evidenceSource: primary.source,
              method: primary.method,
              observed: primary.supported,
              reason: null,
              evidenceAnchors: anchorStatus,
            }
          : {
              provider: profile.provider,
              capability,
              declared: declaration.supported,
              status: 'unverifiable',
              evidenceSource: null,
              method: null,
              observed: null,
              reason: unverifiableReason(capability, model),
              evidenceAnchors: anchorStatus,
            },
      );
    }
  }

  const machineVerified = checks.filter((c) => c.status === 'machine-verified').length;
  const coverage: DriftCoverage = {
    declarations: checks.length,
    machineVerified,
    unverifiable: checks.length - machineVerified,
    ratio: checks.length === 0 ? 0 : machineVerified / checks.length,
  };

  return {
    ok: findings.length === 0,
    findings,
    checks,
    coverage,
    formatted: formatDriftReport(findings, coverage),
  };
}

function unverifiableReason(capability: string, model: CapabilityEvidenceModel): string {
  return model.knownCapabilities.includes(capability)
    ? `no machine-readable evidence source exists for '${capability}' — no canonical descriptor ` +
        `table field, no registered metadata descriptor and no behavioral probe observes it; the ` +
        `PB-004 declaration rests on a structural reading of the implementation.`
    : `'${capability}' is not in the Platform capability vocabulary, so no evidence source can exist.`;
}

/** Human-readable diagnostic block: every finding, then the coverage ledger. */
export function formatDriftReport(
  findings: readonly DriftFinding[],
  coverage: DriftCoverage,
): string {
  if (findings.length === 0) return '';
  const lines = findings.map((f) => `  - ${f.message}`);
  return (
    `provider capability registry drift — ${findings.length} finding(s):\n${lines.join('\n')}\n` +
    `  coverage: ${coverage.machineVerified}/${coverage.declarations} declarations machine-verified ` +
    `(${(coverage.ratio * 100).toFixed(1)}%).`
  );
}

/** Every declaration that could not be machine-verified, for honest reporting. */
export function unverifiableDeclarations(report: DriftReport): readonly DeclarationCheck[] {
  return report.checks.filter((c) => c.status === 'unverifiable');
}
