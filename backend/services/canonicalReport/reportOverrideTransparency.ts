/**
 * Report Override Transparency  (BETA-REPORT-EXEC-009 — BR-H-005)
 *
 * Deterministic executive disclosure of any MATERIAL analyst / governance / policy override that changed the
 * customer-visible report. It REUSES the report's own `active_overrides` list + `governance` policy — it adds
 * NO new override mechanism and duplicates NO metadata. It only surfaces, in executive language, the fact and
 * shape of an override so nothing silently modifies a report. Non-material overrides (e.g. analyst notes) are
 * intentionally NOT disclosed. When no material override exists, the disclosure is empty (display nothing).
 * NO engine/scoring/governance redesign; NO fabricated disclosures.
 */
import type { CanonicalReport } from './canonicalReportTypes';

type ActiveOverride = CanonicalReport['active_overrides'][number];
type Governance = Pick<CanonicalReport['governance'], 'excluded_providers'>;

export interface OverrideDisclosure {
  /** Executive-language label — never internal terminology. */
  override_type: string;
  origin: 'Analyst review' | 'Governance policy';
  /** The analyst/policy-supplied reason (already human-readable). */
  reason: string;
  /** Executive descriptor of what changed — never raw internal targets. */
  affected: string;
  evidence_changed: boolean;
  score_changed: boolean;
  recommendation_changed: boolean;
  presentation_only: boolean;
}

export interface OverrideTransparency {
  material_override_count: number;
  disclosures: OverrideDisclosure[];
  /** Executive summary; empty string when there is nothing material to disclose. */
  note: string;
}

/** Override kinds that MATERIALLY change customer-visible output (analyst_note is non-material → omitted). */
const MATERIAL_KINDS = new Set([
  'evidence_suppression',
  'recommendation_dismissal',
  'provider_exclusion',
  'benchmark_band',
  'vertical_classification',
  'company_size_band',
]);

function disclosureFor(o: ActiveOverride): OverrideDisclosure | null {
  const reason = o.reason || 'No reason recorded.';
  const analystOrigin: OverrideDisclosure['origin'] =
    o.created_by?.kind === 'governance' || o.created_by?.kind === 'system' ? 'Governance policy' : 'Analyst review';
  switch (o.kind) {
    case 'evidence_suppression':
      return { override_type: 'Manual analyst review applied', origin: 'Analyst review', reason,
        affected: 'A scoring dimension’s evidence was suppressed (shown as unavailable).',
        evidence_changed: true, score_changed: true, recommendation_changed: false, presentation_only: false };
    case 'recommendation_dismissal':
      return { override_type: 'Manual analyst review applied', origin: 'Analyst review', reason,
        affected: 'A recommendation was removed from the playbook.',
        evidence_changed: false, score_changed: false, recommendation_changed: true, presentation_only: false };
    case 'provider_exclusion':
      return { override_type: 'Governance rule applied', origin: 'Governance policy', reason,
        affected: 'A data source was excluded, so some evidence is unavailable.',
        evidence_changed: true, score_changed: true, recommendation_changed: false, presentation_only: false };
    case 'benchmark_band':
    case 'vertical_classification':
    case 'company_size_band':
      return { override_type: 'Analyst classification applied', origin: analystOrigin, reason,
        affected: 'The peer / benchmark classification was adjusted (comparison only, not the underlying score).',
        evidence_changed: false, score_changed: false, recommendation_changed: false, presentation_only: true };
    default:
      return null; // non-material (e.g. analyst_note) — not disclosed
  }
}

/**
 * Build the executive override disclosure from the report's own overrides + governance. Deterministic; empty
 * when nothing material was applied. Never fabricates a disclosure.
 */
export function resolveOverrideTransparency(
  activeOverrides: readonly ActiveOverride[],
  governance: Governance,
): OverrideTransparency {
  const fromOverrides = activeOverrides
    .filter((o) => MATERIAL_KINDS.has(o.kind))
    .map(disclosureFor)
    .filter((d): d is OverrideDisclosure => d !== null);

  // Governance-driven provider exclusions suppress evidence silently — disclose them explicitly (unless an
  // explicit provider_exclusion override already covers it).
  const excluded = governance.excluded_providers ?? [];
  const hasProviderExclusionOverride = activeOverrides.some((o) => o.kind === 'provider_exclusion');
  const governanceDisclosures: OverrideDisclosure[] =
    excluded.length > 0 && !hasProviderExclusionOverride
      ? [{
          override_type: 'Governance rule applied', origin: 'Governance policy',
          reason: `${excluded.length} data source(s) excluded by tenant policy.`,
          affected: 'Some evidence is unavailable because a data source is excluded for this tenant.',
          evidence_changed: true, score_changed: true, recommendation_changed: false, presentation_only: false,
        }]
      : [];

  const disclosures = [...fromOverrides, ...governanceDisclosures].sort((a, b) =>
    a.override_type < b.override_type ? -1 : a.override_type > b.override_type ? 1 : (a.affected < b.affected ? -1 : 1),
  );

  return {
    material_override_count: disclosures.length,
    disclosures,
    note: disclosures.length === 0
      ? ''
      : `This report reflects ${disclosures.length} analyst/governance adjustment${disclosures.length === 1 ? '' : 's'}; see the disclosures for exactly what changed.`,
  };
}
