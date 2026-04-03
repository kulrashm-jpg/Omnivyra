/**
 * MULTI-TENANT SHIELD: GLOBAL PROTECTION
 * 
 * System-wide caps to prevent any single user
 * from overwhelming the entire system
 */

export interface GlobalLimits {
  maxRequestsPerSecond: number;
  maxJobsPerSecond: number;
  maxConcurrentJobs: number;
  maxConcurrentRequests: number;
  circuitBreakerThreshold: number; // Error % to trigger fallback
}

export interface GlobalMetrics {
  requestsThisSec: number;
  jobsThisSec: number;
  currentConcurrentJobs: number;
  currentConcurrentRequests: number;
  recentErrors: number;
  recentErrorRate: number;
}

export class GlobalProtection {
  private metrics: GlobalMetrics = {
    requestsThisSec: 0,
    jobsThisSec: 0,
    currentConcurrentJobs: 0,
    currentConcurrentRequests: 0,
    recentErrors: 0,
    recentErrorRate: 0,
  };

  private secondCounter: number = 0;
  private errorTracker: number[] = []; // last 300 seconds

  constructor(
    private limits: GlobalLimits = {
      maxRequestsPerSecond: 10000,
      maxJobsPerSecond: 5000,
      maxConcurrentJobs: 50000,
      maxConcurrentRequests: 100000,
      circuitBreakerThreshold: 0.1, // 10% errors
    }
  ) {}

  /**
   * Check if system can accept new request
   */
  canAcceptRequest(): { allowed: boolean; reason?: string; remaining?: number } {
    // Check per-second rate
    if (this.metrics.requestsThisSec >= this.limits.maxRequestsPerSecond) {
      return {
        allowed: false,
        reason: `Rate limit exceeded: ${this.metrics.requestsThisSec}/${this.limits.maxRequestsPerSecond} req/sec`,
        remaining: 0,
      };
    }

    // Check concurrent requests
    if (this.metrics.currentConcurrentRequests >= this.limits.maxConcurrentRequests) {
      return {
        allowed: false,
        reason: `Concurrency limit exceeded: ${this.metrics.currentConcurrentRequests}/${this.limits.maxConcurrentRequests} concurrent`,
        remaining: 0,
      };
    }

    // Check if system is in circuit breaker state
    if (this.metrics.recentErrorRate > this.limits.circuitBreakerThreshold) {
      return {
        allowed: false,
        reason: `High error rate (${(this.metrics.recentErrorRate * 100).toFixed(1)}%) - circuit breaker active`,
        remaining: 0,
      };
    }

    this.metrics.requestsThisSec++;
    this.metrics.currentConcurrentRequests++;

    return {
      allowed: true,
      remaining: this.limits.maxRequestsPerSecond - this.metrics.requestsThisSec,
    };
  }

  /**
   * Check if system can accept new job
   */
  canAcceptJob(): { allowed: boolean; reason?: string; remaining?: number } {
    // Check per-second rate
    if (this.metrics.jobsThisSec >= this.limits.maxJobsPerSecond) {
      return {
        allowed: false,
        reason: `Job rate limit exceeded: ${this.metrics.jobsThisSec}/${this.limits.maxJobsPerSecond} jobs/sec`,
        remaining: 0,
      };
    }

    // Check concurrent jobs
    if (this.metrics.currentConcurrentJobs >= this.limits.maxConcurrentJobs) {
      return {
        allowed: false,
        reason: `Job concurrency limit exceeded: ${this.metrics.currentConcurrentJobs}/${this.limits.maxConcurrentJobs} concurrent`,
        remaining: 0,
      };
    }

    // Check if system is degraded (high error rate)
    if (this.metrics.recentErrorRate > this.limits.circuitBreakerThreshold) {
      return {
        allowed: false,
        reason: `High error rate - rejecting new jobs for system protection`,
        remaining: 0,
      };
    }

    this.metrics.jobsThisSec++;
    this.metrics.currentConcurrentJobs++;

    return {
      allowed: true,
      remaining: this.limits.maxJobsPerSecond - this.metrics.jobsThisSec,
    };
  }

  /**
   * Record request completion
   */
  completeRequest(errorOccurred: boolean = false) {
    this.metrics.currentConcurrentRequests--;
    if (errorOccurred) {
      this.recordError();
    }
  }

  /**
   * Record job completion
   */
  completeJob(errorOccurred: boolean = false) {
    this.metrics.currentConcurrentJobs--;
    if (errorOccurred) {
      this.recordError();
    }
  }

  /**
   * Record error and update error rate
   */
  private recordError() {
    this.metrics.recentErrors++;
    this.errorTracker.push(Date.now());

    // Keep only last 300 seconds of errors
    const cutoff = Date.now() - 300000;
    this.errorTracker = this.errorTracker.filter((t) => t > cutoff);

    // Calculate error rate
    this.calculateErrorRate();
  }

  /**
   * Calculate recent error rate (last 60 seconds)
   */
  private calculateErrorRate() {
    const now = Date.now();
    const recentWindow = now - 60000; // last 60 seconds

    const errorsInWindow = this.errorTracker.filter((t) => t > recentWindow).length;
    const requestsInWindow = this.metrics.requestsThisSec + this.metrics.jobsThisSec;

    if (requestsInWindow > 0) {
      this.metrics.recentErrorRate = errorsInWindow / requestsInWindow;
    }
  }

  /**
   * Reset per-second counters (call every second)
   */
  resetSecondCounters() {
    this.metrics.requestsThisSec = 0;
    this.metrics.jobsThisSec = 0;
    this.secondCounter++;

    // Verify circuit breaker status every 10 seconds
    if (this.secondCounter % 10 === 0) {
      this.calculateErrorRate();
    }
  }

  /**
   * Get current metrics
   */
  getMetrics(): GlobalMetrics {
    return { ...this.metrics };
  }

  /**
   * Check if circuit breaker is active
   */
  isCircuitBreakerActive(): boolean {
    return this.metrics.recentErrorRate > this.limits.circuitBreakerThreshold;
  }

  /**
   * Get system capacity remaining
   */
  getCapacityRemaining(): {
    requestCapacity: number;
    requestPercent: number;
    jobCapacity: number;
    jobPercent: number;
  } {
    return {
      requestCapacity: Math.max(0, this.limits.maxConcurrentRequests - this.metrics.currentConcurrentRequests),
      requestPercent: (this.metrics.currentConcurrentRequests / this.limits.maxConcurrentRequests) * 100,
      jobCapacity: Math.max(0, this.limits.maxConcurrentJobs - this.metrics.currentConcurrentJobs),
      jobPercent: (this.metrics.currentConcurrentJobs / this.limits.maxConcurrentJobs) * 100,
    };
  }

  /**
   * Update global limits (admin operation)
   */
  updateLimits(newLimits: Partial<GlobalLimits>) {
    this.limits = { ...this.limits, ...newLimits };
  }

  /**
   * Get current limits
   */
  getLimits(): GlobalLimits {
    return { ...this.limits };
  }

  /**
   * Check health
   */
  getHealth(): {
    status: 'HEALTHY' | 'DEGRADED' | 'CRITICAL';
    capacityPercent: number;
    errorRate: number;
    recommendations: string[];
  } {
    const capacityPercent =
      Math.max(
        this.metrics.currentConcurrentRequests / this.limits.maxConcurrentRequests,
        this.metrics.currentConcurrentJobs / this.limits.maxConcurrentJobs
      ) * 100;

    const recommendations: string[] = [];
    let status: 'HEALTHY' | 'DEGRADED' | 'CRITICAL' = 'HEALTHY';

    if (capacityPercent > 90) {
      status = 'CRITICAL';
      recommendations.push('System operating at 90%+ capacity - scale infrastructure');
    } else if (capacityPercent > 70) {
      status = 'DEGRADED';
      recommendations.push('System operating at 70%+ capacity - prepare to scale');
    }

    if (this.metrics.recentErrorRate > this.limits.circuitBreakerThreshold) {
      status = 'CRITICAL';
      recommendations.push(`Error rate (${(this.metrics.recentErrorRate * 100).toFixed(1)}%) exceeds threshold`);
    }

    if (recommendations.length === 0) {
      recommendations.push('System operating normally');
    }

    return {
      status,
      capacityPercent,
      errorRate: this.metrics.recentErrorRate,
      recommendations,
    };
  }
}

/**
 * Global Protection Manager with monitoring
 */
export interface ProtectionConfig {
  enableGlobalLimits: boolean;
  enableCBThrottle: boolean; // Circuit breaker throttling
  checkIntervalMs: number;
  alertThreshold: number; // Alert when capacity > X%
}

export class ProtectionManager {
  private globalProtection: GlobalProtection;
  private config: ProtectionConfig;
  private secondTimer: ReturnType<typeof setInterval> | null = null;
  private checkTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    limits?: GlobalLimits,
    config: ProtectionConfig = {
      enableGlobalLimits: true,
      enableCBThrottle: true,
      checkIntervalMs: 10000,
      alertThreshold: 80,
    }
  ) {
    this.globalProtection = new GlobalProtection(limits);
    this.config = config;
  }

  /**
   * Start monitoring
   */
  start(onAlert?: (message: string) => void) {
    // Reset counters every second
    this.secondTimer = setInterval(() => {
      this.globalProtection.resetSecondCounters();
    }, 1000);

    // Check health periodically
    if (onAlert) {
      this.checkTimer = setInterval(() => {
        const health = this.globalProtection.getHealth();
        const capacity = this.globalProtection.getCapacityRemaining().requestPercent;

        if (capacity > this.config.alertThreshold) {
          onAlert(`[ALERT] System capacity at ${capacity.toFixed(0)}% - ${health.recommendations[0]}`);
        }

        if (health.status === 'CRITICAL') {
          onAlert(`[CRITICAL] ${health.recommendations[0]}`);
        }
      }, this.config.checkIntervalMs);
    }
  }

  /**
   * Stop monitoring
   */
  stop() {
    if (this.secondTimer) {
      clearInterval(this.secondTimer);
    }
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
    }
  }

  /**
   * Get protection instance
   */
  getProtection(): GlobalProtection {
    return this.globalProtection;
  }
}
