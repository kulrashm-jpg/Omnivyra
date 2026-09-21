#!/usr/bin/env node
/**
 * Cron rollout rider — classifies ONE Railway rollout for the cron registry
 * race fix (3AH-157, ed961483). READ-ONLY: Railway logs + GitHub compare.
 * Never touches Redis, the database, or the deployment.
 *
 *   node scripts/operator/cron-rollout-rider.cjs [incomingDeploymentId] [outgoingDeploymentId]
 *
 * What it proves, and what it cannot
 * ----------------------------------
 * The question is: after the outgoing (fixed) worker ZREMs itself, does its
 * identity stay/reappear in `omnivyra:cron:instances`?
 *
 *   FAILURE  the incoming worker reports the outgoing identity AFTER both the
 *            platform stopped the old container and it logged `removed=1`.
 *            A `[source=heartbeat]` line (3AH-169) makes this observable.
 *   PASS     the incoming worker made an ATTRIBUTABLE registry read after the
 *            removal, inside the registry window, and that read did not
 *            contain the outgoing identity. Attributable = a heartbeat
 *            `HEARTBEAT REGISTRY READ: clean` line (3AH-173), a cycle line
 *            (its duplicate line would follow), or a duplicate line naming
 *            only OTHER identities. Absence of a line proves nothing, so
 *            silence never yields PASS.
 *   NON-DECISIVE  duplicates seen while the predecessor was still alive /
 *            before its logged removal (normal Railway overlap), or the
 *            outgoing worker does not carry the fix.
 *   INCONCLUSIVE  evidence missing, malformed, or no attributable read.
 *
 * Timing model: application log timestamps are INGESTION times (lines can be
 * flushed together), so an app event's true time is <= its logged time.
 * Platform `Starting/Stopping Container` events anchor the ordering.
 */

'use strict';

const FIX_SHA = 'ed96148301e1b134517cf03b9ed371764d677b27';
const REGISTRY_WINDOW_MS = 15 * 60 * 1000; // INSTANCE_TTL_MS in backend/utils/cronInstrumentation.ts
const WINDOW_MARGIN_MS = 60 * 1000;        // stay clear of the window edge
const LOG_TAIL_MS = 30 * 1000;             // a cycle's duplicate line lands within this after it

const VERDICT = {
  PASS: 'DECISIVE PASS',
  FAIL: 'FAILURE — POST-DEREGISTRATION STALE IDENTITY',
  OVERLAP: 'NON-DECISIVE — EXPECTED LIVE OVERLAP',
  NOT_FIXED: 'NON-DECISIVE — OUTGOING WORKER NOT FIXED',
  INCONCLUSIVE: 'INCONCLUSIVE',
};

const RE = {
  starting: /^Starting Container/,
  stopping: /^Stopping Container/,
  sigterm: /Received SIGTERM/,
  deregistered: /\[cron\] instance (\S+) deregistered \(graceful shutdown, removed=(\w+)\)/,
  cycle: /\[cron\] instance=(\S+) cycle=/,
  duplicate: /\[cron\] \S*\s*DUPLICATE INSTANCES DETECTED: (.+?) \(this instance: ([^)\s]+)\)( \[source=heartbeat\])?/,
  // Exact 3AH-173 line: only ever emitted after a heartbeat read that really ran.
  cleanRead: /^\[cron\] HEARTBEAT REGISTRY READ: clean \(this instance: ([^)\s]+)\) \[source=heartbeat\]$/,
};

/** Railway `--json` output → [{ ts, ms, message }]; unparseable lines are dropped. */
function parseRailwayJsonLines(text) {
  return String(text)
    .split(/\r?\n/)
    .filter((l) => l.startsWith('{'))
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter((x) => x && typeof x.message === 'string' && typeof x.timestamp === 'string')
    .map((x) => ({ ts: x.timestamp, ms: Date.parse(x.timestamp), message: x.message }))
    .filter((x) => Number.isFinite(x.ms));
}

const first = (lines, re) => lines.find((x) => re.test(x.message)) || null;
const last = (lines, re) => [...lines].reverse().find((x) => re.test(x.message)) || null;

/** Raw log lines of both deployments → the minimal evidence the classifier needs. */
function extractEvidence(outLines, incLines, { outgoingFixed }) {
  const dereg = first(outLines, RE.deregistered);
  const lastCycle = last(outLines, RE.cycle);
  const outgoingInstance = dereg
    ? dereg.message.match(RE.deregistered)[1]
    : lastCycle ? lastCycle.message.match(RE.cycle)[1] : null;

  const incCycles = incLines.filter((x) => RE.cycle.test(x.message));
  const incomingInstance = incCycles.length ? incCycles[0].message.match(RE.cycle)[1] : null;

  const events = [];
  for (const x of incLines) {
    const c = x.message.match(RE.cycle);
    if (c) { events.push({ ms: x.ms, ts: x.ts, kind: 'cycle', thisInstance: c[1] }); continue; }
    const k = x.message.match(RE.cleanRead);
    if (k) { events.push({ ms: x.ms, ts: x.ts, kind: 'clean', source: 'heartbeat', thisInstance: k[1] }); continue; }
    const d = x.message.match(RE.duplicate);
    if (d) {
      events.push({
        ms: x.ms, ts: x.ts, kind: 'duplicate',
        source: d[3] ? 'heartbeat' : 'cycle',
        ids: d[1].split(',').map((s) => s.trim()).filter(Boolean),
        thisInstance: d[2],
      });
    }
  }

  const stop = first(outLines, RE.stopping);
  const sig = first(outLines, RE.sigterm);
  const start = first(incLines, RE.starting);
  return {
    outgoing: {
      fixed: outgoingFixed,
      instanceId: outgoingInstance,
      stopMs: stop ? stop.ms : null,
      sigtermMs: sig ? sig.ms : null,
      deregMs: dereg ? dereg.ms : null,
      removed: dereg ? dereg.message.match(RE.deregistered)[2] : null,
    },
    incoming: {
      instanceId: incomingInstance,
      startMs: start ? start.ms : null,
      logEndMs: incLines.length ? incLines[incLines.length - 1].ms : null,
      events,
    },
  };
}

/** Pure classifier. Same evidence in → same verdict out. */
function classifyRollout(ev) {
  const why = [];
  const out = ev && ev.outgoing;
  const inc = ev && ev.incoming;
  const num = (v) => typeof v === 'number' && Number.isFinite(v);

  if (!out || !inc || !out.instanceId || !inc.instanceId || !num(out.stopMs) || !Array.isArray(inc.events)) {
    return { verdict: VERDICT.INCONCLUSIVE, why: ['incomplete lifecycle evidence (instance identities or platform Stopping Container missing)'] };
  }
  if (out.fixed !== true) {
    return { verdict: VERDICT.NOT_FIXED, why: ['outgoing worker does not contain the serialized registry fix'] };
  }
  if (!num(out.deregMs) || out.removed !== '1') {
    return { verdict: VERDICT.INCONCLUSIVE, why: [`fixed worker did not log a clean deregistration (removed=${out.removed})`] };
  }

  // Only lines the INCOMING worker itself emitted count; anything else is unattributable.
  const mine = inc.events.filter((e) => e.thisInstance === inc.instanceId && num(e.ms));
  const removedAt = Math.max(out.stopMs, out.deregMs);
  const windowEnd = removedAt + REGISTRY_WINDOW_MS - WINDOW_MARGIN_MS;

  const predecessorSightings = mine.filter((e) => e.kind === 'duplicate' && e.ids.includes(out.instanceId));
  const stale = predecessorSightings.filter((e) => e.ms > removedAt);
  if (stale.length) {
    const e = stale[0];
    return {
      verdict: VERDICT.FAIL,
      why: [`${out.instanceId} still reported at ${e.ts} (source=${e.source}), after Stopping Container and removed=1`],
    };
  }

  const cleanReads = mine.filter((e) => e.ms > removedAt && e.ms <= windowEnd && (
    (e.kind === 'clean' && e.source === 'heartbeat') ||
    (e.kind === 'duplicate' && !e.ids.includes(out.instanceId)) ||
    (e.kind === 'cycle' && num(inc.logEndMs) && inc.logEndMs >= e.ms + LOG_TAIL_MS)
  ));
  if (cleanReads.length) {
    const e = cleanReads[0];
    return {
      verdict: VERDICT.PASS,
      why: [`attributable ${e.kind}${e.source ? `/${e.source}` : ''} registry read at ${e.ts}, after removal and inside the window, without ${out.instanceId}`],
    };
  }

  if (predecessorSightings.length) {
    return {
      verdict: VERDICT.OVERLAP,
      why: predecessorSightings.map((e) => `${e.source} sighting at ${e.ts} precedes the logged removal: predecessor not yet deregistered`),
    };
  }
  return { verdict: VERDICT.INCONCLUSIVE, why: ['no attributable registry read after the removal (a silent heartbeat proves nothing)'] };
}

module.exports = { classifyRollout, extractEvidence, parseRailwayJsonLines, VERDICT, FIX_SHA, REGISTRY_WINDOW_MS, WINDOW_MARGIN_MS };

// ── CLI: read-only fetch, then classify ──────────────────────────────────────
if (require.main === module) {
  const { execSync } = require('child_process');
  const P = 'e35e543a-ece7-4147-bfff-0d35779febf1';
  const S = '603c0f26-d12e-4ee3-bb59-8e943c00b871';
  const RW = process.platform === 'win32' ? 'railway.cmd' : 'railway';
  const sh = (cmd) => execSync(cmd, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
  const deps = JSON.parse(sh(`${RW} deployment list -p ${P} -e production -s ${S} --json`));
  const pick = (arg, fallback) => (arg ? deps.find((d) => d.id.startsWith(arg)) : fallback);
  const inc = pick(process.argv[2], deps[0]);
  const outDep = pick(process.argv[3], deps[deps.indexOf(inc) + 1]);
  const sha = (d) => (d && d.meta && d.meta.commitHash) || '';
  const fixed = (() => {
    const s = sha(outDep);
    if (!s) return false;
    if (s.startsWith(FIX_SHA.slice(0, 8))) return true;
    try {
      const st = sh(`gh api repos/kulrashm-jpg/Omnivyra/compare/${FIX_SHA}...${s} --jq .status`).trim();
      return st === 'identical' || st === 'ahead';
    } catch { return false; }
  })();
  const logs = (id) => parseRailwayJsonLines(sh(`${RW} logs ${id} -d -p ${P} -e production -s ${S} --lines 5000 --json`));
  const ev = extractEvidence(logs(outDep.id), logs(inc.id), { outgoingFixed: fixed });
  console.log(JSON.stringify({
    incoming: { id: inc.id, sha: sha(inc), status: inc.status },
    outgoing: { id: outDep.id, sha: sha(outDep), status: outDep.status, fixed },
    evidence: { outgoing: ev.outgoing, incoming: { ...ev.incoming, events: ev.incoming.events.map((e) => ({ ...e })) } },
    ...classifyRollout(ev),
  }, null, 2));
}
