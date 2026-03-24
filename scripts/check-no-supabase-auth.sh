#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# CI Guard: prohibit supabase.auth.* calls in application code
#
# Firebase Admin SDK is the only permitted auth path.
# Any call to supabase.auth.* (except in test fixtures) fails the build.
#
# Usage (add to package.json scripts):
#   "prebuild": "bash scripts/check-no-supabase-auth.sh"
#   "pretest":  "bash scripts/check-no-supabase-auth.sh"
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

PATTERN='supabase\.auth\.'

# Directories to scan
SCAN_DIRS="pages lib backend components"

# Files to exclude (test fixtures, this script itself)
EXCLUDE=(
  '--exclude-dir=node_modules'
  '--exclude-dir=.next'
  '--exclude-dir=.git'
  '--exclude=*.test.ts'
  '--exclude=*.spec.ts'
  '--exclude=*.test.tsx'
  '--exclude=*.spec.tsx'
  '--exclude=check-no-supabase-auth.sh'
)

echo "🔍 Scanning for supabase.auth.* usage..."

# Run grep; capture output and exit code separately
MATCHES=$(grep -rn "${EXCLUDE[@]}" "$PATTERN" $SCAN_DIRS 2>/dev/null || true)

if [[ -n "$MATCHES" ]]; then
  echo ""
  echo "❌ BUILD FAILED: supabase.auth.* calls found in application code."
  echo ""
  echo "   Firebase Admin SDK (lib/firebaseAdmin.ts) is the only permitted"
  echo "   auth path. Replace supabase.auth.* calls with:"
  echo "     - verifyFirebaseIdToken()  for token verification"
  echo "     - verifyAuthHeader()       for API route auth"
  echo "     - verifyToken()            for raw ID token validation"
  echo ""
  echo "   Offending locations:"
  echo "$MATCHES" | sed 's/^/   /'
  echo ""
  exit 1
fi

echo "✅ No supabase.auth.* calls found. Build may proceed."
exit 0
