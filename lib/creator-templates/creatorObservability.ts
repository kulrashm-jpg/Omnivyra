/**
 * Creator Observability — pure deterministic health, integrity, and dependency
 * analysis (no AI, no DB). It introduces NO new Creator capability: it consumes
 * summarized facts already produced by the existing subsystems and reports
 * status. Read-only; same inputs → same report.
 */

export type HealthStatus = 'PASS' | 'WARNING' | 'FAILED';

export interface SectionHealth {
  section: string;
  status: HealthStatus;
  reasons: string[];
  metrics?: Record<string, number>;
}

const RANK: Record<HealthStatus, number> = { PASS: 0, WARNING: 1, FAILED: 2 };
export function worst(statuses: HealthStatus[]): HealthStatus {
  return statuses.reduce<HealthStatus>((acc, s) => (RANK[s] > RANK[acc] ? s : acc), 'PASS');
}

/* ── Health snapshot (summarized facts the service gathers) ─────────────── */

export interface ObservabilitySnapshot {
  templateLibrary: { systemCount: number };
  userTemplates: { total: number; failedPreviews: number; pendingPreviews: number; missingDiagnostics: number };
  collections: { total: number; invalid: number; orphan: number };
  campaignDesignSystems: { total: number; unhealthy: number; pinMismatches: number };
  previewQueue: { pending: number; rendering: number; failed: number };
  renderQueue: { configured: boolean; active: number; failed: number; deadLetter: number };
  aiAssist: { configured: boolean; recentCalls: number; recentFailures: number };
  publishing: { recentPublishes: number; recentFailures: number };
  analytics: { assetsWithData: number; attributedAssets: number };
  performance: { measuredAssets: number };
  evolution: { recommendationsAvailable: number };
}

function section(name: string, status: HealthStatus, reasons: string[], metrics?: Record<string, number>): SectionHealth {
  return { section: name, status, reasons: reasons.length ? reasons : ['Healthy.'], metrics };
}

/** Deterministically evaluate per-subsystem health from the snapshot. */
export function evaluateHealth(s: ObservabilitySnapshot): { sections: SectionHealth[]; overall: HealthStatus } {
  const sections: SectionHealth[] = [];

  sections.push(section('Template Library',
    s.templateLibrary.systemCount > 0 ? 'PASS' : 'FAILED',
    s.templateLibrary.systemCount > 0 ? [] : ['No system templates registered.'],
    { systemCount: s.templateLibrary.systemCount }));

  {
    const u = s.userTemplates;
    const reasons: string[] = [];
    let status: HealthStatus = 'PASS';
    if (u.total > 0 && u.failedPreviews === u.total) { status = 'FAILED'; reasons.push('All user-template previews failed.'); }
    else {
      if (u.failedPreviews > 0) { status = 'WARNING'; reasons.push(`${u.failedPreviews} failed preview(s).`); }
      if (u.pendingPreviews > 0) { status = worst([status, 'WARNING']); reasons.push(`${u.pendingPreviews} preview(s) in flight.`); }
      if (u.missingDiagnostics > 0) { status = worst([status, 'WARNING']); reasons.push(`${u.missingDiagnostics} template(s) missing diagnostics.`); }
    }
    sections.push(section('User Templates', status, reasons, { total: u.total, failedPreviews: u.failedPreviews }));
  }

  sections.push(section('Collections',
    s.collections.invalid > 0 ? 'FAILED' : s.collections.orphan > 0 ? 'WARNING' : 'PASS',
    [...(s.collections.invalid > 0 ? [`${s.collections.invalid} collection(s) with invalid references.`] : []),
     ...(s.collections.orphan > 0 ? [`${s.collections.orphan} orphan collection(s) (no members).`] : [])],
    { total: s.collections.total }));

  sections.push(section('Campaign Design Systems',
    s.campaignDesignSystems.pinMismatches > 0 ? 'FAILED' : s.campaignDesignSystems.unhealthy > 0 ? 'WARNING' : 'PASS',
    [...(s.campaignDesignSystems.pinMismatches > 0 ? [`${s.campaignDesignSystems.pinMismatches} pinned collection(s) no longer exist.`] : []),
     ...(s.campaignDesignSystems.unhealthy > 0 ? [`${s.campaignDesignSystems.unhealthy} design system(s) failing health (missing families / broken refs).`] : [])],
    { total: s.campaignDesignSystems.total }));

  sections.push(section('Preview Queue',
    s.previewQueue.failed > 0 ? 'WARNING' : 'PASS',
    s.previewQueue.failed > 0 ? [`${s.previewQueue.failed} failed preview render(s).`] : [],
    { pending: s.previewQueue.pending, rendering: s.previewQueue.rendering, failed: s.previewQueue.failed }));

  {
    const r = s.renderQueue;
    const reasons: string[] = [];
    let status: HealthStatus = 'PASS';
    if (r.deadLetter > 0) { status = 'FAILED'; reasons.push(`${r.deadLetter} render job(s) in dead-letter.`); }
    if (r.failed > 0) { status = worst([status, 'WARNING']); reasons.push(`${r.failed} failed render job(s).`); }
    if (!r.configured) { status = worst([status, 'WARNING']); reasons.push('Durable render queue not configured (inline fallback in use).'); }
    sections.push(section('Render Queue', status, reasons, { active: r.active, failed: r.failed, deadLetter: r.deadLetter }));
  }

  sections.push(section('AI Assist',
    !s.aiAssist.configured ? 'WARNING' : s.aiAssist.recentFailures > 0 ? 'WARNING' : 'PASS',
    [...(!s.aiAssist.configured ? ['AI not configured — deterministic fallback in use.'] : []),
     ...(s.aiAssist.recentFailures > 0 ? [`${s.aiAssist.recentFailures} recent AI failure(s).`] : [])],
    { recentCalls: s.aiAssist.recentCalls, recentFailures: s.aiAssist.recentFailures }));

  sections.push(section('Publishing',
    s.publishing.recentFailures > 0 ? 'WARNING' : 'PASS',
    s.publishing.recentFailures > 0 ? [`${s.publishing.recentFailures} recent publish failure(s).`] : [],
    { recentPublishes: s.publishing.recentPublishes, recentFailures: s.publishing.recentFailures }));

  sections.push(section('Analytics',
    s.analytics.assetsWithData === 0 ? 'WARNING' : 'PASS',
    s.analytics.assetsWithData === 0 ? ['No analytics rows yet for creator assets.']
      : s.analytics.attributedAssets === 0 ? ['Analytics present but no design attribution detected.'] : [],
    { assetsWithData: s.analytics.assetsWithData, attributedAssets: s.analytics.attributedAssets }));

  sections.push(section('Performance Intelligence',
    s.performance.measuredAssets === 0 ? 'WARNING' : 'PASS',
    s.performance.measuredAssets === 0 ? ['No measured performance yet.'] : [],
    { measuredAssets: s.performance.measuredAssets }));

  sections.push(section('Evolution Engine', 'PASS', [], { recommendationsAvailable: s.evolution.recommendationsAvailable }));

  return { sections, overall: worst(sections.map((x) => x.status)) };
}

/* ── Integrity checks (deterministic; no repair) ───────────────────────── */

export type IntegrityType =
  | 'missing_template' | 'orphan_collection' | 'invalid_reference' | 'version_mismatch'
  | 'preview_mismatch' | 'attribution_mismatch' | 'campaign_pin_mismatch'
  | 'missing_diagnostics' | 'missing_performance';

export interface IntegrityFinding {
  type: IntegrityType;
  severity: 'warning' | 'error';
  objectType: string;
  objectId: string;
  detail: string;
}

export interface IntegrityInput {
  collections: Array<{ id: string; version: number; templateIds: string[]; coverTemplateId: string | null }>;
  campaignDesignSystems: Array<{ campaignId: string; collectionId: string; pinnedVersion: number }>;
  userTemplates: Array<{ id: string; previewStatus: string; hasThumbnail: boolean; hasDiagnostic: boolean }>;
  /** Does a template id resolve (system or user)? */
  templateExists: (id: string) => boolean;
  /** Current collection version, or null if the collection no longer exists. */
  collectionVersion: (id: string) => number | null;
  /** Template ids that have measured performance data. */
  measuredTemplateIds: Set<string>;
}

export function runIntegrityChecks(input: IntegrityInput): IntegrityFinding[] {
  const out: IntegrityFinding[] = [];
  const push = (f: IntegrityFinding) => out.push(f);

  for (const c of input.collections) {
    if (c.templateIds.length === 0) push({ type: 'orphan_collection', severity: 'warning', objectType: 'collection', objectId: c.id, detail: 'Collection has no members.' });
    for (const tid of c.templateIds) {
      if (!input.templateExists(tid)) push({ type: 'missing_template', severity: 'error', objectType: 'collection', objectId: c.id, detail: `References missing template ${tid}.` });
    }
    if (c.coverTemplateId && !c.templateIds.includes(c.coverTemplateId)) {
      push({ type: 'invalid_reference', severity: 'warning', objectType: 'collection', objectId: c.id, detail: `Cover ${c.coverTemplateId} is not a member.` });
    }
    let measured = false;
    for (const tid of c.templateIds) if (input.measuredTemplateIds.has(tid)) { measured = true; break; }
    if (c.templateIds.length > 0 && !measured) push({ type: 'missing_performance', severity: 'warning', objectType: 'collection', objectId: c.id, detail: 'No measured performance for any member.' });
  }

  for (const ds of input.campaignDesignSystems) {
    const current = input.collectionVersion(ds.collectionId);
    if (current === null) push({ type: 'campaign_pin_mismatch', severity: 'error', objectType: 'campaign', objectId: ds.campaignId, detail: `Pinned collection ${ds.collectionId} no longer exists.` });
    else if (current !== ds.pinnedVersion) push({ type: 'version_mismatch', severity: 'warning', objectType: 'campaign', objectId: ds.campaignId, detail: `Pinned v${ds.pinnedVersion}; collection is now v${current}.` });
  }

  for (const t of input.userTemplates) {
    if (t.previewStatus === 'ready' && !t.hasThumbnail) push({ type: 'preview_mismatch', severity: 'warning', objectType: 'template', objectId: t.id, detail: 'Preview marked ready but no image.' });
    if (!t.hasDiagnostic) push({ type: 'missing_diagnostics', severity: 'warning', objectType: 'template', objectId: t.id, detail: 'No diagnostic report.' });
  }

  // Stable order: severity (error first), then type, then objectId.
  return out.sort((a, b) =>
    (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1)
    || (a.type < b.type ? -1 : a.type > b.type ? 1 : 0)
    || (a.objectId < b.objectId ? -1 : a.objectId > b.objectId ? 1 : 0));
}

/* ── Dependency graph (deterministic) ──────────────────────────────────── */

export interface GraphNode { id: string; type: string; label: string }
export interface GraphEdge { from: string; to: string }
export interface DependencyGraph { nodes: GraphNode[]; edges: GraphEdge[] }

/**
 * Build the deterministic dependency graph
 * Template → Collection → Campaign Design System → Campaign → Assets → Analytics
 * → Performance → Evolution. Lets any failure be traced to its originating object.
 */
export function buildDependencyGraph(input: {
  collections: Array<{ id: string; name: string; templateIds: string[] }>;
  campaignDesignSystems: Array<{ campaignId: string; collectionId: string }>;
  templateLabel?: (id: string) => string;
}): DependencyGraph {
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const addNode = (n: GraphNode) => { if (!nodes.has(n.id)) nodes.set(n.id, n); };
  const addEdge = (from: string, to: string) => { if (!edges.some((e) => e.from === from && e.to === to)) edges.push({ from, to }); };

  // Stable downstream chain nodes (one each).
  const STAGES: GraphNode[] = [
    { id: 'stage:assets', type: 'assets', label: 'Generated Assets' },
    { id: 'stage:analytics', type: 'analytics', label: 'Analytics' },
    { id: 'stage:performance', type: 'performance', label: 'Performance' },
    { id: 'stage:evolution', type: 'evolution', label: 'Evolution' },
  ];
  STAGES.forEach(addNode);
  for (let i = 0; i < STAGES.length - 1; i++) addEdge(STAGES[i]!.id, STAGES[i + 1]!.id);

  for (const c of input.collections) {
    const colId = `collection:${c.id}`;
    addNode({ id: colId, type: 'collection', label: c.name });
    for (const tid of c.templateIds) {
      const tplId = `template:${tid}`;
      addNode({ id: tplId, type: 'template', label: input.templateLabel?.(tid) ?? tid });
      addEdge(tplId, colId);
    }
  }
  for (const ds of input.campaignDesignSystems) {
    const colId = `collection:${ds.collectionId}`;
    const dsId = `cds:${ds.campaignId}`;
    const campId = `campaign:${ds.campaignId}`;
    addNode({ id: dsId, type: 'campaign_design_system', label: `Design system (${ds.campaignId.slice(0, 8)})` });
    addNode({ id: campId, type: 'campaign', label: `Campaign ${ds.campaignId.slice(0, 8)}` });
    addEdge(colId, dsId);
    addEdge(dsId, campId);
    addEdge(campId, 'stage:assets');
  }

  const order = ['template', 'collection', 'campaign_design_system', 'campaign', 'assets', 'analytics', 'performance', 'evolution'];
  const sortedNodes = Array.from(nodes.values()).sort((a, b) =>
    (order.indexOf(a.type) - order.indexOf(b.type)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { nodes: sortedNodes, edges };
}
