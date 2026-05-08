// Phase 7 LEGACY ELIMINATION — Final tracking record.
//
// Phase 7 marks every remaining legacy field on `SnapshotReport` as
// `@deprecated` and routes every NEW consumer through `canonical.*`. The
// exhaustive list below is the canonical contract for the final cleanup
// pass:
//
//   - column 1: legacy field on `SnapshotReport`
//   - column 2: canonical replacement on `canonical.*`
//   - column 3: subsystem(s) still consuming the legacy field
//   - column 4: status
//
// After every consumer in column 3 migrates, the corresponding row's field
// is physically deleted from the type. Until then, the type carries the
// `@deprecated` annotation that flags any new consumer at compile time.

export const LEGACY_ELIMINATION_TICKETS = [
  {
    legacy_field: 'SnapshotReport.primary_problem',
    canonical_replacement: 'canonical.authority_overview.headline.text + canonical.executive_insights.primary_constraint.text',
    remaining_consumers: [
      'pages/api/reports/automation-activity.ts',
      'backend/services/reportAutomationService.ts',
      'backend/tests/unit/snapshotReportService.test.ts',
    ],
    status: 'deprecated',
  },
  {
    legacy_field: 'SnapshotReport.secondary_problems',
    canonical_replacement: 'canonical.executive_insights.authority_risk.text',
    remaining_consumers: [
      'backend/tests/unit/snapshotReportService.test.ts',
      'pages/api/reports/automation-activity.ts',
    ],
    status: 'deprecated',
  },
  {
    legacy_field: 'SnapshotReport.seo_executive_summary',
    canonical_replacement: 'canonical.executive_insights + canonical.action_playbook',
    remaining_consumers: [
      'pages/api/reports/reportComposedMapper.ts',
      'pages/api/reports/reportViewSectionBuilders.ts',
      'pages/api/reports/automation-activity.ts',
      'backend/services/reportAutomationService.ts',
      'backend/services/snapshotReport/seoExecutiveSummaryHelpers.ts',
      'backend/services/snapshotReport/unifiedSummaryHelpers.ts',
      'backend/services/snapshotReport/summaryDecisionHelpers.ts',
      'backend/tests/unit/snapshotReportService.test.ts',
    ],
    status: 'deprecated',
  },
  {
    legacy_field: 'SnapshotReport.geo_aeo_executive_summary',
    canonical_replacement: 'canonical.ai_surface_presence + canonical.executive_insights',
    remaining_consumers: [
      'pages/api/reports/reportComposedMapper.ts',
      'pages/api/reports/reportViewSectionBuilders.ts',
      'backend/services/snapshotReport/geoAeoSummaryHelpers.ts',
      'backend/services/snapshotReport/unifiedSummaryHelpers.ts',
      'backend/services/snapshotReport/summaryDecisionHelpers.ts',
      'backend/services/snapshotReport/seoExecutiveSummaryHelpers.ts',
      'backend/tests/unit/snapshotReportService.test.ts',
    ],
    status: 'deprecated',
  },
  {
    legacy_field: 'SnapshotReport.unified_intelligence_summary',
    canonical_replacement:
      'canonical.authority_overview.overall_score + canonical.executive_insights + canonical.action_playbook',
    remaining_consumers: [
      'pages/api/reports/reportComposedMapper.ts',
      'pages/api/reports/reportViewSectionBuilders.ts',
      'backend/services/reportAutomationService.ts',
      'backend/services/snapshotReport/unifiedSummaryHelpers.ts',
      'backend/services/snapshotReport/summaryDecisionHelpers.ts',
    ],
    status: 'deprecated',
  },
  {
    legacy_field: 'SnapshotReport.decision_snapshot',
    canonical_replacement: 'canonical.executive_insights + canonical.action_playbook + canonical.strategic_playbook',
    remaining_consumers: ['backend/services/snapshotReport/summaryDecisionHelpers.ts'],
    status: 'deprecated',
  },
  {
    legacy_field: 'SnapshotReport.top_priorities',
    canonical_replacement: 'canonical.action_playbook.actions + canonical.strategic_playbook.actions',
    remaining_consumers: [
      'backend/contracts/actionApiContract.ts',
      'pages/api/reports/execute.ts',
      'pages/api/reports/reportComposedMapper.ts',
      'backend/tests/unit/snapshotReportService.test.ts',
      'backend/services/snapshotReport/summaryDecisionHelpers.ts',
      'backend/services/snapshotReport/seoExecutiveSummaryHelpers.ts',
    ],
    status: 'deprecated',
  },
  {
    legacy_field: 'SnapshotSignalKey + SignalAvailabilityLevel enums',
    canonical_replacement: 'canonical pillar/dimension states (`measured | inferred | insufficient_signal | unavailable`)',
    remaining_consumers: ['backend/services/snapshotReport/signalAvailability.ts (internal helper only)'],
    status: 'internal_only',
  },
] as const;

/**
 * Phase 7 invariant — verified by the production build:
 *   - Every NEW report API surface (`backend/services/intelligence/canonicalApi.ts`)
 *     emits canonical.* only.
 *   - Every NEW report renderer (`backend/services/intelligence/exportRenderer.ts`,
 *     the canonical UI sections) reads canonical.* only.
 *   - The legacy fields persist on `SnapshotReport` strictly to avoid breaking
 *     in-flight consumers, every one of which is tracked in the table above.
 *
 * Once every consumer in `remaining_consumers` migrates to its canonical
 * replacement, the corresponding field is deleted from `SnapshotReport`.
 */
export const PHASE_7_INVARIANTS = {
  canonical_is_authoritative: true,
  legacy_fields_marked_deprecated: true,
  new_consumers_must_use_canonical: true,
  delete_on_zero_consumers: true,
} as const;
