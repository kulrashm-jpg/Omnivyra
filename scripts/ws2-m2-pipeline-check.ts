/**
 * WS-2 Milestone-2 — real-database pipeline check.
 *
 * Proves the new visitor dimensions and event families survive the ACTUAL
 * capture → storage → snapshot → engine → envelope path, not just a mock.
 *
 * SAFETY: local certenv only. This script writes.
 */
/* eslint-disable no-console */

const TARGET = String(process.env.SUPABASE_URL ?? '');
if (!/^https?:\/\/(127\.0\.0\.1|localhost):543\d\d/.test(TARGET)) {
  console.error(`\nBLOCKED — local certenv only. Got: ${TARGET || '<unset>'}\n`);
  process.exit(2);
}

import { ownedDbTable } from '../backend/db/writeOwner';
import { resolveVisitorSession, stitchSessionToLead } from '../backend/services/attributionResolverService';
import { createLeadIntelligenceOrchestrator, LEAD_INTELLIGENCE_PROFILES_TABLE } from '../backend/services/leadIntelligenceOrchestration';
import { parseUserAgent, extractGeoContext } from '../backend/services/leadIntelligenceEngine';

const COMPANY = '00000000-0000-4000-8000-00000000000a';
const RUN = `m2-${Date.now()}`;
const checks: Array<{ name: string; ok: boolean; detail: string }> = [];
const record = (name: string, ok: boolean, detail: string) => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(40)} ${detail}`);
};

const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const HEADERS = {
  'user-agent': UA,
  'x-vercel-ip-country': 'de',
  'x-vercel-ip-country-region': 'BE',
  'x-vercel-ip-city': 'Berlin',
  'x-vercel-ip-timezone': 'Europe/Berlin',
};

(async () => {
  console.log(`\nWS-2 M2 PIPELINE CHECK  target=${TARGET}  run=${RUN}\n`);
  const anon = `${RUN}-a`;

  // Capture: exactly what the tracking endpoint does — parse ONCE, pass through.
  const device = parseUserAgent(HEADERS['user-agent']);
  const geo = extractGeoContext(HEADERS);
  record('parse at capture', !!device && !!geo, `${device?.deviceCategory}/${device?.browser} · ${geo?.city}, ${geo?.country} (${geo?.timezone})`);

  const s = await resolveVisitorSession({
    companyId: COMPANY,
    websiteId: null,
    attribution: { anonymous_id: anon, session_id: `${anon}-s1`, current_page: 'https://x.test/pricing' } as never,
    visitorContext: { device, geo },
  });
  const sessionId = s.sessionId as string;

  const stored = await ownedDbTable('visitor_sessions').select('metadata').eq('id', sessionId).single();
  const meta = (stored.data as { metadata?: Record<string, unknown> } | null)?.metadata ?? {};
  record('persisted through capture', !!meta.device && !!meta.geo, `metadata keys: ${Object.keys(meta).sort().join(', ')}`);

  // A lead anchored to that session, plus the new event families.
  const person = await ownedDbTable('unified_persons').insert({ company_id: COMPANY, primary_email: `${anon}@m2.test` }).select('id').single();
  const personId = (person.data as { id?: string } | null)?.id ?? null;
  const lead = await ownedDbTable('leads')
    .insert({
      company_id: COMPANY, name: 'M2 Buyer', email: `${anon}@m2.test`, source: 'website',
      unified_person_id: personId, visitor_session_id: sessionId,
      metadata: { job_title: 'CTO', company_name: 'BigCorp', device, geo },
    })
    .select('id').single();
  const leadId = (lead.data as { id?: string } | null)?.id as string;
  await stitchSessionToLead({ leadId, companyId: COMPANY, visitorSessionId: sessionId, unifiedPersonId: personId });

  const base = Date.now() - 600_000;
  const rows = [
    ['page_view', {}, 'https://x.test/pricing'],
    ['search', { query: 'sso setup' }, 'https://x.test/search'],
    ['search', { query: 'pricing tiers' }, 'https://x.test/search'],
    ['download', { asset_name: 'security-whitepaper.pdf' }, 'https://x.test/resources'],
    ['video_started', { video_title: 'Product Demo' }, 'https://x.test/demo'],
    ['video_progress', { video_title: 'Product Demo', percent: 60 }, 'https://x.test/demo'],
    ['video_completed', { video_title: 'Product Demo' }, 'https://x.test/demo'],
  ] as const;
  await ownedDbTable('tracking_events').insert(rows.map(([name, md, url], i) => ({
    company_id: COMPANY, visitor_session_id: sessionId, anonymous_id: anon,
    event_name: name, event_category: 'engagement', page_url: url,
    occurred_at: new Date(base + i * 30_000).toISOString(), metadata: md,
  })));

  const orch = createLeadIntelligenceOrchestrator();
  const gen = await orch.generate({ companyId: COMPANY, leadId });
  const summary = gen.record?.intelligence as any;
  const contrib = (sig: string) => summary?.intent?.contributions?.find((c: { signal: string }) => c.signal === sig);

  record('generation', gen.status === 'generated' && gen.persisted === true, `status=${gen.status} score=${summary?.qualification?.totalScore} band=${summary?.qualification?.band}`);
  record('search intent in envelope', !!contrib('search_intent'), contrib('search_intent')?.evidence ?? 'absent');
  record('video intent in envelope', !!contrib('video_engagement'), contrib('video_engagement')?.evidence ?? 'absent');
  record('download evidence named', String(contrib('downloads')?.evidence ?? '').includes('whitepaper'), contrib('downloads')?.evidence ?? 'absent');
  record('device context (0 pts)', contrib('device_confidence')?.points === 0, contrib('device_confidence')?.evidence ?? 'absent');
  record('geo context (0 pts)', contrib('geo_confidence')?.points === 0, contrib('geo_confidence')?.evidence ?? 'absent');

  const rec = summary?.recommendations;
  record('timezone-aware contact time', String(rec?.bestContactTime?.value ?? '').includes('Europe/Berlin'), String(rec?.bestContactTime?.value));
  record('device-aware channel', String(rec?.bestChannel?.explanation ?? '').includes('Mobile-only'), String(rec?.bestChannel?.explanation).slice(0, 90));
  record('search-led interest', String(rec?.likelyProductInterest?.value ?? '').includes('Searched'), String(rec?.likelyProductInterest?.value));

  const labels: string[] = (summary?.timeline ?? []).map((t: { label: string }) => t.label);
  record('timeline labels', labels.some((l) => l.startsWith('Downloaded ')) && labels.some((l) => l.startsWith('Finished video')) && labels.some((l) => l.startsWith('Searched ')), labels.join(' · ').slice(0, 120));
  record('no duplicate timeline entries', new Set(labels.map((l, i) => `${l}|${(summary.timeline[i] as { occurredAt: string }).occurredAt}`)).size === labels.length, `${labels.length} entries`);

  const again = await orch.generate({ companyId: COMPANY, leadId });
  record('no duplicate generation', again.status === 'skipped_unchanged', `re-run=${again.status}`);

  // Cleanup
  await ownedDbTable(LEAD_INTELLIGENCE_PROFILES_TABLE).delete().eq('lead_id', leadId);
  await ownedDbTable('tracking_events').delete().like('anonymous_id', `${RUN}%`);
  await ownedDbTable('leads').delete().like('email', `${RUN}%`);
  await ownedDbTable('visitor_sessions').delete().like('anonymous_id', `${RUN}%`);
  await ownedDbTable('unified_persons').delete().like('primary_email', `${RUN}%`);

  const failed = checks.filter((c) => !c.ok);
  console.log(`\nTOTAL ${checks.length}  PASS ${checks.length - failed.length}  FAIL ${failed.length}`);
  console.log(`\nRESULT: ${failed.length === 0 ? 'ALL CHECKS PASSED' : 'FAILURES PRESENT'}\n`);
  process.exit(failed.length === 0 ? 0 : 1);
})();
