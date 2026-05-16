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

bash ./scripts/guard-no-prod-push.sh "${FILTERED_ARGS[@]}"
supabase db push "${FILTERED_ARGS[@]}"
