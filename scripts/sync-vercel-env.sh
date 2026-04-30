#!/usr/bin/env bash
# Sync missing env vars from .env.local to Vercel production.
# Skips vars already on Vercel; renames UPSPLASH_* -> UNSPLASH_*; removes misnamed OpenAI_Key.

set -uo pipefail

ENV_FILE=".env.local"

# Names already present on Vercel production (case-sensitive).
ALREADY_ON_VERCEL=(
  SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY SUPABASE_DB_URL
  NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY
  REDIS_URL ENCRYPTION_KEY INTERNAL_METRICS_SECRET
  NEXT_PUBLIC_APP_URL NEXT_PUBLIC_API_URL
  LINKEDIN_CLIENT_ID LINKEDIN_CLIENT_SECRET
  TWITTER_CLIENT_ID TWITTER_CLIENT_SECRET
  YOUTUBE_CLIENT_ID YOUTUBE_CLIENT_SECRET
  FACEBOOK_CLIENT_ID FACEBOOK_CLIENT_SECRET
  NEWS_API_KEY SERP_API_KEY SEARCH_API_KEY
  OpenAI_Key
  SUPABASE_POOLER_DB_URL
)

# Names in .env.local that are duplicates by alias (code accepts existing Vercel name).
SKIP_ALIASES=(
  SERPAPI_KEY      # SERP_API_KEY already on Vercel
  SEARCHAPI_KEY    # SEARCH_API_KEY already on Vercel
)

# Names to skip entirely (dev-only or unsafe values).
SKIP_UNSAFE=(
  DEV_EXTENSION_AUTH_BYPASS  # never in prod
  META_REDIRECT_URI          # local value is localhost; user must set prod URL manually
)

# Rename map: local name -> Vercel name.
declare -A RENAME=(
  [UPSPLASH_ACCESS_KEY]=UNSPLASH_ACCESS_KEY
  [UPSPLASH_SECRET_KEY]=UNSPLASH_SECRET_KEY
)

contains() {
  local needle="$1"; shift
  for x in "$@"; do [[ "$x" == "$needle" ]] && return 0; done
  return 1
}

# Step 1: remove misnamed OpenAI_Key from all environments.
echo "==> Removing misnamed OpenAI_Key (will add as OPENAI_API_KEY)"
npx vercel env rm OpenAI_Key production --yes 2>&1 | tail -3 || true
npx vercel env rm OpenAI_Key preview --yes 2>&1 | tail -3 || true
npx vercel env rm OpenAI_Key development --yes 2>&1 | tail -3 || true

# Step 2: parse .env.local and upload missing vars.
ADDED=0
SKIPPED=0
FAILED=0

while IFS= read -r line || [[ -n "$line" ]]; do
  # strip leading whitespace
  line="${line#"${line%%[![:space:]]*}"}"
  # skip comments and blanks
  [[ -z "$line" || "$line" == \#* ]] && continue
  # require KEY=VALUE
  [[ "$line" != *"="* ]] && continue

  key="${line%%=*}"
  value="${line#*=}"
  # strip CR if present
  key="${key%$'\r'}"
  value="${value%$'\r'}"

  # apply rename
  target="${RENAME[$key]:-$key}"

  # skip aliases / unsafe / already-present
  if contains "$key" "${SKIP_UNSAFE[@]}"; then
    echo "SKIP unsafe : $key"; SKIPPED=$((SKIPPED+1)); continue
  fi
  if contains "$key" "${SKIP_ALIASES[@]}"; then
    echo "SKIP alias  : $key (equivalent already on Vercel)"; SKIPPED=$((SKIPPED+1)); continue
  fi
  if contains "$target" "${ALREADY_ON_VERCEL[@]}"; then
    echo "SKIP dup    : $target"; SKIPPED=$((SKIPPED+1)); continue
  fi

  printf "ADD         : %s ... " "$target"
  if npx vercel env add "$target" production --value "$value" --yes </dev/null >/dev/null 2>&1; then
    echo "OK"; ADDED=$((ADDED+1))
  else
    echo "FAILED"; FAILED=$((FAILED+1))
  fi
done < "$ENV_FILE"

echo ""
echo "Summary: added=$ADDED skipped=$SKIPPED failed=$FAILED"
