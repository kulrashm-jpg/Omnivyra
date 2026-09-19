// Adapter conformance test (CPG-044). Runs the REAL frozen resolver code through harness/cpgAdapter.ts under the
// resolver's own tsx, fully offline: synthetic companies, a synthetic fetcher and a synthetic Wikidata lookup injected
// in place of the network. Verifies recording, archive integrity, deterministic replay, replay-miss detection, and
// header capture from undici's diagnostics channel (loopback server only). Requires CPG_U1_RESOLVER_CLONE with the
// resolver's dependencies installed; refuses to start otherwise.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { archiveMerkleRoot, buildArchiveRecord, compareReplay, verifyArchiveRecord } from '../lib/archive.mjs';
import { PINNED_ENV, probeEnvironment, replayRecord } from '../lib/cpgExecutor.mjs';
import { CITED_URL_RULE, extractCitedUrls } from '../lib/raterPackets.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLONE = process.env.CPG_U1_RESOLVER_CLONE;
const stop = (m) => { console.error(`ADAPTER CONFORMANCE PRECONDITION FAILED: ${m}`); process.exit(2); };
if (!CLONE || !existsSync(CLONE)) stop('CPG_U1_RESOLVER_CLONE is not set or missing');
if (!existsSync(join(CLONE, 'node_modules', 'tsx', 'dist', 'cli.mjs'))) stop('resolver dependencies are not installed in CPG_U1_RESOLVER_CLONE');
const head = execFileSync('git', ['-C', CLONE, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (head !== 'f01a7eb4199be4e04d4fee7fc0116303949dc553') stop(`resolver clone is at ${head}, not the frozen SHA`);

let pass = 0; const failures = [];
const ok = (c, n) => { if (c) pass++; else failures.push(n); };

const work = mkdtempSync(join(tmpdir(), 'cpg044-adapter-'));
try {
  // a TS driver that injects synthetic dependencies into the adapter's exported recorder
  const driver = join(work, 'driver.ts');
  writeFileSync(driver, `
import http from 'node:http';
import { recordLookup } from ${JSON.stringify(`file:///${join(HERE, '..', 'harness', 'cpgAdapter.ts').replace(/\\/g, '/')}`)};
const clone = process.env.CPG_U1_RESOLVER_CLONE!.replace(/\\\\/g, '/');
async function main() {
  const cpg = await import('file:///' + clone + '/backend/services/companyProfile/grounding/companyFactsLookup.ts');
  const undici = await import('file:///' + clone + '/node_modules/undici/index.js');
  const srv = http.createServer((_q, s) => { s.setHeader('Last-Modified', 'Wed, 01 Jan 2025 00:00:00 GMT'); s.end(_q.url === '/global-probe' ? Buffer.from([0xff, 0xfe, 0x00, 0x53, 0x59, 0x4e]) : '<html><title>SYNTHETIC</title></html>'); }).listen(0);
  await new Promise((r) => srv.once('listening', r));
  const port = (srv.address() as any).port;
  const pages: Record<string, string> = {};
  // the synthetic fetcher performs ONE real loopback request (to prove header capture) and serves synthetic pages
  const fetcher = async (url: string) => {
    const probe = await undici.fetch('http://127.0.0.1:' + port + '/synthetic-probe'); const body = await probe.text();
    await (await globalThis.fetch('http://127.0.0.1:' + port + '/global-probe')).arrayBuffer();
    return { ok: true, status: 200, url, text: pages[url] ?? '<html><head><title>SYNTHETIC Adapter Co</title></head><body>' + body + ' synthetic-adapter.example</body></html>' };
  };
  const wikidataLookup = async (name: string) => (name === 'SYNTHETIC Adapter Co' ? null : null);
  const input = { companyId: 'CPG-U1-FIXTURE', companyName: 'SYNTHETIC Adapter Co', websiteUrl: 'https://synthetic-adapter.example', linkedinUrl: null, asOf: '2026-09-17T00:00:00Z' };
  const out = await recordLookup(input, { lookup: cpg.lookupGroundedCompanyFacts, fetcher, wikidataLookup });
  srv.close();
  process.stdout.write(JSON.stringify({ input, out }));
}
main().catch((e) => { process.stderr.write(String(e?.stack ?? e)); process.exit(1); });
`);
  const tsx = join(CLONE, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const { input, out } = JSON.parse(execFileSync(process.execPath, [tsx, driver], { cwd: CLONE, env: { ...process.env, CPG_U1_RESOLVER_CLONE: CLONE }, encoding: 'utf8', maxBuffer: 1 << 28 }));
  ok(typeof out.raw_response === 'string' && out.executor_error === null, 'real resolver lookup completed offline through the adapter recorder');
  ok(out.exchanges.length > 0 && out.exchanges.every((x) => typeof x.requested_url === 'string' && x.result && typeof x.result.text === 'string'), 'recording fetcher captured every exchange CPG requested');
  ok(out.http_events.some((h) => h.path === '/synthetic-probe' && h.status === 200 && h.headers.includes('Last-Modified') && h.headers.includes('Date')), 'response headers (Date, Last-Modified) captured from the undici diagnostics channel');
  const sp = out.http_events.filter((h) => h.path === '/synthetic-probe');
  ok(sp.length > 0 && sp.every((h) => h.complete && Buffer.from(h.body_base64, 'base64').toString('utf8') === '<html><title>SYNTHETIC</title></html>' && h.body_sha256 === createHash('sha256').update('<html><title>SYNTHETIC</title></html>').digest('hex')), 'RAW BODY BYTES: resolver undici response body captured byte-exact with SHA-256');
  const gp = out.http_events.filter((h) => h.path === '/global-probe');
  ok(gp.length === 1 && gp[0].complete && Buffer.from(gp[0].body_base64, 'base64').equals(Buffer.from([0xff, 0xfe, 0x00, 0x53, 0x59, 0x4e])), 'RAW BODY BYTES: Node bundled fetch (Wikidata adapter path) body captured byte-exact, including non-UTF-8 bytes');

  const rec = buildArchiveRecord({ study_id: 'CPG-U1-2026-01', registration_id: 'SYNTHETIC-REG', stage: 'development', run_id: 'synthetic-pilot', candidate_id: 'SYN-A1', input, execution: { ...out, executor: { kind: 'cpg-adapter', synthetic_dependencies: true } } });
  ok(verifyArchiveRecord(rec).length === 0, 'archive record of a real-resolver execution verifies');
  ok(archiveMerkleRoot([rec]).document_count === out.http_events.length && /^[0-9a-f]{64}$/.test(archiveMerkleRoot([rec]).archive_merkle_root), 'archive Merkle root over every captured document');
  { const t = JSON.parse(JSON.stringify(rec)); const i = t.replay.http_events.findIndex((h) => h.path === '/global-probe'); t.replay.http_events[i].body_base64 = Buffer.from('altered').toString('base64'); ok(verifyArchiveRecord(t).some((e) => e.includes('body_sha256')), 'altered captured body detected'); }
  // §12.3 Rule A over the REAL response shape the frozen resolver emits (not a synthetic fixture)
  {
    const response = JSON.parse(rec.canonical_response);
    const views = response.grounding.facts;
    const perField = { founded_year: 'founded_year', employee_count: 'team_size', revenue_range: 'revenue_range' };
    let ok3 = true; let shapeOk = true;
    for (const [field, key] of Object.entries(perField)) {
      const evidence = views?.[key]?.evidence;
      if (!Array.isArray(evidence) || !evidence.every((e) => Object.hasOwn(e, 'sourceUrl'))) { shapeOk = false; continue; }
      const expected = [...new Set(evidence.map((e) => e.sourceUrl).filter((u) => typeof u === 'string'))];
      const got = extractCitedUrls(rec, field);
      if (JSON.stringify(got) !== JSON.stringify(expected)) ok3 = false;
      if (JSON.stringify(got) !== JSON.stringify(extractCitedUrls(rec, field))) ok3 = false;
    }
    ok(shapeOk, 'REAL RESPONSE: every field evidence record of the frozen resolver states a sourceUrl (the §12.3 input exists in the live contract)');
    ok(ok3 && CITED_URL_RULE === 'cpg-u1-cited-urls/field-evidence-union/v1', 'REAL RESPONSE: §12.3 Rule A over the real response = ordered deduplicated field evidence URLs, repeatable');
  }
  process.env.CPG_U1_CONFORMANCE_SENTINEL = 'must-not-reach-the-adapter';
  const envProbe = await probeEnvironment(CLONE);
  ok(!envProbe.names.includes('CPG_U1_CONFORMANCE_SENTINEL') && envProbe.cache_kill_all === PINNED_ENV.CACHE_KILL_ALL, 'PINNED ENVIRONMENT: operator shell variables do not reach the adapter; every cache namespace killed (Wikidata adapter runs cold)');
  const replayed = await replayRecord(CLONE, rec);
  ok(replayed.misses.length === 0 && replayed.unused === 0, 'replay consumed exactly the recorded exchanges (no misses, none unused)');
  ok(compareReplay(rec, replayed.raw_response).identical, 'DETERMINISTIC REPLAY: replayed canonical response is byte-identical to the archive');
  const replayed2 = await replayRecord(CLONE, rec);
  ok(replayed2.raw_response === replayed.raw_response, 'replay is repeatable (identical raw bytes on a second replay)');

  const tampered = JSON.parse(JSON.stringify(rec));
  tampered.replay.exchanges[0].result.text = '<html><head><title>SYNTHETIC Different Co</title></head><body>other.example</body></html>';
  const tr = await replayRecord(CLONE, tampered);
  ok(verifyArchiveRecord(tampered).length > 0, 'tampered archive exchange detected by hash verification');
  ok(typeof tr.raw_response === 'string', 'tampered archive still replays (integrity is established by the hash check, not by replay)');
  ok(!compareReplay({ ...rec, canonical_response: '{"facts":{}}' }, replayed.raw_response).identical, 'a replay compared against a different archived response is reported as differing');
  const missing = JSON.parse(JSON.stringify(rec)); missing.replay.exchanges = [];
  const mr = await replayRecord(CLONE, missing);
  ok(mr.misses.length > 0, 'replay with a removed exchange reports a replay miss (never silently refetches)');
} catch (e) {
  failures.push(`adapter conformance crashed: ${e.message}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
console.log(`adapter conformance: ${pass} passed, ${failures.length} failed`);
for (const f of failures) console.log(`  FAIL: ${f}`);
process.exit(failures.length ? 1 : 0);
