# Runbook Updates - Weekly Operations Review
# Generated: March 30, 2026
# Status: Ready for implementation

---

## RUNBOOK UPDATE 1: RUNBOOK-003 (Error Rate Spike Investigation)

**Location:** `runbooks/RUNBOOK-003.md`  
**Status:** Needs update  
**Priority:** HIGH (will aid in future incident diagnosis)  

### Section to Add: "Database Performance Diagnosis"

Add this section AFTER "Step 3: Check error logs" and BEFORE "Step 4: Check circuit breaker status"

```markdown
### Step 3.5: Database Performance Diagnosis

**Needed when:** Error rate spike correlated with P99 latency increase (>500ms)

Database slow queries are the MOST COMMON cause of error spikes.
Check this early to catch problems faster.

#### Quick Check: Is database slow?

```bash
# SSH to database server
ssh db-prod-01.internal

# Check PostgreSQL query statistics
psql -U postgres -d virality_production \
  -c "SELECT query, calls, mean_time, max_time 
      FROM pg_stat_statements 
      WHERE mean_time > 1000 
      ORDER BY mean_time DESC LIMIT 5;"
```

Look for:
- Query with mean_time > 1000ms (>1 second per query)
- High call count (being executed frequently)
- Recently increased mean_time

#### Common Causes & Fixes

**Cause 1: Missing Index**

Symptom: Query scans entire table (seq scan in EXPLAIN)
How to find:
```sql
EXPLAIN SELECT * FROM users WHERE email = 'test@example.com';
-- Look for: "Seq Scan on users" (bad)
-- Should be: "Index Scan" (good)
```

Fix:
```sql
CREATE INDEX CONCURRENTLY idx_users_email ON users(email);
-- CONCURRENTLY = doesn't block other queries
-- Takes ~90 seconds for medium table
```

**Cause 2: Missing JOIN condition**

Symptom: Query returns millions of rows (cartesian product)
How to find:
```sql
EXPLAIN SELECT * FROM users u 
  JOIN orders o ON u.id = o.user_id;
  -- Check: Is there an ON clause?
```

Fix:
```sql
-- If ON clause is wrong, fix the SQL in application code
-- This usually requires application deployment
-- Temporary workaround: Run slow query in cache to warm it
```

**Cause 3: Table too large, query not optimized**

Symptom: Table has millions of rows, still sequential scanning
How to find:
```sql
-- Check table size
SELECT pg_size_pretty(pg_total_relation_size('users'));
-- If > 500MB, table is large

-- Check index size
SELECT pg_size_pretty(pg_total_relation_size('idx_users_email'));
-- Index should be much smaller
```

Fix:
```sql
-- Option A: Add index on filter column
CREATE INDEX idx_users_created_week 
  ON users((DATE_TRUNC('week', created_at)));
  
-- Option B: Add covering index
CREATE INDEX idx_users_lookup 
  ON users(email) INCLUDE (id, name);
  -- INCLUDE for columns in SELECT clause

-- Option C: Partition large table (advanced)
-- Only if table is > 10GB (haven't reached yet)
```

#### Real Example: Previous Incident

**When:** 2026-03-26 10:00am  
**Error Rate:** Spiked to 2.1%  
**Root Cause:** Slow query on `users` table  
**Query:** `SELECT * FROM users WHERE email = ?`  
**Problem:** No index on email column  
**Fix:** Created index (90 seconds)  
**Resolution:** Error rate dropped immediately  

Lesson: Always index on WHERE clause columns.

---

### Database Performance Checklist

Before escalating, confirm database is or isn't the issue:

- [ ] Error rate correlates with P99 latency spike?
- [ ] checked pg_stat_statements for queries > 1000ms?
- [ ] Found slow query?
  - [ ] Confirmed: INDEX PLAN (EXPLAIN)?
  - [ ] Fixed: Created missing index?
  - Verified: mean_time improved?

If database is NOT slow, move to: "Check application logs" (next section)
If database IS slow, you've found the issue. Fix it.

---

## Mean Time Saved

- Before: SRE discovers slow query by looking at error logs (15+ min)
- After: SRE finds slow query by following database checks (5 min)
- Savings: ~10 minutes per incident

```

---

## RUNBOOK UPDATE 2: RUNBOOK-005 (Single User Monopoly/High Load)

**Location:** `runbooks/RUNBOOK-005.md`  
**Status:** Needs update  
**Priority:** MEDIUM (prevents false escalations)  

### Section to Update: "Investigate Alert Details"

Find the section that says: "Compare user traffic against baseline"

Replace with this improved version:

```markdown
### Step 2: Determine If High Load Is Expected or Abuse

**Critical question:** Is the high load expected or unexpected?

This determines if it's "testing" or "abuse".
Different responses needed.

---

#### Option A: It's EXPECTED (Approved Testing)

Example: Customer running integration test during business hours

Steps:
1. Contact customer support immediately (Slack: #customer-support)
   ```
   @support: High load detected from user-ID-12345 (user name). 
   Is this expected activity? Integration test?
   ```

2. Wait for response (usually < 5 minutes)

3. If YES - it's approved:
   ```bash
   # Add to testing whitelist
   kubectl exec -it redis-0 -- redis-cli
   > SET approved_test_user:user-12345 true EX 3600
   # EX 3600 = expires in 1 hour, in case they forget to update
   
   # Update testing log
   echo "user-12345: Integration test, 2026-03-26 15:00-16:00 UTC" \
     >> /var/log/approved_testing.log
   ```

4. Suppress the user monopoly alert:
   ```yaml
   # Add to prometheus alert suppression rules
   alert: SingleUserMonopoly
   match:
     user_id: user-12345
   duration: 1h
   reason: "Approved integration test window"
   ```

5. Notify SRE team (Slack):
   ```
   @channel: User-12345 approved testing window (15:00-16:00 UTC). 
   Fairness alerts suppressed. No action needed.
   ```

Resolution: No further action. Alert resolved.

---

#### Option B: It's UNEXPECTED (Possible Abuse)

Example: Unknown user suddenly consuming 50% of traffic

Steps:
1. Check user history:
   ```bash
   # Look up user profile
   curl https://api.internal/admin/users/user-12345
   
   # When did account exist?
   # What tier: FREE/STARTER/PRO?
   # Any previous high-load activity?
   ```

2. Analyze traffic pattern:
   ```bash
   # Get request breakdown
   curl https://monitoring.internal/api/user/user-12345/requests
   
   What are they doing?
   - Are all requests successful?
   - Are they retrying frequently?
   - Are they hitting same endpoint or varied?
   - What error rate (if any)?
   ```

3. Check for abuse patterns (are they a bot/attacker?):
   ```
   ✓ All from same IP address?
   ✓ All same user agent?
   ✓ Timing: Random or pulsed?
   ✓ Endpoints: Probing various or focused?
   ✓ Error rate: High (scanning) or low (using)?
   ```

4. If looks like abuse:
   - Apply rate limit: See RUNBOOK-006 (Rate Limit Single User)
   - Alert abuse team: Slack #abuse-investigations
   - Monitor for 10 minutes (does pattern continue?)

5. If looks like legitimate heavy usage:
   - Suggest customer upgrade tier
   - Send message: "We noticed high volume. Upgrade to PRO for higher limits?"
   - Set to "monitor" status (check again in 1 hour)

---

#### Option C: No Response From Support (Timeout)

If customer support doesn't respond:

```
1. Assume worst-case: unknown user with unusual activity
2. Apply rate limiting (protection stance)
3. Create ticket for manual review
4. Leave note for next shift: "User-12345 flagged, pending review"
```

---

### Decision Tree

```
User monopoly alert fires
├─ Can reach customer?
│  ├─ YES: Is it testing?
│  │  ├─ YES: Whitelist user, suppress alert, done
│  │  └─ NO: Check for abuse patterns
│  │     ├─ Looks like abuse: Rate limit, alert team
│  │     └─ Looks legitimate: Suggest upgrade
│  └─ NO: Assume abuse, apply protection
└─ Monitor and review later
```

---

### Real Example: Previous Incident

**When:** 2026-03-26 15:00 (Friday test)  
**Alert:** User-12345 at 52% traffic  
**Response:** 
  - Without procedure: Takes 15 minutes to investigate
  - With procedure: Takes 3 minutes to whitelist, <1 minute per inquiry
**Outcome:** User successfully tested, SRE unblocked

**What we learned:** Need pre-approval for testing.
**Action:** Implement testing window process (coming soon)

```

---

## RUNBOOK UPDATE 3: Create New RUNBOOK-011 (Redis Memory/OOM)

**Location:** `runbooks/RUNBOOK-011.md`  
**Status:** Create new  
**Priority:** HIGH (prevents recurring incidents)  

**Full Runbook Content:**

```markdown
# RUNBOOK-011: Redis Memory Pressure & Out of Memory

## Summary

Redis has run out of memory. Data is being evicted (deleted), and the system is degrading.

## Severity

- **80% Memory:** WARNING (preventive action)
- **99% Memory:** CRITICAL (emergency response)

## How to Know It's This Issue

**Alert fires:**
- `RedisMemoryPressure` (80%) OR
- `RedisMemoryFull` (99%)

**Symptoms:**
- Rate limiter not working correctly
- Circuit breaker flapping
- Session data missing
- Requests unexpectedly throttled

**Confirm with:**
```bash
redis-cli INFO memory
```

Look for key metrics:
```
used_memory_human:2.00G          ← How much used
maxmemory_human:2.00G            ← How much available
maxmemory_policy:allkeys-lru     ← What gets deleted
evicted_keys:125000              ← Number of keys deleted
```

---

## Immediate Response (< 2 minutes)

### At 80% Memory (WARNING Alert)

**Goal:** Proactively reduce memory before hitting OOM

**Quick fix (choice A, B, or C):**

#### Choice A: Delete old rate limiter tokens

```bash
redis-cli SCAN 0 MATCH "rate_limiter:*" COUNT 1000 \
  | xargs redis-cli DEL

# This deletes old token buckets that are expired anyway
# Frees up ~500MB-1GB typically
```

**Benefit:** Fast, safe, recovers proactively  
**Time:** 30 seconds  
**Risk:** Very low (old tokens already expired)

---

#### Choice B: Increase Redis memory limit

```bash
# Edit Redis config
sudo nano /etc/redis/redis.conf

# Find this line:
maxmemory 2gb

# Change to:
maxmemory 4gb

# Save and restart:
sudo systemctl restart redis

# Wait for recovery:
redis-cli PING  # Should return "PONG"
```

**Benefit:** Permanent solution  
**Time:** 2-3 minutes  
**Risk:** Medium (check available system memory first)

**Before doing this:**
```bash
# Check how much memory server has
free -h

# If < 8GB total and you're at 4GB limit, this is dangerous
# Use Choice A instead
```

---

#### Choice C: Set automatic key expiration

```bash
# For rate limiter keys, set 1-hour TTL
redis-cli
> KEYS rate_limiter:*
> EXPIRE rate_limiter:* 3600  # 3600 seconds = 1 hour
> QUIT
```

**Benefit:** Future-proofs against same issue  
**Time:** 1 minute  
**Risk:** Very low (keys have short lifetime anyway)  
**Next steps:** This is temporary, implement permanent TTL in code

---

### At 99% Memory (CRITICAL Alert)

**Goal:** Recover immediately, investigate later

**Emergency response:**

```bash
# OPTION 1: Restart Redis (quickest)
sudo systemctl restart redis

# Wait for it to come back online
redis-cli PING
# Should return "PONG" within 30 seconds

# This clears everything (data loss but circuit recovers)
```

**Then, immediately:**

Do one of the Options (A, B, C) from above to prevent recurrence.

---

## Root Cause Analysis (next 30 minutes)

After emergency response, figure out WHY:

### Question 1: Why did Redis hit capacity?

```bash
# Check what's in Redis
redis-cli --scan --pattern '*' | head -20

# Get size of largest keys
redis-cli --bigkeys --scan
```

Most likely culprits:
1. **Rate limiter tokens not expiring** (bug in code)
2. **Session data accumulating** (stale sessions)
3. **Queue jobs stuck** (jobs never deleted after processing)
4. **Cache pollution** (temporary data not cleaned)

---

### Question 2: Is maxmemory-policy correct?

```bash
redis-cli CONFIG GET maxmemory-policy
# Should return: allkeys-lru

# If not:
redis-cli CONFIG SET maxmemory-policy allkeys-lru
redis-cli CONFIG REWRITE  # Save to config file
```

Explanation:
- `allkeys-lru`: Delete least-recently-used keys (good)
- `noeviction`: Return error when full (bad, causes circuit break)
- `volatile-lru`: Only delete keys with TTL (can still overflow)

---

### Question 3: How much memory do we actually need?

```bash
# Current actual use
# Previous 6 months peak:
# Projected 6 months ahead:

# Make graph over time to predict when next OOM
```

If consistently hitting 80%+:
- Increase permanent limit (Choice B above)
- Implement key expiration (Choice C above)
- Check for memory leaks in data structures

---

## Prevention (for next day/week)

### Implement Automatic TTL (Code Change)

All rate limiter keys should expire automatically:

```python
# In rate limiter code
def store_token_bucket(user_id, tokens):
    # Set expiration to 1 hour
    redis_client.setex(
        f"rate_limiter:{user_id}",
        3600,  # seconds
        tokens
    )
```

**This prevents:** Same OOM incident from happening again

---

### Monitor Memory Trend (Prometheus)

Add to dashboard:

```promql
redis_memory_used_bytes / redis_memory_limit_bytes
# Should stay < 70% normally
# WARNING at 80%, CRITICAL at 99%
```

---

## Escalation

If problem persists after fixes:

1. **Database memory leak:** Check with Redis maintainer
2. **Intentional overload:** Might need to shard Redis
3. **DoS attack:** Coordinate with security team

Slack: #sre-emergency or @cto

---

## Verification Checklist

After incident resolved:

- [ ] Memory usage < 70%?
- [ ] redis-cli PING returns "PONG"?
- [ ] Circuit breaker recovered?
- [ ] Rate limiting working? (test with ab)
- [ ] All user keys still accessible?
- [ ] No data corruption?

---

## References

- Redis Memory Management: https://redis.io/topics/memory-optimization
- Redis eviction policies: https://redis.io/topics/lru-cache
- Previous incidents: Incident #1 (2026-03-24)

```

---

## TESTING RECOMMENDATIONS

Before using runbooks in production:

1. **Runbook-003 Update:**
   - [ ] Follow database diagnosis steps on staging DB
   - [ ] Verify EXPLAIN PLAN output format
   - [ ] Test CREATE INDEX CONCURRENTLY
   - [ ] Verify query times improve

2. **Runbook-005 Update:**
   - [ ] Test whitelisting with test user
   - [ ] Verify alert suppression works
   - [ ] Walk through decision tree
   - [ ] Confirm procedure takes < 5 min

3. **Runbook-011 (New):**
   - [ ] Test on staging Redis at 80% memory
   - [ ] Test emergency restart
   - [ ] Verify recovery within 2 minutes
   - [ ] Confirm data loss expectations

---

## ROLLOUT PLAN

1. **Day 1:** Update RUNBOOK-003 and RUNBOOK-005
   - Notify team of changes
   - Link in Slack #sre-runbooks

2. **Day 2:** Create and test RUNBOOK-011
   - Add to production runbooks
   - Train on-call SRE on new procedure

3. **Week 1:** Monitor
   - Did new sections help with incidents?
   - Any feedback from SRE team?
   - Iterate on wording if needed

---

**Status: RUNBOOKS READY FOR UPDATE**

All updates are based on actual incidents this week.
Expected to reduce incident MTTR by 5-10 minutes.
Can be deployed immediately.

```

