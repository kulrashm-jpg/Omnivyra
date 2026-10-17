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
#   scripts/ci/real-schema-ci.sh              # creates and owns its own container
#
#   W6_DB_URL is NOT a general escape hatch. A caller-supplied database receives
#   the bootstrap, a 62k-line baseline restore and a full migration replay, which
#   is destructive DDL against something this script did not create. That path is
#   therefore refused unless the workflow declares it (W6_CI_SERVICE_DB=1) AND the
#   run is on an ephemeral GitHub-hosted runner. See is_ephemeral_ci().
#
set -euo pipefail

IMAGE="${W6_PG_IMAGE:-pgvector/pgvector:pg17}"
CONTAINER="${W6_CONTAINER:-w6-real-schema}"
HOST_PORT="${W6_PG_PORT:-5433}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BASELINE="$ROOT/supabase/_schema/baseline.sql"
BASELINE_META="$ROOT/supabase/_schema/baseline.json"
BOOTSTRAP="$ROOT/scripts/ci/schema-bootstrap.sql"
OWN_CID=""              # container ID THIS invocation created; "" = none
RUNDIR=""               # private per-invocation temp dir; "" until created
RUNDIR_ID=""            # "device:inode" of RUNDIR, recorded at creation
CIDFILE=""              # "$RUNDIR/cid"; initialised for `set -u`
ACTUAL_DB=""            # initialised for `set -u` on early-failure paths
CLEANED=0
CLEANUP_FAILED=0
STAGE="startup"         # reported by the exit trap on every failure path
LABEL_KEY="com.omnivyra.w6-harness"

# W6-SAFE-01 — a per-invocation nonce. Written nowhere else, so it cannot match an
# earlier run, a concurrent run, or another workstream's container. It AUTHORIZES
# NOTHING; it only lets cleanup re-verify the container this run created.
#
# `tr -d '\r\n'`, NOT '\n': `openssl rand -hex` emits CRLF on MSYS/mingw64, so
# stripping only \n leaves a trailing \r. That makes the string 33 characters, the
# hex guard below rejects it, and the harness refuses to start at all on Git Bash
# with a message blaming a missing openssl. CI never saw it because ubuntu emits
# LF. The CID-file read below already normalises both for the same reason.
RUN_NONCE="$( (openssl rand -hex 16 2>/dev/null \
               || head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n') | tr -d '\r\n' )"
case "$RUN_NONCE" in
  *[!0-9a-f]*) RUN_NONCE="" ;;
  *) [ "${#RUN_NONCE}" -eq 32 ] || RUN_NONCE="" ;;
esac

log()  { printf '\n\033[1m== %s\033[0m\n' "$*"; }
fail() { printf '\033[31mFAIL: %s\033[0m\n' "$*" >&2; exit 1; }

[ -n "$RUN_NONCE" ] || fail "could not generate a 32-hex run nonce (openssl and /dev/urandom both unusable)"

# W6-SAFE-02 — the ONLY context in which a caller-supplied database may receive
# destructive DDL. This script does NOT prove such a database is disposable and
# does not claim to: the GitHub-hosted runner is destroyed when the job ends and
# its `services:` container is recreated per job, and this assertion CONFINES the
# path to that guarantee. RUNNER_ENVIRONMENT excludes self-hosted runners, which
# are not necessarily ephemeral. W6_CI_SERVICE_DB is the workflow author's
# explicit declaration of intent — also not a proof of ownership. If any variable
# is absent the path is REFUSED: a red CI job, never a silent unsafe success.
#
# Ownership is PROVEN only in container mode, by the container ID this invocation
# created and the fact that every destructive command is addressed to that ID.
is_ephemeral_ci() {
  [ "${W6_CI_SERVICE_DB:-}" = "1" ]               || return 1
  [ "${GITHUB_ACTIONS:-}"     = "true" ]          || return 1
  [ "${CI:-}"                 = "true" ]          || return 1
  [ "${RUNNER_ENVIRONMENT:-}" = "github-hosted" ] || return 1
  [ -n "${GITHUB_RUN_ID:-}" ]                     || return 1
  return 0
}

[ -f "$BASELINE" ]  || fail "missing $BASELINE — run: node scripts/ci/generate-schema-baseline.js"
[ -f "$BOOTSTRAP" ] || fail "missing $BOOTSTRAP"

# W6-SAFE-01 — a pathname pattern is NOT proof of ownership, so the run directory
# is removed only when the object at that path is still the SAME filesystem object
# this invocation created (device:inode recorded at creation) AND it carries this
# run's nonce in a file this invocation wrote.
#
# THIS IS NOT ATOMIC, and it is deliberately BOUNDED. `stat`, `cat` and the
# removal each re-resolve the path, and POSIX shell has no descriptor-relative
# unlink, so the checks NARROW the check-then-act window but cannot eliminate it.
# The removal is therefore confined to the three files this invocation wrote, by
# exact name, followed by `rmdir`, which REFUSES a non-empty directory. Worst case
# under a lost race is three specifically-named files plus one empty directory —
# never a recursive delete of an arbitrary tree. There is no `rm -rf` in this
# script. The residual race is MITIGATED, NOT ELIMINATED, and is accepted: the
# target is a mode-0700 mktemp directory holding three small non-secret files.
remove_rundir() {
  [ -n "$RUNDIR" ] || return 0
  if [ ! -d "$RUNDIR" ]; then
    echo "  run directory '$RUNDIR' is already gone; nothing removed"
    return 0
  fi
  local now tok
  now=$(stat -c '%d:%i' "$RUNDIR" 2>/dev/null || true)
  tok=$(cat "$RUNDIR/nonce" 2>/dev/null || true)
  if [ -z "$RUNDIR_ID" ] || [ "$now" != "$RUNDIR_ID" ]; then
    echo "  run directory '$RUNDIR' is NOT the object this run created (expected $RUNDIR_ID, found ${now:-unreadable}) — LEFT IN PLACE" >&2
    return 0
  fi
  if [ "$tok" != "$RUN_NONCE" ]; then
    echo "  run directory '$RUNDIR' does not carry the nonce for this run — LEFT IN PLACE" >&2
    return 0
  fi
  # A leftover temp directory is clutter, not a leaked container, so a failure
  # here does NOT set CLEANUP_FAILED and does not escalate a passing exit code.
  rm -f -- "$RUNDIR/cid" "$RUNDIR/nonce" "$RUNDIR/name"
  rmdir -- "$RUNDIR" 2>/dev/null || echo "RUNDIR_NOT_REMOVED=$RUNDIR" >&2
}

# W6-SAFE-04 — WHAT THESE TRAPS COVER. A normal exit, `fail()`, and SIGINT and
# SIGTERM, the latter two only because they are installed explicitly below.
# NOTHING runs on SIGKILL, on a terminal loss that kills the process group, or on
# a host crash: the container SURVIVES and must be removed by hand. Recovery is
# from $RUNDIR (cid, nonce, name), or by label when the cid was never written.
#
# W6_KEEP=1 retains the container deliberately — for hand inspection of a failing
# invariant, and for a two-phase durability readback. CI never sets it.
cleanup() {
  [ "$CLEANED" = "1" ] && return 0
  CLEANED=1
  # Recover the ID if this shell died between `docker run` returning and OWN_CID
  # being assigned. `|| true` so a failing read can never abort the trap before
  # the leak is reported; shape-checked before use.
  if [ -z "$OWN_CID" ] && [ -n "$CIDFILE" ] && [ -s "$CIDFILE" ]; then
    local fromfile
    fromfile=$(tr -d '\r\n' < "$CIDFILE" 2>/dev/null || true)
    case "$fromfile" in
      ""|*[!0-9a-f]*) : ;;                        # absent or partial: unusable
      *) [ "${#fromfile}" -ge 12 ] && OWN_CID="$fromfile" ;;
    esac
  fi
  if [ -z "$OWN_CID" ]; then
    # Nothing recorded. If a container was created anyway it carries this run's
    # nonce label and is discoverable. The run directory is KEPT, because it holds
    # the nonce needed to verify it.
    [ -n "$RUNDIR" ] && echo "  no container id recorded; run directory kept: $RUNDIR"
    return 0
  fi
  if [ -n "${W6_KEEP:-}" ]; then
    echo "  (W6_KEEP set — container $OWN_CID retained on port $HOST_PORT)"
    echo "  RECOVERY INFORMATION — RETAINED DELIBERATELY, NOT A FAILURE:"
    echo "    container id  : $OWN_CID"
    echo "    nonce         : $RUN_NONCE"
    echo "    run directory : $RUNDIR    (cid, nonce, name — NOT removed)"
    echo "    verify, then remove:"
    echo "      docker inspect -f '{{index .Config.Labels \"$LABEL_KEY\"}}' $OWN_CID"
    echo "      docker rm -f $OWN_CID"
    return 0
  fi
  local lbl
  lbl=$(docker inspect -f "{{index .Config.Labels \"$LABEL_KEY\"}}" "$OWN_CID" 2>/dev/null || true)
  if [ "$lbl" != "$RUN_NONCE" ]; then
    CLEANUP_FAILED=1
    echo "LEAKED_CONTAINER=$OWN_CID RUNDIR=$RUNDIR" >&2
    printf '\033[31m  CLEANUP REFUSED: %s does not carry the nonce for this run. NOT removing it.\033[0m\n' "$OWN_CID" >&2
    return 0
  fi
  if docker rm -f "$OWN_CID" >/dev/null 2>&1 && ! docker inspect "$OWN_CID" >/dev/null 2>&1; then
    echo "  container $OWN_CID removed"
    remove_rundir
  else
    CLEANUP_FAILED=1
    echo "LEAKED_CONTAINER=$OWN_CID RUNDIR=$RUNDIR" >&2
    printf '\033[31m  CLEANUP FAILED — remove by hand:  docker rm -f %s\033[0m\n' "$OWN_CID" >&2
  fi
}

# W6-SAFE-03 — every failure path names its stage and exits non-zero. A failure in
# bootstrap, baseline restore or replay never reaches the summary block. The exit
# status is only ever PRESERVED or RAISED, so cleanup can never turn a failed
# suite into a pass.
on_exit() {
  local rc=$?
  cleanup
  if [ "$rc" != "0" ]; then
    printf '\033[31mHARNESS FAILED at stage "%s" (exit %s) — NOT a passing gate\033[0m\n' "$STAGE" "$rc" >&2
  fi
  if [ "$CLEANUP_FAILED" = "1" ] && [ "$rc" = "0" ]; then
    printf '\033[31mFAIL: suite passed but a container this run created was left behind\033[0m\n' >&2
    exit 3
  fi
  exit "$rc"
}
trap on_exit EXIT
trap 'cleanup; exit 130' INT
trap 'cleanup; exit 143' TERM

# W6-SAFE-02 — ACCIDENT GUARD, NOT AN OWNERSHIP PROOF.
#
# These checks REDUCE RISK. They DO NOT PROVE OWNERSHIP of a supplied database,
# and nothing in this script should be read as claiming they do. Specifically: a
# PRISTINE REMOTE DATABASE PASSES THE TABLE-COUNT CHECK. So does a real database
# that was deliberately emptied, and so does one reached over a forwarded port or
# a tunnel. Emptiness is evidence that there is nothing to lose, not evidence of
# who owns the thing.
#
# Ownership is PROVEN in exactly one place: container mode, where the container ID
# came from the `docker run` this invocation issued and every destructive command
# is addressed to that ID. For a supplied database there is NO ownership proof —
# only CONFINEMENT to a declared ephemeral GitHub-hosted runner, whose VM and
# service container are destroyed when the job ends. That guarantee belongs to the
# workflow, not to this script.
#
# What this function does, therefore, is stop an ACCIDENTAL overwrite of a
# POPULATED database. That is its whole claim.
#
# Every assignment is split from its declaration: `local x=$(cmd)` returns the
# status of `local`, so a failing psql would silently yield an empty string.
assert_not_populated() {
  local db="$1" addr recov tables ledger
  addr=$("${PSQL[@]}"   -tAc "select coalesce(host(inet_server_addr()), 'unix-socket')")
  recov=$("${PSQL[@]}"  -tAc "select pg_is_in_recovery()")
  tables=$("${PSQL[@]}" -tAc "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p')")
  ledger=$("${PSQL[@]}" -tAc "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='supabase_migrations'")
  echo "  database=$db  server=$addr  public-tables=$tables  ledger-objects=$ledger"
  # The server address is RECORDED FOR DIAGNOSIS AND NOT ASSERTED.
  #
  # PROVEN WRONG BY CI RUN 39034965362: `inet_server_addr()` reports the address
  # the SERVER sees for itself, which under a GitHub Actions `services:` topology
  # is the Docker bridge IP (172.18.0.2) even though the client reached it on
  # localhost through a forwarded port. The assertion tested the wrong end of the
  # connection and refused the only topology in which this path is permitted.
  #
  # The meaningful loopback check is the CLIENT-side one on W6_DB_URL, enforced
  # before we connect at all, and it stays. In container mode psql runs over a
  # unix socket, so this check was trivially satisfied there and never load-bearing.
  #
  # WHAT IS GIVEN UP, PLAINLY: nothing here detects a loopback URL that is
  # tunnelled or port-forwarded to a REMOTE server, because that is the same
  # shape as the CI service container and is not distinguishable from it. No
  # RFC1918/private-address allowlist is used in its place — "private address" is
  # not a safety property, and a branch whose only purpose is to resemble a check
  # is worse than its absence.
  [ "$recov"  = "f" ] || fail "target is in recovery (a standby) — refusing DDL"
  [ "$tables" = "0" ] || fail "target holds $tables table(s) in schema public. A harness database is created empty; refusing to overwrite a populated database."
  [ "$ledger" = "0" ] || fail "target carries a supabase_migrations ledger ($ledger object(s)) — a managed database, not a harness one. Refusing DDL."
  echo "  accident guard: PASS (empty public schema, no migration ledger)"
}

# ---------------------------------------------------------------------------
# 1. Database
# ---------------------------------------------------------------------------
# PSQL       - stops on the first error (migrations, assertions)
# PSQL_LOOSE - continues past errors (the baseline restore, which necessarily
#              collides with objects the bootstrap already created)
if [ -n "${W6_DB_URL:-}" ]; then
  # W6-SAFE-02 — fail closed outside an ephemeral CI runner.
  is_ephemeral_ci || fail "W6_DB_URL is set, but this is not a declared ephemeral GitHub-hosted runner. Destructive bootstrap/baseline/replay against a caller-supplied database is refused here. Unset W6_DB_URL to use the disposable container this script creates and owns."
  # Shape validation filters AMBIGUITY ONLY. It is not an identity proof, and
  # assert_not_populated() below is the accident guard. There is deliberately NO
  # port assertion: CI supplies a service container on 5432 while HOST_PORT is
  # 5433, and the two have no reason to agree.
  case "$W6_DB_URL" in
    postgres://*|postgresql://*) ;;
    *) fail "W6_DB_URL must use the postgres:// or postgresql:// scheme" ;;
  esac
  case "$W6_DB_URL" in
    *%*)  fail "W6_DB_URL contains percent-encoding — refusing an ambiguous target" ;;
    *,*)  fail "W6_DB_URL lists multiple hosts — refusing an ambiguous target" ;;
    *\ *) fail "W6_DB_URL contains whitespace" ;;
  esac
  case "$W6_DB_URL" in
    *\?*)
      # Array-based split: no word splitting, no pathname expansion.
      IFS='&' read -r -a _w6_params <<< "${W6_DB_URL#*\?}"
      for kv in "${_w6_params[@]}"; do
        case "${kv%%=*}" in
          sslmode|connect_timeout|application_name) ;;
          *) fail "W6_DB_URL carries unsupported connection parameter '${kv%%=*}'" ;;
        esac
      done ;;
  esac
  u_host=$(printf '%s' "$W6_DB_URL" | sed -n 's#^[a-z]*://\([^@/]*@\)\{0,1\}\(\[[^]]*\]\|[^:/?]*\).*#\2#p')
  case "$u_host" in
    127.0.0.1|localhost|'[::1]'|::1) ;;
    *) fail "W6_DB_URL host '$u_host' is not loopback — refusing to dial it" ;;
  esac
  command -v psql >/dev/null 2>&1 || fail "the supplied-database path needs a host psql client, which is not on PATH"
  log "Using supplied database on a declared ephemeral runner (run ${GITHUB_RUN_ID:-?}, no container managed)"
  # The URL is NEVER printed. No redaction regex is safe over a format that
  # permits an unescaped ':' or '@' in the userinfo, so identity is reported as
  # discrete fields the server itself returns.
  echo "  host: $u_host    (URL deliberately not logged)"
  PSQL=(psql "$W6_DB_URL" -v ON_ERROR_STOP=1 -q)
  PSQL_LOOSE=(psql "$W6_DB_URL" -q)
  DB_URL="$W6_DB_URL"
else
  log "Starting disposable PostgreSQL ($IMAGE)"
  # W6-SAFE-01 — ABORT on a pre-existing name. This harness never removes a
  # container it did not create in this invocation. `docker inspect` is read-only.
  if docker inspect "$CONTAINER" >/dev/null 2>&1; then
    fail "a container named '$CONTAINER' already exists. Refusing to touch it.
  Inspect it, then remove it yourself if it is disposable:
      docker inspect -f '{{index .Config.Labels \"$LABEL_KEY\"}}' $CONTAINER
      docker rm -f $CONTAINER"
  fi
  # A PRIVATE directory created fresh by this invocation. `mktemp -d` creates it
  # atomically at mode 0700 and guarantees the name did not previously exist, so
  # the CID file inside cannot pre-exist, is never pre-cleared, and can never
  # overwrite another run's record. NOTHING is removed before `docker run`.
  RUNDIR=$(mktemp -d "${TMPDIR:-/tmp}/w6-run-XXXXXXXXXX") || fail "could not create a private run directory"
  chmod 700 "$RUNDIR"
  RUNDIR_ID=$(stat -c '%d:%i' "$RUNDIR" 2>/dev/null || true)
  [ -n "$RUNDIR_ID" ] || fail "could not record the identity of '$RUNDIR' — refusing to continue, because cleanup could not later prove the directory is ours"
  CIDFILE="$RUNDIR/cid"
  printf '%s\n' "$RUN_NONCE" > "$RUNDIR/nonce"
  printf '%s\n' "$CONTAINER" > "$RUNDIR/name"
  echo "  run directory: $RUNDIR (mode 700, id $RUNDIR_ID)"
  # --cidfile writes the ID as part of `docker run`, so the record survives this
  # shell. It refuses to overwrite an existing file, which cannot happen here.
  CID=$(docker run -d --name "$CONTAINER" --cidfile "$CIDFILE" \
    --label "$LABEL_KEY=$RUN_NONCE" \
    -e POSTGRES_PASSWORD=w6 -e POSTGRES_DB=w6 \
    -p "$HOST_PORT":5432 "$IMAGE")
  case "$CID" in
    ""|*[!0-9a-f]*) fail "docker run did not return a hexadecimal container id" ;;
  esac
  [ "${#CID}" -ge 12 ] || fail "docker run returned an implausibly short container id"
  OWN_CID="$CID"
  echo "  created container $OWN_CID"
  # `pg_isready` alone is NOT a readiness signal for a FIRST start. The postgres
  # entrypoint runs initdb, brings up a TEMPORARY server on the unix socket to
  # apply initialisation, stops it, then execs the real server. pg_isready is
  # socket-based and succeeds against that temporary server, so the first real
  # statement lands during its shutdown:
  #
  #   psql: error: connection to server on socket ".s.PGSQL.5432" failed:
  #         FATAL:  the database system is shutting down
  #
  # Observed locally at "ready after 12s" with a 120s budget still unspent — the
  # loop was told ready too early, it did not time out. CI never sees this because
  # CI supplies a database and starts no container, so only container mode is
  # affected.
  #
  # So require a REAL query round-trip, and require it on CONSECUTIVE polls: any
  # failure resets the streak, which the temporary server cannot survive because
  # its shutdown breaks the sequence. Three successes span >= 4s of wall time.
  ready_streak=0
  for i in $(seq 1 90); do
    if docker exec "$OWN_CID" psql -U postgres -d w6 -tAc 'select 1' >/dev/null 2>&1; then
      ready_streak=$((ready_streak + 1))
    else
      ready_streak=0
    fi
    if [ "$ready_streak" -ge 3 ]; then
      echo "  ready after $((i * 2))s (3 consecutive query round-trips)"; break
    fi
    sleep 2
    [ "$i" = "90" ] && fail "database never became stably ready"
  done
  # THE AUTHORIZATION CHAIN: every destructive command is addressed to the ID this
  # invocation created. No name is resolved, no URL is parsed, no stamp consulted.
  PSQL=(docker exec -i "$OWN_CID" psql -U postgres -d w6 -v ON_ERROR_STOP=1 -q)
  PSQL_LOOSE=(docker exec -i "$OWN_CID" psql -U postgres -d w6 -q)
  DB_URL="postgres://postgres:w6@127.0.0.1:${HOST_PORT}/w6"
  bound=$(docker inspect -f '{{(index (index .NetworkSettings.Ports "5432/tcp") 0).HostPort}}' "$OWN_CID" 2>/dev/null || true)
  [ "$bound" = "$HOST_PORT" ] || fail "container $OWN_CID publishes 5432 on '$bound', not the expected $HOST_PORT"
fi

# Read the two scalars we need out of baseline.json without invoking node —
# under Git Bash a POSIX path handed to a Windows node binary is rewritten and
# the require() fails.
json_field() { sed -n "s/.*\"$1\": *\"\{0,1\}\([^\",]*\)\"\{0,1\}.*/\1/p" "$BASELINE_META" | head -1; }

# W6-SAFE-02/03 — the accident guard. Nothing destructive has run yet.
log "Target (accident guard, before any DDL)"
ACTUAL_DB=$("${PSQL[@]}" -tAc "select current_database()")
assert_not_populated "$ACTUAL_DB"
"${PSQL[@]}" -tAc "select version()" | head -1 | sed 's/^/  /'

# ---------------------------------------------------------------------------
# 2. Bootstrap + baseline
# ---------------------------------------------------------------------------
STAGE="bootstrap"
log "Applying Supabase bootstrap"
"${PSQL[@]}" < "$BOOTSTRAP" >/dev/null

STAGE="baseline-restore"
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
STAGE="migration-replay"
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

# W6-SAFE-02 — the stamp is written HERE: after every DDL stage has SUCCEEDED, and
# BEFORE jest, so no post-suite statement can discard SUITE_STATUS. It AUTHORIZES
# NOTHING and is never read as permission. It is mutable metadata serving as a
# target identifier for a later readback that connects over TCP and so cannot use
# `docker exec`, and as a run-scoped key for a synthetic tenant.
if [ -n "$OWN_CID" ]; then
  "${PSQL[@]}" -c "COMMENT ON DATABASE \"$ACTUAL_DB\" IS 'w6-harness run=$RUN_NONCE'" >/dev/null
fi

# ---------------------------------------------------------------------------
# 4. Invariant suite
# ---------------------------------------------------------------------------
STAGE="invariant-suite"
log "Running real-schema invariant suite"
cd "$ROOT"
# W6-SAFE-05 — the FULL suite is the gate and stays the default. W6_ONLY narrows
# selection for a targeted readback only, is loudly marked, and is REFUSED on a CI
# runner so a partial run can never masquerade as the gate.
JEST_ARGS=(--config jest.realschema.config.js --runInBand --forceExit)
GATE="full"
if [ -n "${W6_ONLY:-}" ]; then
  is_ephemeral_ci && fail "W6_ONLY must not be used on a CI runner: the real-schema gate is the full suite"
  GATE="partial"
  printf '\033[33m  *** W6_ONLY=%s — PARTIAL RUN. NOT THE REAL-SCHEMA GATE. ***\033[0m\n' "$W6_ONLY"
  JEST_ARGS+=(--testPathPattern "$W6_ONLY")
fi
# W6-SAFE-03 — under `set -e` a failing jest aborted here before `$?` could be
# read, losing the summary. Capture it directly; no pipe in the path.
set +e
W6_DB_URL="$DB_URL" npx jest "${JEST_ARGS[@]}"
SUITE_STATUS=$?
set -e

# Only a passing suite is "complete"; otherwise the exit trap must name the stage
# that actually failed.
[ "$SUITE_STATUS" = "0" ] && STAGE="complete"

log "Summary"
echo "  run nonce        : $RUN_NONCE"
echo "  target           : database=$ACTUAL_DB $([ -n "$OWN_CID" ] && echo "container=$OWN_CID published-port=$HOST_PORT" || echo "supplied (declared ephemeral runner, no container managed)")"
echo "  gate             : $GATE"
echo "  baseline restore : ${BASE_SECS}s"
echo "  migration replay : ${REPLAY_SECS}s ($REPLAYED migrations)"
echo "  public tables    : $TABLES"
echo "  jest exit code   : $SUITE_STATUS"
[ "$GATE" = "full" ] || echo "  NOTE: PARTIAL run — the real-schema gate requires W6_ONLY unset"
exit $SUITE_STATUS
