# SC-7 (DRAFT) — Canonical message-classification vocabulary

Status: **DRAFT for agreement.** Addressed to **PI** (prospect lifecycle) and **Orchestration** (journeys).
Owner of the draft: Outreach / Engagement Intelligence (Agent B). The Outreach lead owns the shared contract; nothing here is binding until PI and Orchestration agree.
Vocabulary version: `sc7-draft-1`. Governance detector version: `sc7-gov-1`.

Code: `backend/services/engagementClassification/` (`vocabulary.ts`, `governanceDetection.ts`, `legacyMappings.ts`, `classifyMessage.ts`).

## 1. Why

Three classifiers label inbound engagement today, each with its own vocabulary:

| Producer | Level | Vocabulary | Persisted to |
|---|---|---|---|
| `conversationTriageService.classifyThread` (AI, gateway op `conversationTriage`) | thread | 6 community categories | `engagement_thread_classification.classification_category` (by `conversationTriageWorker`) |
| `engagementConversationIntelligenceService.analyzeMessage` (rule-based, plus optional Omnivyra hinting) | message | `lead`, `question`, `complaint`, `general` | `engagement_message_intelligence.intent`, `engagement_thread_intelligence.dominant_intent` |
| `responsePolicyEngine.resolveResponsePolicy` (no classifier; keys `response_rules.intent_type`) | message | 11 `MessageIntent` values | `response_rules.intent_type` (rules), read-only on intents |

A fourth producer feeds the same field: `leadDetectionService` `lead_intent` (14 values), which `pages/api/response/generate.ts` passes to the policy engine as the intent override. It is mapped too.

None of them can express an opt-out, and none can tell a product complaint from a complaint about being contacted. SC-7 adds one vocabulary and one entry point **without a new classifier, prompt or AI call**.

## 2. The vocabulary

| Code | Governance | Description |
|---|---|---|
| `positive_interest` | no | Interest in the offer or in continuing the conversation. |
| `enquiry` | no | Commercial enquiry about the product, service or fit. |
| `information_request` | no | General, non-commercial question. |
| `pricing` | no | Price, cost, plans or commercial terms. |
| `meeting_request` | no | Asks for, accepts or proposes a meeting, call or demo. |
| `objection` | no | Concern or pushback that does not end the conversation. |
| `not_interested` | no | Declines THIS approach. Not an opt-out. |
| `follow_up` | no | Asks to be contacted later / refers to a later time. |
| `complaint` | **yes** | Complaint about being contacted: spam/abuse report, harassment, "how did you get my details", "I never signed up". A product complaint is `support_request`. |
| `support_request` | no | Problem, defect or dissatisfaction with the product or service. |
| `unsubscribe` | **yes** | Remove me from a list / all future messages. |
| `stop` | **yes** | Channel STOP instruction (STOP, STOP ALL, END, QUIT, CANCEL, "stop messaging me"). |
| `wrong_recipient` | no | The message reached the wrong person. |
| `out_of_office` | no | Automatic absence reply. |
| `spam_suspicious` | no | The inbound message itself looks like spam, a scam or bot traffic. |
| `ambiguous` | no | Nothing determinable. Never governance. |

Codes are stable identifiers. Renaming or removing one is a contract change.

## 3. Governance rules (authoritative)

1. **Deterministic only.** `stop`, `unsubscribe`, `complaint` are assigned by `detectGovernanceClasses` alone: no model, no network, no database.
2. **First.** The entry point runs governance detection before any classifier.
3. **Authoritative.** A classifier may ADD labels. It can never remove or replace a governance class. A governance class a classifier suggests (or a legacy `complaint` intent) is reported as `governanceCandidates` for human review and is **never** enforced.
4. **No mapping targets governance.** Every legacy mapping table targets non-governance codes only; unknown labels map to `ambiguous`.
5. **Precedence** when several are present: `complaint` > `stop` > `unsubscribe`. All are returned in `governance`.

### Rules

| Basis | Rule | Class |
|---|---|---|
| keyword | Whole message equals a `WHATSAPP_OPT_OUT_KEYWORDS` entry (reused from `backend/services/whatsappOptOut.ts`, same normalisation via `detectWhatsAppOptOut`). `UNSUBSCRIBE`, `OPT OUT`, `OPTOUT`, `OPT-OUT` → `unsubscribe`; `STOP`, `STOP ALL`, `STOPALL`, `STOP PROMOTIONS`, `CANCEL`, `END`, `QUIT` → `stop`. | stop / unsubscribe |
| keyword (email only) | The same rule on the first non-empty line, so a "STOP" typed above quoted text counts. | stop / unsubscribe |
| channel_signal | `listUnsubscribe` (RFC 8058 one-click) | unsubscribe |
| channel_signal | `providerComplaint` (e.g. SES complaint notification) | complaint |
| channel_signal | `optOutButton` (Meta marketing opt-out button payload) | stop |
| phrase | "stop emailing/messaging/texting/contacting me", "stop sending me … emails", "don't contact me again" | stop |
| phrase | "unsubscribe me", "please unsubscribe", "remove me from your (mailing) list", "take me off your list", "opt me out", "I'd like to unsubscribe" | unsubscribe |
| phrase | "this is spam", "stop spamming", "marked this as spam", "I will report you", "we reported your company", "this is harassment", "how did you get my email", "I never signed up", "file a formal complaint", "unsolicited emails" | complaint |

Phrase rules are intentionally narrow. Unit-tested near misses that are **not** governance: "please stop calling me at night", "send me the report you mentioned", "do not contact me before Monday", "let us cancel the meeting", "our spam filter caught your email".

Evidence (`governanceMatches`) never contains message text: a keyword match carries the keyword, a phrase match the rule id, a signal match the signal name.

**Classification is not recording.** The detector writes nothing. The WhatsApp governance WRITE (`recordWhatsAppOptOut` → `recordContactGovernance`) is unchanged and still fires on the whole-message keyword rule only. Whether phrase and channel-signal matches should also record a governance restriction is decision **Q-1** below.

## 4. Mapping tables (legacy → canonical)

`fit`: exact (same meaning), approximate (nearest class), none (no equivalent → `ambiguous`). All tables are total (unit-tested against each producer's own source of truth).

### 4.1 `conversationTriageService` (`CLASSIFICATION_CATEGORIES`)

| Legacy | Canonical | Fit |
|---|---|---|
| question_request | information_request | exact |
| recommendation_request | enquiry | approximate |
| competitor_complaint | ambiguous | none (Q-2) |
| problem_discussion | ambiguous | none (Q-2) |
| product_comparison | enquiry | approximate |
| general_comment | ambiguous | exact |

### 4.2 `engagementConversationIntelligenceService` (`intent`)

| Legacy | Canonical | Fit | Governance candidate |
|---|---|---|---|
| lead | positive_interest | approximate | |
| question | information_request | exact | |
| complaint | support_request | approximate | complaint |
| general | ambiguous | exact | |

### 4.3 `responsePolicyEngine` (`MessageIntent`)

| Legacy | Canonical | Fit | Governance candidate |
|---|---|---|---|
| greeting | ambiguous | none | |
| introduction | ambiguous | none | |
| question | information_request | exact | |
| product_inquiry | enquiry | exact | |
| price_inquiry | pricing | exact | |
| positive_feedback | positive_interest | approximate | |
| negative_feedback | objection | approximate | |
| complaint | support_request | approximate | complaint |
| lead_interest | positive_interest | exact | |
| general_discussion | ambiguous | exact | |
| spam | spam_suspicious | exact | |

### 4.4 `leadDetectionService` (`lead_intent`)

| Legacy | Canonical | Fit |
|---|---|---|
| solution_exploration | enquiry | approximate |
| tool_search | enquiry | approximate |
| interest_expressed | positive_interest | exact |
| pricing_inquiry | pricing | exact |
| demo_request | meeting_request | exact |
| usage_inquiry | information_request | approximate |
| trial_interest | positive_interest | approximate |
| connection_request | meeting_request | approximate |
| implementation_interest | positive_interest | approximate |
| comparison_inquiry | enquiry | approximate |
| lead_interest | positive_interest | exact |
| product_inquiry | enquiry | exact |
| price_inquiry | pricing | exact |
| trial_request | positive_interest | approximate |

### 4.5 Codes no existing producer emits

`not_interested`, `follow_up`, `wrong_recipient`, `out_of_office` have **no producer today**. `meeting_request` only via lead detection. They are in the vocabulary so PI/Orchestration can key on them now; filling them needs a decision (Q-3), not a new classifier by default.

## 5. Interface

```ts
import { classifyMessage } from '@/backend/services/engagementClassification';

const c = await classifyMessage({
  text,                       // inbound message body
  channel: 'email',           // 'whatsapp' | 'email' | 'sms' | 'linkedin' | 'community' | ...
  signals: { listUnsubscribe, providerComplaint, optOutButton },  // optional
  sentimentScore,             // optional, engagement_messages.sentiment_score
  legacy: { triageCategory, intelligenceIntent, policyIntent, leadIntent }, // optional, already-stored labels
});
// c.code                 primary canonical code (governance first)
// c.governance           authoritative governance classes, most restrictive first
// c.governanceMatches    [{ code, basis: 'keyword'|'channel_signal'|'phrase', rule }]
// c.labels               all distinct canonical codes, governance first
// c.governanceCandidates advisory only — NEVER enforce
// c.sources              [{ source, value, code, fit }]
// c.vocabularyVersion    'sc7-draft-1'
// c.detectorVersion      'sc7-gov-1'
```

Per-service additive helpers: `TriageResult.canonical_code` and `canonicalCodeForTriageCategory`; `canonicalCodeForIntelligenceIntent` (and `ruleBasedAnalysis` is now exported, unchanged); `canonicalCodeForPolicyIntent`.

## 6. Proposed effects — for PI and Orchestration to agree

These are **proposals**. Nothing in this change wires them. PI's outcome interpreter (`prospectLifecycle/outcomeInterpreter.ts`) consumes `BusinessOutcomeType`; Orchestration's journey exit (`orchestration/journeyResponses.ts`) consumes `JOURNEY_EXIT_OUTCOMES`. The proposal maps canonical classes onto those existing vocabularies rather than inventing new events.

| Canonical | Proposed business outcome (PI input) | Proposed PI lifecycle effect | Proposed Orchestration journey event |
|---|---|---|---|
| stop | `unsubscribed` | → `closed_disqualified` (existing map) + governance type **`dnc_channel`** (purpose-blind by design, DR-2). `stop` is NOT a governance type; `recordContactGovernance` rejects it as `unknown_governance_type` | exit journey (`unsubscribed`); suppress channel |
| unsubscribe | `unsubscribed` | → `closed_disqualified` (existing map) + restriction | exit journey (`unsubscribed`) |
| complaint | `unsubscribed` **plus** a `complaint` governance record (all channels `*`, as SES complaints are today) | → `closed_disqualified`; flag for review | exit journey; suppress all channels; alert operator |
| not_interested | `replied` (derived); `rejected` only when an operator confirms (PI requires `rejected` to be human) | `replied` → `engaged`; operator may then record `rejected` → `not_interested` | exit journey (`replied`) |
| positive_interest | `replied` | → `engaged` | exit journey (`replied`); hand to human |
| enquiry / information_request / pricing | `replied` | → `engaged` | exit journey (`replied`); hand to human |
| meeting_request | `replied` (`meeting_booked` stays unobservable until a booking integration exists) | → `engaged` | exit journey (`replied`); task: schedule |
| objection | `replied` | → `engaged` | exit journey (`replied`); hand to human |
| follow_up | `replied` | → `engaged`; propose `nurture` with a follow-up date (needs PI policy) | pause/exit (`replied`); propose a re-entry timer (Q-4) |
| support_request | `replied` | no change beyond `engaged`; route to support | exit journey (`replied`); route to support |
| wrong_recipient | none (not engagement) | propose governance type **`invalid_contact`** (not purpose-scoped) on the contact point, not a prospect transition | exit journey for that contact point; do not retry same address |
| out_of_office | none (not a reply) | no transition | do NOT exit; propose delaying the next step |
| spam_suspicious | none | no transition | do not exit; flag |
| ambiguous | none; route to operator review | no transition (an undetected auto-reply or missed spam lands here, so "a human answered" is not established; PI review 2026-11-04) | do not exit; flag for review |

**`not_interested` is two unrelated things.** The canonical CODE `not_interested` (this vocabulary) and PI's lifecycle STATE `not_interested` share a spelling only. The code yields outcome `replied` → state `engaged`; the state is reached only from a human-recorded `rejected`. The code must never produce the state without an operator.

**Closure is irreversible; restriction is not.** `unsubscribed` → `closed_disqualified` is PI's only terminal state (`stateModel.ts:112,120`, no transitions out), while a governance restriction can be revoked (`revokeContactGovernance`). So a false-positive governance class permanently closes a prospect with no operator remedy. See Q-1.

Note: today Orchestration treats ANY inbound WhatsApp message as `replied` (unless it is a whole-message opt-out), and an out-of-office auto-reply on email would end a journey. Adopting this table changes that; that is a decision for Orchestration.

## 7. Persistence

`engagement_thread_classification.classification_category` is `TEXT NOT NULL` with **no CHECK** (`database/engagement_thread_classification.sql`, `supabase/migrations/20260701000000_runtime_missing_contract_tables.sql`). `engagement_message_intelligence.intent` is unconstrained TEXT too. So canonical codes COULD be written without a schema change, but **must not** be written into the legacy columns: `components/engagement/ThreadList.tsx`, `AIEngagementAssistant.tsx`, the inbox, priority and digest services read the legacy six categories, and `response_rules.intent_type` keys on legacy intents.

**Superseded:** the coordinator wrote the migration as `supabase/migrations/20270125000000_engagement_canonical_classification.sql` (local, test database only; see `MIGRATIONS-20270125.md`). It also makes rule 1 structural: `governance_codes <@ ARRAY['stop','unsubscribe','complaint']`, plus a vocabulary version required whenever a code is present, all validated. The original proposal follows for the record.

```sql
ALTER TABLE public.engagement_thread_classification
  ADD COLUMN IF NOT EXISTS canonical_code TEXT NULL,
  ADD COLUMN IF NOT EXISTS governance_codes TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS classification_vocabulary_version TEXT NULL;
ALTER TABLE public.engagement_thread_classification
  ADD CONSTRAINT engagement_thread_classification_canonical_code_chk
  CHECK (canonical_code IS NULL OR canonical_code IN (
    'positive_interest','enquiry','information_request','pricing','meeting_request','objection',
    'not_interested','follow_up','complaint','support_request','unsubscribe','stop',
    'wrong_recipient','out_of_office','spam_suspicious','ambiguous')) NOT VALID;

ALTER TABLE public.engagement_message_intelligence
  ADD COLUMN IF NOT EXISTS canonical_code TEXT NULL,
  ADD COLUMN IF NOT EXISTS governance_codes TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS classification_vocabulary_version TEXT NULL;
-- same CHECK, NOT VALID
```

Grants: these tables already exist; adding columns does not change grants. The writer change (worker / `analyzeMessage` writing the new columns) is a follow-up after the migration is applied, and must not land before it (the write would fail).

## 8. Open questions

- **Q-1 (Governance, PI):** should phrase-level and channel-signal governance matches RECORD a contact-governance restriction, or only classify? Today only the WhatsApp whole-message keyword records. Recommendation (revised after PI review, 2026-11-04): channel signals record (transport facts such as List-Unsubscribe or a provider complaint notification); **all phrase matches, `stop` and `unsubscribe` as well as `complaint`, route to operator review before anything is recorded**, because the resulting `closed_disqualified` is irreversible (§6). Still an owner decision.
- **Q-2:** community-shaped triage labels (`competitor_complaint`, `problem_discussion`) have no reply-shaped equivalent. Keep them as a separate community dimension, or add canonical codes?
- **Q-3:** who produces `not_interested`, `follow_up`, `wrong_recipient`, `out_of_office`? Options: deterministic rules (headers such as `Auto-Submitted`, `X-Autoreply` for out_of_office), extending the existing triage prompt (owned by Platform AI), or operator labelling.
- **Q-4 (Orchestration):** `follow_up` and `out_of_office` imply re-timing a journey, which today has no outcome-driven branching by design.
- **Q-5:** thread vs message: triage is thread-level; canonical is message-level. Proposal: a thread's canonical governance is the union of its messages' governance, never overwritten by a later message.
