/**
 * Dossier v2 — report-wide contradiction validator.
 *
 * Runs on every render, over the ledger, the action register and the finished HTML. A BLOCKING
 * issue is a material conflict (arithmetic that does not add up, a provider shown as both measured
 * and not configured, a missing value printed as zero, internal identifiers on the executive
 * pages). Issues are printed in the appendix and logged; tests require zero blocking issues.
 */
import type { DossierRegistry } from './registry';
import type { Ledger } from './ledger';
import type { ResearchPack } from './research';

export type ValidationIssue = { rule: string; blocking: boolean; detail: string };
export type ValidationResult = { passed: boolean; issues: ValidationIssue[]; checks: string[] };

const text = (html: string) => html.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ');
const section = (html: string, id: string) => {
  const at = html.indexOf(`id="${id}"`);
  return at < 0 ? '' : html.slice(at, html.indexOf('</section>', at));
};

export function validateReport(ledger: Ledger, registry: DossierRegistry, html: string, pillars: Array<{ label: string; value: number | null }>, pack: ResearchPack | null = null): ValidationResult {
  const issues: ValidationIssue[] = [];
  const checks: string[] = [];
  const fail = (rule: string, detail: string, blocking = true) => issues.push({ rule, blocking, detail });

  // 1. Crawl arithmetic.
  checks.push('Crawl counts: responded ≤ known, evaluated ≤ responded, not observed = known − responded.');
  const c = ledger.crawl;
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
    if (new RegExp(`${tool.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^.]{0,60}not configured`, 'i').test(text(section(html, 'summary-now')) + text(section(html, 'summary-next')))) {
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

  return { passed: !issues.some((i) => i.blocking), issues, checks };
}
