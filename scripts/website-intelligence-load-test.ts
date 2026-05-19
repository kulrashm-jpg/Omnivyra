type Scenario = {
  name: string;
  events: number;
  concurrency: number;
  expectedMaxLagSeconds: number;
  expectedP95IngestionMs: number;
};

const scenarios: Scenario[] = [
  { name: 'tracking_burst_small', events: 1000, concurrency: 10, expectedMaxLagSeconds: 60, expectedP95IngestionMs: 750 },
  { name: 'plugin_sync_batch', events: 500, concurrency: 5, expectedMaxLagSeconds: 120, expectedP95IngestionMs: 1000 },
  { name: 'dashboard_aggregation', events: 100, concurrency: 8, expectedMaxLagSeconds: 90, expectedP95IngestionMs: 1200 },
  { name: 'reconciliation_queue', events: 250, concurrency: 4, expectedMaxLagSeconds: 180, expectedP95IngestionMs: 1500 },
];

async function main() {
  const dryRun = process.argv.includes('--dry-run') || !process.env.WI_LOAD_TARGET_URL;
  const results = [];
  for (const scenario of scenarios) {
    if (dryRun) {
      results.push({ ...scenario, mode: 'dry-run', ok: true, measured: null });
      continue;
    }
    const measured = await runHttpScenario(scenario);
    results.push({
      ...scenario,
      mode: 'http',
      measured,
      ok: measured.p95Ms <= scenario.expectedP95IngestionMs && measured.errorRate <= 0.01,
    });
  }
  const failed = results.filter((result) => !result.ok);
  console.log(JSON.stringify({ ok: failed.length === 0, dryRun, thresholds: scenarios, results }, null, 2));
  if (failed.length) process.exitCode = 1;
}

async function runHttpScenario(scenario: Scenario) {
  const target = process.env.WI_LOAD_TARGET_URL!;
  const websiteId = process.env.WI_LOAD_WEBSITE_ID || 'load-test-website';
  const latencies: number[] = [];
  let errors = 0;
  const batches = Array.from({ length: Math.ceil(scenario.events / scenario.concurrency) });
  for (const _ of batches) {
    await Promise.all(Array.from({ length: scenario.concurrency }).map(async () => {
      const started = Date.now();
      const res = await fetch(`${target.replace(/\/$/, '')}/api/website-events/track`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          website_id: websiteId,
          anonymous_id: `load-${Math.random().toString(36).slice(2)}`,
          event_name: 'page_view',
          current_page: 'https://load.test/',
        }),
      }).catch(() => null);
      latencies.push(Date.now() - started);
      if (!res?.ok) errors += 1;
    }));
  }
  latencies.sort((a, b) => a - b);
  return {
    p50Ms: percentile(latencies, 0.5),
    p95Ms: percentile(latencies, 0.95),
    p99Ms: percentile(latencies, 0.99),
    errorRate: errors / Math.max(1, latencies.length),
    requests: latencies.length,
  };
}

function percentile(values: number[], p: number) {
  return values[Math.min(values.length - 1, Math.floor(values.length * p))] ?? 0;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

export {};
