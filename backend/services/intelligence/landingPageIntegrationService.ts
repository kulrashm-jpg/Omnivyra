/**
 * External landing page integrations — provider-agnostic registry + diagnostics.
 *
 * Registers external landing pages (ClickFunnels/Leadpages/Unbounce/Instapage/
 * HubSpot/generic) so attribution handoffs and downstream conversions can be
 * lineage-anchored to a known destination. Persistence: table-gated
 * `external_landing_pages` with append-only audit fallback. Diagnostics:
 * orphan-conversion detection (conversions without a matching registered
 * landing page), attribution-continuity rate per page.
 */
import { ownedDbTable } from '../../db/writeOwner';
import { recordComplianceAudit } from '../audit/complianceAuditService';

export type LandingProvider =
  | 'clickfunnels'
  | 'leadpages'
  | 'unbounce'
  | 'instapage'
  | 'hubspot'
  | 'generic';

export interface RegisteredLandingPage {
  id?: string;
  provider: LandingProvider;
  pageUrl: string;
  attributionParam: string;
  notes?: string;
  createdAt?: string;
}

let probe: boolean | null = null;
async function hasTable(): Promise<boolean> {
  if (probe !== null) return probe;
  try {
    const { error } = await ownedDbTable('external_landing_pages')
      .select('id', { count: 'exact', head: true })
      .limit(1);
    probe = !error;
  } catch { probe = false; }
  return probe;
}

export async function registerLandingPage(args: {
  companyId: string;
  provider: LandingProvider;
  pageUrl: string;
  attributionParam?: string;
  registeredBy: string;
  notes?: string;
}): Promise<{ ok: boolean; detail: string }> {
  const attrParam = args.attributionParam || '_attr';
  if (await hasTable()) {
    const { error } = await ownedDbTable('external_landing_pages').upsert(
      {
        company_id: args.companyId,
        provider: args.provider,
        page_url: args.pageUrl,
        attribution_param: attrParam,
        registered_by: args.registeredBy,
        notes: args.notes ?? null,
      },
      { onConflict: 'company_id,page_url', ignoreDuplicates: true },
    );
    if (error) return { ok: false, detail: error.message };
  }
  await recordComplianceAudit({
    companyId: args.companyId,
    actor: { userId: args.registeredBy, type: 'user', label: 'landing-page-registry' },
    action: 'external_landing_page.registered',
    resourceType: 'external_landing_page',
    resourceId: args.pageUrl,
    severity: 'info',
    entityLineage: ['company', 'external_landing_page', args.provider],
    detail: { provider: args.provider, pageUrl: args.pageUrl, attrParam, notes: args.notes ?? null },
  }).catch(() => undefined);
  return { ok: true, detail: 'registered (idempotent on company+page_url)' };
}

export async function listLandingPages(companyId: string): Promise<RegisteredLandingPage[]> {
  if (!(await hasTable())) {
    try {
      const { data } = await ownedDbTable('audit_events')
        .select('resource_id, metadata, created_at')
        .eq('company_id', companyId)
        .eq('resource_type', 'external_landing_page')
        .order('created_at', { ascending: false })
        .limit(200);
      return ((data ?? []) as any[]).map((r) => ({
        provider: ((r.metadata ?? {}).provider ?? 'generic') as LandingProvider,
        pageUrl: String(r.resource_id ?? ''),
        attributionParam: String((r.metadata ?? {}).attrParam ?? '_attr'),
        notes: (r.metadata ?? {}).notes ?? undefined,
        createdAt: r.created_at,
      }));
    } catch { return []; }
  }
  try {
    const { data } = await ownedDbTable('external_landing_pages')
      .select('id, provider, page_url, attribution_param, notes, created_at')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(200);
    return ((data ?? []) as any[]).map((r) => ({
      id: r.id,
      provider: r.provider,
      pageUrl: r.page_url,
      attributionParam: r.attribution_param,
      notes: r.notes ?? undefined,
      createdAt: r.created_at,
    }));
  } catch { return []; }
}

export interface LandingDiagnostics {
  companyId: string;
  generatedAt: string;
  registered: number;
  handoffsToKnownPages24h: number;
  orphanConversions24h: number;
  detail: string;
}

export async function buildLandingDiagnostics(companyId: string): Promise<LandingDiagnostics> {
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const pages = await listLandingPages(companyId);
  const registeredHosts = new Set(
    pages.map((p) => {
      try { return new URL(p.pageUrl).hostname.toLowerCase(); } catch { return p.pageUrl.toLowerCase(); }
    }),
  );

  let handoffsKnown = 0;
  try {
    if (await hasTable()) {
      const { data } = await ownedDbTable('attribution_handoffs')
        .select('destination_url')
        .eq('company_id', companyId)
        .gte('issued_at', since)
        .limit(2000);
      for (const r of ((data ?? []) as any[])) {
        const u = String(r.destination_url ?? '');
        try {
          const h = new URL(u).hostname.toLowerCase();
          if (registeredHosts.has(h)) handoffsKnown += 1;
        } catch { /* ignore */ }
      }
    }
  } catch { /* ignore */ }

  // Orphan conversions: form_conversions whose origin/landing isn't a known
  // registered external page AND lacks a verified handoff token (heuristic).
  let orphan = 0;
  try {
    const { data } = await ownedDbTable('form_conversions')
      .select('metadata')
      .eq('company_id', companyId)
      .gte('converted_at', since)
      .limit(2000);
    for (const r of ((data ?? []) as any[])) {
      const m = r.metadata ?? {};
      const refUrl = String((m as any).referrer ?? (m as any).source_url ?? '');
      if (!refUrl) continue;
      try {
        const h = new URL(refUrl).hostname.toLowerCase();
        if (!registeredHosts.has(h) && (m as any).attr_verified !== true) orphan += 1;
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }

  return {
    companyId,
    generatedAt: new Date().toISOString(),
    registered: pages.length,
    handoffsToKnownPages24h: handoffsKnown,
    orphanConversions24h: orphan,
    detail: orphan > 0
      ? `${orphan} conversion(s) lack a known landing-page anchor — review attribution setup.`
      : 'No orphan conversions detected in 24h window.',
  };
}
