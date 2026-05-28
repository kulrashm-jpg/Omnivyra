/**
 * identityConsistencyValidator.ts
 *
 * Phase 2.5 + 2.6 — Canonical CompanyIdentity contract.
 *
 * Before this module there were TWO incompatible identity construction
 * sites:
 *   1. `extractCompanyIdentity(profile)` in companyContextBlock.ts —
 *      reads the raw profile, includes entityArchetype, competitorIntelligence,
 *      userGuidance. Used by short-form (blueprintGenerator, platformVariantGenerator).
 *   2. An inline object literal at `runBlogGeneration.ts:710-724` —
 *      reads CompanyContext (already lossy), missed entityArchetype,
 *      competitorIntelligence, userGuidance. Used by long-form.
 *
 * Symptom: archetype/competitor cues showed up in social posts but were
 * absent from blog identity locks. This module fixes that by:
 *
 *   - `buildCanonicalCompanyIdentity({ profile, fallbackContext })` —
 *     the ONE function callers should use. Prefers a real CompanyProfile;
 *     falls back to CompanyContext when no profile is available.
 *   - `validateIdentityConsistency(identity, options)` — runs structured
 *     checks for field drift, partial construction, and shape divergence.
 *     Emits a LONGFORM_IDENTITY_CONSISTENCY_WARNING event when divergence
 *     is detected.
 */

import type { CompanyProfile } from '../../backend/services/companyProfile/types';
import type { CompanyContext } from '../blog/blogRunnerTypes';
import {
  extractCompanyIdentity,
  type CompanyIdentity,
} from './companyContextBlock';
import { emitIdentityConsistencyWarning } from './longFormEngineTelemetry';

// ── Bridge: CompanyContext → CompanyIdentity ─────────────────────────────────
//
// Some legacy callers still pass only a CompanyContext (no typed profile).
// We re-hydrate as much of CompanyIdentity as CompanyContext exposes, but
// callers will see a warning that entityArchetype/competitorIntelligence/
// userGuidance fields are unavailable on this path.

function buildIdentityFromContext(ctx: CompanyContext): CompanyIdentity {
  return {
    companyName: ctx.companyName,
    industry: ctx.industry,
    targetAudience: ctx.audience,
    idealCustomerProfile: ctx.idealCustomerProfile,
    coreProblem: ctx.coreProblemStatement,
    painPoints: ctx.painSymptoms,
    uniqueValue: ctx.uniqueValue,
    productsServices: ctx.productsServices,
    desiredTransformation: ctx.desiredTransformation,
    competitiveAdvantages: ctx.competitiveAdvantages,
    authorityDomains: ctx.authorityDomains,
    keyMessages: ctx.keyMessages,
    brandVoice: ctx.brand_voice,
    strategyProfile: ctx.strategyProfile,
    // Phase 2.4 surface added these to CompanyContext; pass through.
    entityArchetype: ctx.reportSettings?.entity_archetype ?? null,
    competitorIntelligence: ctx.reportSettings?.competitor_intelligence ?? null,
    userGuidance: ctx.reportSettings?.user_guidance ?? null,
  };
}

/**
 * Canonical CompanyIdentity construction. ALL generation paths should
 * route through this function. Prefer `profile` (full DB shape) over
 * `fallbackContext` (lossy projection).
 */
export function buildCanonicalCompanyIdentity(input: {
  profile?: CompanyProfile | null;
  fallbackContext?: CompanyContext;
}): CompanyIdentity | undefined {
  if (input.profile) {
    return extractCompanyIdentity(input.profile);
  }
  if (input.fallbackContext) {
    return buildIdentityFromContext(input.fallbackContext);
  }
  return undefined;
}

// ── Phase 2.6 — Identity consistency validator ───────────────────────────────

export interface IdentityConsistencyReport {
  isConsistent: boolean;
  warnings: string[];
  missingStrategicFields: string[];
  /** Subset of fields that the audit identified as alignment-critical. */
  criticalMissing: string[];
  /** True if identity was reconstructed from CompanyContext (lossy path). */
  builtFromFallback: boolean;
}

const STRATEGIC_REQUIRED: Array<keyof CompanyIdentity> = [
  'companyName',
  'industry',
  'targetAudience',
  'idealCustomerProfile',
  'coreProblem',
  'painPoints',
  'uniqueValue',
  'desiredTransformation',
  'competitiveAdvantages',
  'authorityDomains',
];

const CRITICAL = new Set<keyof CompanyIdentity>([
  'companyName',
  'idealCustomerProfile',
  'coreProblem',
  'uniqueValue',
  'painPoints',
]);

function isEmpty(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === 'string') return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value as object).length === 0;
  return false;
}

export interface ValidateIdentityConsistencyOptions {
  /** Source label for telemetry (e.g. 'runBlogGeneration', 'blueprintGenerator'). */
  source: string;
  /** True when identity was built via the fallback (CompanyContext-only) path. */
  builtFromFallback?: boolean;
  /** Whether to throw on critical missing fields. Default: false (warn-only). */
  throwOnCritical?: boolean;
  /** Suppress telemetry emission (used internally by tests). */
  silent?: boolean;
}

/**
 * Phase 2.6 — Validate that a CompanyIdentity matches the canonical shape.
 *
 * Catches:
 *   - field drift (strategic fields missing)
 *   - partial identity construction (built from CompanyContext fallback)
 *   - incompatible shapes (no companyName, no industry, etc.)
 *
 * Emits LONGFORM_IDENTITY_CONSISTENCY_WARNING when divergence is detected.
 */
export function validateIdentityConsistency(
  identity: CompanyIdentity | undefined | null,
  options: ValidateIdentityConsistencyOptions,
): IdentityConsistencyReport {
  const builtFromFallback = Boolean(options.builtFromFallback);
  const warnings: string[] = [];
  const missing: string[] = [];
  const criticalMissing: string[] = [];

  if (!identity) {
    const report: IdentityConsistencyReport = {
      isConsistent: false,
      warnings: ['identity is null/undefined — generation will use generic defaults'],
      missingStrategicFields: STRATEGIC_REQUIRED.map((f) => String(f)),
      criticalMissing: STRATEGIC_REQUIRED.filter((f) => CRITICAL.has(f)).map((f) => String(f)),
      builtFromFallback,
    };
    if (!options.silent) {
      emitIdentityConsistencyWarning({
        source: options.source,
        ...report,
      });
    }
    if (options.throwOnCritical) {
      throw new Error(`Identity consistency failed at ${options.source}: identity is null`);
    }
    return report;
  }

  if (builtFromFallback) {
    warnings.push(
      'identity built from CompanyContext fallback — entityArchetype, competitorIntelligence, ' +
      'and userGuidance may be partially populated. Pass a typed CompanyProfile instead.',
    );
  }

  for (const field of STRATEGIC_REQUIRED) {
    if (isEmpty(identity[field])) {
      missing.push(String(field));
      if (CRITICAL.has(field)) criticalMissing.push(String(field));
    }
  }

  if (missing.length > 0) {
    warnings.push(`${missing.length} strategic field(s) missing: ${missing.join(', ')}`);
  }

  const report: IdentityConsistencyReport = {
    isConsistent: criticalMissing.length === 0 && !builtFromFallback,
    warnings,
    missingStrategicFields: missing,
    criticalMissing,
    builtFromFallback,
  };

  if (!options.silent && (warnings.length > 0 || criticalMissing.length > 0)) {
    emitIdentityConsistencyWarning({
      source: options.source,
      isConsistent: report.isConsistent,
      builtFromFallback: report.builtFromFallback,
      missing_strategic_fields: report.missingStrategicFields,
      critical_missing: report.criticalMissing,
      warnings: report.warnings,
    });
  }

  if (options.throwOnCritical && criticalMissing.length > 0) {
    throw new Error(
      `Identity consistency failed at ${options.source}: critical missing fields [${criticalMissing.join(', ')}]`,
    );
  }

  return report;
}
