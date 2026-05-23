#!/bin/bash

# SCRIPT_CLASSIFICATION: OPERATOR
# MUTATION_LEVEL: SCHEMA_MUTATION
# SAFE_FOR_CI: NO
# SAFE_FOR_PRODUCTION: CAUTION
# REQUIRES_EXPLICIT_OPERATOR_INTENT: YES

# Wrapper for `supabase db push` that runs the prod-ref guard first.
# Called via: npm run db:push -- <supabase args...>
# Args reach this wrapper as $@, which the inline package.json `"$@"`
# pattern cannot reliably do across npm versions.

set -e

TARGET_ENV=""
HAS_INTENT="no"
HAS_PRODUCTION_CONFIRM="no"
HAS_LEDGER_DESYNC_ACK="no"
FILTERED_ARGS=()

for arg in "$@"; do
  case "$arg" in
    --target-env=*)
      TARGET_ENV="${arg#--target-env=}"
      ;;
    --apply|--execute|--i-understand-this-mutates-data)
      HAS_INTENT="yes"
      ;;
    --confirm-production-impact)
      HAS_PRODUCTION_CONFIRM="yes"
      ;;
    --acknowledge-ledger-desync)
      HAS_LEDGER_DESYNC_ACK="yes"
      ;;
    *)
      FILTERED_ARGS+=("$arg")
      ;;
  esac
done

echo "========================================"
echo "OPERATOR MUTATION SCRIPT"
echo "ENVIRONMENT: ${TARGET_ENV:-unspecified}"
echo "MUTATION TARGET: db/schema"
if [ "$HAS_INTENT" = "yes" ]; then
  echo "DRY RUN: no"
else
  echo "DRY RUN: yes"
fi
echo "========================================"
echo "[operator-safety] timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
echo "[operator-safety] script=scripts/operator/db/db-push.sh"
echo "[operator-safety] requested_environment=${TARGET_ENV:-unspecified}"
if [ "$HAS_INTENT" = "yes" ]; then
  echo "[operator-safety] mode=apply"
else
  echo "[operator-safety] mode=dry-run"
fi
echo ""

if [ "$TARGET_ENV" != "local" ] && [ "$TARGET_ENV" != "staging" ] && [ "$TARGET_ENV" != "production" ]; then
  echo "[operator-safety] Refusing to continue before any mutation-capable logic runs."
  echo "[operator-safety] Reason: Missing --target-env=local|staging|production."
  echo "[operator-safety] Safe usage example:"
  echo "  npm run db:push -- --target-env=local --apply"
  exit 0
fi

SUPABASE_TARGET="${SUPABASE_URL:-${NEXT_PUBLIC_SUPABASE_URL:-${SUPABASE_DB_URL:-${DATABASE_URL:-}}}}"
if [ -n "$SUPABASE_TARGET" ]; then
  case "$(printf '%s' "$SUPABASE_TARGET" | tr '[:upper:]' '[:lower:]')" in
    *localhost*|*127.0.0.1*|*0.0.0.0*|*host.docker.internal*|*supabase_db_*) ;;
    *)
      echo "[operator-safety] WARNING: non-local Supabase connection detected."
      ;;
  esac
fi

if [ "$TARGET_ENV" = "production" ] && [ "$HAS_PRODUCTION_CONFIRM" != "yes" ]; then
  echo "[operator-safety] Refusing to continue before any mutation-capable logic runs."
  echo "[operator-safety] Reason: target-env=production requires --confirm-production-impact."
  echo "[operator-safety] Safe usage example:"
  echo "  npm run db:push -- --target-env=production --apply --confirm-production-impact"
  exit 0
fi

if [ "$HAS_INTENT" != "yes" ]; then
  echo "[operator-safety] Intended action preview: push local Supabase migrations/schema changes to the selected database."
  echo "[operator-safety] Refusing to continue before any mutation-capable logic runs."
  echo "[operator-safety] Reason: Missing explicit mutation intent flag: --apply, --execute, or --i-understand-this-mutates-data."
  echo "[operator-safety] Safe usage example:"
  echo "  npm run db:push -- --target-env=local --apply"
  exit 0
fi

# ── UNSAFE_MIGRATION_LEDGER_STATE hard block ─────────────────────────────────
# The repo carries 48+ duplicate version prefixes and 58+ invalid calendar
# date prefixes in supabase/migrations/ (see docs/migration-discipline.md
# §"Why db push is currently unsafe"). Supabase CLI orders by version, so
# multi-file versions cause non-deterministic apply — the ledger records
# a version as complete after one arbitrary file ran, silently skipping
# the rest.
#
# `db push` is STRUCTURALLY unsafe against this ledger state. The block
# below is a hard guard; bypass requires explicit acknowledgement via
# --acknowledge-ledger-desync so the next operator who reaches for db
# push is forced to read the migration-discipline doc first.
echo "[operator-safety] UNSAFE_MIGRATION_LEDGER_STATE check..."
if [ "$HAS_LEDGER_DESYNC_ACK" != "yes" ]; then
  echo ""
  echo "================================================================"
  echo "  UNSAFE_MIGRATION_LEDGER_STATE — BLOCKED"
  echo "================================================================"
  echo ""
  echo "  supabase db push is STRUCTURALLY UNSAFE against this repo's"
  echo "  migration ledger state:"
  echo ""
  echo "    * 48+ duplicate version prefixes (e.g. 20260322 has 12 files)"
  echo "    * 58+ files use invalid calendar dates (e.g. 20260631_*.sql)"
  echo "    * supabase CLI orders by version, not filename"
  echo "    * multi-file versions apply non-deterministically — the ledger"
  echo "      records the version as complete after one arbitrary file"
  echo "      ran, silently skipping the rest"
  echo ""
  echo "  Use the Supabase SQL editor to apply individual migrations"
  echo "  manually. See docs/migration-discipline.md for the protocol."
  echo ""
  echo "  If you understand the risk and still need to run db push,"
  echo "  pass --acknowledge-ledger-desync. The acknowledgement is"
  echo "  logged below for audit traceability."
  echo "================================================================"
  exit 1
fi

echo "[operator-safety] UNSAFE_MIGRATION_LEDGER_STATE acknowledged by operator at $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
echo "[operator-safety] Proceeding with db push against ledger known to be desynced."

bash ./scripts/guard-no-prod-push.sh "${FILTERED_ARGS[@]}"
supabase db push "${FILTERED_ARGS[@]}"
