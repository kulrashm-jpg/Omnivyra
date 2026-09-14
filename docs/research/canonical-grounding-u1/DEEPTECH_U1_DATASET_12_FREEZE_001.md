# DEEPTECH_U1_DATASET_12_FREEZE_001

**Freeze and validation record for the 12-company Raina-originated U1 ground-truth corpus.**

> **No fact in this corpus was authored, inferred, researched, improved, re-worded or repaired by the agent.** Every factual string is transcribed verbatim from the supplied material. Where the source is silent, the field reads `NOT AVAILABLE FROM SOURCE`.

---

## 0. Identity

| Field | Value |
|---|---|
| Dataset ID | `canonicalGrounding.u1Dataset.raina12` |
| Version | `raina12-v1` |
| **SHA-256** | **`1521c379d5b1818a11befc1dabe56e37c44d11048407af12a56a610fd94ef8cd`** |
| Serialized size | 20,302 bytes |
| Companies | **12** |
| Provenance class | **REAL COMPANIES — EXTERNALLY SOURCED, INDEPENDENTLY PREPARED** |
| Bound protocol | **`u1-004`**, fingerprint `884148fd` |
| Repository SHA | `82754497e8f9b64a893319e863941ad2994fd9b7` |
| Frozen | 2026-09-10 |
| Reproducible | ✅ verified |

**Preserved unchanged:** `goldenDataset.v1` · `u1Dataset.v2` (`369e2165…`) · `u1-001` (`b204e168`) · `u1-002` (`3c93760a`) · `u1-003`.

---

## 1. The 12 companies in scope

| # | Company | Industry | City | Revenue evidence class | Source |
|--:|---|---|---|---|---|
| 1 | Secure IT Simply | IT Services / Cybersecurity | India / Remote | REPORTED FACT ⚠️ | CB Insights / Startup Pedia |
| 2 | Tensech Solutions | IT Services / Software Engineering | Noida / Lucknow | REPORTED + TARGET | LinkedIn / Startup Pedia |
| 3 | Dreamtime Learning | Education / EdTech | Hyderabad / Pune | REPORTED + TARGET | YourStory (Apr 2026) |
| 4 | TAUTMORE | Education / EdTech B2B | India | REPORTED + PROJECTION ⚠️ | Automate.video presentation |
| 5 | Kruu | Education / EdTech | Chennai | TARGET + profitability | Business India (May 2026) |
| 6 | INLIFE Healthcare | Nutraceuticals / D2C | Hyderabad | REPORTED FACT | YourStory / company statements |
| 7 | MrMed | Healthcare / Specialty Medicines | Chennai | **VERIFIED SOURCE FACT** | Inc42 + YourStory |
| 8 | Sensivision Health Technologies | Medtech / Healthcare B2B | Bengaluru | TARGET only ⚠️ | YourStory (Feb 2025) |
| 9 | Vector Technics | Advanced Manufacturing / Drone Propulsion | India | RUN-RATE + ORDER BOOK | CEO Insider (2026) |
| 10 | Hummingbird Consulting | Professional / HR Consulting | Ahmedabad | TARGET only | eChai Ventures founder post |
| 11 | Yoho | D2C Footwear / E-commerce | New Delhi | **VERIFIED SOURCE FACT** | Inc42 + Dealroom |
| 12 | NXTFACE | D2C Skincare / Beauty | Chennai | NOT AVAILABLE + investment + ambition | Times of India (2025) |

⚠️ = carries the source author's own unresolved pre-freeze re-verification instruction (§6).

---

## 2. Explicit exclusions

The eight later-appended companies are **out of scope and were not used, not merged and not substituted**:

`SpesNet` · `Speso` · `Spetrol` · `SPETECH` · `SPETS AB` · `Spetco International Petroleum Co.` · `Spesafacile` · `Spesasicura`

**Machine-verified:** none appears anywhere in the frozen corpus. A test injects one and confirms the exclusion audit fires (`EXCLUDED_COMPANY_PRESENT`).

**No company was created to raise the count toward 20.**

---

## 3. Fact vs synthesis — structural separation

The supplied table mixes company evidence with Omnivyra scoring output in a single row. The freeze **separates them into distinct objects** so they cannot be conflated:

| `sourceFacts` — may be treated as source-supported | `derivedIntelligence` — SYNTHESIS, never a company fact |
|---|---|
| name · industry · city · revenue evidence (verbatim) · growth signal (verbatim) · identified people · source provenance | Fit · Need · Intent · Persona score · Evidence score · Total · Priority · Recommended Channel · Outreach Angle |

`raina12GroundingFacts()` — the projection a grounded arm could legitimately consume — **excludes all synthesis**, test-enforced.

### 3.1 Persona classification (§5)

Per §5, primary persona is synthesis unless the source explicitly identifies the person.

| Status | Companies |
|---|---|
| Source-identified person(s) | 10 of 12 |
| **No identified person — persona is synthesis** | **TAUTMORE, Sensivision Health Technologies** |
| Unresolved `— verify` role slots recorded as synthesis | 7 companies, 9 slots total |

No `— verify` placeholder was resolved into a name.

---

## 4. Revenue integrity audit

Every revenue claim classified per §6. **No prohibited transformation was performed.**

| Classification | Claims |
|---|---|
| VERIFIED SOURCE FACT | **3** |
| REPORTED FACT | 8 |
| TARGET / PROJECTION | **8** |
| RUN-RATE | 1 |
| ORDER BOOK | 1 |
| NOT AVAILABLE FROM SOURCE | 1 |

### 4.1 Transformations explicitly NOT made

| Prohibited | Company | Held as |
|---|---|---|
| ₹10 Cr FY26 target → revenue | Tensech | TARGET / PROJECTION |
| ₹20 Cr FY27 target → revenue | Dreamtime | TARGET / PROJECTION |
| ₹20 Cr+ 2026 projection → revenue | TAUTMORE | TARGET / PROJECTION |
| ₹18–20 Cr annualised target → revenue | Kruu | TARGET / PROJECTION |
| ₹4 Cr→₹20–30 Cr → revenue | Sensivision | TARGET / PROJECTION |
| ₹3–5 Cr **monthly** run-rate → annual revenue | Vector Technics | RUN-RATE (not annualised) |
| ₹40 Cr order book → revenue | Vector Technics | ORDER BOOK |
| ₹10 Cr 2025 target → revenue | Hummingbird | TARGET / PROJECTION |
| ₹100 Cr 2026 ambition → revenue | NXTFACE | TARGET / PROJECTION |
| ₹80–90 Cr current-year expectation → revenue | MrMed | TARGET / PROJECTION |

### 4.2 🚩 Three companies have NO actual revenue figure

**Sensivision Health Technologies · Vector Technics · Hummingbird Consulting**

These must **never** be described as having revenue of the magnitude their evidence strings mention. Vector Technics in particular has a ₹40 Cr order book and a ₹3–5 Cr monthly run-rate but **no stated annual revenue**.

### 4.3 🚩 Five verbatim strings mix actual and forward measures

Tensech · Dreamtime · TAUTMORE · Kruu · NXTFACE. Quoting any of these strings **whole** could imply revenue that is not established. When surfaced anywhere, the actual and forward components must be split.

### 4.4 Strongest evidence

**MrMed** (₹33.5 Cr FY25, ₹23.9 Cr FY24 — Inc42 third-party financial coverage) and **Yoho** (₹17 Cr+ FY24 — Inc42 + Dealroom) are the only companies with third-party-verified figures.

---

## 5. Independence — nine-point verification (§7)

Certification was **not** inferred from the dataset's existence.

| # | Requirement | Status | Basis |
|--:|---|---|---|
| 1 | Independently selected | **PARTIALLY VERIFIED** | Corpus supplied by Raina and mechanically disjoint from agent-authored work; no signed selection statement |
| 2 | Independently researched | **PARTIALLY VERIFIED** | 12/12 carry external third-party citations (YourStory, Inc42, CEO Insider, Business India, Times of India, eChai, Dealroom, CB Insights); no signed research statement |
| 3 | Independently prepared/verified | **PARTIALLY VERIFIED** | Preparation is evident; **3 companies carry the author's own unresolved "re-verify before final experimental freeze" instruction** |
| 4 | **Not derived from the DT-C3 synthetic 22** | **VERIFIED** | Machine-verified: zero name overlap, zero industry overlap. DT-C3 names are invented single-word brands; these are real firms with real citations |
| 5 | No access to U1 grounded outputs | **VERIFIED** | Access impossible — **zero U1 outputs have ever been generated** (programme state, not attestation) |
| 6 | No access to U1 ungrounded outputs | **VERIFIED** | Same basis |
| 7 | No access to U1 scores/results | **VERIFIED** | Same basis — no scored run has ever occurred |
| 8 | Not constructed for a favourable U1 result | **PARTIALLY VERIFIED** | Structural evidence is good: the corpus was built for **lead generation** (Fit/Need/Intent/Priority/Outreach Angle), a purpose unrelated to U1. No signed attestation |
| 9 | Finalised before U1 execution | **VERIFIED** | U1 has never executed |

**5 VERIFIED · 4 PARTIALLY VERIFIED · 0 NOT VERIFIED.**

Items 1, 2, 3 and 8 are PARTIAL for one reason: **no signed nine-point certification statement was supplied** alongside the data. The dataset arrived; the certification did not. Items 5–7 are VERIFIED on the stronger basis that the artefacts they concern **do not exist**.

---

## 6. 🚩 Unresolved pre-freeze instructions from the source author

Three companies carry Raina's **own** instruction to re-verify **before** the experimental freeze:

| Company | Verbatim instruction | Status |
|---|---|---|
| Secure IT Simply | "re-verify revenue and current expansion evidence before final experimental freeze" | ❌ **NOT PERFORMED** |
| TAUTMORE | "founder, revenue and school-count evidence should be independently re-verified" | ❌ **NOT PERFORMED** |
| Sensivision | "revenue evidence requires re-verification" | ❌ **NOT PERFORMED** |

DT-C4B §3 forbids the agent from conducting new research, so these **cannot** be closed by me. They are a condition the source author set and which remains open at freeze time. **This is the single largest gap in the freeze.**

---

## 7. Semantic distinctness

| Layer | Result |
|---|---|
| Machine non-duplication | ✅ **PASS** — 0 duplicate names, 0 duplicate slugs, 0 copied fact bundles, 0 alias/containment warnings |
| Subsidiary / same-business-twice | ✅ None found. Three EdTech firms (Dreamtime, TAUTMORE, Kruu) are distinct businesses in distinct cities with distinct models; two IT-services firms and two D2C firms likewise |
| **Human semantic certification** | ❌ **NOT VERIFIED** — no Raina semantic review was supplied |

> **Machine string comparison establishes non-duplication; it does not establish semantic uniqueness.**

No human certification was manufactured.

---

## 8. 🚩 Grounding-field coverage — the corpus is a prospect list

**This is the most consequential finding of the freeze.**

| Field | Populated |
|---|---|
| `name` | **12 / 12** |
| `industry` | **12 / 12** |
| `growth_priorities` (via growth signal) | **12 / 12** |
| `products_services` | **0 / 12** |
| `products_services_list` | **0 / 12** |
| `unique_value` | **0 / 12** |
| `ideal_customer_profile` | **0 / 12** |
| `target_audience` | **0 / 12** |
| `target_audience_list` | **0 / 12** |
| `pain_symptoms` | **0 / 12** |
| `competitive_advantages` | **0 / 12** |
| `brand_positioning` | **0 / 12** |
| `brand_voice` | **0 / 12** |
| `content_themes` | **0 / 12** |
| `content_themes_list` | **0 / 12** |

**3 of 15 grounding fields are populated. Twelve are absent entirely.**

The U1 workloads consume exactly those twelve absent fields. On this corpus the grounded arm could inject little more than *"Company X, an EdTech firm in Chennai, expanding into East Africa"* — while the ungrounded arm injects nothing. The delta between arms is therefore **far smaller than on the v2 corpus**, which materially **reduces the instrument's power to detect a grounding effect** and raises the risk of an INCONCLUSIVE result under u1-001's own rules.

**These fields must NOT be filled in** — not by the agent, not by inference, not by new research. Doing so would destroy exactly the independence that makes this corpus valuable. The sparsity is recorded as a limitation, not remedied.

### 8.1 The genuine trade-off, stated plainly

| Corpus | Independence | Grounding richness |
|---|---|---|
| `u1Dataset.v2` (22 synthetic) | ❌ agent-authored | ✅ all 15 fields |
| **`u1Dataset.raina12` (12 real)** | ✅ **externally sourced** | ❌ **3 of 15 fields** |

Neither corpus is currently sufficient on its own. v2 fails on provenance; raina12 fails on instrument strength.

---

## 9. Sealing

| Field | Value |
|---|---|
| Serialization | Deterministic — stable key order, fixed record order, no clock, no RNG |
| Hash | SHA-256 over the serialised corpus |
| Value | `1521c379d5b1818a11befc1dabe56e37c44d11048407af12a56a610fd94ef8cd` |
| Bytes | 20,302 |
| Reproducible | ✅ verified across independent runs |
| Seal artifact | `backend/evaluation/canonicalGrounding/artifacts/u1-dataset-raina12.seal.json` (gitignored, regenerable) |
| Audit result | **0 errors**, 13 warnings, 7 info |

**Immutability:** any content change requires a new dataset version, a new SHA-256, a new protocol version and a documented reason. The original supplied material was not modified; DT-C3's dataset was not modified; `u1-001` was not overwritten.

Regenerate:
```bash
npx tsx backend/evaluation/canonicalGrounding/sealRaina12.ts --verify
```

---

## 10. Protocol binding — `u1-004`

| | |
|---|---|
| Version | `u1-004`, fingerprint `884148fd`, supersedes `u1-003` |
| Bound dataset | `canonicalGrounding.u1Dataset.raina12` @ `1521c379…` |
| Paired units | **156** (12 × 13) |

**No U1 acceptance criterion changed.** The criteria are *imported* from `u1Protocol.ts` — the same frozen objects, not copies — and a test asserts object identity. Verified unchanged: 50% minimum relative reduction · ≥90% valid-pair · Krippendorff α ≥0.67 · ≥2 raters · primary endpoint `M-P1-unsupported-claim-rate` · exclusion rules · blinded human rating · clustered analysis · exploratory/non-confirmatory status · falsification condition.

**Mandatory count disclosure, recorded verbatim in the protocol:**

> This 12-company corpus is an independently sourced candidate ground-truth corpus but contains fewer companies than the original internal target of ≥20. The reduced size is intentional and reflects preservation of provenance and experimental integrity rather than dataset expansion.

**Twelve companies does NOT satisfy the ≥20 target, and no such claim is made.**

Clustering note: 12 clusters is **fewer** than v2's 22, so the independence violation is *more* severe, not less. Confidence intervals remain unreported.

---

## 11. Evidence rung

| Field | Value |
|---|---|
| **Current U1 evidence rung** | **Rung 1 — engineering proof** |
| Attainable ceiling under `u1-004` | **Rung 4** (up from Rung 2 under v2) |

Per §11, explicitly: independent dataset construction does not prove grounding efficacy · semantic distinctness does not prove U1 · source provenance does not prove model truthfulness · **freezing a corpus is not experiment execution**.

The ceiling rises above v2's Rung 2 because the ground truth is externally sourced. It stops short of Rung 6 because three companies carry unresolved re-verification requests, no signed nine-point certification exists, and semantic distinctness is uncertified.

---

## 12. Statement of non-execution

| | |
|---|---|
| U1 executed | **NO** |
| Model outputs generated | **NO** |
| OpenAI / Anthropic / any provider called | **NO** |
| Network requests | **NO** |
| Web research performed | **NO** |
| Facts authored / inferred / repaired by the agent | **NONE** |
| Credentials inspected | **NONE** |

---

*End of `DEEPTECH_U1_DATASET_12_FREEZE_001`. Dataset `canonicalGrounding.u1Dataset.raina12` @ `1521c379…d94ef8cd`, protocol `u1-004` @ `884148fd`, repository SHA `82754497e8f9b64a893319e863941ad2994fd9b7`. No results are included because none exist.*
