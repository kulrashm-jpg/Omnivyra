/**
 * Communication Lifecycle Intelligence — service (WS-2C, Zone A2).
 *
 * READ-SIDE only over registered communications. Consumes ONLY the canonical
 * coordination API — the `CommunicationRegistry`, the `SemanticRootRegistry`, and
 * the pure `buildCommunicationGraph` projector. No writes, no producer coupling,
 * no platform change ⇒ inherently zero behaviour change. Every method is fail-safe
 * (typed `Result`, never throws).
 */
import { AiError } from '../../../ai/safety';
import type { CommunicationIntent } from '../../../../platform/intelligence';
import type {
  CommunicationRecord,
  CommunicationRegistry,
  CoordinationResult,
  DuplicateIntentVerdict,
} from '../coordinationContracts';
import type { SemanticRootRegistry, CommunicationGraph } from '../semanticContinuityContracts';
import { buildCommunicationGraph } from '../communicationGraph';
import { deriveLifecycleProgression } from '../registration/registrationContracts';
import { communicationRegistry } from '../communicationRegistry';
import { semanticRootRegistry } from '../semanticRootRegistry';
import type {
  CommunicationIntelligence,
  CommunicationHistoryQuery,
  CommunicationTimeline,
  LineageView,
  LifecycleHistory,
  IntentReuse,
  SemanticCluster,
  RepeatedIntent,
  CommunicationGap,
  ContinuityReport,
} from './communicationIntelligenceContracts';
import { recordIntelligenceQuery, recordIntelligenceDegrade } from './coordinationIntelligenceObservability';

const DEFAULT_SINCE_DAYS = 90;
const DEFAULT_STALE_DAYS = 60;
const MAX_SCAN = 2000;
const DAY_MS = 86_400_000;

export interface CommunicationIntelligenceDeps {
  registry?: CommunicationRegistry;
  roots?: SemanticRootRegistry;
  /** Injectable clock (epoch ms) for deterministic windowing in tests. */
  nowMs?: () => number;
}

function ok<T>(value: T): CoordinationResult<T> { return { ok: true, value }; }
function fail<T>(error: AiError): CoordinationResult<T> { return { ok: false, error }; }

function requireTenant(companyId: string | undefined | null): AiError | null {
  if (typeof companyId === 'string' && companyId.length > 0) return null;
  return new AiError('TENANT_REQUIRED', { devDetail: 'coordination intelligence: companyId is required' });
}

const uniq = <T>(xs: T[]): T[] => Array.from(new Set(xs));
const minStr = (a: string, b: string) => (a < b ? a : b);
const maxStr = (a: string, b: string) => (a > b ? a : b);

class CommunicationIntelligenceImpl implements CommunicationIntelligence {
  private readonly registry: CommunicationRegistry;
  private readonly roots: SemanticRootRegistry;
  private readonly nowMs: () => number;

  constructor(deps: CommunicationIntelligenceDeps) {
    this.registry = deps.registry ?? communicationRegistry;
    this.roots = deps.roots ?? semanticRootRegistry;
    this.nowMs = deps.nowMs ?? (() => Date.now());
  }

  /** Read every communication for a company (bounded). */
  private async scanAll(companyId: string): Promise<CommunicationRecord[]> {
    const res = await this.registry.lookup(companyId, { limit: MAX_SCAN });
    return 'error' in res ? [] : res.value;
  }

  private clusterOf(records: CommunicationRecord[]): SemanticCluster {
    const observed = records.map((r) => r.observedAt);
    return {
      semanticRootId: records[0].semanticRootId,
      size: records.length,
      intents: uniq(records.map((r) => r.communicationIntent)),
      platforms: uniq(records.map((r) => r.platform).filter((p): p is string => !!p)),
      campaignIds: uniq(records.map((r) => r.campaignId).filter((c): c is string => !!c)),
      lifecycleStates: uniq(records.map((r) => r.publicationStatus)),
      firstObserved: observed.reduce(minStr),
      lastObserved: observed.reduce(maxStr),
    };
  }

  private groupByRoot(records: CommunicationRecord[]): Map<string, CommunicationRecord[]> {
    const m = new Map<string, CommunicationRecord[]>();
    for (const r of records) {
      const list = m.get(r.semanticRootId) ?? [];
      list.push(r);
      m.set(r.semanticRootId, list);
    }
    return m;
  }

  async getHistory(companyId: string, query: CommunicationHistoryQuery = {}): Promise<CoordinationResult<CommunicationRecord[]>> {
    const tenantErr = requireTenant(companyId);
    if (tenantErr) return fail(tenantErr);
    const started = this.nowMs();
    try {
      const since = query.since
        ?? (query.sinceDays ? new Date(this.nowMs() - query.sinceDays * DAY_MS).toISOString() : undefined);
      const res = await this.registry.lookup(companyId, {
        since,
        campaignId: query.campaignId ?? undefined,
        platform: query.platform ?? undefined,
        communicationIntent: query.communicationIntent,
        semanticRootId: query.semanticRootId,
        limit: query.limit ?? MAX_SCAN,
      });
      if ('error' in res) return fail(res.error);
      recordIntelligenceQuery('getHistory', res.value.length, this.nowMs() - started);
      return ok(res.value);
    } catch (e) {
      recordIntelligenceDegrade('getHistory', 'error');
      return fail(new AiError('INTERNAL', { devDetail: `getHistory failed: ${msg(e)}` }));
    }
  }

  async getTimeline(companyId: string, query: CommunicationHistoryQuery = {}): Promise<CoordinationResult<CommunicationTimeline>> {
    const tenantErr = requireTenant(companyId);
    if (tenantErr) return fail(tenantErr);
    try {
      const days = query.sinceDays ?? DEFAULT_SINCE_DAYS;
      const to = new Date(this.nowMs()).toISOString();
      const from = query.since ?? new Date(this.nowMs() - days * DAY_MS).toISOString();
      const hist = await this.getHistory(companyId, { ...query, since: from });
      if ('error' in hist) return fail(hist.error);
      // store.query already returns newest-first.
      return ok({ companyId, from, to, entries: hist.value, total: hist.value.length });
    } catch (e) {
      recordIntelligenceDegrade('getTimeline', 'error');
      return fail(new AiError('INTERNAL', { devDetail: `getTimeline failed: ${msg(e)}` }));
    }
  }

  async getLineage(companyId: string, semanticRootId: string): Promise<CoordinationResult<LineageView>> {
    const tenantErr = requireTenant(companyId);
    if (tenantErr) return fail(tenantErr);
    try {
      const artRes = await this.registry.lookup(companyId, { semanticRootId, limit: MAX_SCAN });
      if ('error' in artRes) return fail(artRes.error);
      const rootRes = await this.roots.get(companyId, semanticRootId);
      const root = 'error' in rootRes ? null : rootRes.value;
      const graph = buildCommunicationGraph({
        companyId,
        roots: root ? [root] : [],
        artifacts: artRes.value,
        semanticRootId,
      });
      recordIntelligenceQuery('getLineage', artRes.value.length, 0);
      return ok({ semanticRootId, root, artifacts: artRes.value, graph });
    } catch (e) {
      recordIntelligenceDegrade('getLineage', 'error');
      return fail(new AiError('INTERNAL', { devDetail: `getLineage failed: ${msg(e)}` }));
    }
  }

  async getGraph(companyId: string, semanticRootId?: string): Promise<CoordinationResult<CommunicationGraph>> {
    const tenantErr = requireTenant(companyId);
    if (tenantErr) return fail(tenantErr);
    try {
      const artRes = await this.registry.lookup(companyId, semanticRootId ? { semanticRootId, limit: MAX_SCAN } : { limit: MAX_SCAN });
      if ('error' in artRes) return fail(artRes.error);
      const rootsRes = await this.roots.list(companyId);
      const allRoots = 'error' in rootsRes ? [] : rootsRes.value;
      const graph = buildCommunicationGraph({ companyId, roots: allRoots, artifacts: artRes.value, semanticRootId });
      recordIntelligenceQuery('getGraph', graph.nodes.length, 0);
      return ok(graph);
    } catch (e) {
      recordIntelligenceDegrade('getGraph', 'error');
      return fail(new AiError('INTERNAL', { devDetail: `getGraph failed: ${msg(e)}` }));
    }
  }

  async getPublishedFromRoot(companyId: string, semanticRootId: string): Promise<CoordinationResult<CommunicationRecord[]>> {
    const lineage = await this.getLineage(companyId, semanticRootId);
    if ('error' in lineage) return fail(lineage.error);
    const published = lineage.value.artifacts.filter(
      (r) => r.publicationStatus === 'published' || r.artifactType === 'published_asset',
    );
    return ok(published);
  }

  async getLifecycleHistory(companyId: string, communicationId: string): Promise<CoordinationResult<LifecycleHistory>> {
    const tenantErr = requireTenant(companyId);
    if (tenantErr) return fail(tenantErr);
    try {
      const res = await this.registry.get(companyId, communicationId);
      if ('error' in res) return fail(res.error);
      if (!res.value) return fail(new AiError('INTERNAL', { devDetail: `communication ${communicationId} not found` }));
      const current = res.value.publicationStatus;
      const { completed, pending, canonical } = deriveLifecycleProgression(current);
      return ok({
        communicationId,
        current,
        completed,
        pending,
        observedAt: res.value.observedAt,
        note: canonical
          ? 'progression derived from the monotonic lifecycle; per-transition timestamps are not persisted'
          : 'current state is not a canonical lifecycle state',
      });
    } catch (e) {
      recordIntelligenceDegrade('getLifecycleHistory', 'error');
      return fail(new AiError('INTERNAL', { devDetail: `getLifecycleHistory failed: ${msg(e)}` }));
    }
  }

  async getIntentReuse(companyId: string, communicationIntent?: CommunicationIntent): Promise<CoordinationResult<IntentReuse[]>> {
    const tenantErr = requireTenant(companyId);
    if (tenantErr) return fail(tenantErr);
    try {
      const all = await this.scanAll(companyId);
      const byIntent = new Map<CommunicationIntent, CommunicationRecord[]>();
      for (const r of all) {
        if (communicationIntent && r.communicationIntent !== communicationIntent) continue;
        const list = byIntent.get(r.communicationIntent) ?? [];
        list.push(r);
        byIntent.set(r.communicationIntent, list);
      }
      const out: IntentReuse[] = Array.from(byIntent.entries()).map(([intent, records]) => ({
        communicationIntent: intent,
        campaignIds: uniq(records.map((r) => r.campaignId).filter((c): c is string => !!c)),
        communicationCount: records.length,
        semanticRootIds: uniq(records.map((r) => r.semanticRootId)),
      }));
      recordIntelligenceQuery('getIntentReuse', out.length, 0);
      return ok(out);
    } catch (e) {
      recordIntelligenceDegrade('getIntentReuse', 'error');
      return fail(new AiError('INTERNAL', { devDetail: `getIntentReuse failed: ${msg(e)}` }));
    }
  }

  async getSemanticClusters(companyId: string): Promise<CoordinationResult<SemanticCluster[]>> {
    const tenantErr = requireTenant(companyId);
    if (tenantErr) return fail(tenantErr);
    try {
      const all = await this.scanAll(companyId);
      const clusters = Array.from(this.groupByRoot(all).values()).map((records) => this.clusterOf(records));
      clusters.sort((a, b) => b.size - a.size);
      recordIntelligenceQuery('getSemanticClusters', clusters.length, 0);
      return ok(clusters);
    } catch (e) {
      recordIntelligenceDegrade('getSemanticClusters', 'error');
      return fail(new AiError('INTERNAL', { devDetail: `getSemanticClusters failed: ${msg(e)}` }));
    }
  }

  async getRepeatedIntents(companyId: string): Promise<CoordinationResult<RepeatedIntent[]>> {
    const tenantErr = requireTenant(companyId);
    if (tenantErr) return fail(tenantErr);
    try {
      const all = await this.scanAll(companyId);
      const repeated: RepeatedIntent[] = [];
      for (const records of this.groupByRoot(all).values()) {
        if (records.length > 1) {
          repeated.push({
            semanticRootId: records[0].semanticRootId,
            communicationIntent: records[0].communicationIntent,
            count: records.length,
            records,
          });
        }
      }
      repeated.sort((a, b) => b.count - a.count);
      recordIntelligenceQuery('getRepeatedIntents', repeated.length, 0);
      return ok(repeated);
    } catch (e) {
      recordIntelligenceDegrade('getRepeatedIntents', 'error');
      return fail(new AiError('INTERNAL', { devDetail: `getRepeatedIntents failed: ${msg(e)}` }));
    }
  }

  async findRelatedCommunications(
    companyId: string,
    input: { communicationIntent: CommunicationIntent; topic: string; campaignId?: string | null; platform?: string | null },
  ): Promise<CoordinationResult<DuplicateIntentVerdict>> {
    const tenantErr = requireTenant(companyId);
    if (tenantErr) return fail(tenantErr);
    // Delegates to the canonical, non-persisting duplicate-intent check.
    return this.registry.checkDuplicateIntent({
      companyId,
      communicationIntent: input.communicationIntent,
      topic: input.topic,
      campaignId: input.campaignId ?? null,
      platform: input.platform ?? null,
      sourceModule: 'unknown',
    });
  }

  async getGaps(companyId: string, opts: { staleDays?: number } = {}): Promise<CoordinationResult<CommunicationGap[]>> {
    const tenantErr = requireTenant(companyId);
    if (tenantErr) return fail(tenantErr);
    try {
      const all = await this.scanAll(companyId);
      const staleBefore = new Date(this.nowMs() - (opts.staleDays ?? DEFAULT_STALE_DAYS) * DAY_MS).toISOString();
      const gaps: CommunicationGap[] = [];
      for (const records of this.groupByRoot(all).values()) {
        const cluster = this.clusterOf(records);
        const published = records.some((r) => r.publicationStatus === 'published' || r.artifactType === 'published_asset');
        if (!published) {
          gaps.push({ kind: 'unpublished', semanticRootId: cluster.semanticRootId, detail: `${records.length} artifact(s), none published` });
        }
        if (cluster.lastObserved < staleBefore) {
          gaps.push({ kind: 'stale', semanticRootId: cluster.semanticRootId, detail: `no activity since ${cluster.lastObserved}` });
        }
        if (cluster.platforms.length === 1 && records.length > 1) {
          gaps.push({ kind: 'single_platform', semanticRootId: cluster.semanticRootId, detail: `only on ${cluster.platforms[0]}` });
        }
      }
      recordIntelligenceQuery('getGaps', gaps.length, 0);
      return ok(gaps);
    } catch (e) {
      recordIntelligenceDegrade('getGaps', 'error');
      return fail(new AiError('INTERNAL', { devDetail: `getGaps failed: ${msg(e)}` }));
    }
  }

  async getContinuityReport(companyId: string): Promise<CoordinationResult<ContinuityReport>> {
    const tenantErr = requireTenant(companyId);
    if (tenantErr) return fail(tenantErr);
    try {
      const [clusters, repeated, gaps, all] = await Promise.all([
        this.getSemanticClusters(companyId),
        this.getRepeatedIntents(companyId),
        this.getGaps(companyId),
        this.scanAll(companyId),
      ]);
      if ('error' in clusters) return fail(clusters.error);
      if ('error' in repeated) return fail(repeated.error);
      if ('error' in gaps) return fail(gaps.error);
      return ok({
        companyId,
        totalCommunications: all.length,
        clusterCount: clusters.value.length,
        clusters: clusters.value,
        repeatedIntents: repeated.value,
        gaps: gaps.value,
      });
    } catch (e) {
      recordIntelligenceDegrade('getContinuityReport', 'error');
      return fail(new AiError('INTERNAL', { devDetail: `getContinuityReport failed: ${msg(e)}` }));
    }
  }
}

function msg(e: unknown): string { return e instanceof Error ? e.message : String(e); }

/** Construct the intelligence service with explicit deps (tests, migration waves). */
export function createCommunicationIntelligence(deps: CommunicationIntelligenceDeps = {}): CommunicationIntelligence {
  return new CommunicationIntelligenceImpl(deps);
}

/** Default process-wide read-side intelligence over the canonical registry. */
export const communicationIntelligence: CommunicationIntelligence = createCommunicationIntelligence();
