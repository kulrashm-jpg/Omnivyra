/**
 * crawlSession.ts — the canonical Crawl Session (CKRE-001R §4).
 *
 * ONE aggregator that carries a crawl's identity and observability through the
 * EXISTING crawl components — correlation ID, crawl ID, workflow, timings,
 * metrics, and (optionally) the resulting fingerprint + decision. It is NOT a
 * new workflow engine: it wraps the CKRE-001 event service + cache + fingerprint
 * + decision, and hands `toContext()` to the unchanged `crawlWebsiteSources`.
 *
 * Reuse-only: emits through `emitCrawlEvent`, correlates through
 * `resolveCrawlCorrelationId`. Downstream components operate through the session
 * by receiving its `toContext()` (structurally a CrawlContext).
 */

import { randomUUID } from 'crypto';
import { emitCrawlEvent, resolveCrawlCorrelationId, type CrawlEventName } from './crawlEventService';
import type { WebsiteFingerprint } from './websiteFingerprintService';
import type { ChangeDecision } from './changeDetectionService';

export interface CrawlSessionInit {
  companyId?: string | null;
  userId?: string | null;
  email?: string | null;
  workflow?: string | null;
  correlationId?: string | null;
}

/** The context shape consumed by crawlWebsiteSources (structurally compatible). */
export interface CrawlSessionContext {
  companyId?: string | null;
  userId?: string | null;
  email?: string | null;
  correlationId?: string | null;
  workflow?: string | null;
  crawlId?: string;
}

export class CrawlSession {
  readonly crawlId: string;
  readonly workflow: string;
  readonly companyId: string | null;
  readonly userId: string | null;
  readonly email: string | null;
  private _correlationId: string | null;
  private readonly startedAt: number;
  private readonly timings: Record<string, number> = {};
  private readonly metrics: Record<string, number> = {};
  fingerprint: WebsiteFingerprint | null = null;
  decision: ChangeDecision | null = null;

  constructor(init: CrawlSessionInit = {}, crawlId: string = randomUUID(), nowMs: number = Date.now()) {
    this.crawlId = crawlId;
    this.workflow = init.workflow ?? 'crawl';
    this.companyId = init.companyId ?? null;
    this.userId = init.userId ?? null;
    this.email = init.email ?? null;
    this._correlationId = init.correlationId ?? null;
    this.startedAt = nowMs;
  }

  /** Resolve (and cache) the shared journey correlation ID. Never throws. */
  async correlationId(): Promise<string> {
    if (!this._correlationId) {
      this._correlationId = await resolveCrawlCorrelationId(this.email, this.companyId);
    }
    return this._correlationId;
  }

  /** Context object to hand to crawlWebsiteSources (carries the crawlId). */
  toContext(): CrawlSessionContext {
    return {
      companyId: this.companyId,
      userId: this.userId,
      email: this.email,
      correlationId: this._correlationId,
      workflow: this.workflow,
      crawlId: this.crawlId,
    };
  }

  /** Record a timing marker (ms since session start). */
  mark(label: string, nowMs: number = Date.now()): void {
    this.timings[label] = nowMs - this.startedAt;
  }

  /** Increment a session-local metric counter (mirrors the global crawl.* metrics). */
  count(metric: string, by = 1): void {
    this.metrics[metric] = (this.metrics[metric] ?? 0) + by;
  }

  /** Emit a crawl event stamped with this session's crawlId + workflow. */
  async emit(
    event: CrawlEventName,
    outcome: 'allowed' | 'denied',
    reason?: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    const correlationId = await this.correlationId();
    await emitCrawlEvent({
      event, outcome, correlationId,
      companyId: this.companyId, userId: this.userId,
      workflow: this.workflow, reason: reason ?? null,
      metadata: { crawlId: this.crawlId, ...(metadata ?? {}) },
    });
  }

  recordFingerprint(fp: WebsiteFingerprint): void { this.fingerprint = fp; }
  recordDecision(d: ChangeDecision): void { this.decision = d; }

  /** Immutable snapshot of the session's aggregated state (debugging / replay). */
  snapshot(): {
    crawlId: string;
    correlationId: string | null;
    workflow: string;
    companyId: string | null;
    timings: Record<string, number>;
    metrics: Record<string, number>;
    fingerprint: WebsiteFingerprint | null;
    decision: ChangeDecision | null;
  } {
    return {
      crawlId: this.crawlId,
      correlationId: this._correlationId,
      workflow: this.workflow,
      companyId: this.companyId,
      timings: { ...this.timings },
      metrics: { ...this.metrics },
      fingerprint: this.fingerprint,
      decision: this.decision,
    };
  }
}

/** Factory (preferred entry point). */
export function createCrawlSession(init: CrawlSessionInit = {}): CrawlSession {
  return new CrawlSession(init);
}
