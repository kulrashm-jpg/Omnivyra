/**
 * WS-5 (FR-14 Timeline · FR-20 Engagement) — a Prospect's engagement evidence.
 *
 * Both requirements are marked EXISTS in the manifest, and they do: the
 * engagement pipeline writes `engagement_threads` / `engagement_messages`, and
 * `canonicalLeadSignalService` writes `lead_signals`. What does NOT exist is a
 * way for the canonical Prospect to reach any of it. Before this module the
 * only file joining `canonical_leads` to `engagement_threads` was WS-7's
 * account aggregation, and NOTHING reached `lead_signals` from a Prospect at
 * all. So FR-14 and FR-20 were satisfied as capabilities and unsatisfiable
 * from the PI spine. This is that join, and deliberately nothing else.
 *
 * ─── IT READS. IT WRITES NO SIGNAL. ───────────────────────────────────────
 * `canonicalLeadSignalService` declares itself the single writer of
 * `lead_signals` ("No direct writes to `lead_signals` are allowed outside this
 * module") and dedupes on `(organization_id, source_type, source_id)`. This
 * module adds no second writer and no second deduplication mechanism; a test
 * asserts it contains no write verb.
 *
 * Nor does it DERIVE a new signal from engagement. A `lead_signals` row needs a
 * `source_id`, and synthesising one for "this person has been quiet" would
 * manufacture a signal out of absence — the precise transformation the contract
 * forbids. Engagement evidence is reported as engagement evidence; whether it
 * becomes a signal is a product decision nobody has made.
 *
 * ─── NO SECOND STORE, NO SECOND LEDGER ────────────────────────────────────
 * The timeline is derived from the evidence that already exists, at read time.
 * There is no events table and no cache: a second ledger would be a second
 * truth, and reconstructing chronology from a copy is how timelines drift.
 * `lead_signals_v1` is neither read nor written nor revived.
 *
 * ─── TENANCY IS NEVER INHERITED FROM AN ID ────────────────────────────────
 * `engagement_messages` carries NO tenant column — its only tenancy is its
 * thread. So messages are fetched exclusively by thread ids that a
 * tenant-filtered query already returned, never by any other key. A person id
 * is globally unique and is therefore never sufficient authorisation: every
 * person-keyed read also filters its own tenant column.
 *
 * ─── AN ABSENT TIMESTAMP STAYS ABSENT ─────────────────────────────────────
 * `platform_created_at` is when the SOURCE saw the event; `created_at` is when
 * we ingested it. Each entry says which one it got, or that it got neither.
 * `now()` is never substituted. Entries with no observation time are kept and
 * counted rather than dropped or interleaved: dropping loses evidence, and
 * placing them in the ordering would invent a chronology.
 *
 * ─── EVIDENCE, NOT A SCORE ────────────────────────────────────────────────
 * Signal scores are passed through verbatim, nulls included. This module
 * combines nothing, weights nothing and ranks nothing: composite priority is
 * WS-6's, readiness and NBA are WS-8's, and an engagement reader that emitted a
 * score would be a second scoring engine.
 */

import { ownedDbTable } from '../../db/writeOwner';

/** Bumped when the evidence contract changes, so a caller traces its answer. */
export const PROSPECT_ENGAGEMENT_VERSION = 'ws5.1';

/** The canonical signal model. Named once; `lead_signals_v1` is not touched. */
export const CANONICAL_SIGNAL_TABLE = 'lead_signals';

// ─────────────────────────────────────────────────────────────────────────────
// Rows, as the ports hand them back — column names verbatim.
// ─────────────────────────────────────────────────────────────────────────────

export interface ProspectRow {
  readonly id: string;
  readonly unified_person_id: string | null;
}

export interface ThreadRow {
  readonly id: string;
  readonly platform: string | null;
  readonly contact_id: string | null;
  readonly created_at: string | null;
  readonly updated_at: string | null;
}

export interface MessageRow {
  readonly id: string;
  readonly thread_id: string | null;
  readonly platform: string | null;
  readonly direction: string | null;
  readonly message_type: string | null;
  /** The SOURCE's time. Null when the platform gave none. */
  readonly platform_created_at: string | null;
  /** OUR ingest time. Never presented as an observation. */
  readonly created_at: string | null;
}

export interface SignalRow {
  readonly id: string;
  readonly source_type: string | null;
  readonly source_id: string | null;
  readonly thread_id: string | null;
  readonly contact_id: string | null;
  readonly platform: string | null;
  readonly intent_score: number | null;
  readonly urgency_score: number | null;
  readonly icp_score: number | null;
  readonly confidence_score: number | null;
  readonly total_score: number | null;
  readonly detected_at: string | null;
  readonly migration_source: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// The evidence.
// ─────────────────────────────────────────────────────────────────────────────

/** Where an entry's observation time came from — or that it has none. */
export type ObservedAtSource = 'platform' | 'ingest' | 'none';

/** One dated piece of evidence about this Prospect. */
export interface TimelineEntry {
  readonly kind: 'engagement_message' | 'signal';
  readonly id: string;
  /** The table it came from. Provenance, stated rather than implied. */
  readonly source: 'engagement_messages' | 'lead_signals';
  readonly threadId: string | null;
  readonly channel: string | null;
  /** `null` when the source did not say. NEVER defaulted to a direction. */
  readonly direction: 'inbound' | 'outbound' | null;
  /** Null when nothing usable was recorded. `now()` is never substituted. */
  readonly observedAt: string | null;
  readonly observedAtSource: ObservedAtSource;
  /** When WE stored it. Kept apart from `observedAt` on purpose. */
  readonly recordedAt: string | null;
}

/** A canonical `lead_signals` row, scores passed through untouched. */
export interface ProspectSignal {
  readonly id: string;
  readonly sourceType: string | null;
  /** With `sourceType` and the tenant, this is the row's idempotency key. */
  readonly sourceId: string | null;
  readonly threadId: string | null;
  readonly platform: string | null;
  readonly detectedAt: string | null;
  readonly migrationSource: string | null;
  /** Verbatim. A score nobody recorded is null, never zero. */
  readonly scores: {
    readonly intent: number | null;
    readonly urgency: number | null;
    readonly icp: number | null;
    readonly confidence: number | null;
    readonly total: number | null;
  };
  /** How this signal was linked to the Prospect. Both are tenant-scoped. */
  readonly linkedBy: readonly ('thread' | 'contact')[];
}

export interface ProspectEngagementIntelligence {
  readonly version: string;
  readonly organizationId: string;
  readonly prospectId: string;
  /** Null when the Prospect has no resolved person — then there is no evidence. */
  readonly personId: string | null;
  readonly reason: string;

  /** FR-14. Ordered by observation time; undated evidence is kept, at the end. */
  readonly timeline: readonly TimelineEntry[];

  /** FR-20. The engagement contributor's raw material — counts, never a score. */
  readonly engagement: {
    readonly threadCount: number;
    readonly messageCount: number;
    readonly inbound: number;
    readonly outbound: number;
    /** Messages whose direction the source did not state. Not assumed either way. */
    readonly directionUnknown: number;
    readonly channels: readonly string[];
    readonly firstActivityAt: string | null;
    readonly lastActivityAt: string | null;
  };

  readonly signals: readonly ProspectSignal[];

  // ── quality dimensions, kept apart and never combined ──
  /** COMPLETENESS — what evidence exists, as counts. */
  readonly completeness: {
    readonly hasPerson: boolean;
    readonly threads: number;
    readonly messages: number;
    readonly signals: number;
  };
  /** FRESHNESS — age of the newest DATED evidence, under a caller's policy. */
  readonly freshness: {
    readonly lastActivityAt: string | null;
    readonly ageDays: number | null;
    /** Null means NO POLICY WAS SUPPLIED — not "fresh". */
    readonly stale: boolean | null;
  };
  /** PROVENANCE — which tables and which producers contributed. */
  readonly provenance: {
    readonly sources: readonly string[];
    readonly channels: readonly string[];
    readonly signalProducers: readonly string[];
  };
  /** CONSISTENCY — what the evidence could not tell us. */
  readonly consistency: {
    /** Entries with no usable observation time, so the order is incomplete. */
    readonly entriesWithoutObservationTime: number;
    /** Entries dated only by OUR ingest time, not by the source. */
    readonly entriesDatedByIngestOnly: number;
    readonly messagesWithoutDirection: number;
  };
  // CONFIDENCE stays per-signal (`signals[].scores.confidence`) — there is no
  // account-wide engagement confidence to state, and inventing one would be a
  // score. ACTIONABILITY is WS-8's.
}

// ─────────────────────────────────────────────────────────────────────────────

/** Everything WS-5 reads. One port; exactly one place names a table. */
export interface ProspectEngagementPorts {
  loadProspect(organizationId: string, prospectId: string): Promise<ProspectRow | null>;
  loadThreads(organizationId: string, personId: string): Promise<readonly ThreadRow[]>;
  /** Tenancy comes from the threads: `engagement_messages` has no tenant column. */
  loadMessages(threadIds: readonly string[]): Promise<readonly MessageRow[]>;
  /** Contacts for this person, tenant-scoped — the second signal linkage. */
  loadContactIds(organizationId: string, personId: string): Promise<readonly string[]>;
  loadSignals(
    organizationId: string,
    keys: { threadIds: readonly string[]; contactIds: readonly string[] },
  ): Promise<readonly SignalRow[]>;
}

export interface ProspectEngagementInput {
  /** TENANT. Explicit, never ambient — a context pointer is not a credential. */
  readonly organizationId: string;
  readonly prospectId: string;
  /** Caller policy for freshness. Absent means the age is reported only. */
  readonly stalenessDays?: number;
  /** Injected. Used ONLY to age evidence — never as an observation time. */
  readonly now: string;
}

const text = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s === '' ? null : s;
};

/**
 * `null`, `undefined` and `''` stay null. `Number(null)` is 0, and a score
 * nobody recorded must never arrive as a confident zero.
 */
const numberOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Only the two directions the model defines. Anything else is UNKNOWN. */
const direction = (v: unknown): 'inbound' | 'outbound' | null => {
  const s = text(v)?.toLowerCase() ?? null;
  return s === 'inbound' || s === 'outbound' ? s : null;
};

const msOf = (t: string | null): number | null => {
  if (!t) return null;
  const ms = Date.parse(t);
  return Number.isFinite(ms) ? ms : null;
};

const daysBetween = (from: string | null, to: string): number | null => {
  const a = msOf(from);
  const b = msOf(to);
  if (a === null || b === null) return null;
  return Math.floor((b - a) / 86_400_000);
};

/**
 * Choose an entry's observation time, and SAY where it came from.
 *
 * The precedence is the repository's existing engagement convention
 * (`platform_created_at ?? created_at`, NULLS LAST), reused rather than
 * reinvented. What is added is the label: a caller must be able to tell a real
 * source timestamp from our ingest time from nothing at all.
 */
function observation(platformAt: string | null, ingestAt: string | null): {
  observedAt: string | null; observedAtSource: ObservedAtSource;
} {
  if (msOf(platformAt) !== null) return { observedAt: platformAt, observedAtSource: 'platform' };
  if (msOf(ingestAt) !== null) return { observedAt: ingestAt, observedAtSource: 'ingest' };
  return { observedAt: null, observedAtSource: 'none' };
}

/**
 * The default ports. The ONLY place in WS-5 that names a table.
 *
 * Every person-keyed read carries its own tenant column. `loadMessages` is the
 * single exception and cannot do otherwise — `engagement_messages` has no
 * tenant column — which is exactly why it accepts nothing but thread ids that
 * a tenant-filtered query produced.
 */
export const defaultProspectEngagementPorts: ProspectEngagementPorts = {
  async loadProspect(organizationId: string, prospectId: string): Promise<ProspectRow | null> {
    const { data, error } = await ownedDbTable('canonical_leads')
      .select('id, unified_person_id')
      .eq('id', prospectId)
      .eq('company_id', organizationId)          // tenant boundary — never optional
      .maybeSingle();
    if (error) throw new Error(`canonical_leads read failed: ${error.message}`);
    return (data as ProspectRow | null) ?? null;
  },

  async loadThreads(organizationId: string, personId: string): Promise<readonly ThreadRow[]> {
    const { data, error } = await ownedDbTable('engagement_threads')
      .select('id, platform, contact_id, created_at, updated_at')
      .eq('organization_id', organizationId)     // tenant boundary — never optional
      .eq('unified_person_id', personId);
    if (error) throw new Error(`engagement_threads read failed: ${error.message}`);
    return (data ?? []) as ThreadRow[];
  },

  async loadMessages(threadIds: readonly string[]): Promise<readonly MessageRow[]> {
    if (threadIds.length === 0) return [];
    const { data, error } = await ownedDbTable('engagement_messages')
      // No tenant filter is POSSIBLE here: the table has no tenant column. Its
      // tenancy is `threadIds`, which the caller obtained from a tenant-scoped
      // query and which this function must never be handed from anywhere else.
      .select('id, thread_id, platform, direction, message_type, platform_created_at, created_at')
      .in('thread_id', [...threadIds]);
    if (error) throw new Error(`engagement_messages read failed: ${error.message}`);
    return (data ?? []) as MessageRow[];
  },

  async loadContactIds(organizationId: string, personId: string): Promise<readonly string[]> {
    const { data, error } = await ownedDbTable('contacts')
      .select('id')
      .eq('organization_id', organizationId)     // tenant boundary — never optional
      .eq('unified_person_id', personId);
    if (error) throw new Error(`contacts read failed: ${error.message}`);
    return ((data ?? []) as Array<{ id: string }>).map((r) => r.id);
  },

  async loadSignals(
    organizationId: string,
    keys: { threadIds: readonly string[]; contactIds: readonly string[] },
  ): Promise<readonly SignalRow[]> {
    const columns = 'id, source_type, source_id, thread_id, contact_id, platform,'
      + ' intent_score, urgency_score, icp_score, confidence_score, total_score,'
      + ' detected_at, migration_source';

    // Two separate tenant-scoped reads rather than one OR: a single filter
    // spanning both keys is easy to write in a way that loses the tenant
    // predicate, and PostgREST's `or()` does not compose with `.in()` safely.
    const reads: Array<Promise<{ data: unknown; error: { message: string } | null }>> = [];
    if (keys.threadIds.length > 0) {
      reads.push(ownedDbTable(CANONICAL_SIGNAL_TABLE)
        .select(columns)
        .eq('organization_id', organizationId)   // tenant boundary — never optional
        .in('thread_id', [...keys.threadIds]) as never);
    }
    if (keys.contactIds.length > 0) {
      reads.push(ownedDbTable(CANONICAL_SIGNAL_TABLE)
        .select(columns)
        .eq('organization_id', organizationId)   // tenant boundary — never optional
        .in('contact_id', [...keys.contactIds]) as never);
    }
    if (reads.length === 0) return [];

    const results = await Promise.all(reads);
    const rows: SignalRow[] = [];
    const seen = new Set<string>();
    for (const r of results) {
      if (r.error) throw new Error(`lead_signals read failed: ${r.error.message}`);
      // A signal reachable by BOTH links is one signal, not two.
      for (const row of (r.data ?? []) as SignalRow[]) {
        if (seen.has(row.id)) continue;
        seen.add(row.id);
        rows.push(row);
      }
    }
    return rows;
  },
};

/**
 * Everything the platform can evidence about one Prospect's engagement.
 *
 * Pure with respect to the database: it writes nothing, so calling it twice
 * returns the same answer and creates nothing the second time. Signal
 * idempotency stays where it already lives — the unique constraint on
 * `(organization_id, source_type, source_id)`, enforced by
 * `canonicalLeadSignalService` — and no second mechanism is introduced.
 *
 * Returns null when the Prospect is not readable in this tenant. That is an
 * identity fact, and collapsing it into an empty timeline would hide a
 * cross-tenant attempt behind a normal-looking answer.
 */
export async function readProspectEngagementIntelligence(
  input: ProspectEngagementInput,
  ports: ProspectEngagementPorts = defaultProspectEngagementPorts,
): Promise<ProspectEngagementIntelligence | null> {
  if (!input.organizationId?.trim()) {
    throw new Error('organizationId is required to read prospect engagement');
  }
  if (!input.prospectId?.trim()) {
    throw new Error('prospectId is required to read prospect engagement');
  }
  if (!input.now?.trim()) {
    throw new Error('now is required — engagement freshness is never derived from ambient time');
  }

  const prospect = await ports.loadProspect(input.organizationId, input.prospectId);
  if (!prospect) return null;

  const personId = text(prospect.unified_person_id);
  const base = {
    version: PROSPECT_ENGAGEMENT_VERSION,
    organizationId: input.organizationId,
    prospectId: prospect.id,
    personId,
  };
  const hasPolicy = typeof input.stalenessDays === 'number' && input.stalenessDays >= 0;

  // A Prospect with no resolved person has no engagement evidence to find —
  // there is no key to look it up by. That is absence, reported as absence,
  // and emphatically not "this prospect is disengaged".
  if (!personId) {
    return {
      ...base,
      reason: 'this prospect has no resolved person, so no engagement evidence can be linked to it',
      timeline: [], signals: [],
      engagement: {
        threadCount: 0, messageCount: 0, inbound: 0, outbound: 0, directionUnknown: 0,
        channels: [], firstActivityAt: null, lastActivityAt: null,
      },
      completeness: { hasPerson: false, threads: 0, messages: 0, signals: 0 },
      freshness: { lastActivityAt: null, ageDays: null, stale: hasPolicy ? true : null },
      provenance: { sources: [], channels: [], signalProducers: [] },
      consistency: {
        entriesWithoutObservationTime: 0, entriesDatedByIngestOnly: 0, messagesWithoutDirection: 0,
      },
    };
  }

  const [threads, contactIds] = await Promise.all([
    ports.loadThreads(input.organizationId, personId),
    ports.loadContactIds(input.organizationId, personId),
  ]);

  const threadIds = threads.map((t) => t.id);
  const channelByThread = new Map(threads.map((t) => [t.id, text(t.platform)]));

  const [messages, signalRows] = await Promise.all([
    ports.loadMessages(threadIds),
    ports.loadSignals(input.organizationId, { threadIds, contactIds }),
  ]);

  // ── TIMELINE (FR-14) ────────────────────────────────────────────────────
  const entries: TimelineEntry[] = [];

  for (const m of messages) {
    const { observedAt, observedAtSource } = observation(
      text(m.platform_created_at), text(m.created_at),
    );
    const threadId = text(m.thread_id);
    entries.push({
      kind: 'engagement_message',
      id: m.id,
      source: 'engagement_messages',
      threadId,
      // The message's own platform, falling back to its thread's — both are
      // recorded facts, so neither is an inference.
      channel: text(m.platform) ?? (threadId ? channelByThread.get(threadId) ?? null : null),
      direction: direction(m.direction),
      observedAt,
      observedAtSource,
      recordedAt: text(m.created_at),
    });
  }

  for (const s of signalRows) {
    // `detected_at` is NOT NULL in the schema, so a signal is normally dated;
    // it is still routed through the same helper rather than trusted, because
    // a port is an interface and this module does not get to assume.
    const { observedAt, observedAtSource } = observation(text(s.detected_at), null);
    entries.push({
      kind: 'signal',
      id: s.id,
      source: 'lead_signals',
      threadId: text(s.thread_id),
      channel: text(s.platform),
      // A signal is a judgement about a conversation, not a message in it.
      direction: null,
      observedAt,
      observedAtSource,
      recordedAt: null,
    });
  }

  // Dated evidence sorts chronologically. Undated evidence is NOT given a
  // position it did not earn: it is kept, placed last, and counted below, so
  // the caller knows the ordering is incomplete rather than believing it whole.
  const dated = entries.filter((e) => e.observedAt !== null);
  const undated = entries.filter((e) => e.observedAt === null);
  dated.sort((a, b) => {
    const d = (msOf(a.observedAt) ?? 0) - (msOf(b.observedAt) ?? 0);
    return d !== 0 ? d : a.id.localeCompare(b.id);   // stable, so repeats match
  });
  const timeline = [...dated, ...undated];

  // ── ENGAGEMENT (FR-20) — counts, never a score ──────────────────────────
  const messageEntries = entries.filter((e) => e.kind === 'engagement_message');
  const inbound = messageEntries.filter((e) => e.direction === 'inbound').length;
  const outbound = messageEntries.filter((e) => e.direction === 'outbound').length;
  const channels = [...new Set(
    entries.map((e) => e.channel).filter((c): c is string => c !== null),
  )].sort();

  const firstActivityAt = dated[0]?.observedAt ?? null;
  const lastActivityAt = dated[dated.length - 1]?.observedAt ?? null;
  const ageDays = daysBetween(lastActivityAt, input.now);

  const signals: ProspectSignal[] = signalRows.map((s) => {
    const threadId = text(s.thread_id);
    const contactId = text(s.contact_id);
    const linkedBy: Array<'thread' | 'contact'> = [];
    if (threadId && threadIds.includes(threadId)) linkedBy.push('thread');
    if (contactId && contactIds.includes(contactId)) linkedBy.push('contact');
    return {
      id: s.id,
      sourceType: text(s.source_type),
      sourceId: text(s.source_id),
      threadId,
      platform: text(s.platform),
      detectedAt: text(s.detected_at),
      migrationSource: text(s.migration_source),
      scores: {
        intent: numberOrNull(s.intent_score),
        urgency: numberOrNull(s.urgency_score),
        icp: numberOrNull(s.icp_score),
        confidence: numberOrNull(s.confidence_score),
        total: numberOrNull(s.total_score),
      },
      linkedBy,
    };
  }).sort((a, b) => a.id.localeCompare(b.id));

  const sources = [...new Set(entries.map((e) => e.source))].sort();

  return {
    ...base,
    reason: `${threads.length} thread(s), ${messages.length} message(s), ${signalRows.length} canonical signal(s)`,
    timeline,
    engagement: {
      threadCount: threads.length,
      messageCount: messages.length,
      inbound,
      outbound,
      directionUnknown: messageEntries.length - inbound - outbound,
      channels,
      firstActivityAt,
      lastActivityAt,
    },
    signals,
    completeness: {
      hasPerson: true,
      threads: threads.length,
      messages: messages.length,
      signals: signalRows.length,
    },
    freshness: {
      lastActivityAt,
      ageDays,
      // No dated evidence means currency cannot be shown, so under a real
      // policy it is stale — the rule WS-2 and WS-7 already apply. It is NOT
      // evidence of disengagement; `completeness` says whether anything exists.
      stale: hasPolicy ? (ageDays === null || ageDays > (input.stalenessDays as number)) : null,
    },
    provenance: {
      sources,
      channels,
      signalProducers: [...new Set(
        signalRows.map((s) => text(s.migration_source)).filter((m): m is string => m !== null),
      )].sort(),
    },
    consistency: {
      entriesWithoutObservationTime: undated.length,
      entriesDatedByIngestOnly: entries.filter((e) => e.observedAtSource === 'ingest').length,
      messagesWithoutDirection: messageEntries.filter((e) => e.direction === null).length,
    },
  };
}
