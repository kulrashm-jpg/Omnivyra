/**
 * WS-3 M8 — non-vacuity injector.
 *
 * Writes ONE real defect into the shipped runtime, so the certification suite
 * can be shown to fail on it, then restores the file byte for byte. A proof
 * that has never been seen to fail is not a proof.
 *
 *   node scripts/ws3-m8/inject.cjs D1        # inject
 *   node scripts/ws3-m8/inject.cjs restore   # restore every file
 */
/* eslint-disable no-console */

const fs = require('fs');
const BACKUP = 'c:/tmp/m8-orig.json';
const { P, orig } = JSON.parse(fs.readFileSync(BACKUP, 'utf8'));

const restore = () => { for (const k of Object.keys(P)) fs.writeFileSync(P[k], orig[k]); };

const patch = (key, from, to) => {
  if (!orig[key].includes(from)) { console.error(`ANCHOR MISS in ${key}`); process.exit(2); }
  fs.writeFileSync(P[key], orig[key].replace(from, to));
};

const which = process.argv[2];
restore();
if (which === 'restore') { console.log('restored'); process.exit(0); }

const DEFECTS = {
  // Remove the compare-and-set claim: two dispatchers can now both proceed.
  D1: () => patch('dispatch',
    "const claimedQueued = await transitionOutreachTaskState(companyId, task.id, 'approved', 'queued');",
    "const claimedQueued = { ok: true, changed: true, error: null } as never;\n  await setOutreachTaskState(companyId, task.id, { status: 'queued' });"),

  // Suppression gate stops refusing on the recipient scope.
  D2: () => patch('gov',
    "  if (suppressions.recipient) {\n    return block('suppression', 'suppression.recipient', 'the recipient is on the do-not-contact list', evidence, { scope: 'recipient' });\n  }",
    '  // defect: recipient suppression removed'),

  // A duplicate outcome is reported as a NEW record.
  D3: () => patch('store',
    "    if (code === '23505') return { ok: true, duplicate: true };\n    return { ok: false, error: errText(res.error) };\n  }\n  return { ok: true };\n}\n\nexport async function appendDecision",
    "    if (code === '23505') return { ok: true, duplicate: false };\n    return { ok: false, error: errText(res.error) };\n  }\n  return { ok: true };\n}\n\nexport async function appendDecision"),

  // Telemetry starts labelling with an unbounded identifier.
  D4: () => patch('tel',
    "export function recordFeedbackRouting(axis: 'delivery' | 'business', signal: string): void {\n  counter(OUTREACH_METRICS.feedback.routed, { axis, signal });",
    "export function recordFeedbackRouting(axis: 'delivery' | 'business', signal: string): void {\n  counter(OUTREACH_METRICS.feedback.routed, { axis, signal, task: `cto@bigcorp.test` });"),

  // Health stops guarding its indicators.
  D5: () => patch('health',
    '    try {\n      return fn();\n    } catch (e) {\n      return { name, status: \'unknown\', detail: e instanceof Error ? e.message : String(e) };\n    }',
    '    return fn();'),

  // The limiter assumes capacity when the durable truth is unreadable.
  D6: () => patch('quota',
    "  if (!durable.ok) {\n    return {\n      granted: false, layer: 'db', reserved: false,",
    "  if (!durable.ok) {\n    return {\n      granted: true, layer: 'db', reserved: false,"),
};

const fn = DEFECTS[which];
if (!fn) { console.error(`unknown defect: ${which}`); process.exit(2); }
fn();
console.log('injected', which);
