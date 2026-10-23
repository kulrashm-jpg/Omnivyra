# DT_U9_COUNTERFACTUAL_DESIGN — does the deterministic stack beat direct model invocation?

**Artefact class: PREPARATION.**
This document designs a head-to-head study. It builds no counterfactual arm, no harness and no
credential path. It executes nothing, judges nothing and reports no result. No model, API or
network call was made in producing it.

**Stream:** DEEPTECH-PARALLEL-004, Stream U (uncertainties H/I/J).
**Base SHA:** `af2fb6e99ce461894bf16f18c2251f75088eba18` (disposable worktree `C:/tmp/dt4-uncert`).
**Baseline of record:** `DEEPTECH_BASELINE_001.md`.

---

## 0. NAMING DISCIPLINE

**DT-U9 is not CPG-U9.**

| Identifier | Register | Question | Where defined |
|---|---|---|---|
| **DT-U9** | DEEPTECH baseline §9 | Does the **deterministic content stack** beat direct model invocation? | `DEEPTECH_BASELINE_001.md:648` |
| CPG-U9 | CPG-U1 Protocol-004 §16.3 | Would a *company-profile grounding* stack beat a direct model arm, and under what separation rules? | `research/cpg-u1/CPG_U1_PROTOCOL_004.md:890-897` |

This document concerns **DT-U9 only**. Protocol-004 §16.3 is used as a **methodological pattern**
for four rules worth imitating verbatim in spirit: a separate experiment with its own hypotheses
and endpoints; a separate model arm under its **own registered prompt, model identifier,
parameters and abstention instruction**; a **dedicated non-production credential** for that arm;
and the rule that the counterfactual experiment is **never merged into, or described as, the
frozen single-arm study**. Those rules are adopted here for a different system, a different task
and different judges.

**No CPG-U1 artefact is reused.** No frame, registry, seed, commitment record, dataset, reference
truth or tool. Nothing here reads or writes `research/cpg-u1/**`. **The frozen CPG-U1 treatment is
untouched**: this design adds no arm to it, changes no flag it depends on, and requires no edit to
any file it registers (§8).

**Evidence position, stated plainly:** DT-U9 is at **Rung 1** and **has never been posed**
(`DEEPTECH_BASELINE_001.md:648` — "This is the DPIIT question and it has never been posed";
`:903`, BG-12). The baseline further records the central absence: **no counterfactual baseline
exists anywhere** (`:892`, BG-01 — blocks six of nine uncertainties). And the thesis it would test
is currently classified UNPROVEN: "That layer improves output quality vs. direct model
invocation — **UNPROVEN** — Zero experiments" (`:113`).

---

## 1. Why this is the DPIIT question

The entire technical position reduces to one claim: a deterministic decision layer wrapped around
third-party foundation models produces better outcomes than the models alone
(`DEEPTECH_BASELINE_001.md:105-107`). Everything else — determinism, abstention, fail-safety,
flag discipline — is architecture, and architecture is provable from the repository. Only DT-U9
addresses whether the architecture **earns its existence**.

DPIIT Q6 already concedes the dependency boundary: OpenAI is the sole AI SDK dependency, all real
embeddings are third-party, and "model research — **ZERO**"
(`DEEPTECH_BASELINE_001.md:806-818`). Q1 novelty is composition, not algorithm (`:734-740`).
**Given that, the only defensible DeepTech claim available is that the composition works better
than the purchased component alone — and that is DT-U9.** Until DT-U9 runs, the technical thesis
rests on architecture description.

---

## 2. Hypotheses

- **H0 (null).** For a specified content task, output produced through the deterministic stack is
  judged no better by blinded independent judges than output produced by direct model invocation
  under a comparable prompt.
- **H1 (alternative).** Stack output is judged better on a pre-registered primary endpoint, by at
  least a pre-registered minimum detectable difference, at comparable or disclosed cost and
  latency.
- **H2 (co-registered and expected-possible).** The stack's benefit is **not** in mean judged
  quality but in **variance, floor behaviour or duplicate avoidance** — i.e. it prevents bad
  outputs rather than producing better typical ones. §7.3 defines how H2 is measured, because if
  H2 is true and only a mean endpoint is registered, DT-U9 records a null and destroys a true
  claim.

H2 is not a hedge. It is the most plausible mechanism by which a deterministic gate layer earns
its cost, and a design that cannot see it is a badly designed study.

---

## 3. The treatment arm — the stack as it exists

The treatment arm is **the stack as currently implemented**, with no modification. Modifying it
for the experiment would measure a hypothetical system.

### 3.1 What the stack is, in code

| Component | Location | Live state (per baseline §5) |
|---|---|---|
| **Originality cascade (C-01)** | `backend/services/content/originalityGate.ts` — 7-stage early-terminating cascade, header `:1-28` | **LIVE, unconditional**, no flag (`DEEPTECH_BASELINE_001.md:132-134`); call sites include `lib/post/runPostGeneration.ts:455`, `lib/thread/runThreadGeneration.ts:398`, `content/runtime/generationRuntime.ts:349`, `content/campaignUniquenessGuard.ts:328` |
| **Quality engine (C-04)** | `backend/services/content/qualityEngine.ts:494-547`; 12 dimensions at `lib/content/quality/types.ts:33-46` | **PARTIAL**; wired at `lib/post/runPostGeneration.ts:44,581`, `lib/thread/runThreadGeneration.ts:45`, `pages/api/content/[id]/quality.ts` |
| **Grounding policy (C-02)** | `backend/services/ai/grounding/groundingPolicy.ts` — freshness multipliers `:16-18`, floor `GROUNDING_FLOOR_THRESHOLD = 0.3` at `:21` | **LIVE** at `contextAssimilationEngine.ts:215` (`DEEPTECH_BASELINE_001.md:153`) |
| **Prompt / identity assembly** | `backend/services/contentGeneration/blueprintGenerator.ts`; company identity, identity lock and anti-generic rules via `lib/content/companyContextBlock` (imported at `lib/post/runPostGeneration.ts:10-16`) | Live in the generation path |
| **Governance preamble** | `backend/services/creator/strategyGovernancePromptContext.ts` (imported at `lib/post/runPostGeneration.ts:19`) | Live |
| **Execution runtime seam** | `runAiExecution` — `backend/services/ai/aiExecutionRuntime.ts:131`; lifecycle header `:1-28` | Live; credits/idempotency/resume |
| **AI gateway** | `backend/services/aiGateway*.ts` (14 modules) | Live (C-08) |
| **Prediction engine** | `backend/services/content/predictionEngine.ts` — consumes quality at `:31` | Downstream of the stack |
| **Regeneration loop** | `backend/services/content/originalityRegeneration.ts` (`regenerateUntilOriginal`, imported at `lib/post/runPostGeneration.ts:31`) | **This is where the stack can spend extra model calls** — critical for the cost confound (§9) |

### 3.2 Three properties of the treatment arm that must be disclosed in advance

1. **The originality gate fails open.** `originalityGate.ts:25-28` — the pipeline is
   try/catch-wrapped and returns `bypassed` / `isOriginal: true` on any error. The baseline states
   the consequence bluntly (`DEEPTECH_BASELINE_001.md:143`): "the gate is designed to fail open,
   so a production 'pass' rate is not evidence of a working gate." **DT-U9 must record, per item,
   whether the gate actually ran or bypassed**, and must report any item whose gate bypassed
   separately. Otherwise the treatment arm may be partly the control arm without anyone noticing.
2. **The embedding stage is off.** Stage 6 requires an injected embedder and no production path
   supplies one (`DEEPTECH_BASELINE_001.md:141`). So the stack under test is the six-stage
   configuration, and that must be registered as the treatment identity.
3. **Quality wiring is additive and fail-open.** `lib/post/runPostGeneration.ts:24-27,36-40`
   describe the Wave-2/Wave-4 wiring as additive, best-effort and never able to break generation.
   A quality scorecard is therefore **observational in the treatment arm, not a gate** — the stack
   does not currently reject content for low quality. **DT-U9 must not describe the quality engine
   as a gate.**

> **DECISION REQUIRED — D-U9-1: treatment arm entry point.**
> - **(a) `lib/post/runPostGeneration.ts`** — the concrete live post path; includes originality,
>   regeneration, quality wiring and persistence. Most representative; most side effects
>   (it writes a `content` row via `createContent`, `:23`).
> - **(b) `generationRuntime`** (`backend/services/content/runtime/generationRuntime.ts`) — the
>   canonical Wave-3 runtime, **flag-gated and default OFF** per the import comment at
>   `lib/post/runPostGeneration.ts:33-35`. Cleaner seam; but testing a default-OFF path means the
>   result does not describe production.
> - **(c) A thin harness that calls the stack's components in the production order** without the
>   persistence side effects. Cleanest for an experiment; **weakest claim**, because "the stack"
>   then means a reconstruction rather than the shipped path, and a reviewer will say so.
>
> **Consequence:** (b) yields a result about a dark path; (c) yields a result about a
> reconstruction. **Recommended: (a)**, with persistence directed at a non-production database and
> that fact registered.

---

## 4. The counterfactual arm — "direct model invocation", specified exactly

**This arm does not exist.** `DEEPTECH_BASELINE_001.md:892` (BG-01): "**No counterfactual baseline
exists** — no ungrounded/direct-model control arm anywhere." Confirmed at `af2fb6e9`: there is no
module, script, npm target or route that invokes a model with a bare task prompt outside the
stack. Everything routes through the gateway and the assembly layers of §3.1.

**"Direct model invocation" is not self-defining**, and the choice of definition determines the
answer. A deliberately impoverished control arm makes the stack look good and is worthless as
evidence; an over-engineered one is no longer a control.

### 4.1 The definition ladder — four candidate control arms

| Arm | Definition | Prompt | What the comparison then means |
|---|---|---|---|
| **C-NAIVE** | One model call with the user's raw task description and nothing else | The task, verbatim | Weakest control. Tests "does prompt engineering help?" — a question nobody disputes. **Unacceptable as the sole control.** |
| **C-FAIR** | One model call with a **competently written single prompt** carrying the same *substantive inputs* the stack assembles — company identity, objective, audience, platform, tone — but **no deterministic machinery** (no originality cascade, no regeneration loop, no quality scoring, no grounding floor) | One registered, frozen prompt authored to a good standard | **The honest control.** Tests whether the deterministic layer adds anything beyond putting the same information in the prompt. This is the arm a sceptical reviewer will demand. |
| **C-STRONG** | C-FAIR **plus** a self-critique/revision turn (the model asked to check and improve its own output) | Registered two-turn prompt | The hardest control: does a deterministic cascade beat the model checking its own work? A win here is the strongest possible DT-U9 result. A loss is a genuinely important finding. |
| **C-ABSTAIN** | C-FAIR plus a registered abstention instruction (produce nothing rather than something unsupported) | C-FAIR + abstention clause | Isolates whether the *abstention contract* (C-06) needs to be architectural, or whether an instruction suffices |

> **DECISION REQUIRED — D-U9-2: which control arm(s), and how many.**
> - **(a) C-FAIR alone.** One control; cheapest; defensible as *the* honest comparison.
> - **(b) C-FAIR + C-STRONG.** Two controls; roughly doubles model cost and judging load; a win
>   against C-STRONG is a far stronger claim, and a loss against C-STRONG while winning against
>   C-FAIR is itself the most informative possible outcome.
> - **(c) All four.** Complete picture; four arms multiply judging cost and introduce a
>   multiplicity problem that must be pre-registered.
> - **Including C-NAIVE at all** is only defensible as a *published floor reference*, never as
>   the comparator the primary endpoint rests on.
>
> **Consequence:** if C-NAIVE is the only control, the result is worthless and a reviewer will say
> so in one sentence. **Recommended: (b), with C-FAIR as the primary comparator and C-STRONG
> reported beside it.**

### 4.2 Model, parameters and credential

| Item | Specification | Basis |
|---|---|---|
| **Model** | **The same model the stack uses**, pinned by exact identifier. The default resolves to `process.env.OPENAI_MODEL \|\| 'gpt-4o-mini'` — `blueprintGenerator.ts:134,502,596`; `platformVariantGenerator.ts:141,570`; also `activityWorkspace/contentRouteHandler.ts:219,341,408,496,759,819,836`. The experiment pins the literal id and registers it; env-driven resolution is **not** acceptable for a registered arm |
| **Parameters** | Temperature, top-p, max tokens and every other sampling parameter **identical across arms**, and registered by value. A parameter difference between arms is a silent third variable |
| **Provider** | Same provider in both arms (OpenAI is the sole AI SDK dependency — `DEEPTECH_BASELINE_001.md:810`) |
| **Credential** | **A dedicated non-production credential with a hard spend cap.** Production credentials never enter the experiment. (Pattern from `CPG_U1_PROTOCOL_004.md:894`, applied independently) |
| **Determinism of the model** | Not assumed. The model is stochastic in both arms; §6.2 handles this with repeats, and DT-U2 (variance) remains a separate open uncertainty (`DEEPTECH_BASELINE_001.md:641`) |

**Finding on the mock path, recorded because it matters for D-U9-5:** `CERT_AI_MOCK` appears only
in `.env.cert.example:23,26` (and in CPG-U1's protocol text). **No code at `af2fb6e9` reads
`CERT_AI_MOCK` or any `AI_MOCK` variable** — a repository-wide search for `CERT_AI_MOCK` matched
only that example file and the protocol document, and a search of all `.ts` for `AI_MOCK|aiMock`
matched nothing. So the documented deterministic-stub path **is not implemented**. DT-U9 cannot
rely on it, and any protocol clause that assumes a mock arm exists is wrong at this SHA.
**UNVERIFIED whether it existed at any other SHA; not investigated.**

### 4.3 What is held equal — the equality table

Registered before execution. Anything not in the "held equal" column is a confound.

| Held equal across arms | Deliberately different (the intervention) |
|---|---|
| Task set and every task input (topic, objective, audience, platform, content type, tone) | Presence of the originality cascade and its regeneration loop |
| Company context **content** — the same identity, positioning and brand facts are available to both arms | Presence of the grounding freshness/floor policy |
| Model identifier and all sampling parameters | Presence of deterministic quality scoring |
| Number of *judged* outputs per task per arm | Prompt **structure** (assembled by the stack vs one registered prompt) |
| Output format requirements and length constraints | Number of *internal* model calls (measured, not equalised — §9) |
| Judges, rubric, presentation, ordering procedure | — |
| Wall-clock window in which generation occurs | — |

**The hardest equality problem, named:** the stack's prompt is *assembled* from company context,
identity lock, anti-generic rules and a governance preamble (§3.1). The control arm must receive
**the same information** without receiving **the same machinery**. If the control prompt is
written by the same people who built the stack, they can under-write it — consciously or not.

> **DECISION REQUIRED — D-U9-3: who authors the control prompt.**
> - **(a) The implementers.** Fastest; fully exposed to the charge of a strawman control, which is
>   the single most likely reason an otherwise-good DT-U9 result is dismissed.
> - **(b) An independent prompt author** who receives the task inputs and the information
>   inventory but not the stack's code, and is instructed to write the best single prompt they can.
>   Materially stronger; needs one more independent person; the author must be held to §5's
>   independence rules and must never see the stack's output.
> - **(c) A published, dated third-party prompt baseline** for the task, if a credible one exists.
>   Most neutral; likely unavailable for this specific content task.
>
> **Consequence:** under (a) the result is not externally credible on the point it most needs to
> be. **Recommended: (b).** The control prompt is then frozen and published with its hash before
> any generation.

### 4.4 New engineering the counterfactual arm needs — explicit inventory

None of this exists today. Listed so the cost is visible, and **none of it is built by this
document.**

| # | Component | Why | Class |
|---|---|---|---|
| **E1** | A direct-invocation module: one function taking a registered prompt template + task inputs, calling the pinned model with registered parameters, returning raw output and usage | BG-01 — no such path exists | ENGINEERING ARTIFACT (not built) |
| **E2** | A task-set definition and loader: the frozen list of comparison tasks with their inputs | No comparison task set exists | ENGINEERING ARTIFACT (not built) |
| **E3** | A run harness that executes both arms over the task set, with per-item provenance: arm id, model id, parameters, prompt hash, timestamps | Needed for reproducibility and for §9 | ENGINEERING ARTIFACT (not built) |
| **E4** | Cost and latency instrumentation: per item, **total** model calls, input/output tokens, wall-clock, and — for the treatment arm — regeneration attempts from `originalityRegeneration` | §9; without it the cost confound is assumed rather than measured | ENGINEERING ARTIFACT (not built) |
| **E5** | Gate-execution telemetry: per item, did the originality gate run or **bypass** (`originalityGate.ts:25-28`), and which stage terminated | §3.2/1 — otherwise the treatment arm's integrity is unknown | ENGINEERING ARTIFACT (not built) |
| **E6** | An output archive: raw outputs, request/response records, and hashes, written to a non-production store | Replication; and judges must receive exactly what was produced | ENGINEERING ARTIFACT (not built) |
| **E7** | A blinded judging packet builder: strips arm identity, normalises presentation, derives ordering mechanically | §6 blinding is otherwise unenforceable | ENGINEERING ARTIFACT (not built) |
| **E8** | Non-production credential and spend-cap configuration | §4.2 | HUMAN-REQUIRED INPUT (operator) |

**E1–E7 are engineering, not judgment**, and could be built with **zero human labelling input
(H0/H1)** — see `DT_U4_U8_U9_DEPENDENCY_MAP.md` §4. **E8 and the judges are the gate.**

---

## 5. Judges: count, independence, eligibility

| Role | Count | Constraint |
|---|---|---|
| Operator (custodian; **not independent**) | 1 | Runs both arms, holds seals and the credential; no judging role |
| Independent prompt author (per D-U9-3(b)) | 1 | Never sees the stack's code or output; holds no judging role |
| **Judge** | **≥ 2 independent per item** | Mutually blind; every judged item carries ≥ 2 independent judgments |
| **Judging adjudicator** | 1, independent | Resolves disagreement on a blinded packet |

Minimum **4 independent persons** (5 with an independent prompt author). Roles mutually
exclusive. Person-to-role assignment fingerprinted and published **before** any generation.

**A judge is not independent** if, in the period from the developing organisation's first product
commit to publication, the person: was employed or engaged by it (other than a fixed,
result-independent study fee whose agreement hash is recorded); received any other benefit from
it; holds any financial interest; implemented the stack, the control arm, the task set, the rubric
or this protocol; **has read the stack's or the control arm's source or prompts**; or is a
household member, partner, family member of, or reports to, any of those people or the operator.

"Unknown" is not "no". These are **procedural records, not proof**.

**If independent judges cannot be obtained:** execution may occur, but every endpoint is labelled
**UNADJUDICATED**, the rung **cannot exceed Rung 2**, and **no claim that the stack beats direct
invocation may be made.** The design is not weakened to accommodate unavailability.

---

## 6. The comparison task set, and blinding

### 6.1 Task set

Frozen and published before any generation. Stratified on the axes the stack conditions on:

| Axis | Source of levels |
|---|---|
| `contentType` | `QualityEngineInput.contentType` (`qualityEngine.ts:33`); `splitIntoBlocks` behaviour |
| `platform` | `PLATFORM_CHAR_LIMITS` — `qualityEngine.ts:70-80` |
| Objective / intent shape | `intent` and `writer_content_brief` fields consumed at `blueprintGenerator.ts:236-252` |
| **Company context richness** | Full context vs thin context. **Essential**: the stack's grounding floor and identity lock should matter *most* when context is thin, so a set of only well-specified companies may hide the stack's real benefit |
| **Duplicate pressure** | Tasks that are near-repeats of earlier tasks in the set. **Essential**: the originality cascade's entire purpose is duplicate avoidance, and a task set with no repetition gives it nothing to do |

The duplicate-pressure stratum is the H2 stratum (§2). A task set without it structurally cannot
detect the stack's most likely real advantage.

> **DECISION REQUIRED — D-U9-4: company contexts in the task set.**
> - **(a) Real customer companies.** Most representative; raises the same tenant-confidentiality
>   question as DT-U8's D-U8-2, since external judges would see the output.
> - **(b) The developing organisation's own company only.** No confidentiality issue; but the
>   context is authored by the implementers, and a single context collapses the richness stratum.
> - **(c) Public companies not in the repository**, contexts assembled from public sources by the
>   independent prompt author or an enumerator. Neutral and stratifiable; costs sourcing work.
>
> **Consequence:** (b) reduces DT-U9 to a single-context demonstration and would be read as such.
> **Recommended: (c).**

### 6.2 Repeats, to separate stack effect from model stochasticity

The model is stochastic. A single sample per arm per task confuses "the stack is better" with
"this sample was luckier".

> **DECISION REQUIRED — D-U9-5: repeats per arm per task.**
> - **(a) 1 sample per arm per task.** Cheapest; **cannot** separate arm effect from sampling
>   noise, and cannot address H2 (variance) at all. Not recommended.
> - **(b) 3 samples per arm per task; a pre-registered rule selects which is judged** (e.g. the
>   first, chosen before any output is seen) **and all three are archived and used for the
>   variance endpoint.** Supports H2; triples model cost; judging cost unchanged if only one
>   sample per arm is judged.
> - **(c) 3 samples per arm per task, all judged.** Strongest; triples both model and judging
>   cost.
>
> **Consequence:** under (a) a null result is uninterpretable and H2 is undetectable.
> **Recommended: (b)** — it buys the variance endpoint at model cost only, which is the cheap
> resource here.

**The selection rule must be registered before any output exists.** Choosing which sample is
judged after seeing outputs is the most direct way to fabricate a result.

### 6.3 Blinding

| What is blinded | From whom | How |
|---|---|---|
| **Arm identity** | Judges and adjudicator | Outputs stripped of any arm marker and re-rendered in a single uniform presentation by E7 |
| Formatting and stylistic tells | Judges | The stack's assembly may impose recognisable structure (headings, block shapes from `splitIntoBlocks`). **Normalisation is imperfect** — see §6.4 |
| Which judge gave which judgment | Adjudicator | "Judgment A"/"Judgment B", assignment derived mechanically |
| Other judges' judgments, tallies, running aggregates | Judges | Separate sheets |
| Item ordering and arm ordering within an item | Judges | Derived mechanically from a value published before judging; independently derived per judge |
| Quality scorecards, originality scores, predictions, any internal metric | Judges and adjudicator | Never in a packet |
| Cost, latency and token counts | Judges | Measured by E4; never shown to judges — otherwise a judge infers the arm |

**Order of operations:** freeze task set, prompts, model id, parameters and endpoints → generate
both arms → archive and hash → build blinded packets → judge → seal judgments → only then unblind
arm identity and compute endpoints.

### 6.4 The blinding limitation that must be disclosed, not glossed

**A determined judge may be able to tell the arms apart.** The stack imposes structure; a single
direct prompt may produce visibly different shape. Presentation normalisation (E7) reduces but
does not eliminate this.

**Mandatory manipulation check:** judges are asked, per item and **after** their quality
judgment, which output they believe came from which system, plus a confidence rating. If judges
identify the arm materially better than chance, **the primary endpoint is reported as
PARTIALLY-BLINDED** and that fact is published beside the result. This converts an unavoidable
weakness into a measured quantity rather than an unstated assumption.

---

## 7. Endpoints

### 7.1 Primary

> **DECISION REQUIRED — D-U9-6: the primary endpoint form.**
> - **(a) Forced-choice preference.** For each item, the judge picks the better output (with a
>   permitted "no meaningful difference"). Endpoint: **stack win rate against C-FAIR**. Highest
>   judge reliability, no scale-use problem, directly answers "beats". Gives no absolute quality
>   level.
> - **(b) Independent absolute rating** of each output on a registered rubric, arms compared on
>   mean. Gives absolute levels; needs a validated rubric (and DT-U8 shows no such rubric exists
>   yet — see `DT_U8_PROTOCOL_DRAFT.md` §15); vulnerable to rater scale differences.
> - **(c) Both.** Preference as primary, absolute as secondary. More judging cost; most complete.
>
> **Consequence:** (b) makes DT-U9 depend on an instrument that does not exist and is itself
> unvalidated. **Recommended: (a) as primary**, with (c) if budget allows.

Assuming (a):

| ID | Endpoint | Definition |
|---|---|---|
| **G-U9** | **Assessability gate** | ≥ 2 independent judgments on ≥ 90 % of items; item count ≥ §8 minimum; inter-judge agreement at or above the §7.4 floor; **treatment-arm gate-bypass rate (E5) below a registered ceiling**. Fails → INCONCLUSIVE, checked first |
| **P-U9-1** | **Stack win rate vs C-FAIR (PRIMARY)** | `stack wins ÷ (stack wins + control wins)`, ties excluded from the ratio and reported separately |
| **P-U9-2** | **Stack win rate vs C-STRONG** | Same, if D-U9-2(b). Reported beside P-U9-1; acceptance role per D-U9-2 |
| **S-U9-1** | Tie rate | "No meaningful difference" frequency — a high tie rate is itself the answer, and a very high one means the stack is invisible to users |
| **S-U9-2** | **Cost per judged output** | Total model calls and tokens, both arms (E4). **Measured, never assumed** |
| **S-U9-3** | **Latency per judged output** | Wall-clock, both arms (E4) |
| **S-U9-4** | **Variance / floor endpoint (H2)** | Across repeats (D-U9-5): dispersion of judged quality per arm, and **worst-case** output quality per arm |
| **S-U9-5** | **Duplicate-avoidance endpoint** | On the duplicate-pressure stratum: rate at which each arm produces near-duplicates of earlier outputs, measured by the same similarity primitives the cascade uses (`lib/content/originality/*`), applied **identically to both arms** and reported as a mechanical measure, not as a quality judgment |
| **S-U9-6** | Gate-execution profile | From E5: bypass rate, and which cascade stage terminated |
| **S-U9-7** | Arm-identification rate | The §6.4 manipulation check |

**S-U9-5 carries a methodological caveat that must be published with it:** the similarity measure
is the treatment arm's own instrument. Applied symmetrically it is a fair *mechanical* comparison,
but it is **not** independent evidence that near-duplication matters to users. Present it as a
mechanical property, and if duplication quality matters to the claim, let the human preference
endpoint carry it.

### 7.2 Minimum detectable difference

P-U9-1 is a proportion (win rate), tested against 0.5.

**The honest framing:** the number of items needed grows sharply as the difference to be detected
shrinks. Detecting a large advantage takes a modest set; detecting a small one takes a large set;
and a null from a small set means "we could not see it", not "it is not there".

| Regime | Win rate to detect | Judged items needed (order of magnitude) | What it supports |
|---|---|---|---|
| **Large effect** | 0.70 vs 0.50 | **~50–60** | "The stack is clearly preferred" |
| **Moderate effect** | 0.65 vs 0.50 | **~100–130** | "The stack is preferred" |
| **Small effect** | 0.60 vs 0.50 | **~250–300** | "The stack is modestly preferred" |
| **Very small** | 0.55 vs 0.50 | **~1000+** | Not reachable at realistic judging cost |

(Orders of magnitude for a two-sided test at conventional power; the exact n is computed and
registered before the draw, and the computation is published.)

> **DECISION REQUIRED — D-U9-7: the minimum detectable difference, and therefore the scale.**
> - **(a) MDD = 0.20 (win rate 0.70), ~60 items.** Achievable; **and a null result then means only
>   "no large effect", which must be stated in those words** and not as "no effect".
> - **(b) MDD = 0.15 (0.65), ~120 items.** Twice the judging cost; supports a more useful null.
> - **(c) MDD = 0.10 (0.60), ~280 items.** Probably beyond a first study's budget.
>
> **Consequence:** this is the single most consequential decision in the design, because **a null
> at (a) will be read externally as "the stack does not help"** when it only licenses "no large
> effect was detected". Whatever is chosen, the null-result sentence is pre-registered (§10).

**Pre-registered null-result sentence (draft; owner finalises):**

> "At the registered sample size, no advantage of the deterministic stack over a competently
> prompted direct model invocation was detected at a minimum detectable difference of *[MDD]* in
> preference win rate. This does not establish that no smaller advantage exists, and it does not
> speak to the variance, floor-behaviour or duplicate-avoidance endpoints reported separately."

### 7.3 H2 acceptance, registered in advance

If P-U9-1 is null **and** S-U9-4 or S-U9-5 shows a material, pre-registered advantage for the
stack, the outcome is reported as **H2-SUPPORTED: no mean advantage, variance/floor advantage
present** — an outcome word of its own (§10), not a rebranded success. Its thresholds are
registered before execution, exactly as P-U9-1's are. Discovering H2 after seeing a null and then
declaring a threshold is not evidence.

### 7.4 Inter-judge agreement

For forced choice, report **Cohen's κ** (or Krippendorff's α across >2 judges) on the
stack/control/tie decision, with a floor of **≥ 0.40** for a three-category preference judgment.
Below the floor → INCONCLUSIVE: judges do not agree on which output is better, so no arm can be
declared better. Publish per-category agreement beside it.

> **DECISION REQUIRED — D-U9-8: the κ floor for preference.** (a) **0.40** — realistic for
> subjective preference, where genuine disagreement about "better" is expected. (b) **0.60** —
> stronger, with a real risk of an INCONCLUSIVE run on an inherently subjective task.
> **Consequence:** too low a floor lets coin-flip judging produce a win rate; too high a floor may
> make DT-U9 unexecutable.

---

## 8. Cost and latency confounds — measured, not assumed

**The stack is not free, and the difference is not a footnote: it is part of the claim.** A stack
that wins on quality while costing several times as much in model calls and adding seconds of
latency may or may not be worth it — but that trade-off cannot be evaluated if it was never
measured.

| Confound | Why it is real here | What must be measured (E4) |
|---|---|---|
| **Extra model calls from regeneration** | `regenerateUntilOriginal` (`originalityRegeneration`, imported at `lib/post/runPostGeneration.ts:31`) can re-invoke generation when the cascade rejects output. The treatment arm may therefore consume **several** model calls where the control consumes one | Total model calls per judged output, per arm; regeneration attempts per item |
| **Token cost** | Assembled prompts (identity lock, anti-generic rules, governance preamble — §3.1) are longer than one direct prompt, so input tokens differ systematically | Input and output tokens per call, summed per item, per arm |
| **Latency** | Cascade stages, regeneration, and quality scoring add wall-clock. Quality scoring is pure and fast; regeneration is not | Wall-clock per item, per arm; and the stack's internal breakdown where available |
| **Best-of-N equivalence — the sharp confound** | If the stack's win comes from generating repeatedly until it passes a gate, then **the fair control is a best-of-N direct arm at equal model spend**, not a single call. Otherwise the experiment may be measuring "more samples help", which is a known property of sampling and not a property of the deterministic layer | Per-item call counts (above), and whether an equal-spend control arm is added |
| **Non-model cost** | Determinism is a real cost advantage the stack has: quality scoring makes **no** AI calls and no DB calls (`qualityEngine.ts:1-19`); the grounding policy is pure. This should be reported as the stack's genuine efficiency property | Per-item non-model compute, at least qualitatively |
| **Retry/resume accounting** | `runAiExecution` resumes from a stored result with "no new charge and no new LLM call" (`aiExecutionRuntime.ts:11-17`). A resumed item would silently record zero cost | Per item, whether the execution resumed; resumed items flagged and excluded from cost endpoints |

> **DECISION REQUIRED — D-U9-9: equal-spend control.**
> - **(a) No equal-spend arm.** The primary comparison is one-call control vs the stack at
>   whatever spend it uses. Simple; **exposed to the decisive objection** that a best-of-N direct
>   arm at equal spend might match or beat the stack.
> - **(b) Add a best-of-N direct arm** at model spend matched to the treatment arm's measured mean,
>   with N registered after a pilot measures the stack's call count but **before** any judged
>   generation. Answers the objection; adds an arm and a sequencing constraint; the pilot's output
>   must never be judged or shown to judges.
>
> **Consequence:** under (a), a stack win is attributable to "the stack sampled more times", and
> that single alternative explanation can nullify the entire result. **Recommended: (b).** This is
> the most important methodological addition in this document.

**Cost and latency are secondary endpoints (S-U9-2, S-U9-3), never acceptance criteria** — but
they are **mandatory reporting**. A DT-U9 success published without them is incomplete, and the
protocol must forbid publishing P-U9-1 without S-U9-2 and S-U9-3 alongside.

---

## 9. Validity, dispositions and INCONCLUSIVE conditions

**Per-item dispositions:** `JUDGED`, `NO-DIFFERENCE` (tie; counted, reported, excluded from the
win ratio), `JUDGMENT-CONFLICT-UNRESOLVED` (excluded, published), `VOID` (generation failed in
either arm; excluded, published, **not replaced**), `GATE-BYPASSED` (treatment arm's cascade
failed open per `originalityGate.ts:25-28`; judged **and** flagged, reported separately),
`RESUMED` (execution resumed per `aiExecutionRuntime.ts:11-17`; excluded from cost endpoints).

**The run is INCONCLUSIVE if any of:**

- G-U9 fails (judgment coverage, item count, agreement floor, or gate-bypass ceiling);
- inter-judge agreement below the §7.4 floor;
- ties exceed a registered ceiling (judges see no difference often enough that the comparison is
  not meaningful);
- arm-identification (S-U9-7) is materially better than chance **and** was not pre-declared as
  PARTIALLY-BLINDED;
- any stack file changed between registration and execution (SHA mismatch);
- the control prompt, model id or parameters differ from the registered values in any item;
- a production credential is found to have been used;
- the archive (E6) cannot reproduce the judged packets.

---

## 10. Outcome vocabulary — exactly one word per run

| Outcome | Condition |
|---|---|
| **INCONCLUSIVE** | Any §9 condition. Checked **first** |
| **FALSIFIED** | Conclusive, and the **control** wins at a rate beyond the mirror of the registered MDD (the direct arm is better than the stack). Published as evidence **against** the deterministic-layer thesis |
| **FAILURE** | Conclusive, not falsified, and P-U9-1 does not reach its registered threshold — **including a near miss**. Published with the §7.2 null sentence |
| **H2-SUPPORTED** | P-U9-1 null **and** a pre-registered variance/floor/duplicate advantage present (§7.3). Reported as a distinct, narrower finding — never as a P-U9-1 success |
| **SUCCESS** | G-U9 holds, agreement clears §7.4, blinding was not compromised, and P-U9-1 meets its threshold — **published together with S-U9-2 and S-U9-3** |

**What a SUCCESS licenses:** "On *n* frozen tasks spanning *[declared strata]*, outputs produced
by the deterministic stack at SHA *X* were preferred by independent judges blind to arm identity
over outputs from a single registered prompt to the same model with identical parameters, at a win
rate of …, at a measured cost of … model calls and … tokens per output and a latency of … ."

**What a SUCCESS does NOT license:** any claim beyond the sampled tasks, platforms, content types
and company contexts; any claim about factual correctness or grounding efficacy (that is DT-U1,
which has **no** result — `DEEPTECH_BASELINE_001.md:640`); any claim that the win is free (S-U9-2
and S-U9-3 must accompany it); any claim that the win is not attributable to extra sampling unless
D-U9-9(b) was run; any claim about a different model; any statement that a threshold in the stack
is calibrated (`DEEPTECH_BASELINE_001.md:898`, BG-06 remains open); any algorithmic-novelty claim
(`:734-740`).

---

## 11. Keeping this out of the frozen U1 treatment

Binding, and verified against the base worktree:

1. DT-U9 creates **no file** under `research/cpg-u1/**` and **modifies none**. Its artefacts live
   only under `research/deeptech-operations/uncertainties/`.
2. DT-U9 requires **no change** to any file the CPG-U1 treatment identity binds. Its treatment arm
   is the **content generation stack** (`lib/post/runPostGeneration.ts`,
   `backend/services/content/**`, `backend/services/contentGeneration/**`), and its control arm is
   **new code that does not yet exist** (E1). Neither is a CPG-U1 surface.
3. DT-U9's control arm is **never described as a control for CPG-U1**, and CPG-U1's single-arm
   design is never described as a baseline for DT-U9.
4. DT-U9 uses its **own** credential (§4.2, E8), its **own** task set (E2), its **own** judges and
   its **own** archive (E6). It shares no seed, no commitment, no reference truth and no tool.
5. If DT-U9 execution would require touching any flag, env var or module that CPG-U1's registered
   treatment depends on, **DT-U9 stops and the conflict is escalated** rather than resolved by an
   edit. No such dependency is known at `af2fb6e9`; **UNVERIFIED** in the sense that no exhaustive
   cross-check of CPG-U1's bound file set against the content stack was performed in this task
   (out of scope — would require reading CPG-U1's registration in detail, which this stream
   avoids beyond the methodological sections).

---

## 12. DECISION REQUIRED — consolidated

| ID | Decision | Alternatives | If chosen silently |
|---|---|---|---|
| **D-U9-1** | Treatment arm entry point | (a) `runPostGeneration` (b) `generationRuntime` (flag-dark) (c) thin harness | Result describes a dark path or a reconstruction, not production |
| **D-U9-2** | Which control arm(s) | (a) C-FAIR (b) C-FAIR + C-STRONG (c) all four | A strawman control invalidates the result in one sentence |
| **D-U9-3** | Who authors the control prompt | (a) implementers (b) independent author (c) third-party baseline | Control is under-written by the people it competes with |
| **D-U9-4** | Company contexts in the task set | (a) real customers (b) own company (c) public companies | Confidentiality exposure, or a single-context demonstration |
| **D-U9-5** | Repeats per arm per task | (a) 1 (b) 3, one judged (c) 3, all judged | Sampling noise mistaken for arm effect; H2 undetectable |
| **D-U9-6** | Primary endpoint form | (a) forced choice (b) absolute rating (c) both | (b) depends on an unvalidated rubric (DT-U8 is unresolved) |
| **D-U9-7** | Minimum detectable difference and scale | (a) 0.20 / ~60 (b) 0.15 / ~120 (c) 0.10 / ~280 | A null is read as "no effect" rather than "no large effect" |
| **D-U9-8** | κ floor for preference | (a) 0.40 (b) 0.60 | Coin-flip judging produces a win rate, or the study is unexecutable |
| **D-U9-9** | Equal-spend (best-of-N) control | (a) none (b) matched-spend direct arm | A stack win is fully explained by "it sampled more times" |

---

## 13. Status

| Item | State |
|---|---|
| Treatment arm (stack) exists and is located | **VERIFIED** — `originalityGate.ts`, `qualityEngine.ts:494`, `groundingPolicy.ts`, `aiExecutionRuntime.ts:131`, `lib/post/runPostGeneration.ts` |
| Originality gate fails open | **VERIFIED** — `originalityGate.ts:25-28`; must be instrumented (E5) |
| Quality engine is observational, not a gate, in the generation path | **VERIFIED** — `lib/post/runPostGeneration.ts:36-40` (additive + fail-open) |
| Counterfactual (direct-invocation) arm | **DOES NOT EXIST** — BG-01, `DEEPTECH_BASELINE_001.md:892`; confirmed at `af2fb6e9` |
| Deterministic mock path (`CERT_AI_MOCK`) | **NOT IMPLEMENTED** at this SHA — present only in `.env.cert.example:23,26`; no code reads it |
| Model pinning | **NOT REGISTRABLE AS-IS** — resolves from env (`blueprintGenerator.ts:134,502,596`); must be pinned explicitly |
| Comparison task set | **DOES NOT EXIST** (E2) |
| Cost/latency instrumentation for a comparison | **DOES NOT EXIST** (E4) |
| Judges, rubric, packets | **DO NOT EXIST** |
| DT-U9 posed before DT-SPEC-001 | **NO** — `DEEPTECH_BASELINE_001.md:648`, `:903` |
| Any DT-U9 evidence | **NONE.** Rung 1. No head-to-head result exists. |
| Anything implemented by this document | **NONE — design only.** E1–E8 are **DEFERRED** |
| This design executed | **NOT RUN** |
