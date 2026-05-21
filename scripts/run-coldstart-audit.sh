#!/usr/bin/env bash
# LOCALHOST-ONLY: cold-start audit for the Stripe reconciliation path.
#
# Cycles supabase stop + supabase start CYCLES times. After each start,
# IMMEDIATELY runs the Stripe reconciliation fixture (no delay, no readiness
# probe). Captures the outcome to a per-cycle log file.
#
# A deterministic first-run success ON EVERY CYCLE means no cold-start race.
# Any first-run failure points to a real readiness issue.

set -u
CYCLES=${CYCLES:-3}
SOAK_LOG=$(mktemp -t coldstart-XXXXXX.log)
echo "[coldstart] writing logs to $SOAK_LOG"

export SUPABASE_URL=http://127.0.0.1:54321
export NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
: "${NEXT_PUBLIC_SUPABASE_ANON_KEY:?Set NEXT_PUBLIC_SUPABASE_ANON_KEY for the local Supabase stack}"
: "${SUPABASE_SERVICE_ROLE_KEY:?Set SUPABASE_SERVICE_ROLE_KEY for the local Supabase stack}"
export SUPABASE_SERVICE_KEY="${SUPABASE_SERVICE_KEY:-$SUPABASE_SERVICE_ROLE_KEY}"
export SUPABASE_ANON_KEY="${SUPABASE_ANON_KEY:-$NEXT_PUBLIC_SUPABASE_ANON_KEY}"
export REDIS_URL=redis://127.0.0.1:6379
export ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
export RECONCILE_LOCAL_RUNNER=1

for cycle in $(seq 1 "$CYCLES"); do
  echo ""
  echo "=== cycle $cycle: supabase stop ==="
  supabase stop >>"$SOAK_LOG" 2>&1

  echo "=== cycle $cycle: supabase start --exclude ==="
  supabase start --exclude studio,inbucket,imgproxy,edge-runtime >>"$SOAK_LOG" 2>&1
  if [ $? -ne 0 ]; then
    echo "[coldstart] cycle $cycle: supabase start FAILED"
    tail -20 "$SOAK_LOG"
    exit 1
  fi

  echo "=== cycle $cycle: first-run stripe fixture (no warmup) ==="
  fixture=scripts/reconciliation-fixtures/stripe/happy.json
  # Use the SAME providerInvoiceId across cycles → first cycle: ingested, others: duplicate.
  # That's INTENTIONAL — we want to see whether the FIRST run on a COLD stack is itself deterministic.
  result=$(npx tsx scripts/run-reconciliation.ts --manifest=$fixture 2>&1)
  ok=$(echo "$result" | grep -c '"ok": true')
  status=$(echo "$result" | grep -o '"status": "[a-z_]*"' | head -1)
  echo "[coldstart] cycle $cycle: ok=$ok status=$status"
  if [ "$ok" -lt 1 ]; then
    echo "[coldstart] cycle $cycle: first-run FAILED — race detected"
    echo "--- output ---"
    echo "$result"
    echo "--- supabase status ---"
    supabase status
    exit 2
  fi
done

echo ""
echo "[coldstart] all $CYCLES cycles succeeded on first run → no cold-start race."
