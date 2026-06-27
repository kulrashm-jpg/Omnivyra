/**
 * Creator Observability Service — aggregates read-only operational facts from
 * EVERY existing Creator subsystem into one report (health + metrics + integrity
 * + dependency graph). Introduces no capability and reuses existing services /
 * telemetry. Best-effort: any unavailable subsystem degrades to zeros, never
 * throws.
 */

import { supabase } from '../../db/supabaseClient';
import { getTemplateById, type CreatorTemplate, type TemplateAssetFamily } from '../../../lib/creator-templates';
import {
  type ObservabilitySnapshot, type SectionHealth, type HealthStatus,
  type IntegrityFinding, type DependencyGraph,
  evaluateHealth, runIntegrityChecks, buildDependencyGraph,
} from '../../../lib/creator-templates/creatorObservability';
import { previewStatusOf } from '../../../lib/creator-templates/userTemplatePreview';
import { blueprintCoverage, STORY_BLUEPRINT_IDS } from '../../../lib/creator-templates/storyBlueprint';
import { validateCollection, collectionFamilies, type TemplateCollection, type TemplateResolver } from '../../../lib/creator-templates/collection';
import { campaignDesignHealth, type CampaignDesignSystem } from '../../../lib/creator-templates/campaignDesignSystem';
import { listUserTemplates } from './userTemplateService';
import { listCollections, buildResolver } from './collectionService';
import { getCompanyDesignPerformance } from './designPerformanceService';
import { isDurableCreatorRenderQueueConfigured } from '../creatorRenderDurableQueue';

export interface CreatorObservabilityReport {
  overall: HealthStatus;
  sections: SectionHealth[];
  integrity: IntegrityFinding[];
  graph: DependencyGraph;
  /** Story Blueprint health — coverage / duplicates / unused (pure reporting). */
  storyBlueprints: { present: string[]; duplicates: string[]; missing: string[]; unused: string[] };
  generatedFor: string;
}

async function listCampaignDesignSystems(companyId: string): Promise<CampaignDesignSystem[]> {
  try {
    const { data, error } = await supabase.from('campaign_design_systems').select('design_system_json').eq('company_id', companyId);
    if (error || !data) return [];
    return (data as Record<string, unknown>[])
      .map((r) => (r.design_system_json && typeof r.design_system_json === 'object' ? JSON.parse(JSON.stringify(r.design_system_json)) as CampaignDesignSystem : null))
      .filter((d): d is CampaignDesignSystem => d !== null);
  } catch { return []; }
}

export async function getCreatorObservabilityReport(companyId: string): Promise<CreatorObservabilityReport> {
  const [userTemplates, collections, cds] = await Promise.all([
    listUserTemplates({ companyId }),
    listCollections({ companyId }),
    listCampaignDesignSystems(companyId),
  ]);

  // One resolver over every referenced template id (collections + pinned snapshots).
  const allIds = Array.from(new Set([
    ...collections.flatMap((c) => c.templateIds),
    ...cds.flatMap((d) => d.pinnedSnapshot?.templateIds ?? []),
  ]));
  const resolve: TemplateResolver = allIds.length ? await buildResolver(allIds) : ((id) => getTemplateById(id) ?? null);

  // Performance (best-effort).
  let measuredAssets = 0;
  const measuredTemplateIds = new Set<string>();
  try {
    const perf = await getCompanyDesignPerformance(companyId);
    measuredAssets = perf.assetCount;
    for (const t of perf.templates) if (t.impressions > 0) measuredTemplateIds.add(t.key);
  } catch { /* best-effort */ }

  // ── User-template facts ──
  let failedPreviews = 0, pendingPreviews = 0, missingDiagnostics = 0;
  const userTemplateFacts = userTemplates.map((t) => {
    const status = previewStatusOf(t);
    const hasThumbnail = !!t.preview.thumbnailUrl;
    const hasDiagnostic = !!(t.metadata as Record<string, unknown> | undefined)?.creator_diagnostic_report;
    if (status === 'failed') failedPreviews++;
    if (status === 'pending' || status === 'rendering') pendingPreviews++;
    if (!hasDiagnostic) missingDiagnostics++;
    return { id: t.id, previewStatus: status, hasThumbnail, hasDiagnostic };
  });

  // ── Collection facts ──
  let invalidCollections = 0, orphanCollections = 0;
  for (const c of collections) {
    if (!validateCollection(c, resolve).ok) invalidCollections++;
    if (c.templateIds.length === 0) orphanCollections++;
  }
  const collectionVersion = (id: string): number | null => collections.find((c) => c.id === id)?.version ?? null;

  // ── Campaign design-system facts ──
  let cdsUnhealthy = 0, cdsPinMismatch = 0;
  for (const d of cds) {
    if (collectionVersion(d.collectionId) === null) cdsPinMismatch++;
    try { if (!campaignDesignHealth(d, resolve).ok) cdsUnhealthy++; } catch { /* best-effort */ }
  }

  const templateExists = (id: string): boolean => !!getTemplateById(id) || userTemplates.some((t) => t.id === id) || !!resolve(id);

  // ── Snapshot ──
  const snapshot: ObservabilitySnapshot = {
    templateLibrary: { systemCount: countSystemTemplates() },
    userTemplates: { total: userTemplates.length, failedPreviews, pendingPreviews, missingDiagnostics },
    collections: { total: collections.length, invalid: invalidCollections, orphan: orphanCollections },
    campaignDesignSystems: { total: cds.length, unhealthy: cdsUnhealthy, pinMismatches: cdsPinMismatch },
    previewQueue: { pending: userTemplateFacts.filter((t) => t.previewStatus === 'pending').length, rendering: userTemplateFacts.filter((t) => t.previewStatus === 'rendering').length, failed: failedPreviews },
    renderQueue: { configured: safeBool(isDurableCreatorRenderQueueConfigured), active: 0, failed: 0, deadLetter: 0 },
    aiAssist: { configured: aiConfigured(), recentCalls: 0, recentFailures: 0 },
    publishing: { recentPublishes: 0, recentFailures: 0 },
    analytics: { assetsWithData: measuredAssets, attributedAssets: measuredAssets },
    performance: { measuredAssets },
    evolution: { recommendationsAvailable: 0 },
  };

  const { sections, overall } = evaluateHealth(snapshot);

  const integrity = runIntegrityChecks({
    collections: collections.map((c) => ({ id: c.id, version: c.version, templateIds: c.templateIds, coverTemplateId: c.preview.coverTemplateId })),
    campaignDesignSystems: cds.map((d) => ({ campaignId: d.campaignId, collectionId: d.collectionId, pinnedVersion: d.pinnedVersion })),
    userTemplates: userTemplateFacts,
    templateExists,
    collectionVersion,
    measuredTemplateIds,
  });

  const graph = buildDependencyGraph({
    collections: collections.map((c) => ({ id: c.id, name: c.name, templateIds: c.templateIds })),
    campaignDesignSystems: cds.map((d) => ({ campaignId: d.campaignId, collectionId: d.collectionId })),
    templateLabel: (id) => resolve(id)?.name ?? id,
  });

  // Story Blueprint health — coverage over every resolvable creator template.
  const allTemplates = [...userTemplates, ...collections.flatMap((c) => c.templateIds.map(resolve).filter((t): t is CreatorTemplate => t !== null))];
  const cov = blueprintCoverage(allTemplates, STORY_BLUEPRINT_IDS);
  const storyBlueprints = { present: cov.present, duplicates: cov.duplicates, missing: cov.missing, unused: cov.missing };

  return { overall, sections, integrity, graph, storyBlueprints, generatedFor: companyId };
}

/* ── small helpers (best-effort, no throw) ─────────────────────────────── */

function safeBool(fn: () => boolean): boolean { try { return fn(); } catch { return false; } }
function aiConfigured(): boolean {
  try { return !!(process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY); } catch { return false; }
}
function countSystemTemplates(): number {
  const families: TemplateAssetFamily[] = ['image', 'carousel', 'infographic'];
  let n = 0;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const lib = require('../../../lib/creator-templates') as { listTemplatesForFamily?: (f: TemplateAssetFamily) => CreatorTemplate[] };
    if (typeof lib.listTemplatesForFamily === 'function') for (const f of families) n += lib.listTemplatesForFamily(f).length;
  } catch { /* best-effort */ }
  return n;
}

/** Read-only operational helper: families present in a collection (for tracing). */
export function collectionFamilyTrace(c: TemplateCollection, resolve: TemplateResolver) {
  return collectionFamilies(c, resolve);
}
