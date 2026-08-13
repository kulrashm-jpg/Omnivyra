#!/usr/bin/env bash
#
# W6 — real-schema CI runner.
#
# Builds a disposable PostgreSQL database that matches the governed schema,
# then runs the invariant suite against it. Nothing here touches production:
# there are no production credentials, no production hostnames, and the
# database is destroyed at the end.
#
#   1. bootstrap  - Supabase roles/schemas/extensions a stock Postgres lacks
#   2. baseline   - supabase/_schema/baseline.sql (committed, schema-only)
#   3. replay     - every migration newer than the baseline's ledger position,
#                   which must apply idempotently on top of it, plus any
#                   migration added by the current branch
#   4. verify     - jest real-schema suite (W0/W0.1/W0.2, W3, W4, W5, tenancy)
#
# Usage:
#   scripts/ci/real-schema-ci.sh              # manages its own container
#   W6_DB_URL=postgres://... scripts/ci/real-schema-ci.sh   # use an existing DB
#
set -euo pipefail

IMAGE="${W6_PG_IMAGE:-pgvector/pgvector:pg17}"
CONTAINER="${W6_CONTAINER:-w6-real-schema}"
HOST_PORT="${W6_PG_PORT:-5433}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BASELINE="$ROOT/supabase/_schema/baseline.sql"
BASELINE_META="$ROOT/supabase/_schema/baseline.json"
BOOTSTRAP="$ROOT/scripts/ci/schema-bootstrap.sql"
OWN_CONTAINER=0

log()  { printf '\n\033[1m== %s\033[0m\n' "$*"; }
fail() { printf '\033[31mFAIL: %s\033[0m\n' "$*" >&2; exit 1; }

[ -f "$BASELINE" ]  || fail "missing $BASELINE — run: node scripts/ci/generate-schema-baseline.js"
[ -f "$BOOTSTRAP" ] || fail "missing $BOOTSTRAP"

# W6_KEEP=1 leaves the container running so a failing invariant can be inspected
# by hand. CI never sets it.
cleanup() {
  if [ "$OWN_CONTAINER" = "1" ] && [ -z "${W6_KEEP:-}" ]; then
    docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  elif [ "$OWN_CONTAINER" = "1" ]; then
    echo "  (W6_KEEP set — container '$CONTAINER' left running on port $HOST_PORT)"
  fi
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
# 1. Database
# ---------------------------------------------------------------------------
# PSQL       - stops on the first error (migrations, assertions)
# PSQL_LOOSE - continues past errors (the baseline restore, which necessarily
#              collides with objects the bootstrap already created)
if [ -n "${W6_DB_URL:-}" ]; then
  log "Using supplied database (no container managed)"
  PSQL=(psql "$W6_DB_URL" -v ON_ERROR_STOP=1 -q)
  PSQL_LOOSE=(psql "$W6_DB_URL" -q)
  DB_URL="$W6_DB_URL"
else
  log "Starting disposable PostgreSQL ($IMAGE)"
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  docker run -d --name "$CONTAINER" \
    -e POSTGRES_PASSWORD=w6 -e POSTGRES_DB=w6 \
    -p "$HOST_PORT":5432 "$IMAGE" >/dev/null
  OWN_CONTAINER=1
  for i in $(seq 1 60); do
    if docker exec "$CONTAINER" pg_isready -U postgres -d w6 >/dev/null 2>&1; then
      echo "  ready after $((i * 2))s"; break
    fi
    sleep 2
    [ "$i" = "60" ] && fail "database never became ready"
  done
  PSQL=(docker exec -i "$CONTAINER" psql -U postgres -d w6 -v ON_ERROR_STOP=1 -q)
  PSQL_LOOSE=(docker exec -i "$CONTAINER" psql -U postgres -d w6 -q)
  DB_URL="postgres://postgres:w6@127.0.0.1:${HOST_PORT}/w6"
fi

# Read the two scalars we need out of baseline.json without invoking node —
# under Git Bash a POSIX path handed to a Windows node binary is rewritten and
# the require() fails.
json_field() { sed -n "s/.*\"$1\": *\"\{0,1\}\([^\",]*\)\"\{0,1\}.*/\1/p" "$BASELINE_META" | head -1; }

"${PSQL[@]}" -tAc "select version()" | head -1 | sed 's/^/  /'

# ---------------------------------------------------------------------------
# 2. Bootstrap + baseline
# ---------------------------------------------------------------------------
log "Applying Supabase bootstrap"
"${PSQL[@]}" < "$BOOTSTRAP" >/dev/null

log "Restoring governed schema baseline"
BASE_START=$(date +%s)
# The baseline is a pg_dump of an existing database, so it re-creates objects the
# bootstrap already made (schemas, extensions). Those specific collisions are
# expected; anything else is a real restore failure and is counted below.
set +e
"${PSQL_LOOSE[@]}" < "$BASELINE" > /dev/null 2> /tmp/w6_restore.err
set -e
BASE_SECS=$(( $(date +%s) - BASE_START ))
RESTORE_ERRORS=$(grep -c 'ERROR:' /tmp/w6_restore.err || true)
UNEXPECTED=$(grep 'ERROR:' /tmp/w6_restore.err | grep -vcE 'already exists' || true)
echo "  restored in ${BASE_SECS}s (errors: ${RESTORE_ERRORS}, unexpected: ${UNEXPECTED})"
if [ "${UNEXPECTED:-0}" -gt 0 ]; then
  grep 'ERROR:' /tmp/w6_restore.err | grep -vE 'already exists' | head -20
  fail "baseline restore produced ${UNEXPECTED} unexpected error(s)"
fi

TABLES=$("${PSQL[@]}" -tAc "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'")
echo "  public tables: $TABLES"
EXPECTED_TABLES=$(json_field tables)
[ "$TABLES" -ge "$EXPECTED_TABLES" ] || fail "expected >= $EXPECTED_TABLES tables, got $TABLES"

# ---------------------------------------------------------------------------
# 3. Migration replay
#
# Migrations above the baseline's ledger position are already represented in the
# dump, so re-applying them proves they are idempotent — the property that lets
# them be replayed safely, and the one W5 depends on.
# ---------------------------------------------------------------------------
LEDGER_MAX=$(json_field ledgerMax)
log "Replaying migrations newer than ledger position $LEDGER_MAX"
REPLAY_START=$(date +%s)
REPLAYED=0
for f in "$ROOT"/supabase/migrations/*.sql; do
  base="$(basename "$f")"
  ver="${base%%_*}"
  case "$ver" in (*[!0-9]*) continue ;; esac          # skip 8-digit legacy names
  [ "${#ver}" -eq 14 ] || continue
  [ "$ver" \> "$LEDGER_MAX" ] || continue
  printf '  %-64s' "$base"
  if "${PSQL[@]}" < "$f" > /tmp/w6_mig.out 2>&1; then
    echo "ok"
    REPLAYED=$((REPLAYED + 1))
  else
    echo "FAILED"
    tail -5 /tmp/w6_mig.out | sed 's/^/      /'
    fail "migration $base did not apply idempotently onto the baseline"
  fi
done
REPLAY_SECS=$(( $(date +%s) - REPLAY_START ))
echo "  replayed $REPLAYED migration(s) in ${REPLAY_SECS}s"

# ---------------------------------------------------------------------------
# 4. Invariant suite
# ---------------------------------------------------------------------------
log "Running real-schema invariant suite"
cd "$ROOT"
W6_DB_URL="$DB_URL" npx jest --config jest.realschema.config.js --runInBand --forceExit
SUITE_STATUS=$?

log "Summary"
echo "  baseline restore : ${BASE_SECS}s"
echo "  migration replay : ${REPLAY_SECS}s ($REPLAYED migrations)"
echo "  public tables    : $TABLES"
exit $SUITE_STATUS
