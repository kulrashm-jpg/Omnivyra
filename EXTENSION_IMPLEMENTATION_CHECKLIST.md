# Chrome Extension Integration - Implementation Checklist

**Project:** Omnivyra Chrome Extension Support (LinkedIn, YouTube)  
**Recommendation:** Option B - Unified Extension Layer  
**Estimated Timeline:** 6-10 weeks  
**Priority:** P1 (Critical path for Q2 roadmap)  

---

## PHASE 0: PRE-IMPLEMENTATION (Week -1)

### Architecture Review
- [ ] Engineering team alignment on Option B approach
- [ ] Security review scheduled for signature validation + RLS policies
- [ ] Database DBA review of new schema (16 tables)
- [ ] API contract signed off by mobile/SDK teams
- [ ] Load testing requirements defined (target: 100k events/min)

### Documentation Prep
- [ ] Create ADR-005 (Architecture Decision Record)
- [ ] Design API contract (OpenAPI spec skeleton)
- [ ] Define data flow diagrams (done in EXTENSION_ARCHITECTURE_DATA_FLOWS.md)
- [ ] Create developer onboarding guide outline

### Dev Environment Setup
- [ ] Supabase staging environment provisioned
- [ ] Redis queue instance allocated
- [ ] Extension dev environment created (separate instance)
- [ ] Slack channel #ext-integration created
- [ ] Daily standup scheduled (9 AM PST)

---

## PHASE 1: DATABASE & DATA MODEL (Week 1-2)

### New Tables
- [ ] Create `extension_configs` table
  - [ ] Indexes: (organization_id, platform), (extension_id UNIQUE)
  - [ ] Triggers: auto-update updated_at
  - [ ] RLS: only org members can view own config
- [ ] Create `extension_events` table
  - [ ] Indexes: (processing_status), (organization_id, created_at DESC)
  - [ ] Partitioning: monthly by created_at
  - [ ] RLS: organization-level isolation
- [ ] Create `extension_commands` table
  - [ ] Indexes: (execution_status WHERE pending), (organization_id)
  - [ ] RLS: organization-level isolation
- [ ] Create `extension_sessions` table
  - [ ] Indexes: (expires_at), (user_id, organization_id)
  - [ ] RLS: user can only access own session
- [ ] Create `extension_command_results` table
  - [ ] Foreign key: extension_commands(id)
  - [ ] Storage: JSON responses from platform APIs
- [ ] Create `extension_telemetry` table
  - [ ] Partitioning: hourly by created_at
  - [ ] Indexes: (organization_id, created_at DESC)
- [ ] Create `engagement_message_sources` table (dedup tracking)
  - [ ] Unique: engagement_message_id
  - [ ] Tracks: extension_event_id + api_source_id

### Schema Migrations
- [ ] Add `source_origin` column to `engagement_threads`
  - [ ] Values: 'api', 'extension', 'webhook'
  - [ ] Default: 'api' (for backwards compat)
  - [ ] Index: (extension_config_id) WHERE source_origin='extension'
- [ ] Add `source_origin` column to `engagement_messages`
  - [ ] Values: same as threads
  - [ ] Default: 'api'
- [ ] Add `extension_config_id` column to `engagement_threads` and `engagement_messages`
  - [ ] Foreign key: extension_configs(id) ON DELETE SET NULL
- [ ] Add `extension_event_id` column to `engagement_messages`
  - [ ] Foreign key: extension_events(id) ON DELETE SET NULL

### Views & Functions
- [ ] Create view: `v_extension_pending_events` (WHERE processing_status='pending')
- [ ] Create function: `sync_extension_event_to_engagement()` (idempotent normalization)
- [ ] Create function: `deduplicate_engagement_message()` (upsert logic)

### Migration Scripts
- [ ] Write and test `001-create-extension-tables.sql`
- [ ] Write and test `002-alter-engagement-tables.sql`
- [ ] Verify RLS policies don't block legitimate queries
- [ ] Dry-run on staging with production-like data

### Database Testing
- [ ] [ ] Test: RLS policies prevent cross-org data access
- [ ] [ ] Test: Unique constraints on platform_message_id + thread_id
- [ ] [ ] Test: Deduplication logic (upsert replaying same message)
- [ ] [ ] Test: Cascading deletes (extension_config → events → commands)
- [ ] [ ] Performance: Query 1M rows with filters < 100ms

---

## PHASE 2: BACKEND SERVICES (Week 2-3)

### Extension Services Module (`backend/services/extensions/`)
- [ ] Create `extensionEventService.ts`
  - [ ] `ingestRawEvent(payload)` → insert extension_events
  - [ ] `normalizeEvent(eventId)` → call engagement normalization
  - [ ] `processEventBatch(eventIds)` → bulk normalize
  - [ ] `getEventStatus(eventId)` → query processing_status
  - [ ] Error handling: log failures, update processing_error

- [ ] Create `extensionCommandService.ts`
  - [ ] `queueCommand(org, command)` → insert extension_commands
  - [ ] `getPendingCommands(org, since)` → query by org + timestamp
  - [ ] `updateCommandResult(cmdId, result)` → mark executed + store response
  - [ ] `archiveOldCommands(olderThan)` → monthly archival

- [ ] Create `extensionSessionService.ts`
  - [ ] `initSession(orgId, userId, extensionId)` → create session_token
  - [ ] `validateSessionToken(token)` → check expiry + perms
  - [ ] `refreshSession(token)` → extend expires_at
  - [ ] `revokeSession(token)` → remove row
  - [ ] Token format: use `crypto.randomBytes(32).toString('hex')`

- [ ] Create `extensionSignatureService.ts`
  - [ ] `generateSignature(payload, secret)` → HMAC-SHA256
  - [ ] `verifySignature(payload, sig, secret)` → boolean
  - [ ] `validateTimestamp(timestamp, maxAge=300)` → prevent replay
  - [ ] Test vectors from OWASP webhook signing best practices

- [ ] Create `extensionAnalyticsService.ts`
  - [ ] `recordTelemetry(org, event, data)` → insert extension_telemetry
  - [ ] `getHealthMetrics(org, since)` → event volume, latency, errors
  - [ ] `getCommandLatency(org, since)` → p50, p95, p99

### Update Engagement Services
- [ ] Modify `engagementNormalizationService.ts`
  - [ ] Add `normalizeExtensionEvent(event)` function
  - [ ] Add `normalizeLinkedInDM(data)` (new message_type support)
  - [ ] Add `normalizeYouTubeReply(data)` (new message_type support)
  - [ ] Add `mergeWithExistingMessage(rawMsg, existingMsg)` (dedup upsert)
  - [ ] Handle: message_type enum expansion
  - [ ] Handle: source_origin and extension_config_id population

- [ ] Modify `engagementInboxService.ts`
  - [ ] Add filter: `getThreadsBySource(org, source_origin)` 
  - [ ] Add filter: `getThreadsViaExtension(org, extensionId)`
  - [ ] Update `getPlatformCounts()` to include extension source indicator

### Error Handling
- [ ] Create custom error types:
  - [ ] `ExtensionSignatureError`
  - [ ] `ExtensionQuotaExceededError`
  - [ ] `ExtensionDeduplicationError`
  - [ ] `ExtensionCommandNotFoundError`
- [ ] Implement structured logging for all extension operations

### Service Layer Tests
- [ ] Unit tests for `extensionEventService` (15+ cases)
- [ ] Unit tests for `extensionSignatureService` (10+ cases)
- [ ] Integration tests with database (20+ cases)
- [ ] Error conditions: invalid signatures, malformed events

---

## PHASE 3: API ENDPOINTS (Week 3-4)

### Create Routes in `/pages/api/extension/`

#### 1. POST `/api/extension/events`
- [ ] Handler: `pages/api/extension/events.ts`
- [ ] Middleware:
  - [ ] Extract headers: X-Extension-ID, X-Timestamp, X-Signature
  - [ ] Verify signature using extensionSignatureService
  - [ ] Retrieve extension_configs by extension_id
  - [ ] Validate timestamp (not older than 5 min)
- [ ] Validate request body schema (JSON Schema or Zod)
- [ ] Rate limiting: max 100 events/min per extension
- [ ] Implementation:
  - [ ] Call extensionEventService.ingestRawEvent()
  - [ ] Queue extensionEventProcessor job
  - [ ] Return 202 Accepted with event_id
- [ ] Response schema:
  ```typescript
  {
    ok: boolean,
    event_id: string (UUID),
    normalized_to?: string (engagement_message_id),
    queued: boolean
  }
  ```
- [ ] Error responses:
  - [ ] 400: Invalid signature
  - [ ] 401: Invalid extension_id
  - [ ] 429: Rate limit exceeded
  - [ ] 413: Payload too large

#### 2. GET `/api/extension/commands`
- [ ] Handler: `pages/api/extension/commands.ts`
- [ ] Query params:
  - [ ] organization_id (required)
  - [ ] since (optional, ISO timestamp)
  - [ ] limit (default 50, max 100)
- [ ] Implementation:
  - [ ] Validate session token (from header or cookie)
  - [ ] Check user's organization_id matches request
  - [ ] Query extension_commands WHERE status='pending'
  - [ ] Return list of pending commands
- [ ] Response schema:
  ```typescript
  {
    pending_commands: Array<{
      id: string,
      command_type: string,
      platform: string,
      target_id: string,
      command_payload: any,
      queued_at: string
    }>,
    recent_events?: Array<{ ... }>
  }
  ```

#### 3. POST `/api/extension/command-result`
- [ ] Handler: `pages/api/extension/command-result.ts`
- [ ] Request body:
  ```typescript
  {
    command_id: string (UUID),
    status: 'executed' | 'failed',
    platform_response?: any,
    error?: any,
    retry_count?: number
  }
  ```
- [ ] Implementation:
  - [ ] Fetch extension_commands by id
  - [ ] Verify organization_id matches
  - [ ] Update status, platform_response, executed_at
  - [ ] Call communityAiActionExecutor to update parent action
  - [ ] Deduct credits (if not already deducted)
  - [ ] Mark opportunity as resolved (if applicable)
- [ ] Response: `{ ok: true, command_id, updated_at }`
- [ ] Idempotency: same request twice = same result

#### 4. POST `/api/extension/commands` (Queue command)
- [ ] Handler: `pages/api/extension/commands.ts` (POST method)
- [ ] Authentication: User JWT or session token
- [ ] Request body:
  ```typescript
  {
    organization_id: string,
    command_type: 'reply' | 'like' | 'follow' | 'message',
    platform: 'linkedin' | 'youtube',
    target_id: string,
    command_payload: any,
    context?: any
  }
  ```
- [ ] Implementation:
  - [ ] Resolve user context
  - [ ] Check RBAC: community_ai:execute_commands
  - [ ] Pre-check credits
  - [ ] Find appropriate extension_config for platform
  - [ ] Queue in extension_commands
  - [ ] Return command_id + execution_status
- [ ] Response: `{ ok: true, command_id, execution_status, queued_for }`

#### 5. POST `/api/extension/auth`
- [ ] Handler: `pages/api/extension/auth.ts`
- [ ] Request body:
  ```typescript
  {
    extension_id: string,
    organization_id: string,
    nonce?: string
  }
  ```
- [ ] Implementation:
  - [ ] Fetch extension_configs by extension_id + organization_id
  - [ ] Validate extension is active (not deleted)
  - [ ] Create extension_sessions row
  - [ ] Return session_token (encrypt sensitive data)
- [ ] Response:
  ```typescript
  {
    session_token: string,
    expires_in: number (seconds),
    refresh_token?: string,
    organization_id: string
  }
  ```

#### 6. GET `/api/extension/sync`
- [ ] Handler: Combine GET /commands + recent events
- [ ] Query params:
  - [ ] organization_id (required)
  - [ ] since (optional, ISO timestamp)
- [ ] Response: Pending commands + recent inbound events
- [ ] Used by extension for recovery after disconnect

### Endpoint Testing
- [ ] Test all 6 endpoints with valid requests
- [ ] Test error cases (invalid signature, auth failures)
- [ ] Test rate limiting
- [ ] Load test: concurrent requests from multiple extensions
- [ ] Security tests: CSRF, header injection, SQL injection

---

## PHASE 4: BACKGROUND WORKERS (Week 4-5)

### Create Worker Files in `backend/queue/`

#### 1. `extensionEventProcessor.ts`
- [ ] Purpose: Convert extension_events → engagement messages
- [ ] Worker setup:
  - [ ] Get worker from getExtensionEventWorker()
  - [ ] Concurrency: 10 (parallel processing)
  - [ ] Retry: 3 retries with exponential backoff
- [ ] Job handler:
  - [ ] Fetch extension_events WHERE processing_status='pending'
  - [ ] Call engagementNormalizationService.normalizeExtensionEvent()
  - [ ] Handle deduplication (check if message already exists)
  - [ ] Insert engagement_messages + engagement_message_sources
  - [ ] Update extension_events.processing_status='normalized'
  - [ ] Trigger existing workflows (opp detection, etc)
- [ ] Error handling:
  - [ ] If normalization fails: set processing_error, retry
  - [ ] If dedup conflict: update existing message only
  - [ ] Log failures with event_id for debugging
- [ ] Performance: process 1000 events/min (16 events/sec)

#### 2. `extensionCommandProcessor.ts`
- [ ] Purpose: Execute extension_commands via community AI
- [ ] Worker setup:
  - [ ] Concurrency: 5 (serial to maintain execution order per org)
  - [ ] Max job duration: 30 seconds
- [ ] Job handler:
  - [ ] Fetch extension_commands WHERE execution_status='pending'
  - [ ] Call communityAiActionExecutor with extension context
  - [ ] Verify user RBAC before execution
  - [ ] Pre-check credits (hasEnoughCredits)
  - [ ] Route to appropriate platform connector
  - [ ] Execute action (API call or RPA)
  - [ ] Update extension_commands.execution_status='executing' (or 'executed')
  - [ ] Store platform_response
- [ ] Error handling:
  - [ ] If execution fails: store error in error_details, retry
  - [ ] If credits insufficient: set status='blocked_insufficient_credits'
  - [ ] If user revoked access: set status='blocked_revoked_access'
- [ ] Deduct credits atomically (or refund if failed)

#### 3. `extensionDeduplicationWorker.ts`
- [ ] Purpose: Merge duplicate messages from extension + API polling
- [ ] Run frequency: Hourly (or on-demand after polling cycle)
- [ ] Logic:
  - [ ] Find engagement_messages with multiple sources
  - [ ] Query: SELECT * FROM engagement_message_sources 
               GROUP BY engagement_message_id 
               HAVING COUNT(*) > 1
  - [ ] For each duplicate:
    - [ ] Merge metadata (like_count from API, content from extension)
    - [ ] Determine precedence (extension wins for content/timestamp)
    - [ ] Update engagement_messages with merged data
    - [ ] Update engagement_message_sources with both IDs
  - [ ] Log dedup incidents for audit
- [ ] Performance: O(N) where N = messages with multiple sources

### Update Existing Workers
- [ ] `engagementOpportunityDetectionWorker.ts`
  - [ ] Support extension-sourced messages
  - [ ] Apply extension-specific rules (faster detection for urgent questions)
  - [ ] Track source_origin in opportunities table
- [ ] `engagementPollingProcessor.ts`
  - [ ] Add dedup check: skip if already in engagement_messages
  - [ ] Update source tracking when re-encountered
  - [ ] Merge like_count, reply_count from API

### Register Workers
- [ ] Update `backend/queue/bullmqClient.ts`
  - [ ] Add `getExtensionEventWorker()`
  - [ ] Add `getExtensionCommandProcessor()`
  - [ ] Add `getExtensionDeduplicationWorker()`
- [ ] Update `backend/queue/startWorkers.ts`
  - [ ] Start all 3 new workers on boot
  - [ ] Add to health check endpoint

### Worker Testing
- [ ] Unit tests: message normalization, dedup logic
- [ ] Integration tests: full flow (event → message → opportunity)
- [ ] Load tests: 1000 events/min through workers
- [ ] Failure tests: network errors, DB timeouts, retry logic

---

## PHASE 5: INTEGRATION WITH EXISTING SYSTEMS (Week 5-6)

### Community AI Action Executor Integration
- [ ] Modify `communityAiActionExecutor.ts`
  - [ ] Accept `extension_config_id` parameter
  - [ ] Route execution_mode: 'extension' to extension command queue
  - [ ] Track execution source in action logs
  - [ ] Link extension_commands.id back to community_ai_actions.id
- [ ] Test: Reply via extension vs. API have same outcome

### Credit System Integration
- [ ] Modify `creditDeductionService.ts`
  - [ ] Define cost for 'extension_reply' = 1 credit
  - [ ] Define cost for 'extension_suggestion' = 2 credits
  - [ ] Define cost for 'extension_ingest' = 0 (free)
- [ ] Modify `creditExecutionService.ts`
  - [ ] Deduct credits when extension_commands executed
  - [ ] Support refund if action failed
  - [ ] Log in usage_meter with source='extension'
- [ ] Test: 100 extension replies consume 100 credits

### RBAC Integration
- [ ] Add extension capabilities:
  ```typescript
  EXTENSION_CAPABILITIES = {
    CREATE_EXTENSION: 'community_ai:create_extension',
    EXECUTE_COMMANDS: 'community_ai:execute_commands',
    VIEW_EVENTS: 'community_ai:view_extension_events',
    MANAGE_CONFIG: 'community_ai:manage_extension_config',
  }
  ```
- [ ] Update `rbacService.ts` with new capability gates
- [ ] Test: Non-admin user cannot create extension config

### Audit & Logging Integration
- [ ] Log all extension operations:
  - [ ] `recordAuditEvent()` when command executed
  - [ ] Include: actor='extension', resource_id, changes
  - [ ] Store platform_response for verification
- [ ] Test: Audit log complete for all extension actions

### Email & Notification Integration
- [ ] Notify user when opportunity detected via extension
- [ ] Notify when command execution fails
- [ ] Test: Notifications sent correctly

---

## PHASE 6: EXTENSIBILITY & SAFETY (Week 6-7)

### Capability Declaration
- [ ] Extension declares supported actions:
  ```typescript
  "capabilities": ["ingest_comments", "execute_replies", "track_events"]
  ```
- [ ] Backend validates action against declared capabilities
- [ ] Test: Extension trying to do undeclared action = rejected

### Risk Scoring
- [ ] Implement risk classification:
  - [ ] DM reply: medium risk (user impersonation)
  - [ ] Public reply: low risk
  - [ ] Follow/unfollow: low risk
  - [ ] Direct message send: high risk
- [ ] Store risk_level in extension_commands
- [ ] Gate high-risk actions behind approval or plan limits

### Approval Workflows
- [ ] For high-risk actions:
  - [ ] Extension command created with requires_approval=true
  - [ ] Admin must approve before execution
  - [ ] Store approval_timestamp and approver_id
- [ ] Test: High-risk action blocked until approved

### Extension Versioning
- [ ] Track extension_version in extension_configs
- [ ] Define minimum supported version in config
- [ ] Reject events from unsupported versions
- [ ] Test: Old extension versions gracefully refused

### Extension Health Check
- [ ] Endpoint: `GET /api/extension/health`
  - [ ] Returns: status, last_event_received, pending_commands_count, error_rate
- [ ] Run periodically to monitor extension connectivity
- [ ] Alert if extension silent for > 5 minutes

---

## PHASE 7: TESTING & QA (Week 7-8)

### Unit Tests
- [ ] Service layer: 40+ test cases
  - [ ] Signature validation: 10 cases
  - [ ] Session management: 8 cases
  - [ ] Event normalization: 15 cases
  - [ ] Deduplication: 7 cases
- [ ] Coverage target: > 80% on extension services

### Integration Tests
- [ ] End-to-end scenarios:
  - [ ] Extension event → inbox visible (3 cases)
  - [ ] Command execution → platform response (5 cases)
  - [ ] Dedup: API + extension same message (2 cases)
  - [ ] Credit deduction: correct amounts (3 cases)
  - [ ] Error handling: network, timeouts, retries (4 cases)

### Load Tests
- [ ] Setup:
  - [ ] Simulate 10,000 extensions
  - [ ] Each sends 1 event/minute
  - [ ] Database: Supabase staging
  - [ ] Duration: 2 hours
- [ ] Metrics:
  - [ ] Event latency: p50 < 100ms, p99 < 500ms
  - [ ] Throughput: sustain 100k events/min
  - [ ] Worker queue depth: < 1000 jobs pending
  - [ ] No dup messages created
- [ ] Success criteria: All metrics green

### Security Tests
- [ ] RLS policies:
  - [ ] Org A cannot see Org B's extension data ✓
  - [ ] User A cannot access User B's session ✓
- [ ] Signature validation:
  - [ ] Reject: missing signature
  - [ ] Reject: invalid signature
  - [ ] Reject: expired timestamp
  - [ ] Reject: replay attacks (same event twice)
- [ ] Authentication:
  - [ ] Invalid extension_id = 401
  - [ ] Expired session_token = 401
  - [ ] No RBAC = 403
- [ ] Third-party audit: webhook signature best practices

### Data Integrity Tests
- [ ] Deduplication:
  - [ ] Same message_id from extension + API = 1 row only
  - [ ] Metadata merged correctly (like_count from API)
  - [ ] source_precedence respected
- [ ] Credit correctness:
  - [ ] 100 commands → 100 credits deducted
  - [ ] Failed command → refund applied
  - [ ] No double-deduction
- [ ] Cross-tenant isolation:
  - [ ] Org A's events don't leak to Org B
  - [ ] User A's commands don't execute for Org B

### UI Tests
- [ ] Frontend sees extension-sourced messages
- [ ] Extension source indicator visible
- [ ] Reply via extension works end-to-end
- [ ] No performance regression in inbox load time

---

## PHASE 8: BETA ROLLOUT (Week 8-9)

### Closed Beta (Week 8-9a)
- [ ] Select 5-10 early access customers
- [ ] Manual activation via feature flag + admin panel
- [ ] Daily sync calls: understand feedback, troubleshoot
- [ ] Success criteria:
  - [ ] 0 data loss
  - [ ] > 90% command success rate
  - [ ] < 5 minute average response latency
  - [ ] No security incidents

### Created Artifacts
- [ ] Public API documentation (OpenAPI spec)
- [ ] Developer quick-start guide
- [ ] Troubleshooting FAQ
- [ ] Known limitations document

### Monitoring & Alerting
- [ ] Alert on: signature validation failure rate > 1%
- [ ] Alert on: extension_commands success rate < 95%
- [ ] Alert on: queue depth > 10,000 jobs
- [ ] Alert on: RLS policy violation attempts
- [ ] Dashboard: extension health metrics

### Open Beta (Week 9)
- [ ] Gradual rollout: 100 customers
- [ ] Self-serve extension onboarding
- [ ] Auto-enable for new signups (feature flag)
- [ ] Feedback collection form
- [ ] Automated rollback if error rate > 5%

---

## PHASE 9: GA & PRODUCTIONIZATION (Week 10)

### Release Prep
- [ ] Performance testing under production load
- [ ] Disaster recovery: backup & restore procedures
- [ ] Runbook for on-call engineers
- [ ] Capacity planning: estimated growth in extension events
- [ ] SLA definition: 99.9% uptime

### Documentation Finalization
- [ ] Extension developer guide (comprehensive)
- [ ] API reference (auto-generated from OpenAPI)
- [ ] Architecture decision record (ADR-005)
- [ ] Data dictionary (schema reference)
- [ ] FAQ: common issues & solutions

### Launch
- [ ] Feature flag: enable for all customers
- [ ] In-app announcement: "Extension support now available"
- [ ] Email campaign: beta customers + general audience
- [ ] Blog post: case studies, benefits
- [ ] Support training: docs, video, Q&A session

### Post-GA Monitoring
- [ ] Track: adoption rate (% customers activating extension)
- [ ] Track: average daily active extensions per customer
- [ ] Track: revenue impact (e.g., higher retention)
- [ ] Collect feedback for Phase 2 improvements

---

## 📊 SUCCESS METRICS BY PHASE

| Metric | Phase 1-2 | Phase 3-4 | Phase 5-6 | Phase 8-9 | Phase 10 |
|--------|-----------|-----------|-----------|-----------|----------|
| **System Uptime** | 95% | 99% | 99.5% | 99.9% | 99.9% SLA |
| **Event Latency (p99)** | < 5s | < 1s | < 500ms | < 300ms | < 300ms |
| **Command Success Rate** | 80% | 95% | 98% | 99% | > 99% |
| **Dedup Success Rate** | 95% | 99% | 100% | 100% | 100% |
| **Credit Accuracy** | 95% | 99% | 99.99% | 100% | 100% |
| **Test Coverage** | 60% | 75% | 85% | 90% | > 85% |
| **Security Audit Issues** | High | Medium | Low | None | None |
| **Customer Activation** | - | - | - | 50% beta | > 70% GA |

---

## 🚨 RISKS & CONTINGENCY

### High-Risk Items
1. **Database schema deadlock during migration**
   - Mitigation: Test on staging first; schedule during low-traffic window
   - Checkpoint: Verify RLS policies work post-migration

2. **Extension signature validation timing attack**
   - Mitigation: Use constant-time comparison; third-party security audit
   - Checkpoint: Pen test before beta

3. **Deduplication race condition**
   - Mitigation: Use unique constraints; atomic upsert operations
   - Checkpoint: Load testing under concurrent scenario

4. **Multi-source data corruption**
   - Mitigation: Transaction-safe updates; audit trail
   - Checkpoint: Data integrity tests pass 100%

### Medium-Risk Items
1. **Extension command queue backs up**
   - Mitigation: Horizontal scaling of workers; queue monitoring
   - Checkpoint: Load test 10k events/sec

2. **Extension leaks org data across tenants**
   - Mitigation: RLS policies + regular security audit
   - Checkpoint: Security review + manual test

3. **Extension version incompatibility**
   - Mitigation: Version-aware API; deprecation timeline
   - Checkpoint: Beta with multiple extension versions

---

## 📝 DELIVERABLES CHECKLIST

### Code
- [ ] All source files in `/backend/services/extensions/`
- [ ] All API routes in `/pages/api/extension/`
- [ ] All workers in `/backend/queue/`
- [ ] Unit & integration tests (all passing)
- [ ] Migration scripts (tested on staging)

### Documentation
- [ ] Architecture Decision Record (ADR-005)
- [ ] OpenAPI specification
- [ ] Developer quick-start guide
- [ ] API reference
- [ ] Data dictionary
- [ ] Troubleshooting guide
- [ ] Runbook for on-call engineers

### Artifacts
- [ ] Extension configs created for 5-10 beta customers
- [ ] Monitoring dashboards deployed
- [ ] Alerting rules configured
- [ ] Runbook for Slack #incident-response

---

## 📅 TIMELINE AT A GLANCE

```
Week 1-2:  Database schema + data model          (Phase 1)
Week 2-3:  Backend services                       (Phase 2)
Week 3-4:  API endpoints                          (Phase 3)
Week 4-5:  Workers & background processing        (Phase 4)
Week 5-6:  Integration + extensibility            (Phase 5-6)
Week 6-7:  Testing, security audit                (Phase 7)
Week 8-9:  Beta rollout + monitoring              (Phase 8)
Week 10:   GA launch                              (Phase 9)

Total: 10 weeks (2.5 months) from code start to GA
```

---

## ✅ SIGN-OFF CHECKLIST

Before moving to each phase, verify:

### Pre-Phase 0
- [ ] PM approval on timeline + scope
- [ ] Design review completed
- [ ] Security review scheduled

### Pre-Phase 1
- [ ] Architecture decision signed off
- [ ] Database DBA approval

### Pre-Phase 2-3
- [ ] API contract approved
- [ ] Endpoint names finalized

### Pre-Phase 4
- [ ] Worker architecture reviewed
- [ ] Concurrency & retry strategy approved

### Pre-Phase 7
- [ ] Test plan approved
- [ ] Load test environment ready

### Pre-Phase 8
- [ ] Beta customer list finalized
- [ ] Monitoring dashboards built

### Pre-Phase 10
- [ ] GA readiness checklist passed
- [ ] Legal review (data handling, privacy)
- [ ] Support team trained

---

**Document Version:** 1.0  
**Last Updated:** March 23, 2026  
**Next Review:** Weekly standup syncs
