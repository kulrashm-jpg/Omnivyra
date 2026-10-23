# TOOL_VERSION closure — DEEPTECH-PARALLEL-011 identity stream (directive §7)

**Status: PREPARED — NOTHING APPLIED.** No file under `C:/tmp/dt009-merge` was written.
Candidate inspected read-only: `C:/tmp/dt009-merge/tooling`, 594 files, aggregate
`638d68e6085d6894355a6d14ff2628a2e94c657c795a3d795500dbb3fa278fd2` (recomputed independently this wave).
Protocol `c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719` — unchanged, not touched.

---

## 1. The four terminologies that disagree

| # | Wording | Where it is recorded | Mutable? |
|---|---|---|---|
| A | `cpg-u1-data-tooling-6` | `tooling/cpg_u1_data.mjs:49` — `const TOOL_VERSION = 'cpg-u1-data-tooling-6';` | inside the aggregate |
| B | "v6" / "additions in v4" / "(v5)" / "(v5.1)" section headings | `tooling/README.md:1`, `:89`, `:208`, `:218`–`:222`, `:224` | inside the aggregate |
| C | "tooling **v4**" | `CPG_U1_PROTOCOL_004.md:18`, `:25`, `:953`, `:1098` | **FROZEN — must never be edited** |
| D | "tooling v6, aggregate `f7699f05…`" | 35 files under `C:/tmp/dt004-operations` (registration package + role packets + tools) | outside the aggregate |

These are **three different axes**, not three values of one field:

- **C is a governance generation.** Protocol-004 §1 line 18 says it "governs the dataset tooling v4
  (CPG-043)"; §2 line 25 names the governed tooling as `cpg_u1_data.mjs` + `lib/*` +
  `rules/development_only_registry.json` + the vendored `@noble` packages, and then states that its
  **aggregate SHA-256 "is bound in the registration record (`tooling_aggregate_sha256`), not in this
  file"**. §953 records CPG-042 approvals as "implemented in protocol-004 and tooling v4". §1098 closes
  "IMPLEMENTED (tooling v4)". "v4" is the CPG-043 generation label of the governed instrument.
- **A is the package identity of the implementation** that satisfies that generation. It has advanced
  to `-6` through CPG-044 (harness), v5.1 (cited URLs) and DEEPTECH-PARALLEL-002 (v6) **without any
  change of governing protocol**.
- **B are feature-generation headings of the package** — "additions in v4" at README:208 means *the
  fourth generation of this README's feature tables*, which is a different "v4" from the protocol's.
  This is the single most confusing item in the tree.
- **D is stale metadata**, not a fourth terminology: it names the correct label ("tooling v6") against
  the **superseded** aggregate `f7699f05…` / 593 files. See §5.

**The protocol deliberately declines to bind a version string.** That is the closure key: the one
identity Protocol-004 recognises is `tooling_aggregate_sha256`. Any reading in which "v4" and
"tooling-6" must be made equal is a category error the protocol itself forecloses.

---

## 2. THE ONE CANONICAL HUMAN-READABLE LABEL

> ### CPG-U1 dataset tooling **v6** (`cpg-u1-data-tooling-6`) — aggregate `638d68e6085d6894355a6d14ff2628a2e94c657c795a3d795500dbb3fa278fd2`, 594 files

Short form for prose, to be used verbatim and without variation:

> **tooling v6 (`cpg-u1-data-tooling-6`), aggregate `638d68e6…78fd2`**

And **one standing reconciliation sentence**, to be reused verbatim wherever the divergence could
confuse a reader:

> Protocol-004 names its governed tooling generation "tooling v4" (CPG-043). The instrument that
> implements that generation reports `TOOL_VERSION = 'cpg-u1-data-tooling-6'` and is identified — by
> the protocol's own governed-tooling row and §19.1 — solely by
> `tooling_aggregate_sha256 = 638d68e6085d6894355a6d14ff2628a2e94c657c795a3d795500dbb3fa278fd2`
> (594 files). The version strings are labels; the aggregate is the identity.

Rationale for choosing "v6 / `cpg-u1-data-tooling-6`" over "v4":

1. It is what the instrument **actually reports at runtime** (`cpg_u1_data.mjs:49`) and what it stamps
   into every artefact it writes (`tool:` at `:289`, `:457`, `:484`, `:552`, `:629`). A canonical label
   that contradicted the artefacts would create a fifth terminology.
2. It is already what the registration package uses ("tooling v6" in all 35 files under
   `C:/tmp/dt004-operations`), so adopting it requires **no rewording** of the operational paperwork —
   only a hash/file-count correction that is needed anyway (§5).
3. It cannot be "v4" without editing the protocol, which is prohibited, or without contradicting the
   constant, which would move the aggregate for no verification gain.
4. The prepared disclosure already takes exactly this position:
   `C:/tmp/dt004-operations/registration/REGISTRATION_PACKAGE.md:175–188` (§5 "Disclosure: the protocol
   text says 'tooling v4'") and `.../OPERATOR_CHECKLIST.md:27–36` (§0.2). **This wave adopts that
   position as canonical rather than inventing a new one.**

---

## 3. Does closing this move the aggregate? — **NO**

**Closure is purely documentary and lives in registration metadata plus documents outside the tooling
tree. It does not require changing the `TOOL_VERSION` constant, and it must not.**

| Closure action | Location | Moves aggregate? |
|---|---|---|
| Adopt the canonical label + reconciliation sentence | `C:/tmp/dt004-operations/registration/REGISTRATION_PACKAGE.md` §5, `OPERATOR_CHECKLIST.md` §0.2 (already drafted there) | **No** — outside the tree |
| Correct the aggregate/file-count in the 35 stale files | `C:/tmp/dt004-operations/**` | **No** — outside the tree |
| Record the label in the OSF registration narrative | external registry submission | **No** |
| *(optional, recommended)* a one-line "v4 vs v6" disambiguation note in the README | `tooling/README.md` | **YES** — see `README_CORRECTIONS.md` R5 |
| ~~Change `TOOL_VERSION` to `'cpg-u1-data-tooling-4'`~~ | `tooling/cpg_u1_data.mjs:49` | **YES — NOT RECOMMENDED** |

### Why changing the constant buys nothing

`TOOL_VERSION` is **not pinned, not compared and not registered anywhere**:

- **Not a protocol marker.** `PROTOCOL_MARKERS` (`cpg_u1_data.mjs:321–323`) pins `PROTOCOL_VERSION`,
  `STUDY_ID`, `D = 6`, `K = 12`, `180 days`, `Δ = 3 h`, `30 days`, the quicknet hash,
  `bls-unchained-g1-rfc9380`, `SEED_DOMAIN`, `cpg-u1-commitment-digest/v1`, `PAYLOAD_SCHEMA`,
  `OSF Registries`, `STUDY_OPERATOR`, `UNASSIGNED`, `cpg-u1-rater-order/v1`,
  `cpg-u1-execution-authorization/v1`, `E ≥ 126 / 52 / 32`, `CITED_URL_RULE` and
  `EVALUATION_TREE_DOMAIN`. **`TOOL_VERSION` is absent.** `verify-protocol` (`:325–332`) therefore
  neither requires nor forbids any tooling-version string in the protocol text.
- **Not a registration field.** `registrationTemplate` (`lib/registration.mjs:34–57`) has no
  tool-version key; `checkRegistration` (`:75–…`) never checks one; `SAMPLING_FIELDS`
  (`lib/registration.mjs:119`) is `protocol_sha256`, `tooling_aggregate_sha256`, `registry_sha256`,
  `network`, `outpoints`, `checkpoint`, `parameters` — no version string.
- **Not validated in any artefact.** The `tool:` field it stamps is never read back or compared by any
  checker (`checkPayload`, `checkAuthorization`, `harness.mjs`, `evaluation.mjs`, `analysis.mjs` all
  ignore it). It is a human label.
- **Not asserted by any test.** No occurrence of `TOOL_VERSION` or `cpg-u1-data-tooling` in
  `test/selftest.mjs`, `test/mutate.mjs` or `test/adapter_conformance.mjs`.

Contrast: `PROTOCOL_VERSION` **is** a pinned literal — `lib/registration.mjs:9`
(`export const PROTOCOL_VERSION = 'CPG_U1_PROTOCOL_004';`), stamped at `:37`, **enforced** at `:77`
(`protocol_version must be CPG_U1_PROTOCOL_004`) and required to appear in the protocol text via
`PROTOCOL_MARKERS[0]` at `cpg_u1_data.mjs:321`. **`TOOL_VERSION` has no equivalent pin anywhere.**

So editing the constant would move the aggregate (forcing a new registration identity and a re-run of
certification), would contradict every artefact already produced in rehearsal, and would close no
verification gap. **Recommendation: do not touch `cpg_u1_data.mjs:49`.**

---

## 4. Is the ambiguity genuinely closed by documentation alone? — **YES**

A reader who holds the registration package can answer "which instrument produced this?" with one
value, for three independent reasons:

1. **Exactly one aggregate is ever registered** for `CPG-U1-2026-01`. `tooling_aggregate_sha256` is a
   sampling field (`lib/registration.mjs:119`); the authority rule
   (`lib/registration.mjs:54`, `checkAuthority`) voids the study if a second registration carries
   different sampling fields. There is no second candidate answer to disambiguate from.
2. **The aggregate is enforced, not merely stated.** `cpg_u1_data.mjs:180` aborts with
   `VERIFY_ABORT_HASH_MISMATCH` and `lib/harness.mjs:44` refuses with `TOOLING_MISMATCH` if the running
   tree is not the registered tree. A wrong-instrument claim fails closed.
3. **Every artefact carries the aggregate, not just the label.** `PAYLOAD_KEYS`
   (`lib/commitment.mjs:11`) puts `tooling_aggregate_sha256` inside the on-chain-committed digest;
   manifests (`cpg_u1_data.mjs:458`, `:553`), the seal (`:630`) and the authorization
   (`lib/execution.mjs:65`) all carry it.

The residual ambiguity is **not** in the tooling — it is the 35 stale documents in §5, all outside the
aggregate. **This is closable before the final edit session and is not an owner decision.**

The one thing that *is* an owner call: whether to also add the optional README disambiguation line
(R5). It improves the standalone readability of the registration package but **moves the aggregate**,
so it can only be done in the final edit session together with the other README corrections.

---

## 5. The aggregate → metadata link is currently BROKEN in the registration package

35 files under `C:/tmp/dt004-operations` cite the **superseded** aggregate
`f7699f05495f72379903b00195bf44271bbdc75c66cac3185ed0dbb04e5cc5dd` with **593 files**. Verified this
wave by recomputation: `C:/tmp/dt002/research/cpg-u1/tooling` = 593 files = `f7699f05…` exactly, so
the citations were correct when written and are now stale.

Load-bearing instances:

| File | Line | Content |
|---|---|---|
| `registration/registration_record.DRAFT.json` | — | `tooling_aggregate_sha256` = `f7699f05…` |
| `registration/registration_fields.TEMPLATE.json` | — | same |
| `registration/REGISTRATION_PACKAGE.md` | 20 | identity table, "593 files … **VERIFIED**" |
| `registration/REGISTRATION_RECORD_NOTES.md` | 53 | "593 regular files … **VERIFIED**" |
| `registration/OPERATOR_CHECKLIST.md` | 9 | "593 files" |
| `registration/DR1_DRAND_RELAY_FLOOR_MEMO.md` | 8, 365 | "593 files — recomputed in this wave" |
| `registration/DR2_CERTENV_WORDING_MEMO.md` | 11 | "593 files" |
| `execution/DETERMINISTIC_EXECUTION_PACKAGING.md` | 9, 169 | "593 files", "any byte changed anywhere in the 593 tooling files" |
| `execution/EXECUTION_READINESS.md` | 9 | "593 files, recomputed after every run below" |
| `people/*.md` (7 files) | ~7–10 | role packets: "Instrument: tooling v6, aggregate `f7699f05…`" |
| `*/tools/instrument.mjs` (4 files) | — | the read-only instrument gateways pin `f7699f05…` in code |

**What moved 593 → 594** (verified by manifest diff against `C:/tmp/dt002/research/cpg-u1/tooling`):

- **added:** `lib/enumeration.mjs` (§4A.2 enumeration attribution — the only new file)
- **content changed:** `README.md`, `cpg_u1_data.mjs`, `lib/evidenceBundle.mjs`, `lib/sampling.mjs`
  (DR-1 relay floor), `test/mutate.mjs`, `test/selftest.mjs`
- **unchanged:** `rules/analysis_decisions.json` — sha `a1a1a8c8d93c4eb0377ea7f01ec9f22842902831d39a21f86d42bbcee2b1c5be`
  in *both* trees. The AD-1…AD-9 decisions were already recorded at `f7699f05…`; they are **not** what
  moved the aggregate.

So the delta is exactly **DR-1 (relay attribution floor) + §4A.2 enumeration attribution**. That is the
sentence the registration narrative should carry.

**Prepared correction (apply outside the tooling tree; does NOT move the aggregate):** in all 35 files,
`f7699f05495f72379903b00195bf44271bbdc75c66cac3185ed0dbb04e5cc5dd` → `638d68e6085d6894355a6d14ff2628a2e94c657c795a3d795500dbb3fa278fd2`
and `593 files` → `594 files`, with every "**VERIFIED** (recomputed…)" claim re-attested against the new
value (this wave's recomputation supports the new value; the old attestations must not simply be
relabelled). **The four `instrument.mjs` gateways pin the hash in code and will refuse until updated.**

> **Caution — ordering.** The README corrections in `README_CORRECTIONS.md` move the aggregate again.
> Do not renumber the 35 documents to `638d68e6…` until the README/EVIDENCE_SCHEMA edit session is
> closed and the **final** aggregate is recomputed, or the paperwork will desync a second time.
> Correct sequence: (1) final in-tree edit session → (2) recompute aggregate → (3) update the 35
> documents to that value → (4) register.

---

## 6. Answers to the directive's explicit questions

- **One canonical label?** `CPG-U1 dataset tooling v6 (cpg-u1-data-tooling-6), aggregate 638d68e6…78fd2, 594 files`.
- **Requires changing `TOOL_VERSION`?** **No.** Documentation + registration metadata only.
- **Prefer the non-aggregate-moving option — does it genuinely close the ambiguity?** **Yes**, for the
  reasons in §4. The protocol itself makes the aggregate the identity and refuses to bind a version
  string, so the divergence is disclosable, not reconcilable, and disclosure is complete.
- **Is `TOOL_VERSION` pinned anywhere?** **No.** Only `PROTOCOL_VERSION` is pinned
  (`lib/registration.mjs:9`, enforced `:77`, markers `cpg_u1_data.mjs:321–323`). `TOOL_VERSION`
  (`cpg_u1_data.mjs:49`) is stamped into artefacts and never read back.
- **Does closing it move the aggregate?** **NO** (unless the optional README line R5 is taken, which
  does).
