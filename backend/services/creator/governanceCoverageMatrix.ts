/**
 * Governance Coverage Matrix (Closure Pass — Phase 6 + Phase 7).
 *
 * Single source of truth describing which governance signals reach
 * each Creator content type. Used by:
 *   - the closure-pass governance verification test
 *   - a future super-admin diagnostic surface
 *   - documentation generation (the matrix can be flattened to text
 *     without re-tracing the code paths)
 *
 * STRICT scope:
 *   - PURE constants. No runtime behavior. No mutations.
 *   - Reflects the CURRENT state of the codebase. Updates are manual
 *     when new content types are added.
 *   - Each row's `evidence` field cites the code site (file + line)
 *     that wires the signal. Tests assert these citations match what
 *     the code actually does.
 */

export type GovernanceSignal =
  | 'recommendation'         // company-context recommendation engine reorders strategies
  | 'picker'                 // operator-facing picker hides restricted by default
  | 'audit'                  // restricted-strategy selection fires an audit event
  | 'prompt'                 // user-prompt-level directive injection
  | 'system_prompt'          // system-prompt-level preamble injection
  | 'metadata'               // governance metadata mirrored to asset metadata
  | 'explainability';        // structured explainability envelope on the response

export type GovernanceCoverageRow = {
  contentType: string;
  /** Per-signal coverage flag. */
  covered: Record<GovernanceSignal, boolean>;
  /** Per-signal evidence string (file:line or summary). */
  evidence: Partial<Record<GovernanceSignal, string>>;
};

/**
 * Coverage matrix. Each row reflects the wiring state established
 * across the prior governance passes plus the Final Closure Pass.
 */
export const GOVERNANCE_COVERAGE_MATRIX: ReadonlyArray<GovernanceCoverageRow> = [
  {
    contentType: 'image',
    covered: {
      recommendation: true, picker: true, audit: true, prompt: true,
      system_prompt: true, metadata: true, explainability: true,
    },
    evidence: {
      recommendation: 'companyStrategyRecommendationEngine.ts (lane=image)',
      picker: 'CreatorAssetBlockEditor.tsx + applier.ts',
      audit: 'restricted-strategy-audit.ts (picker) + resolveGovernanceForLane (generate.ts)',
      prompt: 'creatorPromptComposer.ts layers.governance',
      system_prompt: 'image renderer single-prompt model (no system/user split)',
      metadata: 'media_bundle.metadata.governance (creatorAssetRenderer.ts)',
      explainability: 'CreatorComposedPrompt.governance',
    },
  },
  {
    contentType: 'carousel',
    covered: {
      recommendation: true, picker: true, audit: true, prompt: true,
      system_prompt: true, metadata: true, explainability: true,
    },
    evidence: {
      recommendation: 'companyStrategyRecommendationEngine.ts (lane=carousel)',
      picker: 'CreatorAssetBlockEditor.tsx + applier.ts',
      audit: 'restricted-strategy-audit.ts (picker) + resolveGovernanceForLane (generate.ts)',
      prompt: 'creatorPromptComposer.ts layers.governance',
      system_prompt: 'carousel single-prompt model',
      metadata: 'media_bundle.metadata.governance',
      explainability: 'CreatorComposedPrompt.governance',
    },
  },
  {
    contentType: 'infographic',
    covered: {
      recommendation: true, picker: true, audit: true, prompt: true,
      system_prompt: true, metadata: true, explainability: true,
    },
    evidence: {
      recommendation: 'companyStrategyRecommendationEngine.ts (lane=infographic)',
      picker: 'CreatorAssetBlockEditor.tsx + applier.ts',
      audit: 'restricted-strategy-audit.ts (picker) + resolveGovernanceForLane (generate.ts)',
      prompt: 'creatorPromptComposer.ts layers.governance',
      system_prompt: 'infographic single-prompt model',
      metadata: 'media_bundle.metadata.governance',
      explainability: 'CreatorComposedPrompt.governance',
    },
  },
  {
    contentType: 'post',
    covered: {
      recommendation: false, picker: false, audit: true, prompt: true,
      system_prompt: true, metadata: true, explainability: true,
    },
    evidence: {
      recommendation: 'N/A — posts do not surface the purpose picker',
      picker: 'N/A — posts do not surface the purpose picker',
      audit: 'resolveGovernanceForLane fires audit (generate.ts)',
      prompt: 'textGenerationOrchestrator.extra_instruction prepend',
      system_prompt: 'blueprintGenerator + platformVariantGenerator applyGovernancePreambleToSystemPrompt',
      metadata: 'media_bundle.metadata.governance (generate.ts text branch)',
      explainability: 'TextGenerationResult.governance',
    },
  },
  {
    contentType: 'thread',
    covered: {
      recommendation: false, picker: false, audit: true, prompt: true,
      system_prompt: true, metadata: true, explainability: true,
    },
    evidence: {
      recommendation: 'N/A — threads do not surface the purpose picker',
      picker: 'N/A — threads do not surface the purpose picker',
      audit: 'resolveGovernanceForLane fires audit (Direct API) + runThreadGeneration governance build',
      prompt: 'textGenerationOrchestrator.extra_instruction prepend',
      system_prompt: 'blueprintGenerator system prompt + runThreadGeneration threads governance',
      metadata: 'media_bundle.metadata.governance (generate.ts text branch)',
      explainability: 'TextGenerationResult.governance',
    },
  },
  {
    contentType: 'theme_treatment',
    covered: {
      recommendation: false, picker: false, audit: true, prompt: true,
      system_prompt: true, metadata: true, explainability: true,
    },
    evidence: {
      recommendation: 'N/A — guidance-only formats do not surface the purpose picker',
      picker: 'N/A — guidance-only formats do not surface the purpose picker',
      audit: 'resolveGovernanceForLane fires audit (generate.ts)',
      prompt: 'creatorThemeTreatmentService user prompt prepend',
      system_prompt: 'creatorThemeTreatmentService systemPrompt preamble prepend',
      metadata: 'asset_payload.media_bundle.metadata.governance',
      explainability: 'CreatorThemeTreatmentOutput.governance',
    },
  },
  {
    contentType: 'video',
    covered: {
      recommendation: false, picker: false, audit: true, prompt: true,
      system_prompt: true, metadata: true, explainability: true,
    },
    evidence: {
      recommendation: 'N/A — guidance-only',
      picker: 'N/A — guidance-only',
      audit: 'resolveGovernanceForLane fires audit (generate.ts)',
      prompt: 'creatorThemeTreatmentService user prompt prepend (theme treatment routes video)',
      system_prompt: 'creatorThemeTreatmentService systemPrompt preamble prepend',
      metadata: 'asset_payload.media_bundle.metadata.governance',
      explainability: 'CreatorThemeTreatmentOutput.governance',
    },
  },
  {
    contentType: 'reel',
    covered: {
      recommendation: false, picker: false, audit: true, prompt: true,
      system_prompt: true, metadata: true, explainability: true,
    },
    evidence: {
      recommendation: 'N/A — guidance-only',
      picker: 'N/A — guidance-only',
      audit: 'resolveGovernanceForLane fires audit (generate.ts)',
      prompt: 'creatorThemeTreatmentService user prompt prepend',
      system_prompt: 'creatorThemeTreatmentService systemPrompt preamble prepend',
      metadata: 'asset_payload.media_bundle.metadata.governance',
      explainability: 'CreatorThemeTreatmentOutput.governance',
    },
  },
  {
    contentType: 'short',
    covered: {
      recommendation: false, picker: false, audit: true, prompt: true,
      system_prompt: true, metadata: true, explainability: true,
    },
    evidence: {
      recommendation: 'N/A — guidance-only',
      picker: 'N/A — guidance-only',
      audit: 'resolveGovernanceForLane fires audit (generate.ts)',
      prompt: 'creatorThemeTreatmentService user prompt prepend',
      system_prompt: 'creatorThemeTreatmentService systemPrompt preamble prepend',
      metadata: 'asset_payload.media_bundle.metadata.governance',
      explainability: 'CreatorThemeTreatmentOutput.governance',
    },
  },
  {
    contentType: 'podcast',
    covered: {
      recommendation: false, picker: false, audit: true, prompt: true,
      system_prompt: true, metadata: true, explainability: true,
    },
    evidence: {
      recommendation: 'N/A — guidance-only',
      picker: 'N/A — guidance-only',
      audit: 'resolveGovernanceForLane fires audit (generate.ts)',
      prompt: 'creatorThemeTreatmentService user prompt prepend',
      system_prompt: 'creatorThemeTreatmentService systemPrompt preamble prepend',
      metadata: 'asset_payload.media_bundle.metadata.governance',
      explainability: 'CreatorThemeTreatmentOutput.governance',
    },
  },
  {
    contentType: 'blog',
    covered: {
      recommendation: false, picker: false, audit: true, prompt: true,
      system_prompt: true, metadata: true, explainability: true,
    },
    evidence: {
      recommendation: 'N/A — long-form does not surface the purpose picker',
      picker: 'N/A — long-form does not surface the purpose picker',
      audit: 'runBlogGeneration governance resolver fires maybeAuditRestrictedStrategySelection',
      prompt: 'blogGenerationEngine builders prepend preamble + each runner wraps inline system prompts',
      system_prompt: 'buildAnglesSystemPrompt + buildGenerationSystemPrompt + per-runner govPreamble wrappers',
      metadata: 'attachBlogGovernanceMetadata wraps response',
      explainability: 'BlogGenerationResult.governance',
    },
  },
  {
    contentType: 'article',
    covered: {
      recommendation: false, picker: false, audit: true, prompt: true,
      system_prompt: true, metadata: true, explainability: true,
    },
    evidence: {
      recommendation: 'N/A — long-form does not surface the purpose picker',
      picker: 'N/A — long-form does not surface the purpose picker',
      audit: 'runBlogGeneration governance resolver fires maybeAuditRestrictedStrategySelection',
      prompt: 'blogGenerationEngine builders prepend preamble',
      system_prompt: 'buildAnglesSystemPrompt + buildGenerationSystemPrompt receive governance',
      metadata: 'attachBlogGovernanceMetadata wraps response',
      explainability: 'BlogGenerationResult.governance',
    },
  },
  {
    contentType: 'newsletter',
    covered: {
      recommendation: false, picker: false, audit: true, prompt: true,
      system_prompt: true, metadata: true, explainability: true,
    },
    evidence: {
      recommendation: 'N/A — long-form does not surface the purpose picker',
      picker: 'N/A — long-form does not surface the purpose picker',
      audit: 'runBlogGeneration governance resolver fires maybeAuditRestrictedStrategySelection',
      prompt: 'blogGenerationEngine builders prepend preamble',
      system_prompt: 'buildAnglesSystemPrompt + buildGenerationSystemPrompt receive governance',
      metadata: 'attachBlogGovernanceMetadata wraps response',
      explainability: 'BlogGenerationResult.governance',
    },
  },
];

/**
 * Returns the row for a given content type, or null when the type is
 * not in the matrix. Useful for diagnostics surfaces.
 */
export function getCoverageRow(contentType: string): GovernanceCoverageRow | null {
  const normalized = String(contentType ?? '').toLowerCase().trim();
  return GOVERNANCE_COVERAGE_MATRIX.find((r) => r.contentType === normalized) ?? null;
}

/**
 * Verifies that the matrix is structurally consistent: every row has
 * a flag + evidence string for every signal. Used by the closure-pass
 * test to assert no signal slot is silently empty.
 */
export function validateCoverageMatrix(): { ok: boolean; issues: string[] } {
  const issues: string[] = [];
  const signals: GovernanceSignal[] = [
    'recommendation', 'picker', 'audit', 'prompt',
    'system_prompt', 'metadata', 'explainability',
  ];
  for (const row of GOVERNANCE_COVERAGE_MATRIX) {
    for (const s of signals) {
      if (typeof row.covered[s] !== 'boolean') {
        issues.push(`${row.contentType}: missing flag for ${s}`);
      }
      if (!row.evidence[s] || row.evidence[s]!.length === 0) {
        issues.push(`${row.contentType}: missing evidence for ${s}`);
      }
    }
  }
  return { ok: issues.length === 0, issues };
}

/* ── Creator Validation P2 Hardening — Phase 3 ──────────────────── */
/**
 * Flow-level governance coverage. Captures the five execution flows
 * the user invocation path takes (generation, regeneration, adaptation,
 * campaign fan-out, replay) and records, per flow, which canonical
 * governance signals are attached. Used to lock the consistency
 * contract — a test asserts every row carries the documented fields,
 * preventing silent drift in any of the five paths.
 *
 * STRICT scope:
 *   - PURE constants. No runtime behavior change.
 *   - Each row's `policy_resolution` field documents WHERE the policy
 *     is resolved from (fresh vs persisted snapshot vs upstream).
 *     "snapshot" rows are NOT a defect; they are the by-design
 *     trade-off (replay re-runs a previously approved decision).
 */

export type GovernanceFlowSignal =
  | 'resolves_policy'         // flow calls a policy resolver
  | 'attaches_metadata'       // flow writes governance fields to its output envelope
  | 'fires_audit'             // flow fires strategy_governance audit events when applicable
  | 'preserves_upstream';     // flow forwards governance metadata it received

export type GovernanceFlowCoverageRow = {
  flow:
    | 'generation'
    | 'regeneration'
    | 'adaptation'
    | 'campaign_fan_out'
    | 'replay';
  covered: Record<GovernanceFlowSignal, boolean>;
  /** Where the policy is resolved from for this flow. */
  policy_resolution:
    | 'fresh-from-profile'
    | 'caller-supplied'
    | 'persisted-snapshot'
    | 'upstream-passthrough';
  /** Where governance metadata lands on the flow's output. */
  metadata_target: string;
  /** Where the audit event (if any) is fired. */
  audit_site: string;
  /** Reasoning notes for the "snapshot" / "passthrough" classification
   *  so future maintainers understand the by-design vs accidental
   *  distinction. */
  notes: string;
};

export const GOVERNANCE_FLOW_COVERAGE_MATRIX: ReadonlyArray<GovernanceFlowCoverageRow> = [
  {
    flow: 'generation',
    covered: {
      resolves_policy: true,
      attaches_metadata: true,
      fires_audit: true,
      preserves_upstream: false,
    },
    policy_resolution: 'fresh-from-profile',
    metadata_target: 'media_bundle.metadata.governance',
    audit_site: 'resolveGovernanceForLane (generate.ts) + enrichItemWithGovernance fan-in',
    notes: 'Fresh resolution at request time; canonical attachment.',
  },
  {
    flow: 'regeneration',
    covered: {
      resolves_policy: true,
      attaches_metadata: true,
      fires_audit: true,
      preserves_upstream: true,
    },
    policy_resolution: 'caller-supplied',
    metadata_target: 'BlogGenerationResult.governance (attachBlogGovernanceMetadata)',
    audit_site: 'runBlogGeneration governance resolver — picker-mediated audits fire upstream; executor honors caller-supplied context without double-firing.',
    notes: 'When the caller pre-resolves governance (picker path), executor trusts it; otherwise resolves fresh from profile. Double-firing audit is explicitly avoided.',
  },
  {
    flow: 'adaptation',
    covered: {
      resolves_policy: false,
      attaches_metadata: false,
      fires_audit: false,
      preserves_upstream: true,
    },
    policy_resolution: 'upstream-passthrough',
    metadata_target: 'media_bundle.metadata (preserved verbatim from source asset)',
    audit_site: 'N/A — adaptation does not re-select a strategy.',
    notes: 'directApiAdaptationRunner is governance-neutral by design. The source asset already carries the full governance envelope from its generation; adaptation forwards it without mutation.',
  },
  {
    flow: 'campaign_fan_out',
    covered: {
      resolves_policy: true,
      attaches_metadata: true,
      fires_audit: true,
      preserves_upstream: false,
    },
    policy_resolution: 'fresh-from-profile',
    metadata_target: 'media_bundle.metadata.governance + media_bundle.metadata.applied_variant',
    audit_site: 'enrichItemWithGovernance + maybeAuditRestrictedStrategySelection at orchestrator entry',
    notes: 'Each variant rendered by the orchestrator goes through governance + QA + moderation. Variant envelope (applied_variant) and governance envelope are independent attachments.',
  },
  {
    flow: 'replay',
    covered: {
      resolves_policy: false,
      attaches_metadata: true,
      fires_audit: false,
      preserves_upstream: true,
    },
    policy_resolution: 'persisted-snapshot',
    metadata_target: 'creator_assets.metadata.governance (carried from initial generation)',
    audit_site: 'N/A — replay re-runs a previously approved decision; the audit fired at the original selection time.',
    notes: 'By design: replay does NOT re-resolve governance from the current profile. The original decision-time policy is what was approved; refreshing it on replay would create a different decision than the operator approved. If a company industry changes, operators are expected to regenerate, not replay.',
  },
];

/**
 * Returns the flow row by name, or null when unknown. Used in the
 * super-admin diagnostic surface to render the consistency contract.
 */
export function getFlowCoverageRow(flow: string): GovernanceFlowCoverageRow | null {
  const normalized = String(flow ?? '').toLowerCase().trim();
  return GOVERNANCE_FLOW_COVERAGE_MATRIX.find((r) => r.flow === normalized) ?? null;
}

/**
 * Validates the flow matrix is structurally consistent: every row has
 * boolean flags + non-empty fields. Mirrors `validateCoverageMatrix`.
 */
export function validateFlowCoverageMatrix(): { ok: boolean; issues: string[] } {
  const issues: string[] = [];
  const signals: GovernanceFlowSignal[] = [
    'resolves_policy', 'attaches_metadata', 'fires_audit', 'preserves_upstream',
  ];
  for (const row of GOVERNANCE_FLOW_COVERAGE_MATRIX) {
    for (const s of signals) {
      if (typeof row.covered[s] !== 'boolean') {
        issues.push(`${row.flow}: missing flag for ${s}`);
      }
    }
    if (!row.policy_resolution) issues.push(`${row.flow}: missing policy_resolution`);
    if (!row.metadata_target) issues.push(`${row.flow}: missing metadata_target`);
    if (!row.audit_site) issues.push(`${row.flow}: missing audit_site`);
    if (!row.notes) issues.push(`${row.flow}: missing notes`);
  }
  return { ok: issues.length === 0, issues };
}

/**
 * Flattens the matrix to a human-readable table. Used in the
 * mandatory closure-pass report.
 */
export function renderCoverageMatrixTable(): string {
  const signals: GovernanceSignal[] = [
    'recommendation', 'picker', 'audit', 'prompt',
    'system_prompt', 'metadata', 'explainability',
  ];
  const header = `| Content Type | ${signals.join(' | ')} |`;
  const sep = `|---|${signals.map(() => '---').join('|')}|`;
  const rows = GOVERNANCE_COVERAGE_MATRIX.map((row) => {
    const cells = signals.map((s) => (row.covered[s] ? '✓' : '✗'));
    return `| ${row.contentType} | ${cells.join(' | ')} |`;
  });
  return [header, sep, ...rows].join('\n');
}
