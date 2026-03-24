## PostgreSQL Schema Application Guide

Quick reference for deploying the extension module schema.

---

## 1. PRE-DEPLOYMENT CHECKLIST

```bash
# Verify connection to target database
psql -U postgres -h localhost -d omnivyra -c "SELECT version();"

# Backup existing database
pg_dump -U postgres -h localhost omnivyra > omnivyra_backup_$(date +%Y%m%d).sql

# Verify schema file exists
ls -lh modules/extension/database/extension_schema.sql
```

---

## 2. APPLY SCHEMA

### Option A: Direct SQL File

```bash
# Single transaction (safest)
psql -U postgres -h localhost -d omnivyra < modules/extension/database/extension_schema.sql

# Verify tables created
psql -U postgres -h localhost -d omnivyra -c "
  SELECT table_name FROM information_schema.tables 
  WHERE table_schema = 'public' AND table_name LIKE 'extension_%';
"
```

### Option B: Programmatic (Node.js)

```typescript
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const schemaSQL = fs.readFileSync(
  'modules/extension/database/extension_schema.sql',
  'utf-8'
);

// Split by statements and execute
const statements = schemaSQL.split('--').filter(s => s.trim());

for (const stmt of statements) {
  if (stmt.includes('CREATE TABLE') || stmt.includes('CREATE INDEX')) {
    try {
      const { error } = await supabase.rpc('exec', { sql: stmt });
      if (error) console.error('Error:', error);
      else console.log('✓ Executed:', stmt.substring(0, 50));
    } catch (err) {
      console.error('Failed:', err);
    }
  }
}
```

---

## 3. VERIFY SCHEMA

```sql
-- Check tables
\dt extension_*

-- Check indexes
\di extension_*

-- Check RLS is enabled
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE tablename LIKE 'extension_%';

-- Sample data
SELECT * FROM extension_events LIMIT 1;
SELECT * FROM extension_commands LIMIT 1;
```

Expected output:
```
              List of relations
 Schema |              Name              | Type  | 
--------+--------------------------------+-------+
 public | extension_commands             | table | 
 public | extension_events               | table | 
 public | extension_sessions             | table | 
 public | engagement_message_sources     | table | 
 public | idx_extension_commands_expired | index | 
 public | idx_extension_commands_pending | index | 
 ...
```

---

## 4. UPDATE ENVIRONMENT VARIABLES

```env
# .env.local

# Extension Module
EXTENSION_EVENTS_TABLE=extension_events
EXTENSION_COMMANDS_TABLE=extension_commands
EXTENSION_SESSIONS_TABLE=extension_sessions
MESSAGE_SOURCES_TABLE=engagement_message_sources

# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/omnivyra

# Feature flags
USE_EXTENSION_MODULE=true
EXTENSION_STORAGE_TYPE=postgres  # or 'memory' for MVP
```

---

## 5. MIGRATE FROM IN-MEMORY TO POSTGRES

### Current State (MVP)
- `InMemoryExtensionRepository` (TypeScript Maps)
- No persistence

### Goal
- `PostgresExtensionRepository` (PostgreSQL)
- Persistent, scalable

### Steps

#### Step 1: Create PostgreSQL Repository

```typescript
// File: modules/extension/repositories/PostgresExtensionRepository.ts

import { Pool, QueryResult } from 'pg';
import { IExtensionRepository } from './IExtensionRepository';
import { ExtensionEventRow, ExtensionCommandRow, CommandStatus } from '../types/extension.types';

export class PostgresExtensionRepository implements IExtensionRepository {
  private pool: Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString });
  }

  async createEvent(
    event: Omit<ExtensionEventRow, 'id' | 'created_at'>
  ): Promise<ExtensionEventRow> {
    const result = await this.pool.query(
      `INSERT INTO extension_events 
       (user_id, org_id, platform, event_type, platform_message_id, data, source) 
       VALUES ($1, $2, $3, $4, $5, $6, $7) 
       RETURNING *`,
      [
        event.user_id,
        event.org_id,
        event.platform,
        event.event_type,
        event.platform_message_id,
        JSON.stringify(event.data),
        'extension'
      ]
    );
    return this.mapEventRow(result.rows[0]);
  }

  async getUnprocessedEvents(userId: string, limit = 100): Promise<ExtensionEventRow[]> {
    const result = await this.pool.query(
      `SELECT * FROM extension_events 
       WHERE user_id = $1 AND processed = FALSE 
       ORDER BY created_at ASC 
       LIMIT $2`,
      [userId, limit]
    );
    return result.rows.map(r => this.mapEventRow(r));
  }

  // ... implement remaining 30 interface methods ...

  private mapEventRow(row: any): ExtensionEventRow {
    return {
      id: row.id,
      user_id: row.user_id,
      org_id: row.org_id,
      platform: row.platform,
      event_type: row.event_type,
      platform_message_id: row.platform_message_id,
      data: row.data,
      source: row.source,
      processed: row.processed,
      processed_at: row.processed_at,
      created_at: new Date(row.created_at)
    };
  }

  async isHealthy(): Promise<boolean> {
    try {
      await this.pool.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }
}
```

#### Step 2: Update Factory

```typescript
// File: modules/extension/repositories/InMemoryExtensionRepository.ts

import { IExtensionRepository } from './IExtensionRepository';
import { PostgresExtensionRepository } from './PostgresExtensionRepository';
import { InMemoryExtensionRepository } from './InMemoryExtensionRepository';

export function createExtensionRepository(): IExtensionRepository {
  const storageType = process.env.EXTENSION_STORAGE_TYPE || 'memory';

  if (storageType === 'postgres') {
    return new PostgresExtensionRepository(
      process.env.DATABASE_URL || 'postgresql://localhost:5432/omnivyra'
    );
  }

  // Default: In-memory (MVP)
  return new InMemoryExtensionRepository();
}
```

#### Step 3: Update Service DI

```typescript
// File: modules/extension/services/extensionEventService.ts

import { createExtensionRepository } from '../repositories/InMemoryExtensionRepository';

export class ExtensionEventService {
  private repository: IExtensionRepository;

  constructor() {
    // ✓ Factory handles switching implementations
    this.repository = createExtensionRepository();
  }

  async ingestEvent(event: ValidatedExtensionEvent) {
    // No change needed - repository abstraction handles it
    return this.repository.createEvent(event);
  }
}
```

#### Step 4: Run Integration Tests

```bash
# Test with in-memory (fast)
EXTENSION_STORAGE_TYPE=memory npm test

# Test with PostgreSQL (real)
EXTENSION_STORAGE_TYPE=postgres npm test
```

---

## 6. PRODUCTION ROLLOUT

### Phase 1: Staging (Day 1)

```bash
# Deploy schema to staging
psql -U postgres -h staging-db.omnivyra.com -d omnivyra < extension_schema.sql

# Deploy new code (uses PostgreSQL)
git push staging
npm run deploy:staging

# Run tests
npm test -- --testNamePattern="extension"

# Monitor: Check for errors
tail -f logs/staging.log | grep extension
```

### Phase 2: Shadow Traffic (Day 2-3)

```typescript
// Simultaneously write to both storage layers
class DualWriteRepository implements IExtensionRepository {
  constructor(
    private memory: InMemoryExtensionRepository,
    private postgres: PostgresExtensionRepository
  ) {}

  async createEvent(event) {
    const memResult = await this.memory.createEvent(event);
    const pgResult = await this.postgres.createEvent(event);
    
    // Compare results (should be identical)
    if (JSON.stringify(memResult) !== JSON.stringify(pgResult)) {
      console.error('MISMATCH:', memResult, pgResult);
    }
    
    return memResult; // Still read from memory
  }
  // ... similar for other methods ...
}
```

### Phase 3: Gradual Cutover (Day 4-7)

```
Day 4: Read 10% from PostgreSQL, 90% from memory
Day 5: 50/50
Day 6: 90% PostgreSQL, 10% memory
Day 7: 100% PostgreSQL, remove memory repo
```

### Phase 4: Production (Week 2)

```bash
# Full production deployment
git push main
npm run deploy:production

# Monitor all metrics
- extension_events insertion rate
- command fetch latency
- dedup success rate
- RLS policy violations (should be 0)
```

---

## 7. ROLLBACK PLAN

If PostgreSQL deployment fails:

```bash
# Immediate: Fall back to in-memory
EXTENSION_STORAGE_TYPE=memory npm restart

# Check status
curl http://localhost:3000/api/extension/health

# Urgent: Find root cause
tail -f logs/production.log | grep "error\|ERROR"

# Restore from backup
psql -U postgres -h localhost -d omnivyra < omnivyra_backup_20260323.sql
```

---

## 8. MONITORING QUERIES

```sql
-- Check health
SELECT table_name, n_live_tup as row_count 
FROM pg_stat_user_tables 
WHERE table_name LIKE 'extension_%';

-- Monitor unprocessed events (worker backlog)
SELECT COUNT(*) as unprocessed 
FROM extension_events 
WHERE processed = FALSE;

-- Check command retry rate
SELECT 
  status, 
  COUNT(*) as count,
  AVG(retry_count) as avg_retries
FROM extension_commands 
GROUP BY status;

-- Find slow commands
SELECT id, user_id, platform, status, 
       (NOW() - created_at) as age
FROM extension_commands 
WHERE status = 'pending' AND (NOW() - created_at) > INTERVAL '1 hour'
ORDER BY created_at ASC;
```

---

## 9. PERFORMANCE BASELINE

Target metrics after PostgreSQL migration:

| Metric | Target | Acceptable |
|--------|--------|------------|
| Event insert latency | <10ms | <50ms |
| Dedup check latency | <5ms | <20ms |
| Command fetch latency | <20ms | <100ms |
| Session validation latency | <5ms | <20ms |

Measure:
```bash
npm run benchmarks -- --suite=extension --output=json
```

---

## 10. CHECKLIST

```
Pre-Deployment:
☐ Backup current database
☐ Verify PostgreSQL connectivity
☐ Review schema for typos

Deployment:
☐ Apply schema via psql
☐ Verify all tables/indexes created
☐ Enable RLS on all tables
☐ Run ANALYZE
☐ Deploy PostgreSQL repository code
☐ Set EXTENSION_STORAGE_TYPE=postgres
☐ Run integration tests

Post-Deployment:
☐ Monitor event ingestion rate
☐ Monitor dedup success rate
☐ Check command fetch latency
☐ Verify RLS isolation (no cross-org leaks)
☐ Review error logs for issues
☐ Performance baseline test
☐ Announce to team on Slack

Monitoring (Week 1):
☐ Daily check: unprocessed events backlog
☐ Daily check: error rates
☐ Weekly: analyze slow queries
☐ Weekly: review monitoring dashboard
```

---

## 📞 Support

Issues? Check:
1. **Schema errors**: `psql -d omnivyra -c "\d extension_events"`
2. **RLS policy missing**: `\d+ extension_events`
3. **Index not used**: Run `EXPLAIN SELECT ...` query
4. **Connection pool exhausted**: Check `max_connections` in PostgreSQL config

---

**Status:** ✅ Ready to Deploy  
**Last Updated:** 2026-03-23  
**Owner:** @engineering-leads
