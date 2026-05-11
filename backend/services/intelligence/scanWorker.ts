// Production scan worker.
//
// Drains the scan queue with priority + tenant-fairness scheduling, runs the
// canonical pipeline per dequeued scan, retries on transient failure, and
// dead-letters on exhaustion. Heartbeat-based crash recovery: a scan whose
// heartbeat stales gets requeued by the next worker.
//
// The worker class is composable — operators wrap an instance in their
// preferred runner (cron, persistent process, kubernetes job). The class
// itself is process-lifetime; the canonical-state lives in the queue.

import { randomUUID } from 'crypto';
import type { ScanQueueRecord, ScanQueueStore } from './scanOrchestration';
import { transitionScan } from './scanOrchestration';
import type { TenantContext } from './tenantGovernance';
import { publishScanProgress } from './realtimeChannel';

const HEARTBEAT_INTERVAL_MS = 15_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const STALE_HEARTBEAT_THRESHOLD_MS = 90_000;

export type ScanRunner = (params: {
  scan: ScanQueueRecord;
  tenantContext: TenantContext;
}) => Promise<{ snapshot_observed_at: string }>;

export type ScanWorkerOptions = {
  worker_id?: string;
  /** Tenant-fairness: how many running scans per tenant at once. */
  max_concurrent_per_tenant: number;
  /** Global concurrency cap. */
  max_concurrent_total: number;
  /** Max retry attempts before dead-lettering. */
  max_attempts?: number;
  /**
   * Polling interval. The worker leases the next scan, runs it, and polls
   * again. In production this is invoked by a long-lived process; tests
   * step it manually.
   */
  poll_interval_ms?: number;
};

type LeasingStore = ScanQueueStore & {
  leaseNext?: (params: { worker_id: string; now: string }) => Promise<ScanQueueRecord | null>;
  heartbeat?: (scan_id: string, now: string) => Promise<void>;
};

export class ScanWorker {
  public readonly worker_id: string;
  private running = new Map<string, NodeJS.Timeout>(); // scan_id → heartbeat timer
  private runningPerTenant = new Map<string, number>();
  private stopped = false;

  constructor(
    private readonly store: LeasingStore,
    private readonly runner: ScanRunner,
    private readonly options: ScanWorkerOptions,
  ) {
    this.worker_id = options.worker_id ?? `worker-${randomUUID()}`;
  }

  /** Start the polling loop. Resolves when `stop()` is called. */
  async start(): Promise<void> {
    while (!this.stopped) {
      try {
        await this.tick();
      } catch (error) {
        // Worker-level error: log and back off briefly. Never crashes the loop.
        // eslint-disable-next-line no-console
        console.warn(`[scan-worker:${this.worker_id}] tick failed`, error);
      }
      await new Promise((resolve) => setTimeout(resolve, this.options.poll_interval_ms ?? 2000));
    }
  }

  /** One scheduling tick. Public so test runners can step deterministically. */
  async tick(): Promise<void> {
    if (this.running.size >= this.options.max_concurrent_total) return;
    const lease = this.store.leaseNext
      ? await this.store.leaseNext({ worker_id: this.worker_id, now: new Date().toISOString() })
      : null;
    if (!lease) return;

    // Tenant fairness: if this tenant is already at the cap, requeue and skip.
    const activeForTenant = this.runningPerTenant.get(lease.tenant_id) ?? 0;
    if (activeForTenant >= this.options.max_concurrent_per_tenant) {
      await this.requeue(lease, 'tenant fairness cap hit');
      return;
    }
    this.runningPerTenant.set(lease.tenant_id, activeForTenant + 1);
    this.scheduleHeartbeat(lease);

    const tenantContext: TenantContext = {
      tenant_id: lease.tenant_id,
      actor: lease.enqueued_by,
      request_at: new Date().toISOString(),
      correlation_id: `scan:${lease.id}`,
    };

    await publishScanProgress({
      tenantContext,
      company_id: lease.company_id,
      kind: 'started',
      payload: { scan_id: lease.id, profile: lease.scan_profile, attempt: lease.attempt_count + 1 },
    });

    try {
      const result = await this.runner({ scan: lease, tenantContext });
      await transitionScan({
        tenantContext,
        scanId: lease.id,
        next: {
          status: 'completed',
          completed_at: new Date().toISOString(),
          resulting_snapshot_observed_at: result.snapshot_observed_at,
          worker_id: null,
          heartbeat_at: null,
        },
      });
      await publishScanProgress({
        tenantContext,
        company_id: lease.company_id,
        kind: 'completed',
        payload: { scan_id: lease.id, snapshot_observed_at: result.snapshot_observed_at },
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown error';
      const attempts = (lease.attempt_count ?? 0) + 1;
      const maxAttempts = this.options.max_attempts ?? DEFAULT_MAX_ATTEMPTS;
      if (attempts < maxAttempts) {
        // Retry — back to queued with attempt counter incremented.
        await this.requeue({ ...lease, attempt_count: attempts }, `retry after: ${reason}`);
      } else {
        // Dead letter — fail terminally.
        await transitionScan({
          tenantContext,
          scanId: lease.id,
          next: {
            status: 'failed',
            failure_reason: reason,
            completed_at: new Date().toISOString(),
            worker_id: null,
            heartbeat_at: null,
          },
        });
        await publishScanProgress({
          tenantContext,
          company_id: lease.company_id,
          kind: 'failed',
          payload: { scan_id: lease.id, reason, attempt: attempts },
        });
      }
    } finally {
      this.releaseHeartbeat(lease.id);
      const next = (this.runningPerTenant.get(lease.tenant_id) ?? 1) - 1;
      if (next <= 0) this.runningPerTenant.delete(lease.tenant_id);
      else this.runningPerTenant.set(lease.tenant_id, next);
    }
  }

  /**
   * Crash recovery scan. Operators run this on worker startup OR via a
   * scheduled job. Any scan whose heartbeat is staler than the threshold
   * gets transitioned back to `queued` so another worker picks it up.
   */
  async recoverStaleScans(tenantContext: TenantContext): Promise<{ recovered: number }> {
    const cutoff = new Date(Date.now() - STALE_HEARTBEAT_THRESHOLD_MS).toISOString();
    const running = await this.store.list({
      tenantId: tenantContext.tenant_id,
      status: ['running'],
      limit: 100,
    });
    let recovered = 0;
    for (const scan of running) {
      if (!scan.heartbeat_at || scan.heartbeat_at < cutoff) {
        await transitionScan({
          tenantContext,
          scanId: scan.id,
          next: {
            status: 'queued',
            failure_reason: 'recovered from stale heartbeat',
            worker_id: null,
            heartbeat_at: null,
          },
        });
        recovered += 1;
      }
    }
    return { recovered };
  }

  stop(): void {
    this.stopped = true;
    for (const timer of this.running.values()) clearInterval(timer);
    this.running.clear();
  }

  private async requeue(scan: ScanQueueRecord, reason: string): Promise<void> {
    await this.store.update({ ...scan, status: 'queued', failure_reason: reason, worker_id: null, heartbeat_at: null });
  }

  private scheduleHeartbeat(scan: ScanQueueRecord): void {
    if (!this.store.heartbeat) return;
    const beat = setInterval(async () => {
      try {
        await this.store.heartbeat?.(scan.id, new Date().toISOString());
      } catch {
        // Heartbeat failure is logged but does not crash the worker.
      }
    }, HEARTBEAT_INTERVAL_MS);
    this.running.set(scan.id, beat);
  }

  private releaseHeartbeat(scan_id: string): void {
    const timer = this.running.get(scan_id);
    if (timer) clearInterval(timer);
    this.running.delete(scan_id);
  }
}
