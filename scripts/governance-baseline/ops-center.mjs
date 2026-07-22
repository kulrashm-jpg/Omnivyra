#!/usr/bin/env node
// Governance Operations Center — read-only runtime observability (Release R3C).
//
// Aggregates PUBLISHED outputs only (release manifests, verification reports, delivery-assurance records,
// and materialized immutable ledgers/registries) into one operations-center model and renders a
// self-contained, read-only HTML dashboard. It executes NO governance runtime, edits NO ledger/registry,
// and modifies NO runtime/constitutional artifact. Consumes published JSON + immutable *.jsonl only.
//
// Usage:
//   node scripts/governance-baseline/ops-center.mjs                 # write model + dashboard to docs/governance-ops-center/
//   node scripts/governance-baseline/ops-center.mjs --json          # print the model
//   node scripts/governance-baseline/ops-center.mjs --out <dir>     # output directory

import { readFileSync, readdirSync, existsSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const RELEASE_DIR = path.join(REPO, 'docs/governance-runtime-v1.0.0');
const REPORTS_DIR = path.join(HERE, 'reports');
const OUT_DEFAULT = path.join(REPO, 'docs/governance-ops-center');
const RUNTIME_DIR = path.join(REPO, 'docs/company-intelligence/governance-automation/runtime');

const readJson = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null);
const readJsonl = (p) => (existsSync(p) ? readFileSync(p, 'utf8').trim().split(/\n/).filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : []);

// ---------------------------------------------------------------------------
// Ingest published outputs
// ---------------------------------------------------------------------------
function ingest() {
  const version = readJson(path.join(RELEASE_DIR, 'VERSION.json')) || {};
  const manifest = readJson(path.join(RELEASE_DIR, 'MANIFEST.json')) || { runtimes: [] };
  const depGraph = readJson(path.join(RELEASE_DIR, 'DEPENDENCY-GRAPH.json')) || {};
  const lock = readJson(path.join(HERE, 'baseline.lock.json')) || {};
  const reports = {};
  if (existsSync(REPORTS_DIR)) for (const f of readdirSync(REPORTS_DIR).filter((x) => x.endsWith('.json'))) reports[f.replace('.json', '')] = readJson(path.join(REPORTS_DIR, f));
  // materialized immutable ledgers (gitignored .governance-*/ *.jsonl) — read-only if present
  const ledgers = [];
  for (const d of readdirSync(REPO).filter((n) => n.startsWith('.governance-'))) {
    const dir = path.join(REPO, d); if (!statSync(dir).isDirectory()) continue;
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.jsonl'))) {
      const records = readJsonl(path.join(dir, f));
      ledgers.push({ name: f.replace('.jsonl', ''), directory: d, count: records.length, records });
    }
  }
  return { version, manifest, depGraph, lock, reports, ledgers };
}

// ---------------------------------------------------------------------------
// Build the operations-center model (deterministic except generatedAt metadata)
// ---------------------------------------------------------------------------
function buildModel(src) {
  const { version, manifest, depGraph, lock, reports, ledgers } = src;
  const bvr = reports['baseline-verification-report'] || {};
  const drr = reports['drift-detection-report'] || {};
  const ivr = reports['integrity-verification-report'] || {};
  const rir = reports['runtime-inventory-report'] || {};
  const delivery = reports['delivery-assurance'] ? [reports['delivery-assurance']] : [];
  const verifyStatus = bvr.status || 'UNKNOWN';
  const driftStatus = drr.status || verifyStatus;

  // registries: authoritative catalog from MANIFEST + any materialized records
  const ledgerByName = Object.fromEntries(ledgers.map((l) => [l.name, l]));
  const registries = manifest.runtimes.filter((r) => (r.registries || []).length).flatMap((r) =>
    r.registries.map((reg) => ({ registry: reg, runtime: r.id, module: r.module, materializedRecords: 0 })));

  // provenance chains from ledgers if present (admission → execution → supervision → closure)
  const chainOf = (arr) => arr.slice(0, 200);
  const provenance = {
    executionLineage: chainOf((ledgerByName['orchestration-ledger']?.records) || []),
    supervisionLineage: chainOf((ledgerByName['supervision-ledger']?.records) || []),
    closureLineage: chainOf((ledgerByName['closure-ledger']?.records) || []),
    verificationLineage: chainOf((ledgerByName['constitutional-enforcement-ledger']?.records) || []),
  };

  const inv = lock.inventoryCounts || rir.counts || {};
  return {
    tool: 'governance-operations-center', schema: 'read-only', source: 'published-outputs-only',
    generatedAt: new Date().toISOString(),
    runtimeStatus: {
      runtimeVersion: version.runtimeVersion, constitutionalVersion: version.constitutionalVersion,
      releaseVersion: version.engineeringBaseline, releaseId: version.releaseId, baselineId: version.baselineId,
      releaseDigest: version.releaseDigest || bvr.releaseDigest, manifestDigest: lock.manifestDigest || bvr.manifestDigest,
      verificationStatus: verifyStatus, driftStatus, engineeringStatus: version.engineeringStatus,
    },
    runtimeInventory: {
      runtimeModules: inv.runtimeModules, sharedLibraries: inv.sharedLibraries, integrationTemplates: inv.integrationTemplates,
      releaseArtifacts: inv.releaseArtifacts, constitutionDocuments: inv.constitutionDocuments,
      modules: manifest.runtimes.map((r) => ({ id: r.id, module: r.module, responsibility: r.responsibility, digest: r.digest, registries: r.registries || [], ledgers: r.ledgers || [] })),
    },
    dependencyIntegrity: {
      nodes: depGraph.graphProperties?.nodes ?? lock.dependencyGraph?.nodes, edges: depGraph.graphProperties?.edges ?? lock.dependencyGraph?.edges,
      cycles: depGraph.graphProperties?.cycles ?? lock.dependencyGraph?.cycles, digest: lock.dependencyGraph?.digest,
      order: depGraph.runtimeOrder || [], edgeList: depGraph.edges || [],
    },
    registries, ledgers: ledgers.map((l) => ({ ledger: l.name, directory: l.directory, count: l.count })),
    ledgerRecords: Object.fromEntries(ledgers.map((l) => [l.name, l.records.slice(0, 500)])),
    provenance,
    verificationCenter: {
      latest: { status: verifyStatus, releaseDigest: bvr.releaseDigest, recomputedReleaseDigest: bvr.recomputedReleaseDigest },
      baseline: { status: verifyStatus, manifestDigest: bvr.manifestDigest },
      dependency: { digest: bvr.dependencyDigest || lock.dependencyGraph?.digest, status: (drr.byCategory?.['dependency-drift'] ? 'DRIFT' : 'VERIFIED') },
      release: { releaseDigest: bvr.releaseDigest, recomputed: bvr.recomputedReleaseDigest, match: bvr.releaseDigest === bvr.recomputedReleaseDigest },
      integrity: { runtimeDigest: ivr.runtimeDigest, constitutionDigest: ivr.constitutionDigest, deterministicReplay: ivr.deterministicReplay, status: ivr.status || verifyStatus },
    },
    driftCenter: {
      status: driftStatus, driftCount: drr.driftCount ?? (drr.drift?.length || 0), byCategory: drr.byCategory || {},
      items: (drr.drift || []).map((d) => ({ category: d.category, subject: d.subject, expected: d.expected, actual: d.actual, severity: d.category.includes('runtime') || d.category.includes('release') || d.category.includes('digest') ? 'critical' : d.category.includes('dependency') || d.category.includes('manifest') ? 'serious' : 'warning' })),
    },
    deliveryAssurance: delivery,
    metrics: {
      runtimeInventorySize: inv.runtimeModules, sharedLibraries: inv.sharedLibraries,
      dependencyGraphSize: (depGraph.graphProperties?.nodes ?? 0) + '/' + (depGraph.graphProperties?.edges ?? 0),
      registryCatalogCount: registries.length, materializedLedgers: ledgers.length,
      totalLedgerRecords: ledgers.reduce((n, l) => n + l.count, 0),
      constitutionDocuments: inv.constitutionDocuments, releaseArtifacts: inv.releaseArtifacts,
    },
    alerts: buildAlerts(verifyStatus, driftStatus, drr, bvr),
    immutability: { runtimeDigest: lock.runtimeDigest, constitutionDigest: lock.constitutionDigest, behavioral: lock.behavioral, verified: verifyStatus === 'VERIFIED' },
  };
}

function buildAlerts(verifyStatus, driftStatus, drr, bvr) {
  const a = [];
  if (verifyStatus !== 'VERIFIED') a.push({ type: 'failed-verification', severity: 'critical', message: `Baseline verification ${verifyStatus}`, acknowledged: false });
  if (driftStatus === 'DRIFT-DETECTED') a.push({ type: 'drift-detected', severity: 'serious', message: `${drr.driftCount || drr.drift?.length || 0} drift item(s) detected`, acknowledged: false });
  if (bvr.releaseDigest && bvr.recomputedReleaseDigest && bvr.releaseDigest !== bvr.recomputedReleaseDigest) a.push({ type: 'release-mismatch', severity: 'critical', message: 'Release digest mismatch', acknowledged: false });
  return a;
}

// ---------------------------------------------------------------------------
// Self-contained read-only HTML dashboard (theme-aware; status palette; no external resources)
// ---------------------------------------------------------------------------
function renderHtml(model) {
  const data = JSON.stringify(model).replace(/</g, '\\u003c');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Governance Operations Center — Runtime v1.0.0</title>
<style>
:root{--bg:#f7f8fa;--panel:#fff;--ink:#0f172a;--ink2:#475569;--muted:#94a3b8;--line:#e2e8f0;--accent:#2563eb;
--good:#15803d;--good-bg:#dcfce7;--warn:#b45309;--warn-bg:#fef3c7;--serious:#c2410c;--serious-bg:#ffedd5;--crit:#b91c1c;--crit-bg:#fee2e2;}
@media (prefers-color-scheme:dark){:root{--bg:#0b1120;--panel:#111827;--ink:#e5e7eb;--ink2:#9ca3af;--muted:#6b7280;--line:#1f2937;--accent:#60a5fa;
--good:#4ade80;--good-bg:#052e16;--warn:#fbbf24;--warn-bg:#3a2c05;--serious:#fb923c;--serious-bg:#3a1e05;--crit:#f87171;--crit-bg:#3a0a0a;}}
:root[data-theme=dark]{--bg:#0b1120;--panel:#111827;--ink:#e5e7eb;--ink2:#9ca3af;--muted:#6b7280;--line:#1f2937;--accent:#60a5fa;--good:#4ade80;--good-bg:#052e16;--warn:#fbbf24;--warn-bg:#3a2c05;--serious:#fb923c;--serious-bg:#3a1e05;--crit:#f87171;--crit-bg:#3a0a0a;}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
header{padding:20px 24px;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:16px;flex-wrap:wrap}
h1{font-size:18px;margin:0;font-weight:650}.sub{color:var(--ink2);font-size:12px}
.badge{display:inline-flex;align-items:center;gap:5px;padding:2px 9px;border-radius:999px;font-size:12px;font-weight:600}
.b-good{color:var(--good);background:var(--good-bg)}.b-warn{color:var(--warn);background:var(--warn-bg)}.b-serious{color:var(--serious);background:var(--serious-bg)}.b-crit{color:var(--crit);background:var(--crit-bg)}
main{max-width:1200px;margin:0 auto;padding:20px 24px}
nav{display:flex;gap:4px;flex-wrap:wrap;margin-bottom:18px}
nav button{background:transparent;border:1px solid var(--line);color:var(--ink2);padding:6px 12px;border-radius:8px;cursor:pointer;font:inherit;font-size:13px}
nav button.on{background:var(--accent);border-color:var(--accent);color:#fff}
.tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px;margin-bottom:18px}
.tile{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px 16px}
.tile .k{color:var(--ink2);font-size:12px;text-transform:uppercase;letter-spacing:.03em}.tile .v{font-size:20px;font-weight:680;margin-top:4px;font-variant-numeric:tabular-nums;word-break:break-all}
section{display:none}section.on{display:block}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px;margin-bottom:16px;overflow-x:auto}
.panel h2{font-size:14px;margin:0 0 12px}
table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;padding:7px 10px;border-bottom:1px solid var(--line);white-space:nowrap}
th{color:var(--ink2);font-weight:600;font-size:12px;position:sticky;top:0;background:var(--panel)}
td.mono,.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}
.toolbar{display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap;align-items:center}
input[type=search]{background:var(--bg);border:1px solid var(--line);color:var(--ink);padding:6px 10px;border-radius:8px;font:inherit;min-width:200px}
.pager{display:flex;gap:6px;align-items:center;color:var(--ink2);font-size:12px}
.pager button,.expbtn{background:var(--bg);border:1px solid var(--line);color:var(--ink);padding:4px 9px;border-radius:7px;cursor:pointer;font:inherit;font-size:12px}
.empty{color:var(--muted);padding:14px;font-style:italic}
.themebtn{margin-left:auto;background:var(--bg);border:1px solid var(--line);color:var(--ink);padding:5px 10px;border-radius:8px;cursor:pointer;font:inherit;font-size:12px}
.ro{font-size:11px;color:var(--muted);border:1px dashed var(--line);border-radius:6px;padding:2px 8px}
</style></head><body>
<header>
  <div><h1>Governance Operations Center</h1><div class="sub" id="hdr"></div></div>
  <span class="ro">READ-ONLY · consumes published outputs only · no runtime execution</span>
  <button class="themebtn" onclick="tgl()">◐ theme</button>
</header>
<main>
  <div class="tiles" id="tiles"></div>
  <nav id="nav"></nav>
  <section id="v-status" class="on"><div class="panel"><h2>Runtime Status</h2><table id="t-status"></table></div></section>
  <section id="v-verification"><div class="panel"><h2>Verification Center</h2><table id="t-verif"></table></div></section>
  <section id="v-drift"><div class="panel"><h2>Drift Center</h2><div id="d-drift"></div></div></section>
  <section id="v-inventory"><div class="panel"><h2>Runtime Inventory</h2><div id="tb-inv" class="toolbar"></div><div id="d-inv"></div></div>
    <div class="panel"><h2>Dependency Integrity</h2><table id="t-dep"></table></div></section>
  <section id="v-registry"><div class="panel"><h2>Registry Explorer</h2><div id="tb-reg" class="toolbar"></div><div id="d-reg"></div></div></section>
  <section id="v-ledger"><div class="panel"><h2>Ledger Explorer</h2><div id="tb-led" class="toolbar"></div><div id="d-led"></div></div></section>
  <section id="v-provenance"><div class="panel"><h2>Provenance Explorer</h2><div id="d-prov"></div></div></section>
  <section id="v-delivery"><div class="panel"><h2>Delivery Assurance</h2><div id="d-del"></div></div></section>
  <section id="v-metrics"><div class="panel"><h2>Operational Metrics</h2><table id="t-metrics"></table></div></section>
  <section id="v-alerts"><div class="panel"><h2>Alerts</h2><div id="d-alerts"></div></div></section>
</main>
<script type="application/json" id="model">${data}</script>
<script>
const M=JSON.parse(document.getElementById('model').textContent);
const $=s=>document.querySelector(s),el=(t,c,h)=>{const e=document.createElement(t);if(c)e.className=c;if(h!=null)e.innerHTML=h;return e};
function sev(s){return{good:'b-good','VERIFIED':'b-good',warning:'b-warn',serious:'b-serious',critical:'b-crit','DRIFT-DETECTED':'b-serious'}[s]||'b-warn'}
function icon(s){return{good:'✓','VERIFIED':'✓',warning:'⚠',serious:'⚠',critical:'✕','DRIFT-DETECTED':'⚠'}[s]||'•'}
function badge(s){return '<span class="badge '+sev(s)+'">'+icon(s)+' '+s+'</span>'}
$('#hdr').innerHTML=(M.runtimeStatus.releaseId||'')+' · generated '+M.generatedAt+' · '+badge(M.runtimeStatus.verificationStatus);
// tiles
const st=M.runtimeStatus;
const tiles=[['Verification',badge(st.verificationStatus)],['Drift',badge(st.driftStatus)],['Runtime Ver.',st.runtimeVersion],['Constitution Ver.',st.constitutionalVersion],['Release Digest','<span class=mono>'+st.releaseDigest+'</span>'],['Manifest Digest','<span class=mono>'+(st.manifestDigest||'')+'</span>'],['Runtimes',M.runtimeInventory.runtimeModules],['Alerts',M.alerts.length]];
$('#tiles').innerHTML=tiles.map(t=>'<div class=tile><div class=k>'+t[0]+'</div><div class=v>'+t[1]+'</div></div>').join('');
// nav
const views=[['status','Runtime Status'],['verification','Verification'],['drift','Drift'],['inventory','Inventory'],['registry','Registries'],['ledger','Ledgers'],['provenance','Provenance'],['delivery','Delivery'],['metrics','Metrics'],['alerts','Alerts']];
$('#nav').innerHTML=views.map((v,i)=>'<button class="'+(i===0?'on':'')+'" data-v="'+v[0]+'">'+v[1]+'</button>').join('');
$('#nav').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;document.querySelectorAll('nav button').forEach(x=>x.classList.remove('on'));b.classList.add('on');document.querySelectorAll('section').forEach(s=>s.classList.remove('on'));$('#v-'+b.dataset.v).classList.add('on')});
function kv(o){return '<tbody>'+Object.entries(o).map(([k,v])=>'<tr><th>'+k+'</th><td class=mono>'+fmt(v)+'</td></tr>').join('')+'</tbody>'}
function fmt(v){if(v==null)return '<span style=color:var(--muted)>—</span>';if(typeof v==='object')return '<span class=mono>'+JSON.stringify(v)+'</span>';if(v==='VERIFIED'||v==='DRIFT-DETECTED')return badge(v);return v}
$('#t-status').innerHTML=kv(M.runtimeStatus);
$('#t-verif').innerHTML=kv({latest:M.verificationCenter.latest.status,baseline:M.verificationCenter.baseline.manifestDigest,dependency:M.verificationCenter.dependency.status,release_match:M.verificationCenter.release.match,integrity:M.verificationCenter.integrity.status,runtimeDigest:M.verificationCenter.integrity.runtimeDigest,constitutionDigest:M.verificationCenter.integrity.constitutionDigest});
// drift
(function(){const d=M.driftCenter;let h='<div class=toolbar>'+badge(d.status)+' <span class=sub>drift items: '+d.driftCount+'</span></div>';if(!d.items.length)h+='<div class=empty>No drift — Governance Runtime byte-for-byte unchanged.</div>';else{h+='<table><thead><tr><th>Severity</th><th>Category</th><th>Subject</th><th>Expected</th><th>Actual</th></tr></thead><tbody>'+d.items.map(x=>'<tr><td>'+badge(x.severity)+'</td><td>'+x.category+'</td><td class=mono>'+x.subject+'</td><td class=mono>'+(x.expected||'—')+'</td><td class=mono>'+(x.actual||'—')+'</td></tr>').join('')+'</tbody></table>'}$('#d-drift').innerHTML=h})();
// dependency
$('#t-dep').innerHTML=kv({nodes:M.dependencyIntegrity.nodes,edges:M.dependencyIntegrity.edges,cycles:M.dependencyIntegrity.cycles,digest:M.dependencyIntegrity.digest});
// generic paginated/searchable table
function explorer(mount,toolbar,rows,cols,exportName){let q='',page=0;const per=12;
  function draw(){const f=rows.filter(r=>!q||JSON.stringify(r).toLowerCase().includes(q));const pages=Math.max(1,Math.ceil(f.length/per));page=Math.min(page,pages-1);const slice=f.slice(page*per,page*per+per);
    let h=!f.length?'<div class=empty>No records materialized in this environment.</div>':'<table><thead><tr>'+cols.map(c=>'<th>'+c+'</th>').join('')+'</tr></thead><tbody>'+slice.map(r=>'<tr>'+cols.map(c=>'<td class=mono>'+fmt(r[c])+'</td>').join('')+'</tr>').join('')+'</tbody></table>';
    mount.innerHTML=h+'<div class=pager><button data-p=-1>‹</button><span>'+(page+1)+' / '+pages+' ('+f.length+' rows)</span><button data-p=1>›</button></div>';
    mount.querySelector('.pager').onclick=e=>{const b=e.target.closest('button');if(!b)return;page+=+b.dataset.p;draw()}}
  toolbar.innerHTML='<input type=search placeholder="filter / search…"><button class=expbtn>⬇ export JSON</button>';
  toolbar.querySelector('input').oninput=e=>{q=e.target.value.toLowerCase();page=0;draw()};
  toolbar.querySelector('.expbtn').onclick=()=>{const b=new Blob([JSON.stringify(rows,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=exportName+'.json';a.click()};
  draw()}
explorer($('#d-inv'),$('#tb-inv'),M.runtimeInventory.modules,['id','module','responsibility','digest'],'runtime-inventory');
explorer($('#d-reg'),$('#tb-reg'),M.registries,['registry','runtime','module','materializedRecords'],'registries');
// ledgers: pick a ledger to explore
(function(){const led=M.ledgers;if(!led.length){$('#tb-led').innerHTML='';$('#d-led').innerHTML='<div class=empty>No immutable ledgers materialized in this environment (gitignored operational evidence). Ledger catalog is shown in Inventory.</div>';return}
  const sel=el('select');sel.style.cssText='background:var(--bg);border:1px solid var(--line);color:var(--ink);padding:6px 10px;border-radius:8px';sel.innerHTML=led.map(l=>'<option value="'+l.ledger+'">'+l.ledger+' ('+l.count+')</option>').join('');
  const tb=el('div','toolbar');const mount=el('div');$('#d-led').innerHTML='';$('#d-led').append(sel,tb,mount);
  function load(){const recs=M.ledgerRecords[sel.value]||[];const cols=recs.length?Object.keys(recs[0]).slice(0,6):['record'];explorer(mount,tb,recs,cols,sel.value)}
  sel.onchange=load;load()})();
// provenance
(function(){const p=M.provenance;const has=Object.values(p).some(x=>x.length);let h='';for(const [k,v] of Object.entries(p)){h+='<div class=panel style="margin:0 0 12px"><h2>'+k+' ('+v.length+')</h2>'+(v.length?'<table><tbody>'+v.slice(0,10).map(r=>'<tr><td class=mono>'+JSON.stringify(r)+'</td></tr>').join('')+'</tbody></table>':'<div class=empty>No lineage materialized.</div>')+'</div>'}$('#d-prov').innerHTML=has?h:'<div class=empty>Provenance chains are recorded in the immutable ledgers; none materialized in this environment.</div>'})();
// delivery
(function(){const d=M.deliveryAssurance;if(!d.length){$('#d-del').innerHTML='<div class=empty>No delivery-assurance records published yet. Generate with: npm run governance:delivery-record.</div>';return}$('#d-del').innerHTML='<table><thead><tr><th>Release ID</th><th>Digest</th><th>Runtime</th><th>Result</th><th>Deploy Auth.</th><th>Timestamp</th></tr></thead><tbody>'+d.map(r=>'<tr><td class=mono>'+r.releaseId+'</td><td class=mono>'+r.releaseDigest+'</td><td>'+r.runtimeVersion+'</td><td>'+badge(r.verificationResult)+'</td><td>'+(r.deployAuthorized?'✓ authorized':'✕ blocked')+'</td><td class=mono>'+r.verificationTimestamp+'</td></tr>').join('')+'</tbody></table>'})();
// metrics
$('#t-metrics').innerHTML=kv(M.metrics);
// alerts
(function(){const a=M.alerts;$('#d-alerts').innerHTML=!a.length?'<div class=empty>No active alerts — verification passing, no drift.</div>':'<table><thead><tr><th>Severity</th><th>Type</th><th>Message</th><th>Ack</th></tr></thead><tbody>'+a.map(x=>'<tr><td>'+badge(x.severity)+'</td><td>'+x.type+'</td><td>'+x.message+'</td><td>'+(x.acknowledged?'✓':'—')+'</td></tr>').join('')+'</tbody></table>'})();
// theme toggle
function tgl(){const r=document.documentElement;const cur=r.getAttribute('data-theme')||(matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light');r.setAttribute('data-theme',cur==='dark'?'light':'dark')}
</script></body></html>`;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function arg(name) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null; }
const src = ingest();
const model = buildModel(src);
if (process.argv.includes('--json')) { process.stdout.write(JSON.stringify(model, null, 2) + '\n'); process.exit(0); }
const outDir = path.resolve(arg('--out') || OUT_DEFAULT);
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(outDir, 'ops-center.json'), JSON.stringify(model, null, 2));
writeFileSync(path.join(outDir, 'dashboard.html'), renderHtml(model));
process.stdout.write(`Governance Operations Center generated (read-only):\n  ${path.relative(REPO, path.join(outDir, 'dashboard.html'))}  (open in a browser)\n  ${path.relative(REPO, path.join(outDir, 'ops-center.json'))}  (data model)\n` +
  `  status=${model.runtimeStatus.verificationStatus}  drift=${model.driftCenter.status}  runtimes=${model.runtimeInventory.runtimeModules}  ledgers=${model.ledgers.length}  alerts=${model.alerts.length}\n`);
