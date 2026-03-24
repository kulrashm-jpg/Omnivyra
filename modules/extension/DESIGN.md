/**
 * Extension Module Documentation & Design Document
 * 
 * Comprehensive guide to the extension module architecture, design decisions,
 * and production deployment considerations.
 */

// ============================================================================
// TABLE OF CONTENTS
// ============================================================================

/**
 * 1. Architecture Overview
 * 2. Directory Structure
 * 3. Design Decisions
 * 4. Data Flow
 * 5. Authentication & Security
 * 6. Error Handling
 * 7. Assumptions Made
 * 8. Production Roadmap
 * 9. Testing Strategy
 * 10. Troubleshooting
 */

// ============================================================================
// 1. ARCHITECTURE OVERVIEW
// ============================================================================

/**
 * GOAL: Enable Chrome extension to send engagement events to backend
 * without modifying existing engagement_messages infrastructure.
 * 
 * KEY PRINCIPLES:
 * ✓ Isolation: Extension events stored separately (extension_events table)
 * ✓ Non-blocking: Ingest is fire-and-forget (202 Accepted)
 * ✓ Async processing: Worker processes events in background (not implemented here)
 * ✓ User-scoped: All data tied to user_id + org_id
 * ✓ Stateless APIs: HTTP APIs, not WebSocket (MVP)
 * 
 * ARCHITECTURE:
 * 
 * ┌─────────────────────┐
 * │  Chrome Extension   │
 * │  (LinkedIn, YouTube)│
 * └──────────┬──────────┘
 *            │ HTTPS + Bearer token
 *            │
 * ┌──────────▼──────────────────────────────────────┐
 * │ /api/extension/* (Express Routes)               │
 * │  - POST   /events (ingest)                       │
 * │  - GET    /commands (polling)                    │
 * │  - POST   /action-result (report result)         │
 * │  - POST   /validate (session check)              │
 * │  - GET    /health (monitoring)                   │
 * └──────────┬───────────────────────────────────────┘
 *            │
 * ┌──────────▼────────────────────────────────────────┐
 * │ Extension Auth Middleware                         │
 * │ - Validates Bearer token                          │
 * │ - Attaches req.extensionUser (user_id, org_id)   │
 * └──────────┬─────────────────────────────────────────┘
 *            │
 * ┌──────────▼──────────────────────────────────────┐
 * │  Extension Controller                           │
 * │  - Request validation (Zod schemas)             │
 * │  - Response formatting                          │
 * │  - Error handling                               │
 * └──────────┬──────────────────────────────────────┘
 *            │
 * ┌──────────┴──────────┬──────────────┬──────────────┐
 * │                     │              │              │
 * │     ┌───────────┐  │ ┌──────────┐ │ ┌──────────┐ │
 * │  extensionEvent │  │ │extension │ │ │extension │ │
 * │  Service        │  │ │Command   │ │ │Auth      │ │
 * │  - Ingest event │  │ │Service   │ │ │Service   │ │
 * │  - Query events │  │ │- Get cmd │ │ │- Validate│ │
 * │                 │  │ │- Update  │ │ │- Create  │ │
 * │    @Minimal     │  │ │- Delete  │ │ │-Revoke   │ │
 * │    @Logic       │  │ │          │ │ │          │ │
 * │                 │  │ └──────────┘ │ └──────────┘ │
 * └─────────────────┘  └──────────────┴──────────────┘
 *            │                      │                  │
 * ┌──────────▼──────────┐  ┌────────▼─────┐  ┌────────▼────────┐
 * │ extension_events    │  │extension_cmds │  │extension_sessns  │
 * │ In-memory (MVP)     │  │In-memory(MVP) │  │In-memory (MVP)   │
 * │ → PostgreSQL(prod)  │  │→PostgreSQL    │  │→PostgreSQL       │
 * └─────────────────────┘  │→Redis (cache) │  │→Redis (cache)    │
 *                          └───────────────┘  └──────────────────┘
 *            │
 * ┌──────────▼──────────────────────────────────────┐
 * │ Worker (Future: engagement_event_processor)     │
 * │ - Polls extension_events table                  │
 * │ - Maps to engagement_messages (dedup via src)  │
 * │ - Triggers engagement ingestion pipeline        │
 * │ - Marks events as processed                     │
 * └───────────────────────────────────────────────────┘
 */

// ============================================================================
// 2. DIRECTORY STRUCTURE
// ============================================================================

/**
 * /modules/extension/
 * ├── /types
 * │   └── extension.types.ts          # Type definitions (enums, interfaces)
 * │
 * ├── /validators
 * │   └── extensionValidators.ts      # Zod schemas for request validation
 * │
 * ├── /services
 * │   ├── extensionEventService.ts    # Event ingestion & retrieval
 * │   ├── extensionCommandService.ts  # Command management
 * │   └── extensionAuthService.ts     # Session management & auth
 * │
 * ├── /controllers
 * │   └── extensionController.ts      # HTTP request handlers
 * │
 * ├── /routes
 * │   └── extensionRoutes.ts          # Express route definitions
 * │
 * ├── INTEGRATION.md                  # Integration guide for main app
 * └── DESIGN.md                       # This file (design & assumptions)
 * 
 * /middleware/
 * └── extensionAuthMiddleware.ts      # Authentication middleware
 */

// ============================================================================
// 3. DESIGN DECISIONS
// ============================================================================

/**
 * DECISION 1: Separate Auth from Main App
 * ─────────────────────────────────────────────────────────────────
 * WHY: Extension tokens should NOT use main JWT/OAuth
 *      - Different lifecycle (7 days vs 30 minutes)
 *      - Different validation rules (crypto signature vs JWT)
 *      - Can be revoked independently
 *      - Simplifies security model
 * 
 * TRADE-OFF: Added complexity of separate auth system
 * MITIGATION: Simple in-memory store initially, upgrade to Redis later
 * 
 * 
 * DECISION 2: Fire-and-Forget Event Ingest (202 Accepted)
 * ─────────────────────────────────────────────────────────────────
 * WHY: Never block extension UI on API response
 *      - Extension must feel instant (< 100ms)
 *      - Real processing happens in background worker
 *      - Higher throughput
 * 
 * API Flow:
 *   Extension → POST /events
 *   ↓ (validate + queue)
 *   Backend ← 202 Accepted (1-2ms)
 *   Extension [waits for /commands poll]
 *   
 *   Background:
 *   Worker picks up → processes → maps to engagement_messages
 * 
 * TRADE-OFF: Cannot return processing result immediately
 * SOLUTION: Extension checks /commands for feedback, or call /validate for sync
 * 
 * 
 * DECISION 3: In-Memory Store (MVP) → PostgreSQL (Production)
 * ─────────────────────────────────────────────────────────────────
 * WHY: MVP must launch fast
 *      - No time for database schema design
 *      - Can prove concept with simple store
 *      - Spring-like testing without DB
 * 
 * MIGRATION PATH:
 *   - ServiceInterface stays same
 *   - Swap implementation: MemStore → Database
 *   - No breaking API changes
 *   - Backward compatible
 * 
 * SQL Templates provided in INTEGRATION.md
 * 
 * 
 * DECISION 4: Zod for Validation (not JSON Schema)
 * ─────────────────────────────────────────────────────────────────
 * WHY:
 *   ✓ TypeScript-first (gets types from schema)
 *   ✓ Chainable & readable (better DX)
 *   ✓ Zero runtime dependencies
 *   ✓ Smaller bundle than Joi
 * 
 * ALTERNATIVE: Joi would work equally well
 * 
 * 
 * DECISION 5: No WebSocket (HTTP polling for MVP)
 * ─────────────────────────────────────────────────────────────────
 * WHY: Simpler to deploy and test
 *      - No WebSocket connection management
 *      - Stateless (scales horizontally)
 *      - Works behind proxies (no special config)
 * 
 * LATENCY: 30-second polling acceptable for MVP
 * UPGRADE: Can add real-time webhook later (sync_mode='webhook')
 *
 * 
 * DECISION 6: Minimal Processing in Services
 * ─────────────────────────────────────────────────────────────────
 * WHY: Keep service logic simple & testable
 *      - Event ingest = validate + store only
 *      - No scoring, no dedup, no mapping yet
 *      - Worker handles complex logic
 * 
 * BOUNDARY: Service = CRUD ops
 *           Worker = business logic
 * 
 * 
 * DECISION 7: User + Org Scoping for All Queries
 * ─────────────────────────────────────────────────────────────────
 * WHY: Multi-tenant isolation
 *      - Prevent cross-org data leaks
 *      - Matches existing Omnivyra model
 *      - Future RLS (Row-Level Security) compatible
 * 
 * PATTERN:
 *   // Always passed together
 *   await eventService.getRecentEvents(user_id, org_id);
 *   
 *   // Database would have:
 *   WHERE user_id = $1 AND org_id = $2
 */

// ============================================================================
// 4. DATA FLOW
// ============================================================================

/**
 * FLOW 1: Extension ingests a comment
 * ──────────────────────────────────
 * 
 * 1. User reads LinkedIn comment in browser
 * 2. Extension captures event:
 *    {
 *      "platform": "linkedin",
 *      "event_type": "comment",
 *      "data": { ... platform-specific ... },
 *      "timestamp": 1679596800000
 *    }
 * 
 * 3. Extension builds request:
 *    POST /api/extension/events
 *    Authorization: Bearer <session_token>
 *    Content-Type: application/json
 *    Body: { ... }
 * 
 * 4. Backend receives:
 *    - Auth middleware validates token
 *    - Extracts user_id, org_id from session
 *    - Controller validates request body (Zod)
 *    - Creates ValidatedExtensionEvent
 *    - Passes to service
 * 
 * 5. Service:
 *    - Generates UUID (event_id)
 *    - Saves to extension_events table
 *    - Returns event_id
 * 
 * 6. Backend responds:
 *    202 Accepted
 *    {
 *      "success": true,
 *      "data": { "event_id": "..." }
 *    }
 * 
 * 7. Extension:
 *    - Stores event_id locally for dedup
 *    - Shows success notification
 *    - Resumes normal operation
 * 
 * 8. Background (async, NOT in critical path):
 *    - Worker polls extension_events table
 *    - Maps to engagement_messages (via source='extension')
 *    - Deduplication: checks if same message already in DB
 *    - Triggers engagement pipeline
 *    - Marks event as processed
 * 
 * TOTAL LATENCY: < 30 seconds (until processed)
 * USER IMPACT: None (async)
 * 
 * 
 * FLOW 2: Extension polls for commands
 * ────────────────────────────────────
 * 
 * 1. Extension runs polling loop (every 30 seconds):
 *    GET /api/extension/commands?platform=linkedin&limit=10
 *    Authorization: Bearer <session_token>
 * 
 * 2. Backend:
 *    - Validates auth token
 *    - Queries extension_commands table
 *    - Filters: user_id, org_id, status='pending', platform=linkedin
 *    - Orders by created_at (FIFO)
 *    - Returns up to 10 commands
 * 
 * 3. Sample response:
 *    {
 *      "success": true,
 *      "data": [
 *        {
 *          "command_id": "uuid",
 *          "action_type": "post_reply",
 *          "target_id": "comment_id",
 *          "payload": { "text": "..." }
 *        }
 *      ]
 *    }
 * 
 * 4. Extension:
 *    - Executes commands (post reply, like, etc)
 *    - Catches platform errors
 * 
 * 5. Extension reports result:
 *    POST /api/extension/action-result
 *    {
 *      "command_id": "uuid",
 *      "status": "success",
 *      "result": { ... }
 *    }
 * 
 * 6. Backend:
 *    - Updates extension_commands table
 *    - Stores result (for audit)
 *    - Emits event for post-processing (credit deduction, etc)
 * 
 * 
 * FLOW 3: Extension validates session on startup
 * ───────────────────────────────────────────
 * 
 * 1. Extension startup:
 *    POST /api/extension/validate
 *    {
 *      "session_token": "hex_string"
 *    }
 * 
 * 2. Backend:
 *    - Validates token
 *    - Returns session config + user info
 * 
 * 3. Response:
 *    {
 *      "valid": true,
 *      "user_id": "uuid",
 *      "org_id": "uuid",
 *      "sync_mode": "batch",
 *      "polling_interval": 30
 *    }
 * 
 * 4. Extension:
 *    - If valid=false, show login screen
 *    - If valid=true, start polling loop with polling_interval
 */

// ============================================================================
// 5. AUTHENTICATION & SECURITY
// ============================================================================

/**
 * THREAT MODEL
 * ────────────
 * 
 * Threat 1: Token theft / Man-in-the-middle
 * ──────────────────────────────────────────
 * Mitigation:
 *  ✓ Force HTTPS only (no HTTP fallback)
 *  ✓ Token is 256-bit random (64 hex chars), not guessable
 *  ✓ Token expires after 7 days
 *  ✓ User can revoke token immediately
 *  ✓ Store token hash (not plaintext) in database
 * 
 * Control: Browser extension runs in sandbox, cannot be inspected by malicious code
 * Control: Token never stored in localStorage (only in memory + session storage)
 * 
 * 
 * Threat 2: Cross-site request forgery (CSRF)
 * ────────────────────────────────────────────
 * Not applicable: Extension uses Bearer token, not cookies
 * 
 * 
 * Threat 3: Cross-org data leak
 * ──────────────────────────────
 * Mitigation:
 *  ✓ Token bound to org_id (token = user_id + org_id)
 *  ✓ All queries filter by org_id
 *  ✓ Future: Enable RLS (Row-Level Security) in PostgreSQL
 * 
 * Control: Cannot query other org's data even with valid token (org scoped)
 * 
 * 
 * Threat 4: Brute force token guessing
 * ──────────────────────────────────────
 * Not feasible: Token is 256-bit, would take 2^128 guesses on average
 * 
 * Mitigation: (future)
 *  - Rate limit /validate endpoint
 *  - Log failed validation attempts
 *  - Alert on suspicious patterns
 * 
 * 
 * TOKEN LIFECYCLE
 * ───────────────
 * 
 * 1. Creation:
 *    - User logs into Omnivyra web app
 *    - Admin panel generates extension session token
 *    - Browser extension receives token (via QR scan, copy-paste, or OAuth)
 * 
 * 2. Storage (Extension):
 *    - NOT in localStorage (survives page refresh, vulnerable to XSS)
 *    - In memory + sessionStorage (cleared on page close)
 *    - Regenerate on every reload (session-based)
 * 
 * 3. Usage:
 *    - Extension includes in every API request header:
 *      Authorization: Bearer <token>
 * 
 * 4. Validation (Backend):
 *    - Middleware validates token vs sessionStore
 *    - Extracts user_id + org_id
 *    - Checks expiration
 * 
 * 5. Revocation:
 *    - User clicks "Logout" in admin panel
 *    - Backend calls authService.revokeSession(token)
 *    - Removes from sessionStore immediately
 *    - Extension tries next request → 401 Unauthorized
 *    - Extension shows "Please log in again"
 * 
 * 6. Expiration:
 *    - Token expires after 7 days (configurable)
 *    - Cleanup task runs hourly, purges expired tokens
 *    - Extension proactively refreshes before expiry
 * 
 * 
 * PRODUCTION CHECKLIST
 * ────────────────────
 * 
 * ☐ Force HTTPS in production (no HTTP)
 * ☐ Migrate sessionStore to Redis (more resilient)
 * ☐ Implement rate limiting on /validate endpoint
 * ☐ Add request signing (HMAC-SHA256, future)
 * ☐ Audit logging (all auth events)
 * ☐ Monitor failed auth attempts
 * ☐ Regular security audit of auth service
 * ☐ Implement token refresh mechanism (rotate tokens)
 * ☐ Document for security team
 */

// ============================================================================
// 6. ERROR HANDLING
// ============================================================================

/**
 * ERROR CATEGORIZATION
 * ────────────────────
 * 
 * CLIENT ERRORS (4xx)
 * ─────────────────
 * 
 * 400 Bad Request:
 *   - Invalid request body
 *   - Zod validation failure
 *   - Missing required fields
 * 
 * Example:
 * ```
 * curl -X POST /api/extension/events \
 *   -H "Authorization: Bearer token" \
 *   -H "Content-Type: application/json" \
 *   -d '{"platform": "invalid_platform"}'
 * 
 * Response:
 * 400 Bad Request
 * {
 *   "success": false,
 *   "error": "Validation error: [\"platform\"] is not a valid enum value",
 *   "timestamp": 1679596800000
 * }
 * ```
 * 
 * 401 Unauthorized:
 *   - Missing Authorization header
 *   - Invalid token
 *   - Expired token
 *   - Revoked token
 * 
 * Example:
 * ```
 * curl -X GET /api/extension/commands
 * 
 * Response:
 * 401 Unauthorized
 * {
 *   "success": false,
 *   "error": "Missing or invalid Authorization header",
 *   "timestamp": 1679596800000
 * }
 * ```
 * 
 * 404 Not Found:
 *   - Command not found by ID
 *   - Event not found
 * 
 * 
 * SERVER ERRORS (5xx)
 * ──────────────────
 * 
 * 500 Internal Server Error:
 *   - Unhandled exception in service
 *   - Database connection failure
 *   - Unexpected error in business logic
 * 
 * Should NEVER expose stack trace to client
 * Log full error server-side for debugging
 * 
 * Example:
 * ```
 * Response:
 * 500 Internal Server Error
 * {
 *   "success": false,
 *   "error": "Failed to ingest event",
 *   "timestamp": 1679596800000
 * }
 * 
 * Server logs:
 * [ExtensionEventService] ingestEvent error: TypeError: Cannot read property 'org_id'...
 * ```
 * 
 * 
 * EXTENSION ERROR HANDLING
 * ──────────────────────
 * 
 * Extension should:
 * 
 * 1. On 202 Accepted (success):
 *    - Proceed normally
 *    - Cache event_id locally
 * 
 * 2. On 400 Bad Request (client error):
 *    - Log validation error
 *    - DO NOT retry (same request will fail again)
 *    - Show error notification: "Invalid data"
 * 
 * 3. On 401 Unauthorized:
 *    - Show login prompt
 *    - Clear cached token
 *    - User must log in again
 * 
 * 4. On 500 Internal Server Error:
 *    - Retry with exponential backoff (30s, 60s, 120s)
 *    - After 3 retries, show: "Server error, try again later"
 *    - Continue polling for commands (don't block user)
 * 
 * 5. On network timeout/connection refused:
 *    - Retry immediately (user might be offline briefly)
 *    - After 30s of failures, show: "Network error"
 *    - Keep retrying in background
 */

// ============================================================================
// 7. ASSUMPTIONS MADE
// ============================================================================

/**
 * RUNTIME ASSUMPTIONS
 * ───────────────────
 * 
 * 1. Single-server deployment (MVP only)
 *    - Sessions stored in process memory
 *    - If server crashes, all sessions lost
 *    - Scale-up: Migrate to Redis (shared store)
 * 
 * 2. Extension has access to browser APIs
 *    - Can intercept page events
 *    - Can read DOM
 *    - Can execute JavaScript on LinkedIn/YouTube
 *    - (Manifest V3 compatible)
 * 
 * 3. User has stable network connection
 *    - No offline-first sync
 *    - No local queue for failed events
 *    - Design: If network fails, extension shows error
 * 
 * 4. Token never shared across devices/browsers
 *    - Token is per-browser extension instance
 *    - Each device gets unique token
 *    - Backend doesn't track device info (yet)
 * 
 * 5. No real-time sync with engagement dashboard
 *    - What user sees in extension != dashboard (until processed)
 *    - Eventually consistent (within Worker processing time)
 * 
 * 
 * DATABASE ASSUMPTIONS
 * ───────────────────
 * 
 * 1. PostgreSQL available (production)
 *    - extension_events, extension_commands, extension_sessions tables exist
 *    - RLS policies configured per organization
 *    - Indexes present on critical columns
 * 
 * 2. Users and Organizations tables exist
 *    - Foreign key: user_id → users(id)
 *    - Foreign key: org_id → organizations(id)
 * 
 * 3. No constraint on event duplicates
 *    - Same event can be inserted twice by extension (accidental)
 *    - Dedup happens later in Worker (not here)
 * 
 * 4. Cluster can handle 100k events/min
 *    - Assumption based on scale expectations
 *    - Adjust based on actual load testing
 * 
 * 
 * BUSINESS LOGIC ASSUMPTIONS
 * ──────────────────────────
 * 
 * 1. Credit deduction happens in separate service
 *    - Extension module does NOT deduct credits
 *    - Post-execution hooks call creditDeductionService
 * 
 * 2. Opportunity detection happens in background worker
 *    - Not in critical path
 *    - Triggered asynchronously after event processing
 * 
 * 3. Extension commands created by separate service
 *    - E.g., when AI reply generated
 *    - Extension module just retrieves + stores results
 *    - Not responsible for creating commands
 * 
 * 4. Organization billing based on command success count
 *    - Not event ingest count
 *    - Only successful executions deduct credits
 * 
 * 
 * API CONTRACT ASSUMPTIONS
 * ──────────────────────
 * 
 * 1. Extension can handle 202 Accepted response
 *    - Means "accepted but not processed yet"
 *    - Results available later via /commands or webhook
 * 
 * 2. Extension polls /commands every 30 seconds
 *    - Not configurable per-request (set at session creation)
 *    - Can be changed in admin panel per organization
 * 
 * 3. Extension sends heartbeat (implicit via polling)
 *    - No explicit heartbeat endpoint needed
 *    - We can infer "online" from recent requests
 * 
 * 4. Extension can handle out-of-order commands
 *    - Commands not necessarily FIFO
 *    - Just marked as pending until execution reported
 */

// ============================================================================
// 8. PRODUCTION ROADMAP
// ============================================================================

/**
 * PHASE 1: MVP (Current - Weeks 1-2)
 * ──────────────────────────────────
 * ✓ In-memory store
 * ✓ HTTP polling
 * ✓ Session-based auth
 * ✓ 4 core endpoints
 * ✓ Basic error handling
 * 
 * Not included:
 * - Database persistence
 * - Real-time webhooks
 * - Advanced security (request signing)
 * - Rate limiting
 * - Telemetry
 * 
 * 
 * PHASE 2: Hardening (Weeks 3-4)
 * ───────────────────────────────
 * ☐ Migrate to PostgreSQL storage
 * ☐ Add rate limiting (100 req/min per extension)
 * ☐ Implement request logging / audit trail
 * ☐ Add monitoring & alerts
 * ☐ Load testing (target: 100k events/min)
 * ☐ Security audit by 3rd party
 * 
 * 
 * PHASE 3: Advanced Features (Weeks 5-6)
 * ───────────────────────────────────────
 * ☐ Webhook callbacks (real-time vs polling)
 * ☐ Request signing (HMAC-SHA256)
 * ☐ Extension telemetry dashboard
 * ☐ Multi-message-type support (DMs, mentions)
 * ☐ Batch event upload (reduce API calls)
 * 
 * 
 * PHASE 4: Scale & Optimize (Weeks 7-10)
 * ───────────────────────────────────────
 * ☐ Migrate sessionStore to Redis
 * ☐ Add caching layer (Redis)
 * ☐ Implement circuit breaker (handle platform API failures)
 * ☐ Performance profiling & optimization
 * ☐ Database query optimization
 * ☐ Horizontal scaling testing
 * 
 * 
 * STORAGE MIGRATION GUIDE
 * ─────────────────────
 * 
 * Step 1: Create database schema (SQL in INTEGRATION.md)
 * Step 2: Add a feature flag: use_db_for_extension_service=false
 * Step 3: Create ExtensionEventServiceDB extends IExtensionEventService
 * Step 4: Update controller to use:
 *         const service = featureFlag.enabled ? new ExtensionEventServiceDB() : extensionEventService;
 * Step 5: Test both implementations in parallel
 * Step 6: Flip feature flag to true
 * Step 7: Deprecate in-memory store
 * 
 * Result: Zero downtime migration
 */

// ============================================================================
// 9. TESTING STRATEGY
// ============================================================================

/**
 * UNIT TESTS
 * ──────────
 * 
 * Test extensionEventService.ts:
 * ✓ ingestEvent() returns valid UUID
 * ✓ getEvent() returns null for missing event
 * ✓ getRecentEvents() returns sorted by timestamp
 * ✓ getEventCounts() returns zero for new user
 * 
 * Test extensionCommandService.ts:
 * ✓ createCommand() generates UUID
 * ✓ getPendingCommands() filters by status
 * ✓ updateCommandStatus() changes status
 * ✓ cleanupExpiredCommands() removes expired
 * 
 * Test extensionAuthService.ts:
 * ✓ createSession() returns valid session
 * ✓ validateSession() returns null for invalid token
 * ✓ validateSession() returns null for expired session
 * ✓ revokeSession() removes from store
 * 
 * Test validators:
 * ✓ Valid event passes schema
 * ✓ Invalid platform rejected
 * ✓ Missing required field rejected
 * ✓ Extra fields ignored
 * 
 * 
 * INTEGRATION TESTS
 * ─────────────────
 * 
 * Test full flow:
 * ✓ POST /api/extension/validate with token
 * ✓ Receive valid session config
 * ✓ POST /api/extension/events with Bearer token
 * ✓ Receive 202 Accepted + event_id
 * ✓ GET /api/extension/commands with Bearer token
 * ✓ Receive empty array (no commands yet)
 * ✓ POST /api/extension/action-result with valid format
 * ✓ Receive success response
 * 
 * Test error cases:
 * ✓ POST /events without Authorization header → 401
 * ✓ POST /events with invalid token → 401
 * ✓ POST /events with invalid JSON → 400
 * ✓ POST /events with wrong enum value → 400
 * ✓ GET /commands with expired token → 401
 * 
 * 
 * LOAD TESTS
 * ──────────
 * 
 * Target: 100k events/min sustained
 * Test script: wrk or Apache JMeter
 * 
 * Scenario 1: Event ingestion
 * - 100 concurrent connections
 * - POST /events in loop
 * - Measure: p50, p95, p99 latency
 * - Target: p99 < 100ms
 * 
 * Scenario 2: Command polling
 * - 1000 concurrent extensions
 * - GET /commands
 * - Measure: throughput, latency
 * - Target: > 10k req/sec
 * 
 * Scenario 3: Action result reporting
 * - 500 concurrent
 * - POST /action-result
 * - Measure: success rate
 * - Target: 99.9% success
 * 
 * 
 * MANUAL TESTING
 * ──────────────
 * 
 * 1. Create session token:
 *    curl -X POST http://localhost:3000/api/admin/extension-session \
 *      -H "Content-Type: application/json" \
 *      -d '{"user_id": "...", "org_id": "..."}'
 * 
 * 2. Validate session:
 *    curl -X POST http://localhost:3000/api/extension/validate \
 *      -H "Content-Type: application/json" \
 *      -d '{"session_token": "..."}'
 * 
 * 3. Ingest event:
 *    curl -X POST http://localhost:3000/api/extension/events \
 *      -H "Authorization: Bearer ..." \
 *      -H "Content-Type: application/json" \
 *      -d '{"platform": "linkedin", "event_type": "comment", ...}'
 * 
 * 4. Check health:
 *    curl http://localhost:3000/api/extension/health
 * 
 * 5. Monitor memory:
 *    node --inspect scripts/monitor-extension.js
 *    Open chrome://inspect
 */

// ============================================================================
// 10. TROUBLESHOOTING
// ============================================================================

/**
 * ISSUE: "Missing or invalid Authorization header"
 * ─────────────────────────────────────────────
 * 
 * Symptom: 401 response on /events endpoint
 * 
 * Checklist:
 * ☐ Token is included in Authorization header
 * ☐ Format is: "Bearer <token>" (case-sensitive)
 * ☐ No extra spaces: "Bearer<token>" ← wrong
 * ☐ Token looks like: 64-character hex string
 * ☐ Token created less than 7 days ago
 * ☐ Token not revoked by user
 * 
 * Debug:
 * ```bash
 * # Check token format
 * echo "your-token" | wc -c  # Should be 65 (64 + newline)
 * 
 * # Check header format
 * curl -v -X GET http://localhost:3000/api/extension/commands \
 *   -H "Authorization: Bearer your-token"
 * 
 * # Look for "Authorization: Bearer ..." in request headers
 * ```
 * 
 * 
 * ISSUE: Events not being processed
 * ──────────────────────────────────
 * 
 * Symptom: Events received (202 Accepted) but not in engagement_messages
 * 
 * Root cause: Worker not running
 * 
 * Checklist:
 * ☐ engagement_event_processor worker started
 * ☐ Redis connection working
 * ☐ BullMQ queue subscribed
 * ☐ extension_events table populated (check SQL)
 * ☐ Worker logs show no errors
 * 
 * Debug:
 * ```bash
 * # Check if events in store
 * curl http://localhost:3000/api/extension/health
 * # Look for "total_events" count
 * 
 * # Check logs
 * tail -100 logs/extension-service.log | grep -i event
 * tail -100 logs/worker.log | grep -i "extension"
 * 
 * # Manually invoke worker (dev only)
 * npm run worker:engagement-event-processor
 * ```
 * 
 * 
 * ISSUE: Memory leaks / constantly growing memory
 * ──────────────────────────────────────────────
 * 
 * Symptom: Node process memory grows unbounded
 * Root cause: In-memory store not cleaning old data
 * 
 * This is expected in MVP!
 * 
 * Solutions:
 * 1. Add periodic cleanup:
 *    ```typescript
 *    setInterval(() => {
 *      // Remove events older than 7 days
 *      for (const [id, event] of eventStore.entries()) {
 *        if (Date.now() - event.timestamp > 7 * 24 * 60 * 60 * 1000) {
 *          eventStore.delete(id);
 *        }
 *      }
 *    }, 3600000); // every hour
 *    ```
 * 
 * 2. Restart process daily (k8s CronJob)
 * 
 * 3. Migrate to PostgreSQL (permanent fix)
 * 
 * 
 * ISSUE: 500 Internal Server Error on random requests
 * ────────────────────────────────────────────────────
 * 
 * Symptom: POST /events returns 500
 * 
 * Checklist:
 * ☐ Request body valid JSON
 * ☐ All required fields present
 * ☐ No null values in obj
 * ☐ timestamp is number
 * ☐ User exists in database
 * ☐ Organization exists in database
 * 
 * Debug:
 * ```bash
 * # Enable verbose logging
 * DEBUG=extension:* node app.js
 * 
 * # Check server logs
 * tail -100 logs/error.log
 * 
 * # Try minimal payload
 * curl -X POST http://localhost:3000/api/extension/events \
 *   -H "Authorization: Bearer ..." \
 *   -d '{
 *     "platform": "linkedin",
 *     "event_type": "comment",
 *     "data": {},
 *     "timestamp": '$(date +%s)'000
 *   }'
 * ```
 */
