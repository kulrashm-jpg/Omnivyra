# CPG-042 — Decision Review: Protocol-003 Ambiguities A-1…A-6, B-1, B-2, D-1…D-4

**Scope.** Methodological decision review only. Nothing registered, funded, seeded, enumerated, researched, executed or committed. `CPG_U1_PROTOCOL_003.md` (sha256 `9c3a64a6…7ead`) and the CPG-041 tooling (aggregate `572452e1…1b5`) are **unchanged**. Closed decisions U1/U2/U3, H1/H2 and all other CPG rules are not reopened.

**Evidence base.**
- Protocol-003.
- The CPG-041P packets (`C:/tmp/cpg041p_parallel/`, SHA256SUMS `3d9b121d…`).
- Tooling v3 source.
- Predecessor protocols: CPG-032 draft, candidate-001 (`C:/tmp/cpg033_protocol_review/`).
- `C:/virality/DEEPTECH_BASELINE_001.md` (sha256 `ba594725…d6`).
- Repository source cited by path.

**Statuses:** `CLOSED-BY-EXISTING-RULE` · `AMENDMENT-REQUIRED` · `HUMAN-DECISION-REQUIRED` · `NON-BLOCKING-FOLLOW-UP`.

**Human approval.** Every `AMENDMENT-REQUIRED` item changes the protocol text and therefore needs approval of the amendment wording. Where the review found the *substance* fully determined by existing rules and the integrity requirement, the approval is of **wording only**. Items whose substance is a genuine methodological choice are `HUMAN-DECISION-REQUIRED`.

---

## Summary

| ID | Item | Status | Amendment? | Human approval | Blocks registration? |
|---|---|---|---|---|---|
| A-1 | Enumerator as reference adjudicator | AMENDMENT-REQUIRED | Yes (§4A, §9.1) | Wording only | **Yes** (protocol text is registered) |
| A-2 | Reference-adjudicator blinding | AMENDMENT-REQUIRED | Yes (§9.2) | Wording only | **Yes** |
| A-3 | Rater presentation randomisation | AMENDMENT-REQUIRED | Yes (§12, §13.2, §24) | Wording only | **Yes** |
| A-4 | Rating-adjudicator blinding | AMENDMENT-REQUIRED | Yes (§12) | Wording only | **Yes** |
| A-5 | Employment / payment / relationship independence | AMENDMENT-REQUIRED | Yes (§4A) | Wording only | **Yes** |
| A-6 | Enumerator eligibility in protocol | AMENDMENT-REQUIRED | Yes (§4A, §5) | Wording only | **Yes** |
| B-1 | Post-sizing appends | AMENDMENT-REQUIRED (**integrity**) | Yes (§5.5, §5.5.3, §5.7, §5.10, §22) | Wording only (plus resourcing acknowledgment) | **Yes** |
| B-2 | Registry growth (F3) | AMENDMENT-REQUIRED (**integrity; classification BLOCKING**) | Yes (§5.3, §5.10, §22) | Wording only | **Yes** |
| D-1 | "U4" naming collision | NON-BLOCKING-FOLLOW-UP | Editorial qualification of §16 bundled optionally | No | No |
| D-2 | U8 subject score | HUMAN-DECISION-REQUIRED | No (future protocol) | **Yes** | No |
| D-3 | U9 endpoint structure | HUMAN-DECISION-REQUIRED | No (future protocol) | **Yes** | No |
| D-4 | U4 weight freezing vs refitting | HUMAN-DECISION-REQUIRED | No (future protocol) | **Yes** | No |

---

## A-1 — Can a candidate enumerator also be the reference-answer adjudicator?

| Field | Content |
|---|---|
| **Current state** | Protocol-003 §9.1: the adjudicator is a "third independent person" who must not be Author, Confirmer or operator. It is silent on enumerators. CPG-041P treated the combination as prohibited, giving 7 people |
| **Evidence** | §5.2: the enumerator writes the **class prediction** (fill-expected / abstention-expected / identity-hazard). §9.2: Author and Confirmer "never receive … the class prediction". §9.7: class-vs-reference **mismatches are recorded and published**. §9.5: the adjudicator chooses between two records or declares REFERENCE-CONFLICT. §12 already bars the enumerator from rating roles |
| **Risk** | (1) **Prediction-confirmation bias.** §9.2 withholds the class prediction from reference constructors precisely so that it cannot pull reference values. An adjudicator who authored the predictions holds that information for every company and chooses the final reference value in exactly the contested cases. (2) **Self-interest.** Each §9.7 mismatch visibly marks an enumerator prediction as wrong, so an enumerator-adjudicator has a motive to pick the record that agrees with their own prediction (e.g. NOT_AVAILABLE for their "abstention-expected" companies). (3) **Contamination knowledge.** The enumerator knows each company's attestations and screening history, which are irrelevant to the reference value but could colour choices. These are information-leakage and incentive channels, not merely headcount concerns |
| **Already logically resolved?** | **Partly.** The §9.2 rationale implies it, but no rule states it. It is not enforceable as written |
| **Proposed resolution** | **Prohibit.** An enumerator may not be the reference adjudicator. This follows from §9.2's barrier and §9.7's recording, not from preference |
| **Headcount (re-derived, not assumed)** | Independent roles: enumerator (≥1), Author, Confirmer, reference adjudicator, rater 1, rater 2, rating adjudicator. Pairwise prohibitions: §9.1 (Author ≠ Confirmer ≠ adjudicator ≠ operator); §9.2 + proposed A-1 (enumerator ∉ {Author, Confirmer, adjudicator}); §12 (raters and rating adjudicator ∉ {operator, enumerator, Author, Confirmer, reference adjudicator}; rater 1 ≠ rater 2 ≠ rating adjudicator). All seven roles are then mutually exclusive, so the **minimum is 7 independent people** plus the (non-independent) operator. The count now follows from the rules rather than from the packet's conservative assumption |
| **Protocol amendment** | Required: §4A (combination table) and §9.1 wording. Exact text in `CPG042_PROTOCOL_AMENDMENT_PLAN.md` §A-1 |
| **Human approval** | Wording only |

## A-2 — Reference-answer adjudicator blinding

| Field | Content |
|---|---|
| **Current state** | §9.2: "The adjudicator receives both blind records for the disagreeing company × field only." §11: pilot outputs "never shown to the reference team". §9.1 lists the adjudicator among the reference-truth roles |
| **Evidence** | Adjudication happens **before sealing and before held-out execution** (§5.5, §9.6). At that point the only CPG outputs in existence are the **development pilot and instrument check** (§8.5, §11) and any private non-protocol runs (see the independence test, point P-6). Development companies are in the reference set (§5.5 step 12) |
| **Risk** | Exposure to (a) pilot outputs for development companies; (b) class predictions or stratum (A-1 bias); (c) split (development vs held-out), which with (a) reveals which records correspond to pilot-observed companies; (d) screening and contamination basis; (e) agreeing records or tallies of how often Author or Confirmer "won", producing deference patterns |
| **Already logically resolved?** | **Partly.** "Only" limits the materials released, and "reference team" arguably includes the adjudicator for §11. Class, stratum, split and screening data are not named, and no prohibition covers information obtained outside the released packet |
| **Proposed resolution** | **May see:** for each disagreeing company × field, the company name, canonical domain, jurisdiction family, decisive identifier (§9.2 identity fields); the field definition, §9.3 formats, §9.4 authority table; the two blind records **labelled "Record 1" and "Record 2" in a per-item order derived as in A-3** (so Author/Confirmer identity is not revealed by position); the sources cited in those records. **Must not see:** any CPG output (pilot, instrument check, any other run); class prediction, identity-hazard note, stratum, split (development / held-out); screening log, attestations, contamination basis; agreeing records; the names or pseudonyms of Author and Confirmer; running counts of adjudication outcomes. **When:** after both blind record sets are submitted and before `seal`; never after any held-out execution output exists. **Mapping** from "Record 1/2" back to AUTHOR/CONFIRMER is applied mechanically after the decision |
| **Protocol amendment** | Required (§9.2) |
| **Human approval** | Wording only |
| **Note** | The adjudicator can still look up public information about the company, which is inherent. Blinding here is **procedural**, not cryptographic |

## A-3 — Rater-presentation randomisation without a discretionary seed

| Field | Content |
|---|---|
| **Current state** | §12: "Presentation order randomised per rater with a recorded seed [NORMATIVE]". §13.2 publishes a "rater randomisation seed". The H3 custodian is gone and no seed source is defined |
| **Evidence** | Protocol-003 §5.7.1 already defines public, unbiasable held-out randomness, published as the held-out **sampling record** (`record_sha256`, containing txid, heights, block hashes, drand round and randomness, and the seed fingerprint), which the seal binds (`held_out.sampling_record_sha256`) |
| **Risk (of any operator-chosen seed)** | Grinding presentation orders (order and fatigue effects on ratings). A new human seed re-creates the H3 problem |
| **Can study randomness be reused safely?** | **Yes, by one-way, domain-separated derivation after the draw.** (1) The held-out draw is already fixed when rating starts (rating follows execution), so deriving further values cannot alter selection. (2) Rank keys are `sha256(seed ‖ "|" ‖ scheme:identifier)`. A derivation whose preimage **starts with a distinct domain string** and uses the published `record_sha256` rather than the raw seed has no shared preimage structure with rank keys (random-oracle separation). (3) `record_sha256` is unknowable before `R_ho` exists, so orders cannot be pre-computed while the frame, labels or rater assignments are still mutable. (4) It is recomputable by any outsider from published artifacts. **No new seed is introduced.** |
| **Remaining discretion to remove** | The mapping of *people* to rater labels. If assigned after orders are computable, a person could be steered to a particular order. Rule: the assignment of individuals to the labels `rater-1`, `rater-2`, `rating-adjudicator` is recorded (timestamped, in the restricted personnel register, fingerprint published) **before the held-out commitment is broadcast**. Procedural |
| **Proposed resolution** | `order_key(label, candidate_id, field) = sha256("cpg-u1-rater-order/v1|" + ho_record_sha256 + "|" + label + "|" + candidate_id + "|" + field)`, where `label` ∈ {`rater-1`, `rater-2`, `rating-adjudicator`, `reference-adjudicator`} and `ho_record_sha256` = held-out `sampling.record_sha256`. Present items in ascending `order_key`, ties broken by `candidate_id|field`. Only held-out observations are rated (§12). The reference adjudicator's Record 1 / Record 2 assignment (A-2) uses `label = reference-adjudicator`: Record 1 = Author if the first hex digit of `order_key` is even. **Timing check:** `ho_record_sha256` exists before reference adjudication, because blind records for **both** stages are built only **after** the held-out draw (§5.5 step 12). The derivation is therefore available for the reference adjudicator too |
| **Protocol amendment** | Required (§12 row, §13.2 wording, §24 canonicalization) |
| **Tooling** | Not required for validity (a formula outsiders can recompute). An optional helper command would change the tooling aggregate and must be done **before** registration if wanted |
| **Human approval** | Wording only. **No seed is created now** |

## A-4 — Rating-adjudicator blinding

| Field | Content |
|---|---|
| **Current state** | §12: the rater adjudicator is "not either rater, not any excluded role" and selects one rater's label or REFERENCE-AMBIGUOUS; adjudicated values are flagged. Blinding is stated for raters only |
| **Evidence** | U1 is **single-arm** (§8). There is no arm to infer; "which case" is inherently visible because the rater packet contains the company's reference record and CPG's cited URLs (§12 packet) |
| **Risk** | (a) Deference to a specific rater if rater identities are shown; (b) running tallies revealing how close the endpoints are to thresholds (EFR ≤ 0.05, AR ≥ 0.90, II = 0), which would let adjudication steer the outcome; (c) class prediction or stratum, where the A-1 bias applies; (d) pilot knowledge |
| **Already logically resolved?** | **No** |
| **Proposed resolution** | **May see:** for each disagreeing observation only, the identical §12 rater packet (field; CPG's value or null; the source URLs CPG cited; the sealed reference record), the §10.1 decision procedure and §10.2 agreement rules, and the two labels shown as "Label A" and "Label B" in order derived by A-3 (`label = rating-adjudicator`). **Must not see:** which rater gave which label, or rater identities; any other observation's labels; tallies, aggregates, provisional endpoint values or thresholds status; class prediction, stratum, identity-hazard note, split; pilot outputs; the count of disagreements. **When:** after both raters have submitted complete sheets; items presented in A-3 order. **Cannot be hidden:** the company and the CPG output for that item. U1 is single-arm, so no arm identity exists; this is permitted by the frozen design |
| **Protocol amendment** | Required (§12) |
| **Human approval** | Wording only |

## A-5 — Employment, contract, payment and relationship independence

| Field | Content |
|---|---|
| **Current state** | Independence is defined only by **role history** (built, ran or saw CPG; other study roles), in §9.1, §12 and the README. Economic and personal relationships are not addressed |
| **Evidence** | §12: without independent raters, "no claim of independent validation may be made". §20.18 and §22 #31: frame unbiasedness rests *only* on enumerator independence. §23 trust model: every human role is "trusted for" independence. CPG-041P C: the developing legal entity's identity is **not yet confirmed** in records (Q-1), so a rule cannot name "Drishiq Labs" reliably |
| **Risk (evidence-based)** | Independence fails through three channels. **Incentive:** the person benefits if CPG looks good (salary, contract renewal, equity, family income). **Instruction:** the person can be directed by, or feels obligation to, the developer or operator (employment hierarchy, client relationship). **Information:** the person has access to internal CPG knowledge, outputs or results. Employment and ongoing contracts create all three. Direct payment for unrelated work creates incentive and instruction. Close personal relationships with developers or the operator create incentive and information. **Disclosure alone does not remove any of these channels.** A **fixed, pre-agreed, outcome-independent fee for the study role itself** creates no outcome-contingent incentive and is standard for independent assessment |
| **Already logically resolved?** | **No** |
| **Proposed resolution** | **Not independent (ineligible for any independent role)** if, at any time from the first repository commit of the developing organisation's product through publication of U1 results, the person: (1) is or was employed by the **developing organisation** (the entity that develops, owns or operates CPG/Omnivyra, or any affiliate), in any capacity; (2) has or had any contract, engagement, or paid or unpaid work for it, **other than** the study-role engagement in (5); (3) received any payment or benefit from it, **other than** the study fee in (5); (4) holds equity, options or another financial interest in it; or (6) is a spouse or partner, family member, or household member of, or has a current or former direct reporting relationship with, any person who developed CPG, holds the operator or key-custodian role, or holds another study role. **(5) Permitted:** payment of a fixed fee for the study role, agreed in writing **before** any role materials are released, **not contingent on any result, finding, timeline outcome or future engagement**, with the agreement's fingerprint recorded. **Evidence recorded per person:** a signed declaration covering (1)–(6); the fee agreement fingerprint; and a written confirmation from the developing organisation that no (1)–(4) relationship exists in its records. Both are procedural evidence, not proof. A false declaration discovered later → the role's work is treated as non-independent, and the §12 consequences (UNADJUDICATED, Rung ≤ 2) or the §20.18 consequence (the frame is not independent) apply and are published. **This is a methodological independence rule, not a legal determination** |
| **Protocol amendment** | Required (new §4A) |
| **Human approval** | Wording only. The substance follows from the incentive, instruction and information analysis; the lookback anchor is a protocol-defined event, not an arbitrary number |

## A-6 — Enumerator eligibility in the protocol

| Field | Content |
|---|---|
| **Current state** | Substantive enumerator eligibility ("have built CPG; run CPG; see CPG output"; not operator) lives in the tooling README and §23 trust model, not in a numbered normative rule |
| **Evidence** | §20.18 and §22 #31 make enumerator independence the **sole** control for frame unbiasedness. The protocol "wins" over tooling (header), so eligibility stated only in tooling documentation is not governed by the registered protocol hash in the intended way |
| **Risk** | A registered protocol without an enforceable enumerator rule leaves the frame-independence claim undefined |
| **Already logically resolved?** | **No** (not normative in the protocol) |
| **Proposed resolution** | New §4A.2: an enumerator must (a) not have implemented CPG, the protocol, the tooling or the development-only registry; (b) not have run CPG or seen any CPG output, including the pilot, at any time before completing F; (c) not be the operator or key custodian; (d) hold no reference, adjudication or rating role (A-1, §12); (e) satisfy §4A.1 (A-5). They receive only the materials listed in §4A.2 and never the pilot, sizing or quotas (B-1) |
| **Protocol amendment** | Required (§4A; §5 cross-reference) |
| **Human approval** | Wording only |

---

## B-1 — Post-sizing appends to the candidate pool

| Field | Content |
|---|---|
| **Current state** | §5.5 step 9: "optionally extend F₁ → F₂ (APPEND-ONLY) → scan → pool-check" **after** the pilot and sizing. Pool-check reports quotas and shortfalls |
| **Evidence** | §5.6: quotas are a deterministic function of pilot yield `y` (CPG output on development companies). §11: pilot outputs must not reach the reference team; enumerators are not mentioned. Tooling permits F₂ ⊇ F₁ with any additions |
| **Is there an outcome-dependent selection opportunity?** | **Yes, and it exists even with perfectly honest, blinded enumerators.** (1) **Information leak:** the quotas or shortfall reveal `y`. (2) **Structural outcome-dependence:** *whether* and *how many* rows are appended depends on `y`. Enumeration order is not random (people list more prominent or easier-to-document companies first), so the held-out **frame composition** becomes a function of CPG's pilot performance. A low pilot yield leads to more late-enumerated, less prominent companies in the held-out pool. That changes the population the held-out sample represents conditionally on the outcome, independent of anyone's intent. (3) A motivated enumerator who knows `y` could additionally tilt which companies are appended |
| **Design A — freeze the complete pool before the development commitment** | The frame F is enumerated to a size sufficient for the **maximum** preregistered held-out quotas before any CPG outcome exists, and both stages draw from the same F. Sample *size* still depends on `y` (as §5.6 preregisters), but the **frame never does**. Checkable before the development commitment with no CPG output. **Eliminates** both the leak and the structural dependence. Cost: more enumeration effort (below) |
| **Design B — post-sizing appends to a predetermined pool-size rule** | If the target depends on the quotas, leak (1) and dependence (2) remain. If the target is fixed at the maximum regardless of `y`, it is Design A deferred: same effort, with a pilot-dependent *decision to append at all* unless appends are mandatory. **Mandatory max-size appends after the pilot still let an enumerator enumerate after pilot information may have leaked, for no methodological gain** |
| **Design C — other mechanism in protocol-003** | Protocol-003 already supports drawing held-out from the development frame (an append-only proof with F₂ = F₁ is valid; tooling accepts identical frames). Design C = Design A using existing machinery |
| **Chosen rule (not by convenience)** | **Design A / C.** It is the only design satisfying all four requirements. No operator discretion: a fixed frame and a fixed sufficiency rule. No outcome-dependent candidate selection: the frame is fixed before any CPG output. Deterministic sampling: unchanged. Independent enumeration: enumerators never receive pilot, sizing or quota information |
| **Frame sufficiency rule** | Before the development commitment, for each class c: `E_c ≥ 2·Qmax_c + Dev_c`, where `E_c` = admissible, held-out-eligible rows in F (per §5.1–§5.4, using the committed scan and the registered registry); `Qmax` = {fill-expected 60, abstention-expected 25, identity-hazard 15}, the held-out quotas at CAP 60 (§5.6); `Dev` = {6, 2, 2}. That is **E ≥ 126 / 52 / 32** (≥ 210 eligible admissible rows). This guarantees `pool ≥ 2 × quota` for any `y` even if every development pick is eligible. If unmet, **do not commit**; enumerate further **before** the development commitment |
| **Resourcing consequence** | Enumeration and screening of ≥ 210 eligible admissible rows plus screened-out rows. **Reference-truth workload is unchanged** (only drawn companies are researched; H1's CAP is unchanged) |
| **Protocol amendment** | Required (§5.5 diagram and steps; §5.5.3 held-out binding: `frame_hash` must equal the development `frame_hash`; §5.7 pool minimum; §5.10 VOID row; §22 rows 26/31 note) |
| **Tooling** | Not required for validity (both payloads are public; equality and sufficiency are outsider-checkable). Recommended enforcement (held-out frame equality; pre-commitment sufficiency check) changes the tooling aggregate and must precede registration if adopted |
| **Human approval** | Wording, plus acknowledgment of the enumeration workload |

## B-2 — F3 registry-growth check

| Field | Content |
|---|---|
| **Current state** | §5.3: the development-only registry is "[NORMATIVE, append-only, entries never removed]". The registration fixes `registry_sha256`; the **development** payload must match it (enforced). The **held-out** payload may carry a different registry hash (tooling note: "append-only additions apply to held-out"). F3 observed that shrinkage is not checked |
| **Evidence** | Held-out eligibility uses the registry in force at the held-out commitment, **after** the pilot. The operator side maintains the registry (H2 attestation by implementers). The frame F₁ is known to the operator, who runs `frame`/`scan`. Running CPG on frame candidates outside the protocol is **not prohibited** (§6.3 permits unlimited *development* execution; non-development candidates are not addressed). CPG is live in production. C1(4) "any prior CPG execution" is a legitimate registry basis |
| **Attack under current rules** | After the pilot, the operator privately runs CPG on eligible F₁ candidates, adds those where CPG performs poorly to the registry with the **truthful** basis C1(4), rescans, and commits the held-out payload with the grown registry. Those companies are now held-out-ineligible. **The sample is steered toward CPG successes, entirely within the stated rules.** It is publicly visible (registry hash change) but not a violation, so it would not void the study |
| **Classification of F3 as framed ("verify only grew")** | Insufficient. A grow-only check blocks *removal* but leaves the *growth* channel above fully open |
| **Genuine requirement** | **Held-out eligibility must be determined solely by the registry fixed at registration** (and the scan and attestations committed before any CPG outcome). Registry changes after registration do not apply to this study. With B-1's single frozen frame, the development scan and the registered registry determine eligibility for both stages |
| **Late-discovered genuine contamination** | Recorded (company, basis, date, discoverer), published, and **not** used to exclude or replace any company (consistent with §5.9 and §15.2 no-unfavourable-exclusion). Observations of affected held-out companies are flagged `CONTAMINATION-DISCLOSED` and reported. A **pre-specified secondary sensitivity analysis** excluding them may be reported but can never change the §10.5 outcome |
| **Classification** | **BLOCKING** (a protocol integrity requirement). The F3 grow-only *check* becomes **NOT REQUIRED** once registry equality is the rule, because equality subsumes it |
| **Protocol amendment** | Required (§5.3 registry text; §5.5.3 held-out payload `registry_sha256` must equal the registered value; §5.10 VOID row; §15 disposition flag; §22 new row) |
| **Tooling** | Current behaviour (accepting a changed registry at held-out, and the README line "registry may only grow … apply to held-out") **contradicts** the required rule. Recommended enforcement changes the aggregate and must precede registration. Outsider-checkable regardless (payload vs registration hash) |
| **Human approval** | Wording only |

---

## D-1 — "U4" naming collision

| Field | Content |
|---|---|
| **Current state** | **Three** meanings exist, not two. (a) **DeepTech register U4** (`DEEPTECH_BASELINE_001.md:643`): "Does [competitor] qualification generalize to unseen industries?", subject `competitorQualificationModel.ts`. (b) **CPG protocol U4** (candidate-001 §16.1 "competitor / cross-company generalisation"; protocol-003 §16.1 "U4 — generalisation"): generalisation of **CPG** to new companies, consuming U1's admissibility, contamination, reference and label machinery. (c) **PMO build phase** "U4" (`docs/pmo/COMPANY-UNDERSTANDING-IMPLEMENTATION-001-U4-*`). The same collision exists for U1 (DeepTech U1 = canonical-report grounding; CPG U1 = this study, established in CPG-031) and potentially for U8 and U9 (see D-2) |
| **Correction to CPG-041P** | `D_RESEARCH_READINESS.md` §D2 described U4 using the DeepTech register (competitor qualification) while quoting protocol-003 §16.1, which concerns CPG generalisation. These are **different studies**. The packet is not modified here (historical artifact); this review records the correction |
| **Risk** | Protocols, evidence claims or DPIIT material citing "U4" could combine results from different subjects |
| **Proposed resolution (naming convention for future documents)** | `DT-U<n>`: DeepTech uncertainty register (`DEEPTECH_BASELINE_001` §9). `CPG-U<n>`: Company Profile Grounding studies (protocol-003 lineage; CPG-U1 = study `CPG-U1-2026-01`). `CU-IMPL-001 Phase U<n>` (or the document's program ID + "Phase"): PMO build phases. Never an unqualified "U<n>" in a new artifact. Historical artifact names are unchanged. Cross-references state equivalence explicitly when two IDs denote the same study (none currently do) |
| **Already logically resolved?** | No (convention), but not a protocol-integrity matter |
| **Protocol amendment** | Not required. An optional editorial qualification of §16 headings (`CPG-U4`, `CPG-U8`, `CPG-U9`) can be bundled with the required amendment |
| **Human approval** | No |
| **Status** | NON-BLOCKING-FOLLOW-UP |

## D-2 — U8 endpoint: which deterministic quality score?

| Field | Content |
|---|---|
| **Current state** | Two different "U8"s name different subjects (see D-1). **No new score is invented here** |
| **Candidate 1: DT-U8 subject, content Quality Engine** | **Score:** `QualityScorecard` from `evaluate(input)` in `backend/services/content/qualityEngine.ts` (sha256 `d703832b…6b3`, `:494`). **Inputs:** `contentType`, `platform`, `text`, optional `objective`, `audience`, `brandContext`, `originalityScore` (0..1), and pass-through `evaluatedAt`. **Transformation:** 12 rule-based dimension scores (objectiveAlignment, brandVoice, originality, platformFit, readability, hook, cta, seo, trust, clarity, grammar, structure), weighted mean with fixed weights summing to 1.0 (`:53-64`), `overall` clamped 0–100 (`:537`), label bands poor/fair/good/excellent (e.g. excellent ≥ 85, `lib/content/quality/types.ts`, `:111`). Pure: no AI, database, clock or randomness (`:1-20`). **Intended interpretation:** per-content quality across the 12 dimensions. **Human reference:** blind human quality ratings of the same content (DEEPTECH_BASELINE §5.4: "Spearman correlation vs. blind human ratings"). **Would establish:** whether the overall and/or dimension scores co-vary with blinded human judgments on held-out content. **Would not establish:** marketing outcomes, causal quality, or validity of any dimension not rated by humans |
| **Candidate 2: CPG-U8 per protocol-003 §16.2 (evidence quality of grounded facts)** | §16.2 and the CPG-032 draft §15 say **"CPG has no field-level deterministic quality score."** The nearest existing deterministic output is the grounding confidence `computeConfidence` (`backend/services/companyProfile/grounding/claimResolution.ts:183-231`, sha256 `7b9888ac…c00`). **Inputs:** best tier weight, independent sources, freshness class, entity match weight, conflict flag. **Transformation:** 40·authority + 25·corroboration step + 20·freshness + 15·entity − 25·conflict, rounded, clamped 0–100, bands 90/80/60. **Stated interpretation (in code):** "strength of evidence, not probability of truth … NOT EMPIRICALLY CALIBRATED". **Human reference:** CPG-U1 four-state labels paired with evidence records (calibration only), plus a separate held-out labelled set (§16.2). **Would establish:** whether confidence bands discriminate SUPPORTED from UNSUPPORTED/INCORRECT fills on held-out data. **Would not establish:** probability-of-truth calibration unless designed for it |
| **Candidate 3: platform evidence confidence** | `backend/services/evidencePlatform/confidenceEngine.ts` (sha256 `422aa4da…73a`): weighted factors (coverage 0.28, completeness 0.14, freshness 0.14, maturity 0.14, sampleSize 0.12, validation 0.08, providerReliability 0.06, calculationStability 0.04), renormalised over provided factors. Named in no U8 statement |
| **Out of scope** | `intelligenceQualityEngine.ts` and `confidenceCalibrator.ts` are not deterministic (learned or DB-tracked) |
| **Risk** | Validating one score and citing it as validating another; conflating DT-U8 with CPG-U8 |
| **Already logically resolved?** | **No.** DEEPTECH_BASELINE names candidate 1 for DT-U8; protocol-003 §16.2 addresses a CPG evidence-quality score that does not exist as such |
| **Decision required** | (i) Which study is "U8": DT-U8 (content Quality Engine), CPG-U8 (grounding evidence confidence), or both as separate protocols. (ii) For each chosen study, whether the subject is the overall score, the label bands, or specific dimensions or components. (iii) The pre-registered human reference and criterion. **Does not block CPG-U1**: §16.2 item 2 (labels paired with full evidence records) is already captured by protocol-003 §13 |
| **Status** | HUMAN-DECISION-REQUIRED |

## D-3 — U9 comparison question and endpoint structure

| Field | Content |
|---|---|
| **Current state** | DEEPTECH_BASELINE:648 "Does the deterministic stack beat direct model invocation?"; next evidence "Blind head-to-head vs. counterfactual baseline". Protocol-003 §16.3: a separate experiment with its own hypotheses and endpoints. No endpoint is defined anywhere |
| **Factual comparison question (proposed wording)** | "For the same items, the same task specification and the same information condition, what are the per-arm and paired-difference values of: erroneous-fill rate; unsupported-claim rate; abstention recall; identity-misattribution count; fill recall; provenance completeness (fills citing ≥ 1 resolvable source present in the archived evidence); repeated-call consistency; per-item latency; per-item cost, for (A) the deterministic Omnivyra stack and (B) a registered direct foundation-model invocation?" |
| **Endpoint structure options** | **One primary** (e.g. paired EFR difference): simplest inference, but gameable. Arm B can lower EFR by abstaining broadly (the CPG-036 all-abstention lesson). **Co-primary EFR + fill recall** (both must be reported and interpreted jointly; multiplicity handled): prevents the abstention loophole, but requires a pre-registered joint decision rule (e.g. non-inferiority margin on one, difference on the other), which is itself a substantive choice. **Primary + secondaries**: primary as chosen; latency, cost, consistency and provenance as secondaries, never an acceptance basis |
| **Recommendation (not a decision)** | Latency, cost and consistency are **secondary** in every option (they are not truthfulness measures). The primary structure must include a guard against all-abstention (co-primary with fill recall, or a G1-style assessability gate as in protocol-003 §10.3) |
| **Already logically resolved?** | **No** |
| **Decision required** | (i) Primary vs co-primary structure; (ii) the joint decision rule and margins; (iii) information conditions (inputs only vs inputs plus identical archived evidence); (iv) whether U9 reuses CPG-U1 dataset and reference truth (§16.3 justification). **Does not block CPG-U1 registration** |
| **Status** | HUMAN-DECISION-REQUIRED |

## D-4 — U4 weights: freeze or refit?

| Field | Content |
|---|---|
| **Scope** | Applies to **DT-U4** (competitor qualification). CPG-U4 (§16.1) concerns CPG's rule-based resolver, which has no fitted weights |
| **Current state** | `MULTISIGNAL_WEIGHT_PROFILE_V2` was derived by `deriveOptimizedProfile(ALL)` and evaluated on the same 47 cases. That is in-sample, "UNPROVEN, CONFOUNDED" (DEEPTECH_BASELINE:470-490, BG-03 :894). Next evidence: "Seal ≥60 independently-labeled new cases" (:643). A taxonomy-only baseline exists (`competitorQualificationCalibration.ts:1-12`). The production router defaults to legacy (`competitorQualificationRouter.ts`) |
| **Option A: freeze and test** | Tests whether **a specific shipped weight profile** (V1 or V2) generalises to new, independently labelled cases from unseen industries. **Establishes:** out-of-sample performance of *that artifact*, so claims about the product version are directly supported. **Does not establish:** that the derivation *procedure* generalises. The 47 in-repo cases remain contaminated and cannot be part of the held-out set |
| **Option B: refit on development data, evaluate on held-out** | Tests whether **the fitting procedure** (`deriveOptimizedProfile`, shrinkage 0.5, floor 0.05, taxonomy prior 0.10) produces weights that generalise, using a fresh development set (independently labelled) disjoint from held-out. **Establishes:** procedure generalisation. **Does not establish:** performance of the currently shipped V2 weights, which would be superseded by the refit weights |
| **What the existing objective implies** | The stated question ("does qualification generalize to unseen industries") and the stated remedy ("seal ≥ 60 independently-labeled **new** cases") are most directly answered by **A**. But the evidence does not say **which profile** is the claim subject: V1 (hand-set), V2 (in-sample fitted), or the production default (legacy taxonomy gate) |
| **Already logically resolved?** | **No** (profile identity undetermined; A vs B determines the claim) |
| **Decision required** | (i) A (freeze) or B (refit procedure); (ii) under A, which profile (V1, V2, or both as separate arms) is frozen and hashed before labels exist; (iii) under B, the size and labelling of the development set. **Does not block CPG-U1 registration** |
| **Status** | HUMAN-DECISION-REQUIRED |

---

## Additional finding outside the twelve items (reported, not resolved)

**X-1: private preview and timing of held-out execution** (independence test point P-12). After the held-out draw, the held-out companies are known to the operator, and CPG is live in production. The operator can preview CPG results privately and choose *when* to run the one held-out execution (live-source drift and source availability vary). Protocol-003 §6.2 ("executed once") and §15.5(4) provide **procedural** protection only; no rule bounds the execution window or prohibits private lookups of drawn companies. This is not among A/B/D and is not a closed decision. It is reported as a **residual integrity risk requiring a human decision** on whether to add an execution-window and no-preview rule before registration.

---

## Independence test — "An operator learns something about expected outcomes and can then influence selection, inclusion, reference truth, presentation or adjudication"

**Protection types**
- **CRYPTOGRAPHIC:** enforced by hashes, consensus or signatures; verifiable by anyone.
- **MECHANICAL:** enforced by tooling or outsider recomputation from public artifacts.
- **PROCEDURAL:** rests on people following rules; not verifiable after the fact.
- **NONE:** open.

"Current" means Protocol-003 as frozen. "Proposed" means after the CPG-042 amendments.

| # | Stage | What the operator can know then | Influence channel | Current protection | Proposed protection |
|---|---|---|---|---|---|
| P-1 | Candidate enumeration | Prior CPG behaviour on well-known companies (production is live); the development-only registry | Recruit a biased enumerator; brief or pressure an enumerator; enumerate personally | PROCEDURAL (README only, not a protocol rule) | PROCEDURAL, but **normative**: §4A.1 (no employment, payment or relationship), §4A.2 eligibility, §4A.3 separation. **Not cryptographic:** frame composition is never cryptographically unbiased (§20.18) |
| P-2 | Development pool (frame F) | The frame contents (runs `frame`/`scan`) | Before the commitment, ask for rows to be added or removed | PROCEDURAL | PROCEDURAL (enumerator independence) + MECHANICAL once committed (frame hash in digest) |
| P-3 | Registration | Protocol, tooling, registry, outpoints | Register many instances; register after seeing a draw | CRYPTOGRAPHIC + registry trust (single-use outpoints; F1 `registration_timestamp` < `R_dev`); identity-level grinding under other identities UNRESOLVED (§20.13) | Unchanged |
| P-4 | Development commitment | F, scan | Choose a favourable frame after seeing randomness | CRYPTOGRAPHIC (digest before `H_commit + 12` and `R_dev`) | Unchanged |
| P-5 | Development draw | Nothing beyond public data | Choose the seed or round | CRYPTOGRAPHIC (block hash + drand; round computed) | Unchanged |
| P-6 | Pilot | **CPG output on 6 development companies (`y`)**, and potentially **private CPG runs on any F candidate** (not prohibited) | (a) Misreport pilot fills to change held-out size; (b) use CPG knowledge to steer the held-out pool | (a) PROCEDURAL: pilot bound to the dev manifest hash, but pilot responses are not archived under §13. (b) **NONE** (see P-8, P-9) | (a) PROCEDURAL; size only, composition unaffected under B-1. *Residual:* pilot response archiving is not required by protocol-003; not in A/B/D scope, reported. (b) Closed by B-1 and B-2 |
| P-7 | Sizing | `y`, quotas | Leak quotas to enumerators | **NONE** (§5.5 step 9 permits post-sizing appends) | **Closed** by B-1 (no appends; §4A.2 bars quota release). PROCEDURAL for the release barrier, MECHANICAL for no-append (frame-hash equality) |
| P-8 | Held-out pool | Pilot yield; private CPG results on F candidates | (a) Append companies expected to favour CPG; (b) **grow the registry to exclude unfavourable companies** | (a) **NONE** (appends allowed; composition depends on `y`). (b) **NONE**: registry growth applies to held-out and is visible but permitted | (a) **CRYPTOGRAPHIC/MECHANICAL** (B-1: frame fixed before any CPG output; held-out frame hash = development frame hash). (b) **MECHANICAL** (B-2: held-out registry hash = registered; outsider-checkable; tooling enforcement T-1 recommended) |
| P-9 | Held-out commitment | As P-8 | Commit a steered scan or registry | Digest binds whatever scan or registry was used (MECHANICAL), but a steered registry is permitted | Steering is impossible because inputs must equal the registered or development-committed hashes |
| P-10 | Randomness | Nothing beyond public data | Choose timing | CRYPTOGRAPHIC (timing does not reveal future block hash or drand) | Unchanged |
| P-11 | Reference truth | Drawn companies (manifests); pilot outputs; private CPG runs | Influence Author, Confirmer or adjudicator values; leak class or pilot data | PROCEDURAL (§9.1, §9.2, §9.6 seal; operator receives the seal hash only). Adjudicator blinding under-specified; enumerator-adjudicator allowed by silence | PROCEDURAL, **fully specified** (A-1, A-2, §4A.1). Seal is MECHANICAL against later edits. **Not cryptographic:** reference values' independence rests on people |
| P-12 | Execution | **Held-out company list** (post-draw); ability to **preview CPG privately in production**; choice of **execution time** | Choose a favourable moment (source availability, drift); run repeatedly and archive a favourable run | PROCEDURAL only (§6.2 "executed once"; recording fetcher and archive; §15.5(4) availability threshold). No execution-window rule; no rule against private preview | **Unchanged.** Reported as **X-1**, outside the twelve items; needs a human decision |
| P-13 | Rating | Archived outputs; reference truth after execution; provisional tallies if computed | Build rater packets selectively; choose which person gets which order; compute and reveal tallies | PROCEDURAL (§12 blinding); order source undefined (A-3) | Order: MECHANICAL (A-3 derivation) + PROCEDURAL (label assignment fixed before held-out commitment). Packet content: PROCEDURAL. *Residual:* deterministic packet generation from archive + seal is not specified; reported |
| P-14 | Adjudication | Rater labels, tallies | Reveal rater identities or tallies to the rating adjudicator; pick a favourable adjudicator | PROCEDURAL, under-specified (A-4) | PROCEDURAL, fully specified (A-4, §4A.3) |

### Conclusions of the test

1. **Two outcome-dependent selection channels exist in Protocol-003 as frozen:** P-7/P-8a (post-sizing appends) and P-8b (post-pilot registry growth). Both let information about CPG outcomes change **which companies can be drawn**, without violating any rule. **They are protocol integrity issues**, closed by B-1 and B-2.
2. **After the amendments, every selection channel is cryptographic or mechanical (P-3 to P-10).** Frame, scan, registry and randomness are fixed before any held-out-relevant CPG outcome, and outsiders can recheck equality.
3. **Reference truth, rating and adjudication remain procedurally protected only.** The amendments specify barriers exactly but cannot make them cryptographic.
4. **Residuals reported (not in A/B/D, not resolved here):**
   - **X-1:** private preview and execution-time choice (P-12).
   - Pilot-response archiving (P-6a).
   - Deterministic rater-packet generation (P-13).

   X-1 is the one that can influence the primary outcome. It needs a human decision before registration on whether to add a rule. The other two are procedural hardening.
