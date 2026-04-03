/**
 * MULTI-TENANT SHIELD: QUEUE PARTITIONER
 * 
 * Isolates user job queues to prevent:
 * - Queue saturation from single user
 * - Head-of-line blocking
 * - Unfair resource allocation
 */

export interface QueuePartition {
  userId: string;
  jobCount: number;
  maxConcurrent: number;
  priority: number;
  createdAt: number;
}

export interface SchedulingResult {
  selected: string | null; // userId to execute next
  reason: string;
  remainingUsers: number;
}

export class QueuePartitioner {
  private partitions: Map<string, QueuePartition> = new Map();
  private jobQueues: Map<string, string[]> = new Map(); // userId -> jobIds[]
  private executingJobs: Map<string, Set<string>> = new Map(); // userId -> executing jobIds

  constructor(private defaultMaxConcurrent: number = 5) {}

  /**
   * Get or create partition for a user
   */
  getPartition(userId: string, tier: 'FREE' | 'STARTER' | 'PRO' | 'ENTERPRISE' = 'STARTER'): QueuePartition {
    if (!this.partitions.has(userId)) {
      const maxConcurrent = this.getTierMaxConcurrent(tier);
      this.partitions.set(userId, {
        userId,
        jobCount: 0,
        maxConcurrent,
        priority: tier === 'ENTERPRISE' ? 10 : tier === 'PRO' ? 7 : tier === 'STARTER' ? 5 : 1,
        createdAt: Date.now(),
      });

      // Initialize job queues
      this.jobQueues.set(userId, []);
      this.executingJobs.set(userId, new Set());
    }

    return this.partitions.get(userId)!;
  }

  private getTierMaxConcurrent(tier: string): number {
    const tiers: Record<string, number> = {
      FREE: 1,
      STARTER: 3,
      PRO: 10,
      ENTERPRISE: 50,
    };
    return tiers[tier] || this.defaultMaxConcurrent;
  }

  /**
   * Add job to a user's partition
   */
  enqueueJob(userId: string, jobId: string, tier: string = 'STARTER'): boolean {
    const partition = this.getPartition(userId, tier as any);

    // Check if user would exceed reasonable queue size (abuse prevention)
    const queue = this.jobQueues.get(userId)!;
    if (queue.length >= partition.maxConcurrent * 100) {
      return false; // Queue too large, reject
    }

    queue.push(jobId);
    partition.jobCount++;

    return true;
  }

  /**
   * Select next job to execute using fair scheduling
   * Round-robin: select from user with fewest executing jobs
   */
  selectNextJob(): SchedulingResult {
    const activeUsers = Array.from(this.partitions.values())
      .filter((p) => this.jobQueues.get(p.userId)!.length > 0)
      .sort((a, b) => {
        // Sort by: executing count (ascending), then priority (descending)
        const aExecuting = this.executingJobs.get(a.userId)!.size;
        const bExecuting = this.executingJobs.get(b.userId)!.size;

        if (aExecuting !== bExecuting) {
          return aExecuting - bExecuting;
        }

        return b.priority - a.priority;
      });

    if (activeUsers.length === 0) {
      return {
        selected: null,
        reason: 'No jobs in any partition',
        remainingUsers: 0,
      };
    }

    // Select user with fewest executing jobs (fair round-robin)
    const selectedUser = activeUsers[0];

    // Check if user can run more jobs
    const executing = this.executingJobs.get(selectedUser.userId)!.size;
    if (executing >= selectedUser.maxConcurrent) {
      return {
        selected: null,
        reason: `User ${selectedUser.userId} at max concurrent (${executing}/${selectedUser.maxConcurrent})`,
        remainingUsers: activeUsers.length - 1,
      };
    }

    // Get next job from this user
    const jobQueue = this.jobQueues.get(selectedUser.userId)!;
    const nextJobId = jobQueue.shift();

    if (nextJobId) {
      this.executingJobs.get(selectedUser.userId)!.add(nextJobId);
      selectedUser.jobCount--;

      return {
        selected: selectedUser.userId,
        reason: `Selected user with ${executing} executing jobs (priority ${selectedUser.priority})`,
        remainingUsers: activeUsers.length,
      };
    }

    return {
      selected: null,
      reason: 'Job queue empty after dequeue',
      remainingUsers: activeUsers.length - 1,
    };
  }

  /**
   * Mark job as completed
   */
  completeJob(userId: string, jobId: string): boolean {
    const executing = this.executingJobs.get(userId);
    if (!executing || !executing.has(jobId)) {
      return false;
    }

    executing.delete(jobId);
    return true;
  }

  /**
   * Get partition stats
   */
  getPartitionStats(userId: string): {
    queued: number;
    executing: number;
    total: number;
    maxConcurrent: number;
    utilizationPercent: number;
  } | null {
    const partition = this.partitions.get(userId);
    if (!partition) {
      return null;
    }

    const queued = this.jobQueues.get(userId)?.length || 0;
    const executing = this.executingJobs.get(userId)?.size || 0;
    const total = queued + executing;

    return {
      queued,
      executing,
      total,
      maxConcurrent: partition.maxConcurrent,
      utilizationPercent: (executing / partition.maxConcurrent) * 100,
    };
  }

  /**
   * Get all partitions stats (for monitoring dashboard)
   */
  getAllPartitionStats(): Record<
    string,
    {
      queued: number;
      executing: number;
      total: number;
      maxConcurrent: number;
      utilizationPercent: number;
      priority: number;
    }
  > {
    const stats: Record<string, any> = {};

    for (const [userId, partition] of this.partitions) {
      const queued = this.jobQueues.get(userId)?.length || 0;
      const executing = this.executingJobs.get(userId)?.size || 0;
      const total = queued + executing;

      stats[userId] = {
        queued,
        executing,
        total,
        maxConcurrent: partition.maxConcurrent,
        utilizationPercent: (executing / partition.maxConcurrent) * 100,
        priority: partition.priority,
      };
    }

    return stats;
  }

  /**
   * Prevent queue saturation: check if accepting job would exceed limits
   */
  canAcceptJob(userId: string): boolean {
    const partition = this.partitions.get(userId);
    if (!partition) {
      return true; // New user, can accept
    }

    const queue = this.jobQueues.get(userId)!;
    const maxQueueSize = partition.maxConcurrent * 100;

    return queue.length < maxQueueSize;
  }

  /**
   * Increase concurrency for tier promotion
   */
  updateTier(userId: string, newTier: string): boolean {
    const partition = this.partitions.get(userId);
    if (!partition) {
      return false;
    }

    const newMaxConcurrent = this.getTierMaxConcurrent(newTier);
    const newPriority = newTier === 'ENTERPRISE' ? 10 : newTier === 'PRO' ? 7 : newTier === 'STARTER' ? 5 : 1;

    partition.maxConcurrent = newMaxConcurrent;
    partition.priority = newPriority;

    return true;
  }

  /**
   * Clear a user's partition (admin operation)
   */
  clearPartition(userId: string): number {
    const queue = this.jobQueues.get(userId);
    const count = queue?.length || 0;

    this.jobQueues.set(userId, []);
    this.executingJobs.get(userId)?.clear();

    return count;
  }

  /**
   * Remove idle partitions (memory management)
   */
  cleanupIdlePartitions(idleMinutes: number = 60): number {
    const cutoff = Date.now() - idleMinutes * 60000;
    let removed = 0;

    for (const [userId, _] of this.partitions) {
      const queue = this.jobQueues.get(userId)!;
      const executing = this.executingJobs.get(userId)!;

      if (queue.length === 0 && executing.size === 0) {
        this.partitions.delete(userId);
        this.jobQueues.delete(userId);
        this.executingJobs.delete(userId);
        removed++;
      }
    }

    return removed;
  }

  /**
   * Get total stats
   */
  getTotalStats(): {
    totalPartitions: number;
    totalQueued: number;
    totalExecuting: number;
    totalCapacity: number;
  } {
    let totalQueued = 0;
    let totalExecuting = 0;
    let totalCapacity = 0;

    for (const [userId, partition] of this.partitions) {
      totalQueued += this.jobQueues.get(userId)?.length || 0;
      totalExecuting += this.executingJobs.get(userId)?.size || 0;
      totalCapacity += partition.maxConcurrent;
    }

    return {
      totalPartitions: this.partitions.size,
      totalQueued,
      totalExecuting,
      totalCapacity,
    };
  }
}

/**
 * Fair Scheduler: prevent starvation using weighted round-robin
 */
export class FairScheduler {
  constructor(private partitioner: QueuePartitioner, private interval: number = 5000) {}

  /**
   * Start fair scheduling loop
   */
  start(onJobSelected: (userId: string, jobId: string) => Promise<void>): ReturnType<typeof setInterval> {
    return setInterval(async () => {
      const result = this.partitioner.selectNextJob();

      if (result.selected) {
        // In real implementation, fetch actual jobId from queue
        // For now, just select from partition
        const queue = (this.partitioner as any).jobQueues.get(result.selected);
        if (queue && queue.length > 0) {
          const jobId = queue[0]; // Job already dequeued
          try {
            await onJobSelected(result.selected, jobId);
          } catch (error) {
            console.error(`Error processing job ${jobId} for user ${result.selected}:`, error);
            // Mark job as failed or retry
          }
        }
      }
    }, this.interval);
  }

  /**
   * Stop scheduler
   */
  stop(timerId: ReturnType<typeof setInterval>) {
    clearInterval(timerId);
  }
}
