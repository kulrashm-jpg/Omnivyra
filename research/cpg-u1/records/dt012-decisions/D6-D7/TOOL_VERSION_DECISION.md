# D-6 — TOOL_VERSION: the canonical version string and its chain

**CLASSIFICATION: PREPARATION / READ-ONLY.** Nothing was edited, committed, pushed, registered or
broadcast. **No write was made under `C:/tmp/dt009-merge`** — a 404-mutant certification run is live
against that tree and `README.md` / `cpg_u1_data.mjs` are two of its 594 files. No mutation suite, no
selftest, no aggregate recomputation was run. Every finding below comes from `grep`, `sed -n`, `find`
and `git`.

Verified independently this wave (not ratified from wave 011):

| Tree | Files (counted this wave) | Aggregate (from the directive; **not** recomputed) |
|---|---|---|
| Candidate | `C:/tmp/dt009-merge/tooling` = **594** | `638d68e6085d6894355a6d14ff2628a2e94c657c795a3d795500dbb3fa278fd2` |
| Superseded | `C:/tmp/dt002/research/cpg-u1/tooling` = **593** | `f7699f05495f72379903b00195bf44271bbdc75c66cac3185ed0dbb04e5cc5dd` |
| In-repo trap | `<worktree>/research/cpg-u1/tooling` = **587** (`git ls-files` 587; on disk 587) | `640510782a08a1ef2c1defd998f33b0ab0f14307557f7e70534bb3d8e45b613f` |

Protocol `c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719` — read only, unchanged.

---

## 1. The four wordings are three axes — CONFIRMED by re-measurement

| Axis | Wording | Recorded at | Verification |
|---|---|---|---|
| **Governance generation** | "tooling **v4**" (CPG-043) | `CPG_U1_PROTOCOL_004.md:18, :25, :953, :1098` | read verbatim; the protocol never says v5 or v6 — `grep 'tooling v5\|tooling v6\|tooling-6'` over the protocol returns **0 hits** |
| **Package identity** | `cpg-u1-data-tooling-6` | `cpg_u1_data.mjs:49` | `const TOOL_VERSION = 'cpg-u1-data-tooling-6';` |
| **README feature generations** | "v6" / "additions in v4" / "(v5)" / "(v5.1)" | `README.md:1, :89, :208, :218–222, :224` | present |

`CPG_U1_PROTOCOL_004.md:25`, verbatim, is the decisive text:

> `| Governed tooling | tooling v4: cpg_u1_data.mjs + lib/* + rules/development_only_registry.json + vendored @noble/curves 1.9.7 / @noble/hashes 1.8.0. Its aggregate SHA-256 is bound in the registration record (tooling_aggregate_sha256), not in this file |`

The protocol names a governed *generation* and then **declines to bind any version string**, delegating
identity to the aggregate in the registration record. "v4" and "tooling-6" are therefore not two values
of one field; requiring them to be equal is a category error the protocol itself forecloses.

## 2. `TOOL_VERSION` is pinned nowhere — CONFIRMED at six independent points

| Where a pin would live | Result |
|---|---|
| `PROTOCOL_MARKERS` (`cpg_u1_data.mjs:321–323`) | **absent.** The 20 markers are `PROTOCOL_VERSION`, `STUDY_ID`, `D = 6`, `K = 12`, `180 days`, `Δ = 3 h`, `30 days`, `QUICKNET.hash`, `bls-unchained-g1-rfc9380`, `SEED_DOMAIN`, `cpg-u1-commitment-digest/v1`, `PAYLOAD_SCHEMA`, `OSF Registries`, `STUDY_OPERATOR`, `UNASSIGNED`, `cpg-u1-rater-order/v1`, `cpg-u1-execution-authorization/v1`, `E ≥ 126 / 52 / 32`, `CITED_URL_RULE`, `EVALUATION_TREE_DOMAIN` |
| `registrationTemplate` (`lib/registration.mjs:33–57`) | **no tool-version key** — read field by field |
| `SAMPLING_FIELDS` (`lib/registration.mjs:119`) | `protocol_sha256, tooling_aggregate_sha256, registry_sha256, network, outpoints, checkpoint, parameters` — **no version string** |
| any module under `lib/` | `grep -rn 'TOOL_VERSION\|cpg-u1-data-tooling' lib/` → **0 hits** |
| any test under `test/` | `grep -rn 'TOOL_VERSION\|cpg-u1-data-tooling' test/` → **0 hits** |
| the `tool:` stamps it writes (`:289, :457, :484, :552, :629`) | written, never read back by any checker |

Calibration contrast: `PROTOCOL_VERSION` **is** pinned — declared `lib/registration.mjs:9`, stamped
`:37`, enforced in `checkRegistration`, and required in the protocol text as `PROTOCOL_MARKERS[0]`.
`TOOL_VERSION` has no equivalent at any of those four points.

---

## 3. THE CANONICAL HUMAN-READABLE VERSION STRING

> ## CPG-U1 dataset tooling **v6** (`cpg-u1-data-tooling-6`)

Short form for prose, to be used verbatim and without variation:

> **tooling v6 (`cpg-u1-data-tooling-6`), aggregate `<NEW_AGG>`, `<NEW_N>` files**

The placeholders are deliberate. The final aggregate is **not** `638d68e6…`: the D-7 README corrections
are in-tree and move it. No provisional digest is pasted anywhere in this package.

Chosen over "v4" because: (a) it is what the instrument reports at runtime and stamps into every artefact
it writes, so any other choice creates a *fifth* terminology that contradicts artefacts already produced;
(b) it is already the label used throughout the registration package, so adopting it requires no
rewording, only the hash/count correction that is needed anyway; (c) it cannot be "v4" without editing
the frozen protocol (prohibited) or the constant (aggregate-moving, and it would contradict the stamps).

## 4. The full chain: source tree → tooling aggregate → registration package

| Link | Mechanism | **Where the link is recorded** | Enforced? |
|---|---|---|---|
| 1. source tree → per-file manifest | `toolingManifest(ROOT)` walks every file and emits `"<sha256>  <path>\n"` sorted by path | `lib/aggregate.mjs` — the only implementation; recipe restated at `README.md:280` and protocol §19.1 / §24 | — |
| 2. manifest → aggregate | sha256 of the concatenated manifest text, vendored deps included | `lib/aggregate.mjs`; **594 files** in the candidate tree | — |
| 3. aggregate → registration field | `cmdRegistrationFields` sets `tooling_aggregate_sha256 = toolingManifest(ROOT).aggregate` | `cpg_u1_data.mjs` `cmdRegistrationFields`; `registrationTemplate({ toolingAggregate })` at `lib/registration.mjs:38` | — |
| 4. registration field → the one authoritative identity | `tooling_aggregate_sha256` is a **sampling field**; a second registration with different sampling fields voids the study | `lib/registration.mjs:119` (`SAMPLING_FIELDS`), `:120` (`samplingView`), the `authority_rule` string in `registrationTemplate` | **YES** — `checkAuthority` |
| 5. registered identity → the running tree | refuses if the live tree's aggregate is not the registered value | `cpg_u1_data.mjs:180` `VERIFY_ABORT_HASH_MISMATCH`; `lib/harness.mjs:44` `TOOLING_MISMATCH` | **YES — fails closed** |
| 6. registered identity → every artefact | `tooling_aggregate_sha256` is inside `PAYLOAD_KEYS`, hence covered by the committed digest; also in both manifests, the seal and the authorization | `lib/commitment.mjs:11`; `cpg_u1_data.mjs:458`, `:553`, `:630`; `lib/execution.mjs:65` | **YES** |
| 7. human label → the chain | the canonical string of §3, carried as prose beside the aggregate | registration narrative; `REGISTRATION_PACKAGE.md` §5 and `OPERATOR_CHECKLIST.md` §0.2 (already drafted). **Not** in the README, which cannot state its own aggregate | no — label only, by design |

**The mapping is unambiguous because exactly one aggregate is ever registered for `CPG-U1-2026-01`.**
Links 4–6 are enforced in code; the version string hangs off link 7, which is exactly why it can be
settled by disclosure rather than by making two labels equal.

**Chain defect found, still open.** D-6 cannot claim the chain is intact without stating this: links 3–4
are currently populated with the **superseded** value. `registration/registration_record.DRAFT.json` and
`registration/registration_fields.TEMPLATE.json` both carry
`tooling_aggregate_sha256 = f7699f05…`, and four `instrument.mjs` gateways pin it in code. See
`STALE_IDENTITY_CORRECTION_MANIFEST.md`. Ordering matters: the in-tree README edits land **first**, then
one recomputation, then the paperwork is renumbered to that value — otherwise the package desyncs twice.

## 5. DOES D-6 MOVE THE AGGREGATE? — **NO**

Closing D-6 is **documentary only**. It requires **no change to `cpg_u1_data.mjs:49`**, and it must not
make one. `TOOL_VERSION` is unpinned at all six places a pin could live (§2), so editing the constant
would move the aggregate — forcing a fresh registration identity and a re-run of certification — while
closing no verification gap and contradicting every `tool:` stamp already written in rehearsal.

The one optional item that *would* move the aggregate is the README "v4 vs v6" disambiguation line. That
belongs to D-7 and to the single final in-tree edit session, not to D-6.

## 6. This is a DISCLOSURE, not an amendment — stated explicitly

Protocol-004 is **not** to be modified. Its "v4" is a different axis, and the protocol's own
governed-tooling row already supplies the resolution by binding identity to the aggregate "not in this
file". Editing a frozen protocol to make terminology prettier would change `protocol_sha256` and destroy
the one value the whole chain is anchored to. **The answer is a disclosure.**

---

## 7. NINE-FIELD RETURN — D-6

**DECISION.** The canonical human-readable version string is **CPG-U1 dataset tooling v6
(`cpg-u1-data-tooling-6`)**, identified by `tooling_aggregate_sha256` = `<NEW_AGG>` over `<NEW_N>` files.
The protocol's "tooling v4", the package identity `cpg-u1-data-tooling-6` and the README's v3–v6 feature
headings are **three different axes**, not three values of one field. Closing D-6 is **documentary**: no
change to `cpg_u1_data.mjs:49`, and no change to Protocol-004.

**RECOMMENDED RULE.** *A version string is a label; the tooling aggregate is the identity.* Wherever the
divergence could confuse a reader, carry this sentence verbatim: "Protocol-004 names its governed tooling
generation 'tooling v4' (CPG-043). The instrument implementing that generation reports
`TOOL_VERSION = 'cpg-u1-data-tooling-6'` and is identified — by the protocol's own governed-tooling row,
which states that the aggregate 'is bound in the registration record …, not in this file' — solely by
`tooling_aggregate_sha256`. The version strings are labels; the aggregate is the identity."

**ALTERNATIVES CONSIDERED.** (1) Rename the constant to `cpg-u1-data-tooling-4` to match the protocol —
**rejected**: aggregate-moving, and it would contradict the `tool:` stamps in every artefact already
produced, creating a fifth terminology. (2) Amend Protocol-004's "v4" to "v6" — **rejected and
prohibited**: it changes `protocol_sha256 c50fc680…`, the anchor of the entire chain, purely for
cosmetics. (3) Add `tool_version` to `registrationTemplate` / `SAMPLING_FIELDS` so the label becomes
enforceable — **rejected**: it adds a second identity that can disagree with the aggregate, weakening the
single-identity property the authority rule depends on. (4) Renumber the README's v3–v6 headings —
**rejected**: rewrites history. (5) Say nothing and let readers reconcile it — **rejected**: the
divergence is the single most confusing item in the package.

**SCIENTIFIC / INTEGRITY EFFECT.** Positive and purely clarifying. No measurement, threshold, decision
rule, seed derivation or refusal changes. It removes a reading under which a verifier concludes either
that the README contradicts the protocol or that v5/v6 are ungoverned. It also states the epistemic
status honestly: the divergence is **disclosed, not fixed**.

**REGISTRATION EFFECT.** The canonical label is carried as prose in the registration narrative and in
`REGISTRATION_PACKAGE.md` §5 / `OPERATOR_CHECKLIST.md` §0.2. **No registration field changes**: there is
no tool-version field to populate. The registration-blocking item is separate and already known —
`registration_record.DRAFT.json` and `registration_fields.TEMPLATE.json` still carry the superseded
`tooling_aggregate_sha256`, which must be set to the post-README-session value before registration.

**MUTATION EFFECT.** **None.** `TOOL_VERSION` is not asserted by `test/selftest.mjs`, `test/mutate.mjs` or
`test/adapter_conformance.mjs` (0 hits), so no mutant tests it and the 404-mutant kill set is unaffected.
The live run is not invalidated and need not be restarted. Had the constant been changed, every mutant
would have had to be re-run against a new aggregate.

**PROTOCOL EFFECT.** **NONE — and this is a decision, not an oversight.** Protocol-004 is frozen at
`c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719`. Its "v4" is a different axis and its
own governed-tooling row already supplies the resolution. **No amendment is proposed or required.**

**OWNER APPROVAL REQUIRED?** **NO** for the decision and the rule — they only adopt the position already
drafted in the registration package and change no protocol, no constant and no registration field.
**YES** for one optional item that is not part of D-6: the README "v4 vs v6" disambiguation line, which is
in-tree and therefore aggregate-moving. It belongs to the D-7 edit session.

**EXACT WORDING TO RECORD.**

> **D-6 — TOOL_VERSION: CLOSED BY DISCLOSURE.** The canonical human-readable identity of the instrument
> is **CPG-U1 dataset tooling v6 (`cpg-u1-data-tooling-6`)**, whose authoritative identity is
> `tooling_aggregate_sha256 = <NEW_AGG>` over `<NEW_N>` files, recorded in the registration record and
> nowhere else. Protocol-004 names the governed *generation* "tooling v4 (CPG-043)"; `cpg_u1_data.mjs:49`
> declares the *package* identity `cpg-u1-data-tooling-6`; the README's v3–v6 headings are *feature
> generations of this package*. These are three axes, not three values of one field, and Protocol-004
> forecloses any attempt to unify them: its governed-tooling row states that the aggregate "is bound in
> the registration record (`tooling_aggregate_sha256`), **not in this file**". `TOOL_VERSION` is pinned
> nowhere — it is absent from `PROTOCOL_MARKERS`, from `registrationTemplate`, from `SAMPLING_FIELDS`,
> from every module under `lib/` and from every test; the `tool:` fields it stamps are never read back.
> It is therefore **not changed**, and Protocol-004 is **not amended**. The divergence is disclosed in the
> registration package and in the README, and is not reconciled. **Closing D-6 does not move the tooling
> aggregate.**
