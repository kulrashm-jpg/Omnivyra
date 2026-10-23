# ENG-G22 — OWNER DECISION: TENANT DISCOVERY FROM PROVIDER MESSAGE ID

**Architecture decision gate only.** No source, schema, migration, deployment, provider
call or DNS change was made. ENG-004 was not reopened. ENG-005 is not authorized.

**Recommendation in one line:** adopt **Option D (composite convergence)** as the target,
reached in three stages — **A today, B next, D when tenant-owned sender identities land** —
with the authoritative anchor being *infrastructure we provisioned*, never a payload field.

**G-22 status: OWNER DECISION REQUIRED.** Nothing below marks it MET.

---

## 1. Current state

| Fact | Evidence |
|---|---|
| provider-event path exists | `pages/api/webhooks/ses.ts` → `sesProviderEventIngestion` → `ingestFeedback` (ENG-003) |
| tenant discovery is implemented as an interim | `discoverTenantForProviderMessage({provider, providerMessageId})` — refuses on 0 matches and on >1 tenant |
| tenant-scoped resolution is separate | `resolveProviderMessage({companyId, provider, providerMessageId})` — tenant required in the predicate, reads **all** rows, requires task-id unanimity |
| correlation key is **not** unique | `idx_outreach_delivery_provider_message (company_id, provider, provider_message_id)` is a **plain index** |
| what *is* unique | `uq_outreach_delivery_provider_event (company_id, provider, provider_event_id)`; `uq_outreach_delivery_logical (company_id, task_id, delivery_status, observed_at)`; `outreach_attempts_unique (company_id, task_id, attempt_number)`; `uq_outreach_attempts_idempotency (company_id, idempotency_key)` |
| the send always records the message id | `dispatch.ts:313` writes `outreach_delivery_evidence` for **every** outcome, carrying `providerMessageId` |
| one platform sender today | `EMAIL_FROM`, a single process-global SES identity. Tenant sending domains and sender identities are **NOT FOUND** in the codebase (W2-P) |
| the outbound idempotency key cannot return | the transport computes and sends `idempotencyKey`; the Edge Function has no field for it and **discards** it (ENG-003/A-O) |

So today the only tenant signal an SES notification carries is a message id we minted.
That is why the interim mechanism exists at all, and why it is explicitly unratified.

---

## 2. Problem statement

> Once tenant-owned sender identities exist, what is the authoritative mechanism for
> establishing tenant ownership of an authenticated provider event that arrives carrying
> only provider identifiers?

The interim answer — "look the message id up in delivery evidence and take the single
tenant that matches" — is safe **only** while every message id was minted by one platform
identity on behalf of exactly one tenant, and while the lookup refuses ambiguity. Both
premises weaken the moment multiple tenant-owned identities, multiple providers and
inbound replies enter the picture.

---

## 3. Security threat model

Assume an attacker can set every header and every byte of a message body, and can send
mail to any address we publish.

| Signal | Trustworthy? | Why |
|---|---|---|
| SNS signature + allow-listed `TopicArn` | **YES** | RSA-verified against an AWS certificate on an `sns.<region>.amazonaws.com` host, then the topic is checked against `SES_SNS_TOPIC_ARNS`. Proves the event came from AWS **and** from our topic |
| `mail.messageId` (AWS-minted, outbound) | **authentic, but not authorizing** | AWS minted it, so it is not forged. It still does not *say* whose tenant it is |
| SNS `MessageId` (the event id) | **YES, as an identity** | the deduplication key |
| the receiving identity for inbound mail | **YES** | which of *our* provisioned identities received the message is a fact about our infrastructure, not about the payload |
| the sender identity / configuration set on an outbound event | **YES once it exists** | we provisioned and verified it |
| `From`, `To`, `Reply-To`, `Subject` | **NO** | attacker-controlled |
| **`In-Reply-To`, `References`, `Message-ID` (inbound)** | **NO** | attacker-controlled. An attacker can quote a *valid* MessageId belonging to **another tenant** |
| message body, quoted text | **NO** | attacker-controlled |

**The decisive consequence.** For an inbound reply, the quoted message id is simultaneously
the most *useful* correlation signal and an **attacker-chosen value**. Anything that treats
it as authorizing lets a stranger address another tenant's conversation by quoting its id.
It may be used as *corroboration*. It must never be the anchor.

AWS documents `MessageId` as the identifier of the message. **I found no AWS contractual
guarantee of global uniqueness across accounts**, and §5 forbids inventing provider
guarantees, so this decision assumes none.

---

## 4. Option A — provider event → delivery evidence → tenant

*What ENG-003 implemented.*

Resolve `(provider, provider_message_id)` against `outreach_delivery_evidence`; if exactly
one tenant matches, that is the tenant; then re-resolve scoped to it and require task-id
unanimity.

**Strengths.** Zero new schema. Reuses a row `dispatch.ts` already writes for every
outcome. Multi-row safe by construction — no `LIMIT 1`, no ordering reliance, refuses on
tenant or task disagreement (runtime-proven in ENG-003's suite and ENG-004's probes).

**Weaknesses, stated plainly.**
- The tenant is **derived from a payload identifier**, which is precisely the pattern
  ENG-002 §13 warned against. It is defensible today only because that identifier was
  minted by our own send.
- It requires outbound evidence to exist **before** the event arrives. §9F below shows that
  window is real.
- With tenant-owned senders it gains nothing: the event would then carry a *better* signal
  (the sender identity) that this model ignores.
- For **inbound**, it is unsafe outright — the message id would come from the attacker, not
  from AWS.

**Verdict: adequate as an interim for outbound events under one platform identity. Not a
target architecture, and not usable for inbound.**

---

## 5. Option B — provider message id → outbound correlation record

Persist a tenant-owned, immutable outbound correlation row:
`provider`, `provider_message_id`, `organization_id`, `execution_instance_id`,
`execution_task_id`, `attempt_id`, `sender_identity_id`.

**The finding that matters: almost all of this already exists.** The chain is already
complete and tenant-scoped at every hop:

```
outreach_attempts   UNIQUE (company_id, task_id, attempt_number)
                    UNIQUE (company_id, idempotency_key)
      ↓ task_id
outreach_tasks
      ↓ (organization_id, outreach_task_id)  ← UNIQUE on the handoff
outreach_bridge_handoffs   UNIQUE (organization_id, execution_task_id)
   carries organization_id, campaign_id, workflow_id, workflow_version_id,
   execution_instance_id, execution_plan_id, execution_plan_step_id,
   subject_kind, subject_id, person_id, execution_mode, policy_source
```

So Option B is **not new infrastructure**. The only missing piece is a **tenant-scoped
unique key on the provider message id** bound to the attempt. Everything else is a join
across keys that are already unique.

**Strengths.** Makes the correlation explicit and intentional rather than incidental.
Attempt-level resolution (§9H) becomes exact. Naturally reaches the Execution Instance,
which later lifecycle and engagement intelligence will want. Uniqueness becomes a database
guarantee instead of an application convention.

**Weaknesses.** Still anchors on a provider identifier, so it inherits Option A's inbound
weakness. Needs a decision on whether the key is unique per `(organization_id, provider,
provider_message_id)` or globally per `(provider, provider_message_id)` — and the honest
answer is tenant-scoped, since no provider guarantee supports the global form.

**Verdict: the right next step, and cheap. Still not sufficient alone for inbound.**

---

## 6. Option C — tenant-owned provider/sender identity

Tenant comes from the sender identity or provider configuration the event names.

**This option needs restating before it can work, and that is a substantive correction.**
As written it assumes the event names *our* sender. For an **outbound** notification
(Delivery/Bounce/Complaint) that is true — SES reports the source and, if configured, the
configuration set. For an **inbound** reply it is false: the sender is the *prospect*. The
tenant-owned fact on an inbound event is the **receiving** identity, not the sending one.

So Option C is really: *tenant comes from whichever of our provisioned identities the event
touched* — the sender identity outbound, the inbound identity inbound.

**Strengths.** The anchor is infrastructure we created and verified, not a payload field.
Survives the §3 threat model completely: an attacker cannot change which of our identities
received their mail. Aligns exactly with W2-P's per-tenant sending domain and Pattern C
inbound subdomain. Independent of any message-id uniqueness assumption.

**Weaknesses.** **It does not exist yet** — no sending domain, sender identity or provider
identity model is in the codebase. SES inbound reports the recipient, but whether a given
provider always exposes sufficient identity is per-provider and unverified. A revoked or
reassigned identity needs defined historical semantics (§9I). And an identity alone cannot
name the *task* or *attempt* — it gives the tenant, not the correlation.

**Verdict: the correct anchor, and necessarily later. Insufficient alone, because it
answers "whose?" but not "which message?".**

---

## 7. Option D — composite convergence

Resolve independently from more than one source and accept only on agreement:

```
anchor      tenant-owned identity the event touched
              outbound: sender identity / configuration set
              inbound:  the receiving inbound identity
correlation provider_message_id -> outbound correlation record -> tenant, task, attempt
agreement   both must name the SAME organization
disagreement  FAIL CLOSED, and alert — this is a security event, not a validation error
```

**Strengths.** The anchor is untrusted-input-free; the correlation supplies task and
attempt. Each covers the other's gap: C gives tenant without correlation, B gives
correlation without a trustworthy anchor. It is the only model under which an inbound reply
quoting another tenant's message id is **refused rather than misrouted** — the receiving
identity says tenant A, the quoted id resolves to tenant B, they disagree, it fails closed.
Channel- and provider-portable, because "the identity we provisioned" and "the id the
provider minted" are concepts every channel has.

**Weaknesses.** The most architecture and the most persistence. Depends on sender identity
infrastructure, so it cannot be built first. Needs an explicit rule for events where only
one source is available (see the staging below).

**Verdict: the target architecture.**

---

## 8. Comparison matrix

| Criterion | A — evidence lookup | B — correlation record | C — tenant identity | **D — convergence** |
|---|---|---|---|---|
| security strength | moderate | moderate+ | high | **highest** |
| tenant-isolation strength | refuses ambiguity, but infers from payload | same, with a DB guarantee | anchor is not payload | **two independent sources must agree** |
| provider portability | needs a message id that survives | needs a message id that survives | per-provider identity exposure varies | **degrades gracefully; uses what each provider gives** |
| SES compatibility | works today | works today | needs sender identities | **works once identities exist** |
| future providers | weak | weak | medium | **strong** |
| tenant-owned sender identities | ignores them | can carry `sender_identity_id` | requires them | **requires and exploits them** |
| **inbound email** | **unsafe — anchors on an attacker-chosen id** | unsafe alone | safe anchor, no correlation | **safe: anchor + corroboration** |
| retry / multiple attempts | task-level only | **exact attempt** | cannot express | **exact attempt** |
| ambiguity handling | fails closed (implemented) | fails closed, DB-enforced | n/a | **fails closed on disagreement too** |
| implementation complexity | none (done) | **low — the chain exists** | high (depends on W2) | highest |
| migration impact | none | one additive unique key | new tables | additive, staged |
| observability | tenant provenance implicit | explicit and queryable | explicit | **explicit, with a disagreement signal worth alerting on** |
| WhatsApp / SMS / Social later | poor — assumes an outbound-minted id | medium | good | **good** |

---

## 9. Failure / ambiguity matrix

| # | Condition | Required behaviour |
|---|---|---|
| A | no matching evidence | **fail closed.** Never create a tenant, task, attempt or person |
| B | one unambiguous tenant match | resolve |
| C | multiple rows, same tenant, same execution | **safe, and expected.** One provider message legitimately produces several evidence rows — the send-time row, then delivery, then perhaps bounce. This is exactly why `provider_message_id` must **not** be unique. Safe because the rows agree on tenant and task; the resolver reads all of them and requires unanimity |
| D | multiple rows, different tenants | **fail closed** (`cross_tenant_mismatch`) and alert. Do not choose |
| E | message id reused across tenants | must never cross a boundary. Under D the anchor decides and the mismatch is detected; under A/B it is an unresolvable ambiguity → fail closed |
| F | **event arrives before outbound evidence** | **see the finding below — this needs a decision** |
| G | duplicate provider event | idempotent: dedupe on `(company_id, provider, provider_event_id)`, return **2xx** with `duplicate: true`. A 5xx here teaches the provider to retry harder |
| H | multiple attempts for one task | resolve the **exact attempt** where the provider id is attempt-bound (Option B). Today only task-level resolution is possible, and `attemptId` is deliberately dropped rather than guessed when rows disagree |
| I | sender identity revoked / suspended | **historical events remain attributable.** Attribution is a record of what happened; revocation is a statement about future use. Resolution must therefore read the identity's *historical* tenant binding, which means the binding must be immutable and revocation must be a state change, never a delete or a reassignment |

### Finding — failure mode F is a live defect risk, not a hypothetical

`dispatch.ts` writes delivery evidence **after** the transport returns
(`appendDeliveryEvidence` at `:313`, following the provider call). SES can emit a `Delivery`
notification within milliseconds. So there is a real window in which an authentic event
arrives before its evidence row is committed.

ENG-003 classifies `task_not_found` as **non-retryable** (`isRetryable` admits only
`read_failed` and `write_failed`), so the route answers **422**, and **SNS stops retrying**.
A legitimately early event is therefore **permanently dropped**.

The window is small, and larger under load, retry or a crash between the provider call and
the insert. I am **not** fixing this here — this gate authorizes no code — but whichever
option is chosen must specify behaviour for F. The options are to make `task_not_found`
retryable (accepting that genuinely unknown ids then retry for a while), to park
uncorrelated-but-authentic events in a quarantine for later correlation, or to write the
correlation row **before** the provider call using a pre-minted key the provider echoes —
which SES cannot do today, because it discards `idempotencyKey`.

**Recommendation: quarantine-and-retry.** Return 2xx, persist the authentic event
uncorrelated, and correlate on a later sweep. It neither drops authentic evidence nor
teaches the provider to hammer the endpoint.

---

## 10. Recommended architecture

**Target: Option D — composite convergence.** Staged, because C's prerequisite does not
exist yet.

| | Phase 1 — now | Phase 2 — next | Phase 3 — target |
|---|---|---|---|
| mechanism | A, as implemented | A + **B** | **D** |
| authoritative tenant identity | the single tenant whose delivery evidence holds the message id | the correlation record's `organization_id` | **the tenant-owned identity the event touched** (sender outbound, receiving identity inbound) |
| secondary correlation | task-id unanimity across all matching rows | `provider_message_id` → attempt → task → handoff → Execution Instance | the correlation record, supplying task and attempt |
| ambiguity rule | >1 tenant or >1 task ⇒ refuse | DB-enforced uniqueness ⇒ ambiguity impossible, refuse if still found | anchor and correlation disagree ⇒ refuse **and alert** |
| fail-closed rule | no guess, no creation, classified failure | same | same |
| inbound email | **not permitted on this mechanism** | not permitted | **permitted** |

**Required future schema/data** (none authorized here): a tenant-scoped unique key binding
`(organization_id, provider, provider_message_id)` to the attempt; the W2-P sending-domain,
sender-identity and provider-identity model with an **immutable** tenant binding; and a
quarantine for authentic-but-uncorrelated events (§9F).

**Why not simply keep A.** It is the pattern ENG-002 §13 forbids, tolerated because the id
is ours. The moment inbound exists, the id is the attacker's, and A has no way to tell the
difference. The distinction is invisible at the resolver — the same function call, the same
shape of input — which is exactly why this needs to be an architectural decision rather
than a code review.

**Why not jump straight to D.** Its anchor does not exist. Recommending it as *today's*
mechanism would be recommending something unbuildable.

---

## 11. W2-P alignment

```
Company Admin → Sending Domain → DNS/verification → Verified Domain
    → Sender Identity ────────────────────────┐   ① tenant ownership is ESTABLISHED here
    → Email Engagement / Campaign / Workflow  │      (configuration time, by an authorized
    → Email Engine  ← resolves the sender ────┘       admin, on a domain they proved)
    → Common Outreach
    → Provider / SES
    → Provider Message ID ───────────────────────►  ② correlation record written
    → Delivery / Bounce / Complaint / Reply ─────►  ③ event ANCHORED on ① , CORROBORATED by ②
    → Tenant Conversation
```

**G-22 tenant ownership is established at ①, at configuration time** — not at event time.
Event handling does not *discover* a tenant under Option D; it *recognises* one that was
established when an authorized admin verified a domain they controlled. That is the whole
architectural shift: discovery becomes recognition.

Consistent with W2-P §7's fail-closed sender resolution and its no-fallback rule — a tenant
send never falls back to `EMAIL_FROM`, so a tenant-attributable outbound event always has a
tenant-owned identity to anchor on.

---

## 12. Inbound-email alignment

Under W2-P Pattern C, `Reply-To` points at a tenant inbound subdomain and SES inbound
receives it. What survives the §3 threat model:

| Signal | Role |
|---|---|
| SNS signature + allow-listed topic | authenticity |
| **which of our inbound identities received the mail** | **the anchor — tenant comes from here** |
| quoted `In-Reply-To` / `References` | **corroboration only.** Must resolve to the same tenant |
| `From` (the prospect) | corroboration for *person*, never for tenant |
| body, subject | content, never authorization |

An attacker quoting tenant B's message id into a mail sent to tenant A's inbound address
produces anchor = A, correlation = B, **disagreement → fail closed**. Under Option A the
same message would resolve to B and be filed in B's conversation. That single scenario is
the strongest argument in this document.

Where the quoted id resolves to nothing, the reply is still attributable to the tenant but
not to a conversation: attach to the tenant, leave the thread unresolved, and never guess a
person. Never create an identity from a `From` header.

---

## 13. Future multi-channel alignment

| Channel | Anchor (tenant-owned) | Correlation | Notes |
|---|---|---|---|
| Email | sender identity / inbound identity | SES MessageId → correlation record | the reference implementation |
| WhatsApp | the business phone-number id we registered | `wa_message_id` | the existing stack already keys on a registered number — a natural anchor. It currently writes `whatsapp_broadcast_recipients`, not the shared evidence model (ENG-002 G-18) |
| SMS | the registered sending number / 10DLC campaign | provider message sid | same shape |
| Social | the connected account in `social_accounts` | `platform_message_id` | the connected account is already the tenant-owned anchor |
| Voice | the registered number | call id | same shape |

Option D generalizes because every channel has both halves: an identity we registered, and
an id the provider minted. Option A generalizes badly — it assumes an outbound-minted id is
the tenant signal, which is only ever true for outbound.

---

## 14. Owner decision record

```
G-22:                        Tenant discovery from provider message ID

Decision:                    RECOMMENDED — Option D (composite convergence),
                             reached in three phases: A (now) → B (next) → D (target).

Status:                      OWNER DECISION REQUIRED — not accepted, not MET.

Rationale:                   Tenant ownership must be ANCHORED on infrastructure we
                             provisioned, not on an identifier carried in a payload.
                             Today the only available signal is a message id we minted,
                             which is why Option A is defensible as an interim. Once
                             inbound email exists that identifier is attacker-chosen, and
                             Option A cannot distinguish the two cases.

Authoritative tenant         Phase 1-2: the tenant on the delivery-evidence /
identity:                    correlation record for a message id WE minted.
                             Phase 3 (target): the tenant-owned identity the event
                             touched — sender identity outbound, receiving identity
                             inbound.

Secondary correlation:       provider_message_id → attempt → task → handoff →
                             Execution Instance. Supplies task and attempt; never the
                             tenant on its own in Phase 3.

Ambiguity behaviour:         Read every matching row. Never LIMIT 1, never first-row,
                             never rely on ordering. Multiple rows agreeing on tenant and
                             task is EXPECTED and safe. Any disagreement refuses.

Fail-closed behaviour:       No tenant, task, attempt, person or conversation is ever
                             created to make an event resolvable. Failures stay
                             classified (missing_identity, task_not_found, ambiguous_task,
                             cross_tenant_mismatch, read_failed). Anchor/correlation
                             disagreement is refused AND alerted — it is a security event.

Future sender-identity       Phase 3 depends entirely on W2-P: sending domains, sender
dependency:                  identities and provider identities, each with an IMMUTABLE
                             tenant binding so historical events stay attributable after
                             revocation.

Implementation gate:         Phase 2 — a small additive gate (one tenant-scoped unique key
                             binding the provider message id to the attempt; the rest of
                             the chain already exists and is already unique).
                             Phase 3 — after the W2-P sender-identity gate.
                             Failure mode F (§9) should be resolved in Phase 2.

Migration required:          None now. Phase 2: one additive unique key. Phase 3: the
                             W2-P identity tables. Nothing in this gate.

ENG-004 impact:              NONE. ENG-004 is untouched and remains technically ready for
                             owner closure.

ENG-005 dependency:          ENG-005 (inbound email) MUST NOT ship on Phase 1. Inbound is
                             the exact case where Option A's anchor becomes
                             attacker-controlled. ENG-005 requires at minimum Phase 2 plus
                             the inbound-identity anchor from Phase 3.
```

---

## 15. Implementation consequences

If accepted:

1. **Nothing changes today.** The ENG-003 interim stands, unmodified, now with a recorded
   rationale and a recorded expiry condition.
2. **A small Phase 2 gate** becomes available: the tenant-scoped unique key binding
   `(organization_id, provider, provider_message_id)` to the attempt, plus a decision on
   failure mode F. Cheap, because the execution chain and its unique keys already exist.
3. **ENG-005 acquires a hard prerequisite.** Inbound email cannot ship on Phase 1. This is
   the most consequential outcome of accepting the recommendation, and it should be
   recorded against ENG-005 rather than discovered during it.
4. **W2-P gains a requirement:** sender and provider identity bindings must be immutable,
   with revocation as a state change, so §9I holds.
5. **A new operational signal:** anchor/correlation disagreement should alert. It cannot
   occur innocently.

If rejected, the alternative must still answer §12: what authorizes an inbound reply, given
that every header in it is attacker-controlled. "The quoted message id" is not an answer I
can defend.

---

## 16. Explicit non-actions

Nothing was modified. No application source, no migration, no schema, no deployment, no
email, no SES or SNS call, no DNS, no MX. No inbound email, reply correlation or sender
identity was implemented. Common Outreach, Engagement, Workflow and the provider-event path
are untouched. Docker was not started and `omnivyra-worker` was not run. Production was not
read or changed. ENG-004 was not reopened. ENG-005 is not authorized.

`discoverTenantForProviderMessage` and `resolveProviderMessage` are unchanged.

---

## Final state

```
ENG-004:   TECHNICALLY READY FOR OWNER CLOSURE
G-22:      OWNER DECISION REQUIRED  — recommendation above, awaiting accept/reject
ENG-005:   NOT AUTHORIZED
```

**Stopping here for your decision.** The one thing I would draw your eye to before you
decide is §12: under the current interim, an inbound reply that quotes another tenant's
message id resolves to **that other tenant**. That is harmless while no inbound path
exists, and it is the reason ENG-005 must not ship on Phase 1.
