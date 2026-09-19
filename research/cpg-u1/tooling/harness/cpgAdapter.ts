// CPG U1 execution adapter (CPG_U1_PROTOCOL_004 §7, §13.1). Runs under the FROZEN resolver's own tsx, one process per
// company, with a pinned environment in which every cache namespace is killed (§13.1: the Wikidata adapter cache runs
// cold; the executor records the environment). It changes no CPG code:
//   execute: lookupGroundedCompanyFacts with createSafeEvidenceFetcher({ budgetMs: 45_000 }) wrapped by a recording
//            fetcher, and the production Wikidata adapter wrapped by a recording lookup.
//   HTTP:    every undici request (the safe fetcher's undici and Node's bundled undici used by the Wikidata adapter) is
//            observed on undici's diagnostics channels: method, origin, path, status, response headers (incl. Date,
//            Last-Modified), timestamps, and the response body bytes exactly as undici delivered them to the consumer
//            (before any content decoding performed by fetch), with their SHA-256 (§13.1 raw documents).
//   replay:  the same lookup fed ONLY recorded exchanges and Wikidata results; any request not in the archive is a miss.
import dc from 'node:diagnostics_channel';
import { createHash } from 'node:crypto';

export interface LookupInput { companyId: string; companyName: string; websiteUrl: string; linkedinUrl: null; asOf: string }
type FetchResult = { ok: boolean; status: number; url: string; text: string } | null;
type Fetcher = (url: string, opts: { allowedHosts?: string[]; maxBytes?: number; headers?: Record<string, string> }) => Promise<FetchResult>;
type WikidataLookup = (brandName: string) => Promise<unknown>;
type Lookup = (input: LookupInput & { fetcher: Fetcher; wikidataLookup: WikidataLookup }) => Promise<unknown>;

export interface Exchange { seq: number; requested_url: string; options: { allowedHosts: string[] | null; maxBytes: number | null; headers: Record<string, string> | null }; result: FetchResult; error: string | null; started_at: string; completed_at: string }
export interface WikidataCall { seq: number; brand_name: string; result: unknown; error: string | null; started_at: string; completed_at: string }
export interface HttpEvent { seq: number; origin: string; path: string; method: string; status: number | null; headers: string[]; created_at: string; headers_at: string | null; completed_at: string | null; error: string | null; complete: boolean; body_base64: string; body_sha256: string; body_bytes: number }

const iso = () => new Date().toISOString();

export async function recordLookup(input: LookupInput, deps: { lookup: Lookup; fetcher: Fetcher; wikidataLookup: WikidataLookup }) {
  const exchanges: Exchange[] = []; const wikidata_calls: WikidataCall[] = [];
  const http: Array<HttpEvent & { chunks: Buffer[] }> = []; const live = new WeakMap<object, HttpEvent & { chunks: Buffer[] }>();
  let fseq = 0; let wseq = 0; let hseq = 0;
  const track = (r: any) => {
    const ev = { seq: ++hseq, origin: String(r?.origin ?? ''), path: String(r?.path ?? ''), method: String(r?.method ?? ''), status: null, headers: [], created_at: iso(), headers_at: null, completed_at: null, error: null, complete: false, body_base64: '', body_sha256: '', body_bytes: 0, chunks: [] as Buffer[] };
    http.push(ev); live.set(r, ev);
    const onData = r.onData; const onComplete = r.onComplete;
    r.onData = function (chunk: Uint8Array) { ev.chunks.push(Buffer.from(chunk)); return onData.call(this, chunk); };
    r.onComplete = function (trailers: unknown) { ev.complete = true; ev.completed_at = iso(); return onComplete.call(this, trailers); };
    return ev;
  };
  const onCreate = (m: any) => { if (m?.request) track(m.request); };
  const onHeaders = (m: any) => {
    const ev = live.get(m?.request) ?? track(m?.request ?? {});
    ev.status = Number(m?.response?.statusCode ?? 0); ev.headers = (m?.response?.headers ?? []).map((h: unknown) => String(h)); ev.headers_at = iso();
  };
  const onError = (m: any) => { const ev = live.get(m?.request); if (ev) { ev.error = String(m?.error?.message ?? m?.error ?? 'error'); ev.completed_at = iso(); } };
  dc.subscribe('undici:request:create', onCreate); dc.subscribe('undici:request:headers', onHeaders); dc.subscribe('undici:request:error', onError);
  const httpEvents = (): HttpEvent[] => http.map(({ chunks, ...ev }) => { const body = Buffer.concat(chunks); return { ...ev, body_base64: body.toString('base64'), body_sha256: createHash('sha256').update(body).digest('hex'), body_bytes: body.length }; });
  const fetcher: Fetcher = async (url, opts) => {
    const seq = ++fseq; const started_at = iso();
    const options = { allowedHosts: opts?.allowedHosts ?? null, maxBytes: opts?.maxBytes ?? null, headers: opts?.headers ?? null };
    try {
      const result = await deps.fetcher(url, opts);
      exchanges.push({ seq, requested_url: url, options, result: result ? { ok: result.ok, status: result.status, url: result.url, text: result.text } : null, error: null, started_at, completed_at: iso() });
      return result;
    } catch (e) {
      exchanges.push({ seq, requested_url: url, options, result: null, error: String((e as Error)?.message ?? e), started_at, completed_at: iso() });
      throw e;
    }
  };
  const wikidataLookup: WikidataLookup = async (brandName) => {
    const seq = ++wseq; const started_at = iso();
    try {
      const result = await deps.wikidataLookup(brandName);
      wikidata_calls.push({ seq, brand_name: brandName, result: result ?? null, error: null, started_at, completed_at: iso() });
      return result;
    } catch (e) {
      wikidata_calls.push({ seq, brand_name: brandName, result: null, error: String((e as Error)?.message ?? e), started_at, completed_at: iso() });
      throw e;
    }
  };
  const started_at = iso();
  try {
    const response = await deps.lookup({ ...input, fetcher, wikidataLookup });
    return { raw_response: JSON.stringify(response), executor_error: null, exchanges, wikidata_calls, http_events: httpEvents(), started_at, completed_at: iso() };
  } catch (e) {
    return { raw_response: null, executor_error: `lookup failed: ${String((e as Error)?.message ?? e)}`, exchanges, wikidata_calls, http_events: httpEvents(), started_at, completed_at: iso() };
  } finally {
    dc.unsubscribe('undici:request:create', onCreate); dc.unsubscribe('undici:request:headers', onHeaders); dc.unsubscribe('undici:request:error', onError);
  }
}

/** Replay: requests are answered from the archive by (requested_url, occurrence); a Wikidata call by (brand_name, occurrence). */
export async function replayLookup(input: LookupInput, replay: { exchanges: Exchange[]; wikidata_calls: WikidataCall[] }, lookup: Lookup) {
  const byUrl = new Map<string, Exchange[]>();
  for (const x of [...replay.exchanges].sort((a, b) => a.seq - b.seq)) { const q = byUrl.get(x.requested_url) ?? []; q.push(x); byUrl.set(x.requested_url, q); }
  const byName = new Map<string, WikidataCall[]>();
  for (const w of [...replay.wikidata_calls].sort((a, b) => a.seq - b.seq)) { const q = byName.get(w.brand_name) ?? []; q.push(w); byName.set(w.brand_name, q); }
  const misses: string[] = [];
  const fetcher: Fetcher = async (url) => {
    const x = byUrl.get(url)?.shift();
    if (!x) { misses.push(`fetch ${url}`); return null; }
    if (x.error !== null) throw new Error(x.error);
    return x.result;
  };
  const wikidataLookup: WikidataLookup = async (name) => {
    const w = byName.get(name)?.shift();
    if (!w) { misses.push(`wikidata ${name}`); return null; }
    if (w.error !== null) throw new Error(w.error);
    return w.result as never;
  };
  const response = await lookup({ ...input, fetcher, wikidataLookup });
  const unused = [...byUrl.values(), ...byName.values()].reduce((n, q) => n + q.length, 0);
  return { raw_response: JSON.stringify(response), misses, unused };
}

async function main() {
  const clone = process.env.CPG_U1_RESOLVER_CLONE;
  if (!clone) throw new Error('CPG_U1_RESOLVER_CLONE is required');
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  const req = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  const base = `file:///${clone.replace(/\\/g, '/')}/backend/services`;
  const cpg = await import(`${base}/companyProfile/grounding/companyFactsLookup.ts`);
  if (req.mode === 'execute') {
    const sef = await import(`${base}/companyProfile/grounding/acquisition/safeEvidenceFetcher.ts`);
    const wd = await import(`${base}/intelligence/adapters/wikidataAdapter.ts`);
    const out = await recordLookup(req.input, { lookup: cpg.lookupGroundedCompanyFacts, fetcher: sef.createSafeEvidenceFetcher({ budgetMs: 45_000 }), wikidataLookup: wd.lookupCompanyFirmographicsFromWikidata });
    process.stdout.write(JSON.stringify(out));
  } else if (req.mode === 'replay') {
    const out = await replayLookup(req.input, req.replay, cpg.lookupGroundedCompanyFacts);
    process.stdout.write(JSON.stringify(out));
  } else if (req.mode === 'probe-environment') {
    process.stdout.write(JSON.stringify({ names: Object.keys(process.env).sort(), cache_kill_all: process.env.CACHE_KILL_ALL ?? null }));
  } else {
    throw new Error('mode must be execute|replay|probe-environment');
  }
}

if (process.argv[1] && /cpgAdapter\.ts$/.test(process.argv[1])) {
  main().catch((e) => { process.stderr.write(`ADAPTER_ERROR ${String(e?.message ?? e)}\n`); process.exit(1); });
}
