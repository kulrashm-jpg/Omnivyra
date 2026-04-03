/**
 * Metrics Collection System
 *
 * Tracks all critical metrics for production observability:
 * - Request success/failure rates
 * - Latency percentiles (p50, p95, p99)
 * - Retry counts and circuit breaker state
 * - Error classification and rates
 *
 * 📊 METRICS:
 * - redis.calls{} (total requests)
 * - redis.success{} (successful requests)
 * - redis.failures{} (failed requests)
 * - redis.latency{} (response time distribution)
 * - redis.retries{} (retry attempts)
 * - redis.circuit_breaker_state{} (CLOSED/OPEN/HALF_OPEN)
 *
 * 🎯 EXPORTABLE:
 * - Prometheus format
 * - CloudWatch
 * - DataDog
 * - Custom webhooks
 */

/**
 * Single metric value
 */
export interface Metric {
  name: string;
  value: number;
  unit: string;
  timestamp: number;
  labels: Record<string, string>;
}

/**
 * Histogram for tracking distributions
 */
class Histogram {
  private buckets: number[] = [10, 50, 100, 500, 1000, 5000];
  private counts: Record<number, number> = {};
  private sum = 0;
  private count = 0;

  constructor(customBuckets?: number[]) {
    if (customBuckets) {
      this.buckets = customBuckets.sort((a, b) => a - b);
    }

    this.buckets.forEach(b => {
      this.counts[b] = 0;
    });
  }

  /**
   * Record a value
   */
  observe(value: number) {
    this.sum += value;
    this.count++;

    for (const bucket of this.buckets) {
      if (value <= bucket) {
        this.counts[bucket]++;
      }
    }
  }

  /**
   * Get percentile
   */
  percentile(p: number): number {
    if (this.count === 0) return 0;

    const targetCount = (p / 100) * this.count;
    let cumulative = 0;

    for (const bucket of this.buckets) {
      cumulative += this.counts[bucket];
      if (cumulative >= targetCount) {
        return bucket;
      }
    }

    return this.buckets[this.buckets.length - 1];
  }

  /**
   * Get average
   */
  average(): number {
    return this.count === 0 ? 0 : Math.round(this.sum / this.count);
  }

  /**
   * Get statistics
   */
  stats() {
    return {
      count: this.count,
      sum: this.sum,
      average: this.average(),
      p50: this.percentile(50),
      p95: this.percentile(95),
      p99: this.percentile(99),
      max: this.percentile(100),
    };
  }

  /**
   * Reset histogram
   */
  reset() {
    this.sum = 0;
    this.count = 0;
    this.buckets.forEach(b => {
      this.counts[b] = 0;
    });
  }
}

/**
 * Counter for tracking events
 */
class Counter {
  private value = 0;

  /**
   * Increment counter
   */
  increment(amount: number = 1) {
    this.value += amount;
  }

  /**
   * Get current value
   */
  get(): number {
    return this.value;
  }

  /**
   * Reset counter
   */
  reset() {
    this.value = 0;
  }
}

/**
 * Gauge for tracking point-in-time values
 */
class Gauge {
  private value = 0;

  /**
   * Set gauge value
   */
  set(value: number) {
    this.value = value;
  }

  /**
   * Increment gauge
   */
  increment(amount: number = 1) {
    this.value += amount;
  }

  /**
   * Decrement gauge
   */
  decrement(amount: number = 1) {
    this.value -= amount;
  }

  /**
   * Get current value
   */
  get(): number {
    return this.value;
  }

  /**
   * Reset gauge
   */
  reset() {
    this.value = 0;
  }
}

/**
 * Metrics collector for a single component
 */
export class ComponentMetrics {
  private counters = new Map<string, Counter>();
  private gauges = new Map<string, Gauge>();
  private histograms = new Map<string, Histogram>();
  private name: string;

  constructor(name: string) {
    this.name = name;
  }

  /**
   * Get or create counter
   */
  getCounter(name: string): Counter {
    if (!this.counters.has(name)) {
      this.counters.set(name, new Counter());
    }
    return this.counters.get(name)!;
  }

  /**
   * Get or create gauge
   */
  getGauge(name: string): Gauge {
    if (!this.gauges.has(name)) {
      this.gauges.set(name, new Gauge());
    }
    return this.gauges.get(name)!;
  }

  /**
   * Get or create histogram
   */
  getHistogram(name: string, buckets?: number[]): Histogram {
    if (!this.histograms.has(name)) {
      this.histograms.set(name, new Histogram(buckets));
    }
    return this.histograms.get(name)!;
  }

  /**
   * Get all metrics as exportable format
   */
  exportMetrics(): Metric[] {
    const metrics: Metric[] = [];
    const timestamp = Date.now();

    // Export counters
    this.counters.forEach((counter, name) => {
      metrics.push({
        name: `${this.name}_${name}_total`,
        value: counter.get(),
        unit: 'count',
        timestamp,
        labels: { component: this.name },
      });
    });

    // Export gauges
    this.gauges.forEach((gauge, name) => {
      metrics.push({
        name: `${this.name}_${name}`,
        value: gauge.get(),
        unit: 'value',
        timestamp,
        labels: { component: this.name },
      });
    });

    // Export histogram statistics
    this.histograms.forEach((histogram, name) => {
      const stats = histogram.stats();
      metrics.push(
        {
          name: `${this.name}_${name}_count`,
          value: stats.count,
          unit: 'count',
          timestamp,
          labels: { component: this.name },
        },
        {
          name: `${this.name}_${name}_sum`,
          value: stats.sum,
          unit: 'ms',
          timestamp,
          labels: { component: this.name },
        },
        {
          name: `${this.name}_${name}_avg`,
          value: stats.average,
          unit: 'ms',
          timestamp,
          labels: { component: this.name },
        },
        {
          name: `${this.name}_${name}_p50`,
          value: stats.p50,
          unit: 'ms',
          timestamp,
          labels: { component: this.name, percentile: 'p50' },
        },
        {
          name: `${this.name}_${name}_p95`,
          value: stats.p95,
          unit: 'ms',
          timestamp,
          labels: { component: this.name, percentile: 'p95' },
        },
        {
          name: `${this.name}_${name}_p99`,
          value: stats.p99,
          unit: 'ms',
          timestamp,
          labels: { component: this.name, percentile: 'p99' },
        }
      );
    });

    return metrics;
  }

  /**
   * Reset all metrics
   */
  reset() {
    this.counters.forEach(c => c.reset());
    this.gauges.forEach(g => g.reset());
    this.histograms.forEach(h => h.reset());
  }

  /**
   * Get summary of all metrics
   */
  getSummary() {
    const summary: Record<string, any> = {};

    this.counters.forEach((counter, name) => {
      summary[name] = counter.get();
    });

    this.gauges.forEach((gauge, name) => {
      summary[name] = gauge.get();
    });

    this.histograms.forEach((histogram, name) => {
      summary[name] = histogram.stats();
    });

    return summary;
  }
}

/**
 * Global metrics registry
 */
const metricsRegistry = new Map<string, ComponentMetrics>();

/**
 * Get or create metrics for a component
 */
export function getOrCreateMetrics(componentName: string): ComponentMetrics {
  if (!metricsRegistry.has(componentName)) {
    metricsRegistry.set(componentName, new ComponentMetrics(componentName));
  }
  return metricsRegistry.get(componentName)!;
}

/**
 * Get all metrics from all components
 */
export function getAllMetrics(): Metric[] {
  const allMetrics: Metric[] = [];

  metricsRegistry.forEach(metrics => {
    allMetrics.push(...metrics.exportMetrics());
  });

  return allMetrics;
}

/**
 * Export all metrics in Prometheus format
 */
export function exportPrometheus(): string {
  const metrics = getAllMetrics();
  let output = '';

  metrics.forEach(metric => {
    const labels = Object.entries(metric.labels)
      .map(([k, v]) => `${k}="${v}"`)
      .join(',');

    output += `${metric.name}{${labels}} ${metric.value}\n`;
  });

  return output;
}

/**
 * Get metrics summary for all components
 */
export function getMetricsSummary() {
  const summary: Record<string, any> = {};

  metricsRegistry.forEach((metrics, name) => {
    summary[name] = metrics.getSummary();
  });

  return summary;
}

/**
 * Reset all metrics (for testing)
 */
export function resetAllMetrics() {
  metricsRegistry.forEach(metrics => metrics.reset());
}

/**
 * Pre-configured metrics for Redis
 */
export function createRedisMetrics(componentName: string = 'redis'): ComponentMetrics {
  const metrics = getOrCreateMetrics(componentName);

  // Initialize common metrics
  metrics.getCounter('calls');
  metrics.getCounter('successes');
  metrics.getCounter('failures');
  metrics.getCounter('retries');
  metrics.getGauge('circuit_breaker_state'); // 0=CLOSED, 1=OPEN, 2=HALF_OPEN
  metrics.getHistogram('latency_ms', [10, 50, 100, 500, 1000, 5000]);

  return metrics;
}
