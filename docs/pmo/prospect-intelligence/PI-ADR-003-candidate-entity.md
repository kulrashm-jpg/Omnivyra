# PI-ADR-003 — the Candidate entity

**Status:** ACCEPTED by the orchestrator, 2026-09-23 — **open to reversal by the programme owner**, see §6.
**Base SHA:** `a07477e4` · **Authorises:** contract #11 in `PI-CONTRACT-REGISTER.md`, and WS-C.
**Does not change:** `PI-ADR-001` (the spine), `PI-ADR-002` (the reassessment seam), or the Do-Not-Build register.

---

## 1. The product direction

> Engagement evidence should normally create a **candidate / evidence state first**, not automatically mint a canonical prospect.
> `engagement → evidence → identity resolution → relevance → offering/problem fit → sufficient evidence → canonical prospect`
> Generic engagement must not pollute `canonical_leads`.

The direction was to adopt this **unless repository evidence reveals a conflicting authoritative contract**. A structural analysis of every plausible existing home found **no conflicting contract** — and no existing table that can carry the concept.

## 2. The decision

**A new entity is created: a tenant-scoped, pre-prospect review queue.** It is authorised under `PI-ADR-001` §3.7 — *a new table is justified only when no existing table can carry the concept without corrupting its meaning* — which is exactly the case established below.

**This is not a second Prospect.** The Do-Not-Build register forbids a second *Prospect*, *Person*, *Account*, *Signal*, *ICP*, *suppression*, *scoring* or *outreach* model. The distinguishing test is whether an entity holds **a decision already made** or **a decision pending**. `canonical_leads` holds decisions made. This holds decisions pending — the same architectural category as `person_duplicate_candidates` (a review queue for identity) and `prospect_icp_versions` (a versioned proposal awaiting ratification), both of which were accepted under the same ADR.

## 3. Why every existing home fails — each for a different structural reason

| Home | Fatal defect |
|---|---|
| `lead_intelligence` | **Wrong grain.** `UNIQUE (company_id, dedupe_key)` where the key is `src:…\|tbl:…\|id:<source row id>` — one row per *source observation*, not per person. Two messages from one human are two rows, with nowhere to hold the single verdict. Frozen as "Intelligence Observation". And it is a member of the read-union in `leadIntelligenceReadService.ts:85-88`, so anything written there **renders as a lead to users** — the exact hazard migration `20260907000000`'s header cites as its reason for creating a separate table rather than reusing this one. |
| `active_leads` | **Run-scoped and not canonical.** `ON DELETE CASCADE` from `active_lead_runs` — a candidate would be destroyed when a job is cleaned up. No person column at all, no unique key. `PI-ADR-001` §3.2 item 7 says verbatim it *"is NOT canonical prospect storage and must never be treated as the system of record."* |
| `engagement_identity_candidates` | **No tenant column.** `UNIQUE (platform, external_id)` is *global*, so tenant A's candidate for a handle and tenant B's are the same row, and its person FK is simple rather than composite. This is a tenant-isolation breach, not a modelling preference. Two committed migrations (W1, W5) explicitly refuse to build on it. Zero TypeScript usage. |
| `opportunity_feed_items` / `lead_signals` | Per-signal, no person or account, and no state. `opportunity_lifecycle_states` *does* have a real lifecycle and is the nearest miss — but it is keyed per classified signal, so five posts by one buyer are five independent lifecycles, and it requires a listening signal to exist at all. |
| `person_duplicate_candidates` | `person_id` is **NOT NULL**. A PI candidate must be representable with **no** person. Different question entirely. |
| `canonical_leads` + a status | **`user_id` is NOT NULL**, so every candidate would mint a `canonical_users` subject — pollution moved one table sideways. `external_lead_key` is the only identity key and engagement has none; WS-1 refuses to synthesise one because a fabricated key is unique by construction and replays unboundedly. ~8 readers treat the table as prospects **with no filter, by documented design**. And `lead_status` is already contested: `crmIngestionService.ts:226` overwrites it with the customer's CRM string on every re-ingest, and the manifest already assigns that same column to FR-15 Journey State. |

## 4. The contract

**Identity.** The candidate is anchored to an **identity claim**, not a person — because `socialContactResolution.ts:22-29` refuses to mint a person from a bare handle and that refusal stands. `identity_claims` is already tenant-scoped by construction and its `person_id` is already nullable *"so the shadow resolver can record an observation without asserting a person"*. The candidate key is therefore the claim tuple `(organization_id, claim_type, platform, normalized_value)`.

**Shape, as constraints rather than columns:**
- `organization_id NOT NULL` → `companies(id)`, the W1/LI-4C posture. Never the tenantless shape.
- Composite tenant-safe FK to `identity_claims(id, organization_id)` — the anchor when no person exists.
- `unified_person_id` nullable, composite FK, **`ON DELETE SET NULL`** — a candidate survives person deletion and degrades to person-less rather than blocking the delete. Deliberately *not* `RESTRICT`, which is what `lead_intelligence` took and what makes erasure harder (see `PI-CONTRACT-002`).
- `prospect_account_id` nullable — accounts are optional per §3.1.2.
- **Idempotency by a partial unique index** — one open candidate per identity per tenant. Partial means `ON CONFLICT` **cannot infer it** (`42P10`); writers INSERT and catch `23505`. This trap is documented four separate times in this repo and has already been hit three times.

**Promotion.** The threshold is a **ratified, versioned, immutable policy row** — not a constant in a `.ts` file — evaluated by the existing `prospectIcp/evaluate.ts`, so every transition carries `policy_id` + `policy_version` and is explainable rather than buried. Owner: a new sibling of `prospectResolution.ts` under `prospectIdentity/`, which is already orchestrator-serialised and already returns `insufficient_evidence` — the outcome that today is **dropped on the floor** and that the candidate state finally gives somewhere to live.

Promotion must **not** compute its own score. `prospectResolution.ts:188-191` already refuses to seed `qualification_score` because *"a resolver that seeded a score would put a second scoring authority in the identity layer."* The gate reads WS-6's and the ICP evaluator's verdicts; it does not form its own.

**Audit.** A transition row per move carrying `state`, `previous_state`, `reasoning`, `policy_id`, `policy_version`, `actor_user_id`, `transitioned_at` — modelled on `opportunity_lifecycle_states` — plus LI-4C's resolution-coherence CHECK, which makes a non-open state *impossible* without a stated reason. That is what makes "explainable" enforced by the database rather than promised in a document.

## 5. What this does not decide

The exact state vocabulary, the criteria themselves, and the debounce all belong to the contract WS-C and WS-E write. This ADR fixes only: a new entity, claim-anchored, person-optional, policy-gated, audited.

## 6. The counter-argument, stated fairly — and how to overturn this

If the programme owner judges that the register's spirit is *"no new table, period"*, the least-bad reuse is `lead_intelligence` plus a new tenant-scoped partial unique index and a constrained state column. It works mechanically. Its costs are concrete, not aesthetic:

1. `computeLeadDedupeKey` must change, which **re-keys existing production rows** and breaks `onConflict: 'company_id,dedupe_key'` idempotency for all six `adoptLead` call sites at once — and `adoptLead` is **fail-open**, so those failures would be **silent**.
2. A filter must be added to the read-union or candidates render as leads.
3. Observation and verdict are conflated in one row, so re-observing overwrites the verdict.
4. `ON DELETE RESTRICT` on its person FK would make candidates permanently pin persons against deletion — directly worsening the erasure problem in `PI-CONTRACT-002`.

I judge the new entity clearly better. **This is the one decision in this phase that I made rather than escalated**, and it is the most reversible moment it will ever be — no code exists yet. If the owner prefers the reuse, say so and WS-C re-plans against it.

## 7. A dependency worth recording

`BASELINE-AUDIT-001.md` §C-2 called "which of `leads` / `canonical_leads` / `lead_intelligence` is the source of truth for a lead" the *"single most consequential open question"*, to be resolved before contract freeze. `IMPLEMENTATION-MANIFEST-001.md` resolved it in favour of `canonical_leads`-as-Prospect, but **the audit was never amended**, so the repository still contains an unretracted statement that it is open. This ADR sits directly on top of that resolution. If C-2 is ever reopened, §3 of this document must be re-read before acting.

## 8. No-code confirmation

No application code, schema, migration, flag, provider or production data was changed. This ADR authorises a contract; it implements nothing, and WS-C may not begin until the contract in §5 is written.
