/**
 * MULTI-TENANT SHIELD: COMPLETE INTEGRATION EXAMPLE
 * 
 * This example shows how all shield modules work together
 * to protect the system from multi-tenant abuse
 */

// Import all modules
// import { RateLimiter } from './rateLimiter';
// import { CreditEnforcer } from './creditEnforcer';
// import { QueuePartitioner, FairScheduler } from './queuePartitioner';
import { handleAbuseDetected } from './abuseDetector';
// import { GlobalProtection, ProtectionManager } from './globalProtection';
// import { ConcurrencyController, ConcurrencyPool, Semaphore } from './concurrencyController';

// ============================================================================
// SCENARIO 1: API REQUEST FLOW WITH COMPLETE SHIELD
// ============================================================================

export async function handleAPIRequest(
  userId: string,
  actionType: string,
  handler: () => Promise<any>,
  dependencies: {
    rateLimiter: any;
    creditEnforcer: any;
    globalProtection: any;
    abuseDetector: any;
    userTier: string;
  }
): Promise<any> {
  const { rateLimiter, creditEnforcer, globalProtection, abuseDetector, userTier } = dependencies;
  const requestId = `req-${Date.now()}-${Math.random()}`;
  const startTime = Date.now();

  try {
    // ========== STEP 1: Global Protection Check ==========
    const globalCheck = globalProtection.canAcceptRequest();
    if (!globalCheck.allowed) {
      return error(429, `System overloaded: ${globalCheck.reason}`, 30);
    }

    // ========== STEP 2: Per-User Rate Limit Check ==========
    const rateLimitResult = rateLimiter.checkLimit(userId, actionType);
    if (!rateLimitResult.allowed) {
      return error(429, `Rate limit exceeded`, rateLimitResult.retryAfter);
    }

    // ========== STEP 3: Abuse Detection ==========
    abuseDetector.recordMetric(userId, 'requestCount', 1);

    const abuseIssues = abuseDetector.detectAbuse(userId);
    if (abuseIssues.length > 0 && abuseIssues[0].severity === 'CRITICAL') {
      // Throttle user on critical abuse
      abuseDetector.throttleUser(userId, 600); // 10 minutes
      await handleAbuseDetected(userId, abuseIssues, {
        /* handlers */
      });
      return error(429, 'Request blocked due to abuse', 600);
    }

    // ========== STEP 4: Credit Enforcement ==========
    const costEstimate = estimateCost(actionType);
    const creditCheck = await creditEnforcer.reserveCredits(userId, requestId, costEstimate);
    if (!creditCheck.allowed) {
      return error(402, `Insufficient credits: need ${creditCheck.required}, have ${creditCheck.balance}`);
    }

    // ========== STEP 5: Execute Handler ==========
    const result = await handler();

    // ========== STEP 6: Charge Credits ==========
    const actualCost = calculateActualCost(actionType, result);
    await creditEnforcer.deductCredits(userId, requestId, actualCost);

    // ========== STEP 7: Record Success ==========
    const duration = Date.now() - startTime;
    globalProtection.completeRequest(false); // no error
    abuseDetector.recordMetric(userId, 'requestCount'); // already recorded

    return {
      success: true,
      data: result,
      latency: duration,
      cost: actualCost,
    };
  } catch (error) {
    // ========== ERROR HANDLING ==========
    const duration = Date.now() - startTime;
    globalProtection.completeRequest(true); // record error
    abuseDetector.recordMetric(userId, 'errorCount', 1);

    // Refund credits on error
    await creditEnforcer.refund(userId, requestId);

    return errorResponse(error, duration);
  }
}

// ============================================================================
// SCENARIO 2: QUEUE JOB SUBMISSION WITH SHIELD
// ============================================================================

export async function enqueueJob(
  userId: string,
  jobType: string,
  payload: any,
  dependencies: {
    rateLimiter: any;
    creditEnforcer: any;
    queuePartitioner: any;
    globalProtection: any;
    abuseDetector: any;
    userTier: string;
  }
): Promise<{ jobId: string; queuePosition: number }> {
  const { rateLimiter, creditEnforcer, queuePartitioner, globalProtection, abuseDetector, userTier } = dependencies;
  const jobId = `job-${Date.now()}-${Math.random()}`;

  // ========== STEP 1: Global Job Accept Check ==========
  const globalJobCheck = globalProtection.canAcceptJob();
  if (!globalJobCheck.allowed) {
    throw new Error(`Cannot accept job: ${globalJobCheck.reason}`);
  }

  // ========== STEP 2: Per-User Rate Limit (Queue Action) ==========
  const queueRateLimit = rateLimiter.checkLimit(userId, 'QUEUE');
  if (!queueRateLimit.allowed) {
    throw new Error(`Queue rate limit exceeded, retry in ${queueRateLimit.retryAfter}s`);
  }

  // ========== STEP 3: Queue Partition Check ==========
  const canEnqueue = queuePartitioner.canAcceptJob(userId);
  if (!canEnqueue) {
    throw new Error(`User queue full, too many pending jobs`);
  }

  // ========== STEP 4: Credit Reservation ==========
  const jobCost = estimateJobCost(jobType);
  const creditRes = await creditEnforcer.reserveCredits(userId, jobId, jobCost);
  if (!creditRes.allowed) {
    throw new Error(`Insufficient credits for job: have ${creditRes.balance}, need ${creditRes.required}`);
  }

  // ========== STEP 5: Abuse Detection for Queue Spam ==========
  abuseDetector.recordMetric(userId, 'requestCount', 1); // queue submission

  const abuseIssues = abuseDetector.detectAbuse(userId);
  if (abuseIssues.length > 0) {
    // Check for queue spam pattern
    const spam = abuseIssues.find(
      (i) => i.type === 'REQUEST_SPIKE' && i.severity === 'HIGH'
    );
    if (spam && abuseDetector.isThrottled(userId)) {
      throw new Error(`User throttled due to abuse`);
    }
  }

  // ========== STEP 6: Add to Partition ==========
  const partitionAdded = queuePartitioner.enqueueJob(userId, jobId, userTier);
  if (!partitionAdded) {
    // Refund credits if can't enqueue
    await creditEnforcer.refund(userId, jobId);
    throw new Error(`Failed to add job to queue`);
  }

  const partition = queuePartitioner.getPartition(userId, userTier as any);

  return {
    jobId,
    queuePosition: partition.jobCount,
  };
}

// ============================================================================
// SCENARIO 3: JOB EXECUTION WITH CONCURRENCY CONTROL
// ============================================================================

export async function executeQueuedJob(
  jobId: string,
  jobData: any,
  dependencies: {
    concurrencyController: any;
    queuePartitioner: any;
    creditEnforcer: any;
    globalProtection: any;
    abuseDetector: any;
    userTier: string;
  },
  jobHandler: () => Promise<any>
): Promise<any> {
  const { concurrencyController, queuePartitioner, creditEnforcer, globalProtection, abuseDetector, userTier } =
    dependencies;

  const userId = jobData.userId;
  const startTime = Date.now();

  try {
    // ========== STEP 1: Acquire Concurrency Slot ==========
    const canStart = concurrencyController.canStartJob(userId, userTier);
    if (!canStart.allowed) {
      console.log(
        `User ${userId} at concurrency limit (${canStart.current}/${canStart.max}), wait ${canStart.waitEstimate}ms`
      );
      return { status: 'QUEUED', waitEstimate: canStart.waitEstimate };
    }

    const slotAcquired = concurrencyController.acquireSlot(userId, jobId, userTier, 600000); // 10 min timeout
    if (!slotAcquired) {
      throw new Error('Failed to acquire concurrency slot');
    }

    // ========== STEP 2: Mark as Executing in Queue Partition ==========
    // Job already dequeued by scheduler

    // ========== STEP 3: Execute Job ==========
    const result = await jobHandler();

    // ========== STEP 4: Deduct Actual Credits ==========
    const actualCost = calculateJobActualCost(jobData.type, result);
    await creditEnforcer.deductCredits(userId, jobId, actualCost);

    // ========== STEP 5: Release Concurrency Slot ==========
    const duration = Date.now() - startTime;
    concurrencyController.releaseSlot(jobId, duration);
    queuePartitioner.completeJob(userId, jobId);

    // ========== STEP 6: Record Completion ==========
    globalProtection.completeJob(false);
    abuseDetector.recordMetric(userId, 'requestCount'); // record processing

    return {
      status: 'COMPLETED',
      result,
      duration,
      costDeducted: actualCost,
    };
  } catch (error) {
    // ========== ERROR RECOVERY ==========
    console.error(`Job ${jobId} failed:`, error);

    // Release slot
    concurrencyController.forceReleaseSlot(jobId);
    queuePartitioner.completeJob(userId, jobId);

    // Refund credits
    await creditEnforcer.refund(userId, jobId);

    // Record error
    globalProtection.completeJob(true);
    abuseDetector.recordMetric(userId, 'errorCount', 1);
    abuseDetector.recordMetric(userId, 'retryCount', 1); // if will retry

    return {
      status: 'FAILED',
      error: error.message,
      refunded: true,
    };
  }
}

// ============================================================================
// SCENARIO 4: MONITORING & HEALTH CHECK
// ============================================================================

export function getShieldHealth(dependencies: {
  rateLimiter: any;
  concurrencyController: any;
  queuePartitioner: any;
  globalProtection: any;
  abuseDetector: any;
}): {
  status: string;
  components: Record<string, any>;
  risks: string[];
} {
  const { rateLimiter, concurrencyController, queuePartitioner, globalProtection, abuseDetector } = dependencies;

  const globalHealth = globalProtection.getHealth();
  const globalMetrics = globalProtection.getMetrics();
  const globalCapacity = globalProtection.getCapacityRemaining();

  const concurrencyStats = concurrencyController.getSystemStats();
  const queueStats = queuePartitioner.getTotalStats();

  const throttledUsers = abuseDetector.getThrottledUsers();

  const risks: string[] = [];

  // Identify risks
  if (globalHealth.status === 'CRITICAL') {
    risks.push(`Global: ${globalHealth.recommendations[0]}`);
  }

  if (globalCapacity.requestPercent > 90) {
    risks.push(`Request capacity: ${globalCapacity.requestPercent.toFixed(0)}% utilized`);
  }

  if (globalMetrics.recentErrorRate > 0.1) {
    risks.push(`Error rate: ${(globalMetrics.recentErrorRate * 100).toFixed(1)}% (threshold: 10%)`);
  }

  if (queueStats.totalQueued > queueStats.totalCapacity * 2) {
    risks.push(`Queue backlog: ${queueStats.totalQueued} jobs, capacity ${queueStats.totalCapacity}`);
  }

  if (throttledUsers.size > 0) {
    risks.push(`${throttledUsers.size} users throttled due to abuse`);
  }

  return {
    status: globalHealth.status,
    components: {
      global: {
        status: globalHealth.status,
        capacity: {
          requestPercent: globalCapacity.requestPercent,
          jobPercent: globalCapacity.jobPercent,
        },
        metrics: {
          errorRate: globalMetrics.recentErrorRate,
          circuitBreakerActive: globalProtection.isCircuitBreakerActive(),
        },
      },
      concurrency: {
        totalActive: concurrencyStats.totalActive,
        totalUsers: concurrencyStats.totalUsers,
        avgPerUser: concurrencyStats.avgPerUser.toFixed(1),
        utilizationPercent: concurrencyStats.utilizationPercent.toFixed(1),
      },
      queue: {
        totalQueued: queueStats.totalQueued,
        totalExecuting: queueStats.totalExecuting,
        totalPartitions: queueStats.totalPartitions,
      },
      abuse: {
        throttledUsers: throttledUsers.size,
      },
    },
    risks,
  };
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function estimateCost(actionType: string): number {
  const costs: Record<string, number> = {
    SEARCH: 5,
    BATCH: 10,
    EXPORT: 50,
    DEFAULT: 1,
  };
  return costs[actionType] || costs.DEFAULT;
}

function calculateActualCost(actionType: string, result: any): number {
  // In real implementation, calculate based on result size/complexity
  return estimateCost(actionType);
}

function estimateJobCost(jobType: string): number {
  const costs: Record<string, number> = {
    BACKGROUND: 10,
    ANALYTICS: 5,
    EXPORT: 50,
    TRAINING: 500,
    DEFAULT: 5,
  };
  return costs[jobType] || costs.DEFAULT;
}

function calculateJobActualCost(jobType: string, result: any): number {
  // In real implementation, calculate based on actual work
  return estimateJobCost(jobType);
}

function error(code: number, message: string, retryAfter?: number) {
  return {
    success: false,
    error: { code, message, retryAfter },
  };
}

function errorResponse(error: any, duration: number) {
  return {
    success: false,
    error: error.message,
    duration,
  };
}

// ============================================================================
// EXAMPLE EXPRESS MIDDLEWARE
// ============================================================================

export function createShieldMiddleware(shieldDependencies: any) {
  return async (req: any, res: any, next: any) => {
    const userId = req.user?.id;
    const actionType = req.path.split('/')[2] || 'DEFAULT';

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Add shield context to request
    req.shield = {
      userId,
      actionType,
      requestId: `${Date.now()}-${Math.random()}`,
    };

    // Check global protection
    const globalCheck = shieldDependencies.globalProtection.canAcceptRequest();
    if (!globalCheck.allowed) {
      res.set('Retry-After', '60');
      return res.status(503).json({
        error: 'Service unavailable',
        reason: globalCheck.reason,
      });
    }

    // Check rate limits
    const rateLimitResult = shieldDependencies.rateLimiter.checkLimit(userId, actionType);
    if (!rateLimitResult.allowed) {
      res.set('X-RateLimit-Limit', rateLimitResult.limit);
      res.set('X-RateLimit-Remaining', '0');
      res.set('X-RateLimit-Reset', new Date(rateLimitResult.reset).toISOString());
      res.set('Retry-After', rateLimitResult.retryAfter.toString());

      return res.status(429).json({
        error: 'Rate limit exceeded',
        retryAfter: rateLimitResult.retryAfter,
      });
    }

    // Check abuse
    const abuseIssues = shieldDependencies.abuseDetector.detectAbuse(userId);
    if (abuseIssues.length > 0 && abuseIssues[0].severity === 'CRITICAL') {
      return res.status(429).json({
        error: 'Request blocked',
        reason: abuseIssues[0].message,
      });
    }

    // Add rate limit headers to all responses
    res.set('X-RateLimit-Limit', rateLimitResult.limit);
    res.set('X-RateLimit-Remaining', rateLimitResult.remaining);
    res.set('X-RateLimit-Reset', new Date(rateLimitResult.reset).toISOString());

    next();
  };
}
