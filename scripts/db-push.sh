#!/bin/bash

# Wrapper for `supabase db push` that runs the prod-ref guard first.
# Called via: npm run db:push -- <supabase args...>
# Args reach this wrapper as $@, which the inline package.json `"$@"`
# pattern cannot reliably do across npm versions.

set -e

bash ./scripts/guard-no-prod-push.sh "$@"
supabase db push "$@"
