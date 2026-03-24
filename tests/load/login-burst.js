/**
 * k6 Load Test — Login Burst
 *
 * Simulates a burst of users hitting the post-login-route API simultaneously,
 * as happens after a marketing campaign drives a spike in email link clicks.
 *
 * Stages:
 *   0 → 200 VUs over 30s  (ramp up)
 *   200 VUs for 60s        (sustained burst)
 *   200 → 0 VUs over 15s  (ramp down)
 *
 * Pass criteria:
 *   - p95 latency < 1000 ms  (routing lookup must be fast)
 *   - p99 latency < 2000 ms
 *   - error rate < 0.5%
 *   - throughput > 100 req/s during sustained phase
 *
 * Run:
 *   k6 run --env BASE_URL=https://staging.omnivyra.com tests/load/login-burst.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const errorRate    = new Rate('login_error_rate');
const latencyTrend = new Trend('login_route_latency_ms', true);

export const options = {
  stages: [
    { duration: '30s', target: 200 },  // ramp up to 200 VUs
    { duration: '60s', target: 200 },  // hold at 200 VUs
    { duration: '15s', target: 0   },  // ramp down
  ],

  thresholds: {
    'login_route_latency_ms': [
      { threshold: 'p(95)<1000', abortOnFail: false },
      { threshold: 'p(99)<2000', abortOnFail: false },
    ],
    'login_error_rate': [
      { threshold: 'rate<0.005', abortOnFail: true },
    ],
    'http_req_duration': [
      { threshold: 'p(95)<1000' },
    ],
    'http_req_failed': [
      { threshold: 'rate<0.005' },
    ],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

// In a real test: generate per-VU Firebase tokens. Here we use a shared test
// token — swap for token generation logic when running against real Firebase.
const TEST_TOKEN = __ENV.TEST_FIREBASE_TOKEN || 'MISSING_TOKEN';

export default function () {
  const params = {
    headers: {
      'Authorization': `Bearer ${TEST_TOKEN}`,
      'Content-Type':  'application/json',
    },
    timeout: '5s',
  };

  const startMs = Date.now();
  const res     = http.get(`${BASE_URL}/api/auth/post-login-route`, params);
  const elapsed = Date.now() - startMs;

  latencyTrend.add(elapsed);

  const isError = res.status >= 500;
  errorRate.add(isError);

  const ok = check(res, {
    'status 200 or 401':  (r) => r.status === 200 || r.status === 401,
    'has route in body':  (r) => {
      if (r.status !== 200) return true;  // 401 has no route field
      try { return !!JSON.parse(r.body).route; } catch { return false; }
    },
    'no 5xx':             (r) => r.status < 500,
    'latency < 2s':       () => elapsed < 2_000,
  });

  if (!ok && isError) {
    console.error(`VU${__VU} iter${__ITER}: status=${res.status}`);
  }

  sleep(0.1 + Math.random() * 0.3);  // 100-400 ms think time
}

export function handleSummary(data) {
  const p95     = data.metrics['login_route_latency_ms']?.values?.['p(95)'] ?? 0;
  const p99     = data.metrics['login_route_latency_ms']?.values?.['p(99)'] ?? 0;
  const errRate = (data.metrics['login_error_rate']?.values?.rate ?? 0) * 100;
  const rps     = data.metrics['http_reqs']?.values?.rate ?? 0;

  const summary = {
    timestamp: new Date().toISOString(),
    scenario:  'login_burst_200_vus',
    results: {
      p95_latency_ms: Math.round(p95),
      p99_latency_ms: Math.round(p99),
      error_rate_pct: errRate.toFixed(2),
      throughput_rps: Math.round(rps),
      pass: p95 < 1000 && p99 < 2000 && errRate < 0.5 && rps > 100,
    },
  };

  console.log(JSON.stringify(summary, null, 2));

  return {
    'tests/load/results/login-burst-latest.json': JSON.stringify(summary, null, 2),
    stdout: `\n=== Login Burst Summary ===\n` +
            `p95: ${Math.round(p95)}ms  p99: ${Math.round(p99)}ms  ` +
            `errors: ${errRate.toFixed(2)}%  throughput: ${Math.round(rps)} req/s\n` +
            `PASS: ${summary.results.pass}\n`,
  };
}
