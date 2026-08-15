/**
 * B7.6 — canonical topic curation review surface.
 * B7.8-C.6 — plus an on-demand embedding action per topic identity.
 *
 * READ + three operator actions. Every mutation goes through the B7.5/B7.8-C.4
 * endpoints; this component never writes to the database and holds no company
 * context.
 *
 * "Leave separate" is a LOCAL dismissal only — B7.6 must not invent a durable
 * rejection table, so a dismissed row simply leaves the current view and
 * returns on reload. That is deliberate, not an oversight.
 *
 * ── B7.8-C.6: AN INITIATION SURFACE, NOT A STATUS SURFACE ──────────────────
 * "Generate embedding" POSTs { topicId } and renders whichever deterministic
 * state the route returns. It does NOT poll, does not re-read the list on
 * acceptance, and never reports that an embedding exists — asynchronous
 * completion is owned by the B7.8-C.3 trigger and the B7.8-C.2 provider path.
 * The flag, authorization, provider access, cost ledgering and idempotency all
 * live server-side; none of them is duplicated or second-guessed here.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';

type ReviewTopic = {
  id: string;
  canonicalLabel: string;
  normalizedLabel: string;
  canonicalTopicId: string | null;
  parentTopicId: string | null;
  state: string;
  confidence: string;
  source: string | null;
  occurrenceCount: number;
  lastSeenAt: string | null;
  /** Derived server-side; the vector itself is never sent. */
  hasEmbedding?: boolean;
};

type Filter = 'identities' | 'aliases' | 'all';

const TOPICS_API = '/api/admin/knowledge-graph/topics';
const CURATION_API = '/api/admin/knowledge-graph/canonical-topic';
const EMBED_API = '/api/admin/knowledge-graph/embed-topic';
const AUTHORING_API = '/api/admin/knowledge-graph/topic';

type EmbedState =
  | 'pending' | 'accepted' | 'in_flight' | 'already_embedded'
  | 'disabled' | 'not_found' | 'missing_topic_id' | 'unauthorized' | 'error';

/**
 * Operator-facing wording for each state the B7.8-C.4 route can return.
 *
 * `accepted` and `in_flight` are deliberately worded as WORK STARTED, never as
 * work finished — the route returns 202 for both, and the embedding genuinely
 * does not exist yet. Only `already_embedded` may assert a completed state.
 * Wording that blurred that line would make an operator believe a topic is
 * searchable when it is not.
 */
const EMBED_FEEDBACK: Record<EmbedState, { tone: 'ok' | 'warn' | 'err'; text: string }> = {
  pending: { tone: 'warn', text: 'Requesting…' },
  accepted: { tone: 'ok', text: 'Accepted — generating in the background. No embedding exists yet.' },
  in_flight: { tone: 'ok', text: 'Already generating — a request for this topic is in flight.' },
  already_embedded: { tone: 'ok', text: 'Already embedded — nothing to generate.' },
  disabled: { tone: 'warn', text: 'Embedding generation is currently disabled.' },
  not_found: { tone: 'err', text: 'Topic not found — it may no longer exist.' },
  missing_topic_id: { tone: 'err', text: 'Rejected — topic id missing or malformed.' },
  unauthorized: { tone: 'err', text: 'Not authorized to generate embeddings.' },
  error: { tone: 'err', text: 'Generation failed.' },
};

const TONE_COLOR = { ok: 'green', warn: '#a15c00', err: 'crimson' } as const;

export default function KnowledgeGraphCuration(): React.ReactElement {
  const [filter, setFilter] = useState<Filter>('identities');
  const [search, setSearch] = useState('');
  const [items, setItems] = useState<ReviewTopic[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [sourceId, setSourceId] = useState('');
  const [canonicalId, setCanonicalId] = useState('');
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [newLabel, setNewLabel] = useState('');
  const [creating, setCreating] = useState(false);
  const [createMsg, setCreateMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [embed, setEmbed] = useState<Record<string, EmbedState>>({});
  const [embedDetail, setEmbedDetail] = useState<Record<string, string>>({});
  /** Synchronous duplicate-click guard — see generateEmbedding. */
  const inFlight = useRef<Set<string>>(new Set());

  const load = useCallback(async (f: Filter, p: number, term: string) => {
    setLoading(true);
    setError(null);
    try {
      const url = TOPICS_API + '?filter=' + encodeURIComponent(f) + '&page=' + p + '&search=' + encodeURIComponent(term);
      const res = await fetch(url);
      if (!res.ok) throw new Error('Request failed (' + res.status + ')');
      const json = await res.json();
      setItems(Array.isArray(json.items) ? json.items : []);
      setHasMore(Boolean(json.hasMore));
    } catch (e) {
      setError((e as Error)?.message || 'Failed to load topics');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(filter, page, search); }, [load, filter, page, search]);

  /** Both actions delegate to B7.5; its deterministic response is surfaced verbatim. */
  const mutate = useCallback(async (method: 'POST' | 'DELETE', body: Record<string, string>) => {
    setMsg(null);
    try {
      const res = await fetch(CURATION_API, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Surface B7.5's deterministic failure (would_create_cycle,
        // canonical_is_alias, …) rather than optimistically overwriting state.
        setMsg({ type: 'err', text: String(json.error || json.code || 'Failed (' + res.status + ')') });
        return;
      }
      setMsg({ type: 'ok', text: String(json.action) + ': ' + String(json.topicId) });
      await load(filter, page, search);
    } catch (e) {
      setMsg({ type: 'err', text: (e as Error)?.message || 'Request failed' });
    }
  }, [filter, page, search, load]);

  /**
   * B7.8-C.6 — request embedding generation for one topic.
   *
   * The in-flight ref (not component state) is what actually prevents a double
   * POST: it is written synchronously on entry, so a second click landing in
   * the same tick as the first is refused regardless of render timing. The
   * disabled button is the visible half of the same guard, not the guard.
   *
   * Server-side idempotency already exists, so a duplicate would be harmless —
   * but it would also be a second billable provider call, which is exactly the
   * spend B7.8-C accounts for.
   */
  const generateEmbedding = useCallback(async (topicId: string) => {
    if (inFlight.current.has(topicId)) return;
    inFlight.current.add(topicId);
    setEmbed((m) => ({ ...m, [topicId]: 'pending' }));
    setEmbedDetail((m) => ({ ...m, [topicId]: '' }));

    try {
      const res = await fetch(EMBED_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // topicId is the ONLY field. No company, provider, model, cost or text
        // is sent — the route ignores extra fields, and the provider input is
        // read server-side from the stored canonical label.
        body: JSON.stringify({ topicId }),
      });
      const json = await res.json().catch(() => ({}));

      // Trust the route's own state name when it gives one; fall back to the
      // transport status only for guard rejections, which never carry a body.
      const named = typeof json.status === 'string' ? (json.status as EmbedState) : null;
      const state: EmbedState = named && EMBED_FEEDBACK[named]
        ? named
        : res.status === 401 || res.status === 403
          ? 'unauthorized'
          : 'error';

      setEmbed((m) => ({ ...m, [topicId]: state }));
      // Surface the route's deterministic reason verbatim rather than inventing
      // a friendlier one that hides what actually failed.
      setEmbedDetail((m) => ({
        ...m,
        [topicId]: state === 'error'
          ? String(json.reason || json.error || json.code || 'HTTP ' + res.status)
          : '',
      }));
    } catch (e) {
      setEmbed((m) => ({ ...m, [topicId]: 'error' }));
      setEmbedDetail((m) => ({ ...m, [topicId]: (e as Error)?.message || 'Request failed' }));
    } finally {
      inFlight.current.delete(topicId);
    }
    // Deliberately NO list reload and NO polling: acceptance is not completion,
    // and the list carries no embedding column to refresh.
  }, []);

  /**
   * B7.9 — create a topic, then refresh so the new row appears in the list.
   *
   * `already_exists` (409) is surfaced as an error rather than silently
   * treated as success: an operator who believes they created something new
   * must not be told they did. The response carries the existing topicId so
   * they can act on the real row.
   */
  const createTopic = useCallback(async () => {
    if (creating) return;
    setCreating(true);
    setCreateMsg(null);
    try {
      const res = await fetch(AUTHORING_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: newLabel }),   // the ONLY field sent
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setCreateMsg({ type: 'err', text: String(json.error || json.code || 'Failed (' + res.status + ')') });
        return;
      }
      setCreateMsg({ type: 'ok', text: 'Created: ' + String(json.canonicalLabel ?? newLabel) });
      setNewLabel('');
      await load(filter, page, search);
    } catch (e) {
      setCreateMsg({ type: 'err', text: (e as Error)?.message || 'Request failed' });
    } finally {
      setCreating(false);
    }
  }, [creating, newLabel, filter, page, search, load]);

  /**
   * B7.9 — rename an INERT topic. Offered only when the row has no canonical
   * parent and no embedding; the service re-checks both, so the UI condition
   * is a courtesy, not the guard.
   */
  const renameTopic = useCallback(async (topicId: string, label: string) => {
    setCreateMsg(null);
    try {
      const res = await fetch(AUTHORING_API, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topicId, label }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setCreateMsg({ type: 'err', text: String(json.error || json.code || 'Failed (' + res.status + ')') });
        return;
      }
      setCreateMsg({ type: 'ok', text: String(json.action) + ': ' + String(json.canonicalLabel) });
      await load(filter, page, search);
    } catch (e) {
      setCreateMsg({ type: 'err', text: (e as Error)?.message || 'Request failed' });
    }
  }, [filter, page, search, load]);

  const visible = items.filter((t) => !dismissed.has(t.id));

  return (
    <div style={{ padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontSize: 20, marginBottom: 4 }}>Canonical topic curation</h1>
      <p style={{ color: '#666', fontSize: 13, marginTop: 0 }}>
        Platform-wide topic identities. Confirm one topic as an alias of another, or reverse it.
        No automatic merging &mdash; every change is an explicit operator decision.
      </p>

      <div style={{ display: 'flex', gap: 8, margin: '16px 0', flexWrap: 'wrap' }}>
        {(['identities', 'aliases', 'all'] as Filter[]).map((f) => (
          <button
            key={f}
            data-testid={'filter-' + f}
            onClick={() => { setFilter(f); setPage(0); }}
            style={{ fontWeight: filter === f ? 700 : 400 }}
          >
            {f}
          </button>
        ))}
        <input
          aria-label="Search topics"
          placeholder="search label"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(0); }}
        />
      </div>

      {/* B7.9 — the only way to author a topic in-product. Creation is an
          OBSERVATION (state=observed, confidence=low); confirming identity
          still requires the curation action below. */}
      <fieldset style={{ margin: '16px 0', padding: 12 }}>
        <legend>Create topic</legend>
        <input
          aria-label="New topic label"
          placeholder="new topic label"
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          style={{ minWidth: 320 }}
        />
        <button
          data-testid="create-topic-btn"
          disabled={creating || !newLabel.trim()}
          onClick={() => void createTopic()}
        >
          {creating ? 'Creating…' : 'Create topic'}
        </button>
        {createMsg && (
          <span
            data-testid="create-message"
            style={{ marginLeft: 8, fontSize: 12, color: createMsg.type === 'ok' ? 'green' : 'crimson' }}
          >
            {createMsg.text}
          </span>
        )}
      </fieldset>

      <fieldset style={{ margin: '16px 0', padding: 12 }}>
        <legend>Confirm canonical relationship</legend>
        <input
          aria-label="Source topic id"
          placeholder="source topic id"
          value={sourceId}
          onChange={(e) => setSourceId(e.target.value)}
        />
        <input
          aria-label="Canonical topic id"
          placeholder="canonical topic id"
          value={canonicalId}
          onChange={(e) => setCanonicalId(e.target.value)}
        />
        <button
          data-testid="confirm-btn"
          disabled={!sourceId || !canonicalId}
          onClick={() => void mutate('POST', { topicId: sourceId, canonicalTopicId: canonicalId })}
        >
          Confirm
        </button>
      </fieldset>

      {msg && (
        <p data-testid="message" style={{ color: msg.type === 'ok' ? 'green' : 'crimson' }}>{msg.text}</p>
      )}
      {loading && <p data-testid="loading">Loading</p>}
      {error && <p data-testid="error" style={{ color: 'crimson' }}>{error}</p>}
      {!loading && !error && visible.length === 0 && (
        <p data-testid="empty">
          No topics to review. Candidate generation arrives in B7.7; until then, pair topic ids manually above.
        </p>
      )}

      {!loading && !error && visible.length > 0 && (
        <table data-testid="topic-table" style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr>
              <th align="left">Label</th>
              <th align="left">Normalized</th>
              <th align="left">State</th>
              <th align="left">Confidence</th>
              <th align="right">Seen</th>
              <th align="left">Canonical</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {visible.map((t) => (
              <tr key={t.id} data-testid={'row-' + t.id}>
                <td>{t.canonicalLabel}</td>
                <td><code style={{ fontSize: 12 }}>{t.normalizedLabel}</code></td>
                <td>{t.state}</td>
                <td>{t.confidence}</td>
                <td align="right">{t.occurrenceCount}</td>
                <td>{t.canonicalTopicId ? <code style={{ fontSize: 11 }}>{t.canonicalTopicId}</code> : '-'}</td>
                <td>
                  {t.canonicalTopicId ? (
                    <button data-testid={'reverse-' + t.id} onClick={() => void mutate('DELETE', { topicId: t.id })}>
                      Reverse
                    </button>
                  ) : (
                    <button data-testid={'use-' + t.id} onClick={() => setCanonicalId(t.id)}>
                      Use as canonical
                    </button>
                  )}
                  <button data-testid={'dismiss-' + t.id} onClick={() => setDismissed((d) => new Set(d).add(t.id))}>
                    Leave separate
                  </button>
                  {/*
                    Offered only for topic IDENTITIES (no canonical parent). An
                    alias resolves to its canonical topic, so embedding it would
                    spend on a vector nothing will ever query.
                  */}
                  {!t.canonicalTopicId && (
                    <button
                      data-testid={'embed-' + t.id}
                      disabled={embed[t.id] === 'pending'}
                      onClick={() => void generateEmbedding(t.id)}
                    >
                      {embed[t.id] === 'pending' ? 'Requesting…' : 'Generate embedding'}
                    </button>
                  )}
                  {/*
                    Rename is offered ONLY while the topic is inert: no
                    canonical parent and no embedding. A stored vector was
                    computed from the current label, so renaming an embedded
                    topic would leave the vector describing text that is no
                    longer there. The service re-checks both conditions.

                    B7.9.2: `hasEmbedding` is the PERSISTED fact, from the row.
                    `embed[t.id]` is only this session's activity — it was the
                    sole embedding guard in B7.9, so after a reload an embedded
                    topic still offered Rename. It is kept as a transient guard
                    for a topic embedded moments ago in this same tab, before
                    the list has been refetched.
                  */}
                  {!t.canonicalTopicId && !t.hasEmbedding && !embed[t.id] && (
                    <button
                      data-testid={'rename-' + t.id}
                      onClick={() => {
                        const next = typeof window !== 'undefined'
                          ? window.prompt('New label for this topic', t.canonicalLabel)
                          : null;
                        if (next && next.trim() && next.trim() !== t.canonicalLabel) {
                          void renameTopic(t.id, next.trim());
                        }
                      }}
                    >
                      Rename
                    </button>
                  )}
                  {embed[t.id] && (
                    <span
                      data-testid={'embed-status-' + t.id}
                      data-state={embed[t.id]}
                      style={{ marginLeft: 8, fontSize: 12, color: TONE_COLOR[EMBED_FEEDBACK[embed[t.id]].tone] }}
                    >
                      {EMBED_FEEDBACK[embed[t.id]].text}
                      {embedDetail[t.id] ? ' ' + embedDetail[t.id] : ''}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div style={{ marginTop: 12 }}>
        <button data-testid="prev" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
          Prev
        </button>
        <span style={{ margin: '0 8px' }}>page {page + 1}</span>
        <button data-testid="next" disabled={!hasMore} onClick={() => setPage((p) => p + 1)}>
          Next
        </button>
      </div>
    </div>
  );
}
