# Production Alerting Rules

**System:** Multi-Tenant Shield + Resilience Layer  
**Severity Levels:** Critical (page SRE), Warning (Slack), Info (log only)  
**Evaluation Window:** 1 minute (check every 10 seconds)  

---

## 🚨 CRITICAL ALERTS (Page SRE immediately)

### ALERT-001: Circuit Breaker Open
**Severity:** CRITICAL  
**Duration:** 1 minute

**Condition:**
```promql
circuit_breaker_state{breaker=~"rate_limiter|queue|credit"} == 1
AND on() time() - circuit_breaker_opened_time > 60
```

**Thresholds:**
- 🔴 Open for > 1 minute → Page SRE
- Yellow: Open for 30-60 seconds → Slack alert

**What it means:**
- System has triggered failure protection
- Requests are being rejected
- Active incident in progress

**Label/Annotation:**
```yaml
alert: CircuitBreakerOpen
severity: critical
breaker: "{{ $labels.breaker }}"
message: "{{ $labels.breaker }} circuit breaker is OPEN, rejecting requests"
runbook_url: /runbooks/circuit-breaker-open
```

---

### ALERT-002: P99 Latency Critical
**Severity:** CRITICAL  
**Duration:** 2 minutes

**Condition:**
```promql
histogram_quantile(0.99, rate(request_duration_seconds_bucket[5m])) > 1.0
```

**Thresholds:**
- 🟢 < 200ms (healthy)
- 🟡 200-500ms (warning, 2m threshold)
- 🔴 > 500ms (1m threshold)
- 🔴🔴 > 1000ms (critical, page immediately)

**For Loop Alert:**
```yaml
alert: P99LatencyCritical
expr: histogram_quantile(0.99, rate(request_duration_seconds_bucket[5m])) > 1.0
for: 2m
severity: critical
message: "P99 latency {{ $value }}ms, expected < 200ms"
```

**Root Causes:**
1. Redis overload (check Redis latency panel)
2. Database slow queries
3. Downstream service timeout
4. CPU/memory exhaustion on app servers

---

### ALERT-003: Error Rate Spike
**Severity:** CRITICAL  
**Duration:** 1 minute

**Condition:**
```promql
rate(requests_failed_total[1m]) / rate(requests_total[1m]) > 0.05
AND on() rate(requests_total[1m]) > 100
```

**Thresholds:**
- 🟢 < 0.5% failure rate (healthy)
- 🟡 0.5-2% (warning, investigate)
- 🔴 > 2% error rate (page SRE)

**Additional Condition:**
```
Only trigger if request rate > 100 req/sec (filter noise)
Require sustained error for 1+ minute
```

**Label:**
```yaml
alert: ErrorRateSpike
severity: critical
error_type: "{{ $labels.status }}"
message: "Error rate spiked to {{ $value }}%, normal < 0.5%"
runbook_url: /runbooks/error-rate-spike
```

---

### ALERT-004: Redis Unavailable
**Severity:** CRITICAL  
**Duration:** 30 seconds

**Conditions:**
```promql
# Redis connection failures
redis_connection_errors_total > 10

# OR: Redis command latency critical
histogram_quantile(0.99, rate(redis_command_duration_seconds_bucket[1m])) > 1.0

# OR: Redis memory usage critical
redis_memory_used_bytes / redis_memory_limit_bytes > 0.95
```

**What it means:**
- Rate limiting cannot work (no token bucket state)
- Queue cannot persist jobs
- Circuit breaker state lost
- **System becomes unsafe** - requests might overload

**Label:**
```yaml
alert: RedisUnavailable
severity: critical
instance: "{{ $labels.instance }}"
message: "Redis unavailable on {{ $labels.instance }}, system protection disabled"
```

---

### ALERT-005: Single User Exceeds Fair Share
**Severity:** CRITICAL  
**Duration:** 3 minutes

**Condition:**
```promql
# If one user is getting > 50% of all requests
topk(1, sum(rate(requests_total{user_id=~".+"}[5m])) by (user_id)) 
/ on() sum(rate(requests_total[5m])) > 0.5
```

**Thresholds:**
- 🟢 < 30% for one user (acceptable)
- 🟡 30-50% (warning, unfair allocation)
- 🔴 > 50% (one user monopolized, critical)

**Label:**
```yaml
alert: SingleUserMonopoly
severity: critical
user_id: "{{ $labels.user_id }}"
message: "User {{ $labels.user_id }} consuming {{ $value }}% of system capacity"
runbook_url: /runbooks/user-monopoly
```

---

## ⚠️ WARNING ALERTS (Slack notification)

### ALERT-W001: High P99 Latency
**Severity:** WARNING  
**Duration:** 2 minutes

**Condition:**
```promql
histogram_quantile(0.99, rate(request_duration_seconds_bucket[5m])) > 0.5
AND on() rate(requests_total[1m]) > 100
```

**Escalation Path:**
```
🟡 2 min sustained → Slack #alerts
🟠 4 min sustained → Slack @oncall
🔴 5+ min → Promote to Critical Alert
```

**Context to include in Slack:**
- Current P99 latency
- Link to latency graph
- Top services by latency
- Recommended action: Check Redis, DB, downstream services

---

### ALERT-W002: Retry Rate Elevated
**Severity:** WARNING  
**Duration:** 2 minutes

**Condition:**
```promql
(rate(retry_attempts_total[1m]) / rate(requests_total[1m])) > 0.10
```

**Thresholds:**
- 🟢 < 2% retry rate (normal)
- 🟡 2-5% (yellow, watch)
- 🔴 5-10% (red, warning)
- 🔴🔴 > 10% (critical)

**Interpretation:**
- 2-5%: Transient failures, expected occasionally
- 5-10%: Something wrong, clients are retrying
- >10%: System has serious issue, customer impact

**Auto-Resolution:**
```
If retry rate drops below 2% for 5 minutes, resolve automatically
```

---

### ALERT-W003: Queue Depth Rising
**Severity:** WARNING  
**Duration:** 3 minutes

**Condition:**
```promql
queue_depth_total > 1000
AND deriv(queue_depth_total[5m]) > 10
```

**Breakdown:**
```
queue_depth > 1000 jobs (warning threshold)
AND queue growing 10+ jobs/sec (trending worse)
```

**What it means:**
- Jobs are piling up
- Processing rate < enqueue rate
- Users will experience delays

**Action:**
- Check job processing rate
- Look for long-running jobs blocking queue
- Consider scaling job workers

---

### ALERT-W004: Abuse Detections Elevated
**Severity:** WARNING  
**Duration:** 1 minute

**Condition:**
```promql
rate(abuse_detections_total[1m]) > 5
```

**Thresholds:**
- 🟢 0-2 detections/min (normal)
- 🟡 2-5 detections/min (watch, might be false positives)
- 🔴 > 5 detections/min (probable coordinated attack)

**Context in Alert:**
- Number of unique users flagged
- Primary detection types
- Top flagged users by frequency
- Link to abuse pattern details

---

### ALERT-W005: Credit Ledger Discrepancy
**Severity:** WARNING (→ CRITICAL if > 1000 credits)  
**Duration:** 1 minute

**Condition:**
```promql
abs(credit_ledger_discrepancy_total) > 0
```

**Thresholds:**
- 0 discrepancies (healthy)
- 1-100 credits (warning, investigate)
- 100-1000 credits (warning, urgent)
- > 1000 credits (critical, financial impact)

**Auto-Remediation:**
```
1. Check pending refunds (might be accounting for unprocessed refunds)
2. Verify last successful audit time
3. Run ad-hoc reconciliation

If discrepancy > 100 credits:
- Page SRE immediately
- Block new credit charges until resolved
```

---

### ALERT-W006: Single User Throttling Rate High
**Severity:** WARNING  
**Duration:** 2 minutes

**Condition:**
```promql
# For high-volume users
rate(requests_throttled_total{user_id=~".+"}[5m]) > 100
AND rate(requests_total{user_id=~".+"}[5m]) > 1000
```

**Per-Tier Thresholds:**
| Tier | Alert if Throttled | Reason |
|------|-------------------|--------|
| FREE | > 50% | Aggressive usage |
| STARTER | > 30% | Exceeding tier limit |
| PRO | > 10% | Abuse detected |

**Label:**
```yaml
alert: UserThrottleRateHigh
severity: warning
user_id: "{{ $labels.user_id }}"
message: "User {{ $labels.user_id }} throttled at {{ $value }}%"
```

---

### ALERT-W007: Concurrency Limit Saturation
**Severity:** WARNING  
**Duration:** 3 minutes

**Condition:**
```promql
# Per-tier concurrency usage > 80%
(active_concurrent_jobs{tier="FREE"} / 1) > 0.8
OR (active_concurrent_jobs{tier="STARTER"} / 3) > 0.8
OR (active_concurrent_jobs{tier="PRO"} / 10) > 0.8
```

**Action:**
- Check queue depth for that tier
- Look for jobs stuck in processing
- Might need to scale job workers

---

### ALERT-W008: Redis Latency Elevated
**Severity:** WARNING  
**Duration:** 1 minute

**Condition:**
```promql
histogram_quantile(0.95, rate(redis_command_duration_seconds_bucket[1m])) > 0.05
```

**Thresholds:**
- 🟢 < 5ms p95 (healthy)
- 🟡 5-20ms p95 (warning)
- 🔴 20-50ms p95 (critical monitoring)
- 🔴🔴 > 50ms (critical alert)

**Root Causes:**
- Redis memory pressure (evictions)
- Network latency
- Large values in Redis (string size)
- Too many keys (O(n) operations)

---

### ALERT-W009: Fairness Score Degrading
**Severity:** WARNING  
**Duration:** 5 minutes

**Condition:**
```promql
fairness_gini_coefficient > 0.3
```

**Thresholds:**
- 🟢 0.0-0.20 (excellent, perfectly fair)
- 🟡 0.20-0.30 (good, acceptable)
- 🔴 > 0.30 (poor, one user dominating)

**Action:**
- Check top 5 users by request volume
- Look for fairness violations
- Might need stricter per-user limits

---

## 📋 INFO ALERTS (Log only, no notification)

### ALERT-INFO-001: Scheduled Maintenance Window
```yaml
alert: MaintenanceWindow
when: deployment_in_progress == true
message: "Deployment in progress, ignoring transient alerts"
```

### ALERT-INFO-002: Refund Processed
```yaml
alert: RefundProcessed
expr: rate(refund_events_total{status="completed"}[1m]) > 0
message: "{{ $value }} refunds processed in past minute"
```

### ALERT-INFO-003: Circuit Breaker Recovery
```yaml
alert: CircuitBreakerRecovered
expr: circuit_breaker_state == 0 AND circuit_breaker_was_open
message: "{{ $labels.breaker }} circuit breaker recovered"
```

---

## ALERT ROUTING RULES

### Alert Routing Table

| Alert | Severity | Slack Channel | Page SRE | On-Call |
|-------|----------|---------------|---------|---------|
| Circuit Breaker Open | CRITICAL | #critical | YES | YES |
| P99 Latency > 1s | CRITICAL | #critical | YES | YES |
| Error Rate > 2% | CRITICAL | #critical | YES | YES |
| Redis Unavailable | CRITICAL | #critical | YES | YES |
| Single User Monopoly | CRITICAL | #critical | YES | YES |
| High P99 Latency | WARNING | #alerts | NO | NO |
| Retry Rate Elevated | WARNING | #alerts | NO | NO |
| Queue Depth Rising | WARNING | #alerts | NO | NO |
| Abuse Detections Up | WARNING | #alerts | NO | NO |
| Credit Discrepancy | WARNING | #alerts | YES* | YES* |
| User Throttle High | WARNING | #alerts | NO | NO |
| Concurrency Saturation | WARNING | #alerts | NO | NO |

*Credit discrepancy > 1000 credits becomes CRITICAL

---

## ALERT SUPPRESSION RULES

### During Deployments
```yaml
suppression:
  - alert: "*"
    labels:
      deployment_in_progress: "true"
    duration: 30m
```

### Scheduled Maintenance
```yaml
suppression:
  - alert: "RedisLatency*"
    labels:
      maintenance_window: "redis_maintenance"
    duration: 2h
```

### Graceful Shutdown
```yaml
suppression:
  - alert: "*"
    when: pod_termination_grace_period_active
    duration: 3m
```

---

## ALERT THRESHOLDS BASELINE

**Baseline Period:** First 2 weeks of production

Thresholds are set conservatively at first, then tuned based on:
- 99th percentile of normal behavior + 2σ
- Business requirements (fairness, SLA)
- Resource capacity

**Weekly Threshold Review:**
- Check false positive rate
- Verify threshold relevance
- Adjust for seasonal patterns

---

## NOTIFICATION INTEGRATION

### Slack (using Alertmanager)
```
Channel: #critical-alerts
Format: [CRITICAL] Circuit Breaker Open - rate_limiter
         Status: Firing (since 2 min 34 sec ago)
         Value: Open
         Link: https://dashboard/alert/circuit-breaker
         Runbook: https://runbooks/circuit-breaker-open
```

### PagerDuty (for Critical alerts)
```
Service: Multi-Tenant Shield Production
Incident: Circuit Breaker Open
Severity: Critical
URL: https://dashboard/alert/circuit-breaker
Auto-resolve after: 1 hour if resolved
```

### Email (Daily Digest)
```
To: sre-team@company.com
Subject: Multi-Tenant Shield - Daily Alert Summary
Content:
- Critical alerts: 2
- Warning alerts: 14
- Resolved alerts: 8
- Mean time to resolution: 4m 23s
```

---

## ALERT CONFIGURATION (Prometheus)

```yaml
groups:
- name: multitenant_shield_critical
  interval: 10s
  rules:

  - alert: CircuitBreakerOpen
    expr: |
      circuit_breaker_state{breaker=~"rate_limiter|queue|credit"} == 1
      AND time() - circuit_breaker_opened_time > 60
    for: 1m
    annotations:
      summary: "{{ $labels.breaker }} circuit breaker is OPEN"
      description: "Circuit breaker has been open for {{ $value }}s, rejecting requests"
      runbook: "https://internal-wiki/runbooks/circuit-breaker-open"

  - alert: P99LatencyCritical
    expr: histogram_quantile(0.99, rate(request_duration_seconds_bucket[5m])) > 1.0
    for: 2m
    annotations:
      summary: "P99 latency is {{ $value }}ms"
      runbook: "https://internal-wiki/runbooks/p99-latency-spike"

  - alert: ErrorRateSpike
    expr: |
      (rate(requests_failed_total[1m]) / rate(requests_total[1m])) > 0.05
      AND rate(requests_total[1m]) > 100
    for: 1m
    annotations:
      summary: "Error rate spiked to {{ $value | humanizePercentage }}"
      runbook: "https://internal-wiki/runbooks/error-rate-spike"

# ... more rules
```

---

## ALERT TESTING

### Test Circuit Breaker Alert
```bash
# Manually set circuit breaker open
redis-cli SET circuit_breaker:rate_limiter 1
redis-cli EXPIRE circuit_breaker:rate_limiter 300

# Wait for 1 minute
# Alert should fire

# Clean up
redis-cli DEL circuit_breaker:rate_limiter
```

### Test Latency Alert
```bash
# Simulate slow database
# Set query_timeout to very low value
# Check Prometheus for histogram spike
# Alert should fire after 2 minutes
```

### Test Error Rate
```bash
# Point requests to error endpoint
# Monitor error_requests_total counter
# Alert should fire after 1 minute when error rate > 5%
```

---

**Alerting Rules Status:** Ready for production  
**Last Updated:** Production deployment  
**Owner:** SRE Team
