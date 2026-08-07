/**
 * WS-2 M2 — PRODUCTION BASELINE COLLECTION (STRICTLY READ-ONLY).
 *
 * `intel.visitor.context` and `intel.event.ingested` have never emitted a
 * sample in production: Milestone-2 is not deployed, and the HARDEN-001
 * registry is per-process in-memory with no historical store. There is
 * therefore no metric history to read.
 *
 * What DOES exist is the production corpus those metrics will measure:
 * `tracking_events.user_agent` has been stored on every row since long before
 * M2, and `event_name` records what trackers actually send. Running the SHIPPED
 * parser over that real corpus yields the true distributions — measured, not
 * estimated — which is exactly what the thresholds need.
 *
 * SAFETY: this script performs SELECT queries only. It never writes, and the
 * only table access helper it uses is `.select()`. Verified by inspection and
 * by the write-guard below.
 */
/* eslint-disable no-console */

import { createClient } from '@supabase/supabase-js';
import { parseUserAgent } from '../backend/services/leadIntelligenceEngine/visitorContext';
import { defaultEngineConfig } from '../backend/services/leadIntelligenceEngine/engineConfig';

const url = String(process.env.SUPABASE_URL ?? '');
const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY ?? '');
if (!url || !key) {
  console.error('BLOCKED — SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
  process.exit(2);
}

/**
 * Read-only client. Every call below goes through `read()`, which exposes only
 * a select builder — there is no code path in this file that can insert,
 * update, upsert or delete.
 */
const client = createClient(url, key, { auth: { persistSession: false } });
const read = (table: string) => client.from(table).select.bind(client.from(table));

const SAMPLE = 5000;
const pct = (n: number, d: number): string => (d === 0 ? 'n/a' : `${((n / d) * 100).toFixed(1)}%`);
const bar = (label: string, n: number, d: number): string => `${label.padEnd(22)} ${String(n).padStart(6)}  ${pct(n, d).padStart(7)}`;

type Row = Record<string, unknown>;

function familyOf(eventName: string): string {
  const intent = defaultEngineConfig.intent;
  if (eventName === 'page_view') return 'page_view';
  if (intent.downloadEventNames.includes(eventName)) return 'download';
  if (
    intent.video.startedEventNames.includes(eventName) ||
    intent.video.progressEventNames.includes(eventName) ||
    intent.video.completedEventNames.includes(eventName)
  ) return 'video';
  if (intent.search.eventNames.includes(eventName)) return 'search';
  if (eventName === 'cta_click' || eventName === 'form_submit' || eventName === 'outbound_click') return 'conversion';
  return 'other';
}

const tally = (values: Array<string | null>): Map<string, number> => {
  const m = new Map<string, number>();
  for (const v of values) {
    const k = v ?? '(unresolved)';
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
};

const topN = (m: Map<string, number>, total: number, n = 10): string[] =>
  [...m.entries()].sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0])).slice(0, n).map(([k, v]) => `  ${bar(k, v, total)}`);

(async () => {
  console.log(`\nWS-2 M2 PRODUCTION BASELINE  (READ-ONLY)  target=${url.replace(/^https?:\/\//, '')}\n`);

  // ── Corpus size ───────────────────────────────────────────────────────────
  const counted = await client.from('tracking_events').select('id', { count: 'exact', head: true });
  const totalEvents = counted.count ?? 0;
  const sessionsCounted = await client.from('visitor_sessions').select('id', { count: 'exact', head: true });
  const totalSessions = sessionsCounted.count ?? 0;
  console.log(`corpus: ${totalEvents} tracking_events · ${totalSessions} visitor_sessions`);
  if (counted.error) console.log(`  (count error: ${counted.error.message})`);

  // ── Event sample ──────────────────────────────────────────────────────────
  const evRes = await read('tracking_events')(
    'event_name,event_category,user_agent,bot_flag,ingestion_status,rejected_reason,occurred_at',
  ).order('occurred_at', { ascending: false }).limit(SAMPLE);
  const events = (evRes.data as Row[] | null) ?? [];
  if (evRes.error) console.log(`\nevent read error: ${evRes.error.message}`);
  console.log(`sample: ${events.length} most-recent events\n`);

  if (events.length > 0) {
    // 1. Event family distribution (what intel.event.ingested{family} will show)
    const families = tally(events.map((e) => familyOf(String(e.event_name ?? ''))));
    console.log('── event family distribution (intel.event.ingested{family}) ──');
    for (const line of topN(families, events.length)) console.log(line);

    // 2. Cardinality check: raw names are unbounded, families are not.
    const distinctNames = new Set(events.map((e) => String(e.event_name ?? '')));
    console.log(`\ndistinct event_name values in sample : ${distinctNames.size}  ← would be UNBOUNDED as a label`);
    console.log(`distinct families                    : ${families.size} of 6  ← bounded, what is actually labelled`);

    // 3. Ingestion success/failure (intel.event.ingested{outcome})
    const rejected = events.filter((e) => e.ingestion_status && String(e.ingestion_status) !== 'accepted').length;
    const bots = events.filter((e) => e.bot_flag === true).length;
    console.log(`\n── ingestion outcome ──`);
    console.log(`  ${bar('stored (accepted)', events.length - rejected, events.length)}`);
    console.log(`  ${bar('non-accepted status', rejected, events.length)}`);
    console.log(`  ${bar('bot_flag=true', bots, events.length)}`);

    // 4. Device parsing rate over REAL user agents (intel.visitor.context{device})
    const uas = events.map((e) => (typeof e.user_agent === 'string' ? e.user_agent : null));
    const withUa = uas.filter((u) => u && u.trim() !== '').length;
    const parsed = uas.map((u) => parseUserAgent(u));
    const resolved = parsed.filter((p) => p !== null).length;
    const botsParsed = parsed.filter((p) => p?.deviceType === 'bot').length;
    console.log(`\n── device parsing (intel.visitor.context{device}) ──`);
    console.log(`  ${bar('rows with user_agent', withUa, events.length)}`);
    console.log(`  ${bar('device=true (parsed)', resolved, events.length)}`);
    console.log(`  ${bar('device=false (unknown)', events.length - resolved, events.length)}`);
    console.log(`  ${bar('classified as bot', botsParsed, events.length)}`);
    if (withUa > 0) console.log(`  parse rate among rows that HAVE a user_agent: ${pct(resolved, withUa)}`);

    const nonNull = parsed.filter((p): p is NonNullable<typeof p> => p !== null);
    if (nonNull.length > 0) {
      console.log('\n── browser distribution ──');
      for (const line of topN(tally(nonNull.map((p) => p.browser)), nonNull.length)) console.log(line);
      console.log('\n── platform distribution ──');
      for (const line of topN(tally(nonNull.map((p) => p.platform)), nonNull.length)) console.log(line);
      console.log('\n── device category distribution ──');
      for (const line of topN(tally(nonNull.map((p) => p.deviceCategory)), nonNull.length)) console.log(line);
      console.log('\n── operating system distribution ──');
      for (const line of topN(tally(nonNull.map((p) => p.os)), nonNull.length)) console.log(line);
    }
  }

  // ── 5. Geo + device coverage already persisted on sessions ────────────────
  const sesRes = await read('visitor_sessions')('metadata,started_at').order('started_at', { ascending: false }).limit(SAMPLE);
  const sessions = (sesRes.data as Row[] | null) ?? [];
  if (sesRes.error) console.log(`\nsession read error: ${sesRes.error.message}`);
  if (sessions.length > 0) {
    const meta = sessions.map((s) => (s.metadata && typeof s.metadata === 'object' ? s.metadata as Row : {}));
    const withDevice = meta.filter((m) => m.device && typeof m.device === 'object').length;
    const withGeo = meta.filter((m) => m.geo && typeof m.geo === 'object').length;
    const withVisitor = meta.filter((m) => m.visitor && typeof m.visitor === 'object').length;
    console.log(`\n── persisted session context (${sessions.length} most-recent sessions) ──`);
    console.log(`  ${bar('metadata.device present', withDevice, sessions.length)}`);
    console.log(`  ${bar('metadata.geo present', withGeo, sessions.length)}`);
    console.log(`  ${bar('metadata.visitor present', withVisitor, sessions.length)}`);
  }

  // ── 6. Rollout state: envelopes, versions, fingerprints ───────────────────
  const profRes = await read('lead_intelligence_profiles')('engine_version,schema_version,generation_version,input_fingerprint,freshness').limit(SAMPLE);
  if (profRes.error) {
    console.log(`\n── intelligence envelopes ──\n  not readable: ${profRes.error.message}`);
  } else {
    const profiles = (profRes.data as Row[] | null) ?? [];
    console.log(`\n── intelligence envelopes (${profiles.length}) ──`);
    if (profiles.length > 0) {
      for (const line of topN(tally(profiles.map((p) => String(p.engine_version ?? '(null)'))), profiles.length)) console.log(line);
      const gens = profiles.map((p) => Number(p.generation_version ?? 0)).filter((n) => Number.isFinite(n));
      const distinctFp = new Set(profiles.map((p) => String(p.input_fingerprint ?? ''))).size;
      console.log(`  generation_version: min ${Math.min(...gens)} · max ${Math.max(...gens)} · mean ${(gens.reduce((a, b) => a + b, 0) / gens.length).toFixed(2)}`);
      console.log(`  distinct fingerprints: ${distinctFp}/${profiles.length}`);
    } else {
      console.log('  none — intelligence generation has not run in this environment');
    }
  }

  console.log('\nREAD-ONLY baseline complete. No writes were performed.\n');
  process.exit(0);
})();
