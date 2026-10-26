/**
 * Dossier v2 — report-wide contradiction validator.
 *
 * Runs on every render, over the ledger, the action register and the finished HTML. A BLOCKING
 * issue is a material conflict (arithmetic that does not add up, a provider shown as both measured
 * and not configured, a missing value printed as zero, internal identifiers on the executive
 * pages). Issues are printed in the appendix and logged; tests require zero blocking issues, and the
 * report-consistency CI job runs those tests, so a blocking issue fails the build.
 */
import type { DossierRegistry } from './registry';
import type { Ledger } from './ledger';
import { isBrandQuestion, type ResearchPack } from './research';
import { buildDiagnostics, DIAG_LABEL } from './diagnostics';
import { classifyProviderError } from '../publicResearch/providerErrors';
import { CAPABILITIES, capabilityState } from '../publicResearch/competitorDiscovery';

export type ValidationIssue = { rule: string; blocking: boolean; detail: string };
export type ValidationResult = { passed: boolean; issues: ValidationIssue[]; checks: string[] };

const text = (html: string) => html.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ');
const section = (html: string, id: string) => {
  const at = html.indexOf(`id="${id}"`);
  return at < 0 ? '' : html.slice(at, html.indexOf('</section>', at));
};

export function validateReport(ledger: Ledger, registry: DossierRegistry, html: string, pillars: Array<{ label: string; value: number | null }>, pack: ResearchPack | null = null): ValidationResult {
  // The appendix's own consistency block quotes the rules; it is not report content.
  html = html.replace(/<!--V2-CHECK-START-->[\s\S]*?<!--V2-CHECK-END-->/g, '');
  const issues: ValidationIssue[] = [];
  const checks: string[] = [];
  const fail = (rule: string, detail: string, blocking = true) => issues.push({ rule, blocking, detail });

  // 1. Crawl arithmetic.
  checks.push('Crawl counts: responded ≤ known, evaluated ≤ responded, not observed = known − responded; with per-URL states, known = fetched + never fetched.');
  const c = ledger.crawl;
  if (c.attempted != null && c.notAttempted != null && c.known != null && c.attempted + c.notAttempted !== c.known) fail('crawl', `Fetched ${c.attempted} + never fetched ${c.notAttempted} ≠ ${c.known} known.`);
  if (c.read != null && c.responded != null && c.read > c.responded) fail('crawl', `${c.read} read exceeds ${c.responded} answered.`);
  if (c.notAttempted != null && new RegExp(`\\b${c.notAttempted}\\b[^.]{0,40}(failed|errors?|no HTTP response|gave no response|unreachable)`, 'i').test(text(html))) {
    fail('crawl-wording', `The ${c.notAttempted} never-fetched addresses are described as failures.`);
  }
  if (c.known != null && c.responded != null && c.responded > c.known) fail('crawl', `${c.responded} responded exceeds ${c.known} known.`);
  if (c.responded != null && c.evaluated != null && c.evaluated > c.responded) fail('crawl', `${c.evaluated} evaluated exceeds ${c.responded} responded.`);
  if (c.known != null && c.responded != null && c.notObserved !== c.known - c.responded) fail('crawl', `Not observed ${c.notObserved} ≠ ${c.known} − ${c.responded}.`);
  const body = text(html);
  if (c.notObserved != null && new RegExp(`\\b${c.notObserved}\\b[^.]{0,40}(failed|no HTTP response|gave no response|unreachable)`, 'i').test(body)) {
    fail('crawl-wording', `The ${c.notObserved} unobserved addresses are described as failures, but attempts are not recorded.`);
  }

  // 2. AI coverage by tool.
  checks.push('AI answers: one state per tool; named ≤ answered; no tool both measured and "not configured".');
  const labels = ledger.ai.map((a) => a.label);
  if (new Set(labels).size !== labels.length) fail('ai-duplicate', `A tool appears twice: ${labels.join(', ')}.`);
  if (ledger.aiTotals.buyerNamed > ledger.aiTotals.buyerAnswers) fail('ai-count', 'More buyer answers name the brand than were answered.');
  for (const a of ledger.ai.filter((x) => x.reason === 'measured' || x.reason === 'partial')) {
    const tool = a.label.split(' (')[0];
    // The tool's own entry (its list item or its line in the blocked strip), not a neighbour's.
    const t = tool.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`${t}[^<]*</span><b>not configured|<b>${t}[^<]*</b> — not configured`, 'i').test(section(html, 'summary-now') + section(html, 'summary-next'))) {
      fail('ai-stale-config', `${a.label} was measured in this run but a summary page calls it not configured.`);
    }
  }
  if (ledger.aiTotals.measured.length && /all AI (visibility|answers?) (is|are) unmeasured|AI visibility cannot be measured at all|AI visibility not measured|AI presence is unmeasured/i.test(body)) {
    fail('ai-scope', 'The report says AI visibility is unmeasured although some AI search tools were measured.');
  }

  // 3. Google AI Overview: one denominator.
  checks.push('Google AI Overview: retrieved + not retrieved = total.');
  if (ledger.aio && ledger.aio.retrieved + ledger.aio.failed !== ledger.aio.total) fail('aio', `AI Overview states (${ledger.aio.retrieved} + ${ledger.aio.failed}) do not add to ${ledger.aio.total}.`);
  if (!ledger.aio && /Google AI Overview<\/strong>[\s\S]{0,300}?>(Measured|Partly measured)</.test(html)) fail('aio', 'Google AI Overview is shown as measured, but no overview was checked in this run.');

  // 4. Missing is not zero.
  checks.push('Pillars without a value are never shown as 0.');
  for (const p of pillars.filter((x) => x.value == null)) {
    if (new RegExp(`${p.label}[^<]{0,30}</div>\\s*<div[^>]*>\\s*0\\s*<`, 'i').test(html) || new RegExp(`>0<small> / 100</small></div><div class="v2-tile-label">${p.label}<`).test(html)) {
      fail('zero', `${p.label} has no value but is printed as 0.`);
    }
  }
  if (/\b(NaN|undefined)\b/.test(body)) fail('render', 'The report contains "NaN" or "undefined".');

  // 5. Executive pages carry no internal identifiers.
  checks.push('Summary pages: no action ids, evidence ids or environment variable names.');
  for (const id of ['summary-now', 'summary-next']) {
    const t = text(section(html, id));
    const internal = t.match(/\b(A-[a-z0-9-]{3,}|E-[A-Z]{3}-\d{2}|F-[a-z]+-[a-z0-9-]+|[A-Z][A-Z0-9]+_(?:API_)?KEY|[A-Z]{3,}_[A-Z_]{3,})\b/g);
    if (internal) fail('summary-ids', `${id === 'summary-now' ? 'Page 2' : 'Page 3'} shows internal identifiers: ${[...new Set(internal)].slice(0, 4).join(', ')}.`);
  }

  // 6. Actions: one register, consistent references.
  checks.push('Actions: unique ids; every finding/action cross-reference resolves.');
  const ids = registry.actions.map((a) => a.id);
  if (new Set(ids).size !== ids.length) fail('actions', 'Duplicate action ids in the register.');
  const known = new Set(ids);
  for (const f of registry.findings) for (const a of f.actionIds) if (!known.has(a)) fail('actions', `Finding ${f.id} points to a missing action ${a}.`);
  for (const a of registry.actions) for (const d of a.dependsOn) if (!known.has(d)) fail('actions', `Action ${a.id} depends on a missing action ${d}.`, false);
  if (registry.audit.candidates - registry.audit.merges.length !== registry.audit.actions) fail('actions', `Register audit does not reconcile: ${registry.audit.candidates} − ${registry.audit.merges.length} ≠ ${registry.audit.actions}.`);

  // 7. Independent means independent: no owned domain, no social-platform post.
  checks.push('Independent mentions exclude the company’s own domain and social-platform posts.');
  const social = /(^|\.)(linkedin|x|twitter|facebook|instagram|youtube|tiktok|pinterest)\.com$/i;
  const own = pack?.subject.domain ?? '';
  for (const m of pack?.footprint?.mentions ?? []) {
    let h = '';
    try { h = new URL(m.url).hostname.replace(/^www\./, '').toLowerCase(); } catch { /* invalid URL */ }
    if (social.test(h) || (own && (h === own || h.endsWith(`.${own}`)))) fail('independence', `${m.url} is counted as an independent mention but is ${social.test(h) ? 'a social-platform post' : 'on the company’s own domain'}.`);
  }

  // 8. One coverage count everywhere.
  checks.push('Every "evidence sources measured" count matches the ledger.');
  const want = `${ledger.coverage.measured} of ${ledger.access.length}`;
  for (const m of body.matchAll(/(\d+) of (\d+) evidence sources measured|Evidence sources measured (\d+) of (\d+)/gi)) {
    const got = m[1] ? `${m[1]} of ${m[2]}` : `${m[3]} of ${m[4]}`;
    if (got !== want) fail('coverage', `A page says ${got} evidence sources measured; the ledger says ${want}.`);
  }

  // 9. Access states are classified.
  checks.push('Every source in the access matrix has a classified reason.');
  for (const a of ledger.access) if (!a.reason) fail('access', `${a.capability} has no reason class.`);

  // 10. Numbers printed against the evidence rows they summarise.
  checks.push('Numbers: every "X of Y … answers to buyer questions" matches the ledger’s grounded answers.');
  const t = ledger.aiTotals;
  for (const m of body.matchAll(/(\d+) of (\d+) (?:grounded )?(?:AI )?answers to buyer questions/gi)) {
    if (Number(m[1]) !== t.buyerNamed || Number(m[2]) !== t.buyerAnswers) fail('numbers', `"${m[0]}" does not match the ledger (${t.buyerNamed} of ${t.buyerAnswers}).`);
  }
  if (t.groundedAnswers > t.attemptedCalls) fail('numbers', `${t.groundedAnswers} grounded answers exceed ${t.attemptedCalls} questions sent.`);

  // 11. Stale narrative: wording that a newer run has made false.
  checks.push('Stale narrative: no blanket "AI not measured", no "measured more recently" for a tool that failed, no generated or spliced templates.');
  const stale: Array<[RegExp, string, boolean]> = [
    [/connect a retrieval-grounded answer engine/i, 'asks to connect an AI answer engine although some were measured', t.measured.length > 0],
    [/measured (it|them) more recently/i, 'says the research measured a tool "more recently" — true only for a measured tool', true],
    [/is currently (strong|moderate|weak), because/i, 'presents a generated assessment with a self-contradicting reason', true],
    [/around the core focus area/i, 'shows an action title with a spliced positioning sentence', true],
  ];
  for (const [re, what, on] of stale) if (on && re.test(body)) fail('stale-narrative', `The report ${what}.`);

  // 12. Failed or unconfigured is never shown as zero.
  checks.push('A failed, unconfigured or untested source is never printed as 0.');
  for (const a of ledger.ai.filter((x) => x.state !== 'measured_grounded')) {
    if (new RegExp(`class="v2-ai-${a.state}"><span>[^<]*</span><b>0/`).test(html)) fail('failed-as-zero', `${a.label} (${a.state.replace(/_/g, ' ')}) is printed as 0.`);
  }
  for (const a of ledger.access.filter((x) => x.family === 'ai_answers' && ['missing_credential', 'no_adapter', 'not_searched'].includes(x.reason))) {
    if (/^0 of \d+/.test(a.outcome)) fail('failed-as-zero', `${a.capability} was not asked but its outcome reads "${a.outcome.slice(0, 40)}".`);
  }
  const bl = ledger.families.find((f) => f.key === 'inbound_links');
  if (bl && bl.state !== 'found' && /\b(0|zero|no) (backlinks|referring domains|inbound links)\b/i.test(body)) fail('failed-as-zero', 'Backlinks are not measured but the report states a count of zero.');

  // 13. "Not found" always says where it was looked for.
  checks.push('"Not found" is always scoped (in search, on the pages read, by the analyst…).');
  for (const m of body.matchAll(/\bnot found\b(?! (in|on|by|within|when|among|where)\b)/gi)) {
    // Read the words before each occurrence from the text itself, so neighbouring matches never overlap.
    const before = body.slice(Math.max(0, (m.index ?? 0) - 30), m.index);
    if (/(searched|looked for),?\s*$/i.test(before)) continue;
    fail('not-found-scope', `Unscoped "not found": "${`${before}${m[0]}${body.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 10)}`.trim()}".`);
  }

  // 14. A missing key is not evidence; configuration names never reach the reader.
  checks.push('No environment-variable names anywhere; a missing credential is "not measured", not "no evidence".');
  const env = body.match(/\b(?:[A-Z][A-Z0-9]*_)+(?:API_)?KEY\b|\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+=[\w.]+/g);
  if (env) fail('config-names', `Configuration names are printed: ${[...new Set(env)].slice(0, 3).join(', ')}.`);
  for (const a of ledger.access.filter((x) => x.reason === 'missing_credential')) {
    if (new RegExp(`${a.capability.split(' (')[0].replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}[^.]{0,40}(no evidence|none found|not found)`, 'i').test(body)) fail('missing-key', `${a.capability} has no credential but is described as having no evidence.`);
  }

  // 15. Claim provenance: the company's own claims carry their state; no like-for-like without verification.
  checks.push('Declared capabilities carry a provenance state; a like-for-like comparison needs most of them verified on the site.');
  const off = pack?.offering ?? null;
  if (off) {
    const verified = off.capabilities.filter((x) => x.state === 'website_verified' || x.state === 'independently_corroborated').length;
    if (verified * 2 < off.capabilities.length && /like-for-like rival/i.test(body)) fail('provenance', `Only ${verified} of ${off.capabilities.length} declared capabilities are on the website, but the report draws a like-for-like comparison.`);
    for (const x of off.capabilities) if (!x.state) fail('provenance', `Capability "${x.claim}" has no provenance state.`);
  }

  // 16. Competitor comparisons only for validated competitors.
  checks.push('Companies said to compete for the same buyer are validated as direct or adjacent.');
  const validated = new Set((pack?.competitors ?? []).filter((x) => ['direct', 'adjacent', 'strategic'].includes(String(x.classification))).map((x) => String(x.name).toLowerCase()));
  const said = /Checked against their own websites, (.+?) compete/i.exec(body)?.[1];
  for (const n of said ? said.split(/,\s*|\s+and\s+/) : []) if (n && !validated.has(n.trim().toLowerCase())) fail('competitors', `${n.trim()} is said to compete for the same buyer but was not validated.`);

  // 17. Dates and freshness.
  checks.push('Evidence dates: none after the report date; the summary states each evidence date.');
  const reportDay = /Evidence dates:[^.]*report (\d{1,2} \w{3} \d{4})/.exec(body)?.[1];
  if (!reportDay) fail('dates', 'Page 2 does not state the evidence dates.');
  const gen = reportDay ? Date.parse(reportDay) : NaN;
  const late = (iso: string | null | undefined) => Boolean(iso) && Number.isFinite(gen) && Date.parse(String(iso)) > gen + 36 * 3_600_000;
  if (late(ledger.crawl.lastCrawledIso)) fail('dates', 'The crawl is dated after the report.');
  if (late(pack?.collectedAt)) fail('dates', 'The public research is dated after the report.');

  // 18. Unsupported claims on the summary.
  checks.push('Summary claims are supported: "not found in search" needs buyer searches, not generic category queries.');
  const now = text(section(html, 'summary-now'));
  if (ledger.search?.source !== 'research' && /do not find it yet, in search or in AI answers/i.test(now)) fail('unsupported', 'Page 2 says buyers do not find the company in search, but no buyer searches were run (only generic category queries).');

  // 19. Citations support their claims: a value marked as observed carries the page it came from.
  checks.push('Citations: every competitor value shown as observed carries its source page.');
  for (const r of pack?.benchmark ?? []) {
    for (const [who, v] of Object.entries(r.values ?? {})) {
      if (v.status === 'observed' && !v.url && who !== pack!.subject.domain && r.kind !== 'ai_cited_sources' && r.dimension !== 'ai_share_of_voice') fail('citations', `${r.claim} for ${who} is shown as observed with no source page.`);
    }
  }

  // 20b. Buyer-search counts printed anywhere equal the ledger (brand-name searches counted apart).
  checks.push('Search numbers: every "X of Y buyer searches" excludes brand-name searches and equals the ledger.');
  const brandQs = (pack?.search ?? []).filter((r) => r.status === 'observed' && isBrandQuestion(r, pack!.subject.brand)).length;
  if (ledger.search?.source === 'research') {
    for (const m of body.matchAll(/(\d+) of (\d+) buyer searches/gi)) {
      if (Number(m[1]) !== ledger.search.found - ledger.search.brandedFound || Number(m[2]) !== ledger.search.checked - brandQs) fail('numbers', `"${m[0]}" does not match the search ledger (${ledger.search.found - ledger.search.brandedFound} of ${ledger.search.checked - brandQs}).`);
    }
  }

  // 20. Crawl numbers printed anywhere equal the ledger's funnel.
  checks.push('Crawl numbers: every "X of Y known addresses fetched" equals the ledger.');
  for (const m of body.matchAll(/(\d+) of (\d+) known addresses fetched/gi)) {
    if (Number(m[1]) !== c.attempted || Number(m[2]) !== c.known) fail('numbers', `"${m[0]}" does not match the crawl ledger (${c.attempted} of ${c.known}).`);
  }

  // 21. Report 1 is organic visibility: no paid-performance or lead-outcome metric is presented.
  checks.push('Scope: no paid-advertising or lead-generation performance metric (Report 2) is presented.');
  const paid = body.match(/\b(ROAS|CPC|CPM|CPA|cost per (click|lead|acquisition)|ad spend|advertising spend|lead quality|revenue attribution|qualified-lead conversion)\b/i);
  if (paid) fail('scope', `The report presents a Report 2 metric: "${paid[0]}".`);

  // 23. Grounded means checkable: every answer counted as grounded has at least one source.
  checks.push('AI denominator: every answer counted as grounded has at least one checkable source.');
  for (const g of pack?.generative ?? []) {
    if (g.status === 'observed' && g.query && g.kind !== 'ai_overview' && !(g.citedDomains ?? []).length && !g.sourceUrl) fail('grounding', `${g.id} (${g.surface}) is counted as a grounded answer but returned no source.`);
  }

  // 24. A provider error's cause must be reproducible from its own evidence (never from the status alone).
  checks.push('Provider errors: each recorded cause is reproduced from the provider’s own error fields.');
  for (const g of pack?.generative ?? []) {
    const pe = g.providerError;
    if (!pe) continue;
    const again = classifyProviderError(pe);
    if (again.errorClass !== pe.errorClass || (pe.causeConfirmed && !again.causeConfirmed)) fail('error-cause', `${g.id} records “${pe.errorClass}” but its evidence supports “${again.errorClass}${again.causeConfirmed ? '' : ' (unconfirmed)'}”.`);
  }

  // 25. "Not found" only after a search that ran.
  checks.push('Footprint: "searched, not found" only where the search actually ran.');
  for (const f of ledger.families) {
    if (f.state === 'searched_not_found' && !f.attempted) fail('not-found-scope', `${f.label} is “searched, not found” but no search ran.`);
  }
  if (pack?.footprint && !pack.footprint.mentionSearch && /not found in search/i.test(body)) fail('not-found-scope', 'The report says “not found in search” but the mention search did not run.');

  // 26. Competitor candidates: identity and a recorded reason before any comparison.
  checks.push('Competitors: every compared candidate has a confirmed identity, its own pages read and a recorded rationale; overlap counts only the company’s website-stated capabilities.');
  const ownPages = (pack?.offering?.pages ?? []).filter((p) => p.read && p.text).map((p) => ({ url: p.url, text: p.text! }));
  const ownConfirmed = new Set(CAPABILITIES.filter((d) => capabilityState(d, ownPages).state === 'confirmed').map((d) => d.key));
  for (const c of pack?.candidates ?? []) {
    if (!['direct', 'adjacent', 'substitute'].includes(c.classification)) continue;
    if (!c.identityVerified || !c.domain || !c.pagesRead.length) fail('competitors', `${c.name} is compared but its identity or pages were not confirmed.`);
    if (!c.rationale.trim() || !c.sources.length) fail('competitors', `${c.name} is compared without a recorded rationale or source.`);
    const unverified = c.overlap.filter((k) => !ownConfirmed.has(k));
    if (unverified.length) fail('provenance', `${c.name}'s overlap counts capabilities not stated on the company's own site: ${unverified.join(', ')}.`);
  }

  // 27. Generic queries are never presented as buyer-intent searches.
  checks.push('Search: generic category-label queries are never presented as buyer-intent searches.');
  if (ledger.search?.source === 'report_run' && /\d+ of \d+ buyer(-intent)? searches/i.test(body)) fail('unsupported', 'Only generic category queries ran, but the report counts them as buyer searches.');
  if ((pack?.proposedQueries ?? []).some((q) => q.status === 'proposed') && /proposed[^.]{0,40}\b(found|ranked|returned)\b/i.test(body)) fail('unsupported', 'A proposed (not run) query is reported with a result.');

  // 28. Remediation claims rest on provider evidence.
  checks.push('Remediation: every price or provider capability named in a next step cites its official page.');
  const diags = buildDiagnostics(ledger, pack);
  for (const d of diags) {
    if (/\$\d/.test(`${d.next} ${d.unlocks} ${d.capability}`) && !d.docUrl) fail('remediation', `${d.source}: a price is named without the provider page it comes from.`);
    if (d.cost === 'paid usage' && !d.docUrl) fail('remediation', `${d.source}: “paid usage” is stated without the provider page that establishes it.`);
  }

  // 29. Summaries say what the diagnostic matrix says.
  checks.push('Summaries: every source state shown on pages 2–3 equals its state in the source diagnostics.');
  const summaries = section(html, 'summary-now') + section(html, 'summary-next');
  for (const m of summaries.matchAll(/data-diag="([^"]+)"[^>]*>[\s\S]*?<\/b>(?:<span>| — )([^<.(]+)/g)) {
    const d = diags.find((x) => x.key === m[1]);
    if (!d) { fail('summary-diagnostics', `A summary names an unknown source “${m[1]}”.`); continue; }
    // The state label, or the row's own plain-language label for missing data — both derive from the same row.
    const said = m[2].trim().toLowerCase();
    if (said !== DIAG_LABEL[d.state].toLowerCase() && said !== d.plain?.short.toLowerCase()) fail('summary-diagnostics', `${d.source}: the summary says “${m[2].trim()}”, the diagnostics say “${DIAG_LABEL[d.state]}”.`);
  }

  // 30. Company profile: declared stays declared, missing stays unknown, conflicts stay visible.
  checks.push('Company profile: a declared fact is never shown as verified, a missing value never as zero, a conflict never silently resolved.');
  const reg = pack?.register;
  for (const x of reg?.entries ?? []) {
    if (x.provenance && x.status === 'official_website_verified') fail('profile', `“${x.value}” comes from the company profile but is marked website-verified.`);
    if (x.status === 'official_website_verified' && !x.url) fail('profile', `“${x.value}” is marked website-verified without a website page.`);
    if (x.status === 'conflicting' && !x.conflictsWith) fail('profile', `“${x.value}” is marked conflicting without the claim it conflicts with.`);
  }
  if (reg && !(reg.entries.some((x) => x.field === 'revenue')) && /\brevenue\b[^.]{0,30}\b(0|zero|none)\b/i.test(body)) fail('missing-key', 'No revenue was declared or observed, but the report states a zero.');
  const pe = pack?.profileEvidence;
  if (pe && pe.status !== 'profile_not_found' && /No company profile was available/.test(body)) fail('profile', `The profile status is “${pe.status}” but the report says none was available.`);
  if (pe?.status === 'profile_access_error' && /\bno company profile\b/i.test(body.replace(/could not be read[^.]*\./g, ''))) fail('profile', 'The profile could not be read, but the report calls it missing.');

  // 22. One register: no two actions with the same title.
  checks.push('Actions: no duplicate recommendations (one title, one action).');
  const titles = registry.actions.map((a) => a.title.toLowerCase().replace(/\W+/g, ' ').trim());
  for (const t of new Set(titles.filter((x, i) => titles.indexOf(x) !== i))) fail('actions', `Duplicate action title: "${t}".`);

  return { passed: !issues.some((i) => i.blocking), issues, checks };
}
