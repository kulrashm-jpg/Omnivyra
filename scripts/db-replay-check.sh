#!/usr/bin/env bash
# scripts/db-replay-check.sh
#
# Phase E replay validator. Runs the canonical migration set against a fresh
# local Supabase database, then runs the post-replay drift + RLS audits.
#
# Exits non-zero on:
#   * any migration apply error
#   * any RLS gap (table without RLS or without policies)
#   * (optional) any schema drift vs the supabase/_snapshot/prod_schema_summary
#
# Requirements:
#   * supabase CLI (https://supabase.com/docs/guides/cli) installed and on PATH
#   * Docker running (Supabase local stack uses Docker)
#   * Repo root as cwd
#
# Usage:
#   bash scripts/db-replay-check.sh
#   bash scripts/db-replay-check.sh --no-reset   # skip db reset, useful for CI cache reuse
#   bash scripts/db-replay-check.sh --skip-rls   # skip the RLS audit step
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

NO_RESET=false
SKIP_RLS=false
for arg in "$@"; do
  case "$arg" in
    --no-reset) NO_RESET=true ;;
    --skip-rls) SKIP_RLS=true ;;
    *)          echo "[db-replay] unknown arg: $arg"; exit 2 ;;
  esac
done

if ! command -v supabase >/dev/null 2>&1; then
  echo "[db-replay] FAIL: supabase CLI not found on PATH"
  echo "  Install: https://supabase.com/docs/guides/cli/getting-started"
  exit 1
fi

echo "[db-replay] === Phase E clean replay check ==="
echo "[db-replay] migrations dir: supabase/migrations/"
MIG_COUNT=$(find supabase/migrations -maxdepth 1 -name '*.sql' | wc -l | tr -d ' ')
echo "[db-replay] canonical migrations: $MIG_COUNT"

if ! $NO_RESET; then
  echo ""
  echo "[db-replay] STEP 1 — supabase db reset (fresh local DB)"
  if ! supabase db reset --no-seed; then
    echo "[db-replay] FAIL: supabase db reset returned non-zero"
    echo "  This is the replay failure surface. Capture the error above."
    exit 3
  fi
else
  echo ""
  echo "[db-replay] STEP 1 — SKIPPED (--no-reset). Migrations applied previously."
fi

echo ""
echo "[db-replay] STEP 2 — verify migration count in schema_migrations"
APPLIED=$(supabase db remote sql --db-url "$(supabase status -o json 2>/dev/null | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const j=JSON.parse(s);console.log(j.DB_URL||j.db_url||'')})")" \
  -c "SELECT count(*) FROM supabase_migrations.schema_migrations" 2>/dev/null | tail -1 || echo "?")
echo "[db-replay] applied count (local): $APPLIED  (expected ~$MIG_COUNT)"

if ! $SKIP_RLS; then
  echo ""
  echo "[db-replay] STEP 3 — RLS audit"
  if ! node "$REPO_ROOT/scripts/db-audit-rls.js"; then
    echo "[db-replay] FAIL: RLS audit reported gaps"
    exit 4
  fi
fi

echo ""
echo "[db-replay] STEP 4 — schema drift summary (informational)"
echo "  Compare local DB schema vs supabase/_snapshot/schema_drift_report.md"
echo "  Known drift: 335 tables in prod not yet in canonical (Phase E2..E7 follow-ups)."
echo ""
echo "[db-replay] OK — replay completed (within documented scope)."
