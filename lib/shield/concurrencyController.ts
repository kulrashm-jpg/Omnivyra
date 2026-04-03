/**
 * MULTI-TENANT SHIELD: CONCURRENCY CONTROLLER
 * 
 * Per-user concurrent execution limits
 * Prevents single user from consuming all system resources
 */

export interface ConcurrencySlot {
  userId: string;
  jobId: string;
  startTime: number;
  timeoutMs: number;
}

export interface UserConcurrencyState {
  userId: string;
  tier: string;
  maxConcurrent: number;
  currentConcurrent: number;
  totalProcessed: number;
  avgDuration: number;
  lastUpdated: number;
}

export class ConcurrencyController {
  private activeSlots: Map<string, Set<string>> = new Map(); // userId -> Set<jobIds>
  private tierLimits: Record<string, number> = {
    FREE: 1,
    STARTER: 3,
    PRO: 10,
    ENTERPRISE: 50,
  };

  private userStats: Map<string, { processed: number; totalDuration: number }> = new Map();
  private slotMetadata: Map<string, ConcurrencySlot> = new Map(); // jobId -> slot info

  constructor(defaultTier: string = 'STARTER') {
    this.setDefaultTier(defaultTier);
  }

  /**
   * Check if user can start a new job
   */
  canStartJob(userId: string, tier: string = 'STARTER'): {
    allowed: boolean;
    current: number;
    max: number;
    waitEstimate?: number;
  } {
    const maxConcurrent = this.tierLimits[tier] || this.tierLimits['STARTER'];
    const currentCount = this.activeSlots.get(userId)?.size || 0;

    const allowed = currentCount < maxConcurrent;

    if (!allowed) {
      // Estimate wait time: avg duration of current jobs * (currentCount - max)
      const avgDuration = this.getAverageDuration(userId) || 5000; // 5s default
      const waitEstimate = (currentCount - maxConcurrent + 1) * avgDuration;

      return {
        allowed: false,
        current: currentCount,
        max: maxConcurrent,
        waitEstimate,
      };
    }

    return {
      allowed: true,
      current: currentCount,
      max: maxConcurrent,
    };
  }

  /**
   * Acquire a concurrency slot
   */
  acquireSlot(userId: string, jobId: string, tier: string = 'STARTER', timeoutMs: number = 300000): boolean {
    const result = this.canStartJob(userId, tier);
    if (!result.allowed) {
      return false;
    }

    // Initialize user slots if needed
    if (!this.activeSlots.has(userId)) {
      this.activeSlots.set(userId, new Set());
    }

    // Add job to active slots
    this.activeSlots.get(userId)!.add(jobId);

    // Track metadata for timeout and stats
    this.slotMetadata.set(jobId, {
      userId,
      jobId,
      startTime: Date.now(),
      timeoutMs,
    });

    return true;
  }

  /**
   * Release a concurrency slot (on completion)
   */
  releaseSlot(jobId: string, durationMs: number): boolean {
    const slot = this.slotMetadata.get(jobId);
    if (!slot) {
      return false;
    }

    const slots = this.activeSlots.get(slot.userId);
    if (!slots || !slots.has(jobId)) {
      return false;
    }

    // Remove from active slots
    slots.delete(jobId);
    this.slotMetadata.delete(jobId);

    // Update stats
    this.recordCompletion(slot.userId, durationMs);

    // Remove partition if empty
    if (slots.size === 0) {
      this.activeSlots.delete(slot.userId);
    }

    return true;
  }

  /**
   * Record job completion for stats
   */
  private recordCompletion(userId: string, durationMs: number) {
    if (!this.userStats.has(userId)) {
      this.userStats.set(userId, { processed: 0, totalDuration: 0 });
    }

    const stats = this.userStats.get(userId)!;
    stats.processed++;
    stats.totalDuration += durationMs;
  }

  /**
   * Get average job duration for a user
   */
  getAverageDuration(userId: string): number | null {
    const stats = this.userStats.get(userId);
    if (!stats || stats.processed === 0) {
      return null;
    }

    return stats.totalDuration / stats.processed;
  }

  /**
   * Get user concurrency state
   */
  getState(userId: string, tier: string = 'STARTER'): UserConcurrencyState {
    const maxConcurrent = this.tierLimits[tier] || this.tierLimits['STARTER'];
    const currentConcurrent = this.activeSlots.get(userId)?.size || 0;
    const stats = this.userStats.get(userId) || { processed: 0, totalDuration: 0 };

    return {
      userId,
      tier,
      maxConcurrent,
      currentConcurrent,
      totalProcessed: stats.processed,
      avgDuration: stats.processed > 0 ? stats.totalDuration / stats.processed : 0,
      lastUpdated: Date.now(),
    };
  }

  /**
   * Check for slot timeouts (should be called periodically)
   */
  checkTimeouts(): string[] {
    const now = Date.now();
    const timedOut: string[] = [];

    for (const [jobId, slot] of this.slotMetadata) {
      const elapsed = now - slot.startTime;
      if (elapsed > slot.timeoutMs) {
        timedOut.push(jobId);
      }
    }

    return timedOut;
  }

  /**
   * Force release a timed-out slot
   */
  forceReleaseSlot(jobId: string): boolean {
    const slot = this.slotMetadata.get(jobId);
    if (!slot) {
      return false;
    }

    const slots = this.activeSlots.get(slot.userId);
    if (slots) {
      slots.delete(jobId);

      if (slots.size === 0) {
        this.activeSlots.delete(slot.userId);
      }
    }

    this.slotMetadata.delete(jobId);
    return true;
  }

  /**
   * Update tier limits
   */
  setTierLimit(tier: string, maxConcurrent: number) {
    this.tierLimits[tier] = maxConcurrent;
  }

  /**
   * Set default tier for tier lookups
   */
  setDefaultTier(tier: string) {
    if (!this.tierLimits[tier]) {
      this.tierLimits[tier] = this.tierLimits['STARTER'];
    }
  }

  /**
   * Get all active users with concurrent jobs
   */
  getActiveUsers(): Map<string, number> {
    const active = new Map<string, number>();

    for (const [userId, slots] of this.activeSlots) {
      active.set(userId, slots.size);
    }

    return active;
  }

  /**
   * Get system-wide concurrency stats
   */
  getSystemStats(): {
    totalActive: number;
    totalUsers: number;
    avgPerUser: number;
    maxPerUser: number;
    utilizationPercent: number;
  } {
    let totalActive = 0;
    let maxPerUser = 0;

    for (const slots of this.activeSlots.values()) {
      const count = slots.size;
      totalActive += count;
      maxPerUser = Math.max(maxPerUser, count);
    }

    const totalUsers = this.activeSlots.size;
    const totalCapacity = Object.values(this.tierLimits).reduce((a, b) => a + b, 0);

    return {
      totalActive,
      totalUsers,
      avgPerUser: totalUsers > 0 ? totalActive / totalUsers : 0,
      maxPerUser,
      utilizationPercent: totalCapacity > 0 ? (totalActive / totalCapacity) * 100 : 0,
    };
  }

  /**
   * Reset user stats (admin operation)
   */
  resetUserStats(userId: string): boolean {
    const slots = this.activeSlots.get(userId);

    // Don't reset if user has active jobs
    if (slots && slots.size > 0) {
      return false;
    }

    this.userStats.delete(userId);
    this.activeSlots.delete(userId);

    // Remove associated slot metadata
    for (const [jobId, slot] of this.slotMetadata) {
      if (slot.userId === userId) {
        this.slotMetadata.delete(jobId);
      }
    }

    return true;
  }

  /**
   * Clean up stale metadata (memory management)
   */
  cleanup(ageMinutes: number = 60): number {
    const cutoff = Date.now() - ageMinutes * 60000;
    let removed = 0;

    // Find users with no active slots and old stats
    for (const [userId, stats] of this.userStats) {
      const slots = this.activeSlots.get(userId);

      if (!slots || slots.size === 0) {
        this.userStats.delete(userId);
        removed++;
      }
    }

    return removed;
  }
}

/**
 * Semaphore implementation for concurrency control
 * Can be used as alternative to ConcurrencyController for simpler use cases
 */
export class Semaphore {
  private permits: number;
  private queue: Array<() => void> = [];

  constructor(initialPermits: number = 1) {
    this.permits = initialPermits;
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    this.permits++;

    const next = this.queue.shift();
    if (next) {
      this.permits--;
      next();
    }
  }

  getAvailable(): number {
    return this.permits;
  }

  getQueueLength(): number {
    return this.queue.length;
  }

  setPermits(permits: number): void {
    this.permits = permits;
  }
}

/**
 * Concurrency pool for managing semaphores per user
 */
export class ConcurrencyPool {
  private semaphores: Map<string, Semaphore> = new Map();
  private tierLimits: Record<string, number> = {
    FREE: 1,
    STARTER: 3,
    PRO: 10,
    ENTERPRISE: 50,
  };

  /**
   * Get or create semaphore for user
   */
  getSemaphore(userId: string, tier: string = 'STARTER'): Semaphore {
    if (!this.semaphores.has(userId)) {
      const limit = this.tierLimits[tier] || this.tierLimits['STARTER'];
      this.semaphores.set(userId, new Semaphore(limit));
    }

    return this.semaphores.get(userId)!;
  }

  /**
   * Update tier for user
   */
  setTier(userId: string, tier: string): void {
    const semaphore = this.getSemaphore(userId, tier);
    const newLimit = this.tierLimits[tier] || this.tierLimits['STARTER'];
    semaphore.setPermits(newLimit);
  }

  /**
   * Remove user (cleanup)
   */
  removeUser(userId: string): void {
    this.semaphores.delete(userId);
  }

  /**
   * Get all users with active semaphores
   */
  getAllUsers(): string[] {
    return Array.from(this.semaphores.keys());
  }
}
