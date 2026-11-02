#!/usr/bin/env node
/**
 * Programme Execution Register — validator and renderer.
 *
 *   node scripts/programme/register.js           validate + rewrite the generated block
 *   node scripts/programme/register.js --check   validate only (exit 1 on any rule breach)
 *
 * Source of truth: docs/programme/milestones.json. The generated block of
 * docs/programme/EXECUTION-REGISTER.md (between the GENERATED markers) is
 * rewritten from it; everything outside the markers is hand-written.
 *
 * Progress is counted by acceptance criteria (weight 1 each), never by code
 * volume. Accepted, T2, T1 and implemented-only criteria are reported in
 * separate columns and are never added together.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const SRC = path.join(ROOT, 'docs', 'programme', 'milestones.json');
const OUT = path.join(ROOT, 'docs', 'programme', 'EXECUTION-REGISTER.md');
const EFFORT = path.join(ROOT, 'docs', 'programme', 'effort-log.csv');
const BEGIN = '<!-- GENERATED:BEGIN (scripts/programme/register.js) -->';
const END = '<!-- GENERATED:END -->';

const RANK = { open: 0, implemented: 1, t1: 2, t2: 3, accepted: 4 };
const STATUS_MIN = { Implemented: 1, 'T1 Verified': 2, 'T2 Verified': 3, Accepted: 4 };

function validate(reg) {
  const errors = [];
  const ids = new Set();
  for (const m of reg.milestones) {
    if (ids.has(m.id)) errors.push(`${m.id}: duplicate id`);
    ids.add(m.id);
    if (!reg.statuses.includes(m.status)) errors.push(`${m.id}: unknown status '${m.status}'`);
    if (!m.criteria || m.criteria.length === 0) errors.push(`${m.id}: no acceptance criteria`);
    for (const c of m.criteria || []) {
      if (!(c.state in RANK)) errors.push(`${m.id}/${c.id}: unknown state '${c.state}'`);
      if (RANK[c.state] >= RANK.t1 && !c.evidence) errors.push(`${m.id}/${c.id}: '${c.state}' without evidence`);
    }
    if (m.status === 'Accepted' && (m.criteria || []).some((c) => c.state !== 'accepted' || !c.evidence)) {
      errors.push(`${m.id}: Accepted requires every criterion accepted with evidence`);
    }
    const need = STATUS_MIN[m.status];
    if (need !== undefined && !(m.criteria || []).some((c) => RANK[c.state] >= need)) {
      errors.push(`${m.id}: status '${m.status}' but no criterion has reached that level`);
    }
    if (m.status === 'Blocked' && !m.blockers) errors.push(`${m.id}: Blocked without a named blocker`);
    if (m.status !== 'Not Started' && m.status !== 'Deferred' && m.status !== 'Blocked' && !m.actual_start) {
      errors.push(`${m.id}: '${m.status}' without actual_start`);
    }
    for (const d of m.deps || []) if (!reg.milestones.some((x) => x.id === d)) errors.push(`${m.id}: unknown dependency ${d}`);
  }
  return errors;
}

function bands(criteria) {
  const b = { total: criteria.length, accepted: 0, t2: 0, t1: 0, implemented: 0, open: 0 };
  for (const c of criteria) b[c.state] += 1;
  return b;
}
const pct = (n, d) => (d === 0 ? '—' : `${Math.round((100 * n) / d)}%`);

function progressRows(reg) {
  const rows = [];
  const all = [];
  for (const [g, name] of Object.entries(reg.groups)) {
    const crit = reg.milestones.filter((m) => m.group === g).flatMap((m) => m.criteria);
    all.push(...crit);
    rows.push([name, bands(crit)]);
  }
  rows.push(['**Overall programme**', bands(all)]);
  return rows.map(([name, b]) => `| ${name} | ${b.total} | ${pct(b.accepted, b.total)} | ${pct(b.t2, b.total)} | ${pct(b.t1, b.total)} | ${pct(b.implemented, b.total)} | ${pct(b.open, b.total)} |`);
}

function windowEnd(w) {
  const m = /(\d{4}-\d{2}-\d{2})\s*$/.exec(w || '');
  return m ? m[1] : null;
}

function render(reg, today) {
  const lines = [];
  lines.push(`_Generated ${today} from docs/programme/milestones.json. Percentages count acceptance criteria; columns are exclusive (each criterion is counted once, at its current state)._`, '');
  lines.push('### Progress', '', '| Scope | Criteria | Accepted | T2 verified | T1 verified | Implemented, unverified | Open |', '| --- | --- | --- | --- | --- | --- | --- |');
  lines.push(...progressRows(reg), '');

  const byStatus = {};
  for (const m of reg.milestones) byStatus[m.status] = (byStatus[m.status] || 0) + 1;
  lines.push('### Milestones by status', '', reg.statuses.map((s) => `${s}: ${byStatus[s] || 0}`).join(' · '), '');

  lines.push('### Milestone register', '', '| ID | Title | Status | Owner | Target window | Age (days) | Variance | Tier | Blockers | Next action | Approval |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const [g, name] of Object.entries(reg.groups)) {
    lines.push(`| **${g}** | **${name}** | | | | | | | | | |`);
    for (const m of reg.milestones.filter((x) => x.group === g)) {
      const age = m.actual_start === 'pre-programme' ? 'pre' : m.actual_start ? Math.max(0, Math.round((Date.parse(today) - Date.parse(m.actual_start)) / 86400000)) : '—';
      const end = windowEnd(m.target_window);
      const done = m.status === 'Accepted';
      const variance = !end ? 'n/a' : done ? 'met' : (Date.parse(today) > Date.parse(end) ? `overdue ${Math.round((Date.parse(today) - Date.parse(end)) / 86400000)}d` : 'on window');
      const esc = (s) => String(s ?? '—').replace(/\|/g, '/');
      lines.push(`| ${m.id} | ${esc(m.title)} | ${m.status} | ${esc(m.owner)} | ${esc(m.target_window)} | ${age} | ${variance} | ${m.tier} | ${esc(m.blockers)} | ${esc(m.next_action)} | ${esc(m.approval_required)} |`);
    }
  }
  lines.push('');

  lines.push('### Effort (estimates are inferred ranges, not recorded time)', '', '| Scope | Agent hours (estimate) | Founder hours (estimate) | Confidence | Basis |', '| --- | --- | --- | --- | --- |');
  for (const e of reg.effort_estimates) lines.push(`| ${e.scope} | ${e.agent_hours} | ${e.founder_hours} | ${e.confidence} | ${e.basis} |`);
  lines.push('');

  if (fs.existsSync(EFFORT)) {
    // Columns: date,contributor,milestone_ids,activity,start_utc,end_utc,minutes,method,notes.
    // Only rows whose method starts with "recorded" (start/end captured) count as recorded time.
    const rows = fs.readFileSync(EFFORT, 'utf8').trim().split(/\r?\n/).slice(1).filter(Boolean).map((r) => r.split(','));
    const sum = (rs) => rs.reduce((n, f) => n + (Number(f[6]) || 0), 0) / 60;
    const recorded = rows.filter((f) => /^recorded/.test(f[7] || ''));
    const inferred = rows.filter((f) => !/^recorded/.test(f[7] || ''));
    lines.push('### Effort log', '', `Recorded: ${sum(recorded).toFixed(1)} h in ${recorded.length} entries (start/end captured). Inferred: ${sum(inferred).toFixed(1)} h in ${inferred.length} entries (no timer; not evidence of time worked). Agent wall-clock is not human working time. Source: docs/programme/effort-log.csv.`, '');
  }
  return lines.join('\n');
}

function main() {
  const reg = JSON.parse(fs.readFileSync(SRC, 'utf8'));
  const errors = validate(reg);
  if (errors.length) {
    process.stderr.write(`register: ${errors.length} rule breach(es)\n${errors.map((e) => `  - ${e}`).join('\n')}\n`);
    process.exitCode = 1;
    return;
  }
  if (process.argv.includes('--check')) { process.stdout.write(`register: OK (${reg.milestones.length} milestones)\n`); return; }
  const today = process.env.REGISTER_DATE || new Date().toISOString().slice(0, 10);
  const doc = fs.readFileSync(OUT, 'utf8');
  const a = doc.indexOf(BEGIN);
  const b = doc.indexOf(END);
  if (a < 0 || b < a) { process.stderr.write('register: GENERATED markers missing in EXECUTION-REGISTER.md\n'); process.exitCode = 1; return; }
  fs.writeFileSync(OUT, `${doc.slice(0, a + BEGIN.length)}\n${render(reg, today)}\n${doc.slice(b)}`);
  process.stdout.write(`register: rendered ${reg.milestones.length} milestones\n`);
}

module.exports = { validate, bands };
if (require.main === module) main();
