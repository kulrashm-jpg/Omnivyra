# Real-Schema CI

Runs the platform's database invariants against a real PostgreSQL server instead
of a mocked Supabase client.

## Why it exists

Every database defect this programme found in production was invisible to the
mocked test suite:

| Phase | Production failure | Why mocks missed it |
|---|---|---|
| W0 | `42703` — `engagement_threads` had no `window_open` / `window_expires_at` | a mock returns whatever the test says it returns |
| W0.1 | `42P10` — the thread upsert named a conflict target PostgREST could not infer, because the unique index was PARTIAL | index shape is a database property |
| W0.2 | `42P10` — the message upsert named `(platform, platform_message_id)`, backed by no unique index | same |
| W3 | claims needed a partial index with `NULLS NOT DISTINCT`; upserting against it raises `42P10` | same |
| W4 | three tenant-boundary foreign keys were simple, not composite | foreign keys are a database property |
| W5 | eleven more of the same on the canonical person spine | same |

A mock cannot fail the way PostgreSQL fails, so these could only ever be caught
by executing real SQL against real constraints.

## Running it locally

```bash
npm run test:realschema
```

Prerequisites: **Docker** and **Node 20**. No production credentials, no
Supabase CLI, no local Postgres install — `psql` and `pg_dump` run inside the
container.

The command creates a disposable PostgreSQL 17 container, builds the schema,
replays migrations, runs the suite, then destroys the container.

Useful variables:

| Variable | Effect |
|---|---|
| `W6_KEEP=1` | leave the container running so a failure can be inspected by hand |
| `W6_DB_URL=postgres://…` | use an existing database instead of managing a container (this is what CI does) |
| `W6_PG_PORT` | host port for the container, default `5433` |

To inspect a failure:

```bash
W6_KEEP=1 npm run test:realschema
docker exec -it w6-real-schema psql -U postgres -d w6
```

## What a run does

1. **Bootstrap** (`scripts/ci/schema-bootstrap.sql`) — creates the Supabase
   roles, schemas, extensions and `auth.*` helpers a stock Postgres lacks. Note
   that extensions go into the `extensions` schema and `extensions` is put on
   the database `search_path`; both are load-bearing, because the governed
   schema references `extensions.uuid_generate_v4()` and unqualified
   `vector(1536)`.
2. **Baseline** (`supabase/_schema/baseline.sql`) — restores the governed
   schema, 821 tables.
3. **Replay** — applies every migration newer than the baseline's recorded
   ledger position. Because those migrations are already represented in the
   baseline, this proves they are **idempotent**, which is what makes them safe
   to re-apply.
4. **Verify** — runs `backend/tests/realschema/**` against the result.

Any stage failing fails the run. There is no `continue-on-error`.

## Why the schema comes from a baseline, not from the migrations

The honest reason: **the governed migration set cannot rebuild this platform.**
Replaying all 385 files onto an empty database leaves **170 of them failing**,
dominated by `relation ... does not exist`, because roughly half the schema was
created by the **312 ungoverned files under `database/`** that were never
promoted into `supabase/migrations/`. W5's own migration is among the failures —
it alters `engagement_threads`, which no governed migration creates.

Promoting `database/**` is a separate governance programme and is explicitly out
of scope here. Until it lands, the canonical schema source for CI is:

> **`supabase/_schema/baseline.sql`** — a mechanically-generated, schema-only
> snapshot of production, plus every migration above its ledger position.

Loose SQL under `database/` is reference material. It is never applied by CI.

### Regenerating the baseline

Needed after any migration that changes production schema:

```bash
npm run db:baseline    # requires SUPABASE_POOLER_DB_URL; reads production, schema-only
npm run db:drift       # confirms the committed baseline matches production
```

`db:baseline` is a **local developer step**. CI never runs it and never holds
production credentials. The artifact contains DDL only — no rows, no PII.

## Drift detection

`npm run db:drift` compares the committed baseline against live production by
object inventory (tables, indexes, constraints) and exits non-zero on any
difference. It needs production credentials, so it is deliberately **not** part
of pull-request CI — run it locally or from a scheduled job with its own secret.

Two parsing subtleties are handled, and both caused false drift before being
fixed: `pg_dump` emits CHECK constraints **inline** inside `CREATE TABLE` rather
than as `ADD CONSTRAINT`, and indexes that merely implement a PRIMARY KEY or
UNIQUE constraint are not emitted as `CREATE INDEX` at all. Note that a FOREIGN
KEY also records a `conindid` — the index it points *at* — so index exclusion
must be restricted to `contype IN ('p','u')`.

## Relationship to the other schema gates

| Gate | Kind | Catches |
|---|---|---|
| `scripts/check-schema-drift.js` | static | code referencing a column no migration creates |
| `scripts/generate-schema-manifest.js` | static | declarative catalog of the auth spine |
| `scripts/verify-schema-parity.js` | live, PostgREST | required runtime columns — **currently broken**, see below |
| **this** | live, real Postgres | constraints, indexes, conflict targets, tenant boundaries |

`verify-schema-parity.js` reads `information_schema` through PostgREST, which
`service_role` cannot query. It is repairable **without weakening production
security**: read `pg_catalog` over the direct `pg` connection the ops appliers
already use (`SUPABASE_POOLER_DB_URL`), which needs no new grants. That repair
was left out of W6 — it is a different gate, covering runtime write columns
rather than schema invariants.

## Test data

Two deterministic synthetic tenants, `ORG_A` and `ORG_B`
(`00000000-0000-4000-8000-00000000000a` / `…00b`). No production data is ever
copied in. Most tests mutate inside a transaction that is always rolled back;
the concurrency suite has to commit — two sessions cannot see each other's
uncommitted work — so it cleans up in `afterEach`.

The harness refuses to start against a managed host (`supabase.co`,
`amazonaws.com`, `railway`, …) even if `W6_DB_URL` points at one.
