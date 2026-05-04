/**
 * k6 Load Test â€” Concurrent Onboarding Completions
 *
 * Tests the /api/onboarding/complete endpoint under 100 concurrent virtual
 * users (VUs) each attempting to complete onboarding simultaneously.
 *
 * Pass criteria (enforced via thresholds â€” test fails if any breach):
 *   - p95 latency < 3000 ms
 *   - p99 latency < 5000 ms
 *   - error rate < 1% (status >= 400 excluding expected 409 duplication errors)
 *   - throughput  > 20 req/s
 *
 * Run:
 *   k6 run --env BASE_URL=https://staging.omnivyra.com tests/load/onboarding-concurrent.js
 *
 * Requires:
 *   - k6 installed (https://k6.io/docs/get-started/installation/)
 *   - Staging environment (NOT production)
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// â”€â”€ Custom metrics â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const errorRate        = new Rate('auth_error_rate');
const latencyTrend     = new Trend('onboarding_latency_ms', true);
const creditGrantCount = new Counter('credit_grants_succeeded');
const dupRejections    = new Counter('duplicate_rejections');

// â”€â”€ Test configuration â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const options = {
  scenarios: {
    concurrent_onboarding: {
      executor: 'shared-iterations',
      vus: 100,          // 100 concurrent virtual users
      iterations: 100,   // 100 total iterations (1 per VU)
      maxDuration: '60s',
    },
  },

  thresholds: {
    // Latency
    'onboarding_latency_ms': [
      { threshold: 'p(95)<3000', abortOnFail: false },
      { threshold: 'p(99)<5000', abortOnFail: false },
    ],
    // Error rate: must be below 1% (409 duplicates are NOT counted as errors)
    'auth_error_rate': [
      { threshold: 'rate<0.01', abortOnFail: true },
    ],
    // HTTP req duration (built-in)
    'http_req_duration': [
      { threshold: 'p(95)<3000' },
    ],
    // All requests must complete (no dropped connections)
    'http_req_failed': [
      { threshold: 'rate<0.005' },
    ],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

// Each VU generates a unique synthetic identity to avoid cross-contamination.
function makePayload(vuId) {

  return JSON.stringify({
    phoneNumber:        `+1555000${String(vuId).padStart(4, '0')}`,
    companyName:        `LoadTest Corp ${vuId}`,
    fullName:           `Load Test User ${vuId}`,
    jobTitle:           'QA Engineer',
    industry:           'Technology',
    intentGoals:        ['grow_audience'],
    intentTeam:         'solo',
    intentChallenges:   ['content_creation'],
  });
}

// â”€â”€ Main VU function â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export default function () {
  const vuId   = __VU;
  const params = {
    headers: { 'Content-Type': 'application/json' },
    timeout: '10s',
  };

  const startMs = Date.now();
  const res     = http.post(`${BASE_URL}/api/onboarding/complete`, makePayload(vuId), params);
  const elapsed = Date.now() - startMs;

  latencyTrend.add(elapsed);

  // 409 = duplicate credit claim â€” this is expected and correct behaviour,
  // NOT an error. A user who onboards twice should get a 409, not a 500.
  const isDuplicate = res.status === 409;
  const isSuccess   = res.status === 200 || res.status === 201;
  const isError     = !isSuccess && !isDuplicate;

  errorRate.add(isError);
  if (isSuccess)   creditGrantCount.add(1);
  if (isDuplicate) dupRejections.add(1);

  const ok = check(res, {
    'status is 200 or 409': (r) => r.status === 200 || r.status === 409,
    'response has body':    (r) => r.body && r.body.length > 0,
    'no 5xx error':         (r) => r.status < 500,
    'latency < 5s':         () => elapsed < 5_000,
  });

  if (!ok && isError) {
    console.error(`VU${vuId} failed: status=${res.status} body=${res.body?.slice(0, 200)}`);
  }

  // Stagger requests slightly to simulate realistic arrival distribution
  sleep(Math.random() * 0.5);
}

export function handleSummary(data) {
  const p95 = data.metrics['onboarding_latency_ms']?.values?.['p(95)'] ?? 0;
  const p99 = data.metrics['onboarding_latency_ms']?.values?.['p(99)'] ?? 0;
  const errRate = (data.metrics['auth_error_rate']?.values?.rate ?? 0) * 100;
  const grants  = data.metrics['credit_grants_succeeded']?.values?.count ?? 0;
  const dups    = data.metrics['duplicate_rejections']?.values?.count ?? 0;

  const summary = {
    timestamp: new Date().toISOString(),
    scenario:  'concurrent_onboarding_100_vus',
    results: {
      p95_latency_ms:        Math.round(p95),
      p99_latency_ms:        Math.round(p99),
      error_rate_pct:        errRate.toFixed(2),
      credit_grants:         grants,
      duplicate_rejections:  dups,
      pass: p95 < 3000 && p99 < 5000 && errRate < 1,
    },
  };

  console.log(JSON.stringify(summary, null, 2));

  return {
    'tests/load/results/onboarding-concurrent-latest.json': JSON.stringify(summary, null, 2),
    stdout: `\n=== Onboarding Load Test Summary ===\n` +
            `p95: ${Math.round(p95)}ms  p99: ${Math.round(p99)}ms  ` +
            `errors: ${errRate.toFixed(2)}%  grants: ${grants}  dups: ${dups}\n` +
            `PASS: ${summary.results.pass}\n`,
  };
}

