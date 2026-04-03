/**
 * Retry Policy with Exponential Backoff + Jitter
 *
 * Prevents retry storms through:
 * 1. Exponential backoff (1ms → 2ms → 4ms → 8ms)
 * 2. Jitter (randomness to prevent thundering herd)
 * 3. Max retries limit
 * 4. Global retry budget per minute
 *
 * 🎯 PREVENT:
 * - Retry storms (all clients retrying at same time)
 * - Cascading retries (retrying retried retried calls)
 * - Resource exhaustion (too many retry attempts)
 *
 * 📊 BUDGET:
 * - Max 100 retries per minute per component
 * - Exceeding = fail-fast (give up, don't retry)
 *
 * 🔧 BACKOFF FORMULA:
 * delay = min(baseDelay * (2 ^ attempt), maxDelay) + random(0, jitter)
 * Example: attempt 1 = 10ms, attempt 2 = 20ms, attempt 3 = 40ms
 */

/**
 * Retry configuration
 */
export interface RetryConfig {
  /** Maximum number of retry attempts */
  maxRetries?: number;

  /** Base delay in ms (doubled each retry) */
  baseDelayMs?: number;

  /** Maximum delay in ms (cap exponential backup) */
  maxDelayMs?: number;

  /** Random jitter added to each delay */
  jitterMs?: number;

  /** Global max retries per minute per component */
  budgetPerMinute?: number;

  /** Name of the component (for budget tracking) */
  name: string;

  /** Retry only on specific error types */
  retryableErrors?: (error: any) => boolean;
}

/**
 * Result of a retry operation
 */
export interface RetryResult<T> {
  success: boolean;
  result?: T;
  error?: Error;
  attempts: number;
  totalDelayMs: number;
}

/**
 * Track retry budget per component
 */
interface BudgetSnapshot {
  component: string;
  retriesSinceMinuteStart: number;
  budgetRemaining: number;
  isBudgetExceeded: boolean;
}

/**
 * Retry policy with exponential backoff
 */
export class RetryPolicy {
  private config: Required<RetryConfig>;
  private retryBudgets = new Map<string, { count: number; resetTime: number }>();

  constructor(config: RetryConfig) {
    this.config = {
      maxRetries: config.maxRetries ?? 3,
      baseDelayMs: config.baseDelayMs ?? 10,
      maxDelayMs: config.maxDelayMs ?? 5000,
      jitterMs: config.jitterMs ?? 100,
      budgetPerMinute: config.budgetPerMinute ?? 100,
      name: config.name,
      retryableErrors: config.retryableErrors ?? (() => true),
    };
  }

  /**
   * Execute function with retries
   * Returns result or throws after max retries
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: Error | null = null;
    let totalDelayMs = 0;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error as Error;

        // Check if this error is retryable
        if (!this.config.retryableErrors(error)) {
          throw error;
        }

        // Last attempt, give up
        if (attempt === this.config.maxRetries) {
          break;
        }

        // Check retry budget
        if (this.isBudgetExceeded()) {
          throw new RetryBudgetExceededError(
            `Retry budget exceeded for "${this.config.name}"`,
            this.getBudgetStatus()
          );
        }

        // Calculate backoff delay
        const delay = this.calculateDelay(attempt);
        totalDelayMs += delay;

        // Wait before retry
        await this.sleep(delay);

        // Increment budget usage
        this.incrementBudget();

        // Log retry attempt
        console.warn(`[retry] Retrying "${this.config.name}" (attempt ${attempt + 1}/${this.config.maxRetries}`, {
          error: lastError.message,
          nextDelayMs: delay,
        });
      }
    }

    // All retries exhausted
    throw lastError || new Error('Unexpected: all retries exhausted but no error');
  }

  /**
   * Execute with retries and return result (not throw)
   */
  async executeWithResult<T>(fn: () => Promise<T>): Promise<RetryResult<T>> {
    let lastError: Error | null = null;
    let totalDelayMs = 0;
    let attempts = 0;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      attempts++;

      try {
        const result = await fn();
        return { success: true, result, attempts, totalDelayMs };
      } catch (error) {
        lastError = error as Error;

        if (!this.config.retryableErrors(error)) {
          return { success: false, error: lastError, attempts, totalDelayMs };
        }

        if (attempt === this.config.maxRetries) {
          break;
        }

        if (this.isBudgetExceeded()) {
          return {
            success: false,
            error: new RetryBudgetExceededError(
              `Retry budget exceeded for "${this.config.name}"`,
              this.getBudgetStatus()
            ),
            attempts,
            totalDelayMs,
          };
        }

        const delay = this.calculateDelay(attempt);
        totalDelayMs += delay;
        await this.sleep(delay);
        this.incrementBudget();
      }
    }

    return { success: false, error: lastError || new Error('Unknown error'), attempts, totalDelayMs };
  }

  /**
   * Calculate delay with exponential backoff + jitter
   * delay = min(baseDelay * (2 ^ attempt), maxDelay) + random(0, jitter)
   */
  private calculateDelay(attempt: number): number {
    const exponentialDelay = Math.min(
      this.config.baseDelayMs * Math.pow(2, attempt),
      this.config.maxDelayMs
    );

    // Add jitter
    const jitter = Math.random() * this.config.jitterMs;

    return Math.floor(exponentialDelay + jitter);
  }

  /**
   * Sleep for ms milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Check if we've exceeded retry budget
   */
  private isBudgetExceeded(): boolean {
    const budget = this.getOrInitBudget();
    return budget.count >= this.config.budgetPerMinute;
  }

  /**
   * Increment retry budget counter
   */
  private incrementBudget() {
    const budget = this.getOrInitBudget();
    budget.count++;
  }

  /**
   * Get or initialize budget for this component
   */
  private getOrInitBudget() {
    const now = Date.now();

    if (!this.retryBudgets.has(this.config.name)) {
      this.retryBudgets.set(this.config.name, { count: 0, resetTime: now + 60000 });
      return this.retryBudgets.get(this.config.name)!;
    }

    const budget = this.retryBudgets.get(this.config.name)!;

    // Reset if minute has passed
    if (now > budget.resetTime) {
      budget.count = 0;
      budget.resetTime = now + 60000;
    }

    return budget;
  }

  /**
   * Get budget status
   */
  private getBudgetStatus(): BudgetSnapshot {
    const budget = this.getOrInitBudget();
    return {
      component: this.config.name,
      retriesSinceMinuteStart: budget.count,
      budgetRemaining: Math.max(0, this.config.budgetPerMinute - budget.count),
      isBudgetExceeded: this.isBudgetExceeded(),
    };
  }

  /**
   * Get budget info for monitoring
   */
  getBudgetInfo() {
    return this.getBudgetStatus();
  }

  /**
   * Get configuration
   */
  getConfig() {
    return { ...this.config };
  }

  /**
   * Reset budget (for testing)
   */
  resetBudget() {
    this.retryBudgets.delete(this.config.name);
  }
}

/**
 * Error when retry budget exceeded
 */
export class RetryBudgetExceededError extends Error {
  constructor(
    message: string,
    public budgetStatus: BudgetSnapshot
  ) {
    super(message);
    this.name = 'RetryBudgetExceededError';
  }
}

/**
 * Holder for all retry policies
 */
const retryPolicies = new Map<string, RetryPolicy>();

/**
 * Get or create a named retry policy
 */
export function getOrCreateRetryPolicy(
  name: string,
  config?: Partial<RetryConfig>
): RetryPolicy {
  if (retryPolicies.has(name)) {
    return retryPolicies.get(name)!;
  }

  const policy = new RetryPolicy({ name, ...config });
  retryPolicies.set(name, policy);
  return policy;
}

/**
 * Get all retry policies
 */
export function getAllRetryPolicies() {
  return Array.from(retryPolicies.values()).map(p => ({
    name: p.getConfig().name,
    config: p.getConfig(),
    budget: p.getBudgetInfo(),
  }));
}

/**
 * Reset all retry budgets
 */
export function resetAllRetryBudgets() {
  retryPolicies.forEach(p => p.resetBudget());
  console.info('[retry] All retry budgets reset');
}

/**
 * Pre-configured retry policies for common operations
 */
export const CommonRetryPolicies = {
  /** Fast retries for Redis operations (short timeout) */
  redis: (name: string = 'redis') =>
    getOrCreateRetryPolicy(name, {
      maxRetries: 3,
      baseDelayMs: 10,
      maxDelayMs: 1000,
      jitterMs: 50,
      budgetPerMinute: 100,
    }),

  /** Slower retries for database operations */
  database: (name: string = 'database') =>
    getOrCreateRetryPolicy(name, {
      maxRetries: 3,
      baseDelayMs: 50,
      maxDelayMs: 5000,
      jitterMs: 100,
      budgetPerMinute: 50,
    }),

  /** Very slow retries for external APIs */
  externalApi: (name: string = 'external-api') =>
    getOrCreateRetryPolicy(name, {
      maxRetries: 5,
      baseDelayMs: 100,
      maxDelayMs: 10000,
      jitterMs: 200,
      budgetPerMinute: 30,
    }),

  /** Aggressive retries for critical operations */
  critical: (name: string = 'critical') =>
    getOrCreateRetryPolicy(name, {
      maxRetries: 5,
      baseDelayMs: 20,
      maxDelayMs: 2000,
      jitterMs: 100,
      budgetPerMinute: 200,
    }),
};
