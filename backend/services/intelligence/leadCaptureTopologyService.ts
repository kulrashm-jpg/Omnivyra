/**
 * Lead-capture TOPOLOGY service — operator-selected architecture model.
 *
 * Captures which lead-capture topology(ies) a tenant uses so onboarding can
 * dynamically render only relevant options + downstream diagnostics can be
 * topology-aware. Persistence: `lead_capture_topologies` WHEN PRESENT
 * (20260696), else append-only `audit_events` substrate. Append-only history
 * always; the "active" record is the newest. No hardened-ingress refactor.
 */
import { ownedDbTable } from '../../db/writeOwner';
import { recordComplianceAudit } from '../audit/complianceAuditService';

export type TopologyKind =
  | 'SAME_SITE'
  | 'EXTERNAL_LANDING_PAGES'
  | 'EMBEDDED_FORMS'
  | 'SPA_FUNNEL'
  | 'WEBHOOK_ONLY'
  | 'HYBRID_MULTI_SOURCE';

export type AttributionMode =
  | 'same_domain'
  | 'cross_domain'
  | 'iframe_embed'
  | 'webhook_reconciliation'
  | 'sdk_instrumentation';

export interface TopologySelection {
  topologies: TopologyKind[];
  attributionModes: AttributionMode[];
  notes?: string;
  recordedAt: string;
}

export interface IntegrationOption {
  key: string;
  title: string;
  description: string;
  href?: string;
}

const ALL_TOPOLOGIES: TopologyKind[] = [
  'SAME_SITE', 'EXTERNAL_LANDING_PAGES', 'EMBEDDED_FORMS', 'SPA_FUNNEL', 'WEBHOOK_ONLY', 'HYBRID_MULTI_SOURCE',
];
const ALL_ATTRIBUTION_MODES: AttributionMode[] = [
  'same_domain', 'cross_domain', 'iframe_embed', 'webhook_reconciliation', 'sdk_instrumentation',
];

let probe: boolean | null = null;
async function hasTable(): Promise<boolean> {
  if (probe !== null) return probe;
  try {
    const { error } = await ownedDbTable('lead_capture_topologies')
      .select('id', { count: 'exact', head: true })
      .limit(1);
    probe = !error;
  } catch { probe = false; }
  return probe;
}

export function validTopologies(): TopologyKind[] { return [...ALL_TOPOLOGIES]; }
export function validAttributionModes(): AttributionMode[] { return [...ALL_ATTRIBUTION_MODES]; }

export async function recordTopology(args: {
  companyId: string;
  topologies: TopologyKind[];
  attributionModes?: AttributionMode[];
  notes?: string;
  actorUserId: string;
}): Promise<{ ok: boolean; detail: string }> {
  const topologies = args.topologies.filter((t) => ALL_TOPOLOGIES.includes(t));
  if (topologies.length === 0) return { ok: false, detail: 'at least one topology is required' };
  const attributionModes = (args.attributionModes ?? []).filter((m) => ALL_ATTRIBUTION_MODES.includes(m));

  // Append-only audit lineage (always written).
  await recordComplianceAudit({
    companyId: args.companyId,
    actor: { userId: args.actorUserId, type: 'user', label: 'topology' },
    action: 'lead_capture_topology.recorded',
    resourceType: 'lead_capture_topology',
    resourceId: args.companyId,
    severity: 'info',
    entityLineage: ['company', 'lead_capture_topology'],
    detail: { topologies, attributionModes, notes: args.notes ?? null },
  }).catch(() => undefined);

  if (await hasTable()) {
    // Deactivate any prior active row then insert. The partial UNIQUE index
    // (active=true) makes the invariant DB-enforced if both succeed.
    try {
      await ownedDbTable('lead_capture_topologies')
        .update({ active: false })
        .eq('company_id', args.companyId)
        .eq('active', true);
      const { error } = await ownedDbTable('lead_capture_topologies').insert({
        company_id: args.companyId,
        topologies,
        attribution_modes: attributionModes,
        notes: args.notes ?? null,
        recorded_by: args.actorUserId,
        active: true,
      });
      if (error) return { ok: false, detail: error.message };
    } catch (err) {
      return { ok: false, detail: err instanceof Error ? err.message : 'persistence failed' };
    }
  }
  return { ok: true, detail: 'topology recorded (append-only; latest active)' };
}

export async function getCurrentTopology(companyId: string): Promise<TopologySelection | null> {
  if (await hasTable()) {
    try {
      const { data } = await ownedDbTable('lead_capture_topologies')
        .select('topologies, attribution_modes, notes, recorded_at')
        .eq('company_id', companyId)
        .eq('active', true)
        .order('recorded_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if ((data as any)?.topologies) {
        return {
          topologies: (data as any).topologies as TopologyKind[],
          attributionModes: ((data as any).attribution_modes ?? []) as AttributionMode[],
          notes: (data as any).notes ?? undefined,
          recordedAt: (data as any).recorded_at,
        };
      }
    } catch { /* fall through */ }
  }
  // Audit fallback: newest recorded event wins.
  try {
    const { data } = await ownedDbTable('audit_events')
      .select('metadata, created_at')
      .eq('company_id', companyId)
      .eq('resource_type', 'lead_capture_topology')
      .order('created_at', { ascending: false })
      .limit(1);
    const row = (data ?? [])[0] as any;
    if (row?.metadata?.topologies?.length) {
      return {
        topologies: row.metadata.topologies as TopologyKind[],
        attributionModes: (row.metadata.attributionModes ?? []) as AttributionMode[],
        notes: row.metadata.notes ?? undefined,
        recordedAt: row.created_at,
      };
    }
  } catch { /* none */ }
  return null;
}

export async function getTopologyHistory(companyId: string, limit = 50): Promise<TopologySelection[]> {
  try {
    const { data } = await ownedDbTable('audit_events')
      .select('metadata, created_at')
      .eq('company_id', companyId)
      .eq('resource_type', 'lead_capture_topology')
      .order('created_at', { ascending: false })
      .limit(limit);
    return ((data ?? []) as any[]).map((r) => ({
      topologies: (r.metadata?.topologies ?? []) as TopologyKind[],
      attributionModes: (r.metadata?.attributionModes ?? []) as AttributionMode[],
      notes: r.metadata?.notes ?? undefined,
      recordedAt: r.created_at,
    }));
  } catch { return []; }
}

/** Dynamic integration options surfaced PER topology (deterministic). */
export function getTopologyIntegrationOptions(topologies: TopologyKind[]): IntegrationOption[] {
  const seen = new Set<string>();
  const opts: IntegrationOption[] = [];
  const add = (o: IntegrationOption) => { if (!seen.has(o.key)) { seen.add(o.key); opts.push(o); } };

  for (const t of topologies) {
    if (t === 'SAME_SITE' || t === 'HYBRID_MULTI_SOURCE') {
      add({ key: 'cms_plugin', title: 'CMS connection', description: 'Connect WordPress / Ghost / Drupal / Joomla / Webflow / Shopify (auto-detected on test).', href: '/integrations?focus=website' });
      add({ key: 'native_form_detection', title: 'Native form detection', description: 'Forms on your own site post to /api/leads (no extra setup once tracker is installed).' });
      add({ key: 'tracker_install', title: 'Install tracking snippet', description: 'Add omnivera-tracker.js to your site head.', href: '/website-setup' });
    }
    if (t === 'EXTERNAL_LANDING_PAGES' || t === 'HYBRID_MULTI_SOURCE') {
      add({ key: 'landing_page_registry', title: 'Register external landing pages', description: 'ClickFunnels, Leadpages, Unbounce, Instapage, HubSpot, generic.', href: '/lead-capture' });
      add({ key: 'cross_domain_attr', title: 'Cross-domain attribution', description: 'Set CROSS_DOMAIN_ATTR_SECRET + add the universal SDK to origin & destination domains.' });
      add({ key: 'conversion_callbacks', title: 'Conversion callbacks', description: 'Configure your landing-page provider to POST conversions to the isolated webhook handoff endpoint.' });
    }
    if (t === 'EMBEDDED_FORMS' || t === 'HYBRID_MULTI_SOURCE') {
      add({ key: 'embedded_form_registry', title: 'Register embedded forms', description: 'HubSpot, Typeform, Tally, Jotform, Calendly, Google Forms, generic.', href: '/lead-capture' });
      add({ key: 'iframe_bridge', title: 'iframe attribution bridge', description: 'SDK postMessage bridge propagates the attribution token into iframes.' });
      add({ key: 'embedded_callbacks', title: 'Submission callbacks', description: 'Configure the form provider to POST callbacks (existing /api/leads webhook mode).' });
    }
    if (t === 'SPA_FUNNEL' || t === 'HYBRID_MULTI_SOURCE') {
      add({ key: 'sdk_install', title: 'Install universal SDK', description: 'Add /omnivera-attribution.js — persists attribution across SPA route changes.' });
      add({ key: 'route_continuity', title: 'Route continuity', description: 'SDK hooks pushState/popstate to re-tag links after each client-side route change.' });
      add({ key: 'frontend_instrumentation', title: 'Conversion instrumentation', description: 'Call OmnivyraAttribution.recordConversion({ formId, fields }) on submit.' });
    }
    if (t === 'WEBHOOK_ONLY' || t === 'HYBRID_MULTI_SOURCE') {
      add({ key: 'webhook_endpoints', title: 'Configure webhook handoff', description: 'Set LEAD_WEBHOOK_HANDOFF_SECRET + POST signed conversions to /api/internal/lead-webhook-handoff.' });
      add({ key: 'conversion_reconciliation', title: 'Conversion reconciliation', description: 'Append-only lineage links webhook callbacks to attribution tokens.' });
      add({ key: 'server_side_attribution', title: 'Server-side attribution', description: 'Stamp conversions with the attribution token captured at form load.' });
    }
    if (t === 'HYBRID_MULTI_SOURCE') {
      add({ key: 'orchestration_wizard', title: 'Hybrid orchestration', description: 'Configure each subsystem above; diagnostics report continuity per leg.' });
      add({ key: 'attribution_continuity_validation', title: 'Attribution continuity validation', description: 'Use the funnel + continuity diagnostics tabs to monitor breaks per topology.', href: '/lead-capture' });
    }
  }
  return opts;
}

export interface TopologyDiagnostics {
  companyId: string;
  generatedAt: string;
  topology: TopologySelection | null;
  integrationOptions: IntegrationOption[];
  completenessScore: number; // 0..100
  attributionGapWarnings: string[];
  recommendedNextActions: string[];
  capabilityNote: string;
}

export async function buildTopologyDiagnostics(companyId: string): Promise<TopologyDiagnostics> {
  const topology = await getCurrentTopology(companyId);
  const topologies = topology?.topologies ?? [];
  const modes = topology?.attributionModes ?? [];

  const integrationOptions = topologies.length > 0 ? getTopologyIntegrationOptions(topologies) : [];

  // Completeness score = (declared options × required-mode coverage) heuristic.
  const requiredModesByTopology: Record<TopologyKind, AttributionMode[]> = {
    SAME_SITE: ['same_domain'],
    EXTERNAL_LANDING_PAGES: ['cross_domain', 'sdk_instrumentation'],
    EMBEDDED_FORMS: ['iframe_embed', 'sdk_instrumentation'],
    SPA_FUNNEL: ['sdk_instrumentation'],
    WEBHOOK_ONLY: ['webhook_reconciliation'],
    HYBRID_MULTI_SOURCE: ['cross_domain', 'sdk_instrumentation', 'webhook_reconciliation'],
  };
  const requiredAll = new Set<AttributionMode>(topologies.flatMap((t) => requiredModesByTopology[t]));
  const covered = [...requiredAll].filter((m) => modes.includes(m)).length;
  const coverage = requiredAll.size > 0 ? covered / requiredAll.size : 0;
  const completenessScore =
    topology === null ? 0 : Math.round(60 + coverage * 40);

  const attributionGapWarnings: string[] = [];
  for (const need of requiredAll) {
    if (!modes.includes(need)) {
      attributionGapWarnings.push(`Missing attribution mode "${need}" — required by your selected topology.`);
    }
  }

  const recommendedNextActions: string[] = [];
  if (!topology) {
    recommendedNextActions.push('Set your lead-capture topology so we can render the right integration options.');
  } else if (attributionGapWarnings.length > 0) {
    recommendedNextActions.push('Enable the missing attribution mode(s) to close cross-topology breaks.');
  } else {
    recommendedNextActions.push('Run the funnel diagnostics to confirm continuity is healthy.');
  }

  return {
    companyId,
    generatedAt: new Date().toISOString(),
    topology,
    integrationOptions,
    completenessScore,
    attributionGapWarnings,
    recommendedNextActions,
    capabilityNote:
      'Deterministic topology model; integration options are static per-topology. No ML, no autonomous selection.',
  };
}
