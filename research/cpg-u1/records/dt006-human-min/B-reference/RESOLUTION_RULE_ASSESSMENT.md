# RESOLUTION_RULE_ASSESSMENT — can a deterministic rule replace the reference adjudicator?

**Classification: METHODOLOGY REVIEW / PROPOSAL. NOT REGISTERED. NO PROTOCOL CHANGE.**
DEEPTECH-HUMAN-MIN-001 · AGENT B · 2026-09-24

- Protocol `CPG_U1_PROTOCOL_004.md` sha256 `c50fc680…df00b719` — **unmodified**.
- Instrument aggregate `f7699f05…5eb04e5cc5dd` — read only.

---

## 0. The test each candidate must pass

A rule may replace the adjudicator's *trit* only if all five hold:

| # | Criterion | Why |
|---|---|---|
| C1 | **Introduces no third value.** The sealed row is byte-identical, on the §9.3 value columns, to one of the two submitted records. | §9.5: the adjudicator "cannot supply a third value". A machine may not have a power the human is denied. |
| C2 | **Grounded in frozen normative text**, not in the rule-writer's judgement. | Otherwise it is a choice wearing a rule's clothing, made by a party who is *not* independent. |
| C3 | **Computable with zero knowledge of CPG's output** (including the pilot and the instrument check). | §9.2, §9.6. A rule that reads the resolver under test makes reference truth a function of the thing it judges. |
| C4 | **Pre-registrable and order-independent**: fully specified before the draw, and `rule(a,b) = 'R1' ⟺ rule(b,a) = 'R2'` so the unlabelled Record 1 / Record 2 assignment (§9.2.1) cannot change the outcome. | Otherwise the presentation-order hash silently decides reference truth. |
| C5 | **Does not bias an endpoint in a direction that depends on CPG's behaviour.** | A rule whose sign cannot be stated in advance cannot be defended in advance. |

And one structural constraint that binds every candidate, from §9.6:

> *"The reconciled reference file is produced **only** by `reconcile`: `seal` refuses any reference file
> that is not byte-identical to the reconciliation of the blind records."*

**Any new resolution rule must live inside `reconcile` to be sealable at all.** A bolt-on resolver that
post-processes `reconcile`'s output can never be sealed — `seal` would refuse it. The prototype in
`prototype/` is therefore a *specification for an amended `reconcile`*, explicitly not a usable
side-car, and it says so at the top of the file.

## 1. Legality: what removing the adjudicator requires

§9.5 [enforced] reads:

| Author vs Confirmer | Result |
|---|---|
| Same `value_kind` and same value (whitespace-collapsed, case-insensitive) | `AGREED` — **an adjudication may not override it** |
| Different | **Must** be adjudicated: `AUTHOR` → `ADJUDICATED_AUTHOR`; `CONFIRMER` → `ADJUDICATED_CONFIRMER`; `REFERENCE-CONFLICT` → `REFERENCE_CONFLICT` (excluded from every denominator, published) |

and §15.1/§15.2:

> §15.1 `VALID` · `INVALID` · `REFERENCE-CONFLICT` · plus the rating-time exclusions …
> §15.2 | Reference truth REFERENCE-CONFLICT (sealed) | REFERENCE-CONFLICT — excluded, published |

**Confirmed, with the orchestrator's correction applied.** `REFERENCE-CONFLICT` is an existing sealed
disposition, already excluded from every denominator and already published — **no new disposition is
needed.** But it is *not* a default state a disagreement falls into: it is one of three outcomes the
adjudicator may **declare**, and §9.5 says a difference **must** be adjudicated. The instrument enforces
exactly that (`lib/reconcile.mjs`):

```js
} else {
  if (!j) { errors.push(`${k}: author and confirmer disagree (${agreementKey(a)} vs ${agreementKey(c)})
             — independent adjudication required`); continue; }
```

With no adjudication row the reconciliation **errors out**; there is no code path from "they disagreed"
to `REFERENCE_CONFLICT`. So removing the reference adjudicator requires:

1. a **substantive amendment to §9.1** (deleting the third role row) and **§9.5** (replacing "must be
   adjudicated" with the new deterministic mapping), plus §19.1 re-registration;
2. a change to `reconcile` and a new instrument aggregate — the `ADJUDICATION_DECISIONS` /
   `ADJUDICATION_COLUMNS` machinery, `buildReferenceAdjudicationPacket`,
   `checkReferenceAdjudicationPacket`, `resolveReferenceDecisions` and `authorIsRecord1` all become
   dead or change meaning;
3. a decision on **naming**. Reusing `REFERENCE_CONFLICT` for an un-arbitrated difference would
   conflate two very different published facts: *"a disinterested third reader saw both records and
   could not establish the fact"* versus *"two readers differed and nobody looked"*. The prototype
   therefore emits a distinct `CONFLICT-UNRESOLVED`, to be published as its own line in the exclusion
   table. This is a recommendation, not a protocol change.

## 2. The five candidates

### (a) Exclude every disagreement as a conflict

| C1 no third value | C2 grounded | C3 CPG-free | C4 pre-registrable / symmetric | C5 endpoint bias |
|---|---|---|---|---|
| ✅ trivially | ⚠️ partly | ✅ | ✅ | ❌ **yes, and it is not merely coverage** |

**Principled or disguised choice?** *Principled but expensive, and not bias-free.* It selects nothing —
no record is preferred — so it cannot be steered. Its cost is the whole of §2 of
`COVERAGE_COST_ARITHMETIC.md`: the excluded share equals `d` exactly, against a budget of 8.70–10.00 %
shared with staleness, ambiguity and invalidity.

The bias is specific and worth naming. Disagreement is not random with respect to the *kind* of fact:
the observations most likely to produce a `STATED` / `NOT_AVAILABLE_FROM_SOURCE` split are the ones
where an authoritative value is *marginal* — precisely the observations that discriminate
`CORRECT-ABSTENTION` from `UNSUPPORTED-FILL`. Those two labels are the entire numerator and
denominator of **P2 (Abstention Recall, threshold 0.90)**. Excluding them all computes P2 on the easy
cases only, and the direction is upward — P2 looks better than it is — with no trace in the reported
endpoint. `§15.2`'s guarantee ("No observation may be excluded because its result is unfavourable") is
*not* violated: the Author and Confirmer never see CPG output, so no one can aim the exclusions at
unfavourable items. The bias is a correlation between disagreement and fact-marginality, not between
disagreement and CPG's answer. That makes it honest but real.

**Verdict:** admissible as the *fallback* for everything no other rule covers, which is how the
prototype uses it. Not admissible as the *only* mechanism unless `d̂` is measured first and shown to be
small.

### (b) Prefer the higher authority tier when the tiers differ

| C1 | C2 | C3 | C4 | C5 |
|---|---|---|---|---|
| ✅ | ✅ **strong** | ✅ | ✅ | ⚠️ conditional |

**Principled.** §9.4 [NORMATIVE; enforced] already declares a total ordering of source authority *per
field*, in frozen, published, pre-registered text:

| Field | Tier 1 | Tier 2 |
|---|---|---|
| `founded_year` | `REGISTRY_RECORD` | `ENTITY_OWN_PAGE` |
| `employee_count` | `REGULATORY_FILING` | `ENTITY_OWN_PAGE` with a stated publication date |
| `revenue_range` | `AUDITED_FINANCIAL_FILING`, `REGULATORY_FILING` | `ENTITY_OWN_FINANCIAL_STATEMENT` |

and `lib/schema.mjs` exports it as executable data (`AUTHORITY`, `authorityOf`). Preferring Tier 1 over
Tier 2 does not invent an ordering; it applies one the protocol already asserts and already enforces
(a `STATED` record from a non-authoritative class is *refused* at `checkValueFields`). It is computable
from the two records alone — the tier is a function of `(field, source_class)` and nothing else — so
C3 is satisfied by construction, and the rule is symmetric by construction.

**Scope, stated exactly.** The rule must abstain on:
- **Tier 1 vs Tier 1** — `revenue_range` has *two* Tier-1 classes. A disagreement between an audited
  filing and a regulatory filing has no §9.4 ordering and must not be tie-broken.
- **Tier 2 vs Tier 2** — no ordering.
- **anything involving `NOT_AVAILABLE_FROM_SOURCE`** — an absence has no `source_class` and therefore no
  tier. §9.4 ranks *sources*, not the presence or absence of a value.
- **anything non-authoritative** — unreachable through validation, but the rule abstains anyway.

**What it costs.** For the items where it fires, double entry collapses to single entry: the Tier-1
record wins regardless of whether the Tier-2 record's value is the better observation, so the
transcription-error protection is lost *for exactly those items*. Because both observers are blinded to
CPG output, this cannot be aimed at the endpoint — but the count of items resolved this way must be
published so a reader can see how much of the sealed reference rests on one pair of eyes.

**Recovery share — what is knowable and what is not.** Knowable a priori: the rule covers exactly the
cell `(STATED, STATED) × (Tier 1, Tier 2)` of the disagreement space, and that cell is *structurally
large for `founded_year`*, where the two authority classes are a registry record and the company's own
page — two sources that genuinely and routinely differ (incorporation date vs "founded" marketing
date). For `employee_count` the Tier-2 route additionally demands a stated publication date, which
suppresses it. For `revenue_range` the Tier-1/Tier-2 gap (audited or regulatory filing vs the entity's
own statement) is real but the entity's own statement is often the only accessible source in the
jurisdictions §20.3 admits, which pushes *both* records to Tier 2 and makes the rule silent.
**Not knowable without data:** the share of all disagreements that land in that cell. I will not put a
number on it. Any figure I produced would be invented, and §7 of `COVERAGE_COST_ARITHMETIC.md` gives
the cheap way to measure it.

**Verdict:** *principled, narrow, and defensible* — the strongest of the candidates that is grounded in
§9.4. Requires the §9.1/§9.5 amendment and a `reconcile` change to be legal or sealable.

### (c) Prefer the more recent `as_of_date`, for the temporal fields only

| C1 | C2 | C3 | C4 | C5 |
|---|---|---|---|---|
| ✅ | ✅ **strongest** | ✅ | ✅ | ✅ (coverage-positive, direction-neutral) |

**Principled — and the best-grounded of all five.** §10.2's temporal rule [NORMATIVE] is not a scoring
convention; it is a *definition of which value is reference truth when several authoritative values
exist*:

> **Temporal rule** for `employee_count` and `revenue_range`: reference truth is **the most recent
> authoritative value** with `as_of_date` no more than **24 months** before the run `asOf`.

Two observers who record different authoritative values with different `as_of_date`s have not
contradicted each other — under §10.2 they have recorded two members of the same time series, and the
protocol *already names* which one is the reference. Choosing the more recent one is therefore not a
resolution of a disagreement at all: it is the application of a definition the two observers each
applied incompletely. This is the one candidate that arguably needs no new normative content, only the
§9.5 amendment that lets `reconcile` apply it.

**Scope, stated exactly.**
- **`employee_count` and `revenue_range` only.** §10.2 names exactly those two. `founded_year` must be
  untouched: a founding year is not a time series, and a later observation of a different year is a
  genuine discrepancy, not a fresher reading. The prototype's `TEMPORAL_FIELDS` enforces this and a
  mutant that removes the restriction is killed.
- **Both records must be `STATED`.** A `NOT_AVAILABLE_FROM_SOURCE` record carries a required
  `as_of_date` (`checkValueFields` demands one) and can therefore be *more recent than a stated value*.
  A naive date comparison would let a fresher **absence** defeat an older stated value — turning a
  positive into a missing, converting a would-be `SUPPORTED-FILL` into an `UNSUPPORTED-FILL` and moving
  it into P1's numerator and P2's denominator. This is the single most dangerous edge in the whole
  rule set. The prototype guards it, tests it in both directions (T4.1, T4.3), and a mutant that
  removes the guard is killed.
- **Ties abstain.** Equal `as_of_date` with different values is a real contradiction.
- Both records must still clear the 24-month window, or the row is `REFERENCE-STALE` regardless
  (`analysis.mjs:150`). Note a free side-benefit: choosing the *more recent* record can only move a row
  *away* from `REFERENCE-STALE`, which is a coverage gain with no endpoint direction, because staleness
  is judged against the run `asOf` and never against CPG's value.

**Endpoint direction.** None that can be signed in CPG's favour or against it: recency is a property of
the source document, chosen by observers who cannot see CPG. Where CPG cites a stale figure, §10.2
already says `INCORRECT-FILL / STALE_VALUE`; this rule makes that determination *more* faithful, not
less, because it aligns the sealed reference with §10.2's own definition.

**Recovery share.** Knowable a priori: the rule covers `(STATED, STATED) × as_of_date differs` for two
of three fields, i.e. at most 66.7 % of observations are even eligible. Structurally, headcount and
revenue are exactly the fields where two honest observers most often pick different vintages — §10.2's
own rationale says "headcounts are reported at differing dates and definitions" — so this cell is
plausibly the *largest* single cell of the disagreement space. **Not knowable without data:** its
actual share. Again, no number invented.

**Verdict:** *principled, the best-grounded candidate, and the one most likely to recover volume.*
Apply it **before** (b) in the rule order, because (c) rests on a definition and (b) rests on a
preference. The prototype's rule list is ordered and the order is part of what would be registered.

### (d) Prefer `NOT_AVAILABLE_FROM_SOURCE` over `STATED`, or the reverse

| C1 | C2 | C3 | C4 | C5 |
|---|---|---|---|---|
| ✅ | ❌ | ✅ | ✅ | ❌ **fatal** |

**Both directions are disguised choices. Reject both.**

Neither direction has any grounding. §9.4 ranks *source classes*; it says nothing about the presence or
absence of a value. §10.2 ranks *recency*; likewise silent. The ordering would be invented by the
rule's author — who is, in the scenario under review, a member of the developing organisation.

**Preferring `STATED`** manufactures a positive reference value out of a disagreement in which one
competent observer, having searched and having written down what they searched, recorded that no
authoritative value exists. That is the forbidden transition *missing → positive* in its purest form.
It converts `CORRECT-ABSTENTION` into `MISSED-FILL` (deflating P2's numerator, inflating R1's
denominator) and it hollows out the `abstention-expected` class, whose whole purpose is to test
withholding.

**Preferring `NOT_AVAILABLE`** is worse in one specific way: **its endpoint sign cannot be stated in
advance.** If CPG filled, the label becomes `UNSUPPORTED-FILL` → P1's numerator rises *and* P2's
denominator rises, so the product looks worse on both. If CPG abstained, `MISSED-FILL` becomes
`CORRECT-ABSTENTION`, so the product looks better on P2. Which way the rule pushes therefore depends on
CPG's behaviour — i.e. the rule's *direction* is only knowable after reading the resolver under test.
A rule whose sign cannot be pre-registered cannot be defended as conservative, or as anything.

There is a tempting epistemic argument — *positive evidence with a URL beats an unverifiable claim about
a search*. It is a real argument and it is **not in the protocol**. Adopting it in a resolver would be
the developing organisation writing new normative content into reference truth after the protocol was
frozen. If the owner believes it, the place for it is a §9 amendment argued on its merits and
registered, not a tie-break buried in `reconcile`.

The prototype **cannot** be made to do this: the rule allow-list refuses
`PREFER_STATED_OVER_NOT_AVAILABLE` (T9.1), and an output-level postcondition refuses *any* rule that
resolves a `value_kind` mismatch (T4.1, T4.3; mutant M28 killed).

### (e) "Conservative" resolution — pick the record less favourable to the claim under test

| C1 | C2 | C3 | C4 | C5 |
|---|---|---|---|---|
| ✅ | ❌ | ❌ **circular** | ❌ | ❌ |

**Reject outright, and for a decisive reason that is worth stating plainly.**

"Less favourable to the claim under test" is **only definable relative to CPG's output.** Whether the
Record-1 or the Record-2 value is less favourable depends on which one CPG's value agrees with under
§10.2. So the rule cannot even be *evaluated* without reading the resolver under test. Consequences,
each fatal on its own:

1. **§9.2 is broken structurally, not procedurally.** The prohibition "they never receive CPG output"
   stops being an instruction to people and becomes a contradiction in the design.
2. **§9.6's ordering is destroyed.** The seal hash is published *before* held-out execution, and the
   reference values are fixed *before* CPG runs. A CPG-dependent rule cannot produce a reference file
   until after execution, so there is nothing to seal and nothing to publish first. The single
   strongest anti-gaming property of the whole design — "the operator therefore cannot choose reference
   values after seeing CPG output" — is gone.
3. **Reference truth becomes a function of the thing it judges.** The endpoint then measures the rule,
   not the product.

**Keep the line clear (as the orchestrator asked):** circularity is introduced by *using CPG's output*,
not by *being deterministic*. Options (b) and (c) read only the two reference records — `source_class`,
`field`, `as_of_date`, `value_kind`, `expected_value` — and are not circular in any degree. Option (e)
is circular because of what it reads, and no amount of pre-registration repairs it.

**Is there a CPG-free "conservative" variant?** One could define conservative *about the company*
rather than about the claim: prefer the lower `employee_count`, the lower revenue amount, the later
`founded_year`. That is CPG-free and pre-registrable — and it is still not conservative. §10.2 scores
agreement within ±10 % **of the reference**, so lowering the reference *narrows the absolute tolerance
band* (10 % of a smaller number), and whether that helps or hurts depends entirely on which side CPG's
figure falls. If CPG happens to report the lower figure, the rule makes CPG look *better*. A
directional tilt whose sign is unknown is not caution; it is an arbitrary preference with a reassuring
name. Reject.

## 3. A sixth option the brief did not list: re-observation instead of adjudication

The honest way to get from three humans to two is **not** to resolve disagreements by rule but to
**reduce `d` before the exclusion rule fires**.

**Round-2 double entry.** When the two records differ, both observers are told *only* "your record for
this company × field differs from the other record" — never the other value, never the other identity,
never a count, never anything about CPG — and each independently re-observes that item. Residual
disagreements after round 2 become `CONFLICT-UNRESOLVED`.

- **Personnel: still two.** No third human, no new §4A role.
- **Grounded:** it changes no §9.4 or §10.2 content; it changes only the number of independent passes,
  which is a §9 procedure, not a normative rule about values.
- **CPG-free:** trivially.
- **What it fixes:** transcription and mis-keying error — plausibly the largest contributor to `d`, and
  the one class of disagreement where "resolve it" and "get it right" coincide. `agreementKey`
  normalises whitespace and case but nothing else, so `3682` vs `3862` is a full disagreement today.
- **What it leaks:** exactly one bit per item ("this item is contested"). That bit is uncorrelated with
  CPG's output, so it cannot bias the endpoint; but it does tell an observer their reading is disputed,
  which invites anchoring on their own prior answer rather than a fresh search. Mitigation: require the
  round-2 record to carry its own `search_note` and `as_of_date`, and publish the count of items whose
  round-2 record differs from the same observer's round-1 record. That number is itself a useful
  instrument-quality statistic.
- **What it does not fix:** genuine source divergence — different registries, different vintages,
  different definitions of "employee". That residue is what (b) and (c) address.

**Recommended composite design (PROPOSAL, for owner decision):**

```
  round 1 double entry  →  agree?  yes → AGREED
                                    no  ↓
  round 2 re-observation (same two people, one bit disclosed)
                           →  agree?  yes → AGREED
                                    no  ↓
  rule (c) MORE_RECENT_AS_OF_TEMPORAL_FIELDS   (employee_count, revenue_range; both STATED)
                           →  fires? yes → RESOLVED-BY-RULE(c), published and counted
                                    no  ↓
  rule (b) TIER_1_OVER_TIER_2                  (both STATED; tiers differ)
                           →  fires? yes → RESOLVED-BY-RULE(b), published and counted
                                    no  ↓
                                        CONFLICT-UNRESOLVED — excluded, published
```

Every step is order-independent, CPG-free, pre-registrable and introduces no third value. Every step's
count is published, so a reader can see exactly how much of the sealed reference rests on one pass, on
two passes, or on a rule. The prototype implements the last three boxes; round 2 is a personnel
procedure and is out of scope for code.

## 4. Summary table

| Candidate | No third value | Grounded in frozen text | CPG-free | Pre-registrable & symmetric | Bias sign statable in advance | **Verdict** |
|---|---|---|---|---|---|---|
| (a) exclude as conflict | ✅ | ⚠️ needs a new §9.5 mapping and a distinct label | ✅ | ✅ | ⚠️ yes, upward on P2 | **fallback only** |
| (b) higher authority tier | ✅ | ✅ §9.4 | ✅ | ✅ | ✅ | **defensible, narrow** |
| (c) more recent `as_of_date` | ✅ | ✅ §10.2 (a definition, not a preference) | ✅ | ✅ | ✅ | **defensible, strongest** |
| (d) kind preference, either way | ✅ | ❌ invented | ✅ | ✅ | ❌ | **reject** |
| (e) less favourable to the claim | ✅ | ❌ | ❌ **circular** | ❌ | ❌ | **reject outright** |
| (f) round-2 re-observation | ✅ | ✅ procedure only | ✅ | ✅ | ✅ | **recommended first step** |

All of (a)–(c) and (f) still require the §9.1 and §9.5 amendments, re-registration under §19.1, and a
new `reconcile` and instrument aggregate. None of them is available today, and this document changes
nothing.
