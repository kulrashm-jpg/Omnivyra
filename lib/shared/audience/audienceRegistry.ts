/**
 * Canonical audience authority (single source of truth).
 *
 * Replaces the 11 byte-identical duplicate `AUDIENCE_OPTIONS` /
 * `TARGET_AUDIENCE_OPTIONS` arrays that lived across Intelligent Mix, BOLT
 * Text/Creator/Combined, the planner Strategy tab / Context bar, and the
 * `planPreviewService` validator.
 *
 * Behavior-preservation contract:
 *   - CORE_AUDIENCES is the legacy 7-item list, EXACT strings + order. Every
 *     existing selector renders `CORE_AUDIENCE_LABELS`, so their displayed
 *     options are unchanged.
 *   - PROFESSIONAL_AUDIENCES + INDUSTRY_AUDIENCES are NEW categories. They are
 *     available globally (in this authority, accepted by validation) but are
 *     `defaultVisible: false`, so they are NOT auto-injected into the existing
 *     selectors. A surface opts in via `getSelectableAudienceLabels({...})`.
 *   - add / remove / hide / custom support is UI/config-layer only — NO DB.
 *
 * NOTE: lib/audienceCategories.ts (the hierarchical life-stage taxonomy used
 * only by Trend Campaigns) is a distinct model and is intentionally left as-is;
 * folding it in is a separate, higher-risk migration.
 */

export type AudienceGroup = 'core' | 'professional' | 'industry';

export interface AudienceOption {
  label: string;
  group: AudienceGroup;
  /** Shown by default in the standard selectors. Only CORE is visible by
   *  default — this preserves every existing selector's displayed list. */
  defaultVisible: boolean;
}

/** Legacy 7 — exact strings + order. Do NOT reorder or rename (display contract). */
export const CORE_AUDIENCES: AudienceOption[] = [
  { label: 'B2B Marketers', group: 'core', defaultVisible: true },
  { label: 'Founders / Entrepreneurs', group: 'core', defaultVisible: true },
  { label: 'Marketing Leaders', group: 'core', defaultVisible: true },
  { label: 'Sales Teams', group: 'core', defaultVisible: true },
  { label: 'Product Managers', group: 'core', defaultVisible: true },
  { label: 'Developers', group: 'core', defaultVisible: true },
  { label: 'General Consumers', group: 'core', defaultVisible: true },
];

/** Department / role-function audiences (new — opt-in). */
export const PROFESSIONAL_AUDIENCES: AudienceOption[] = [
  { label: 'Procurement', group: 'professional', defaultVisible: false },
  { label: 'Supply Chain', group: 'professional', defaultVisible: false },
  { label: 'Operations', group: 'professional', defaultVisible: false },
  { label: 'Human Resources', group: 'professional', defaultVisible: false },
  { label: 'Legal', group: 'professional', defaultVisible: false },
  { label: 'Marketing', group: 'professional', defaultVisible: false },
  { label: 'Sales', group: 'professional', defaultVisible: false },
  { label: 'Customer Success', group: 'professional', defaultVisible: false },
  { label: 'Product', group: 'professional', defaultVisible: false },
  { label: 'Engineering', group: 'professional', defaultVisible: false },
  { label: 'Executive Leadership', group: 'professional', defaultVisible: false },
];

/** Industry / vertical audiences (new — opt-in). */
export const INDUSTRY_AUDIENCES: AudienceOption[] = [
  { label: 'Finance', group: 'industry', defaultVisible: false },
  { label: 'Manufacturing', group: 'industry', defaultVisible: false },
  { label: 'Retail', group: 'industry', defaultVisible: false },
  { label: 'Healthcare', group: 'industry', defaultVisible: false },
  { label: 'Technology', group: 'industry', defaultVisible: false },
];

export const ALL_AUDIENCES: AudienceOption[] = [
  ...CORE_AUDIENCES,
  ...PROFESSIONAL_AUDIENCES,
  ...INDUSTRY_AUDIENCES,
];

/** Flat label list of the legacy core 7 — what existing selectors render. */
export const CORE_AUDIENCE_LABELS: string[] = CORE_AUDIENCES.map((a) => a.label);

/** All known audience labels (core + professional + industry). */
export function getKnownAudienceLabels(): string[] {
  return ALL_AUDIENCES.map((a) => a.label);
}

const KNOWN_AUDIENCE_SET = new Set(ALL_AUDIENCES.map((a) => a.label));

/** Validation predicate — derives from the authority (no duplicate list). */
export function isKnownAudience(label: unknown): boolean {
  return typeof label === 'string' && KNOWN_AUDIENCE_SET.has(label.trim());
}

export interface AudienceVisibilityOverrides {
  /** Extra groups to surface beyond core, e.g. ['industry', 'professional']. */
  includeGroups?: AudienceGroup[];
  /** Labels to hide from selection (org never targets them). */
  hidden?: string[];
  /** Org-specific custom audiences to append. */
  custom?: string[];
}

/**
 * Resolve the selectable audience labels for a surface. With NO overrides this
 * returns exactly the legacy core 7 (current behavior). Surfaces opt into more
 * categories, hide ones an org never targets, or append custom audiences —
 * all UI/config-layer, no DB.
 */
export function getSelectableAudienceLabels(overrides: AudienceVisibilityOverrides = {}): string[] {
  const groups = new Set<AudienceGroup>(['core', ...(overrides.includeGroups ?? [])]);
  const hidden = new Set((overrides.hidden ?? []).map((s) => s.trim()));
  const base = ALL_AUDIENCES
    .filter((a) => (a.defaultVisible || groups.has(a.group)) && !hidden.has(a.label))
    .map((a) => a.label);
  const custom = (overrides.custom ?? [])
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !base.includes(s));
  return [...base, ...custom];
}
