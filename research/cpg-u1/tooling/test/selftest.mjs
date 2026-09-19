// Self-test for CPG U1 dataset tooling v5 (Protocol-004; CPG-044 execution harness). SYNTHETIC data only (SYNTHETIC-* names,
// *.example domains, identifiers generated here). The DETECTOR section scans the clean
// clone for company names that CPG history already established as contaminated
// (CPG-032..035) and asserts nothing about those companies beyond that.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsv, toCsv } from '../lib/csv.mjs';
import { canonicalJson, hashRecords, sha256 } from '../lib/canonical.mjs';
import { isValidCik, isValidCnpj, isValidLei, isValidQid, isValidSiren, luhn, mod97, toDigits } from '../lib/identifiers.mjs';
import {
  ADJUDICATION_COLUMNS, BLIND_RECORD_COLUMNS, DEVELOPMENT_QUOTA, FRAME_COLUMNS, REFERENCE_COLUMNS, checkBlindRecord, checkFrameRow,
} from '../lib/schema.mjs';
import { nameVariants, registryMatches, scanScope, scanText, tokensFor } from '../lib/scan.mjs';
import { drawDevelopment, drawHeldOut, orderedClass } from '../lib/select.mjs';
import { SIZING, heldOutQuotas } from '../lib/sizing.mjs';
import { reconcile } from '../lib/reconcile.mjs';
import { toolingManifest } from '../lib/aggregate.mjs';
import * as B from '../lib/bitcoin.mjs';
import * as CM from '../lib/commitment.mjs';
import * as DR from '../lib/drand.mjs';
import * as RG from '../lib/registration.mjs';
import * as SA from '../lib/sampling.mjs';
import * as S from './synthchain.mjs';
import * as FR from '../lib/frame.mjs';
import * as RO from '../lib/raterOrder.mjs';
import * as PK from '../lib/packets.mjs';
import * as PE from '../lib/personnel.mjs';
import * as EX from '../lib/execution.mjs';
import * as HA from '../lib/harness.mjs';
import * as EL from '../lib/eventlog.mjs';
import * as AR from '../lib/archive.mjs';
import * as RP from '../lib/raterPackets.mjs';
import * as CX from '../lib/cpgExecutor.mjs';
import * as ET from '../lib/evaluationTree.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const TOOL = join(HERE, '..', 'cpg_u1_data.mjs');
const REGISTRY = join(HERE, '..', 'rules', 'development_only_registry.json');
// F1 (CPG-037A): any stable file shipped inside this tooling. The draw commands only hash it; no assertion reads it.
const PROTOCOL = join(HERE, '..', 'README.md');
const FROZEN_SHA = 'f01a7eb4199be4e04d4fee7fc0116303949dc553';

// F2 (CPG-037A): the resolver clone is a REQUIRED, documented rebuild input — no machine-specific fallback.
// CPG_U1_RESOLVER_CLONE must name a clean git clone checked out at FROZEN_SHA. This is the only environment input.
const CLEAN_CLONE = process.env.CPG_U1_RESOLVER_CLONE;
{
  const stop = (msg) => { console.error(`SELFTEST PRECONDITION FAILED: ${msg}`); process.exit(2); };
  if (!CLEAN_CLONE) stop('CPG_U1_RESOLVER_CLONE is not set. Set it to a clean git clone of the resolver repository at commit f01a7eb4199be4e04d4fee7fc0116303949dc553 (git is required).');
  if (!existsSync(CLEAN_CLONE)) stop(`CPG_U1_RESOLVER_CLONE="${CLEAN_CLONE}" does not exist.`);
  let head = '';
  let dirty = '';
  try {
    head = execFileSync('git', ['-C', CLEAN_CLONE, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    dirty = execFileSync('git', ['-C', CLEAN_CLONE, 'status', '--porcelain'], { encoding: 'utf8' }).trim();
  } catch { stop(`git could not read CPG_U1_RESOLVER_CLONE="${CLEAN_CLONE}" (git is required; the path must be a git clone).`); }
  if (head !== FROZEN_SHA) stop(`CPG_U1_RESOLVER_CLONE is at ${head}, not the frozen resolver commit ${FROZEN_SHA}.`);
  if (dirty) stop('CPG_U1_RESOLVER_CLONE has working-tree changes; a clean clone is required.');
  console.log(`rebuild input: CPG_U1_RESOLVER_CLONE=${CLEAN_CLONE} @ ${head} (clean)`);
}
// §13.1 provider configuration of the frozen resolver (registered before registration; the harness recomputes it).
const PROVIDER_SHA = HA.providerConfigurationSha(CLEAN_CLONE);

let pass = 0; const failures = [];
// CPG-044: a crash (an exception a mutant provokes in a later section) must never hide the result. The summary is always
// printed, and a crash is itself a counted failure labelled SELFTEST CRASHED.
let summaryPrinted = false;
process.on('exit', (code) => {
  if (summaryPrinted) return;
  console.log(`\nselftest: ${pass} passed, ${failures.length + 1} failed`);
  for (const f of failures) console.log(`  FAIL: ${f}`);
  console.log(`  FAIL: SELFTEST CRASHED (exit ${code}) — see stderr`);
  process.exitCode = 1;
});
const ok = (cond, name) => { if (cond) pass++; else failures.push(name); };
const throws = (fn, name) => { try { fn(); failures.push(name); } catch { pass++; } };
const run = (argv, { expectCode = 0, env = {} } = {}) => {
  try {
    const out = execFileSync(process.execPath, [TOOL, ...argv], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } });
    if (expectCode !== 0) failures.push(`expected exit ${expectCode}, got 0: ${argv[0]}`);
    return out;
  } catch (e) {
    if (e.status !== expectCode) failures.push(`exit ${e.status} != ${expectCode}: ${argv[0]} :: ${(e.stderr || '').slice(0, 300)}`);
    return (e.stdout || '') + (e.stderr || '');
  }
};

// ── synthetic identifiers ───────────────────────────────────────────────────
const lei = (n) => { const b = `SYNTH${String(n).padStart(13, '0')}`; return `${b}${String(98 - mod97(toDigits(`${b}00`))).padStart(2, '0')}`; };
const siren = (n) => { const b = String(100000000 + n).slice(1, 9); for (let d = 0; d < 10; d++) if (luhn(b + d)) return b + d; throw new Error('siren'); };
const cnpj = (b12) => { for (let a = 0; a < 10; a++) for (let b = 0; b < 10; b++) if (isValidCnpj(`${b12}${a}${b}`)) return `${b12}${a}${b}`; throw new Error('cnpj'); };

// ── 1. identifiers ──────────────────────────────────────────────────────────
for (let i = 1; i <= 40; i++) {
  ok(isValidLei(lei(i)) && !isValidLei(lei(i).slice(0, 19) + ((Number(lei(i)[19]) + 1) % 10)), `lei ${i}`);
  ok(isValidSiren(siren(i)) && !isValidSiren(siren(i).slice(0, 8) + ((Number(siren(i)[8]) + 1) % 10)), `siren ${i}`);
}
ok(isValidSiren('356000000'), 'siren La Poste exception');
ok(isValidCnpj(cnpj('112223330001')) && isValidCnpj(cnpj('12ABC34501DE')) && !isValidCnpj('11111111111111'), 'cnpj');
ok(isValidCik('900001') && isValidCik('0000900001') && !isValidCik('0') && !isValidCik('12345678901'), 'cik (synthetic values)');
ok(isValidQid('Q9000001') && !isValidQid('Q0') && !isValidQid('q9000001'), 'qid (synthetic values)');

// ── 2. csv + hashing ────────────────────────────────────────────────────────
{
  const rows = [{ a: 'x,y', b: 'he said "hi"' }, { a: 'l1\nl2', b: '' }];
  ok(canonicalJson(parseCsv(toCsv(['a', 'b'], rows)).records) === canonicalJson(rows), 'csv roundtrip');
  throws(() => parseCsv('a,b\n1\n'), 'csv ragged rejected');
  ok(hashRecords([{ id: 'b', v: 1 }, { id: 'a', v: 2 }], 'id') === hashRecords([{ v: 2, id: 'a' }, { id: 'b', v: 1 }], 'id'), 'hash reorder-stable');
}

// ── synthetic frame builder ─────────────────────────────────────────────────
const FAM = [['US-SEC', 'CIK'], ['FR-SIRENE', 'SIREN'], ['BR-CNPJ', 'CNPJ'], ['LEI-ONLY', 'LEI']];
let serial = 0;
function row(cls, o = {}) {
  const n = ++serial;
  const [fam, scheme] = FAM[n % 4];
  const value = scheme === 'CIK' ? String(900000 + n) : scheme === 'SIREN' ? siren(n) : scheme === 'CNPJ' ? cnpj(String(500000000000 + n)) : lei(n);
  return {
    candidate_id: `SYN-${String(n).padStart(4, '0')}`, company_name: `SYNTHETIC-CO-${n}`, canonical_domain: `synthetic-${n}.example`,
    jurisdiction_family: fam, identifier_scheme: scheme, identifier_value: value, wikidata_qid: '',
    identifier_domain_evidence_url: `https://registry.example/e/${n}`, identifier_domain_evidence_note: 'SYNTHETIC registry names domain',
    expected_outcome_class: cls, identity_hazard_note: cls === 'identity-hazard' ? 'SYNTHETIC collision' : '',
    a1_operating_legal_entity: 'yes', a2_domain_controlled_https: 'yes', a4_tie_independent_of_cpg: 'yes', a6_reference_obtainable: 'yes',
    c1_2_used_in_cpg_work: 'no', c1_3_values_derived_from_cpg: 'no', c1_4_prior_cpg_execution: 'no', c1_5_internal_or_owned: 'no',
    enumerated_by: 'synthetic-enumerator', enumerated_at: '2026-09-16', enumeration_source_url: 'https://registry.example/list',
    ...o,
  };
}
const chk = (o, cls = 'fill-expected') => checkFrameRow(row(cls, o), { allowSynthetic: true });

// ── 3. frame rules: tri-state UNKNOWN ───────────────────────────────────────
{
  ok(chk({}).exclusion === null && chk({}).contamination.length === 0, 'clean row admissible, eligible');
  ok(checkFrameRow(row('fill-expected')).errors.some((e) => e.includes('SYNTHETIC')), 'synthetic rejected outside test mode');

  // EXHAUSTIVE: every combination of {yes,no,unknown} over A1/A2/A4/A6 — admissible iff all yes.
  const V = ['yes', 'no', 'unknown']; let combos = 0; let wrong = 0;
  for (const a1 of V) for (const a2 of V) for (const a4 of V) for (const a6 of V) {
    combos++;
    const r = chk({ a1_operating_legal_entity: a1, a2_domain_controlled_https: a2, a4_tie_independent_of_cpg: a4, a6_reference_obtainable: a6 });
    const all = a1 === 'yes' && a2 === 'yes' && a4 === 'yes' && a6 === 'yes';
    if ((r.exclusion === null) !== all || r.errors.length) wrong++;
  }
  ok(combos === 81 && wrong === 0, `EXHAUSTIVE 81 attestation combinations: admissible iff all yes (wrong=${wrong})`);

  const ex = (o, cls) => chk(o, cls).exclusion;
  ok(ex({ a1_operating_legal_entity: 'no' }) === 'A1_NOT_OPERATING_ENTITY', 'A1 no → false reason');
  ok(ex({ a1_operating_legal_entity: 'unknown' }) === 'A1_NOT_ESTABLISHED', 'A1 unknown → NOT_ESTABLISHED, not false');
  ok(ex({ canonical_domain: 'UNKNOWN', a2_domain_controlled_https: 'unknown' }) === 'A2_NOT_ESTABLISHED', 'A2 UNKNOWN domain');
  ok(ex({ canonical_domain: 'UNKNOWN', a2_domain_controlled_https: 'yes' }) === 'A2_NOT_ESTABLISHED', 'A2 UNKNOWN domain cannot pass even if attested yes');
  ok(ex({ identifier_scheme: 'UNKNOWN', identifier_value: '' }) === 'A3_NOT_ESTABLISHED', 'A3 UNKNOWN identifier');
  ok(ex({ identifier_value: '123456789' }) === 'A3_INVALID_IDENTIFIER' || ex({ identifier_scheme: 'LEI', identifier_value: 'SYNTH00000000000000X9' }) === 'A3_INVALID_IDENTIFIER', 'A3 invalid');
  ok(ex({ a4_tie_independent_of_cpg: 'unknown' }) === 'A4_NOT_ESTABLISHED', 'A4 unknown');
  ok(ex({ identifier_domain_evidence_url: '' }) === 'A4_NO_INDEPENDENT_TIE', 'A4 yes without evidence url fails');
  ok(ex({ jurisdiction_family: 'UNKNOWN' }) === 'A5_NOT_ESTABLISHED', 'A5 UNKNOWN jurisdiction');
  ok(ex({ jurisdiction_family: 'GB-COMPANIES-HOUSE' }) === 'A5_INACCESSIBLE_JURISDICTION', 'A5 inaccessible');
  ok(ex({ jurisdiction_family: 'US-SEC', identifier_scheme: 'SIREN', identifier_value: siren(3) }) === 'A3_INVALID_IDENTIFIER', 'A3 wrong scheme for family');
  ok(ex({ a6_reference_obtainable: 'unknown' }) === 'A6_NOT_ESTABLISHED', 'A6 unknown');
  ok(ex({ expected_outcome_class: 'unknown' }) === 'OUTCOME_CLASS_NOT_ESTABLISHED', 'outcome class unknown');

  const mal = (o) => chk(o).errors.length > 0;
  ok(mal({ canonical_domain: '' }), 'blank domain malformed (must write UNKNOWN)');
  ok(mal({ jurisdiction_family: '' }), 'blank jurisdiction malformed');
  ok(mal({ identifier_scheme: '' }), 'blank scheme malformed');
  ok(mal({ expected_outcome_class: '' }), 'blank outcome class malformed');
  ok(mal({ a1_operating_legal_entity: '' }), 'blank attestation malformed');
  ok(mal({ a1_operating_legal_entity: 'Unknown' }), 'mis-cased attestation malformed');
  ok(mal({ a1_operating_legal_entity: 'maybe' }), 'ambiguous attestation malformed');
  ok(mal({ identifier_scheme: 'UNKNOWN', identifier_value: '123' }), 'UNKNOWN scheme with a value malformed');
  ok(mal({ identifier_value: '' }), 'known scheme with blank value malformed');
  ok(mal({ canonical_domain: 'www.synthetic-1.example' }), 'www domain malformed');
  ok(mal({ canonical_domain: 'Synthetic-1.example' }), 'uppercase domain malformed');
  ok(mal({ canonical_domain: 'https://synthetic-1.example' }), 'scheme in domain malformed');

  for (const c of ['c1_2_used_in_cpg_work', 'c1_3_values_derived_from_cpg', 'c1_4_prior_cpg_execution', 'c1_5_internal_or_owned']) {
    ok(chk({ [c]: 'yes' }).contamination.length === 1 && chk({ [c]: 'yes' }).exclusion === null, `${c}=yes → ineligible but admissible`);
    ok(chk({ [c]: 'unknown' }).contamination.some((b) => b.includes('NOT ESTABLISHED')), `${c}=unknown → treated as contaminated`);
    ok(chk({ [c]: 'no' }).contamination.length === 0, `${c}=no → no contamination`);
  }
}

// ── 4. scan scope + registry ────────────────────────────────────────────────
{
  ok(scanScope('backend/tests/unit/x.test.ts') === 'TEST' && scanScope('src/__snapshots__/a.snap') === 'TEST', 'scope TEST');
  ok(scanScope('backend/services/companyProfile/grounding/types.ts') === 'CPG_IMPLEMENTATION', 'scope CPG grounding source');
  ok(scanScope('backend/evaluation/canonicalGrounding/dataset.ts') === 'CPG_IMPLEMENTATION', 'scope evaluation harness');
  ok(scanScope('pages/api/company-grounding/[companyId].ts') === 'CPG_IMPLEMENTATION' && scanScope('components/companyFactsLookupResult.ts') === 'CPG_IMPLEMENTATION', 'scope CPG routes/UI');
  ok(scanScope('backend/services/billing/wallet.ts') === null && scanScope('docs/x.md') === null, 'out-of-scope paths ignored');
  ok(tokensFor({ company_name: 'X Co', canonical_domain: 'UNKNOWN', identifier_value: '', wikidata_qid: '' }).every((t) => t.kind !== 'domain'), 'UNKNOWN domain yields no token');
  const t = tokensFor({ company_name: 'Acme Widgets Ltd', canonical_domain: 'acme-widgets.example', identifier_value: 'SYNTH0000000000000142', wikidata_qid: '' });
  ok(scanText("toBe('Acme Widgets')", t).some((h) => h.kind === 'name') && scanText('AcmeWidgetsLtdX', t).length === 0, 'name word-boundary');
  ok(nameVariants('Example Holdings, Inc.').includes('Example Holdings'), 'legal suffix stripped');

  const reg = JSON.parse(readFileSync(REGISTRY, 'utf8'));
  const m = (name, domain) => registryMatches({ company_name: name, canonical_domain: domain }, reg).map((x) => x.entry_id);
  ok(m('Omnivyra', 'UNKNOWN').includes('DEV-001'), 'registry: Omnivyra by name even with UNKNOWN domain');
  ok(m('Some Renamed Co', 'omnivyra.com').includes('DEV-001'), 'registry: Omnivyra by domain even if renamed');
  ok(m('Some Co', 'app.omnivyra.com').includes('DEV-001'), 'registry: subdomain of a registry domain');
  ok(m('Some Co', 'notomnivyra.com').length === 0, 'registry: suffix-lookalike domain NOT matched');
  ok(m('Mercury SYNTHETIC-PROBE Holdings', 'synthetic-mercury.example').includes('DEV-006'), 'registry: Mercury name-only conservative match');
  ok(m('Stripeline Holdings', 'synthetic-s.example').length === 0, 'registry: registry name inside a longer word (Stripe ⊂ Stripeline) NOT matched');
  ok(m('Omnivyrasoft Ltd', 'synthetic-o.example').length === 0, 'registry: Omnivyra ⊂ Omnivyrasoft NOT matched');
  ok(m('Stripe SYNTHETIC-PROBE Payments', 'synthetic-s2.example').includes('DEV-010'), 'registry: registry name as a whole word IS matched');
  ok(scanText('const x = "NotAcme Widgets"', t).length === 0, 'scan: name not matched when glued to a preceding word');
  ok(m('SYNTHETIC-CO-1', 'synthetic-1.example').length === 0, 'registry: synthetic not matched');
  ok(reg.entries.every((e) => e.basis.length > 0 && e.evidence), 'registry: every entry cites basis + evidence');
}

// ── 5. two-stage draw ───────────────────────────────────────────────────────
serial = 0;
const frame = [
  ...Array.from({ length: 60 }, () => row('fill-expected')),
  ...Array.from({ length: 24 }, () => row('abstention-expected')),
  ...Array.from({ length: 16 }, () => row('identity-hazard')),
];
const SEED_D = sha256('synthetic-dev-seed');
const SEED_H = sha256('synthetic-heldout-seed');
const QUOTAS = { 'fill-expected': 12, 'abstention-expected': 5, 'identity-hazard': 3 };
const idsOf = (a) => a.map((c) => c.candidate_id);
{
  const inel = new Set(['SYN-0001', 'SYN-0002', 'SYN-0061', 'SYN-0085']);
  const d = drawDevelopment(frame, inel, SEED_D);
  ok(d.ok && d.development.length === 10, 'development exact 10');
  const q = (arr, cls) => arr.filter((c) => c.expected_outcome_class === cls).length;
  ok(q(d.development, 'fill-expected') === 6 && q(d.development, 'abstention-expected') === 2 && q(d.development, 'identity-hazard') === 2, 'development exact 6/2/2');
  ok([...inel].every((id) => d.development.some((c) => c.candidate_id === id)), 'ineligible companies preferred into development');
  ok(canonicalJson(idsOf(drawDevelopment([...frame].reverse(), inel, SEED_D).development)) === canonicalJson(idsOf(d.development)), 'development order-independent');

  // development surplus: more ineligible than the development quota → surplus stays undrawn, NEVER held-out
  const manyInel = new Set(frame.filter((c) => c.expected_outcome_class === 'identity-hazard').slice(0, 5).map((c) => c.candidate_id));
  const d2 = drawDevelopment(frame, manyInel, SEED_D);
  ok(q(d2.development, 'identity-hazard') === 2, 'development capped at quota even with surplus ineligible');
  const devIds2 = new Set(idsOf(d2.development));
  const h2 = drawHeldOut(frame, manyInel, devIds2, SEED_H, QUOTAS);
  ok(h2.ok && !h2.heldOut.some((c) => manyInel.has(c.candidate_id)), 'surplus ineligible never enters held-out');

  const devIds = new Set(idsOf(d.development));
  const h = drawHeldOut(frame, inel, devIds, SEED_H, QUOTAS);
  ok(h.ok && h.heldOut.length === 20, 'held-out 20');
  ok(!h.heldOut.some((c) => inel.has(c.candidate_id) || devIds.has(c.candidate_id)), 'held-out ∩ (ineligible ∪ development) = ∅');
  ok(q(h.heldOut, 'fill-expected') === 12 && q(h.heldOut, 'abstention-expected') === 5 && q(h.heldOut, 'identity-hazard') === 3, 'held-out exact quotas');
  ok(new Set(h.heldOut.filter((c) => c.expected_outcome_class === 'fill-expected').map((c) => c.jurisdiction_family)).size === 4, 'round-robin covers all 4 families');
  ok(canonicalJson(idsOf(drawHeldOut(frame.map((c) => ({ ...c, company_name: `${c.company_name}-R` })), inel, devIds, SEED_H, QUOTAS).heldOut)) === canonicalJson(idsOf(h.heldOut)), 'rename cannot re-roll');
  ok(canonicalJson(idsOf(drawHeldOut(frame, inel, devIds, sha256('other'), QUOTAS).heldOut)) !== canonicalJson(idsOf(h.heldOut)), 'different seed → different held-out');

  // adversarial: mark every would-be held-out company ineligible
  const would = new Set(idsOf(h.heldOut));
  const hA = drawHeldOut(frame, new Set([...inel, ...would]), devIds, SEED_H, QUOTAS);
  ok(hA.ok && !hA.heldOut.some((c) => would.has(c.candidate_id)), 'adversarial: none of the would-be held-out remain');

  // pool minimum (2x) — exactly at threshold passes, one below refuses
  const exact = frame.filter((c) => c.expected_outcome_class !== 'identity-hazard').concat(frame.filter((c) => c.expected_outcome_class === 'identity-hazard').slice(0, 6));
  ok(drawHeldOut(exact, new Set(), new Set(), SEED_H, QUOTAS).ok, 'held-out pool at exactly 2x quota passes');
  const below = exact.filter((c) => c.candidate_id !== exact.filter((x) => x.expected_outcome_class === 'identity-hazard')[0].candidate_id);
  const rb = drawHeldOut(below, new Set(), new Set(), SEED_H, QUOTAS);
  ok(!rb.ok && rb.shortfall.some((s) => s.class === 'identity-hazard' && s.pool_required === 6 && s.pool_available === 5), 'held-out pool one below 2x refuses');
  ok(!drawDevelopment(frame.filter((c) => c.expected_outcome_class !== 'identity-hazard').concat(frame.filter((c) => c.expected_outcome_class === 'identity-hazard').slice(0, 3)), new Set(), SEED_D).ok, 'development pool below 2x refuses');
  throws(() => drawDevelopment([...frame, { ...frame[0], candidate_id: 'SYN-DUPID' }], new Set(), SEED_D), 'duplicate identifier refused');
  throws(() => drawDevelopment([...frame, { ...frame[1], candidate_id: 'SYN-DUPDOM', identifier_value: String(123456789) , identifier_scheme: 'CIK', jurisdiction_family: 'US-SEC' }], new Set(), SEED_D), 'duplicate canonical domain refused');
  throws(() => drawDevelopment(frame, new Set(), 'weak'), 'weak seed refused');
  const o1 = orderedClass(frame.filter((c) => c.expected_outcome_class === 'fill-expected'), SEED_D);
  ok(new Set(idsOf(o1)).size === o1.length && o1.length === 60, 'ordering is a total permutation');
}

// ── 6. sizing ───────────────────────────────────────────────────────────────
{
  const dev = new Set(['D1', 'D2', 'D3', 'D4', 'D5', 'D6']);
  const pilot = (fills) => ({ results: fills.map((f, i) => ({ candidate_id: `D${i + 1}`, fills: f })) });
  const s = (fills) => heldOutQuotas(pilot(fills), dev);
  ok(SIZING.MIN_FILLS === 20 && SIZING.MIN_FILLS === Math.round(1 / 0.05), 'MIN_FILLS derived from θ_EFR = 0.05');
  ok(s([3, 3, 3, 3, 3, 3]).quotas['fill-expected'] === 12, 'yield 3 → floor 12');
  ok(s([1, 1, 1, 1, 1, 1]).quotas['fill-expected'] === 30, 'yield 1 → 30');
  ok(s([1, 0, 1, 0, 1, 0]).quotas['fill-expected'] === 60 && !s([1, 0, 1, 0, 1, 0]).capped, 'yield 0.5 → 60, not capped');
  const low = s([1, 0, 0, 0, 0, 0]);
  ok(low.quotas['fill-expected'] === 60 && low.capped === true, 'yield 1/6 → capped at 60 and flagged');
  ok(s([1, 1, 1, 1, 1, 1]).quotas['abstention-expected'] === 13 && s([1, 1, 1, 1, 1, 1]).quotas['identity-hazard'] === 8, 'secondary strata scale with fill-expected');
  ok(s([3, 3, 3, 3, 3, 3]).quotas['abstention-expected'] === 5 && s([3, 3, 3, 3, 3, 3]).quotas['identity-hazard'] === 3, 'secondary strata floors');
  const zero = s([0, 0, 0, 0, 0, 0]);
  ok(!zero.ok && zero.halt === true, 'zero pilot fills → HALT');
  ok(!heldOutQuotas(pilot([1, 1, 1, 1, 1]), dev).ok, 'pilot missing a company refused');
  ok(!heldOutQuotas({ results: [...pilot([1, 1, 1, 1, 1, 1]).results, { candidate_id: 'D1', fills: 1 }] }, dev).ok, 'duplicate pilot result refused');
  ok(!s([4, 1, 1, 1, 1, 1]).ok && !s([1.5, 1, 1, 1, 1, 1]).ok, 'fills outside integer 0-3 refused');
  ok(!heldOutQuotas({ results: [{ candidate_id: 'X9', fills: 1 }] }, dev).ok, 'non-development pilot company refused');
}

// ── 7. Bitcoin primitives — historical mainnet known-answer tests (test/fixtures/bitcoin) ──────────
const FIX = join(HERE, 'fixtures');
const fx = (f) => readFileSync(join(FIX, f), 'utf8').trim();
const fxJson = (f) => JSON.parse(fx(f));
{
  const hx = []; for (let h = 839989; h <= 840012; h++) hx.push(fx(`bitcoin/header_${h}.hex`));
  const c = B.verifyHeaderChain(839989, hx, B.MAINNET);
  let same = true; for (let h = 839989; h <= 840012; h++) if (c.at(h).hash !== fx(`bitcoin/hash_${h}.txt`)) same = false;
  ok(same && c.at(840000).hash === '0000000000000000000320283a032748cef8227873ff4872689bf23f1cda83a5', 'KAT mainnet headers 839989-840012: PoW, linkage, MTP, hashes (block 840000)');
  ok(B.medianTimePast(c, 840000) === [...Array(11)].map((_, i) => c.at(840000 - i).time).sort((a, b) => a - b)[5], 'MTP = median of the block and its 10 predecessors');
  const flipped = [...hx]; flipped[5] = flipped[5].slice(0, 150) + (flipped[5][150] === '0' ? '1' : '0') + flipped[5].slice(151);
  throws(() => B.verifyHeaderChain(839989, flipped, B.MAINNET), 'tampered interior header (nBits byte) refused');
  const lastFlip = [...hx]; lastFlip[23] = lastFlip[23].slice(0, 156) + (lastFlip[23][156] === '0' ? '1' : '0') + lastFlip[23].slice(157);
  ok(B.parseHeader(lastFlip[23]).bits === B.parseHeader(hx[23]).bits && B.parseHeader(lastFlip[23]).nonce !== B.parseHeader(hx[23]).nonce, 'probe: tip tamper changes the nonce only');
  throws(() => B.verifyHeaderChain(839989, lastFlip, B.MAINNET), 'tampered tip header (no successor): proof of work alone refuses it');
  throws(() => B.verifyHeaderChain(839989, [hx[0], ...hx.slice(2)], B.MAINNET), 'missing header (broken linkage) refused');
  throws(() => B.verifyHeaderChain(839989, [...hx.slice(0, 3), hx[3].slice(0, 158)], B.MAINNET), 'truncated header refused');
  const first = B.parseHeader(fx('bitcoin/header_836640.hex')); const last = B.parseHeader(fx('bitcoin/header_838655.hex')); const next = B.parseHeader(fx('bitcoin/header_838656.hex'));
  ok(B.expectedRetargetBits(first, last, B.MAINNET) === next.bits && next.bits === 0x17034219, 'KAT retarget at 838656 recomputed from 836640/838655');
  ok(B.expectedRetargetBits({ ...first, time: last.time - 1 }, last, B.MAINNET) === B.targetToBits((B.bitsToTarget(last.bits) * (1209600n / 4n)) / 1209600n), 'retarget clamps a short timespan to /4');
  ok(B.expectedRetargetBits({ ...first, time: last.time - 1209600 * 10 }, last, B.MAINNET) === B.targetToBits((B.bitsToTarget(last.bits) * (1209600n * 4n)) / 1209600n), 'retarget clamps a long timespan to x4');
  ok(B.expectedRetargetBits({ ...first, time: 0 }, { ...last, time: 1209600 * 8, bits: 0x1d00ffff }, B.MAINNET) === 0x1d00ffff, 'retarget capped at powLimit');
  ok(B.targetToBits(B.bitsToTarget(0x1d00ffff)) === 0x1d00ffff && B.targetToBits(B.bitsToTarget(0x17034219)) === 0x17034219 && B.targetToBits(0x80n) === 0x02008000, 'compact encoding round-trip incl. sign-bit shift');
  throws(() => B.bitsToTarget(0x04923456), 'negative compact target refused');
  throws(() => B.bitsToTarget(0xff123456), 'overflowing compact target refused');
  throws(() => B.checkProofOfWork({ ...next, bits: 0x1e00ffff, hash: next.hash }, B.MAINNET), 'target above mainnet powLimit refused');

  const txids = fxJson('bitcoin/block_840000_txids.json');
  ok(txids.length === 3050 && B.merkleRootFromTxids(txids) === c.at(840000).merkleRoot, 'KAT Merkle root of all 3050 txids of block 840000');
  const t5 = B.parseTransaction(fx('bitcoin/tx_840000_index5.hex'));
  const cb = B.parseTransaction(fx('bitcoin/tx_840000_coinbase.hex'));
  const dec5 = fxJson('bitcoin/tx_840000_index5_decoded.json');
  ok(t5.segwit && t5.txid === txids[5] && t5.inputs[0].txid === dec5.vin[0].txid && t5.inputs[0].vout === dec5.vin[0].vout && 3 * t5.strippedSize + fx('bitcoin/tx_840000_index5.hex').length / 2 === dec5.weight, 'KAT SegWit tx parse: txid, prevout, weight');
  ok(cb.coinbase && cb.txid === txids[0] && !B.spendsOutpoint(cb, { txid: '0'.repeat(64), vout: 0xffffffff }), 'KAT coinbase parse; a coinbase never spends an outpoint');
  const mp = fxJson('bitcoin/merkleproof_840000_index5.json');
  ok(B.verifyMerkleBranch(t5.txid, mp.merkle, mp.pos, c.at(840000).merkleRoot), 'KAT Merkle branch for tx index 5');
  ok(!B.verifyMerkleBranch(t5.txid, mp.merkle, 4, c.at(840000).merkleRoot), 'wrong Merkle position refused');
  ok(!B.verifyMerkleBranch(t5.txid, [...mp.merkle.slice(0, 3), txids[9], ...mp.merkle.slice(4)], mp.pos, c.at(840000).merkleRoot), 'wrong Merkle sibling refused');
  ok(!B.verifyMerkleBranch(txids[6], mp.merkle, mp.pos, c.at(840000).merkleRoot), 'Merkle proof for another txid refused');
  throws(() => B.verifyMerkleBranch(t5.txid, mp.merkle, 2 ** mp.merkle.length, c.at(840000).merkleRoot), 'Merkle position beyond branch length refused');

  const raw5 = fx('bitcoin/tx_840000_index5.hex');
  throws(() => B.parseTransaction(`${raw5}00`), 'trailing bytes refused');
  throws(() => B.parseTransaction(raw5.slice(0, -2)), 'truncated transaction refused');
  throws(() => B.parseTransaction(`${raw5.slice(0, 8)}0002${raw5.slice(12)}`), 'SegWit flag other than 1 refused');
  throws(() => B.parseTransaction(`${raw5.slice(0, 12)}fd0100${raw5.slice(14)}`), 'non-canonical CompactSize refused');
  throws(() => B.parseTransaction('ABCD'), 'uppercase / non-canonical hex refused');
  const tiny = S.buildTx({ inputs: [{ txid: S.syntheticTxid('t64'), vout: 0 }], outputs: [{ value: 1, script: Buffer.from([0x51, 0x51, 0x51, 0x51, 0x51]) }] });
  ok(tiny.length / 2 === 65, 'probe: minimal synthetic tx is 65 bytes');
  throws(() => B.parseTransaction(S.buildTx({ inputs: [{ txid: S.syntheticTxid('t64'), vout: 0 }], outputs: [{ value: 1, script: Buffer.from([0x51, 0x51, 0x51, 0x51]) }] })), '64-byte stripped transaction refused');
  const emptyWitness = S.buildTx({ inputs: [{ txid: S.syntheticTxid('w'), vout: 0 }], outputs: [{ value: 1, script: S.p2wpkh('w') }] });
  throws(() => B.parseTransaction(`${emptyWitness.slice(0, 8)}0001${emptyWitness.slice(8, -8)}00${emptyWitness.slice(-8)}`), 'SegWit marker with all-empty witness refused');

  // OP_RETURN commitment format
  const dg = sha256('synthetic-digest');
  const s = B.encodeCommitmentScript('development', dg);
  ok(s.length === 41 && s.toString('hex') === `6a27435047553101 44${dg}`.replace(' ', ''), 'OP_RETURN = 6a 27 "CPGU1" 01 44 digest (41 bytes)');
  ok(B.encodeCommitmentScript('held-out', dg)[8] === 0x48, 'held-out stage byte 0x48');
  const txWith = (scripts) => ({ outputs: scripts.map((sc) => ({ value: 0n, script: sc })) });
  const d0 = B.decodeCommitment(txWith([S.p2wpkh('x'), s]));
  ok(d0.stage === 'development' && d0.digest === dg, 'decode commitment: stage + digest');
  throws(() => B.decodeCommitment(txWith([S.p2wpkh('x')])), 'no OP_RETURN refused');
  throws(() => B.decodeCommitment(txWith([s, s])), 'two OP_RETURN outputs refused');
  throws(() => B.decodeCommitment(txWith([s, Buffer.from([0x6a])])), 'second bare OP_RETURN refused');
  throws(() => B.decodeCommitment(txWith([Buffer.concat([Buffer.from([0x6a, 0x26]), s.subarray(2, 40)])])), '38-byte OP_RETURN payload refused');
  throws(() => B.decodeCommitment(txWith([Buffer.concat([s, Buffer.from([0])])])), '42-byte OP_RETURN script refused');
  throws(() => B.decodeCommitment(txWith([Buffer.concat([s.subarray(0, 6), Buffer.from('2'), s.subarray(7)])])), 'wrong tag CPGU2 refused');
  throws(() => B.decodeCommitment(txWith([Buffer.concat([s.subarray(0, 7), Buffer.from([0x02]), s.subarray(8)])])), 'version byte 02 refused');
  throws(() => B.decodeCommitment(txWith([Buffer.concat([s.subarray(0, 8), Buffer.from([0x58]), s.subarray(9)])])), 'unknown stage byte refused');
  throws(() => B.decodeCommitment(txWith([Buffer.concat([Buffer.from([0x6a, 0x4c, 0x27]), s.subarray(2)])])), 'OP_PUSHDATA1 form refused (exact 6a 27 only)');
  throws(() => B.parseOutpoint(`${'A'.repeat(64)}:0`), 'uppercase outpoint refused');
  throws(() => B.parseOutpoint(`${'a'.repeat(64)}:01`), 'outpoint vout with leading zero refused');
  throws(() => B.networkParams('synthetic-test'), 'synthetic network refused outside test mode');
  ok(B.networkParams('synthetic-test', { allowSynthetic: true }) === B.SYNTHETIC && B.networkParams('bitcoin-mainnet') === B.MAINNET, 'network parameters pinned');
}

// ── 8. drand quicknet — archived rounds, BLS known answers and negative vectors ───────────────────
const DRAND_INFO = fxJson('drand/quicknet_chain_info.json');
const ROUND = Object.fromEntries([1, 1000000, 12345678].map((r) => [r, fxJson(`drand/quicknet_round_${r}.json`)]));
{
  ok(DR.QUICKNET.hash === DRAND_INFO.hash && DR.DST === 'BLS_SIG_BLS12381G1_XMD:SHA-256_SSWU_RO_NUL_', 'pinned chain = archived chain info; RFC 9380 DST');
  for (const r of [1, 1000000, 12345678]) ok(DR.verifyBeacon(DRAND_INFO, ROUND[r], r) === ROUND[r].randomness, `KAT drand round ${r} verifies; randomness = sha256(signature)`);
  const sig = ROUND[1000000].signature;
  ok(!DR.verifyDrandRound(DRAND_INFO, 1000001, sig).valid, 'signature for the wrong round refused');
  ok(!DR.verifyDrandRound(DRAND_INFO, 1000000, ROUND[12345678].signature).valid, 'valid G1 point from another round refused (pairing fails)');
  const flipBit = (h, i) => h.slice(0, i) + ((parseInt(h[i], 16) ^ 1).toString(16)) + h.slice(i + 1);
  ok(!DR.verifyDrandRound(DRAND_INFO, 1000000, flipBit(sig, 95)).valid && !DR.verifyDrandRound(DRAND_INFO, 1000000, flipBit(sig, 40)).valid, 'flipped signature bits refused');
  ok(!DR.verifyDrandRound(DRAND_INFO, 1000000, `c0${'0'.repeat(94)}`).valid, 'identity point refused');
  ok(!DR.verifyDrandRound(DRAND_INFO, 1000000, sig.toUpperCase()).valid && !DR.verifyDrandRound(DRAND_INFO, 1000000, sig.slice(2)).valid, 'non-canonical / short signature encoding refused');
  throws(() => DR.verifyDrandRound({ ...DRAND_INFO, hash: '0'.repeat(64) }, 1000000, sig), 'wrong chain hash refused');
  throws(() => DR.verifyDrandRound({ ...DRAND_INFO, public_key: DRAND_INFO.public_key.replace(/.$/, '0') }, 1000000, sig), 'wrong group key refused');
  throws(() => DR.verifyDrandRound({ ...DRAND_INFO, schemeID: 'pedersen-bls-chained' }, 1000000, sig), 'wrong scheme refused');
  throws(() => DR.verifyBeacon(DRAND_INFO, ROUND[12345678], 1000000), 'beacon for a round other than the computed one refused');
  throws(() => DR.verifyBeacon(DRAND_INFO, { ...ROUND[1000000], randomness: ROUND[1].randomness }, 1000000), 'relay randomness != sha256(signature) refused');
  ok(DR.roundTime(1) === DR.QUICKNET.genesis_time && DR.roundTime(1000000) === 1695803364, 'round schedule');
  ok(DR.selectRound(1695792564) === 1000000 && DR.selectRound(1695792565) === 1000001 && DR.selectRound(1729829598) === 12345678, 'round rule R = first round ≥ MTP + 3 h (fixture anchors)');
  let sepWrong = 0;
  for (let i = 0; i < 2000; i++) {
    const mtp = 1692803367 + ((i * 7919) % 99991) * 13;
    const R = DR.selectRound(mtp);
    if (!(DR.roundTime(R) >= mtp + 10800 && (R === 1 || DR.roundTime(R - 1) < mtp + 10800))) sepWrong++;
  }
  ok(sepWrong === 0 && DR.DELTA_SECONDS === 10800, '2000 MTPs: selected round is the FIRST scheduled ≥ MTP + 3 h (never earlier)');
  ok(DR.selectRound(DR.QUICKNET.genesis_time - 10800) === 1 && DR.MISSING_ROUND_EXPIRY_SECONDS === 30 * 86400, 'pre-genesis maps to round 1; 30-day expiry');
  const pkg = (n) => JSON.parse(readFileSync(join(HERE, '..', 'node_modules', '@noble', n, 'package.json'), 'utf8'));
  ok(pkg('curves').version === '1.9.7' && pkg('hashes').version === '1.8.0', 'vendored BLS dependency pinned: @noble/curves 1.9.7, @noble/hashes 1.8.0');
}

// ── 9. commitment payload, digest, append-only proof ──────────────────────────────────────────────
const H = (s) => sha256(`synthetic|${s}`);
{
  const p = { schema: 'cpg-u1-commitment/v1', study_id: 'CPG-U1-2026-01', stage: 'development', registration_id: 'SYNTHETIC-REG', protocol_sha256: H('p'),
    tooling_aggregate_sha256: H('t'), registry_sha256: H('r'), frame_hash: H('f'), scan_sha256: H('s'), outpoint: `${H('o')}:0`, binding: null };
  ok(CM.checkPayload(p).length === 0, 'valid development payload');
  ok(CM.payloadDigest(p) === sha256(`cpg-u1-commitment-digest/v1|${canonicalJson(p)}`) && CM.payloadDigest(p) !== sha256(canonicalJson(p)), 'digest is domain-separated');
  ok(CM.payloadDigest({ ...p }) === CM.payloadDigest(Object.fromEntries(Object.entries(p).reverse())), 'digest independent of key order');
  ok(CM.payloadDigest({ ...p, frame_hash: H('f2') }) !== CM.payloadDigest(p), 'digest binds frame_hash');
  ok(CM.checkPayload({ ...p, extra: 1 }).length > 0 && CM.checkPayload({ ...p, binding: undefined }).length > 0, 'extra / missing key refused');
  ok(CM.checkPayload({ ...p, stage: 'pilot' }).length > 0 && CM.checkPayload({ ...p, study_id: 'X' }).length > 0 && CM.checkPayload({ ...p, schema: 'v2' }).length > 0, 'stage / study / schema pinned');
  ok(CM.checkPayload({ ...p, registration_id: 'UNASSIGNED' }).length > 0 && CM.checkPayload({ ...p, registration_id: 'a|b' }).length > 0, 'registration_id must be real and "|"-free');
  ok(CM.checkPayload({ ...p, frame_hash: 'F'.repeat(64) }).length > 0 && CM.checkPayload({ ...p, outpoint: 'x:0' }).length > 0, 'hash / outpoint formats');
  ok(CM.checkPayload({ ...p, binding: {} }).length > 0, 'development binding must be null');
  const dev = { 'SYN-1': H('r1'), 'SYN-2': H('r2') };
  const aop = CM.appendOnlyProof(dev, H('F1'), { ...dev, 'SYN-3': H('r3') }, H('F2'));
  const hp = { ...p, stage: 'held-out', frame_hash: H('F2'), binding: { development_commitment_txid: H('dt'), development_payload_digest: H('dd'),
    development_manifest_sha256: H('dm'), development_frame_hash: H('F1'), pilot_result_sha256: H('pi'), sizing_sha256: H('si'), append_only_proof: aop } };
  ok(CM.checkPayload(hp).length === 0, 'valid held-out payload with binding');
  ok(CM.checkPayload({ ...hp, binding: null }).length > 0, 'held-out without binding refused');
  ok(CM.checkPayload({ ...hp, binding: { ...hp.binding, sizing_sha256: undefined } }).length > 0, 'held-out binding missing a field refused');
  ok(CM.checkPayload({ ...hp, frame_hash: H('other') }).length > 0, 'append-only proof must name the committed held-out frame');
  ok(CM.checkPayload({ ...hp, binding: { ...hp.binding, append_only_proof: { ...aop, proof: H('forged') } } }).length > 0, 'forged append-only proof hash refused');
  const aoErr = (fn) => { try { fn(); return ''; } catch (e) { return e.message; } };
  ok(aoErr(() => CM.appendOnlyProof(dev, H('F1'), { 'SYN-1': H('r1') }, H('F2'))).includes('drops development-frame row SYN-2'), 'append-only: dropped development row refused as a DROP');
  ok(aoErr(() => CM.appendOnlyProof(dev, H('F1'), { 'SYN-1': H('r1'), 'SYN-2': H('edited') }, H('F2'))).includes('edits development-frame row SYN-2'), 'append-only: edited development row refused as an EDIT');
}

// ── 10. registration record, identity placeholders, authority ───────────────────────────────────────
const isoOf = (sec) => new Date(sec * 1000).toISOString().replace('.000Z', 'Z');
function filledRegistration(t, o = {}) {
  return {
    ...t, registration_id: 'SYNTHETIC-REG-10.00000/SYNTHETIC', registration_timestamp: o.ts ?? '2023-08-23T08:40:00Z',
    accountable_identity: { ...t.accountable_identity, value: 'SYNTHETIC-ACCOUNTABLE-IDENTITY' },
    persistent_identifier: { type: 'SYNTHETIC-ORCID', value: 'SYNTHETIC-0000-0000-0000-0000' },
    bitcoin_key_custodian: { ...t.bitcoin_key_custodian, value: 'SYNTHETIC-STUDY-OPERATOR' },
    network: 'synthetic-test', outpoints: o.outpoints, checkpoint: o.checkpoint, as_of: '2026-09-01T00:00:00Z', provider_configuration_sha256: PROVIDER_SHA, ...o.extra,
  };
}
{
  const t = RG.registrationTemplate({ protocolSha: H('p'), toolingAggregate: H('t'), registrySha: H('r') });
  const f = RG.checkRegistration(t, { phase: 'funding' });
  ok(f.errors.length === 0 && f.blockers.length === 1 && f.blockers[0].includes('Bitcoin wallet-key custodian'), 'template: funding BLOCKED only by the key custodian');
  const r0 = RG.checkRegistration(t, { phase: 'registered' });
  ok(['Accountable OSF identity', 'Persistent identifier', 'Bitcoin wallet-key custodian', 'registration_id', 'registration_timestamp', 'outpoints', 'checkpoint', 'as_of', 'provider_configuration_sha256']
    .every((k) => r0.blockers.some((b) => b.includes(k))) && r0.errors.length === 0, 'template: registration BLOCKED by every named prerequisite, invents none');
  ok(t.bitcoin_key_custodian.role === 'STUDY_OPERATOR' && t.accountable_identity.value === 'UNASSIGNED' && t.persistent_identifier.value === 'UNASSIGNED' && t.registry.embargo === false && t.registry.public === true, 'template placeholders: UNASSIGNED identities, operator custody, public, no embargo');
  const good = filledRegistration(t, { outpoints: { development: `${H('a')}:0`, 'held-out': `${H('b')}:1` }, checkpoint: { height: 4042, hash: H('cp') } });
  const chk = (reg, phase = 'registered', allowSynthetic = true) => RG.checkRegistration(reg, { phase, allowSynthetic });
  ok(chk(good).errors.length === 0 && chk(good).blockers.length === 0, 'complete synthetic registration accepted in test mode');
  ok(chk(good, 'registered', false).errors.some((e) => e.includes('SYNTHETIC')), 'SYNTHETIC identities refused outside test mode');
  ok(chk({ ...good, bitcoin_key_custodian: { ...good.bitcoin_key_custodian, role: 'INDEPENDENT_CUSTODIAN' } }, 'funding').errors.some((e) => e.includes('STUDY_OPERATOR')), 'key custodian role other than STUDY_OPERATOR refused');
  ok(chk({ ...good, accountable_identity: { ...good.accountable_identity, value: '' } }).blockers.some((b) => b.includes('Accountable OSF identity')), 'blank identity is a blocker, not a value');
  ok(chk({ ...good, registry: { ...good.registry, embargo: true } }).errors.length > 0 && chk({ ...good, registry: { ...good.registry, public: false } }).errors.length > 0, 'embargoed / private registration refused');
  ok(chk({ ...good, registry: { ...good.registry, name: 'AsPredicted' } }).errors.length > 0, 'registry other than OSF Registries refused');
  ok(chk({ ...good, parameters: { ...good.parameters, confirmations_D: 3 } }).errors.length > 0 && chk({ ...good, parameters: { ...good.parameters, randomness_offset_K: 1 } }).errors.length > 0, 'D / K pinned');
  ok(chk({ ...good, parameters: { ...good.parameters, drand_delta_seconds: 3600 } }).errors.length > 0 && chk({ ...good, parameters: { ...good.parameters, randomness_model: 'A' } }).errors.length > 0, 'Δ / Model B pinned');
  ok(chk({ ...good, parameters: { ...good.parameters, extra: 1 } }).errors.length > 0, 'unpinned extra parameter refused');
  ok(chk({ ...good, outpoints: { development: good.outpoints.development, 'held-out': good.outpoints.development } }).errors.some((e) => e.includes('distinct')), 'identical outpoints refused');
  ok(chk({ ...good, registration_timestamp: '2023-08-23 08:40' }).errors.length > 0, 'non-ISO registration timestamp refused');
  ok(chk({ ...good, as_of: '2026-09-01' }).errors.some((e) => e.includes('as_of')) && chk({ ...good, provider_configuration_sha256: 'abc' }).errors.some((e) => e.includes('provider_configuration_sha256')), 'CPG-044: malformed asOf / provider configuration hash refused');
  ok(chk({ ...good, network: 'bitcoin-testnet' }).errors.length > 0 && chk(good, 'registered', false).errors.some((e) => e.includes('network')), 'network pinned to mainnet outside test mode');

  const other = { ...good, registration_id: 'SYNTHETIC-REG-2', registration_timestamp: '2023-08-24T00:00:00Z' };
  ok(RG.checkAuthority(good, [good]) === null, 'authority: single registration authoritative');
  ok(RG.checkAuthority(good, [good, { ...other }]) === null, 'authority: identical-sampling duplicate ignored');
  ok(RG.checkAuthority(good, [good, { ...other, outpoints: { ...good.outpoints, 'held-out': `${H('c')}:0` } }]).includes('duplicate'), 'authority: later duplicate with different outpoints → VOID');
  ok(RG.checkAuthority(good, [good, { ...other, registration_timestamp: '2023-08-01T00:00:00Z' }]).includes('earlier registration'), 'authority: an earlier registration makes this record non-authoritative');
  ok(RG.checkAuthority(good, [{ ...good, withdrawn: true }]).includes('withdrawn'), 'authority: withdrawal → VOID');
  ok(RG.checkAuthority(good, [{ ...good, checkpoint: { height: 1, hash: H('x') } }]).includes('differs'), 'authority: registry copy differing from the supplied record refused');
  throws(() => RG.checkAuthority(good, [other]), 'authority: registration absent from the identity list refused');
  throws(() => RG.checkAuthority(good, [good, { ...other, accountable_identity: { value: 'SYNTHETIC-SOMEONE-ELSE' } }]), 'authority: list mixing identities refused');
}

// ── 11. sampling state machine on a SYNTHETIC chain ────────────────────────────────────────────────
const S0 = 4032;
const T_DEV = DR.QUICKNET.genesis_time - 10800; // MTP(S0+38) → drand round 1
const T_HO = 1695792564; // MTP(S0+78) → drand round 1000000
const timeAt = (h) => (h < S0 + 50 ? T_DEV + (h - (S0 + 33)) * 600 : T_HO + (h - (S0 + 73)) * 600);
const TEMPLATE = RG.registrationTemplate({ protocolSha: H('protocol'), toolingAggregate: H('tooling'), registrySha: H('registry') });
function study(opt = {}) {
  const c = new S.SynthChain(S0);
  const txidOf = (hex) => B.parseTransaction(hex).txid;
  const fund = (s) => S.buildTx({ inputs: [{ txid: S.syntheticTxid(`fund-in-${s}`), vout: 0 }], outputs: [{ value: 20000, script: (opt.slotScript ?? S.p2wpkh)(`slot-${s}`) }, { value: 5000, script: S.p2wpkh(`change-${s}`) }] });
  const fundDev = fund('dev'); const fundHo = fund('ho');
  const O = { development: `${txidOf(fundDev)}:0`, 'held-out': `${txidOf(fundHo)}:0` };
  const reg = filledRegistration(TEMPLATE, { outpoints: O, checkpoint: null, ts: opt.regTs ?? isoOf(timeAt(S0 + 10) + 300) });
  const base = { schema: 'cpg-u1-commitment/v1', study_id: 'CPG-U1-2026-01', registration_id: reg.registration_id, protocol_sha256: reg.protocol_sha256, tooling_aggregate_sha256: reg.tooling_aggregate_sha256, registry_sha256: reg.registry_sha256 };
  const payDev = { ...base, stage: 'development', frame_hash: H('F1'), scan_sha256: H('S1'), outpoint: O.development, binding: null, ...opt.devPayload };
  const devDigest = CM.payloadDigest(payDev);
  const devTx = S.buildTx({ label: 'dev', witness: true, inputs: opt.devInputs ?? [{ txid: O.development.slice(0, 64), vout: 0 }],
    outputs: opt.devOutputs ?? [{ value: 0, script: B.encodeCommitmentScript(opt.devStage ?? 'development', opt.devDigest ?? devDigest) }, { value: 15000, script: S.p2wpkh('dev-commit-change') }] });
  const hoFrame = opt.hoPayload?.frame_hash ?? H('F1');
  const aop = CM.appendOnlyProof({ 'SYN-1': H('r1') }, H('F1'), hoFrame === H('F1') ? { 'SYN-1': H('r1') } : { 'SYN-1': H('r1'), 'SYN-2': H('r2') }, hoFrame);
  const payHo = { ...base, stage: 'held-out', frame_hash: H('F1'), scan_sha256: H('S1'), outpoint: O['held-out'], ...opt.hoPayload,
    binding: { development_commitment_txid: txidOf(devTx), development_payload_digest: devDigest, development_manifest_sha256: H('DM'), development_frame_hash: H('F1'),
      pilot_result_sha256: H('PI'), sizing_sha256: H('SZ'), append_only_proof: aop, ...opt.hoBinding } };
  const hoTx = S.buildTx({ label: 'ho', witness: true, inputs: [{ txid: O['held-out'].slice(0, 64), vout: 0 }],
    outputs: [{ value: 0, script: B.encodeCommitmentScript('held-out', CM.payloadDigest(payHo)) }, { value: 15000, script: S.p2wpkh('ho-commit-change') }] });
  const devAt = S0 + (opt.devAt ?? 20); const hoAt = S0 + (opt.hoAt ?? 60);
  const filler = (k) => S.buildTx({ inputs: [{ txid: S.syntheticTxid(`filler-${k}`), vout: 1 }], outputs: [{ value: 777, script: S.p2wpkh(`filler-${k}`) }] });
  for (let h = S0; h <= S0 + (opt.tip ?? 80); h++) {
    const txs = [];
    if (h === S0 + 2) txs.push(fundDev);
    if (h === S0 + 3) txs.push(fundHo);
    if (h === devAt) txs.push(filler(`d${h}`), devTx, filler(`e${h}`));
    if (h === hoAt && !opt.noHoTx) txs.push(hoTx, filler(`h${h}`));
    c.add((opt.timeAt ?? timeAt)(h), txs, opt.forkFrom !== undefined && h >= S0 + opt.forkFrom ? 'FORK' : '');
  }
  for (const t of opt.tail ?? []) c.add(t);
  const cp = S0 + (opt.checkpoint ?? 10);
  reg.checkpoint = { height: cp, hash: c.block(cp).hash };
  const ev = {
    schema: 'cpg-u1-sampling-evidence/v1', network: 'synthetic-test',
    headers: c.archive('synthetic-source-A'), headers_crosscheck: c.archive('synthetic-source-B'),
    funding: { development: c.proof(fundDev), 'held-out': c.proof(fundHo) },
    commitments: { development: { payload: payDev, ...c.proof(devTx) }, 'held-out': opt.noHoTx ? null : { payload: payHo, ...c.proof(hoTx) } },
    drand: { chain_info: DRAND_INFO, beacons: [ROUND[1], ROUND[1000000]] },
  };
  return { c, reg, ev, O, devTx, hoTx, payDev, payHo, devDigest };
}
const clone = (x) => JSON.parse(JSON.stringify(x));
const evalS = (st, stage, mutate = (x) => x, opts = {}) => SA.evaluateStage(st.reg, mutate(clone(st.ev)), stage, { allowSynthetic: true, ...opts });
const evErr = (fn, name) => { try { fn(); failures.push(`${name} (no error)`); } catch (e) { if (e instanceof SA.EvidenceError) pass++; else failures.push(`${name} (wrong error: ${e.message})`); } };
{
  const st = study();
  const dev = evalS(st, 'development');
  const ho = evalS(st, 'held-out');
  ok(dev.state === 'FINAL' && dev.record.drand_round === 1 && dev.record.randomness_height === S0 + 32 && dev.record.commitment_height === S0 + 20, 'development FINAL: H_rand = H_commit + 12, R = 1');
  ok(ho.state === 'FINAL' && ho.record.drand_round === 1000000 && ho.record.randomness_height === S0 + 72, 'held-out FINAL: R = 1000000');
  ok(dev.seed === SA.deriveSeed({ stage: 'development', digest: st.devDigest, txid: B.parseTransaction(st.devTx).txid, commitHeight: S0 + 20, randHeight: S0 + 32,
    randBlockHash: st.c.block(S0 + 32).hash, drandChainHash: DR.QUICKNET.hash, round: 1, drandRandomness: ROUND[1].randomness }), 'seed recomputes from public inputs only');
  ok(dev.seed === sha256(['cpg-u1-chain-drand-seed/v1', 'development', st.devDigest, dev.record.commitment_txid, String(S0 + 20), String(S0 + 32), dev.record.randomness_block_hash, DR.QUICKNET.hash, '1', ROUND[1].randomness].join('|')), 'seed string exactly as protocol §5.7');
  ok(dev.record.seed_fingerprint === SA.seedFingerprint(dev.seed) && !JSON.stringify(dev.record).includes(dev.seed), 'record carries a fingerprint, never the seed');
  ok(dev.seed !== ho.seed && /^[0-9a-f]{64}$/.test(ho.seed), 'stage seeds differ');
  ok(canonicalJson(ho.developmentRecord) === canonicalJson(dev.record), 'held-out evaluation re-verifies the identical development event');
  throws(() => SA.deriveSeed({ stage: 'development', digest: st.devDigest, txid: dev.record.commitment_txid, commitHeight: S0 + 20, randHeight: S0 + 31, randBlockHash: st.c.block(S0 + 31).hash, drandChainHash: DR.QUICKNET.hash, round: 1, drandRandomness: ROUND[1].randomness }), 'wrong randomness offset (H_rand ≠ H_commit + K) refused');
  ok(SA.deriveSeed({ ...{ stage: 'development', digest: st.devDigest, txid: dev.record.commitment_txid, commitHeight: S0 + 20, randHeight: S0 + 32, drandChainHash: DR.QUICKNET.hash, round: 1, drandRandomness: ROUND[1].randomness }, randBlockHash: st.c.block(S0 + 33).hash }) !== dev.seed, 'different randomness block hash → different seed');
  ok(SA.deriveSeed({ stage: 'held-out', digest: st.devDigest, txid: dev.record.commitment_txid, commitHeight: S0 + 20, randHeight: S0 + 32, randBlockHash: dev.record.randomness_block_hash, drandChainHash: DR.QUICKNET.hash, round: 1, drandRandomness: ROUND[1].randomness }) !== dev.seed, 'stage label separates seeds');
  ok(SA.D === 6 && SA.K === 12 && SA.ABANDONMENT_SECONDS === 180 * 86400, 'D = 6, K = 12, 180 days');

  // waiting states (truncated agreed tip)
  const trunc = (tip) => (x) => { x.headers = st.c.archive('synthetic-source-A', tip); x.headers_crosscheck = st.c.archive('synthetic-source-B', tip); return x; };
  ok(evalS(st, 'development', trunc(S0 + 24)).state === 'WAITING_COMMITMENT_DEPTH', 'commitment with 5 confirmations: WAITING_COMMITMENT_DEPTH');
  ok(evalS(st, 'development', trunc(S0 + 25)).state === 'WAITING_RANDOMNESS_DEPTH', 'commitment with exactly 6 confirmations proceeds to randomness depth');
  ok(evalS(st, 'development', trunc(S0 + 37)).state === 'WAITING_RANDOMNESS_DEPTH', 'H_rand + D not yet mined: WAITING_RANDOMNESS_DEPTH');
  ok(evalS(st, 'development', trunc(S0 + 38)).state === 'FINAL', 'H_rand + D mined: FINAL');
  ok(evalS(st, 'development', (x) => { x.headers_crosscheck = st.c.archive('synthetic-source-B', S0 + 30); return x; }).state === 'WAITING_RANDOMNESS_DEPTH', 'agreed tip = the shorter source');
  ok(evalS(st, 'held-out', (x) => { trunc(S0 + 40)(x); x.commitments['held-out'] = null; return x; }).state === 'NOT_STARTED', 'held-out not yet committed: NOT_STARTED');
  ok(evalS(st, 'development', (x) => { x.commitments.development = null; return x; }).state === 'NOT_STARTED', 'development outpoint unspent: NOT_STARTED');
  ok(evalS(st, 'held-out', (x) => { x.commitments.development = null; return x; }).state === 'WAITING_DEVELOPMENT_FINALITY', 'held-out waits for development finality');

  // drand availability
  ok(evalS(st, 'held-out', (x) => { x.drand.beacons = [ROUND[1]]; return x; }).state === 'WAITING_DRAND_ROUND', 'required round absent: WAITING_DRAND_ROUND');
  ok(evalS(st, 'held-out', (x) => { x.drand.beacons = [ROUND[1], ROUND[12345678]]; return x; }).state === 'WAITING_DRAND_ROUND', 'a different (caller-chosen) round is never used');
  evErr(() => evalS(st, 'held-out', (x) => { x.drand.beacons = [ROUND[1], { ...ROUND[1000000], signature: ROUND[12345678].signature }]; return x; }), 'wrong drand signature: abort');
  evErr(() => evalS(st, 'held-out', (x) => { x.drand.chain_info = { ...DRAND_INFO, period: 30 }; return x; }), 'wrong drand chain info: abort');
  const late = study({ tail: Array.from({ length: 11 }, (_, i) => DR.roundTime(1000000) + 30 * 86400 + i * 600) });
  ok(evalS(late, 'held-out', (x) => { x.drand.beacons = [ROUND[1]]; return x; }).state === 'STUDY_VOID_RANDOMNESS_UNAVAILABLE', 'round absent 30 days after its scheduled time: VOID');
  ok(evalS(late, 'held-out').state === 'FINAL', 'same chain with the round present: FINAL');
  const early = study({ tail: Array.from({ length: 11 }, (_, i) => DR.roundTime(1000000) + 30 * 86400 - 6000 + i * 100) });
  ok(evalS(early, 'held-out', (x) => { x.drand.beacons = [ROUND[1]]; return x; }).state === 'WAITING_DRAND_ROUND', 'round absent just under 30 days: still WAITING');

  // commitment validity
  ok(evalS(study({ devStage: 'held-out' }), 'development').state === 'STAGE_VOID_MALFORMED_COMMITMENT', 'wrong stage byte for the spent outpoint: VOID');
  ok(evalS(study({ devOutputs: [{ value: 15000, script: S.p2wpkh('no-op-return') }] }), 'development', (x) => x).state === 'STAGE_VOID_MALFORMED_COMMITMENT', 'spend without OP_RETURN: VOID (slot consumed)');
  const twoOr = study({ devOutputs: [{ value: 0, script: B.encodeCommitmentScript('development', H('x')) }, { value: 0, script: B.encodeCommitmentScript('development', H('y')) }] });
  ok(evalS(twoOr, 'development').state === 'STAGE_VOID_MALFORMED_COMMITMENT', 'two OP_RETURN outputs: VOID');
  evErr(() => evalS(st, 'development', (x) => { x.commitments.development.payload.frame_hash = H('substituted'); return x; }), 'payload not matching on-chain digest: abort');
  evErr(() => evalS(study({ devDigest: H('other-digest') }), 'development'), 'on-chain digest of a different payload: abort');
  ok(evalS(study({ devPayload: { registration_id: 'SYNTHETIC-OTHER-REG' } }), 'development').state === 'STAGE_VOID_MALFORMED_COMMITMENT', 'committed payload naming another registration: VOID');
  ok(evalS(study({ devPayload: { protocol_sha256: H('other-protocol') } }), 'development').state === 'STAGE_VOID_MALFORMED_COMMITMENT', 'committed payload naming another protocol: VOID');
  ok(evalS(study({ devPayload: { registry_sha256: H('other-registry') } }), 'development').state === 'STAGE_VOID_MALFORMED_COMMITMENT', 'development payload naming another registry: VOID');
  ok(evalS(study({ devPayload: { outpoint: `${H('elsewhere')}:0` } }), 'development').state === 'STAGE_VOID_MALFORMED_COMMITMENT', 'payload naming another outpoint: VOID');
  ok(evalS(study({ devPayload: { stage: 'held-out' } }), 'development').state === 'STAGE_VOID_MALFORMED_COMMITMENT', 'payload naming another stage: VOID');
  evErr(() => evalS(st, 'development', (x) => { x.commitments.development = { ...x.commitments['held-out'] }; return x; }), 'transaction not spending the stage outpoint: abort (not a commitment)');

  // single-use slots and ordering
  const both = study({ devInputs: [{ txid: st.O.development.slice(0, 64), vout: 0 }, { txid: st.O['held-out'].slice(0, 64), vout: 0 }], noHoTx: true });
  ok(evalS(both, 'development').state === 'STUDY_VOID_SLOT_CROSS_SPEND' && evalS(both, 'held-out').state === 'STUDY_VOID_SLOT_CROSS_SPEND', 'one transaction spending both slots: study VOID');
  evErr(() => evalS(st, 'held-out', (x) => { x.commitments['held-out'] = { ...x.commitments.development }; return x; }), 'development transaction claimed as the held-out commitment: abort');
  ok(evalS(study({ checkpoint: 25 }), 'development').state === 'STUDY_VOID_PRE_REGISTRATION_SPEND', 'outpoint spent at or before the checkpoint: VOID');
  ok(evalS(study({ checkpoint: 7 }), 'development').state === 'STUDY_VOID_REGISTRATION', 'funding with fewer than D confirmations at the checkpoint: VOID');
  ok(evalS(study({ checkpoint: 8 }), 'development').state === 'FINAL', 'funding with exactly D confirmations at the checkpoint accepted');
  ok(evalS(study({ slotScript: (l) => Buffer.concat([Buffer.from([0x00, 0x20]), Buffer.alloc(32, 7)]) }), 'development').state === 'STUDY_VOID_REGISTRATION', 'registered outpoint not single-key P2WPKH: VOID');
  ok(evalS(study({ hoAt: 36 }), 'held-out').state === 'STAGE_VOID_BINDING_MISMATCH', 'held-out committed before development finality: VOID');
  ok(evalS(study({ hoAt: 38 }), 'held-out').state === 'STAGE_VOID_BINDING_MISMATCH', 'held-out committed in the development finality block: VOID');
  ok(evalS(study({ hoBinding: { development_commitment_txid: H('forged-dev-txid') } }), 'held-out').state === 'STAGE_VOID_BINDING_MISMATCH', 'held-out binding to another development commitment: VOID');
  ok(evalS(study({ hoBinding: { development_payload_digest: H('forged-dev-digest') } }), 'held-out').state === 'STAGE_VOID_BINDING_MISMATCH', 'held-out binding to another development digest: VOID');
  ok(evalS(study({ hoPayload: { frame_hash: H('F2') } }), 'held-out').state === 'STAGE_VOID_BINDING_MISMATCH', 'T-2 (chain): held-out committed a different frame than development → VOID');
  ok(evalS(study({ hoPayload: { scan_sha256: H('S2') } }), 'held-out').state === 'STAGE_VOID_BINDING_MISMATCH', 'scan (chain): held-out committed a different scan than development → VOID');
  ok(evalS(study({ hoPayload: { registry_sha256: H('grown registry') } }), 'held-out').state === 'STAGE_VOID_BINDING_MISMATCH', 'T-1 (chain): held-out committed a registry other than the registered one → VOID');

  // abandonment
  const regLate = (sec) => (s) => { s.reg = { ...s.reg, registration_timestamp: isoOf(sec) }; return s; };
  const abandonedDev = regLate(timeAt(S0 + 80) - 181 * 86400)(study());
  ok(evalS(abandonedDev, 'development', (x) => { x.commitments.development = null; return x; }).state === 'STUDY_ABANDONED', 'development unspent 180 days after registration: ABANDONED');
  ok(evalS(regLate(timeAt(S0 + 15) - 180 * 86400)(study()), 'development').state === 'STUDY_ABANDONED', 'development commitment confirmed after the 180-day window: ABANDONED');
  ok(evalS(regLate(timeAt(S0 + 15) - 180 * 86400 + 1)(study()), 'development').state === 'FINAL', 'commitment 1 s inside the window accepted');
  const hoIdle = study({ noHoTx: true, tail: Array.from({ length: 11 }, (_, i) => DR.roundTime(1) + 180 * 86400 + i * 600) });
  ok(evalS(hoIdle, 'held-out').state === 'STUDY_ABANDONED', 'held-out unspent 180 days after the development draw: ABANDONED');
  ok(evalS(study({ noHoTx: true }), 'held-out').state === 'NOT_STARTED', 'held-out unspent inside the window: NOT_STARTED');
  ok(evalS(regLate(DR.roundTime(1))(study()), 'development').state === 'STUDY_VOID_REGISTRATION' && evalS(regLate(DR.roundTime(1))(study()), 'held-out').state === 'STUDY_VOID_REGISTRATION', 'registration timestamped at/after the development drand round (grind-then-register): study VOID');
  ok(evalS(regLate(DR.roundTime(1) - 1)(study()), 'development').state === 'FINAL', 'registration 1 s before the development round: not voided by this rule');
  const regSec = Date.parse(study().reg.registration_timestamp) / 1000;
  const hoGap = study({ noHoTx: true, tail: Array.from({ length: 11 }, (_, i) => regSec + 180 * 86400 + i * 600) });
  ok(regSec + 180 * 86400 + 6000 < DR.roundTime(1) + 180 * 86400 && evalS(hoGap, 'held-out').state === 'NOT_STARTED', 'held-out window runs from the development draw (not from registration)');

  // reorganisation and header sources
  const fork = study({ forkFrom: 30 });
  ok(evalS(fork, 'development').state === 'FINAL' && evalS(fork, 'development').record.randomness_block_hash !== dev.record.randomness_block_hash, 'fork after the commitment changes the randomness block');
  ok(SA.evaluateStage(fork.reg, clone(fork.ev), 'development', { allowSynthetic: true, priorFinal: { development: dev.record } }).state === 'STUDY_VOID_POST_FINALITY_REORG', 'previously FINAL event replaced by a reorganisation: VOID');
  ok(SA.evaluateStage(st.reg, clone(st.ev), 'development', { allowSynthetic: true, priorFinal: { development: dev.record } }).state === 'FINAL', 'unchanged chain with a prior FINAL record stays FINAL');
  evErr(() => evalS(st, 'development', (x) => { x.headers_crosscheck = { ...fork.c.archive('synthetic-source-B') }; return x; }), 'header sources disagree (fork): abort');
  evErr(() => evalS(st, 'development', (x) => { x.headers_crosscheck.source = x.headers.source; return x; }), 'same source named twice: abort');
  evErr(() => evalS(st, 'development', (x) => { x.headers.headers_hex[40] = x.headers.headers_hex[40].slice(0, 100) + (x.headers.headers_hex[40][100] === 'a' ? 'b' : 'a') + x.headers.headers_hex[40].slice(101); return x; }), 'tampered archived header: abort');
  evErr(() => evalS(st, 'development', (x) => { x.headers.start_height = S0 + 1; x.headers.headers_hex = x.headers.headers_hex.slice(1); return x; }), 'archive not starting at a retarget boundary: abort');
  evErr(() => SA.evaluateStage({ ...st.reg, checkpoint: { ...st.reg.checkpoint, hash: H('other-checkpoint') } }, clone(st.ev), 'development', { allowSynthetic: true }), 'checkpoint hash not in archive: abort');
  evErr(() => evalS(st, 'development', (x) => { x.commitments.development.merkle_branch[0] = H('wrong-sibling'); return x; }), 'wrong Merkle branch: abort');
  evErr(() => evalS(st, 'development', (x) => { x.commitments.development.height += 1; return x; }), 'wrong block height for the commitment: abort');
  evErr(() => evalS(st, 'development', (x) => { x.funding['held-out'] = x.funding.development; return x; }), 'funding transaction not matching the registered outpoint: abort');
  evErr(() => SA.evaluateStage(st.reg, clone(st.ev), 'development', { allowSynthetic: false }), 'synthetic network refused outside test mode');
  evErr(() => evalS(st, 'development', (x) => { x.network = 'bitcoin-mainnet'; return x; }), 'evidence network differing from registration: abort');
  const bitsChange = new S.SynthChain(S0);
  for (let h = S0; h < S0 + 3; h++) bitsChange.add(timeAt(h), [], '', h === S0 + 2 ? 0x2000ffff : S.SYNTHETIC_BITS);
  throws(() => verifyArchiveSynthetic(bitsChange), 'correctly mined header with changed nBits inside a period refused');
  const cleanChain = new S.SynthChain(S0);
  for (let h = S0; h < S0 + 12; h++) cleanChain.add(timeAt(h));
  ok(verifyArchiveSynthetic(cleanChain).tipHeight === S0 + 11, 'control: same construction with constant nBits and rising time verifies');
  const RT = { ...B.SYNTHETIC, name: 'synthetic-retarget', noRetargeting: false, retargetInterval: 16, targetTimespan: 16n * 600n };
  const rtChain = (wrongBits, from = 0) => {
    const ch = new S.SynthChain(0);
    let bits = S.SYNTHETIC_BITS;
    for (let h = 0; h < 20; h++) {
      if (h === 16) bits = wrongBits ? S.SYNTHETIC_BITS : B.expectedRetargetBits(B.parseHeader(ch.block(0).header), B.parseHeader(ch.block(15).header), RT);
      ch.add(1700000000 + h * 600, [], '', bits);
    }
    return B.verifyHeaderChain(from, ch.archive('x').headers_hex.slice(from), RT);
  };
  ok(rtChain(false).tipHeight === 19 && B.expectedRetargetBits({ time: 0 }, { time: 9000, bits: S.SYNTHETIC_BITS }, RT) !== S.SYNTHETIC_BITS, 'retarget boundary: recomputed nBits accepted');
  throws(() => rtChain(true), 'retarget boundary: unchanged nBits where a retarget is due refused');
  const cut = new S.SynthChain(0); for (let h = 0; h < 20; h++) cut.add(1700000000 + h * 600, [], '', h >= 16 ? B.expectedRetargetBits({ time: 1700000000 }, { time: 1700000000 + 15 * 600, bits: S.SYNTHETIC_BITS }, RT) : S.SYNTHETIC_BITS);
  throws(() => B.verifyHeaderChain(1, cut.archive('x').headers_hex.slice(1), RT), 'retarget boundary without its period start in the archive refused');
  const mtpChain = new S.SynthChain(S0);
  for (let h = S0; h < S0 + 12; h++) mtpChain.add(h === S0 + 11 ? timeAt(S0 + 5) : timeAt(h));
  throws(() => verifyArchiveSynthetic(mtpChain), 'header timestamp not above median-time-past refused');
}
function verifyArchiveSynthetic(chain) { return B.verifyHeaderChain(chain.startHeight, chain.archive('x').headers_hex, B.SYNTHETIC); }

// ── 12. tooling aggregate ───────────────────────────────────────────────────────────────────────────
{
  const m = toolingManifest(join(HERE, '..'));
  ok(/^[0-9a-f]{64}$/.test(m.aggregate) && m.files.some((f) => f.path === 'node_modules/@noble/curves/esm/bls12-381.js') && m.files.some((f) => f.path === 'lib/drand.mjs'), 'aggregate covers vendored BLS files and libs');
  ok(m.text.split('\n').filter(Boolean).every((l) => /^[0-9a-f]{64} {2}\S/.test(l)) && sha256(m.text) === m.aggregate, 'aggregate = sha256 of "<sha256>  <path>" lines (CPG-037A definition)');
  ok(!m.files.some((f) => f.path === 'lib/seed.mjs'), 'commit–reveal seed module removed');
}
// ── 13. reconcile (blind double entry) ───────────────────────────────────────
const blind = (id, field, by, o = {}) => ({
  candidate_id: id, field, value_kind: 'STATED', expected_value: field === 'revenue_range' ? 'USD 1999000' : '1999', authoritative_source_name: 'SYNTHETIC registry',
  source_class: field === 'founded_year' ? 'REGISTRY_RECORD' : field === 'employee_count' ? 'REGULATORY_FILING' : 'AUDITED_FINANCIAL_FILING',
  source_url: 'https://registry.example/e/1', publication_date: '2026-06-30', as_of_date: '2026-09-01', search_note: '',
  constructed_without_cpg: 'yes', recorded_by: by, recorded_at: '2026-09-10', ...o,
});
const FIELDS3 = ['founded_year', 'employee_count', 'revenue_range'];
const setFor = (ids, by, over = {}) => ids.flatMap((id) => FIELDS3.map((f) => blind(id, f, by, over[`${id}|${f}`] || {})));
{
  const drawn = [{ candidate_id: 'R1', stratum: 'fill-expected' }, { candidate_id: 'R2', stratum: 'abstention-expected' }];
  const NA = { value_kind: 'NOT_AVAILABLE_FROM_SOURCE', expected_value: '', search_note: 'SYNTHETIC searched' };
  const r2na = Object.fromEntries(FIELDS3.map((f) => [`R2|${f}`, NA]));
  const a = setFor(['R1', 'R2'], 'author-1', r2na);
  const c = setFor(['R1', 'R2'], 'confirmer-1', r2na);
  const g = reconcile(drawn, a, c);
  ok(g.errors.length === 0 && g.rows.length === 6 && g.rows.every((r) => r.resolution === 'AGREED'), 'identical blind records → AGREED');

  // §9.3 value formats
  const fmt = (field, v) => checkBlindRecord(blind('R1', field, 'x', { expected_value: v }));
  ok(fmt('founded_year', '1999').length === 0 && fmt('employee_count', '3682').length === 0 && fmt('revenue_range', 'USD 1300000000').length === 0, 'valid STATED formats accepted');
  for (const [f, v] of [['founded_year', '1999-01-01'], ['founded_year', 'circa 1999'], ['founded_year', ' 1999'], ['employee_count', '3,682'],
    ['employee_count', 'about 3000'], ['employee_count', '0'], ['revenue_range', '$1.3B'], ['revenue_range', 'usd 1000'], ['revenue_range', 'USD 1,000'], ['revenue_range', '1300000000']]) {
    ok(fmt(f, v).some((e) => e.includes('§9.3')), `invalid ${f} format "${v}" refused`);
  }
  ok(g.stratumMismatches.length === 0, 'no stratum mismatch');

  const cDis = setFor(['R1', 'R2'], 'confirmer-1', { ...r2na, 'R1|founded_year': { expected_value: '2001' } });
  ok(reconcile(drawn, a, cDis).errors.some((e) => e.includes('independent adjudication required')), 'disagreement without adjudication refused');
  const adj = (decision, by = 'adjudicator-1') => [{ candidate_id: 'R1', field: 'founded_year', decision, rationale: 'SYNTHETIC', adjudicated_by: by, adjudicated_at: '2026-09-12' }];
  const gA = reconcile(drawn, a, cDis, adj('CONFIRMER'));
  ok(gA.errors.length === 0 && gA.rows.find((r) => r.field === 'founded_year' && r.candidate_id === 'R1').expected_value === '2001', 'adjudicated CONFIRMER value used');
  const gC = reconcile(drawn, a, cDis, adj('REFERENCE-CONFLICT'));
  ok(gC.rows.find((r) => r.candidate_id === 'R1' && r.field === 'founded_year').ambiguity_flag === 'REFERENCE-CONFLICT', 'REFERENCE-CONFLICT flagged');
  ok(reconcile(drawn, a, cDis, adj('AUTHOR', 'author-1')).errors.some((e) => e.includes('adjudicator must differ')), 'adjudicator = author refused');
  ok(reconcile(drawn, a, c, adj('CONFIRMER')).errors.some((e) => e.includes('may not override agreement')), 'adjudication cannot override agreement');
  ok(reconcile(drawn, a, setFor(['R1', 'R2'], 'author-1', r2na)).errors.some((e) => e.includes('different people')), 'author = confirmer refused');
  ok(reconcile(drawn, a, c.slice(1)).errors.some((e) => e.includes('missing confirmer record')), 'missing confirmer record refused');
  ok(reconcile(drawn, a, setFor(['R1', 'R2'], 'confirmer-1', { ...r2na, 'R1|revenue_range': { value_kind: 'PROJECTION' } })).errors.some((e) => e.includes('never an expected value')), 'forbidden kind in blind record refused');
  ok(reconcile(drawn, setFor(['R1', 'R2', 'ZZ'], 'author-1', r2na), c).errors.some((e) => e.includes('not in a drawn manifest')), 'record for undrawn company refused');
  ok(checkBlindRecord(blind('R1', 'founded_year', 'x', { constructed_without_cpg: 'no' })).length > 0, 'CPG-assisted blind record refused');
  const mism = reconcile([{ candidate_id: 'R2', stratum: 'fill-expected' }], setFor(['R2'], 'author-1', r2na), setFor(['R2'], 'confirmer-1', r2na));
  ok(mism.errors.length === 0 && mism.stratumMismatches.length === 1, 'stratum mismatch RECORDED, not an error, not edited');
}

// ── 12a. Protocol-004: frame sufficiency proof (§5.7.2) ────────────────────────────────────────────
{
  const p = FR.enumeratePilotOutcomes();
  ok(p.outcomes === 4096 && p.halts === 1 && p.refused === 0, 'PROOF: all 4^6 = 4096 permitted pilot outcomes evaluated; only all-zero halts; none refused');
  ok(canonicalJson(FR.MAX_HELD_OUT_QUOTAS) === canonicalJson({ 'fill-expected': 60, 'abstention-expected': 25, 'identity-hazard': 15 }), 'PROOF: maximum held-out quotas over every pilot outcome = 60 / 25 / 15');
  ok(canonicalJson(FR.FRAME_MINIMUM) === canonicalJson({ 'fill-expected': 126, 'abstention-expected': 52, 'identity-hazard': 32 }), 'PROOF: frame minimum 2·Qmax + Dev = 126 / 52 / 32');
  // constructive worst case: an exactly-minimal frame, every development pick eligible, every distinct quota vector
  serial = 7000;
  const minimal = [...Array.from({ length: 126 }, () => row('fill-expected')), ...Array.from({ length: 52 }, () => row('abstention-expected')), ...Array.from({ length: 32 }, () => row('identity-hazard'))];
  ok(FR.frameSufficiency(minimal, new Set()).ok, 'exactly-minimal frame (126/52/32 eligible) is sufficient');
  const quotaVectors = new Map();
  const ids6 = new Set(['D1', 'D2', 'D3', 'D4', 'D5', 'D6']);
  for (let n = 0; n < 4096; n++) {
    const r = heldOutQuotas({ results: [...Array(6)].map((_, i) => ({ candidate_id: `D${i + 1}`, fills: Math.floor(n / 4 ** i) % 4 })) }, ids6);
    if (r.ok) quotaVectors.set(canonicalJson(r.quotas), r.quotas);
  }
  let allDrawable = true; let checkedVectors = 0;
  const devMin = drawDevelopment(minimal, new Set(), sha256('synthetic-proof-dev'));
  const devIdsMin = new Set(idsOf(devMin.development));
  for (const q of quotaVectors.values()) {
    checkedVectors++;
    const h = drawHeldOut(minimal, new Set(), devIdsMin, sha256('synthetic-proof-ho'), q);
    if (!h.ok) allDrawable = false;
  }
  ok(devMin.ok && allDrawable && checkedVectors === quotaVectors.size && checkedVectors > 10, `PROOF (constructive): minimal frame supports every one of ${quotaVectors.size} distinct permitted quota vectors after an all-eligible development draw`);
  for (const [cls, i] of [['fill-expected', 0], ['abstention-expected', 126], ['identity-hazard', 178]]) {
    const oneShort = minimal.filter((_, k) => k !== i);
    const s = FR.frameSufficiency(oneShort, new Set());
    ok(!s.ok && s.shortfall.length === 1 && s.shortfall[0].class === cls, `one ${cls} row below the minimum is insufficient`);
  }
  const maxQ = FR.MAX_HELD_OUT_QUOTAS;
  const shortFill = minimal.filter((_, k) => k !== 0);
  const devShort = drawDevelopment(shortFill, new Set(), sha256('synthetic-proof-dev'));
  ok(!drawHeldOut(shortFill, new Set(), new Set(idsOf(devShort.development)), sha256('synthetic-proof-ho'), maxQ).ok, 'PROOF (tightness): one row fewer than 126 cannot guarantee the maximum quota');
  ok(!FR.frameSufficiency(minimal, new Set([minimal[0].candidate_id])).ok, 'held-out-ineligible rows do not count toward sufficiency');
  ok(!FR.frameSufficiency(minimal.map((r, k) => (k === 0 ? { ...r, expected_outcome_class: 'abstention-expected' } : r)), new Set()).ok, 'changed class moves the row out of its class count');
  throws(() => FR.frameSufficiency([...minimal, { ...minimal[3], candidate_id: 'SYN-DUP-ID' }], new Set()), 'duplicate candidate (same identifier) refused by sufficiency check');
}

// ── 12b. Protocol-004: rater order (§12.1) ────────────────────────────────────────────────────────
const REC = (tag) => {
  const body = { stage: 'held-out', tag, drand_randomness: H(`rand-${tag}`), seed_fingerprint: H(`fp-${tag}`) };
  return { ...body, record_sha256: sha256(canonicalJson(body)) };
};
{
  const rec = REC('a');
  const items = ['SYN-0101', 'SYN-0102', 'SYN-0103'].flatMap((id) => FIELDS3.map((field) => ({ candidate_id: id, field })));
  ok(RO.recomputeRecordSha(rec) === rec.record_sha256, 'record_sha256 recomputes');
  throws(() => RO.recomputeRecordSha({ ...rec, drand_randomness: H('substituted') }), 'RATER-ORDER SEED SUBSTITUTION: altered record refused (record_sha256 does not recompute)');
  ok(RO.orderKey(rec.record_sha256, 'rater-1', 'SYN-0101', 'founded_year') === sha256(`cpg-u1-rater-order/v1|${rec.record_sha256}|rater-1|SYN-0101|founded_year`), 'order_key = sha256("cpg-u1-rater-order/v1|record|label|candidate_id|field")');
  const o1 = RO.presentationOrder(rec.record_sha256, 'rater-1', items);
  const keys = o1.map((x) => x.order_key);
  ok(keys.every((k, i) => i === 0 || keys[i - 1] < k) && o1.length === items.length, 'presentation order is ascending order_key over all items');
  ok(canonicalJson(RO.presentationOrder(rec.record_sha256, 'rater-1', [...items].reverse())) === canonicalJson(o1), 'order independent of input order');
  ok(canonicalJson(RO.presentationOrder(rec.record_sha256, 'rater-2', items).map((x) => x.candidate_id + x.field)) !== canonicalJson(o1.map((x) => x.candidate_id + x.field)), 'distinct labels give distinct orders');
  ok(canonicalJson(RO.presentationOrder(REC('b').record_sha256, 'rater-1', items).map((x) => x.candidate_id + x.field)) !== canonicalJson(o1.map((x) => x.candidate_id + x.field)), 'a different sampling record gives a different order');
  ok(!RO.orderKey(rec.record_sha256, 'rater-1', 'SYN-0101', 'founded_year').startsWith(sha256(`${rec.seed_fingerprint}|x`).slice(0, 8)) && RO.RATER_ORDER_DOMAIN === 'cpg-u1-rater-order/v1', 'domain-separated namespace');
  throws(() => RO.presentationOrder(rec.record_sha256, 'rater-1', [...items, items[0]]), 'duplicate item refused');
  throws(() => RO.orderKey(rec.record_sha256, 'rater-3', 'SYN-0101', 'founded_year'), 'unknown label refused');
  throws(() => RO.orderKey(rec.record_sha256, 'rater-1', 'SYN|0101', 'founded_year'), 'candidate_id with separator refused (unambiguous preimage)');
  const art = RO.orderArtifact(rec.record_sha256, 'rater-1', items);
  ok(art.order_sha256 === sha256(canonicalJson({ schema: art.schema, domain: art.domain, held_out_record_sha256: art.held_out_record_sha256, label: art.label, items: art.items })), 'archive artifact carries order_sha256 over its canonical body');
  let parityA = 0; for (const it of items) if (RO.authorIsRecord1(rec.record_sha256, it.candidate_id, it.field)) parityA++;
  ok(items.every((it) => RO.authorIsRecord1(rec.record_sha256, it.candidate_id, it.field) === (parseInt(RO.orderKey(rec.record_sha256, 'reference-adjudicator-record-1', it.candidate_id, it.field)[0], 16) % 2 === 0)) && parityA > 0 && parityA < items.length, 'Record 1/2 assignment = parity of a separate assignment key (both outcomes occur)');
}

// ── 12c. Protocol-004: blinded adjudication packets (§9.2.1, §12.2) ────────────────────────────────
{
  const rec = REC('packets');
  const entries = ['SYN-0201', 'SYN-0202', 'SYN-0203'].map((id, i) => ({ candidate_id: id, company_name: `SYNTHETIC-CO-P${i}`, canonical_domain: `synthetic-p${i}.example`, jurisdiction_family: 'LEI-ONLY', identifier_scheme: 'LEI', identifier_value: lei(900 + i), wikidata_qid: '', stratum: 'fill-expected', split: 'held-out', held_out_ineligible_basis: [] }));
  const mk = (by, over = {}) => entries.flatMap((e) => FIELDS3.map((f) => blind(e.candidate_id, f, by, over[`${e.candidate_id}|${f}`] || {})));
  const author = mk('author-1'); const confirmer = mk('confirmer-1', { 'SYN-0201|founded_year': { expected_value: '2001' }, 'SYN-0203|employee_count': { expected_value: '1500' } });
  const inputs = { entries, author, confirmer, recordSha: rec.record_sha256 };
  const pk = PK.buildReferenceAdjudicationPacket(inputs);
  ok(pk.items.length === 2 && pk.items.every((it) => Object.keys(it).sort().join() === [...PK.REFERENCE_ITEM_KEYS].sort().join()), 'reference packet: only the 2 disagreeing items, exactly the permitted keys');
  ok(PK.checkReferenceAdjudicationPacket(pk, inputs).length === 0, 'reference packet verifies against deterministic build');
  const bad = (mut) => PK.checkReferenceAdjudicationPacket(mut(JSON.parse(JSON.stringify(pk))), inputs).length > 0;
  ok(bad((p) => { p.items[0].expected_outcome_class = 'fill-expected'; return p; }), 'FORBIDDEN (reference adjudicator): class prediction refused');
  ok(bad((p) => { p.items[0].split = 'held-out'; return p; }), 'FORBIDDEN (reference adjudicator): split refused');
  ok(bad((p) => { p.items[0].cpg_value = '1999'; return p; }), 'FORBIDDEN (reference adjudicator): CPG output refused');
  ok(bad((p) => { p.items[0].record_1.recorded_by = 'author-1'; return p; }), 'FORBIDDEN (reference adjudicator): recorder identity refused');
  ok(bad((p) => { p.tallies = { AUTHOR: 3 }; return p; }), 'FORBIDDEN (reference adjudicator): tallies refused');
  ok(bad((p) => { p.items.push({ ...p.items[0], field: 'revenue_range' }); return p; }), 'FORBIDDEN (reference adjudicator): agreeing / extra record refused');
  ok(bad((p) => { const t = p.items[0].record_1; p.items[0].record_1 = p.items[0].record_2; p.items[0].record_2 = t; return p; }), 'reference packet: swapped Record 1/2 refused');
  ok(bad((p) => { p.items.reverse(); return p; }), 'reference packet: substituted presentation order refused');
  const decided = PK.resolveReferenceDecisions(pk.items.map((it) => ({ candidate_id: it.candidate_id, field: it.field, decision: 'RECORD_1', rationale: 'SYNTHETIC', adjudicated_by: 'adj', adjudicated_at: '2026-09-17' })), rec.record_sha256);
  ok(decided.every((d) => d.decision === (RO.authorIsRecord1(rec.record_sha256, d.candidate_id, d.field) ? 'AUTHOR' : 'CONFIRMER')), 'blind RECORD_1 decisions resolve mechanically to AUTHOR/CONFIRMER');
  throws(() => PK.resolveReferenceDecisions([{ candidate_id: 'SYN-0201', field: 'founded_year', decision: 'AUTHOR' }], rec.record_sha256), 'reference adjudicator cannot decide by role name');

  const refRec = Object.fromEntries(REFERENCE_COLUMNS.map((c) => [c, 'x']));
  const evalItems = entries.flatMap((e) => FIELDS3.map((f) => ({ candidate_id: e.candidate_id, field: f, cpg_value: null, cpg_source_urls: [], reference_record: { ...refRec, candidate_id: e.candidate_id, field: f } })));
  const r1 = evalItems.map((it) => ({ candidate_id: it.candidate_id, field: it.field, label: 'CORRECT-ABSTENTION' }));
  const r2 = evalItems.map((it, i) => ({ candidate_id: it.candidate_id, field: it.field, label: i % 4 === 0 ? 'MISSED-FILL' : 'CORRECT-ABSTENTION' }));
  const rin = { evaluationItems: evalItems, rater1: r1, rater2: r2, recordSha: rec.record_sha256 };
  const rp = PK.buildRatingAdjudicationPacket(rin);
  ok(rp.items.length === 3 && rp.items.every((it) => Object.keys(it).sort().join() === [...PK.RATING_ITEM_KEYS].sort().join()), 'rating packet: only disagreeing items, exactly the §12 packet + Label A/B');
  ok(PK.checkRatingAdjudicationPacket(rp, rin).length === 0, 'rating packet verifies against deterministic build');
  ok(rp.items.every((it) => { const l1 = r1.find((x) => x.candidate_id === it.candidate_id && x.field === it.field).label; const aKey = sha256(`cpg-u1-rater-order/v1|${rec.record_sha256}|rating-adjudicator-label-a|${it.candidate_id}|${it.field}`); return it.label_a === (parseInt(aKey[0], 16) % 2 === 0 ? l1 : r2.find((x) => x.candidate_id === it.candidate_id && x.field === it.field).label); }), 'Label A/B assignment = parity of the rating-adjudicator-label-a key');
  const rbad = (mut) => PK.checkRatingAdjudicationPacket(mut(JSON.parse(JSON.stringify(rp))), rin).length > 0;
  ok(rbad((p) => { p.items[0].rater_1_label = p.items[0].label_a; return p; }), 'FORBIDDEN (rating adjudicator): rater identity refused');
  ok(rbad((p) => { p.items[0].stratum = 'fill-expected'; return p; }), 'FORBIDDEN (rating adjudicator): class/stratum refused');
  ok(rbad((p) => { p.items[0].split = 'held-out'; return p; }), 'FORBIDDEN (rating adjudicator): split refused');
  ok(rbad((p) => { p.pilot_yield = 1; return p; }), 'FORBIDDEN (rating adjudicator): pilot information refused');
  ok(rbad((p) => { p.tallies = { EFR: 0.04 }; return p; }), 'FORBIDDEN (rating adjudicator): tallies refused');
  ok(rbad((p) => { p.items.push({ ...evalItems[1], label_a: 'CORRECT-ABSTENTION', label_b: 'CORRECT-ABSTENTION' }); return p; }), 'FORBIDDEN (rating adjudicator): agreeing item refused');
  ok(rbad((p) => { const t = p.items[0].label_a; p.items[0].label_a = p.items[0].label_b; p.items[0].label_b = t; return p; }), 'rating packet: swapped Label A/B refused');
  throws(() => PK.buildRatingAdjudicationPacket({ ...rin, evaluationItems: [{ ...evalItems[0], expected_outcome_class: 'fill-expected' }] }), 'rating packet build refuses an evaluation item carrying extra information');
  const rres = PK.resolveRatingDecisions([{ candidate_id: rp.items[0].candidate_id, field: rp.items[0].field, decision: 'LABEL_B' }], rp);
  ok(rres[0].label === rp.items[0].label_b, 'LABEL_B decision resolves to the label shown as B');
}

// ── 12d. Protocol-004: personnel register (§4A) ─────────────────────────────────────────────────────
const DECL = Object.fromEntries(PE.DECLARATION_KEYS.map((k) => [k, 'no']));
const personnel = () => ({
  schema: 'cpg-u1-personnel/v1', operator: { person_id: 'SYN-OPERATOR' },
  assignments: PE.INDEPENDENT_ROLES.map((role, i) => ({ role, person_id: `SYN-P${i}`, pseudonym: `pseud-${i}`, declaration: { ...DECL }, study_fee_agreement_sha256: H(`fee-${i}`), organisation_confirmation_sha256: H(`org-${i}`) })),
});
{
  const chk = (reg) => PE.checkPersonnelRegister(reg);
  ok(chk(personnel()).errors.length === 0 && chk(personnel()).blockers.length === 0, 'personnel: 7 distinct independent people, operator in none — accepted');
  const coll = (a, b) => { const r = personnel(); r.assignments[b].person_id = r.assignments[a].person_id; return chk(r).errors.some((e) => e.includes('ROLE COLLISION')); };
  ok(coll(0, 3), 'ROLE COLLISION: enumerator = reference adjudicator refused (A-1)');
  ok(coll(1, 2), 'ROLE COLLISION: author = confirmer refused');
  ok(coll(4, 5), 'ROLE COLLISION: rater 1 = rater 2 refused');
  ok(coll(3, 6), 'ROLE COLLISION: reference adjudicator = rating adjudicator refused');
  ok(coll(0, 4), 'ROLE COLLISION: enumerator = rater refused');
  { const r = personnel(); r.assignments[2].person_id = 'SYN-OPERATOR'; ok(chk(r).errors.some((e) => e.includes('operator')), 'ROLE COLLISION: operator holding an independent role refused'); }
  { const r = personnel(); r.assignments.push({ ...r.assignments[0], person_id: 'SYN-P-ENUM2', pseudonym: 'e2' }); ok(chk(r).errors.length === 0, 'multiple distinct enumerators permitted'); }
  { const r = personnel(); r.assignments.push({ ...r.assignments[4], person_id: 'SYN-P-R1B' }); ok(chk(r).errors.some((e) => e.includes('exactly one')), 'a second rater-1 refused'); }
  { const r = personnel(); r.assignments.splice(6, 1); ok(chk(r).blockers.some((b) => b.includes('rating-adjudicator')), 'missing rating adjudicator is a blocker'); }
  for (const k of PE.DECLARATION_KEYS) { const r = personnel(); r.assignments[0].declaration[k] = 'yes'; if (!chk(r).errors.some((e) => e.includes(k))) failures.push(`declaration ${k}=yes not refused`); else pass++; }
  { const r = personnel(); r.assignments[1].declaration.payment_other_than_study_fee = 'unknown'; ok(chk(r).errors.length > 0, 'A-5: an unknown relationship answer is not independence'); }
  { const r = personnel(); delete r.assignments[1].organisation_confirmation_sha256; ok(chk(r).errors.some((e) => e.includes('organisation_confirmation')), 'A-5: developing-organisation confirmation required'); }
  { const r = personnel(); r.assignments[1].study_fee_agreement_sha256 = null; ok(chk(r).errors.length === 0, 'no study fee (null) permitted'); }
}

// ── 12e. Protocol-004: execution window and no-preview audit (§6.5) ─────────────────────────────────
const samplingRecord = (stage, drandRoundTime, tag) => {
  const b = { stage, drand_round_time: drandRoundTime, commitment_txid: H(`txid-${tag}`), payload_digest: H(`digest-${tag}`), commitment_height: 4062, randomness_block_hash: H(`rblock-${tag}`), drand_round: tag === 'dev' ? 1 : 1000000, drand_randomness: H(`drand-${tag}`), seed_fingerprint: H(`fp-${tag}`) };
  return { ...b, record_sha256: sha256(canonicalJson(b)) };
};
function execFixture() {
  const frameRows = ['SYN-D1', 'SYN-H1', 'SYN-H2', 'SYN-X1'].map((id) => ({ candidate_id: id, canonical_domain: `${id.toLowerCase()}.example` }));
  const registration = { study_id: 'CPG-U1-2026-01', registration_id: 'SYNTHETIC-REG', protocol_sha256: H('protocol'), tooling_aggregate_sha256: H('tooling'), registry_sha256: H('registry'), as_of: '2026-09-01T00:00:00Z', provider_configuration_sha256: H('provider') };
  const bound = { study_id: registration.study_id, registration_id: registration.registration_id, protocol_sha256: registration.protocol_sha256, tooling_aggregate_sha256: registration.tooling_aggregate_sha256, registry_sha256: registration.registry_sha256, frame_hash: hashRecords(frameRows, 'candidate_id'), scan_sha256: H('scan') };
  const devManifest = { ...bound, stage: 'development', sampling: samplingRecord('development', 1692803367, 'dev'), development: [{ candidate_id: 'SYN-D1' }] };
  const hoManifest = { ...bound, stage: 'held-out', sampling: samplingRecord('held-out', 1695803364, 'ho'), held_out: [{ candidate_id: 'SYN-H1' }, { candidate_id: 'SYN-H2' }] };
  const body = { seal_version: 3, development: { manifest_sha256: H('DM'), sampling_record_sha256: devManifest.sampling.record_sha256 }, held_out: { manifest_sha256: H('HM'), sampling_record_sha256: hoManifest.sampling.record_sha256 } };
  const seal = { ...body, seal_hash: sha256(canonicalJson(body)) };
  const pub = { seal_hash: seal.seal_hash, record_id: 'SYNTHETIC-OSF-SEAL-RECORD', registry_timestamp: '2023-10-01T00:00:00Z' };
  return { registration, devManifest, hoManifest, seal, frameRows, pub, args: { registration, seal, sealPublication: pub, devManifest, devManifestSha: H('DM'), hoManifest, hoManifestSha: H('HM'), frameRows } };
}
{
  const fx0 = execFixture();
  const auth = EX.buildAuthorization(fx0.args);
  ok(auth.window_opens_at === '2023-10-01T00:00:00Z' && EX.checkAuthorization(auth) === auth.authorization_sha256, 'authorization: window opens at the registry timestamp of the published seal; hash recomputes');
  throws(() => EX.buildAuthorization({ ...fx0.args, sealPublication: { ...fx0.pub, seal_hash: H('other seal') } }), 'authorization refused: published record names another seal');
  throws(() => EX.buildAuthorization({ ...fx0.args, seal: { ...fx0.seal, held_out: { manifest_sha256: H('HM') }, extra: 1 } }), 'authorization refused: seal_hash does not recompute');
  throws(() => EX.buildAuthorization({ ...fx0.args, hoManifest: { ...fx0.hoManifest, frame_hash: H('F2') } }), 'authorization refused: held-out frame differs from development frame');
  // isolates the development/held-out comparison: the held-out frame hash IS the sealed frame, only the development manifest differs
  throws(() => EX.buildAuthorization({ ...fx0.args, devManifest: { ...fx0.devManifest, frame_hash: H('F2') } }), 'authorization refused: development frame differs from the held-out (sealed) frame — single frozen frame');
  ok(auth.protocol_sha256 === H('protocol') && auth.tooling_aggregate_sha256 === H('tooling') && auth.registry_sha256 === H('registry') && auth.scan_sha256 === H('scan') && auth.study_id === 'CPG-U1-2026-01' && auth.registration_id === 'SYNTHETIC-REG'
    && auth.as_of === '2026-09-01T00:00:00Z' && auth.provider_configuration_sha256 === H('provider') && auth.frame_hash === fx0.hoManifest.frame_hash
    && auth.development_commitment.commitment_txid === H('txid-dev') && auth.held_out_commitment.drand_randomness === H('drand-ho') && auth.held_out_commitment.sampling_record_sha256 === fx0.hoManifest.sampling.record_sha256, 'CPG-044 authorization binds study, registration, protocol, tooling, registry, scan, frame, asOf, provider configuration, both commitments and their randomness');
  throws(() => EX.buildAuthorization({ ...fx0.args, registration: undefined }), 'CPG-044 authorization refused without the registration record');
  throws(() => EX.buildAuthorization({ ...fx0.args, frameRows: [...fx0.frameRows, { candidate_id: 'SYN-X2', canonical_domain: 'syn-x2.example' }] }), 'CPG-044 authorization refused: supplied frame is not the sealed frame');
  for (const k of ['protocol_sha256', 'tooling_aggregate_sha256', 'registry_sha256']) {
    throws(() => EX.buildAuthorization({ ...fx0.args, registration: { ...fx0.registration, [k]: H('other') } }), `CPG-044 authorization refused: registration ${k} differs from the manifests`);
    throws(() => EX.buildAuthorization({ ...fx0.args, devManifest: { ...fx0.devManifest, [k]: H('other') } }), `CPG-044 authorization refused: development manifest ${k} differs from the registration`);
  }
  throws(() => EX.buildAuthorization({ ...fx0.args, registration: { ...fx0.registration, study_id: 'CPG-U1-OTHER' } }), 'CPG-044 authorization refused: wrong study');
  throws(() => EX.buildAuthorization({ ...fx0.args, hoManifest: { ...fx0.hoManifest, registration_id: 'SYNTHETIC-OTHER' } }), 'CPG-044 authorization refused: held-out manifest of another registration');
  throws(() => EX.buildAuthorization({ ...fx0.args, hoManifest: { ...fx0.hoManifest, scan_sha256: H('scan2') } }), 'CPG-044 authorization refused: held-out scan differs from development scan');
  throws(() => EX.buildAuthorization({ ...fx0.args, hoManifest: { ...fx0.hoManifest, sampling: { ...fx0.hoManifest.sampling, drand_randomness: H('substituted') } } }), 'CPG-044 authorization refused: held-out randomness altered (record does not recompute)');
  throws(() => EX.buildAuthorization({ ...fx0.args, hoManifest: { ...fx0.hoManifest, sampling: samplingRecord('held-out', 1695803364, 'other') } }), 'CPG-044 authorization refused: a recomputable but unsealed held-out commitment record');
  { const wrong = samplingRecord('held-out', 1692803367, 'dev'); const { seal_hash: _x, ...b } = { ...fx0.seal, development: { ...fx0.seal.development, sampling_record_sha256: wrong.record_sha256 } }; const s2 = { ...b, seal_hash: sha256(canonicalJson(b)) };
    throws(() => EX.buildAuthorization({ ...fx0.args, devManifest: { ...fx0.devManifest, sampling: wrong }, seal: s2, sealPublication: { ...fx0.pub, seal_hash: s2.seal_hash } }), 'CPG-044 authorization refused: sealed sampling record naming the wrong stage'); }
  { const stale = { ...fx0.seal, held_out: { ...fx0.seal.held_out, extra: 'tampered' } }; const { seal_hash: _s, ...rest } = stale; throws(() => EX.buildAuthorization({ ...fx0.args, seal: stale, sealPublication: { ...fx0.pub, seal_hash: sha256(canonicalJson(rest)) } }), 'authorization refused: seal file whose stored seal_hash is stale, even if the publication names the recomputed hash'); }
  throws(() => EX.buildAuthorization({ ...fx0.args, hoManifestSha: H('other held-out manifest') }), 'authorization refused: seal does not bind the supplied held-out manifest');
  throws(() => EX.buildAuthorization({ ...fx0.args, devManifestSha: H('other development manifest') }), 'authorization refused: seal does not bind the supplied development manifest');
  throws(() => EX.buildAuthorization({ ...fx0.args, sealPublication: { ...fx0.pub, registry_timestamp: '2023-09-01T00:00:00Z' } }), 'authorization refused: seal publication before the held-out draw could exist');
  throws(() => EX.checkAuthorization({ ...auth, window_opens_at: '2023-09-01T00:00:00Z' }), 'tampered authorization refused');
  const run = (kind, started, completed, invocations, sha = auth.authorization_sha256, id = `run-${kind}-${started}`) => ({ run_id: id, kind, authorization_sha256: kind === 'held-out-authorized' ? sha : undefined, started_at: started, completed_at: completed, invocations });
  const inv = (at, candidate_id) => ({ at, candidate_id });
  const audit = (runs) => EX.auditExecutionLog(auth, { schema: 'cpg-u1-execution-log/v1', runs });
  const good = run('held-out-authorized', '2023-10-02T00:00:00Z', '2023-10-02T06:00:00Z', [inv('2023-10-02T01:00:00Z', 'SYN-H1'), { at: '2023-10-02T02:00:00Z', canonical_domain: 'syn-h2.example' }]);
  ok(audit([good, run('development', '2023-08-24T00:00:00Z', '2023-08-24T01:00:00Z', [inv('2023-08-24T00:10:00Z', 'SYN-D1')])]).state === 'NO_VIOLATION_IN_LOG', 'audit: authorized run inside the window + development runs after the development draw — no violation in the log');
  ok(audit([]).state === 'NOT_EXECUTED', 'audit: empty log = NOT_EXECUTED');
  ok(audit([good, run('other', '2023-09-30T00:00:00Z', '2023-09-30T00:05:00Z', [inv('2023-09-30T00:01:00Z', 'SYN-H1')])]).state === 'STUDY_VOID_PREVIEW', 'PREVIEW before the execution window: held-out company executed privately → VOID');
  ok(audit([run('held-out-authorized', '2023-09-30T12:00:00Z', '2023-09-30T18:00:00Z', [inv('2023-09-30T13:00:00Z', 'SYN-H1')])]).state === 'STUDY_VOID_PREVIEW' || audit([run('held-out-authorized', '2023-09-30T12:00:00Z', '2023-09-30T18:00:00Z', [])]).state === 'STUDY_VOID_UNAUTHORIZED_EXECUTION', 'EXECUTION BEFORE AUTHORIZATION: run started before the window opened → VOID');
  ok(audit([run('held-out-authorized', '2023-09-30T12:00:00Z', '2023-09-30T18:00:00Z', [])]).state === 'STUDY_VOID_UNAUTHORIZED_EXECUTION', 'execution before authorization → STUDY_VOID_UNAUTHORIZED_EXECUTION');
  ok(audit([good, run('other', '2023-10-03T00:00:00Z', '2023-10-03T01:00:00Z', [inv('2023-10-03T00:10:00Z', 'SYN-H2')])]).state === 'STUDY_VOID_POST_WINDOW_EXECUTION', 'EXECUTION AFTER WINDOW: held-out company executed after the authorized run completed → VOID');
  ok(audit([good, run('held-out-authorized', '2023-10-04T00:00:00Z', '2023-10-04T01:00:00Z', [], auth.authorization_sha256, 'second')]).state === 'STUDY_VOID_REPEATED_EXECUTION', 'repeated authorized run → VOID');
  ok(audit([run('held-out-authorized', '2023-10-02T00:00:00Z', '2023-10-02T06:00:00Z', [], H('forged authorization'))]).state === 'STUDY_VOID_UNAUTHORIZED_EXECUTION', 'run naming a different authorization → VOID');
  ok(audit([good, run('other', '2023-08-01T00:00:00Z', '2023-08-01T01:00:00Z', [inv('2023-08-01T00:10:00Z', 'SYN-D1')])]).state === 'STUDY_VOID_PREVIEW', 'PREVIEW: company executed before the development draw existed → VOID');
  ok(audit([good, run('other', '2023-09-01T00:00:00Z', '2023-09-01T01:00:00Z', [inv('2023-09-01T00:10:00Z', 'SYN-X1')])]).state === 'STUDY_VOID_PREVIEW', 'PREVIEW: non-drawn frame company executed before the held-out draw existed → VOID');
  ok(audit([good, run('other', '2023-09-29T00:00:00Z', '2023-09-29T01:00:00Z', [inv('2023-09-29T00:10:00Z', 'SYN-X1')])]).state === 'NO_VIOLATION_IN_LOG', 'non-drawn frame company after the held-out draw is not a held-out candidate');
  ok(audit([run('held-out-authorized', '2023-10-02T00:00:00Z', '2023-10-02T06:00:00Z', [inv('2023-10-02T01:00:00Z', 'SYN-D1')])]).state === 'STUDY_VOID_UNAUTHORIZED_EXECUTION', 'authorized run executing a non-held-out company → VOID');
  ok(audit([good, run('other', '2023-10-01T00:00:00Z', '2023-10-01T01:00:00Z', [{ at: '2023-10-01T00:30:00Z', canonical_domain: 'syn-h1.example' }])]).state === 'STUDY_VOID_PREVIEW', 'preview detected by canonical domain as well as by candidate_id');
  throws(() => audit([run('other', 'yesterday', '2023-10-01T01:00:00Z', [])]), 'malformed log timestamps refused');
}

// ── 12f. CPG-044: hash-chained harness event log ─────────────────────────────────────────────────────
{
  const dir = mkdtempSync(join(tmpdir(), 'cpg044-eventlog-'));
  try {
    const lp = join(dir, 'events.jsonl');
    EL.appendEvent(lp, 'LOG_OPENED', '2026-09-17T00:00:00Z', { registration_id: 'SYNTHETIC-REG' });
    EL.appendEvent(lp, 'EXECUTION_REFUSED', '2026-09-17T00:00:01Z', { code: 'X' });
    EL.appendEvent(lp, 'PREVIEW_ATTEMPT', '2026-09-17T00:00:02Z', { code: 'Y' });
    const { events, head } = EL.readEventLog(lp);
    ok(events.length === 3 && events[1].prev_event_sha256 === events[0].event_sha256 && head === events[2].event_sha256, 'event log: hash chain links every event to its predecessor');
    throws(() => EL.appendEvent(lp, 'UNKNOWN_TYPE', '2026-09-17T00:00:03Z'), 'event log: unknown event type refused');
    const lines = readFileSync(lp, 'utf8').split('\n').filter(Boolean);
    const writeLines = (name, ls) => { const p = join(dir, name); writeFileSync(p, `${ls.join('\n')}\n`); return p; };
    const edited = [...lines]; edited[1] = edited[1].replace('"code":"X"', '"code":"Z"');
    throws(() => EL.readEventLog(writeLines('edited.jsonl', edited)), 'event log: edited event detected');
    throws(() => EL.readEventLog(writeLines('deleted.jsonl', [lines[0], lines[2]])), 'event log: deleted interior event detected');
    throws(() => EL.readEventLog(writeLines('reordered.jsonl', [lines[0], lines[2], lines[1]])), 'event log: reordered events detected');
    // isolates the hash chain: sequence numbers stay 1..3 and every event_sha256 recomputes, but event 2 does not link to event 1
    {
      const forged = JSON.parse(lines[1]);
      forged.prev_event_sha256 = EL.GENESIS;
      const { event_sha256: _drop, ...body } = forged;
      const relinked = { ...body, event_sha256: sha256(canonicalJson(body)) };
      throws(() => EL.readEventLog(writeLines('relinked.jsonl', [lines[0], JSON.stringify(relinked), lines[2]])), 'event log: an event spliced from another chain (sequence intact, own hash recomputes) detected by the hash chain');
    }
    ok(EL.readEventLog(writeLines('truncated.jsonl', lines.slice(0, 2))).events.length === 2, 'event log LIMITATION: a truncated tail is not detectable from the file alone (head hash must be published)');
    ok(canonicalJson([...EL.REFUSAL_TYPES].sort()) === canonicalJson(['EXECUTION_REFUSED', 'MALFORMED_EXECUTION', 'POST_WINDOW_EXECUTION', 'PREVIEW_ATTEMPT', 'REPEATED_EXECUTION', 'VERIFICATION_FAILURE']), 'event log distinguishes refused, preview, repeated, post-window, malformed and verification-failure events');
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

// ── 12g. CPG-044: response archive, replay comparison, pilot result from archive ──────────────────────
const httpEvent = (seq, body) => { const b = Buffer.from(body); return { seq, origin: 'https://synthetic.example', path: '/', method: 'GET', status: 200, headers: ['Date', 'Mon, 01 Jan 2024 00:00:00 GMT'], created_at: '2023-09-01T00:00:01Z', headers_at: '2023-09-01T00:00:02Z', completed_at: '2023-09-01T00:00:02Z', error: null, complete: true, body_base64: b.toString('base64'), body_sha256: sha256(b), body_bytes: b.length }; };
const synthResponse = (facts) => JSON.stringify({ facts: { founded_year: null, team_size: null, revenue_range: null, ...facts }, matched_label: null, source: 'cpg_grounding', grounding: { asOf: '2026-09-01T00:00:00Z' } });
const synthExecution = (facts, extra = {}) => ({
  raw_response: synthResponse(facts), executor_error: null, started_at: '2023-09-01T00:00:00Z', completed_at: '2023-09-01T00:00:05Z', executor: { kind: 'synthetic' },
  exchanges: [{ seq: 1, requested_url: 'https://synthetic.example/', options: { allowedHosts: null, maxBytes: null, headers: null }, result: { ok: true, status: 200, url: 'https://synthetic.example/', text: '<html>SYNTHETIC</html>' }, error: null, started_at: '2023-09-01T00:00:01Z', completed_at: '2023-09-01T00:00:02Z' }],
  wikidata_calls: [], http_events: [httpEvent(1, '<html>SYNTHETIC</html>')], ...extra,
});
{
  const input = { companyId: 'CPG-U1-FIXTURE', companyName: 'SYNTHETIC-CO-1', websiteUrl: 'https://synthetic-1.example', linkedinUrl: null, asOf: '2026-09-01T00:00:00Z' };
  const rec = AR.buildArchiveRecord({ study_id: 'CPG-U1-2026-01', registration_id: 'SYNTHETIC-REG', stage: 'development', run_id: 'pilot-1', candidate_id: 'SYN-0001', input, execution: synthExecution({ founded_year: '1999' }) });
  ok(AR.verifyArchiveRecord(rec).length === 0 && rec.run_kind === 'pilot', 'archive: record verifies (raw, canonical, exchanges, identity, hashes)');
  ok(rec.canonical_response === canonicalJson(JSON.parse(rec.raw_response)) && rec.raw_response_sha256 === sha256(rec.raw_response) && rec.replay.exchanges[0].text_sha256 === sha256('<html>SYNTHETIC</html>'), 'archive: canonical form, raw hash and per-exchange text hash recorded');
  ok(canonicalJson(AR.buildArchiveRecord({ study_id: 'CPG-U1-2026-01', registration_id: 'SYNTHETIC-REG', stage: 'development', run_id: 'pilot-1', candidate_id: 'SYN-0001', input, execution: synthExecution({ founded_year: '1999' }) })) === canonicalJson(rec), 'archive: deterministic record for identical inputs');
  const bad = (mut) => AR.verifyArchiveRecord(mut(JSON.parse(JSON.stringify(rec)))).length > 0;
  ok(bad((r) => { r.raw_response = r.raw_response.replace('1999', '2001'); return r; }), 'archive: altered raw response detected');
  ok(bad((r) => { r.replay.exchanges[0].result.text = 'altered'; return r; }), 'archive: altered exchange detected');
  ok(bad((r) => { r.stage = 'held-out'; return r; }), 'archive: altered stage identity detected');
  ok(bad((r) => { r.candidate_id = 'SYN-0002'; return r; }), 'archive: altered candidate identity detected');
  const reHashed = (mut) => { const r = mut(JSON.parse(JSON.stringify(rec))); const { record_sha256: _x, ...b } = r; return AR.verifyArchiveRecord({ ...b, record_sha256: sha256(canonicalJson(b)) }); };
  ok(reHashed((r) => { r.raw_response = JSON.stringify(JSON.parse(r.raw_response), null, 1); return r; }).some((e) => e.includes('raw_response_sha256')), 'archive: raw response replaced (same canonical form, record re-hashed) detected by the raw hash');
  ok(reHashed((r) => { r.canonical_response = canonicalJson({ facts: { founded_year: '2001' } }); r.canonical_response_sha256 = sha256(r.canonical_response); return r; }).some((e) => e.includes('canonical form')), 'archive: canonical response substituted (hashes and record re-hashed) detected');
  ok(reHashed((r) => { r.replay.exchanges[0].result.text = 'substituted'; return r; }).some((e) => e.includes('text_sha256')), 'archive: replay exchange substituted (record re-hashed) detected');
  ok(reHashed((r) => { r.replay.http_events[0].body_base64 = Buffer.from('substituted').toString('base64'); return r; }).some((e) => e.includes('body_sha256')), 'archive: raw document body substituted (record re-hashed) detected by the per-document SHA-256');
  // §13.1 Merkle root: RFC 6962 §2.1 Merkle Tree Hash, checked against the certificate-transparency reference vectors
  {
    const L = ['', '00', '10', '2021', '3031', '40414243', '5051525354555657', '606162636465666768696a6b6c6d6e6f'].map((x) => Buffer.from(x, 'hex'));
    const want = ['e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', '6e340b9cffb37a989ca544e6bb780a2c78901d3fb33738768511a30617afa01d', 'fac54203e7cc696cf0dfcb42c92a1d9dbaf70ad9e621f4bd8d98662f00e3c125',
      'aeb6bcfe274b70a14fb067a5e5578264db0fa9b51af5e0ba159158f329e06e77', 'd37ee418976dd95753c1c73862b9398fa2a2cf9b4ff0fdfe8b30cd95209614b7', '4e3bbb1f7b478dcfe71fb631631519a3bca12c9aefca1612bfce4c13a86264d4',
      '76e67dadbcdf1e10e1b74ddc608abd2f98dfb16fbce75277b5232a127f2087ef', 'ddb89be403809e325750d3d263cd78929c2942b7942a34b77e122c9594a74c8c', '5dc9da79a70659a9ad559cb701ded9a2ab9d823aad2f4960cfe370eff4604328'];
    ok(want.every((w, n) => AR.merkleTreeHash(L.slice(0, n)).toString('hex') === w), 'archive Merkle tree = RFC 6962 Merkle Tree Hash (reference vectors, 0..8 leaves)');
    const r1 = AR.buildArchiveRecord({ study_id: 'CPG-U1-2026-01', registration_id: 'SYNTHETIC-REG', stage: 'held-out', run_id: 'ho-1', candidate_id: 'SYN-B', input, execution: synthExecution({}, { http_events: [httpEvent(2, 'b2'), httpEvent(1, 'b1')] }) });
    const r2 = AR.buildArchiveRecord({ study_id: 'CPG-U1-2026-01', registration_id: 'SYNTHETIC-REG', stage: 'held-out', run_id: 'ho-1', candidate_id: 'SYN-A', input, execution: synthExecution({}, { http_events: [httpEvent(1, 'a1')] }) });
    const mr = AR.archiveMerkleRoot([r1, r2]);
    ok(mr.document_count === 3 && mr.archive_merkle_root === AR.merkleTreeHash([sha256('a1'), sha256('b1'), sha256('b2')].map((h) => Buffer.from(h, 'hex'))).toString('hex') && AR.archiveMerkleRoot([r2, r1]).archive_merkle_root === mr.archive_merkle_root, 'archive Merkle root: leaves = body SHA-256 by candidate_id then seq; independent of record order');
    ok(AR.archiveMerkleRoot([r2]).archive_merkle_root !== mr.archive_merkle_root, 'archive Merkle root changes when a document is missing');
    throws(() => AR.archiveMerkleRoot([{ candidate_id: 'X', replay: { http_events: [{ seq: 1 }] } }]), 'archive Merkle root refuses a document without a SHA-256');
  }
  {
    const env = CX.adapterEnv('C:/synthetic-clone', { PATH: '/bin', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-secret', REDIS_URL: 'rediss://synthetic', EXTERNAL_KNOWLEDGE_CACHE_MODE: 'on', CACHE_KILL_ALL: '0' });
    ok(env.PATH === '/bin' && env.CACHE_KILL_ALL === '1' && env.CPG_U1_RESOLVER_CLONE === 'C:/synthetic-clone' && !('SUPABASE_SERVICE_ROLE_KEY' in env) && !('REDIS_URL' in env) && !('EXTERNAL_KNOWLEDGE_CACHE_MODE' in env), 'adapter environment pinned: operator credentials, cache and rollout overrides never reach CPG; caches killed');
  }
  ok(AR.compareReplay(rec, JSON.stringify(Object.fromEntries(Object.entries(JSON.parse(synthResponse({ founded_year: '1999' }))).reverse()))).identical,'replay comparison: identical canonical response accepted (key order irrelevant)');
  ok(!AR.compareReplay(rec, synthResponse({ founded_year: '2001' })).identical && !AR.compareReplay(rec, null).identical && !AR.compareReplay(rec, 'not json').identical, 'replay comparison: different, missing or non-JSON replay reported as differing');
  const err = AR.buildArchiveRecord({ study_id: 'CPG-U1-2026-01', registration_id: 'SYNTHETIC-REG', stage: 'held-out', run_id: 'ho-1', candidate_id: 'SYN-0003', input, execution: { executor_error: 'timeout' } });
  ok(err.canonical_response === null && err.executor_error === 'timeout' && AR.verifyArchiveRecord(err).length === 0, 'archive: executor error recorded as an INVALID observation (no response)');
  ok(AR.cpgValue(rec, 'founded_year') === '1999' && AR.cpgValue(rec, 'employee_count') === null && AR.cpgValue(err, 'founded_year') === null, 'CPG value = the prefilled fact (verified-only gate), null otherwise');

  const devM = { development: [{ candidate_id: 'D1', stratum: 'fill-expected' }, { candidate_id: 'D2', stratum: 'fill-expected' }, { candidate_id: 'D3', stratum: 'abstention-expected' }] };
  const mk = (id, facts) => AR.buildArchiveRecord({ study_id: 'CPG-U1-2026-01', registration_id: 'SYNTHETIC-REG', stage: 'development', run_id: 'pilot-1', candidate_id: id, input, execution: synthExecution(facts) });
  const pr = AR.pilotResultFromArchive([mk('D1', { founded_year: '1999', team_size: '120' }), mk('D2', {}), mk('D3', { founded_year: '2000' })], devM, H('devm'), FROZEN_SHA);
  ok(canonicalJson(pr.results) === canonicalJson([{ candidate_id: 'D1', fills: 2 }, { candidate_id: 'D2', fills: 0 }]) && pr.derived_from_archive === true, 'pilot result derived from archived development records (fills = prefilled facts), not typed by the operator');
  { let msg = ''; try { AR.pilotResultFromArchive([mk('D1', {})], devM, H('devm'), FROZEN_SHA); } catch (e) { msg = e.message; }
    ok(msg.includes('lacks development fill-expected companies') && msg.includes('D2'), 'pilot result refused, naming the development fill-expected company whose archive record is missing'); }
  throws(() => AR.pilotResultFromArchive([mk('D1', {}), mk('D1', {}), mk('D2', {})], devM, H('devm'), FROZEN_SHA), 'pilot result refused when a company has two pilot records (choose-the-better-run)');
  { const h = AR.buildArchiveRecord({ study_id: 'CPG-U1-2026-01', registration_id: 'SYNTHETIC-REG', stage: 'held-out', run_id: 'ho-1', candidate_id: 'D2', input, execution: synthExecution({}) }); throws(() => AR.pilotResultFromArchive([mk('D1', {}), h], devM, H('devm'), FROZEN_SHA), 'pilot result refused for a held-out record'); }
  { const t = JSON.parse(JSON.stringify(mk('D2', {}))); t.raw_response = synthResponse({ founded_year: '1999' }); throws(() => AR.pilotResultFromArchive([mk('D1', {}), t], devM, H('devm'), FROZEN_SHA), 'pilot result refused for a tampered archive record'); }
}

// ── 12h. CPG-044: deterministic rater packets (§12, §12.1) ─────────────────────────────────────────
{
  const rec = REC('rater-packets');
  const refRow = (id, f) => ({ ...Object.fromEntries(REFERENCE_COLUMNS.map((c) => [c, 'x'])), candidate_id: id, field: f });
  const items = ['SYN-0301', 'SYN-0302', 'SYN-0303', 'SYN-0304'].flatMap((id, i) => FIELDS3.map((f, j) => ({ candidate_id: id, field: f, cpg_value: (i + j) % 3 === 0 ? '1999' : null, cpg_source_urls: (i + j) % 3 === 0 ? [`https://synthetic-${i}.example/about`] : [], reference_record: refRow(id, f) })));
  const inputs = { label: 'rater-1', recordSha: rec.record_sha256, evaluationItems: items };
  const pkt = RP.buildRaterPacket(inputs);
  const bytes = RP.raterPacketBytes(pkt);
  ok(pkt.item_count === 12 && pkt.items.every((it, i) => it.position === i + 1) && pkt.items.map((x) => x.order_key).join() === RO.presentationOrder(rec.record_sha256, 'rater-1', items).map((x) => x.order_key).join(), 'rater packet: all items, ordered by the approved derivation, positions 1..n');
  ok(pkt.items.every((it) => Object.keys(it).sort().join() === ['candidate_id', 'cpg_source_urls', 'cpg_value', 'field', 'order_key', 'position', 'reference_record'].sort().join()), 'rater packet: only permitted information (no class, split, pilot, rater or tally fields)');
  ok(pkt.packet_sha256 === sha256(canonicalJson(Object.fromEntries(Object.entries(pkt).filter(([k]) => k !== 'packet_sha256')))), 'rater packet: packet_sha256 over the canonical body');
  const v = RP.verifyRaterPacket(bytes, { ...inputs, evaluationItems: [...items].reverse() });
  ok(v.identical && v.packet_sha256 === sha256(bytes), 'rater packet: independent rebuild (inputs in any order) is BYTE-IDENTICAL');
  ok(!RP.verifyRaterPacket(Buffer.from(bytes.toString('utf8').replace('"position":1', '"position":2')), inputs).identical, 'rater packet: altered bytes refused');
  ok(!RP.verifyRaterPacket(bytes, { ...inputs, recordSha: REC('other').record_sha256 }).identical, 'rater packet: substituted sampling record (order) refused');
  ok(!RP.verifyRaterPacket(bytes, { ...inputs, label: 'rater-2' }).identical, 'rater packet: another rater\'s order refused');
  ok(!RP.verifyRaterPacket(bytes, { ...inputs, evaluationItems: items.map((x, i) => (i === 0 ? { ...x, cpg_value: 'altered' } : x)) }).identical, 'rater packet: altered CPG value refused');
  throws(() => RP.buildRaterPacket({ ...inputs, evaluationItems: [{ ...items[0], expected_outcome_class: 'fill-expected' }, ...items.slice(1)] }), 'rater packet: an item carrying class information refused');
  throws(() => RP.buildRaterPacket({ ...inputs, evaluationItems: [{ ...items[0], reference_record: { ...items[0].reference_record, stratum: 'x' } }, ...items.slice(1)] }), 'rater packet: an altered reference record refused');
  throws(() => RP.buildRaterPacket({ ...inputs, evaluationItems: [{ ...items[0], reference_record: refRow('SYN-9999', 'founded_year') }, ...items.slice(1)] }), 'rater packet: a reference record belonging to another observation refused');
  throws(() => RP.buildRaterPacket({ ...inputs, label: 'rating-adjudicator' }), 'rater packet: only rater labels (the rating adjudicator\'s ordering label is refused)');
  throws(() => RP.buildRaterPacket({ ...inputs, label: 'reference-adjudicator-record-1' }), 'rater packet: only rater labels (an adjudicator assignment label is refused)');
  ok(pkt.cited_url_rule === RP.CITED_URL_RULE && RP.CITED_URL_RULE === 'cpg-u1-cited-urls/field-evidence-union/v1', 'rater packet records the approved §12.3 cited-URL rule id');
  ok(!RP.verifyRaterPacket(Buffer.from(bytes.toString('utf8').replace('field-evidence-union/v1', 'other-rule/v1')), inputs).identical, 'rater packet: a packet claiming another cited-URL rule refused');
  throws(() => RP.buildRaterPacket({ ...inputs, evaluationItems: [{ ...items[0], cpg_source_urls: ['https://synthetic-0.example/a', 'https://synthetic-0.example/a'] }, ...items.slice(1)] }), 'rater packet: an item whose cited URLs contain a duplicate refused (§12.3 removes exact duplicates)');
  throws(() => RP.buildRaterPacket({ ...inputs, evaluationItems: [{ ...items[0], cpg_source_urls: ['http://synthetic-0.example/a'] }, ...items.slice(1)] }), 'rater packet: an item with a non-https cited URL refused');
}

// ── 12i. CPG-045: §12.3 Rule A — cited source URLs = field evidence URL union ─────────────────────────
// The responses below have the shape lookupGroundedCompanyFacts emits (facts + grounding.facts[<key>] with
// status/effectiveValue/prefilled/evidence[{value, sourceName, sourceUrl, identity, identityReason, authority,
// providerFamily}]). test/adapter_conformance.mjs runs the same extraction over a REAL response from the frozen
// resolver, so this section is not the only check of the contract.
{
  const ev = (value, sourceUrl, o = {}) => ({ value, sourceName: o.sourceName ?? 'SYNTHETIC registry', sourceUrl, identity: o.identity ?? 'DECISIVE', identityReason: o.identityReason ?? 'synthetic', authority: o.authority ?? 'authoritative', providerFamily: o.providerFamily ?? 'synthetic-family' });
  const view = (field, effectiveValue, evidence, status = 'PUBLICLY_VERIFIED') => ({ field, status, evidenceState: 'EFFECTIVE', effectiveValue, prefilled: status === 'PUBLICLY_VERIFIED' && effectiveValue !== null, evidence });
  const response = (views, extra = {}) => JSON.stringify({
    facts: { founded_year: views.founded_year?.prefilled ? views.founded_year.effectiveValue : null, team_size: views.team_size?.prefilled ? views.team_size.effectiveValue : null, revenue_range: views.revenue_range?.prefilled ? views.revenue_range.effectiveValue : null },
    matched_label: 'SYNTHETIC-CO', source: 'cpg_grounding',
    grounding: {
      domain: 'synthetic-1.example', asOf: '2026-09-01T00:00:00Z',
      facts: { founded_year: views.founded_year ?? view('founded_year', null, [], 'UNVERIFIED'), team_size: views.team_size ?? view('employee_count', null, [], 'UNVERIFIED'), revenue_range: views.revenue_range ?? view('revenue_range', null, [], 'UNVERIFIED') },
      wikidata: { label: 'SYNTHETIC-CO', url: 'https://synthetic-wikidata.example/entity/Q1', identity: 'DECISIVE', identityReason: 'synthetic' },
      registryIdentities: [{ provider: 'synthetic_registry', registry: 'SYNTHETIC', scheme: 'LEI', identifier: 'SYNTH', jurisdiction: 'XX', legalName: 'SYNTHETIC-CO', registryStatus: 'active', role: 'subject', verified: true, establishedBy: 'registry_record' }],
      registryUnavailable: [{ provider: 'synthetic_other', identifier: 'SYNTH', outcome: 'inaccessible', failure: null }],
      registryAmbiguity: [], unavailableSources: [{ sourceId: 'synthetic-source', state: 'UNAVAILABLE', reason: 'https://synthetic-unavailable.example/status' }],
      message: { basis: null, identityNote: null, notPrefilled: [], nothingPrefilled: 'synthetic' }, ...extra,
    },
  });
  const rec = (raw) => AR.buildArchiveRecord({ study_id: 'CPG-U1-2026-01', registration_id: 'SYNTHETIC-REG', stage: 'held-out', run_id: 'ho-1', candidate_id: 'SYN-0401', input: { companyId: 'CPG-U1-FIXTURE', companyName: 'SYNTHETIC-CO', websiteUrl: 'https://synthetic-1.example', linkedinUrl: null, asOf: '2026-09-01T00:00:00Z' }, execution: synthExecution({}, { raw_response: raw }) });
  const cited = (raw, field = 'founded_year') => RP.extractCitedUrls(rec(raw), field);

  // A. one evidence record, one URL
  ok(canonicalJson(cited(response({ founded_year: view('founded_year', '1999', [ev('1999', 'https://synthetic-a.example/about')]) }))) === canonicalJson(['https://synthetic-a.example/about']), 'RULE A (A): one evidence record → its source URL');
  // B. several records, several URLs, response order preserved
  const many = response({ founded_year: view('founded_year', '1999', [ev('1999', 'https://synthetic-b1.example/1'), ev('1999', 'https://synthetic-b2.example/2'), ev('1999', 'https://synthetic-b3.example/3')]) });
  ok(canonicalJson(cited(many)) === canonicalJson(['https://synthetic-b1.example/1', 'https://synthetic-b2.example/2', 'https://synthetic-b3.example/3']), 'RULE A (B, E): every record contributes, in response order');
  // C. exact duplicates removed at first occurrence
  ok(canonicalJson(cited(response({ founded_year: view('founded_year', '1999', [ev('1999', 'https://synthetic-c.example/x'), ev('1999', 'https://synthetic-c.example/y'), ev('1999', 'https://synthetic-c.example/x')]) }))) === canonicalJson(['https://synthetic-c.example/x', 'https://synthetic-c.example/y']), 'RULE A (C): exact duplicate URLs removed, first occurrence kept');
  ok(canonicalJson(cited(response({ founded_year: view('founded_year', '1999', [ev('1999', 'https://synthetic-c.example/x'), ev('1999', 'https://synthetic-c.example/x?q=1'), ev('1999', 'https://synthetic-c.example/X')]) }))) === canonicalJson(['https://synthetic-c.example/x', 'https://synthetic-c.example/x?q=1', 'https://synthetic-c.example/X']), 'RULE A (C): URLs differing in any byte are distinct — no normalisation or rewriting');
  // D. conflicting records: the disagreeing record's URL is included too
  const conflict = response({ founded_year: view('founded_year', '1999', [ev('1999', 'https://synthetic-d-agree.example/a'), ev('2001', 'https://synthetic-d-disagree.example/b'), ev('', 'https://synthetic-d-empty.example/c')], 'CONFLICTING') });
  ok(canonicalJson(cited(conflict)) === canonicalJson(['https://synthetic-d-agree.example/a', 'https://synthetic-d-disagree.example/b', 'https://synthetic-d-empty.example/c']), 'RULE A (D): records whose value disagrees with the reported value are included — no value filtering');
  // F. malformed / non-URL sourceUrl refused; null contributes nothing, and nothing is invented
  for (const bad of ['http://synthetic-f.example/insecure', 'not a url', 'ftp://synthetic-f.example/x', '', 'javascript:alert(1)', 'https://', 42, {}, []]) {
    throws(() => cited(response({ founded_year: view('founded_year', '1999', [ev('1999', bad)]) })), `RULE A (F): sourceUrl ${JSON.stringify(bad)} refused, never repaired or invented`);
  }
  { let msg = ''; try { cited(response({ founded_year: { field: 'founded_year', status: 'PUBLICLY_VERIFIED', evidenceState: 'EFFECTIVE', effectiveValue: '1999', prefilled: true, evidence: [{ value: '1999', sourceName: 'x' }] } })); } catch (e) { msg = e.message; }
    ok(msg.includes('has no sourceUrl field'), 'RULE A (F): an evidence record without a sourceUrl field is refused AS SUCH (the shape is checked, not guessed from the URL check)'); }
  ok(canonicalJson(cited(response({ founded_year: view('founded_year', '1999', [ev('1999', null), ev('1999', 'https://synthetic-f.example/ok'), ev('1999', null)]) }))) === canonicalJson(['https://synthetic-f.example/ok']), 'RULE A: a record whose sourceUrl is null contributes no URL (none invented)');
  // G. URLs elsewhere in the response or the archive are never cited
  const otherField = response({ founded_year: view('founded_year', '1999', [ev('1999', 'https://synthetic-g-field.example/a')]), team_size: view('employee_count', '120', [ev('120', 'https://synthetic-g-other-field.example/b')]) });
  const citedG = cited(otherField);
  const text = otherField + canonicalJson(rec(otherField).replay);
  ok(canonicalJson(citedG) === canonicalJson(['https://synthetic-g-field.example/a'])
    && ['https://synthetic-g-other-field.example/b', 'https://synthetic-wikidata.example/entity/Q1', 'https://synthetic-unavailable.example/status', 'https://synthetic.example/'].every((u) => text.includes(u) && !citedG.includes(u)), 'RULE A (G): another field\'s evidence, the Wikidata entity URL, unavailable-source URLs and replayed request URLs are NOT cited URLs');
  ok(canonicalJson(RP.extractCitedUrls(rec(otherField), 'employee_count')) === canonicalJson(['https://synthetic-g-other-field.example/b']), 'RULE A: the field asked for is the field read (employee_count → team_size view)');
  // H. empty evidence, and an observation with no response
  ok(canonicalJson(cited(response({ founded_year: view('founded_year', null, [], 'UNVERIFIED') }))) === canonicalJson([]), 'RULE A (H): a field with no evidence has an empty cited-URL set');
  { const invalid = AR.buildArchiveRecord({ study_id: 'CPG-U1-2026-01', registration_id: 'SYNTHETIC-REG', stage: 'held-out', run_id: 'ho-1', candidate_id: 'SYN-0402', input: { companyId: 'CPG-U1-FIXTURE', companyName: 'SYNTHETIC-CO', websiteUrl: 'https://synthetic-1.example', linkedinUrl: null, asOf: '2026-09-01T00:00:00Z' }, execution: { executor_error: 'timeout' } });
    ok(canonicalJson(RP.extractCitedUrls(invalid, 'founded_year')) === canonicalJson([]), 'RULE A (H): an INVALID observation (no response) has no cited URLs'); }
  throws(() => cited(JSON.stringify({ facts: {}, grounding: { facts: {} } })), 'RULE A: a response carrying no grounding view for the field refused (never treated as "no URLs")');
  // I. byte-identical output for identical evidence input
  ok(canonicalJson(cited(many)) === canonicalJson(cited(many)) && canonicalJson(cited(many)) === canonicalJson(RP.extractCitedUrls(rec(many), 'founded_year')), 'RULE A (I): identical evidence input → byte-identical cited-URL output');
  // TASK 6: structural anti-selection — the extraction cannot see, and cannot react to, anything but sourceUrl
  {
    const base = [ev('1999', 'https://synthetic-anti-1.example/a'), ev('2001', 'https://synthetic-anti-2.example/b'), ev('1999', 'https://synthetic-anti-3.example/c')];
    const want = ['https://synthetic-anti-1.example/a', 'https://synthetic-anti-2.example/b', 'https://synthetic-anti-3.example/c'];
    const flips = [
      ['authority', (e, i) => ({ ...e, authority: i === 1 ? 'authoritative' : 'unrated' })],
      ['identity', (e, i) => ({ ...e, identity: i === 1 ? 'DECISIVE' : 'NAME_ONLY', identityReason: 'flipped' })],
      ['sourceName', (e, i) => ({ ...e, sourceName: i === 1 ? 'SYNTHETIC favourable source' : 'SYNTHETIC unfavourable source' })],
      ['providerFamily', (e, i) => ({ ...e, providerFamily: i === 1 ? 'synthetic-preferred' : 'synthetic-other' })],
      ['value agreement', (e) => ({ ...e, value: e.value === '1999' ? '2001' : '1999' })],
    ];
    let stable = true;
    for (const [, flip] of flips) {
      const flipped = response({ founded_year: view('founded_year', '1999', base.map(flip)) });
      if (canonicalJson(cited(flipped)) !== canonicalJson(want)) stable = false;
    }
    // the reported value itself, and the field status, also cannot change the set
    for (const [status, effective] of [['PUBLICLY_VERIFIED', '1999'], ['CONFLICTING', '2001'], ['PUBLICLY_REPORTED', '1999'], ['UNVERIFIED', null]]) {
      if (canonicalJson(cited(response({ founded_year: view('founded_year', effective, base, status) }))) !== canonicalJson(want)) stable = false;
    }
    ok(stable, 'ANTI-SELECTION (structural): flipping authority, identity, source name, provider family, value agreement, field status or the reported value leaves the cited-URL set unchanged — favourable URLs cannot be retained selectively');
    // reordering the evidence records reorders the SET (response order is the rule) but never drops or adds a URL
    const reversed = response({ founded_year: view('founded_year', '1999', [...base].reverse()) });
    ok(canonicalJson([...cited(reversed)].sort()) === canonicalJson([...want].sort()) && canonicalJson(cited(reversed)) === canonicalJson([...want].reverse()), 'ANTI-SELECTION: reordering evidence reorders the set deterministically and loses no URL');
  }
  // J. evaluation items derive cited URLs with no undecided rule left
  {
    const refRow = (id, f) => ({ ...Object.fromEntries(REFERENCE_COLUMNS.map((c) => [c, 'x'])), candidate_id: id, field: f });
    const r1 = rec(response({ founded_year: view('founded_year', '1999', [ev('1999', 'https://synthetic-j1.example/a'), ev('1999', 'https://synthetic-j1.example/a'), ev('2001', 'https://synthetic-j2.example/b')]), team_size: view('employee_count', '120', [ev('120', 'https://synthetic-j3.example/c')]) }));
    const refs = FIELDS3.map((f) => refRow('SYN-0401', f));
    const its = RP.evaluationItemsFromArchive([r1], refs);
    ok(its.length === 3 && canonicalJson(its.find((x) => x.field === 'founded_year').cpg_source_urls) === canonicalJson(['https://synthetic-j1.example/a', 'https://synthetic-j2.example/b'])
      && canonicalJson(its.find((x) => x.field === 'employee_count').cpg_source_urls) === canonicalJson(['https://synthetic-j3.example/c'])
      && canonicalJson(its.find((x) => x.field === 'revenue_range').cpg_source_urls) === canonicalJson([]), 'RULE A (J): evaluation items carry the Rule-A set per field — no CITED_URL_RULE_UNDECIDED anywhere');
    ok(its.every((x) => x.cpg_value === AR.cpgValue(r1, x.field)) && its.find((x) => x.field === 'founded_year').cpg_value === '1999', 'evaluation items pair each Rule-A URL set with the prefilled CPG value for the same field');
    // TASK 5: field evidence → Rule-A set → evaluation item → rater packet is lossless and deterministic
    const sealedRec = REC('rule-a');
    const packet = RP.buildRaterPacket({ label: 'rater-1', recordSha: sealedRec.record_sha256, evaluationItems: its });
    const inPacket = packet.items.find((x) => x.field === 'founded_year');
    ok(packet.item_count === 3 && canonicalJson(inPacket.cpg_source_urls) === canonicalJson(RP.extractCitedUrls(r1, 'founded_year'))
      && packet.items.every((x) => canonicalJson(x.cpg_source_urls) === canonicalJson(RP.extractCitedUrls(r1, x.field))), 'CHAIN: field evidence → Rule-A set → evaluation item → rater packet is lossless for every qualifying URL');
    ok(RP.verifyRaterPacket(RP.raterPacketBytes(packet), { label: 'rater-1', recordSha: sealedRec.record_sha256, evaluationItems: its }).identical, 'CHAIN: the packet rebuilds byte-identically from the same archive-derived items');
    { const forged = JSON.parse(JSON.stringify(packet)); const i = forged.items.findIndex((x) => x.field === 'founded_year'); forged.items[i].cpg_source_urls = ['https://synthetic-j1.example/a'];
      ok(!RP.verifyRaterPacket(Buffer.from(canonicalJson(forged), 'utf8'), { label: 'rater-1', recordSha: sealedRec.record_sha256, evaluationItems: its }).identical, 'ANTI-SELECTION: a packet with an unfavourable URL removed by hand is refused by the rebuild'); }
  }
}

// ── 12j. CPG-048: §7.1 evaluated software identity (U1 evaluation tree) ───────────────────────────────
// Synthetic throwaway git repositories only: this section never touches the real resolver clone except through
// the read-only identity computation at the end (which runs only when the real protocol is present next to the tooling).
{
  const dir = mkdtempSync(join(tmpdir(), 'cpg048-evaltree-'));
  const g = (repo, ...args) => execFileSync('git', ['-C', repo, '-c', 'user.name=SYNTHETIC', '-c', 'user.email=synthetic@synthetic.example', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' }).trim();
  const mkRepo = (name, files) => {
    const repo = join(dir, name); mkdirSync(repo, { recursive: true });
    execFileSync('git', ['-C', repo, 'init', '--quiet']);
    for (const [p, body] of Object.entries(files)) { mkdirSync(dirname(join(repo, p)), { recursive: true }); writeFileSync(join(repo, p), body); }
    g(repo, 'add', '-A'); g(repo, 'commit', '--quiet', '-m', 'synthetic');
    return repo;
  };
  // a protocol stub stating §7.1 exactly as the real protocol does, for a given identity
  const stub = (id, o = {}) => [
    '## 7. Treatment definition', '', '### 7.1 Evaluated software identity [NORMATIVE]', '',
    `The evaluated resolver is the repository content at commit \`${o.commit ?? id.commit}\`.`, '',
    ...(o.omitTree ? [] : [`- its git tree object id \`${o.tree ?? id.tree}\`;`]),
    ...(o.omitAggregate ? [] : [`- its content manifest aggregate (domain \`${ET.EVALUATION_TREE_DOMAIN}\`): \`${o.aggregate ?? id.aggregate}\` (${o.files ?? id.files} files).`]),
    ...(o.omitDomain ? [`- domain omitted on purpose`] : []),
    '', '## 8. Next section', '',
  ].join('\n');

  try {
    const repoA = mkRepo('A', { 'src/a.ts': 'export const a = 1;\n', 'README.md': 'SYNTHETIC A\n' });
    const idA = ET.repoIdentity(repoA);
    ok(/^[0-9a-f]{40}$/.test(idA.commit) && /^[0-9a-f]{40}$/.test(idA.tree) && /^[0-9a-f]{64}$/.test(idA.aggregate) && idA.files === 2 && idA.clean, 'evaluation tree: identity = commit + git tree object + sha256 content manifest aggregate over tracked files');
    ok(ET.treeManifest(repoA).text.split('\n').filter(Boolean).every((l) => /^[0-9a-f]{64} {2}\S/.test(l)) && ET.treeManifest(repoA).aggregate === sha256(ET.treeManifest(repoA).text), 'evaluation tree: manifest = "<sha256>  <path>" lines, aggregate = sha256 of that text (§24 construction)');

    // 1. the declared identity verifies against the content it describes
    const vA = ET.verifyEvaluationTree({ repoDir: repoA, protocolText: stub(idA) });
    ok(vA.ok && vA.refusals.length === 0 && vA.notes.length === 0, 'TASK6-1: a clone whose content IS the declared evaluation tree verifies');

    // 2. an incorrect declared treatment identity is refused
    const wrongAgg = ET.verifyEvaluationTree({ repoDir: repoA, protocolText: stub(idA, { aggregate: H('other aggregate') }) });
    ok(!wrongAgg.ok && wrongAgg.refusals.some((r) => r.code === 'CONTENT_MISMATCH'), 'TASK6-1: an incorrect declared content aggregate is refused (CONTENT_MISMATCH)');
    const wrongCount = ET.verifyEvaluationTree({ repoDir: repoA, protocolText: stub(idA, { files: idA.files + 1 }) });
    ok(!wrongCount.ok && wrongCount.refusals.some((r) => r.code === 'FILE_COUNT_MISMATCH'), 'TASK6-4: a declared file count that does not match the tracked tree is refused');

    // 3. silent substitution of ANOTHER tree (e.g. a later mainline state) is refused
    const repoB = mkRepo('B', { 'src/a.ts': 'export const a = 2; // later mainline change\n', 'README.md': 'SYNTHETIC A\n' });
    const vB = ET.verifyEvaluationTree({ repoDir: repoB, protocolText: stub(idA) });
    ok(!vB.ok && vB.refusals.some((r) => r.code === 'CONTENT_MISMATCH'), 'TASK6-2: a DIFFERENT tree presented as the treatment is refused — later mainline content never becomes the evaluated software');
    ok(ET.repoIdentity(repoB).aggregate !== idA.aggregate, 'TASK6-6: changing one byte of evaluated content changes the content identity');

    // 4. a rewritten history with IDENTICAL content still verifies (content is authoritative, §7.1)
    g(repoA, 'commit', '--amend', '--quiet', '-m', 'synthetic (history rewritten)', '--date', 'Wed, 01 Jan 2025 00:00:00 +0000');
    const idRewritten = ET.repoIdentity(repoA);
    const vRewritten = ET.verifyEvaluationTree({ repoDir: repoA, protocolText: stub(idA) });
    ok(idRewritten.commit !== idA.commit && idRewritten.tree === idA.tree && idRewritten.aggregate === idA.aggregate, 'TASK6-5: a history rewrite changes the commit id but not the content');
    ok(vRewritten.ok && vRewritten.notes.some((n) => n.code === 'COMMIT_ID_DIFFERS') && vRewritten.refusals.length === 0, 'TASK6-5: identical content under a rewritten history verifies, with the differing commit id recorded as a note');

    // 5. the instrument is never part of the treatment identity
    const repoWithInstrument = mkRepo('C', { 'src/a.ts': 'export const a = 1;\n', 'README.md': 'SYNTHETIC A\n', 'research/cpg-u1/tooling/cpg_u1_data.mjs': '// instrument\n' });
    const vInstr = ET.verifyEvaluationTree({ repoDir: repoWithInstrument, protocolText: stub(ET.repoIdentity(repoWithInstrument)) });
    ok(!vInstr.ok && vInstr.refusals.some((r) => r.code === 'INSTRUMENT_IN_TREATMENT'), 'TASK6-3: a clone whose tracked files include research/cpg-u1 is refused — the instrument is pinned separately (§19.1), never as treatment');
    ok(ET.repoIdentity(repoA).instrument_paths.length === 0 && ET.INSTRUMENT_PATH === 'research/cpg-u1', 'TASK6-3: the treatment tree contains no instrument path');

    // 6. an incomplete §7.1 declaration is refused rather than guessed
    for (const [o, what] of [[{ omitTree: true }, 'git tree object id'], [{ omitAggregate: true }, 'content manifest aggregate'], [{ omitDomain: true, omitAggregate: true }, 'domain']]) {
      const v = ET.verifyEvaluationTree({ repoDir: repoA, protocolText: stub(idA, o) });
      ok(!v.ok && v.refusals.some((r) => r.code === 'PROTOCOL_IDENTITY_INCOMPLETE'), `TASK6-4: a §7.1 declaration without the ${what} is refused`);
    }
    ok(!ET.verifyEvaluationTree({ repoDir: repoA, protocolText: '## 7. Treatment definition\n\nno 7.1 here\n\n## 8. x\n' }).ok, 'TASK6-4: a protocol without §7.1 cannot certify any treatment');
    { const noDomain = stub(idA).replace(ET.EVALUATION_TREE_DOMAIN, 'some-other-domain/v9');
      const v = ET.verifyEvaluationTree({ repoDir: repoA, protocolText: noDomain });
      ok(!v.ok && v.refusals.some((r) => r.code === 'PROTOCOL_IDENTITY_INCOMPLETE'), 'TASK6-4: a §7.1 that states the three values but NOT the cpg-u1-evaluation-tree/v1 domain is refused'); }

    // 7. a dirty clone is not the committed content
    writeFileSync(join(repoA, 'src/a.ts'), 'export const a = 99;\n');
    const vDirty = ET.verifyEvaluationTree({ repoDir: repoA, protocolText: stub(idA) });
    ok(!vDirty.ok && vDirty.refusals.some((r) => r.code === 'WORKING_TREE_DIRTY') && vDirty.refusals.some((r) => r.code === 'CONTENT_MISMATCH'), 'evaluation tree: a clone with working-tree changes is refused (content is not the committed content)');
  } finally { rmSync(dir, { recursive: true, force: true }); }

  // 8. the REAL declaration against the REAL frozen clone, when the protocol sits next to the tooling (integrated layout)
  const realProtocol = join(HERE, '..', '..', 'CPG_U1_PROTOCOL_004.md');
  if (existsSync(realProtocol)) {
    const text = readFileSync(realProtocol, 'utf8');
    const d = ET.declaredIdentity(text);
    const v = ET.verifyEvaluationTree({ repoDir: CLEAN_CLONE, protocolText: text });
    ok(d.commit === FROZEN_SHA, 'REAL §7.1: the declared treatment commit is the frozen resolver SHA (the pin is unchanged)');
    ok(v.ok && v.refusals.length === 0 && v.notes.length === 0, 'REAL §7.1: the frozen resolver clone IS the declared U1 evaluation tree (commit, tree object and content manifest aggregate all match)');
    console.log(`evaluation tree: declared commit ${d.commit}, tree ${d.tree}, aggregate ${d.aggregate} (${d.files} files) — verified against ${CLEAN_CLONE}`);
  } else {
    console.log('evaluation tree: real §7.1 check skipped (protocol not present beside the tooling in this layout)');
  }
}

// ── 14. end-to-end CLI: registration → complete frame → commitment → chain + drand → draws → seal → authorization ──
const work = mkdtempSync(join(tmpdir(), 'cpg041-selftest-'));
try {
  const P = (f) => join(work, f);
  const wj = (f, x) => writeFileSync(P(f), JSON.stringify(x, null, 2));
  const rj = (f) => JSON.parse(readFileSync(P(f), 'utf8'));
  serial = 1000;
  const bigFrame = [...frame, ...Array.from({ length: 72 }, () => row('fill-expected')), ...Array.from({ length: 32 }, () => row('abstention-expected')), ...Array.from({ length: 20 }, () => row('identity-hazard'))];
  writeFileSync(P('frame.csv'), toCsv(FRAME_COLUMNS, bigFrame));
  writeFileSync(P('frame_small.csv'), toCsv(FRAME_COLUMNS, frame));
  ok(run(['frame', '--frame', P('frame.csv')], { expectCode: 1 }).includes('SYNTHETIC row'), 'CLI frame rejects synthetic without flag');
  ok(run(['frame', '--frame', P('frame.csv'), '--allow-synthetic']).includes('ADMISSIBLE'), 'CLI frame ok');

  const regPath = P('registry.json');
  writeFileSync(regPath, JSON.stringify({ entries: [{ id: 'SYN-REG-1', names: ['SYNTHETIC-CO-7'], domains: [], basis: ['synthetic'], evidence: 'synthetic' }] }));
  const scanFor = (fr, extraHit, regFile = regPath, regName = 'SYNTHETIC-CO-7') => ({
    tool: 'synthetic', repo_sha: FROZEN_SHA, frame_hash: hashRecords(fr, 'candidate_id'), registry_sha256: sha256(readFileSync(regFile)),
    results: fr.map((c) => ({ candidate_id: c.candidate_id,
      repository_hits: [].concat(extraHit).includes(c.candidate_id) ? [{ kind: 'name', value: c.company_name, line: 1, file: 'backend/tests/x.test.ts', scope: 'TEST' }] : [],
      registry_matches: [].concat(regName).includes(c.company_name) ? [{ entry_id: 'SYN-REG-1', matched: 'name', basis: ['synthetic'] }] : [] })),
  });
  writeFileSync(P('scan.json'), JSON.stringify(scanFor(bigFrame, 'SYN-0002')));
  writeFileSync(P('scan_small.json'), JSON.stringify(scanFor(frame, 'SYN-0002')));

  // registration template: every human prerequisite UNASSIGNED
  run(['registration-fields', '--protocol', PROTOCOL, '--registry', regPath, '--out', P('reg_template.json')]);
  const tpl = rj('reg_template.json');
  ok(tpl.tooling_aggregate_sha256 === toolingManifest(join(HERE, '..')).aggregate && tpl.protocol_sha256 === sha256(readFileSync(PROTOCOL)) && tpl.registry_sha256 === sha256(readFileSync(regPath)), 'CLI registration-fields binds protocol, tooling aggregate and registry');
  ok(run(['check-funding-prerequisites', '--registration', P('reg_template.json')], { expectCode: 4 }).includes('Bitcoin wallet-key custodian'), 'CLI funding BLOCKED (exit 4) until the key custodian is named');
  ok(run(['registration-fields', '--protocol', PROTOCOL, '--registry', regPath, '--out', P('reg_template.json')], { expectCode: 1 }).includes('write-once'), 'CLI registration template write-once');

  // synthetic chain, phase 1: funding outputs and checkpoint
  const chain = new S.SynthChain(S0);
  const fund = (s) => S.buildTx({ inputs: [{ txid: S.syntheticTxid(`e2e-fund-in-${s}`), vout: 0 }], outputs: [{ value: 20000, script: S.p2wpkh(`e2e-slot-${s}`) }, { value: 5000, script: S.p2wpkh(`e2e-change-${s}`) }] });
  const fundDev = fund('dev'); const fundHo = fund('ho');
  const O = { development: `${B.parseTransaction(fundDev).txid}:0`, 'held-out': `${B.parseTransaction(fundHo).txid}:0` };
  for (let h = S0; h <= S0 + 10; h++) chain.add(timeAt(h), h === S0 + 2 ? [fundDev] : h === S0 + 3 ? [fundHo] : []);
  const reg = filledRegistration(tpl, { outpoints: O, checkpoint: { height: S0 + 10, hash: chain.block(S0 + 10).hash }, ts: isoOf(timeAt(S0 + 10) + 300) });
  wj('registration.json', reg);
  wj('identity_regs.json', [reg]);
  ok(run(['check-funding-prerequisites', '--registration', P('registration.json'), '--allow-synthetic']).includes('funding prerequisites present'), 'CLI funding prerequisites satisfied once named (test mode)');
  ok(run(['check-funding-prerequisites', '--registration', P('registration.json')], { expectCode: 1 }).includes('SYNTHETIC'), 'CLI synthetic identities refused outside test mode');
  const regArgs = ['--registration', P('registration.json'), '--identity-registrations', P('identity_regs.json'), '--protocol', PROTOCOL, '--allow-synthetic'];
  const withReg = (args, from, to) => args.map((x) => (x === from ? to : x));
  ok(run(['verify-registration', ...regArgs, '--registry', regPath]).includes('authoritative'), 'CLI verify-registration: complete and authoritative');
  wj('reg_noid.json', { ...reg, persistent_identifier: { type: 'UNASSIGNED', value: 'UNASSIGNED' } });
  ok(run(['verify-registration', ...withReg(regArgs, P('registration.json'), P('reg_noid.json')), '--registry', regPath], { expectCode: 4 }).includes('Persistent identifier'), 'CLI missing persistent identifier: BLOCKED exit 4');
  wj('reg_othertool.json', { ...reg, tooling_aggregate_sha256: H('other tooling') });
  wj('ids_othertool.json', [{ ...reg, tooling_aggregate_sha256: H('other tooling') }]);
  ok(run(['verify-registration', ...withReg(withReg(regArgs, P('registration.json'), P('reg_othertool.json')), P('identity_regs.json'), P('ids_othertool.json')), '--registry', regPath], { expectCode: 1 }).includes('not the registered tooling'), 'CLI tooling aggregate mismatch: abort');
  ok(run(['verify-registration', ...withReg(regArgs, PROTOCOL, P('frame.csv')), '--registry', regPath], { expectCode: 1 }).includes('protocol_sha256'), 'CLI protocol hash mismatch: abort');
  wj('ids_dup.json', [reg, { ...reg, registration_id: 'SYNTHETIC-REG-DUPLICATE', registration_timestamp: isoOf(timeAt(S0 + 10) + 900), outpoints: { ...O, 'held-out': `${H('another-slot')}:0` } }]);
  ok(run(['verify-registration', ...withReg(regArgs, P('identity_regs.json'), P('ids_dup.json')), '--registry', regPath], { expectCode: 6 }).includes('duplicate'), 'CLI duplicate registration with different outpoints: study VOID exit 6');

  // development commitment payload
  const base = ['--frame', P('frame.csv'), '--scan', P('scan.json'), '--registry', regPath, ...regArgs];
  ok(run(['check-frame-sufficiency', '--frame', P('frame_small.csv'), '--scan', P('scan_small.json'), '--registry', regPath, '--allow-synthetic'], { expectCode: 1 }).includes('FRAME_INSUFFICIENT'), 'T-3 CLI: 100-row frame (58/24/16 eligible) is INSUFFICIENT');
  ok(run(['check-frame-sufficiency', '--frame', P('frame.csv'), '--scan', P('scan.json'), '--registry', regPath, '--allow-synthetic']).includes('frame sufficient'), 'T-3 CLI: complete frame (130/56/36 eligible) is sufficient');
  ok(run(['commitment-payload', '--stage', 'development', ...withReg(withReg(base, P('frame.csv'), P('frame_small.csv')), P('scan.json'), P('scan_small.json')), '--out', P('payload_small.json')], { expectCode: 1 }).includes('FRAME_INSUFFICIENT') && !existsSync(P('payload_small.json')), 'T-3: no development commitment payload for an insufficient frame (fail closed)');
  const payOut = run(['commitment-payload', '--stage', 'development', ...base, '--out', P('payload_dev.json')]);
  const payDev = rj('payload_dev.json');
  const devDigest = CM.payloadDigest(payDev);
  ok(payDev.frame_hash === hashRecords(bigFrame, 'candidate_id') && payDev.outpoint === O.development && payDev.registration_id === reg.registration_id, 'CLI development payload binds frame, outpoint, registration');
  ok(payOut.includes(`payload_digest: ${devDigest}`) && payOut.includes(`op_return_script: ${B.encodeCommitmentScript('development', devDigest).toString('hex')}`), 'CLI prints digest and the exact OP_RETURN script');

  // phase 2: the (synthetic) spend of O_dev, then K + D blocks
  const devTx = S.buildTx({ label: 'e2e-dev', witness: true, inputs: [{ txid: O.development.slice(0, 64), vout: 0 }], outputs: [{ value: 0, script: B.encodeCommitmentScript('development', devDigest) }, { value: 15000, script: S.p2wpkh('e2e-dev-change') }] });
  for (let h = S0 + 11; h <= S0 + 40; h++) chain.add(timeAt(h), h === S0 + 20 ? [devTx] : []);
  let payHo = null; let hoTx = null;
  const evidence = (tip, beacons) => ({
    schema: 'cpg-u1-sampling-evidence/v1', network: 'synthetic-test',
    headers: chain.archive('synthetic-source-A', tip), headers_crosscheck: chain.archive('synthetic-source-B', tip),
    funding: { development: chain.proof(fundDev), 'held-out': chain.proof(fundHo) },
    commitments: { development: { payload: payDev, ...chain.proof(devTx) }, 'held-out': hoTx ? { payload: payHo, ...chain.proof(hoTx) } : null },
    drand: { chain_info: DRAND_INFO, beacons },
  });
  wj('ev_dev_nodrand.json', evidence(S0 + 40, []));
  wj('ev_dev.json', evidence(S0 + 40, [ROUND[1]]));
  const drawDev = (ev, out, extra = []) => ['draw-development', ...base, '--evidence', P(ev), '--screened-by', 'synthetic-screener', '--out', P(out), ...extra];
  ok(run(drawDev('ev_dev_nodrand.json', 'devW'), { expectCode: 5 }).includes('WAITING_DRAND_ROUND') && !existsSync(P('devW')), 'CLI draw refused while the drand round is absent (exit 5), nothing written');
  ok(run(['verify-sampling', ...regArgs, '--evidence', P('ev_dev.json'), '--stage', 'development']).includes('"state": "FINAL"'), 'CLI verify-sampling development FINAL');
  ok(run(['verify-commitment', ...regArgs, '--evidence', P('ev_dev.json'), '--stage', 'development']).includes('commitment valid'), 'CLI verify-commitment');
  const libDev = SA.evaluateStage(reg, rj('ev_dev.json'), 'development', { allowSynthetic: true });
  const ds = run(['derive-seed', ...regArgs, '--evidence', P('ev_dev.json'), '--stage', 'development']);
  ok(ds.includes(libDev.record.seed_fingerprint) && !ds.includes(libDev.seed), 'CLI derive-seed prints the fingerprint and derivation, never the seed');
  ok(run(['draw-development', ...base, '--seed', libDev.seed, '--evidence', P('ev_dev_nodrand.json'), '--screened-by', 'x', '--out', P('devS')], { expectCode: 5 }) && !existsSync(P('devS')), 'CLI ignores a caller-supplied seed: still waits for chain + drand');
  const extra = [...bigFrame, { ...row('fill-expected'), candidate_id: 'SYN-EXTRA' }];
  writeFileSync(P('frame_x.csv'), toCsv(FRAME_COLUMNS, extra));
  writeFileSync(P('scan_x.json'), JSON.stringify(scanFor(extra, 'SYN-0002')));
  ok(run(withReg(withReg(drawDev('ev_dev.json', 'devX'), P('frame.csv'), P('frame_x.csv')), P('scan.json'), P('scan_x.json')), { expectCode: 1 }).includes('committed frame_hash'), 'CLI frame differing from the committed frame: abort');
  wj('prior_forged.json', { development: { ...libDev.record, randomness_block_hash: H('pre-reorg') } });
  ok(run(['verify-sampling', ...regArgs, '--evidence', P('ev_dev.json'), '--stage', 'development', '--prior-final', P('prior_forged.json')], { expectCode: 6 }).includes('STUDY_VOID_POST_FINALITY_REORG'), 'CLI prior FINAL record contradicted by chain: VOID exit 6');

  {
    const c2 = new S.SynthChain(S0);
    const f2 = (x) => S.buildTx({ inputs: [{ txid: S.syntheticTxid(`small-fund-in-${x}`), vout: 0 }], outputs: [{ value: 20000, script: S.p2wpkh(`small-slot-${x}`) }, { value: 5000, script: S.p2wpkh(`small-change-${x}`) }] });
    const fd = f2('dev'); const fh = f2('ho');
    const O2 = { development: `${B.parseTransaction(fd).txid}:0`, 'held-out': `${B.parseTransaction(fh).txid}:0` };
    for (let h = S0; h <= S0 + 10; h++) c2.add(timeAt(h), h === S0 + 2 ? [fd] : h === S0 + 3 ? [fh] : [], 'SMALL');
    const reg2 = filledRegistration(tpl, { outpoints: O2, checkpoint: { height: S0 + 10, hash: c2.block(S0 + 10).hash }, ts: isoOf(timeAt(S0 + 10) + 300) });
    wj('reg_small.json', reg2); wj('ids_small.json', [reg2]);
    const smallPayload = { ...payDev, frame_hash: hashRecords(frame, 'candidate_id'), scan_sha256: sha256(readFileSync(P('scan_small.json'))), outpoint: O2.development };
    const tx2 = S.buildTx({ label: 'small-dev', witness: true, inputs: [{ txid: O2.development.slice(0, 64), vout: 0 }], outputs: [{ value: 0, script: B.encodeCommitmentScript('development', CM.payloadDigest(smallPayload)) }, { value: 15000, script: S.p2wpkh('small-dev-change') }] });
    for (let h = S0 + 11; h <= S0 + 40; h++) c2.add(timeAt(h), h === S0 + 20 ? [tx2] : [], 'SMALL');
    wj('ev_small.json', { schema: 'cpg-u1-sampling-evidence/v1', network: 'synthetic-test', headers: c2.archive('synthetic-source-A'), headers_crosscheck: c2.archive('synthetic-source-B'),
      funding: { development: c2.proof(fd), 'held-out': c2.proof(fh) }, commitments: { development: { payload: smallPayload, ...c2.proof(tx2) }, 'held-out': null }, drand: { chain_info: DRAND_INFO, beacons: [ROUND[1]] } });
    ok(run(['draw-development', '--frame', P('frame_small.csv'), '--scan', P('scan_small.json'), '--registry', regPath, '--registration', P('reg_small.json'), '--identity-registrations', P('ids_small.json'), '--protocol', PROTOCOL, '--allow-synthetic', '--evidence', P('ev_small.json'), '--screened-by', 'x', '--out', P('devSmall')], { expectCode: 6 }).includes('STAGE_VOID_FRAME_INSUFFICIENT') && !existsSync(P('devSmall')), 'T-3: a committed insufficient frame is VOID at the development draw (exit 6), nothing drawn');
  }
  run(drawDev('ev_dev.json', 'dev'));
  run(drawDev('ev_dev.json', 'dev2'));
  const devM = readFileSync(P('dev/manifest.json'), 'utf8');
  ok(devM === readFileSync(P('dev2/manifest.json'), 'utf8'), 'CLI development draw byte-reproducible');
  ok(run(drawDev('ev_dev.json', 'dev'), { expectCode: 1 }).includes('write-once'), 'CLI development draw write-once');
  const dev = JSON.parse(devM);
  ok(!devM.includes(libDev.seed) && dev.sampling.seed_fingerprint === libDev.record.seed_fingerprint && canonicalJson(dev.sampling) === canonicalJson(libDev.record), 'CLI manifest records the chain-verified event and fingerprint, not the seed');
  const cliInel = new Set(['SYN-0002', 'SYN-0007']);
  ok(canonicalJson(idsOf(dev.development)) === canonicalJson(idsOf(drawDevelopment(bigFrame, cliInel, libDev.seed).development)), 'CLI draw = unchanged rank key over the chain-derived seed');
  ok(dev.development.some((e) => e.candidate_id === 'SYN-0002' && e.held_out_ineligible_basis.some((b) => b.includes('CPG-C1(1)'))), 'CLI repo-hit company in development with basis');
  ok(dev.development.some((e) => e.candidate_id === 'SYN-0007' && e.held_out_ineligible_basis.some((b) => b.includes('CPG-C1(6)'))), 'CLI registry-matched company in development with basis');

  const devFill = dev.development.filter((e) => e.stratum === 'fill-expected').map((e) => e.candidate_id);
  const pilotObj = { dev_manifest_sha256: sha256(readFileSync(P('dev/manifest.json'))), resolver_sha: FROZEN_SHA, results: devFill.map((id) => ({ candidate_id: id, fills: 1 })) };
  writeFileSync(P('pilot.json'), JSON.stringify(pilotObj));
  writeFileSync(P('pilot_bad.json'), JSON.stringify({ ...pilotObj, dev_manifest_sha256: '0'.repeat(64) }));
  ok(run(['size', '--dev-manifest', P('dev/manifest.json'), '--pilot', P('pilot_bad.json'), '--out', P('sizingX.json')], { expectCode: 1 }).includes('dev_manifest_sha256'), 'CLI size refuses pilot for another manifest');
  run(['size', '--dev-manifest', P('dev/manifest.json'), '--pilot', P('pilot.json'), '--out', P('sizing.json')]);
  const sizing = rj('sizing.json');
  ok(sizing.quotas['fill-expected'] === 30, 'CLI sizing yield 1 → 30');
  writeFileSync(P('pilot_zero.json'), JSON.stringify({ ...pilotObj, results: devFill.map((id) => ({ candidate_id: id, fills: 0 })) }));
  ok(run(['size', '--dev-manifest', P('dev/manifest.json'), '--pilot', P('pilot_zero.json'), '--out', P('sizingZ.json')], { expectCode: 3 }).includes('HALT'), 'CLI sizing zero-fill HALT exit 3');
  writeFileSync(P('pilot2.json'), JSON.stringify({ ...pilotObj, results: devFill.map((id) => ({ candidate_id: id, fills: 2 })) }));
  run(['size', '--dev-manifest', P('dev/manifest.json'), '--pilot', P('pilot2.json'), '--out', P('sizing_other.json')]);

  const hoBase = (fr, sc, rg = regPath) => ['--frame', P(fr), '--scan', P(sc), '--registry', rg, ...regArgs, '--dev-manifest', P('dev/manifest.json'), '--sizing', P('sizing.json')];
  ok(run(['pool-check', ...hoBase('frame.csv', 'scan.json')]).includes('pool sufficient'), 'CLI pool-check: the complete frame supplies quota 30/13/8 with no extension');
  const hoVariant = (name, fr, scanObj, rg = regPath) => { writeFileSync(P(`frame_${name}.csv`), toCsv(FRAME_COLUMNS, fr)); writeFileSync(P(`scan_${name}.json`), JSON.stringify(scanObj)); return run(['pool-check', ...hoBase(`frame_${name}.csv`, `scan_${name}.json`, rg)], { expectCode: 1 }); };
  serial = 3000;
  const appended = [...bigFrame, row('fill-expected')];
  ok(hoVariant('app', appended, scanFor(appended, 'SYN-0002')).includes('FRAME_CHANGED'), 'T-2: appended frame row after sizing refused');
  const missingRow = bigFrame.filter((c) => c.candidate_id !== 'SYN-0050');
  ok(hoVariant('miss', missingRow, scanFor(missingRow, 'SYN-0002')).includes('drops development-frame row SYN-0050'), 'T-2: missing frame row refused');
  const changedClass = bigFrame.map((c) => (c.candidate_id === 'SYN-0003' ? { ...c, expected_outcome_class: 'abstention-expected' } : c));
  ok(hoVariant('cls', changedClass, scanFor(changedClass, 'SYN-0002')).includes('edits development-frame row SYN-0003'), 'T-2: changed class refused');
  const moved = bigFrame.map((c) => (c.candidate_id === 'SYN-0004' ? { ...c, candidate_id: 'SYN-MOVED' } : c));
  ok(hoVariant('moved', moved, scanFor(moved, 'SYN-0002')).includes('drops development-frame row SYN-0004'), 'T-2: moved (re-identified) candidate refused');
  const dup = [...bigFrame, { ...bigFrame[9] }];
  ok(hoVariant('dup', dup, scanFor(dup, 'SYN-0002')).includes('malformed frame row'), 'T-2: duplicate candidate refused');
  const editedName = bigFrame.map((c) => (c.candidate_id === 'SYN-0005' ? { ...c, company_name: 'SYNTHETIC-CO-EDITED' } : c));
  ok(hoVariant('edit', editedName, scanFor(editedName, 'SYN-0002')).includes('append-only'), 'CLI refuses a held-out frame that edits a development-frame row');
  ok(hoVariant('otherreg', bigFrame, { ...scanFor(bigFrame, 'SYN-0002'), registry_sha256: '0'.repeat(64) }).includes('different development-only registry'), 'CLI refuses a scan made with a different registry');
  ok(hoVariant('otherframe', bigFrame, { ...scanFor(bigFrame, 'SYN-0002'), frame_hash: '0'.repeat(64) }).includes('frame_hash mismatch'), 'CLI refuses a scan made for a different frame');
  const regBase = JSON.parse(readFileSync(regPath, 'utf8'));
  const regVariant = (name, obj) => { const p = P(`registry_${name}.json`); writeFileSync(p, JSON.stringify(obj)); return p; };
  const rAdd = regVariant('add', { entries: [...regBase.entries, { id: 'SYN-REG-2', names: ['SYNTHETIC-CO-9'], domains: [], basis: ['synthetic late addition'], evidence: 'synthetic' }] });
  ok(hoVariant('regadd', bigFrame, scanFor(bigFrame, 'SYN-0002', rAdd, ['SYNTHETIC-CO-7', 'SYNTHETIC-CO-9']), rAdd).includes('REGISTRY_CHANGED'), 'T-1: appended registry row (post-pilot exclusion) refused');
  const rDel = regVariant('del', { entries: [] });
  ok(hoVariant('regdel', bigFrame, scanFor(bigFrame, 'SYN-0002', rDel, []), rDel).includes('REGISTRY_CHANGED'), 'T-1: deleted registry row refused');
  const rMut = regVariant('mut', { entries: [{ ...regBase.entries[0], names: ['SYNTHETIC-CO-8'] }] });
  ok(hoVariant('regmut', bigFrame, scanFor(bigFrame, 'SYN-0002', rMut, ['SYNTHETIC-CO-8']), rMut).includes('REGISTRY_CHANGED'), 'T-1: changed registry row refused');
  ok(hoVariant('scanforge', bigFrame, scanFor(bigFrame, ['SYN-0002', 'SYN-0011'])).includes('SCAN_CHANGED'), 'scan frozen: a post-pilot scan adding a contamination hit is refused');
  ok(run(['commitment-payload', '--stage', 'held-out', ...hoBase('frame_app.csv', 'scan_app.json'), '--evidence', P('ev_dev.json'), '--out', P('payload_hoApp.json')], { expectCode: 1 }).includes('FRAME_CHANGED') && !existsSync(P('payload_hoApp.json')), 'T-2: no held-out commitment payload for an extended frame (fail closed)');
  ok(run(['commitment-payload', '--stage', 'held-out', ...hoBase('frame.csv', 'scan_regadd.json', rAdd), '--evidence', P('ev_dev.json'), '--out', P('payload_hoReg.json')], { expectCode: 1 }).includes('REGISTRY_CHANGED') && !existsSync(P('payload_hoReg.json')), 'T-1: no held-out commitment payload with a grown registry (fail closed)');

  // seed substitution: a development manifest whose sampling record was altered cannot anchor a held-out commitment
  mkdirSync(P('devT'));
  writeFileSync(P('devT/manifest.json'), JSON.stringify({ ...dev, sampling: { ...dev.sampling, seed_fingerprint: H('substituted seed') } }, null, 2) + '\n');
  writeFileSync(P('pilotT.json'), JSON.stringify({ ...pilotObj, dev_manifest_sha256: sha256(readFileSync(P('devT/manifest.json'))) }));
  run(['size', '--dev-manifest', P('devT/manifest.json'), '--pilot', P('pilotT.json'), '--out', P('sizingT.json')]);
  ok(run(['commitment-payload', '--stage', 'held-out', ...withReg(withReg(hoBase('frame.csv', 'scan.json'), P('dev/manifest.json'), P('devT/manifest.json')), P('sizing.json'), P('sizingT.json')), '--evidence', P('ev_dev.json'), '--out', P('payload_hoT.json')], { expectCode: 1 }).includes('SEED_MISMATCH'), 'CLI substituted development sampling record: abort');

  // held-out commitment payload binds the development event, manifest, pilot, sizing and append-only proof
  run(['commitment-payload', '--stage', 'held-out', ...hoBase('frame.csv', 'scan.json'), '--evidence', P('ev_dev.json'), '--out', P('payload_ho.json')]);
  payHo = rj('payload_ho.json');
  const bnd = payHo.binding;
  ok(bnd.development_commitment_txid === B.parseTransaction(devTx).txid && bnd.development_payload_digest === devDigest && bnd.development_manifest_sha256 === sha256(readFileSync(P('dev/manifest.json')))
    && bnd.pilot_result_sha256 === sha256(readFileSync(P('pilot.json'))) && bnd.sizing_sha256 === sha256(readFileSync(P('sizing.json'))) && bnd.append_only_proof.held_out_frame_hash === hashRecords(bigFrame, 'candidate_id') && payHo.frame_hash === payDev.frame_hash && payHo.scan_sha256 === payDev.scan_sha256 && payHo.registry_sha256 === payDev.registry_sha256, 'CLI held-out payload binding complete');

  // phase 3: the (synthetic) spend of O_ho after development finality, then K + D blocks
  hoTx = S.buildTx({ label: 'e2e-ho', witness: true, inputs: [{ txid: O['held-out'].slice(0, 64), vout: 0 }], outputs: [{ value: 0, script: B.encodeCommitmentScript('held-out', CM.payloadDigest(payHo)) }, { value: 15000, script: S.p2wpkh('e2e-ho-change') }] });
  for (let h = S0 + 41; h <= S0 + 80; h++) chain.add(timeAt(h), h === S0 + 60 ? [hoTx] : []);
  wj('ev_full.json', evidence(S0 + 80, [ROUND[1], ROUND[1000000]]));
  const drawHo = (sz, out) => ['draw-held-out', ...withReg(hoBase('frame.csv', 'scan.json'), P('sizing.json'), P(sz)), '--evidence', P('ev_full.json'), '--screened-by', 'synthetic-screener', '--out', P(out)];
  ok(run(drawHo('sizing_other.json', 'hoB'), { expectCode: 6 }).includes('STAGE_VOID_BINDING_MISMATCH') && !existsSync(P('hoB')), 'CLI held-out with a sizing file other than the committed one: VOID exit 6');
  ok(run(['draw-held-out', ...withReg(withReg(hoBase('frame.csv', 'scan.json'), P('dev/manifest.json'), P('devT/manifest.json')), P('sizing.json'), P('sizingT.json')), '--evidence', P('ev_full.json'), '--screened-by', 'x', '--out', P('hoT')], { expectCode: 1 }).includes('SEED_MISMATCH') && !existsSync(P('hoT')), 'CLI held-out draw with a substituted development record: abort');
  run(drawHo('sizing.json', 'ho'));
  const ho = JSON.parse(readFileSync(P('ho/manifest.json'), 'utf8'));
  const libHo = SA.evaluateStage(reg, rj('ev_full.json'), 'held-out', { allowSynthetic: true });
  ok(ho.held_out.length === 51 && !ho.held_out.some((e) => e.held_out_ineligible_basis.length || dev.development.some((d) => d.candidate_id === e.candidate_id)), 'CLI held-out 30/13/8, all eligible, disjoint from development');
  ok(ho.sampling.drand_round === 1000000 && canonicalJson(ho.sampling) === canonicalJson(libHo.record) && !readFileSync(P('ho/manifest.json'), 'utf8').includes(libHo.seed), 'CLI held-out manifest: chain-verified event, drand round 1000000, no seed');

  // protocol and archive commands
  ok(run(['verify-protocol', '--protocol', PROTOCOL], { expectCode: 1 }).includes('does not state'), 'CLI verify-protocol refuses a file lacking the pinned parameters');
  writeFileSync(P('protocol_markers.md'), ['CPG_U1_PROTOCOL_004', 'CPG-U1-2026-01', 'D = 6', 'K = 12', '180 days', 'Δ = 3 h', '30 days', DR.QUICKNET.hash, 'bls-unchained-g1-rfc9380',
    'cpg-u1-chain-drand-seed/v1', 'cpg-u1-commitment-digest/v1', 'cpg-u1-commitment/v1', 'OSF Registries', 'STUDY_OPERATOR', 'UNASSIGNED', 'cpg-u1-rater-order/v1', 'cpg-u1-execution-authorization/v1', 'E ≥ 126 / 52 / 32', 'cpg-u1-cited-urls/field-evidence-union/v1', 'cpg-u1-evaluation-tree/v1'].join('\n'));
  ok(run(['verify-protocol', '--protocol', P('protocol_markers.md')]).includes('states every pinned parameter'), 'CLI verify-protocol accepts a file stating every pinned parameter');
  writeFileSync(P('protocol_no_cited_rule.md'), readFileSync(P('protocol_markers.md'), 'utf8').replace('cpg-u1-cited-urls/field-evidence-union/v1', 'cpg-u1-cited-urls/SOME-OTHER-RULE/v1'));
  ok(run(['verify-protocol', '--protocol', P('protocol_no_cited_rule.md')], { expectCode: 1 }).includes('cpg-u1-cited-urls/field-evidence-union/v1'), 'CLI verify-protocol refuses a protocol that does not state the approved §12.3 cited-URL rule');
  writeFileSync(P('protocol_no_eval_tree.md'), readFileSync(P('protocol_markers.md'), 'utf8').replace('cpg-u1-evaluation-tree/v1', 'cpg-u1-evaluation-tree/SOME-OTHER/v1'));
  ok(run(['verify-protocol', '--protocol', P('protocol_no_eval_tree.md')], { expectCode: 1 }).includes('cpg-u1-evaluation-tree/v1'), 'CLI verify-protocol refuses a protocol that does not state the §7.1 evaluation-tree domain');

  // ── CPG-048 CLI: verify-evaluation-tree over a SYNTHETIC treatment repository ──
  {
    const synthRepo = P('synth_treatment');
    mkdirSync(synthRepo, { recursive: true });
    writeFileSync(join(synthRepo, 'a.ts'), 'export const a = 1;\n');
    const sg = (...args) => execFileSync('git', ['-C', synthRepo, '-c', 'user.name=SYNTHETIC', '-c', 'user.email=synthetic@synthetic.example', ...args], { encoding: 'utf8' });
    sg('init', '--quiet'); sg('add', '-A'); sg('commit', '--quiet', '-m', 'synthetic treatment');
    const sid = ET.repoIdentity(synthRepo);
    const stubFor = (agg) => ['## 7. Treatment definition', '', '### 7.1 Evaluated software identity [NORMATIVE]', '',
      `The evaluated resolver is the repository content at commit \`${sid.commit}\`.`, '',
      `- its git tree object id \`${sid.tree}\`;`,
      `- its content manifest aggregate (domain \`${ET.EVALUATION_TREE_DOMAIN}\`): \`${agg}\` (${sid.files} files).`, '', '## 8. Next', ''].join('\n');
    writeFileSync(P('proto_synth_ok.md'), stubFor(sid.aggregate));
    writeFileSync(P('proto_synth_bad.md'), stubFor(H('a different treatment')));
    const okOut = run(['verify-evaluation-tree', '--repo', synthRepo, '--protocol', P('proto_synth_ok.md')]);
    ok(okOut.includes('evaluation tree verified') && okOut.includes(sid.aggregate), 'CLI verify-evaluation-tree: a clone whose content is the declared evaluation tree verifies (exit 0)');
    const badOut = run(['verify-evaluation-tree', '--repo', synthRepo, '--protocol', P('proto_synth_bad.md')], { expectCode: 1 });
    ok(badOut.includes('EVALUATION_TREE_MISMATCH') && badOut.includes('CONTENT_MISMATCH'), 'CLI verify-evaluation-tree: content that is not the declared treatment is REFUSED with exit 1');
    writeFileSync(join(synthRepo, 'a.ts'), 'export const a = 2; // later change\n');
    ok(run(['verify-evaluation-tree', '--repo', synthRepo, '--protocol', P('proto_synth_ok.md')], { expectCode: 1 }).includes('EVALUATION_TREE_MISMATCH'), 'CLI verify-evaluation-tree: an edited (later-state) working tree is REFUSED with exit 1');
  }
  const full = rj('ev_full.json');
  wj('arch_a.json', full.headers); wj('arch_b.json', full.headers_crosscheck);
  const archArgs = ['--network', 'synthetic-test', '--allow-synthetic', '--checkpoint-height', String(S0 + 10), '--checkpoint-hash', reg.checkpoint.hash, '--archive', P('arch_a.json')];
  ok(run(['verify-archive', ...archArgs, '--crosscheck', P('arch_b.json')]).includes(`agree over ${S0}..${S0 + 80}`), 'CLI verify-archive');
  const badB = { ...full.headers_crosscheck, headers_hex: [...full.headers_crosscheck.headers_hex] };
  badB.headers_hex[70] = badB.headers_hex[70].replace(/^(.{136})(.{8})/, (m, a) => `${a}00000000`);
  wj('arch_bad.json', badB);
  ok(run(['verify-archive', ...archArgs, '--crosscheck', P('arch_bad.json')], { expectCode: 1 }).includes('archive refused'), 'CLI verify-archive refuses a tampered source');

  // blind records for every drawn company
  const drawnAll = [...dev.development, ...ho.held_out];
  const NA = { value_kind: 'NOT_AVAILABLE_FROM_SOURCE', expected_value: '', search_note: 'SYNTHETIC searched' };
  const over = Object.fromEntries(drawnAll.flatMap((e) => FIELDS3.map((f) => [`${e.candidate_id}|${f}`, e.stratum === 'fill-expected' && f === 'founded_year' ? {} : NA])));
  writeFileSync(P('author.csv'), toCsv(BLIND_RECORD_COLUMNS, drawnAll.flatMap((e) => FIELDS3.map((f) => blind(e.candidate_id, f, 'author-1', over[`${e.candidate_id}|${f}`])))));
  const firstFill = drawnAll.find((e) => e.stratum === 'fill-expected').candidate_id;
  const cOver = { ...over, [`${firstFill}|founded_year`]: { expected_value: '2001' } };
  writeFileSync(P('confirmer.csv'), toCsv(BLIND_RECORD_COLUMNS, drawnAll.flatMap((e) => FIELDS3.map((f) => blind(e.candidate_id, f, 'confirmer-1', cOver[`${e.candidate_id}|${f}`])))));
  const rec = ['--dev-manifest', P('dev/manifest.json'), '--held-out-manifest', P('ho/manifest.json'), '--author', P('author.csv'), '--confirmer', P('confirmer.csv')];
  ok(run(['reconcile', ...rec, '--out', P('refX.csv')], { expectCode: 1 }).includes('independent adjudication required'), 'CLI reconcile refuses unadjudicated disagreement');
  writeFileSync(P('adj.csv'), toCsv(ADJUDICATION_COLUMNS, [{ candidate_id: firstFill, field: 'founded_year', decision: 'AUTHOR', rationale: 'SYNTHETIC', adjudicated_by: 'adjudicator-1', adjudicated_at: '2026-09-12' }]));
  run(['reconcile', ...rec, '--adjudication', P('adj.csv'), '--out', P('reference.csv')]);
  ok(parseCsv(readFileSync(P('reference.csv'), 'utf8')).records.length === drawnAll.length * 3, 'CLI reconcile writes one row per drawn company × field');

  const sealArgs = ['--dev-dir', P('dev'), '--held-out-dir', P('ho'), '--sizing', P('sizing.json'), '--author', P('author.csv'), '--confirmer', P('confirmer.csv'), '--adjudication', P('adj.csv')];
  const tampered = readFileSync(P('reference.csv'), 'utf8').replace('ADJUDICATED_AUTHOR', 'AGREED');
  writeFileSync(P('reference_tampered.csv'), tampered);
  ok(run(['seal', ...sealArgs, '--reference', P('reference_tampered.csv'), '--out', P('SEALX.json')], { expectCode: 1 }).includes('hand-edited'), 'CLI seal refuses hand-edited reference');
  ok(!existsSync(P('SEALX.json')), 'no seal written for tampered reference');
  run(['seal', ...sealArgs, '--reference', P('reference.csv'), '--out', P('SEAL.json')]);
  const seal = JSON.parse(readFileSync(P('SEAL.json'), 'utf8'));
  ok(/^[0-9a-f]{64}$/.test(seal.seal_hash) && seal.resolutions.ADJUDICATED_AUTHOR === 1 && seal.status.includes('NOT EXECUTED') && seal.held_out.sampling_record_sha256 === libHo.record.record_sha256, 'CLI seal written with resolution counts and sampling records');
  ok(run(['seal', ...sealArgs, '--reference', P('reference.csv'), '--out', P('SEAL.json')], { expectCode: 1 }).includes('write-once'), 'CLI seal write-once');
  ok(run(['seal', ...sealArgs.filter((x, i, a) => !(x === '--adjudication' || a[i - 1] === '--adjudication')), '--reference', P('reference.csv'), '--out', P('SEAL2.json')], { expectCode: 1 }).includes('never sealed with errors'), 'CLI seal refuses when adjudication withheld');

  // ── Protocol-004 CLI: rater order (§12.1) ──
  const sealed = ['--held-out-manifest', P('ho/manifest.json'), '--seal', P('SEAL.json')];
  const ordOut = run(['rater-order', ...sealed, '--label', 'rater-1', '--out', P('order_r1.json')]);
  const ord = rj('order_r1.json');
  ok(ordOut.includes('order_sha256') && ord.items.length === 51 * 3 && ord.held_out_record_sha256 === libHo.record.record_sha256 && ord.domain === 'cpg-u1-rater-order/v1', 'CLI rater-order: all held-out observations, derived from the sealed held-out record');
  ok(canonicalJson(ord) === canonicalJson(RO.orderArtifact(libHo.record.record_sha256, 'rater-1', ho.held_out.flatMap((e) => FIELDS3.map((field) => ({ candidate_id: e.candidate_id, field }))))), 'CLI rater order reproducible from published artifacts');
  ok(run(['verify-rater-order', ...sealed, '--order', P('order_r1.json')]).includes('verified'), 'CLI verify-rater-order accepts the derived order');
  wj('order_swapped.json', { ...ord, items: [ord.items[1], ord.items[0], ...ord.items.slice(2)] });
  ok(run(['verify-rater-order', ...sealed, '--order', P('order_swapped.json')], { expectCode: 1 }).includes('RATER_ORDER_SUBSTITUTION'), 'RATER-ORDER SUBSTITUTION: a reordered presentation is refused');
  wj('order_devrec.json', RO.orderArtifact(libDev.record.record_sha256, 'rater-1', ho.held_out.flatMap((e) => FIELDS3.map((field) => ({ candidate_id: e.candidate_id, field })))));
  ok(run(['verify-rater-order', ...sealed, '--order', P('order_devrec.json')], { expectCode: 1 }).includes('RATER_ORDER_SUBSTITUTION'), 'RATER-ORDER SEED SUBSTITUTION: an order derived from another record (development) is refused');
  mkdirSync(P('hoF'));
  const hoForged = { ...ho, sampling: { ...ho.sampling, drand_randomness: H('forged randomness') } };
  hoForged.sampling.record_sha256 = sha256(canonicalJson(Object.fromEntries(Object.entries(hoForged.sampling).filter(([k]) => k !== 'record_sha256'))));
  writeFileSync(P('hoF/manifest.json'), JSON.stringify(hoForged, null, 2) + '\n');
  ok(run(['rater-order', '--held-out-manifest', P('hoF/manifest.json'), '--seal', P('SEAL.json'), '--label', 'rater-1', '--out', P('order_forged.json')], { expectCode: 1 }).includes('RATER_ORDER_SUBSTITUTION') && !existsSync(P('order_forged.json')), 'RATER-ORDER SEED SUBSTITUTION: a re-hashed forged sampling record is not the sealed one');
  mkdirSync(P('hoA'));
  writeFileSync(P('hoA/manifest.json'), JSON.stringify({ ...ho, held_out: ho.held_out.slice(0, -1) }, null, 2) + '\n');
  ok(run(['rater-order', '--held-out-manifest', P('hoA/manifest.json'), '--seal', P('SEAL.json'), '--label', 'rater-1', '--out', P('order_altered.json')], { expectCode: 1 }).includes('seal does not bind'), 'RATER-ORDER SUBSTITUTION: a held-out manifest not bound by the seal (company dropped) is refused');
  wj('SEAL_forged.json', { ...seal, held_out: { ...seal.held_out, manifest_sha256: sha256(readFileSync(P('hoF/manifest.json'))) } });
  ok(run(['rater-order', '--held-out-manifest', P('hoF/manifest.json'), '--seal', P('SEAL_forged.json'), '--label', 'rater-1', '--out', P('order_forged2.json')], { expectCode: 1 }).includes('differs from the sealed held-out record'), 'RATER-ORDER SEED SUBSTITUTION: forged record + seal re-pointed at it still differs from the sealed sampling record');
  ok(run(['rater-order', ...sealed, '--label', 'operator-choice', '--out', P('order_x.json')], { expectCode: 1 }).includes('--label'), 'rater order label is not a free parameter');

  // ── Protocol-004 CLI: blinded reference adjudication packet (§9.2.1) ──
  const refArgs = [...sealed, '--dev-manifest', P('dev/manifest.json'), '--author', P('author.csv'), '--confirmer', P('confirmer.csv')];
  ok(run(['reference-adjudication-packet', ...refArgs, '--out', P('refpacket.json')]).includes('1 disagreeing item'), 'CLI reference adjudication packet: only the single disagreement');
  const refPacket = rj('refpacket.json');
  ok(JSON.stringify(refPacket).indexOf('author-1') === -1 && JSON.stringify(refPacket).indexOf('stratum') === -1 && JSON.stringify(refPacket).indexOf('held-out') === -1, 'CLI reference packet carries no recorder identity, class or split');
  ok(run(['verify-adjudication-packet', '--type', 'reference', ...refArgs, '--packet', P('refpacket.json')]).includes('verified'), 'CLI verify reference packet');
  wj('refpacket_leak.json', { ...refPacket, items: refPacket.items.map((it) => ({ ...it, expected_outcome_class: 'fill-expected' })) });
  ok(run(['verify-adjudication-packet', '--type', 'reference', ...refArgs, '--packet', P('refpacket_leak.json')], { expectCode: 1 }).includes('FORBIDDEN_OR_ALTERED_PACKET'), 'CLI: reference adjudicator packet with forbidden information refused');
  const blindDecision = RO.authorIsRecord1(libHo.record.record_sha256, firstFill, 'founded_year') ? 'RECORD_1' : 'RECORD_2';
  writeFileSync(P('blind_adj.csv'), toCsv(ADJUDICATION_COLUMNS, [{ candidate_id: firstFill, field: 'founded_year', decision: blindDecision, rationale: 'SYNTHETIC', adjudicated_by: 'adjudicator-1', adjudicated_at: '2026-09-12' }]));
  run(['resolve-reference-adjudication', ...sealed, '--decisions', P('blind_adj.csv'), '--out', P('adj_resolved.csv')]);
  ok(readFileSync(P('adj_resolved.csv'), 'utf8') === readFileSync(P('adj.csv'), 'utf8'), 'CLI blind RECORD_n decision resolves to exactly the AUTHOR adjudication used in the seal');

  // ── Protocol-004 CLI: personnel register (§4A) ──
  wj('personnel.json', personnel());
  ok(run(['check-personnel', '--personnel', P('personnel.json')]).includes('mutually exclusive'), 'CLI check-personnel accepts seven distinct independent people');
  const pc = personnel(); pc.assignments[3].person_id = pc.assignments[0].person_id; wj('personnel_collision.json', pc);
  ok(run(['check-personnel', '--personnel', P('personnel_collision.json')], { expectCode: 1 }).includes('refused'), 'CLI ROLE COLLISION refused');
  const pm = personnel(); pm.assignments.splice(5, 1); wj('personnel_missing.json', pm);
  ok(run(['check-personnel', '--personnel', P('personnel_missing.json')], { expectCode: 4 }).includes('BLOCKED'), 'CLI unfilled role BLOCKED exit 4');

  // ── Protocol-004 CLI: execution authorization + audit (§6.5) ──
  wj('seal_publication.json', { seal_hash: seal.seal_hash, record_id: 'SYNTHETIC-OSF-SEAL-RECORD', registry_timestamp: '2023-10-01T00:00:00Z' });
  const authArgs = ['--registration', P('registration.json'), '--frame', P('frame.csv'), '--allow-synthetic', '--dev-manifest', P('dev/manifest.json'), '--held-out-manifest', P('ho/manifest.json'), '--seal', P('SEAL.json'), '--seal-publication', P('seal_publication.json')];
  ok(run(['authorize-execution', ...authArgs, '--out', P('authorization.json')]).includes('authorization_sha256'), 'CLI authorize-execution bound to the sealed manifests and published seal');
  const authz = rj('authorization.json');
  ok(authz.held_out_candidate_ids.length === 51 && authz.frame_candidates.length === bigFrame.length && authz.window_opens_at === '2023-10-01T00:00:00Z', 'authorization lists the 51 held-out companies, every frame candidate, and the window opening');
  wj('seal_publication_bad.json', { seal_hash: H('other'), record_id: 'SYNTHETIC-OSF-SEAL-RECORD', registry_timestamp: '2023-10-01T00:00:00Z' });
  ok(run(['authorize-execution', ...authArgs.map((x) => (x === P('seal_publication.json') ? P('seal_publication_bad.json') : x)), '--out', P('authorization_bad.json')], { expectCode: 1 }).includes('AUTHORIZATION_REFUSED') && !existsSync(P('authorization_bad.json')), 'CLI authorization refused for a publication naming another seal');
  const hoId = authz.held_out_candidate_ids[0];
  wj('log_clean.json', { schema: 'cpg-u1-execution-log/v1', runs: [{ run_id: 'authorized-1', kind: 'held-out-authorized', authorization_sha256: authz.authorization_sha256, started_at: '2023-10-02T00:00:00Z', completed_at: '2023-10-02T08:00:00Z', invocations: authz.held_out_candidate_ids.map((id, i) => ({ at: `2023-10-02T0${1 + (i % 6)}:00:00Z`, candidate_id: id })) }] });
  ok(run(['audit-execution-log', '--authorization', P('authorization.json'), '--log', P('log_clean.json')]).includes('NO_VIOLATION_IN_LOG'), 'CLI audit: clean log reported as no violation IN THE LOG (not as proof of no preview)');
  wj('log_preview.json', { schema: 'cpg-u1-execution-log/v1', runs: [{ run_id: 'debug', kind: 'other', started_at: '2023-09-29T00:00:00Z', completed_at: '2023-09-29T01:00:00Z', invocations: [{ at: '2023-09-29T00:30:00Z', candidate_id: hoId }] }] });
  ok(run(['audit-execution-log', '--authorization', P('authorization.json'), '--log', P('log_preview.json')], { expectCode: 6 }).includes('STUDY_VOID_PREVIEW'), 'CLI PREVIEW BEFORE EXECUTION WINDOW → VOID exit 6');
  wj('log_early.json', { schema: 'cpg-u1-execution-log/v1', runs: [{ run_id: 'authorized-1', kind: 'held-out-authorized', authorization_sha256: authz.authorization_sha256, started_at: '2023-09-30T00:00:00Z', completed_at: '2023-09-30T01:00:00Z', invocations: [] }] });
  ok(run(['audit-execution-log', '--authorization', P('authorization.json'), '--log', P('log_early.json')], { expectCode: 6 }).includes('STUDY_VOID_UNAUTHORIZED_EXECUTION'), 'CLI EXECUTION BEFORE AUTHORIZATION → VOID exit 6');
  const late = rj('log_clean.json'); late.runs.push({ run_id: 'rerun', kind: 'other', started_at: '2023-10-05T00:00:00Z', completed_at: '2023-10-05T01:00:00Z', invocations: [{ at: '2023-10-05T00:10:00Z', candidate_id: hoId }] });
  wj('log_late.json', late);
  ok(run(['audit-execution-log', '--authorization', P('authorization.json'), '--log', P('log_late.json')], { expectCode: 6 }).includes('STUDY_VOID_POST_WINDOW_EXECUTION'), 'CLI EXECUTION AFTER WINDOW → VOID exit 6');

  // ── CPG-044: execution harness (lib) — fail-closed gates over the sealed synthetic study ──
  {
    const devMP = P('dev/manifest.json'); const hoMP = P('ho/manifest.json');
    const evFull = rj('ev_full.json');
    const hctx = (o = {}) => ({
      registration: reg, identityRegistrations: [reg], protocolSha: sha256(readFileSync(PROTOCOL)), toolingAggregate: toolingManifest(join(HERE, '..')).aggregate,
      frameRows: bigFrame, frameHash: hashRecords(bigFrame, 'candidate_id'), scanSha: sha256(readFileSync(P('scan.json'))), registrySha: sha256(readFileSync(regPath)),
      devManifest: dev, devManifestSha: sha256(readFileSync(devMP)), evidence: evFull, resolver: { head: FROZEN_SHA, clean: true, providerConfigurationSha: PROVIDER_SHA, envFiles: [] },
      hoManifest: ho, hoManifestSha: sha256(readFileSync(hoMP)), seal, sealPublication: rj('seal_publication.json'), authorization: authz, ...o,
    });
    const at = (t) => () => t;
    const IN_WINDOW = '2023-10-02T00:00:00Z';
    let executed = [];
    const synthExec = async ({ candidate_id }) => { executed.push(candidate_id); return synthExecution({ founded_year: '1999' }); };
    const devIds = dev.development.map((e) => e.candidate_id);
    const hoIds = authz.held_out_candidate_ids;
    const refusedLog = P('h_refusals.jsonl'); const refusedArch = P('h_arch_refused');
    const ho1 = async (ctxOver, request = { run_id: 'ho-refused', candidate_ids: hoIds }, now = IN_WINDOW) => {
      executed = [];
      const r = await HA.runHeldOut({ ctx: hctx(ctxOver), request, executor: synthExec, logPath: refusedLog, archiveDir: refusedArch, now: at(now), allowSynthetic: true });
      return { ...r, executedCount: executed.length };
    };
    const refusedAs = (r, type, code) => r.status === 'REFUSED' && r.type === type && r.code === code && r.executedCount === 0;
    const rehash = (a) => { const { authorization_sha256: _x, ...b } = a; return { ...b, authorization_sha256: sha256(canonicalJson(b)) }; };

    // pilot (§6.3/§11): development companies only
    const pilotLog = P('h_pilot.jsonl'); const pilotArch = P('h_arch_pilot');
    executed = [];
    const pr = await HA.runPilot({ ctx: hctx(), request: { run_id: 'pilot-1', candidate_ids: devIds }, executor: synthExec, logPath: pilotLog, archiveDir: pilotArch, now: at('2023-09-01T00:00:00Z'), allowSynthetic: true });
    ok(pr.status === 'EXECUTED' && pr.records.length === devIds.length && executed.length === devIds.length && devIds.every((id) => existsSync(join(pilotArch, 'pilot-1', `${id}.json`))), 'HARNESS pilot: every development company executed once and archived (write-once record per company)');
    const pEv = EL.readEventLog(pilotLog).events;
    ok(pEv.map((e) => e.type).join() === ['LOG_OPENED', 'PILOT_RUN_STARTED', ...devIds.map(() => 'PILOT_EXECUTION'), 'PILOT_RUN_COMPLETED'].join() && pEv.filter((e) => e.type === 'PILOT_EXECUTION').every((e) => e.archive_record_sha256 === JSON.parse(readFileSync(join(pilotArch, 'pilot-1', `${e.candidate_id}.json`), 'utf8')).record_sha256), 'HARNESS pilot: audit events bind each archive record hash');
    const pilotFromArch = AR.pilotResultFromArchive(pr.records, dev, sha256(readFileSync(devMP)), dev.resolver_sha);
    ok(pilotFromArch.results.length === devFill.length && pilotFromArch.results.every((x) => x.fills === 1), 'HARNESS pilot result derived from the archive (synthetic: one fill per fill-expected company)');
    const pilotRef = async (request) => { executed = []; const r = await HA.runPilot({ ctx: hctx(), request, executor: synthExec, logPath: pilotLog, archiveDir: pilotArch, now: at('2023-09-01T01:00:00Z'), allowSynthetic: true }); return { ...r, executedCount: executed.length }; };
    ok(refusedAs(await pilotRef({ run_id: 'pilot-peek', candidate_ids: [devIds[0], hoIds[0]] }), 'PREVIEW_ATTEMPT', 'NON_DEVELOPMENT_COMPANY') && !existsSync(join(pilotArch, 'pilot-peek')), 'HARNESS PREVIEW ATTEMPT: a held-out company in a pilot request is refused, nothing executed (not even the development company)');
    ok(refusedAs(await pilotRef({ run_id: 'pilot-1', candidate_ids: [devIds[0]] }), 'MALFORMED_EXECUTION', 'ARCHIVE_EXISTS')
      && EL.readEventLog(pilotLog).events.filter((e) => e.type === 'PILOT_RUN_STARTED' && e.run_id === 'pilot-1').length === 1, 'HARNESS pilot: re-using a run id (overwriting archived responses) refused before any run-start event is written');
    ok(refusedAs(await pilotRef({ run_id: 'bad id!', candidate_ids: [devIds[0]] }), 'MALFORMED_EXECUTION', 'RUN_ID_INVALID'), 'HARNESS MALFORMED: invalid run id');
    ok(refusedAs(await pilotRef({ run_id: 'p2', candidate_ids: [] }), 'MALFORMED_EXECUTION', 'CANDIDATES_INVALID'), 'HARNESS MALFORMED: empty candidate list');
    ok(refusedAs(await pilotRef({ run_id: 'p2', candidate_ids: [devIds[0], devIds[0]] }), 'MALFORMED_EXECUTION', 'CANDIDATES_DUPLICATE'), 'HARNESS MALFORMED: duplicate candidate');
    ok(refusedAs(await pilotRef({ run_id: 'p2', candidate_ids: ['SYN-NOT-IN-FRAME'] }), 'MALFORMED_EXECUTION', 'CANDIDATE_NOT_IN_FRAME'), 'HARNESS MALFORMED: company outside the frame');
    ok(refusedAs(await pilotRef(null), 'MALFORMED_EXECUTION', 'REQUEST_MISSING'), 'HARNESS MALFORMED: missing request');
    ok(refusedAs({ ...(await HA.runPilot({ ctx: hctx({ frameHash: H('other frame') }), request: { run_id: 'p4', candidate_ids: [devIds[0]] }, executor: synthExec, logPath: pilotLog, archiveDir: pilotArch, now: at('2023-09-01T03:00:00Z'), allowSynthetic: true })), executedCount: 0 }, 'VERIFICATION_FAILURE', 'FRAME_MISMATCH'), 'HARNESS pilot: frame differing from the committed frame refused');
    ok(refusedAs({ ...(await HA.runPilot({ ctx: hctx({ scanSha: H('replaced scan') }), request: { run_id: 'p3', candidate_ids: [devIds[0]] }, executor: synthExec, logPath: pilotLog, archiveDir: pilotArch, now: at('2023-09-01T02:00:00Z'), allowSynthetic: true })), executedCount: 0 }, 'VERIFICATION_FAILURE', 'SCAN_MISMATCH'), 'HARNESS pilot: replaced scan refused');

    // held-out verification failures — each refused, logged, nothing executed
    const altered = (k, v) => rehash({ ...authz, [k]: v });
    ok(refusedAs(await ho1({ authorization: null }), 'VERIFICATION_FAILURE', 'AUTHORIZATION_MISSING'), 'HARNESS authorization MISSING refused');
    ok(refusedAs(await ho1({ authorization: { ...authz, window_opens_at: '2023-09-01T00:00:00Z' } }), 'VERIFICATION_FAILURE', 'AUTHORIZATION_ALTERED'), 'HARNESS authorization ALTERED (hash does not recompute) refused');
    ok(refusedAs(await ho1({ authorization: altered('window_opens_at', '2023-09-27T00:00:00Z') }), 'VERIFICATION_FAILURE', 'AUTHORIZATION_MISMATCH'), 'HARNESS re-hashed authorization with an operator-chosen window refused (no override)');
    for (const [k, v, what] of [['protocol_sha256', H('other protocol'), 'protocol'], ['tooling_aggregate_sha256', H('other tooling'), 'tooling'], ['frame_hash', H('other frame'), 'frame'],
      ['registry_sha256', H('other registry'), 'registry'], ['scan_sha256', H('other scan'), 'scan'], ['study_id', 'CPG-U1-OTHER', 'study'], ['registration_id', 'SYNTHETIC-OTHER-REG', 'registration'],
      ['held_out_commitment', { ...authz.held_out_commitment, commitment_txid: H('other txid') }, 'held-out commitment'], ['development_commitment', { ...authz.development_commitment, drand_randomness: H('other randomness') }, 'development randomness'],
      ['as_of', '2026-01-01T00:00:00Z', 'asOf'], ['provider_configuration_sha256', H('other provider config'), 'provider configuration'], ['held_out_candidate_ids', hoIds.slice(1), 'held-out candidate set']]) {
      ok(refusedAs(await ho1({ authorization: altered(k, v) }), 'VERIFICATION_FAILURE', 'AUTHORIZATION_MISMATCH'), `HARNESS authorization naming a WRONG ${what.toUpperCase()} refused`);
    }
    ok(refusedAs(await ho1({ protocolSha: H('x') }), 'VERIFICATION_FAILURE', 'PROTOCOL_MISMATCH'), 'HARNESS wrong protocol file refused');
    ok(refusedAs(await ho1({ toolingAggregate: H('x') }), 'VERIFICATION_FAILURE', 'TOOLING_MISMATCH'), 'HARNESS wrong tooling refused');
    ok(refusedAs(await ho1({ registrySha: H('x') }), 'VERIFICATION_FAILURE', 'REGISTRY_MISMATCH'), 'HARNESS grown/changed registry refused');
    ok(refusedAs(await ho1({ frameHash: H('x') }), 'VERIFICATION_FAILURE', 'FRAME_MISMATCH'), 'HARNESS changed frame refused');
    ok(refusedAs(await ho1({ scanSha: H('x') }), 'VERIFICATION_FAILURE', 'SCAN_MISMATCH'), 'HARNESS replaced scan refused');
    ok(refusedAs(await ho1({ resolver: { head: '0'.repeat(40), clean: true, providerConfigurationSha: PROVIDER_SHA, envFiles: [] } }), 'VERIFICATION_FAILURE', 'RESOLVER_MISMATCH'), 'HARNESS resolver at another commit refused');
    ok(refusedAs(await ho1({ resolver: { head: FROZEN_SHA, clean: false, providerConfigurationSha: PROVIDER_SHA, envFiles: [] } }), 'VERIFICATION_FAILURE', 'RESOLVER_MISMATCH'), 'HARNESS resolver with working-tree changes refused');
    ok(refusedAs(await ho1({ resolver: { head: FROZEN_SHA, clean: true, providerConfigurationSha: PROVIDER_SHA, envFiles: ['.env.local'] } }), 'VERIFICATION_FAILURE', 'RESOLVER_ENV_FILES'), 'HARNESS resolver clone holding an environment file (credentials) refused');
    ok(refusedAs(await ho1({ resolver: { head: FROZEN_SHA, clean: true, providerConfigurationSha: H('x'), envFiles: [] } }), 'VERIFICATION_FAILURE', 'PROVIDER_CONFIG_MISMATCH'), 'HARNESS provider configuration differing from the registered hash refused');
    ok(refusedAs(await ho1({ registration: { ...reg, as_of: 'UNASSIGNED' }, identityRegistrations: [{ ...reg, as_of: 'UNASSIGNED' }] }), 'VERIFICATION_FAILURE', 'REGISTRATION_INVALID'), 'HARNESS registration without the frozen asOf refused');
    ok(refusedAs(await ho1({ identityRegistrations: [] }), 'VERIFICATION_FAILURE', 'AUTHORITY_INVALID'), 'HARNESS registration absent from the registry listing refused');
    ok(refusedAs(await ho1({ identityRegistrations: [reg, { ...reg, registration_id: 'SYNTHETIC-REG-DUP', registration_timestamp: isoOf(timeAt(S0 + 10) + 900), outpoints: { ...reg.outpoints, 'held-out': `${H('dup-slot')}:0` } }] }), 'VERIFICATION_FAILURE', 'STUDY_VOID_REGISTRATION'), 'HARNESS duplicate registration → study VOID refused');
    ok(refusedAs(await ho1({ devManifest: { ...dev, registration_id: 'SYNTHETIC-OTHER' } }), 'VERIFICATION_FAILURE', 'STUDY_MISMATCH'), 'HARNESS development manifest of another registration refused');
    ok(refusedAs(await ho1({ hoManifest: { ...ho, study_id: 'CPG-U1-OTHER' } }), 'VERIFICATION_FAILURE', 'STUDY_MISMATCH'), 'HARNESS held-out manifest of another study refused');
    ok(refusedAs(await ho1({ devManifest: { ...dev, protocol_sha256: H('x') } }), 'VERIFICATION_FAILURE', 'MANIFEST_BINDING_MISMATCH'), 'HARNESS development manifest bound to another protocol refused');
    ok(refusedAs(await ho1({ hoManifest: { ...ho, registry_sha256: H('x') } }), 'VERIFICATION_FAILURE', 'MANIFEST_BINDING_MISMATCH'), 'HARNESS held-out manifest bound to another registry refused');
    ok(refusedAs(await ho1({ hoManifest: { ...ho, scan_sha256: H('x') } }), 'VERIFICATION_FAILURE', 'SCAN_MISMATCH'), 'HARNESS held-out manifest with a replaced scan refused');
    ok(refusedAs(await ho1({ hoManifest: { ...ho, frame_hash: H('x') } }), 'VERIFICATION_FAILURE', 'FRAME_MISMATCH'), 'HARNESS held-out manifest with another frame refused');
    ok(refusedAs(await ho1({ evidence: { ...evFull, drand: { ...evFull.drand, beacons: [ROUND[1]] } } }), 'VERIFICATION_FAILURE', 'COMMITMENT_NOT_FINAL'), 'HARNESS held-out randomness (drand round) not verifiable → refused');
    ok(refusedAs(await ho1({ evidence: rj('ev_dev.json') }), 'VERIFICATION_FAILURE', 'COMMITMENT_NOT_FINAL'), 'HARNESS held-out commitment absent → refused');
    ok(refusedAs(await ho1({ evidence: { ...evFull, headers_crosscheck: rj('arch_bad.json') } }), 'VERIFICATION_FAILURE', 'EVIDENCE_INVALID'), 'HARNESS invalid chain evidence (sources disagree) refused');
    ok(refusedAs(await ho1({ hoManifest: { ...ho, sampling: { ...ho.sampling, drand_randomness: H('substituted') } } }), 'VERIFICATION_FAILURE', 'SAMPLING_RECORD_MISMATCH'), 'HARNESS held-out manifest with a substituted randomness record refused');
    ok(refusedAs(await ho1({ devManifest: { ...dev, sampling: { ...dev.sampling, drand_randomness: H('substituted') } } }), 'VERIFICATION_FAILURE', 'SAMPLING_RECORD_MISMATCH'), 'HARNESS development manifest with a substituted randomness record refused');
    ok(refusedAs(await ho1({ devManifest: { ...dev, sampling: { ...dev.sampling, randomness_block_hash: H('pre-reorg') } } }), 'VERIFICATION_FAILURE', 'STUDY_VOID'), 'HARNESS development record contradicted by the chain → study VOID, refused');
    ok(refusedAs(await ho1({ seal: { ...seal, status: 'EXECUTED' } }), 'VERIFICATION_FAILURE', 'AUTHORIZATION_UNBUILDABLE'), 'HARNESS altered seal refused');

    // window, candidate set
    ok(refusedAs(await ho1({}, undefined, '2023-09-30T23:59:59Z'), 'PREVIEW_ATTEMPT', 'WINDOW_NOT_OPEN'), 'HARNESS FUTURE WINDOW: held-out execution before the seal publication = PREVIEW ATTEMPT, refused');
    ok(refusedAs(await ho1({}, { run_id: 'ho-refused', candidate_ids: [devIds[0]] }, '2023-09-30T23:59:59Z'), 'EXECUTION_REFUSED', 'WINDOW_NOT_OPEN'), 'HARNESS before the window, a request without held-out companies is refused (not a preview)');
    ok(refusedAs(await ho1({}, { run_id: 'ho-refused', candidate_ids: hoIds.slice(1) }), 'MALFORMED_EXECUTION', 'CANDIDATES_NOT_AUTHORIZED_SET'), 'HARNESS subset of the authorized set refused (no selective execution)');
    ok(refusedAs(await ho1({}, { run_id: 'ho-refused', candidate_ids: [...hoIds, devIds[0]] }), 'MALFORMED_EXECUTION', 'CANDIDATES_NOT_AUTHORIZED_SET'), 'HARNESS authorized set plus a development company refused');
    const refEvents = EL.readEventLog(refusedLog).events;
    ok(refEvents.length > 1 && refEvents.slice(1).every((e) => EL.REFUSAL_TYPES.includes(e.type) && typeof e.code === 'string' && e.mode === 'held-out') && !existsSync(refusedArch), 'HARNESS every refused attempt is an auditable event; no archive written');
    ok(['VERIFICATION_FAILURE', 'PREVIEW_ATTEMPT', 'EXECUTION_REFUSED', 'MALFORMED_EXECUTION'].every((t) => refEvents.some((e) => e.type === t)), 'HARNESS log distinguishes verification failure, preview attempt, refusal and malformed request');

    // the single authorized execution
    const hoLog = P('h_ho.jsonl'); const hoArch = P('h_arch_ho');
    executed = [];
    const failing = async (x) => { if (x.candidate_id === hoIds[3]) throw new Error('synthetic network failure'); return synthExec(x); };
    const hr = await HA.runHeldOut({ ctx: hctx(), request: { run_id: 'ho-1', candidate_ids: [...hoIds].reverse() }, executor: failing, logPath: hoLog, archiveDir: hoArch, now: at(IN_WINDOW), allowSynthetic: true });
    ok(hr.status === 'EXECUTED' && hr.records.length === 51 && executed.length === 50 && canonicalJson(hr.invalid) === canonicalJson([hoIds[3]]), 'HARNESS AUTHORIZED EXECUTION: exactly the 51 authorized companies, once each; an executor failure is an INVALID observation, not a retry');
    const hEv = EL.readEventLog(hoLog).events;
    ok(hEv[1].as_of === reg.as_of && hEv[1].resolver_sha === FROZEN_SHA && hEv[1].provider_configuration_sha256 === PROVIDER_SHA && hEv[1].seal_hash === seal.seal_hash && hEv[1].authorization_sha256 === authz.authorization_sha256, 'HARNESS RUN_STARTED records §13.1 run metadata (asOf, resolver SHA, provider configuration hash, seal hash)');
    ok(hEv[hEv.length - 1].archive_merkle_root === AR.archiveMerkleRoot(hr.records).archive_merkle_root && hEv[hEv.length - 1].document_count === 50, 'HARNESS RUN_COMPLETED records the archive Merkle root and document count');
    ok(hEv.map((e) => e.type).join() === ['LOG_OPENED', 'RUN_STARTED', ...hoIds.map(() => 'AUTHORIZED_EXECUTION'), 'RUN_COMPLETED'].join() && hEv.filter((e) => e.type !== 'LOG_OPENED').every((e) => e.authorization_sha256 === authz.authorization_sha256), 'HARNESS authorized run events bind the authorization hash');
    ok(hr.records.every((r) => AR.verifyArchiveRecord(r).length === 0 && r.stage === 'held-out' && r.run_kind === 'held-out-authorized' && r.input.asOf === reg.as_of && r.input.companyId === HA.FIXTURE_COMPANY_ID && r.input.linkedinUrl === null), 'HARNESS archive: held-out records carry stage identity, the registered asOf and the §7 input only');
    executed = [];
    const again = await HA.runHeldOut({ ctx: hctx(), request: { run_id: 'ho-2', candidate_ids: hoIds }, executor: synthExec, logPath: hoLog, archiveDir: hoArch, now: at('2023-10-03T00:00:00Z'), allowSynthetic: true });
    ok(again.status === 'REFUSED' && again.type === 'POST_WINDOW_EXECUTION' && again.code === 'WINDOW_CLOSED' && executed.length === 0 && !existsSync(join(hoArch, 'ho-2')), 'HARNESS REPEATED EXECUTION after completion = POST-WINDOW, refused');
    const again2 = await HA.runHeldOut({ ctx: hctx(), request: { run_id: 'ho-1', candidate_ids: hoIds }, executor: synthExec, logPath: hoLog, archiveDir: hoArch, now: at('2023-10-03T00:00:00Z'), allowSynthetic: true });
    ok(again2.type === 'POST_WINDOW_EXECUTION' && executed.length === 0, 'HARNESS re-running the same run id after completion refused');
    const combined = HA.executionLogFromEvents([...EL.readEventLog(pilotLog).events, ...EL.readEventLog(hoLog).events]);
    ok(EX.auditExecutionLog(authz, combined).state === 'NO_VIOLATION_IN_LOG', 'HARNESS derived execution log (pilot + authorized run) audits clean');
    ok(EX.auditExecutionLog(authz, HA.executionLogFromEvents([...EL.readEventLog(hoLog).events, ...hEv.slice(1, 3).map((e, i) => ({ ...e, run_id: 'shadow', type: i === 0 ? 'RUN_STARTED' : 'AUTHORIZED_EXECUTION' }))])).findings.some((x) => x.state === 'STUDY_VOID_REPEATED_EXECUTION'), 'HARNESS derived log: a second authorized run would be VOID on audit');

    // interrupted run: no restart, no resumption; close marks the unexecuted companies INVALID
    const intLog = P('h_int.jsonl'); const intArch = P('h_arch_int');
    EL.appendEvent(intLog, 'LOG_OPENED', IN_WINDOW, {});
    EL.appendEvent(intLog, 'RUN_STARTED', IN_WINDOW, { run_id: 'int-1', authorization_sha256: authz.authorization_sha256, candidate_ids: hoIds });
    EL.appendEvent(intLog, 'AUTHORIZED_EXECUTION', IN_WINDOW, { run_id: 'int-1', candidate_id: hoIds[0], archive_record_sha256: H('rec'), executor_error: null, authorization_sha256: authz.authorization_sha256 });
    executed = [];
    const restart = await HA.runHeldOut({ ctx: hctx(), request: { run_id: 'int-2', candidate_ids: hoIds }, executor: synthExec, logPath: intLog, archiveDir: intArch, now: at('2023-10-02T05:00:00Z'), allowSynthetic: true });
    ok(restart.type === 'REPEATED_EXECUTION' && restart.code === 'RESTART_REFUSED' && executed.length === 0, 'HARNESS RESTART after interruption refused (REPEATED_EXECUTION)');
    const closed = HA.closeInterruptedRun({ logPath: intLog, authorization: authz, now: at('2023-10-02T06:00:00Z') });
    ok(closed.type === 'RUN_INTERRUPTED_CLOSED' && closed.invalid_unexecuted.length === 50 && !closed.invalid_unexecuted.includes(hoIds[0]), 'HARNESS interrupted run closed: the 50 unexecuted companies are INVALID, nothing executed');
    throws(() => HA.closeInterruptedRun({ logPath: intLog, authorization: authz, now: at('2023-10-02T07:00:00Z') }), 'HARNESS closing an already closed run refused');
    throws(() => HA.closeInterruptedRun({ logPath: P('h_none.jsonl'), authorization: authz, now: at('2023-10-02T07:00:00Z') }), 'HARNESS closing when no run started refused');
    const afterClose = await HA.runHeldOut({ ctx: hctx(), request: { run_id: 'int-3', candidate_ids: hoIds }, executor: synthExec, logPath: intLog, archiveDir: intArch, now: at('2023-10-02T08:00:00Z'), allowSynthetic: true });
    ok(afterClose.type === 'POST_WINDOW_EXECUTION' && executed.length === 0, 'HARNESS execution after an interrupted run was closed = POST-WINDOW, refused');
    {
      const lines = readFileSync(hoLog, 'utf8').split('\n').filter(Boolean);
      const dropped = [...lines.slice(0, 5), ...lines.slice(6)];
      writeFileSync(P('h_ho_dropped.jsonl'), `${dropped.join('\n')}\n`);
      executed = [];
      const r = await HA.runHeldOut({ ctx: hctx(), request: { run_id: 'ho-3', candidate_ids: hoIds }, executor: synthExec, logPath: P('h_ho_dropped.jsonl'), archiveDir: hoArch, now: at('2023-10-04T00:00:00Z'), allowSynthetic: true });
      ok(r.status === 'REFUSED' && r.code === 'EVENT_LOG_BROKEN' && r.logged === false && executed.length === 0 && !existsSync(join(hoArch, 'ho-3')), 'HARNESS a broken (event deleted) log fails closed: nothing executes, refusal reported as unlogged');
      writeFileSync(P('h_ho_truncated.jsonl'), '');
      executed = [];
      const t = await HA.runHeldOut({ ctx: hctx(), request: { run_id: 'ho-4', candidate_ids: hoIds }, executor: synthExec, logPath: P('h_ho_truncated.jsonl'), archiveDir: P('h_arch_trunc'), now: at('2023-10-04T00:00:00Z'), allowSynthetic: true });
      ok(t.status === 'EXECUTED' && executed.length === 51, 'HARNESS LIMITATION (documented): a substituted/empty event log is not detectable by the harness itself — the published head hash is the procedural control');
    }
  }

  // ── CPG-044: execution harness CLI ──
  {
    writeFileSync(P('synth_exec.mjs'), `export default async function ({ candidate_id }) {
  const host = 'https://' + String(candidate_id).toLowerCase() + '.example';
  const view = (field, effectiveValue, evidence, status) => ({ field, status, evidenceState: evidence.length ? 'EFFECTIVE' : null, effectiveValue, prefilled: status === 'PUBLICLY_VERIFIED' && effectiveValue !== null, evidence });
  const ev = (value, sourceUrl) => ({ value, sourceName: 'SYNTHETIC source', sourceUrl, identity: 'DECISIVE', identityReason: 'synthetic', authority: 'authoritative', providerFamily: 'synthetic-family' });
  const response = { facts: { founded_year: '1999', team_size: null, revenue_range: null }, matched_label: 'SYNTHETIC-CO', source: 'cpg_grounding',
    grounding: { domain: String(candidate_id).toLowerCase() + '.example', asOf: '2026-09-01T00:00:00Z',
      facts: { founded_year: view('founded_year', '1999', [ev('1999', host + '/about'), ev('1999', host + '/about'), ev('2001', host + '/history')], 'PUBLICLY_VERIFIED'),
        team_size: view('employee_count', '120', [ev('120', host + '/careers')], 'PUBLICLY_REPORTED'),
        revenue_range: view('revenue_range', null, [], 'UNVERIFIED') },
      wikidata: { label: 'SYNTHETIC-CO', url: 'https://synthetic-wikidata.example/entity/Q1', identity: 'DECISIVE', identityReason: 'synthetic' },
      registryIdentities: [], registryUnavailable: [], registryAmbiguity: [], unavailableSources: [],
      message: { basis: null, identityNote: null, notPrefilled: [], nothingPrefilled: 'synthetic' } } };
  return { raw_response: JSON.stringify(response), executor_error: null,
    started_at: '2023-10-02T00:00:00Z', completed_at: '2023-10-02T00:00:01Z', executor: { kind: 'synthetic-cli' }, exchanges: [], wikidata_calls: [], http_events: [] };
}\n`);
    const common = ['--registration', P('registration.json'), '--identity-registrations', P('identity_regs.json'), '--protocol', PROTOCOL, '--frame', P('frame.csv'), '--scan', P('scan.json'), '--registry', regPath, '--dev-manifest', P('dev/manifest.json'), '--evidence', P('ev_full.json'), '--allow-synthetic', '--synthetic-executor', P('synth_exec.mjs')];
    const envAt = (t) => ({ CPG_U1_HARNESS_NOW: t });
    const devIds = dev.development.map((e) => e.candidate_id);
    ok(run(['harness-pilot', ...common, '--run-id', 'cli-pilot', '--candidates', devIds.join(','), '--log', P('c_events.jsonl'), '--archive-dir', P('c_arch')], { env: envAt('2023-09-01T00:00:00Z') }).includes(`EXECUTED: ${devIds.length} companies`), 'CLI harness-pilot executes the development companies');
    ok(run(['harness-pilot', ...common, '--run-id', 'cli-peek', '--candidates', authz.held_out_candidate_ids[0], '--log', P('c_events.jsonl'), '--archive-dir', P('c_arch')], { expectCode: 1, env: envAt('2023-09-01T01:00:00Z') }).includes('PREVIEW_ATTEMPT'), 'CLI harness-pilot PREVIEW ATTEMPT refused (exit 1)');
    const hoArgs = [...common, '--held-out-manifest', P('ho/manifest.json'), '--seal', P('SEAL.json'), '--seal-publication', P('seal_publication.json'), '--log', P('c_events.jsonl'), '--archive-dir', P('c_arch')];
    ok(run(['harness-held-out', ...hoArgs, '--run-id', 'cli-ho-x', '--authorization', P('no_such_authorization.json')], { expectCode: 1, env: envAt('2023-10-02T00:00:00Z') }).includes('AUTHORIZATION_MISSING'), 'CLI harness-held-out without an authorization refused');
    ok(run(['harness-held-out', ...hoArgs, '--run-id', 'cli-ho-early', '--authorization', P('authorization.json')], { expectCode: 1, env: envAt('2023-09-30T00:00:00Z') }).includes('PREVIEW_ATTEMPT WINDOW_NOT_OPEN'), 'CLI harness-held-out before the window = PREVIEW ATTEMPT refused');
    wj('reg_asof_changed.json', { ...reg, as_of: '2026-01-01T00:00:00Z' }); wj('ids_asof_changed.json', [{ ...reg, as_of: '2026-01-01T00:00:00Z' }]);
    ok(run(['harness-held-out', ...hoArgs.map((x) => (x === P('registration.json') ? P('reg_asof_changed.json') : x === P('identity_regs.json') ? P('ids_asof_changed.json') : x)), '--run-id', 'cli-ho-asof', '--authorization', P('authorization.json')], { expectCode: 1, env: envAt('2023-10-02T00:00:00Z') }).includes('AUTHORIZATION_'), 'CLI harness-held-out with a registration differing from the authorized one refused');
    ok(run(['harness-held-out', ...hoArgs, '--run-id', 'cli-ho', '--authorization', P('authorization.json')], { env: envAt('2023-10-02T00:00:00Z') }).includes('EXECUTED: 51 companies'), 'CLI harness-held-out: the single authorized run executes the 51 authorized companies');
    ok(run(['harness-held-out', ...hoArgs, '--run-id', 'cli-ho-again', '--authorization', P('authorization.json')], { expectCode: 1, env: envAt('2023-10-03T00:00:00Z') }).includes('POST_WINDOW_EXECUTION'), 'CLI harness-held-out repeated after completion refused (POST_WINDOW)');
    const vel = run(['verify-event-log', '--log', P('c_events.jsonl'), '--authorization', P('authorization.json')]);
    ok(vel.includes('event log intact') && vel.includes('NO_VIOLATION_IN_LOG') && vel.includes('cannot prove') && vel.includes('PREVIEW_ATTEMPT') && vel.includes('POST_WINDOW_EXECUTION'), 'CLI verify-event-log: chain intact, counts per event type, derived audit clean, limitation stated');
    const cl = readFileSync(P('c_events.jsonl'), 'utf8').split('\n').filter(Boolean);
    const pvi = cl.findIndex((l) => l.includes('"type":"PREVIEW_ATTEMPT"'));
    writeFileSync(P('c_events_edit.jsonl'), `${cl.map((l, i) => (i === pvi ? l.replace('"type":"PREVIEW_ATTEMPT"', '"type":"EXECUTION_REFUSED"') : l)).join('\n')}\n`);
    ok(run(['verify-event-log', '--log', P('c_events_edit.jsonl')], { expectCode: 1 }).includes('EVENT_LOG_BROKEN'), 'CLI verify-event-log: a relabelled preview attempt is detected');
    const hoRecPath = join(P('c_arch'), 'cli-ho', `${authz.held_out_candidate_ids[0]}.json`);
    ok(run(['verify-archive-record', '--record', hoRecPath]).includes('intact'), 'CLI verify-archive-record');
    ok(run(['archive-merkle-root', '--archive-dir', join(P('c_arch'), 'cli-ho')]).includes(`archive_merkle_root: ${AR.archiveMerkleRoot(authz.held_out_candidate_ids.map((id) => JSON.parse(readFileSync(join(P('c_arch'), 'cli-ho', `${id}.json`), 'utf8')))).archive_merkle_root}`) && EL.readEventLog(P('c_events.jsonl')).events.some((e) => e.type === 'RUN_COMPLETED' && e.document_count === 0), 'CLI archive-merkle-root recomputes the root recorded at run completion');
    wj('rec_tampered.json', { ...JSON.parse(readFileSync(hoRecPath, 'utf8')), candidate_id: authz.held_out_candidate_ids[1] });
    ok(run(['verify-archive-record', '--record', P('rec_tampered.json')], { expectCode: 1 }).includes('ARCHIVE_RECORD_INVALID'), 'CLI verify-archive-record: re-attributed record refused');
    const pOut = run(['pilot-result', '--archive-dir', join(P('c_arch'), 'cli-pilot'), '--dev-manifest', P('dev/manifest.json'), '--out', P('pilot_archive.json')]);
    ok(pOut.includes('derived from') && rj('pilot_archive.json').derived_from_archive === true, 'CLI pilot-result derived from the archived pilot run');
    ok(run(['size', '--dev-manifest', P('dev/manifest.json'), '--pilot', P('pilot_archive.json'), '--out', P('sizing_archive.json')]).includes('held-out quotas') && canonicalJson(rj('sizing_archive.json').quotas) === canonicalJson(sizing.quotas), 'CLI size accepts the archive-derived pilot result (same quotas as the equivalent pilot file)');
    const evOut = run(['evaluation-items', '--archive-dir', join(P('c_arch'), 'cli-ho'), '--reference', P('reference.csv'), '--out', P('eval_from_archive.json')]);
    const evItems = rj('eval_from_archive.json');
    ok(evOut.includes('cpg-u1-cited-urls/field-evidence-union/v1') && evItems.length === 51 * 3 && !evOut.includes('UNDECIDED'), 'CLI evaluation-items derives items from the archive under §12.3 Rule A (no undecided rule)');
    ok(evItems.every((it) => Array.isArray(it.cpg_source_urls) && it.cpg_source_urls.every((u) => /^https:\/\//.test(u)) && new Set(it.cpg_source_urls).size === it.cpg_source_urls.length), 'CLI evaluation items: cited URLs are https and duplicate-free');
    { const hoId = authz.held_out_candidate_ids[0]; const host = 'https://' + hoId.toLowerCase() + '.example';
      const byField = (fld) => evItems.find((it) => it.candidate_id === hoId && it.field === fld).cpg_source_urls;
      ok(canonicalJson(byField('founded_year')) === canonicalJson([host + '/about', host + '/history'])
        && canonicalJson(byField('employee_count')) === canonicalJson([host + '/careers'])
        && canonicalJson(byField('revenue_range')) === canonicalJson([]), 'CLI evaluation items: Rule-A set per field from the archived response (duplicate collapsed, disagreeing record kept, empty evidence → empty set)'); }
    run(['rater-packet', '--held-out-manifest', P('ho/manifest.json'), '--seal', P('SEAL.json'), '--evaluation', P('eval_from_archive.json'), '--label', 'rater-2', '--out', P('packet_from_archive.json')]);
    ok(run(['verify-rater-packet', '--held-out-manifest', P('ho/manifest.json'), '--seal', P('SEAL.json'), '--evaluation', P('eval_from_archive.json'), '--label', 'rater-2', '--packet', P('packet_from_archive.json')]).includes('byte-identical'), 'CLI: a rater packet built from archive-derived evaluation items verifies byte-identically');
    ok(rj('packet_from_archive.json').cited_url_rule === 'cpg-u1-cited-urls/field-evidence-union/v1', 'CLI rater packet records the §12.3 rule id');
    ok(run(['evaluation-items', '--archive-dir', join(P('c_arch'), 'cli-ho'), '--reference', P('reference.csv'), '--out', P('eval_from_archive.json')], { expectCode: 1 }).includes('write-once'), 'CLI evaluation-items write-once');
    const refRows = parseCsv(readFileSync(P('reference.csv'), 'utf8')).records;
    const evalItems = authz.held_out_candidate_ids.flatMap((id) => FIELDS3.map((f) => ({ candidate_id: id, field: f, cpg_value: f === 'founded_year' ? '1999' : null, cpg_source_urls: f === 'founded_year' ? ['https://synthetic.example/about'] : [], reference_record: refRows.find((r) => r.candidate_id === id && r.field === f) })));
    wj('eval_items.json', evalItems);
    const rpArgs = ['--held-out-manifest', P('ho/manifest.json'), '--seal', P('SEAL.json'), '--evaluation', P('eval_items.json')];
    ok(run(['rater-packet', ...rpArgs, '--label', 'rater-1', '--out', P('packet_r1.json')]).includes('153 items'), 'CLI rater-packet: 153 items for rater 1');
    ok(run(['rater-packet', ...rpArgs, '--label', 'rater-1', '--out', P('packet_r1b.json')]) && readFileSync(P('packet_r1.json')).equals(readFileSync(P('packet_r1b.json'))), 'CLI rater-packet: independent rebuild is byte-identical');
    ok(run(['verify-rater-packet', ...rpArgs, '--label', 'rater-1', '--packet', P('packet_r1.json')]).includes('byte-identical'), 'CLI verify-rater-packet accepts the deterministic packet');
    ok(run(['verify-rater-packet', ...rpArgs, '--label', 'rater-2', '--packet', P('packet_r1.json')], { expectCode: 1 }).includes('RATER_PACKET_MISMATCH'), 'CLI verify-rater-packet: rater 1 packet presented as rater 2 refused');
    const pk = rj('packet_r1.json'); wj('packet_swapped.json', { ...pk, items: [pk.items[1], pk.items[0], ...pk.items.slice(2)] });
    ok(run(['verify-rater-packet', ...rpArgs, '--label', 'rater-1', '--packet', P('packet_swapped.json')], { expectCode: 1 }).includes('RATER_PACKET_MISMATCH'), 'CLI verify-rater-packet: substituted order refused');
    ok(run(['rater-packet', '--held-out-manifest', P('hoF/manifest.json'), '--seal', P('SEAL.json'), '--evaluation', P('eval_items.json'), '--label', 'rater-1', '--out', P('packet_forged.json')], { expectCode: 1 }) && !existsSync(P('packet_forged.json')), 'CLI rater-packet refuses a forged held-out record');
    // close-interrupted over a synthetic interrupted log
    EL.appendEvent(P('c_int.jsonl'), 'LOG_OPENED', '2023-10-02T00:00:00Z', {});
    EL.appendEvent(P('c_int.jsonl'), 'RUN_STARTED', '2023-10-02T00:00:00Z', { run_id: 'cli-int', authorization_sha256: authz.authorization_sha256, candidate_ids: authz.held_out_candidate_ids });
    ok(run(['harness-close-interrupted', '--log', P('c_int.jsonl'), '--authorization', P('authorization.json'), '--registration', P('registration.json'), '--allow-synthetic'], { env: envAt('2023-10-02T01:00:00Z') }).includes('Nothing was executed'), 'CLI harness-close-interrupted closes without executing');
    // the CLI reads the resolver state itself: a clone at the frozen SHA with working-tree changes is refused
    {
      const dirty = P('dirty_clone');
      execFileSync('git', ['clone', '--quiet', '--shared', '--no-checkout', CLEAN_CLONE, dirty]);
      execFileSync('git', ['-C', dirty, 'checkout', '--quiet', FROZEN_SHA, '--', 'backend/services/companyProfile/grounding/registry']);
      // a CLEAN sparse clone at the frozen SHA that holds an ignored .env.local: refused for its environment file
      const withEnv = P('envfile_clone');
      execFileSync('git', ['clone', '--quiet', '--shared', '--no-checkout', CLEAN_CLONE, withEnv]);
      execFileSync('git', ['-C', withEnv, 'sparse-checkout', 'set', '--no-cone', 'backend/services/companyProfile/grounding/registry/']);
      execFileSync('git', ['-C', withEnv, 'checkout', '--quiet', FROZEN_SHA]);
      writeFileSync(join(withEnv, '.env.local'), 'SYNTHETIC=1\n'); writeFileSync(join(withEnv, '.env.example'), 'SYNTHETIC=1\n');
      const envOut = run(['harness-pilot', ...common, '--run-id', 'cli-envfile', '--candidates', devIds[0], '--log', P('c_envfile.jsonl'), '--archive-dir', P('c_arch')], { expectCode: 1, env: { ...envAt('2023-09-02T00:00:00Z'), CPG_U1_RESOLVER_CLONE: withEnv } });
      ok(envOut.includes('RESOLVER_ENV_FILES') && envOut.includes('.env.local') && !envOut.includes('.env.example'), 'CLI harness refuses a clean resolver clone holding an environment file (.example templates ignored)');
      ok(run(['harness-pilot', ...common, '--run-id', 'cli-dirty', '--candidates', devIds[0], '--log', P('c_dirty.jsonl'), '--archive-dir', P('c_arch')], { expectCode: 1, env: { ...envAt('2023-09-02T00:00:00Z'), CPG_U1_RESOLVER_CLONE: dirty } }).includes('RESOLVER_MISMATCH'), 'CLI harness refuses a resolver clone with working-tree changes');
    }
    // test-only switches refused outside a synthetic registration
    wj('reg_mainnet.json', { ...reg, network: 'bitcoin-mainnet' });
    ok(run(['harness-pilot', ...common.map((x) => (x === P('registration.json') ? P('reg_mainnet.json') : x)), '--run-id', 'cli-main', '--candidates', devIds[0], '--log', P('c_main.jsonl'), '--archive-dir', P('c_arch')], { expectCode: 1 }).includes('--synthetic-executor is refused'), 'CLI synthetic executor refused outside a synthetic-test registration');
    ok(run(['harness-close-interrupted', '--log', P('c_int.jsonl'), '--authorization', P('authorization.json'), '--registration', P('reg_mainnet.json')], { expectCode: 1, env: envAt('2023-10-02T01:00:00Z') }).includes('test clock'), 'CLI test clock refused outside a synthetic-test registration');
  }


  // ── 15. Omnivyra regression: the CPG-035 honest-unknown record is now REPRESENTABLE ──
  const omni = {
    candidate_id: 'OMNIVYRA-DEV-SMOKE', company_name: 'Omnivyra', canonical_domain: 'UNKNOWN', jurisdiction_family: 'UNKNOWN',
    identifier_scheme: 'UNKNOWN', identifier_value: '', wikidata_qid: '', identifier_domain_evidence_url: '', identifier_domain_evidence_note: '',
    expected_outcome_class: 'unknown', identity_hazard_note: '', a1_operating_legal_entity: 'unknown', a2_domain_controlled_https: 'unknown',
    a4_tie_independent_of_cpg: 'unknown', a6_reference_obtainable: 'unknown', c1_2_used_in_cpg_work: 'yes', c1_3_values_derived_from_cpg: 'unknown',
    c1_4_prior_cpg_execution: 'unknown', c1_5_internal_or_owned: 'yes', enumerated_by: 'cpg-implementer-NOT-INDEPENDENT', enumerated_at: '2026-09-16',
    enumeration_source_url: 'https://github.com/kulrashm-jpg/Omnivyra',
  };
  const oc = checkFrameRow(omni);
  ok(oc.errors.length === 0, 'OMNIVYRA: honest-unknown record is no longer malformed');
  ok(oc.exclusion === 'A1_NOT_ESTABLISHED', 'OMNIVYRA: inadmissible as NOT ESTABLISHED (not "not operating")');
  ok(oc.contamination.some((b) => b.includes('C1(5)')) && oc.contamination.some((b) => b.includes('C1(2)')), 'OMNIVYRA: held-out-ineligible by attestation');
  ok(registryMatches(omni, JSON.parse(readFileSync(REGISTRY, 'utf8'))).some((x) => x.entry_id === 'DEV-001'), 'OMNIVYRA: registry DEV-001 regardless of attestations or scanner');

  // ── 16. DETECTOR against the clean clone (scope + real registry) ──────────
  if (existsSync(CLEAN_CLONE)) {
    serial = 5000;
    const probe = [
      { ...row('fill-expected'), candidate_id: 'PROBE-CF', company_name: 'Cloudflare', canonical_domain: 'cloudflare.com' },
      { ...row('fill-expected'), candidate_id: 'PROBE-TE', company_name: 'Tesco', canonical_domain: 'tesco.com' },
      { ...row('fill-expected'), candidate_id: 'PROBE-CA', company_name: 'Calendly', canonical_domain: 'calendly.com' },
      { ...row('fill-expected'), candidate_id: 'PROBE-OM', company_name: 'Omnivyra', canonical_domain: 'UNKNOWN' },
      { ...row('fill-expected'), candidate_id: 'PROBE-NEG', company_name: 'SYNTHETIC-ZQXW-NOMATCH', canonical_domain: 'synthetic-zqxw-nomatch.example' },
    ];
    writeFileSync(P('probe.csv'), toCsv(FRAME_COLUMNS, probe));
    const out = run(['scan', '--frame', P('probe.csv'), '--repo', CLEAN_CLONE, '--expect-sha', FROZEN_SHA, '--registry', REGISTRY, '--out', P('probe_scan.json')]);
    const s = JSON.parse(readFileSync(P('probe_scan.json'), 'utf8'));
    const r = (id) => s.results.find((x) => x.candidate_id === id);
    ok(['PROBE-CF', 'PROBE-TE', 'PROBE-CA', 'PROBE-OM'].every((id) => r(id).held_out_ineligible_by_scan), 'DETECTOR: Cloudflare/Tesco/Calendly/Omnivyra flagged');
    ok(r('PROBE-OM').registry_matches.some((m) => m.entry_id === 'DEV-001'), 'DETECTOR: Omnivyra flagged by registry');
    ok(r('PROBE-OM').repository_hits.some((h) => h.scope === 'CPG_IMPLEMENTATION'), 'DETECTOR: Omnivyra found in CPG implementation scope');
    ok(!r('PROBE-NEG').held_out_ineligible_by_scan, 'DETECTOR: synthetic negative control not flagged');
    ok(s.files_scanned.TEST > 0 && s.files_scanned.CPG_IMPLEMENTATION > 0, 'DETECTOR: both scopes scanned');
    ok(run(['scan', '--frame', P('probe.csv'), '--repo', CLEAN_CLONE, '--expect-sha', FROZEN_SHA, '--registry', REGISTRY, '--out', P('probe_scan.json')], { expectCode: 1 }).includes('write-once'), 'DETECTOR: scan write-once');
    ok(run(['scan', '--frame', P('probe.csv'), '--repo', CLEAN_CLONE, '--expect-sha', '0'.repeat(40), '--registry', REGISTRY, '--out', P('x.json')], { expectCode: 1 }).includes('FROZEN'), 'DETECTOR: wrong SHA refused');
    console.log(`detector: ${out.split('\n').slice(0, 7).join(' | ')}`);
  } else failures.push(`DETECTOR skipped: ${CLEAN_CLONE} missing`);
} catch (e) {
  failures.push(`SELFTEST CRASHED in the end-to-end section: ${String(e?.message ?? e).slice(0, 300)}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}

summaryPrinted = true;
console.log(`\nselftest: ${pass} passed, ${failures.length} failed`);
for (const f of failures) console.log(`  FAIL: ${f}`);
process.exit(failures.length ? 1 : 0);
