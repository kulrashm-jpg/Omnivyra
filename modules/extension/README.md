# Extension Module - Chrome Extension Integration

Complete production-grade backend module for Chrome extension communication with Omnivyra's engagement system.

## Overview

This module enables a Chrome extension (LinkedIn, YouTube) to:
- Send engagement events (comments, DMs, mentions, likes) to the backend
- Poll for pending commands (reply, like, follow, etc.)
- Report execution results back to the backend
- Maintain isolated session tokens for authentication

**Key Features:**
- ✅ Zero modifications to existing engagement system
- ✅ Event isolation (separate `extension_events` table)
- ✅ Async processing (fire-and-forget 202 responses)
- ✅ Multi-tenant scoped (org_id isolation)
- ✅ Type-safe with Zod validation
- ✅ Production-ready error handling
- ✅ Comprehensive logging & monitoring

## Project Structure

```
/modules/extension
├── /types
│   └── extension.types.ts          # Type definitions & interfaces
├── /validators
│   └── extensionValidators.ts      # Zod schemas
├── /services
│   ├── extensionEventService.ts    # Event ingestion
│   ├── extensionCommandService.ts  # Command management
│   └── extensionAuthService.ts     # Session auth
├── /controllers
│   └── extensionController.ts      # HTTP handlers
├── /routes
│   └── extensionRoutes.ts          # Express route definitions
├── INTEGRATION.md                  # Integration guide
└── DESIGN.md                       # Architecture & design decisions

/middleware
└── extensionAuthMiddleware.ts      # Extension session validation
```

## Core Components

### 1. **extensionAuthService.ts**
Manages extension session tokens (7-day lifetime).

```typescript
// Create session
const session = await extensionAuthService.createSession(user_id, org_id);
// → Returns: { session_token, user_id, org_id, polling_interval: 30 }

// Validate token
const session = await extensionAuthService.validateSession(token);
// → Returns: session object or null

// Revoke token
await extensionAuthService.revokeSession(token);
```

### 2. **extensionEventService.ts**
Handles Chrome extension event ingestion.

```typescript
// Ingest event from extension
const result = await eventService.ingestEvent({
  user_id, org_id, platform, event_type, data, source
});
// → Returns: { event_id: "uuid" }

// Query recent events
const events = await eventService.getRecentEvents(user_id, org_id, limit: 100);

// Analytics
const counts = await eventService.getEventCounts(user_id, org_id);
// → Returns: { comment: 5, dm: 2, mention: 1, ... }
```

### 3. **extensionCommandService.ts**
Manages commands queued for extension execution.

```typescript
// Get pending commands (extension polling)
const pending = await commandService.getPendingCommands(
  user_id, org_id, platform='linkedin', limit: 10
);

// Update command status after execution
const updated = await commandService.updateCommandStatus(
  command_id, status='success', result: {...}
);

// Create command (called by AI service when reply generated)
const cmd = await commandService.createCommand(
  user_id, org_id, { platform, action_type, target_id, payload }
);
```

### 4. **extensionAuthMiddleware.ts**
Validates Bearer tokens and attaches user context.

```typescript
// Applied to protected routes
router.use(extensionAuthMiddleware(authService));

// Provides req.extensionUser = { user_id, org_id, session_token }
```

## API Endpoints

### POST `/api/extension/events`
Extension sends engagement event.

**Request:**
```bash
curl -X POST http://localhost:3000/api/extension/events \
  -H "Authorization: Bearer <session_token>" \
  -H "Content-Type: application/json" \
  -d {
    "platform": "linkedin",
    "event_type": "comment",
    "data": {
      "thread_id": "post_123",
      "comment_id": "comment_456",
      "comment_text": "Great insight!",
      "author": {
        "name": "John Doe",
        "profile_url": "https://linkedin.com/in/johndoe",
        "profile_id": "johndoe_123"
      },
      "created_at": 1679596800000
    },
    "timestamp": 1679596800000
  }
```

**Response (202 Accepted):**
```json
{
  "success": true,
  "data": {
    "event_id": "550e8400-e29b-41d4-a716-446655440000"
  },
  "timestamp": 1679596800000
}
```

---

### GET `/api/extension/commands`
Extension polls for pending commands.

**Request:**
```bash
curl "http://localhost:3000/api/extension/commands?platform=linkedin&limit=10" \
  -H "Authorization: Bearer <session_token>"
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": [
    {
      "command_id": "660e8400-f29b-41d4-a716-446655441234",
      "platform": "linkedin",
      "action_type": "post_reply",
      "target_id": "comment_987654321",
      "payload": {
        "text": "Thanks for the comment! Here's my take..."
      },
      "created_at": "2026-03-23T12:00:00.000Z",
      "expires_at": "2026-03-23T12:15:00.000Z",
      "status": "pending"
    }
  ],
  "timestamp": 1679596800000
}
```

---

### POST `/api/extension/action-result`
Extension reports command execution result.

**Request:**
```bash
curl -X POST http://localhost:3000/api/extension/action-result \
  -H "Authorization: Bearer <session_token>" \
  -H "Content-Type: application/json" \
  -d {
    "command_id": "660e8400-f29b-41d4-a716-446655441234",
    "status": "success",
    "result": {
      "success": true,
      "message": "Reply posted successfully",
      "platform_response": {
        "post_id": "reply_123456789",
        "timestamp": 1679596800000
      }
    }
  }
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": { "status": "success" },
  "timestamp": 1679596800000
}
```

---

### POST `/api/extension/validate`
Extension validates session on startup.

**Request:**
```bash
curl -X POST http://localhost:3000/api/extension/validate \
  -H "Content-Type: application/json" \
  -d {
    "session_token": "3c5a5c7d9f2e1a8b4c6d9e1f3a5b7c9d1e2f4a5b6c7d8e9f0a1b2c3d4e5f6a"
  }
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "valid": true,
    "user_id": "123e4567-e89b-12d3-a456-426614174000",
    "org_id": "987f6543-cb21-43d2-b456-987654321000",
    "sync_mode": "batch",
    "polling_interval": 30
  },
  "timestamp": 1679596800000
}
```

---

### GET `/api/extension/health`
Health check for monitoring systems.

**Response:**
```json
{
  "success": true,
  "data": {
    "status": "healthy",
    "events": {
      "total_events": 1234,
      "unprocessed_events": 45,
      "by_platform": { "linkedin": 800, "youtube": 434 },
      "by_event_type": {
        "comment": 600,
        "dm": 200,
        "mention": 100,
        "like": 250,
        "share": 84,
        "reply": 0
      }
    },
    "commands": {
      "total_commands": 567,
      "pending": 23,
      "executing": 2,
      "success": 520,
      "failed": 22,
      "cancelled": 0
    },
    "timestamp": "2026-03-23T12:34:56.000Z"
  },
  "timestamp": 1679596800000
}
```

## Integration

### Step 1: Mount Routes
```typescript
import extensionRoutes from './modules/extension/routes/extensionRoutes';

const app = express();
app.use('/api/extension', extensionRoutes);
```

### Step 2: Start Cleanup Tasks
```typescript
import { 
  startSessionCleanup, 
  startCommandCleanup 
} from './modules/extension/services';

// Clean up expired sessions/commands hourly
const sessionTimer = startSessionCleanup(3600000);
const commandTimer = startCommandCleanup(3600000);

// On shutdown:
process.on('SIGTERM', () => {
  clearInterval(sessionTimer);
  clearInterval(commandTimer);
  server.close();
});
```

### Step 3: Create Session (Testing)
```bash
# Admin endpoint to create extension session
curl -X POST http://localhost:3000/api/admin/extension-session \
  -H "Content-Type: application/json" \
  -d {
    "user_id": "550e8400-e29b-41d4-a716-446655440000",
    "org_id": "660e8400-e29b-41d4-a716-446655441111"
  }
```

Complete integration guide: [INTEGRATION.md](./INTEGRATION.md)

## Database Schema (Production)

Required PostgreSQL tables:

```sql
-- Events from extension
CREATE TABLE extension_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  org_id UUID NOT NULL REFERENCES organizations(id),
  platform TEXT NOT NULL CHECK (platform IN ('linkedin', 'youtube')),
  event_type TEXT NOT NULL,
  data JSONB NOT NULL,
  source TEXT DEFAULT 'extension',
  created_at TIMESTAMP DEFAULT NOW(),
  processed BOOLEAN DEFAULT FALSE,
  processed_at TIMESTAMP
);
CREATE INDEX idx_extension_events_user_org ON extension_events(user_id, org_id);

-- Commands queuing for execution
CREATE TABLE extension_commands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  org_id UUID NOT NULL,
  platform TEXT NOT NULL,
  action_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT DEFAULT 'pending',
  result JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP NOT NULL,
  executed_at TIMESTAMP
);
CREATE INDEX idx_extension_commands_status ON extension_commands(status, created_at);

-- Session tokens
CREATE TABLE extension_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  org_id UUID NOT NULL,
  token TEXT NOT NULL UNIQUE,
  sync_mode TEXT DEFAULT 'batch',
  polling_interval INTEGER DEFAULT 30,
  created_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP NOT NULL,
  revoked_at TIMESTAMP
);
CREATE INDEX idx_extension_sessions_token ON extension_sessions(token);
```

## Type Safety

All types are exported from `extension.types.ts`:

```typescript
import {
  ValidatedExtensionEvent,
  ExtensionCommand,
  ExtensionSession,
  PlatformType,
  EventType,
  CommandStatus,
} from './types/extension.types';
```

## Validation

All requests validated with Zod schemas:

```typescript
import {
  ExtensionEventRequestSchema,
  ValidateSessionRequestSchema,
  CommandResultRequestSchema,
} from './validators/extensionValidators';
```

Validation errors return 400 Bad Request with details:
```json
{
  "success": false,
  "error": "Validation error: [\"platform\"] is not a valid enum value",
  "timestamp": 1679596800000
}
```

## Error Handling

| Status | Meaning | Retry? |
|--------|---------|--------|
| 202 Accepted | Event queued | No |
| 200 OK | Success | No |
| 400 Bad Request | Invalid payload | No |
| 401 Unauthorized | Invalid/expired token | Yes (re-auth) |
| 500 Internal Error | Server error | Yes (exponential backoff) |

## Assumptions

1. **MVP uses in-memory storage** - Suitable for ~100k events before restart needed
2. **Single-server deployment** - Sessions lost on restart
3. **Extension has stable network** - No offline sync
4. **HTTP polling only** - WebSocket not yet implemented
5. **Dedup happens in worker** - Not in critical path
6. **User/Org must exist** - Foreign key constraints enforced
7. **No request signing** - HTTPS security sufficient for MVP

See [DESIGN.md](./DESIGN.md) for detailed assumptions.

## Testing

### Unit Tests
```bash
npm test -- modules/extension
```

### Integration Tests
```bash
npm test:integration -- modules/extension
```

### Manual Testing
```bash
# Start server
npm run dev

# Run test script
curl -X POST http://localhost:3000/api/admin/extension-session \
  -H "Content-Type: application/json" \
  -d '{"user_id": "...", "org_id": "..."}'
```

## Troubleshooting

**"Missing or invalid Authorization header"**
- Ensure token is included in header
- Format: `Authorization: Bearer <64-char-hex-token>`
- Token must be created less than 7 days ago

**Events not being processed**
- Check Worker is running: `npm run worker:engagement-event-processor`
- Check Redis connection
- Check logs for extension event processor errors

**Memory growing unbounded**
- In-memory store grows without cleanup
- Temporary: Restart process daily
- Permanent: Migrate to PostgreSQL

See [DESIGN.md](./DESIGN.md) for more troubleshooting.

## Production Roadmap

**Phase 1 (MVP):** In-memory store, HTTP polling ✓
**Phase 2:** PostgreSQL migration, rate limiting, monitoring
**Phase 3:** Real-time webhooks, request signing, telemetry
**Phase 4:** Redis caching, horizontal scaling, optimization

## Key Files

| File | Purpose |
|------|---------|
| `extension.types.ts` | Type definitions & interfaces |
| `extensionValidators.ts` | Zod schemas for validation |
| `extensionAuthService.ts` | Session token management |
| `extensionEventService.ts` | Event ingestion & tracking |
| `extensionCommandService.ts` | Command queue management |
| `extensionController.ts` | HTTP request handlers |
| `extensionRoutes.ts` | Express route definitions |
| `extensionAuthMiddleware.ts` | Bearer token validation |
| `INTEGRATION.md` | Integration guide |
| `DESIGN.md` | Architecture & design decisions |

## Contributing

When modifying the extension module:

1. Maintain isolation from engagement system
2. Keep services minimal (CRUD only)
3. Use TypeScript strict mode
4. Add Zod validation for all inputs
5. Log errors with context
6. Update types in `extension.types.ts`
7. Update tests
8. Document decisions in `DESIGN.md`

## Support

See [DESIGN.md](./DESIGN.md) for:
- Detailed architecture overview
- Data flow diagrams
- Security threat model
- Production deployment checklist
- Troubleshooting guide

## License

Part of Omnivyra systems. Proprietary.
