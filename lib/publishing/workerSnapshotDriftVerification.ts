// Draft-vs-Snapshot Drift Verification
//
// Deterministic, advisory-only comparison of a live mutable draft against a
// frozen persisted snapshot. Detects content, SEO, media, taxonomy, slug,
// publish-metadata, and company-ownership drift. Produces an advisory drift
// report — it NEVER blocks publishing.

import type { UniversalPublishSnapshot } from './universalPublishSnapshot';
import type { BlogContentSource } from './publishSnapshotMapper';
import {
  deriveSnapshotRuntimeStatus,
  type SnapshotRuntimeSeverity,
  type SnapshotRuntimeStatus,
} from './workerSnapshotRuntimeStatus';

export type DriftKind =
  | 'content'
  | 'seo'
  | 'media'
  | 'taxonomy'
  | 'slug'
  | 'publish_metadata'
  | 'company_ownership';

export interface DriftFinding {
  kind: DriftKind;
  severity: SnapshotRuntimeSeverity;
  detail: string;
}

export interface WorkerSnapshotDriftReport {
  version: 'worker-snapshot-drift-report-v1';
  hasDrift: boolean;
  status: SnapshotRuntimeStatus;
  driftKinds: readonly DriftKind[];
  findings: readonly DriftFinding[];
}

export interface WorkerDraftSnapshotComparisonInput {
  draft: BlogContentSource;
  draftRenderedHtml: string;
  snapshot: UniversalPublishSnapshot;
}

function str(value: string | null | undefined): string {
  return typeof value === 'string' ? value : '';
}

export function verifyDraftVsSnapshotDrift(
  input: WorkerDraftSnapshotComparisonInput,
): WorkerSnapshotDriftReport {
  const { draft, draftRenderedHtml, snapshot } = input;
  const findings: DriftFinding[] = [];

  // Content drift.
  if (draftRenderedHtml !== snapshot.renderedHtml) {
    findings.push({ kind: 'content', severity: 'risk', detail: 'rendered html differs from the frozen snapshot' });
  }
  if (JSON.stringify(draft.content_blocks ?? []) !== JSON.stringify(snapshot.contentBlocks)) {
    findings.push({ kind: 'content', severity: 'risk', detail: 'content blocks differ from the frozen snapshot' });
  }

  // SEO drift.
  if ((str(draft.seo_meta_title) || str(draft.title)) !== snapshot.seoMetadata.metaTitle) {
    findings.push({ kind: 'seo', severity: 'warning', detail: 'seo meta title differs from the frozen snapshot' });
  }
  if ((str(draft.seo_meta_description) || str(draft.excerpt)) !== snapshot.seoMetadata.metaDescription) {
    findings.push({ kind: 'seo', severity: 'warning', detail: 'seo meta description differs from the frozen snapshot' });
  }

  // Media drift.
  if (str(draft.featured_image_url) !== snapshot.mediaReferences.featuredImageUrl) {
    findings.push({ kind: 'media', severity: 'warning', detail: 'featured image differs from the frozen snapshot' });
  }

  // Taxonomy drift.
  if (str(draft.category) !== snapshot.taxonomy.category) {
    findings.push({ kind: 'taxonomy', severity: 'warning', detail: 'category differs from the frozen snapshot' });
  }
  if (JSON.stringify((draft.tags ?? []).map((tag) => String(tag))) !== JSON.stringify(snapshot.taxonomy.tags)) {
    findings.push({ kind: 'taxonomy', severity: 'warning', detail: 'tags differ from the frozen snapshot' });
  }

  // Slug drift.
  if (str(draft.slug) !== snapshot.slug) {
    findings.push({ kind: 'slug', severity: 'risk', detail: 'slug differs from the frozen snapshot' });
  }

  // Publish metadata drift.
  if (str(draft.external_id) !== snapshot.publishTargetMetadata.externalId) {
    findings.push({ kind: 'publish_metadata', severity: 'risk', detail: 'external id differs from the frozen snapshot' });
  }
  if ((draft.scheduled_publish_at ?? null) !== snapshot.scheduledTimestamp) {
    findings.push({ kind: 'publish_metadata', severity: 'risk', detail: 'scheduled timestamp differs from the frozen snapshot' });
  }

  // Company ownership drift — catastrophic for a publish-to-website feature.
  if (str(draft.company_id) !== snapshot.companyContext.companyId) {
    findings.push({ kind: 'company_ownership', severity: 'invalid', detail: 'company id differs from the frozen snapshot' });
  }
  if (str(draft.website_id) !== snapshot.companyContext.websiteId) {
    findings.push({ kind: 'company_ownership', severity: 'invalid', detail: 'website id differs from the frozen snapshot' });
  }
  if (str(draft.integration_id) !== snapshot.companyContext.integrationId) {
    findings.push({ kind: 'company_ownership', severity: 'invalid', detail: 'integration id differs from the frozen snapshot' });
  }

  const driftKinds = [...new Set(findings.map((finding) => finding.kind))].sort();
  return {
    version: 'worker-snapshot-drift-report-v1',
    hasDrift: findings.length > 0,
    status: deriveSnapshotRuntimeStatus(findings),
    driftKinds,
    findings,
  };
}

export function serializeWorkerSnapshotDriftReport(report: WorkerSnapshotDriftReport): string {
  return [
    '## WORKER SNAPSHOT DRIFT REPORT',
    `Version: ${report.version}`,
    `Has drift: ${report.hasDrift}`,
    `Status: ${report.status}`,
    `Drift kinds: ${report.driftKinds.join(', ') || 'none'}`,
    `Findings: ${report.findings.map((finding) => `${finding.kind}(${finding.severity})`).join('; ') || 'none'}`,
  ].join('\n');
}
