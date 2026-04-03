# RESILIENCE SYSTEM DEPLOYMENT - QUICK REFERENCE CARD

**Print this card and keep visible during entire 24-hour deployment**

---

## PHASE TIMELINE

```
┌─ PHASE 1 ─────────── T+0 to T+2h ─────────────┐
│ Light Traffic (5-10%)                         │
│ ✅ Pass: Health OK, Circuit CLOSED            │
│ ❌ Fail: ROLLBACK                             │
└────────────────────────────────────────────────┘
         ↓
┌─ PHASE 2 ────────── T+2h to T+12h ────────────┐
│ Moderate (25%→50%→75%)                        │
│ ✅ Pass: p99<200ms, retries<50/min            │
│ ❌ Fail: ROLLBACK or EXTEND                   │
└────────────────────────────────────────────────┘
         ↓
┌─ PHASE 3 ────────── T+12h to T+24h ───────────┐
│ Sustained Load (100%)                         │
│ ✅ Pass: p99 stable, memory<50MB/hr → APPROVED
│ ❌ Fail: ROLLBACK                             │
└────────────────────────────────────────────────┘
```

---

## CRITICAL METRICS TO WATCH

| Metric | Target | RED FLAG | Check Every |
|--------|--------|----------|-------------|
| **p99 Latency** | <100ms (P1), <200ms (P2), 60-65ms (P3) | >300ms | 5 min |
| **Success Rate** | ≥99% | <95% | 10 min |
| **Circuit Breaker** | CLOSED (normal) | OPEN >120s | 5 min |
| **Retry Rate** | <50/min | >100/min | 10 min |
| **Memory Growth** | <50MB/hr | >100MB/hr | 30 min |
| **Incidents** | Zero critical | Any page | Real-time |

---

## DECISION RULES

### Phase 1 (0-2h)
```
✅ All 6 criteria PASS → Phase 2
❌ ANY criteria FAIL → ROLLBACK
```

### Phase 2 (2-12h)
```
✅ All 7 criteria PASS → Phase 3
⚠️  6/7 PASS → EXTEND Phase 2
❌ ≤5 PASS → ROLLBACK
```

### Phase 3 (12-24h)
```
✅ All 6 criteria PASS → APPROVED 🎉
⚠️  5/6 PASS, no incidents → CONDITIONAL
❌ ANY critical incident → ROLLBACK
```

---

## INSTANT ROLLBACK COMMAND

```bash
git revert HEAD
npm run build
npm start
# When app says "Server running on port 3000":
curl http://localhost:3000/api/health
# Should return status 200
```

**Time to execute**: < 5 minutes

---

## ESCALATION MATRIX

| Situation | Action | Contact |
|-----------|--------|---------|
| p99 latency >300ms for 5+ min | INVESTIGATE | Tech Lead |
| Memory growth >100MB/hr confirmed | ROLLBACK | Tech Lead or VP Eng |
| Circuit breaker stuck OPEN >120s | ROLLBACK | Tech Lead or VP Eng |
| Retry storm (>300/min) detected | ROLLBACK | Tech Lead or VP Eng |
| Production incident (PagerDuty) | ASSESS | On-Call → Tech Lead |
| Unsure about decision | PAUSE & ESCALATE | Tech Lead or VP Eng |

**RULE**: When in doubt, rollback immediately.

---

## MONITORING COMMANDS

### Start Phase 1
```bash
node scripts/staged-validation-monitor.js --phase 1
```

### Start Phase 2
```bash
node scripts/staged-validation-monitor.js --phase 2 --interval 30s
```

### Start Phase 3
```bash
node scripts/staged-validation-monitor.js --phase 3 --interval 10s --deep-metrics
```

### Manual Health Check
```bash
curl http://localhost:3000/api/health/resilience
# Look for: "circuitBreaker":{"state":"CLOSED"}
```

---

## SLACK MESSAGES TO SEND

### Phase 1 Complete
```
✅ Phase 1 (0-2h) PASSED
- All systems healthy
- Circuit: CLOSED
- Increasing to Phase 2 (50% traffic)
- Next update in 1 hour
```

### Phase 2 Complete
```
✅ Phase 2 (2-12h) PASSED
- Performance stable under moderate load
- p99 latency: ____ ms
- Moving to Phase 3 (100% traffic)
- Final 12h validation starting
```

### Phase 3 APPROVED
```
🎉 COMPLETE: 24-hour validation PASSED
- System stable at 100% traffic
- p99 latency: 60-65ms (stable)
- Memory: <50MB/hr growth
- Zero critical incidents
- ✅ PRODUCTION READY
```

### ROLLBACK
```
⚠️  ROLLBACK INITIATED
- Reason: [specific issue]
- Previous version now live
- ETA to investigate: [time]
- Questions? #incidents
```

---

## WHAT EACH PERSON SHOULD DO

### SRE/DevOps
- [ ] Execute deployment at T+0
- [ ] Run monitoring script
- [ ] Watch metrics every 15 min
- [ ] Report status to team
- [ ] Execute rollback if ordered

### Tech Lead
- [ ] Review Phase 1 results at T+2h
- [ ] Make Phase 2→3 decision at T+12h
- [ ] Make final go/no-go at T+24h
- [ ] Authority to approve/reject rollback

### On-Call Engineer
- [ ] Monitor PagerDuty for incidents
- [ ] Check Slack #incidents every 30 min
- [ ] Escalate anything unusual
- [ ] Ready to page VP Eng if critical

### VP Engineering
- [ ] Review Phase 3 sign-off at T+24h
- [ ] Final approval for production
- [ ] Authority for major decisions
- [ ] Available for escalations

---

## PANIC GUIDE

### "API is down (500 errors everywhere)"
1. Check: Is app process running? `ps aux | grep node`
2. If no: Restart → `npm start`
3. If still 500: Check logs → `tail -50 logs/resilience.log`
4. If errors visible: Look for "ERROR" or "CRITICAL"
5. Don't know? → `ROLLBACK IMMEDIATELY`

### "p99 latency suddenly 500ms"
1. Check: Is traffic spiking? (Should be gradual)
2. Check: Is memory growing fast?
3. If yes to memory: `ROLLBACK IMMEDIATELY` (leak)
4. If no: Wait 5 minutes, re-measure
5. Still >300ms after 5 min? → Escalate to Tech Lead

### "Circuit breaker says OPEN"
1. Is it from Phase 1 startup? Wait 30 sec, recheck
2. Is it T+5min into Phase 1 and still OPEN? → `ROLLBACK`
3. Is it during Phase 2 or 3? (Normal if Redis/DB is down)
4. Wait 60-90 seconds for recovery
5. If >120 sec without recovery? → `ROLLBACK`

### "Memory jumped 100MB in 1 minute"
1. That's not normal
2. Could be GC cleanup (check logs for "GC Major")
3. If not GC: Likely a leak
4. `ROLLBACK IMMEDIATELY` and investigate

---

## HOT KEYS (For Quick Slack Messages)

**Prefix messages with emoji for visibility**:
- ✅ = Good, passing
- ❌ = Problem, failing
- ⚠️  = Warning, investigate
- 🚀 = Deployment proceeding
- 🛑 = Rollback happening

Example:
```
✅ Phase 1 passed all 6 criteria
⚠️  p99 latency rising, monitoring closely
🛑 ROLLBACK initiated: memory leak detected
```

---

## CONTACT REFERENCE

**Paste in Slack #incidents channel pinned message**:

```
🚨 DEPLOYMENT CONTACTS

Tech Lead: [Name] [Phone]
SRE/DevOps: [Name] [Phone]
On-Call: [Name] [Phone]
VP Engineering: [Name] [Phone]

Questions? Reply in thread.
```

---

## COMMON METRICS CHECKLIST

### Every 15 minutes during Phase 1
- [ ] Health endpoint responding
- [ ] p99 latency <100ms
- [ ] Circuit breaker = CLOSED
- [ ] Error rate = 0%
- [ ] Memory stable

### Every 30 minutes during Phase 2
- [ ] p99 latency <200ms
- [ ] Success rate ≥99%
- [ ] Retry rate <50/min
- [ ] Memory growing <5MB/min
- [ ] Circuit breaker responding

### Every 60 minutes during Phase 3
- [ ] p99 latency 60-65ms (flat trend)
- [ ] Memory growth <50MB/hr
- [ ] No critical incidents
- [ ] GC frequency <1/min
- [ ] DB/Redis pools stable

---

## SUCCESS CRITERIA SCORECARD

Print and fill this out at each phase boundary:

```
PHASE 1 (T+2h)
[ ] ✅ Health endpoint OK
[ ] ✅ Circuit breaker CLOSED
[ ] ✅ Startup logs clean
[ ] ✅ No correlation ID collisions
[ ] ✅ Alerts working
[ ] ✅ Memory stable
DECISION: ✅ PROCEED / ❌ ROLLBACK

PHASE 2 (T+12h)
[ ] ✅ p50 latency 40-50ms
[ ] ✅ p99 latency <200ms
[ ] ✅ Success rate ≥99%
[ ] ✅ Circuit breaker responding
[ ] ✅ Retry budget <50/min
[ ] ✅ No hanging requests
[ ] ✅ Alert dedup working
DECISION: ✅ PROCEED / ⚠️  EXTEND / ❌ ROLLBACK

PHASE 3 (T+24h)
[ ] ✅ p99 latency stable (60-65ms)
[ ] ✅ Memory growth <50MB/hr
[ ] ✅ GC frequency <1/min
[ ] ✅ DB pool healthy
[ ] ✅ Redis pool healthy
[ ] ✅ Zero critical incidents
DECISION: ✅ APPROVED / ⚠️  CONDITIONAL / ❌ ROLLBACK
```

---

## TIMING QUICK REFERENCE

| Event | Time |
|-------|------|
| Deployment starts | T+0 |
| Health confirmed | T+5 min |
| Phase 1 metrics check | Hourly |
| Phase 1 complete | T+2h |
| Phase 2 metrics check | Every 30 min |
| Traffic increase: 50% | T+4h |
| Traffic increase: 75% | T+8h |
| Phase 2 complete | T+12h |
| Traffic increase: 100% | T+12h |
| Phase 3 metrics check | Hourly |
| Final health check | T+22h |
| Phase 3 complete | T+24h |

---

## RED ALERT SCENARIOS

✋ **STOP AND ESCALATE IMMEDIATELY IF**:

1. ❌ API returning 500 errors (anything >10% error rate)
2. ❌ Circuit breaker OPEN at Phase 1 T+5min
3. ❌ Memory growth >100MB/hour (confirmed, multiple samples)
4. ❌ p99 latency >500ms (indicates serious issue)
5. ❌ Retry rate >300/min sustained (storm)
6. ❌ PagerDuty critical alert fired
7. ❌ Connections to DB/Redis failing
8. ❌ Correlation ID collisions detected (request mixing)

**Action**: ROLLBACK if unsure

---

## PRINT & POST

This card should be:
- [ ] Printed (8.5" x 11")
- [ ] Posted above deployment station
- [ ] Shared in Slack channel
- [ ] Referenced frequently during 24h window

---

## FINAL REMINDER

> **The goal is not to go fast—it's to deploy safely.**

- ✅ Follow the process exactly
- ✅ If unsure, ask Tech Lead
- ✅ If still unsure, slower is better
- ✅ Rollback is fast and safe
- ✅ One mistake costs 24 hours, not one life

**You've got this! 🚀**
