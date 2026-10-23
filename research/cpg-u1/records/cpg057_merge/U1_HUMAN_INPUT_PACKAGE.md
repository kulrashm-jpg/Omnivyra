# CPG-U1 — Human input package (HP-1 … HP-8)

**Written for: the study owner and the operator (key custodian), not for engineers.**

This sheet lists every input CPG-U1 needs from a person before registration. Nothing here is drawn from my judgement — each requirement is quoted or cited from `research/cpg-u1/CPG_U1_PROTOCOL_004.md` (protocol sha256 `c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719`) or from the instrument that enforces it (aggregate `640510782a08a1ef2c1defd998f33b0ab0f14307557f7e70534bb3d8e45b613f`).

**U1 is not registered and not executed. No U1 evidence exists.** Supplying these inputs does not register anything; registration is a separate, explicitly authorized step.

## Two rules that apply to every item below

**1. Never put secret material anywhere — not in the repository, not in a chat, not in these artifacts.** The protocol never asks for a private key, seed phrase, password or credential. It asks *who* the custodian is. If any instruction here seems to ask for a secret, it is wrong and should be refused.

**2. Real identities do not go into study artifacts.** §4A.1 says the per-person record is a "restricted register; **a pseudonymous ID is used in study artifacts**". The instrument enforces this shape: `person_id` must match `[A-Za-z0-9_-]{1,64}`. So the published artifacts carry IDs like `ENUM-01`, and the mapping from ID to person lives in your restricted register, outside the repository.

A third guard worth knowing: the instrument **refuses** any human field whose value contains the string `SYNTHETIC` outside test mode (`registration.mjs:72`). Placeholders cannot be smuggled past it, which is deliberate — an unfilled field must stay visibly unfilled.

---

## HP-1 — Accountable OSF identity and persistent identifier

| | |
|---|---|
| **Required identity** | An **accountable identity** bound to the OSF Registries account that will hold the preregistration. §5.5.1 |
| **Required persistent identifier** | A **persistent identifier**, recorded as **two** values: its **type** and its **value**. The protocol does not prescribe which scheme — that is your choice to record, not mine to invent |
| **Current status** | **UNASSIGNED** — in the protocol document and in the tooling template alike |
| **Evidence required** | The identity as it will appear on the public record, and the PID type + value. No credential, password or API token |
| **Where recorded** | Registration record: `accountable_identity.value`, `persistent_identifier.type`, `persistent_identifier.value` |
| **Why it matters** | §5.5.1's authority rule is "**The earliest registration under the accountable identity with this `study_id` is authoritative.**" With no identity there is no way to resolve competing registrations, and a second registration with different sampling fields voids the study |
| **Clears** | 3 of the 10 `verify-registration` blockers |

I will not fabricate the PID, and I cannot derive it — it must be issued to you.

## HP-2 — Bitcoin wallet-key custodian

| | |
|---|---|
| **Required input** | The **identity or name of one custodian**, holding role `STUDY_OPERATOR`. That is all the protocol asks for |
| **Current status** | **UNASSIGNED** |
| **Evidence required** | The custodian's identity, and their acceptance of the role |
| **Where recorded** | Registration record: `bitcoin_key_custodian.value`. The field `bitcoin_key_custodian.role` is already fixed to `STUDY_OPERATOR` and is validated — it is not yours to change |
| **Clears** | 1 blocker, and unblocks HP-6 |

**Do NOT provide, and I will not accept or record:** a private key, a seed phrase, an xprv/xpub, a wallet file, a password, a PIN or any other secret. The tooling is deliberately **custodian-free**: it never creates, holds or spends key material. The custodian keeps all of that entirely outside this repository and outside any conversation with me.

## HP-3 — Seven independent role holders

§4A requires **seven independent roles, mutually exclusive, none held by the operator** — "**minimum 7 independent persons**". With the operator that is **8 distinct people**.

Roster structure to complete (`cpg-u1-personnel/v1`; roles are the instrument's exact strings):

| # | Role (exact value) | `person_id` | Independence basis | Declaration (7 answers, all "no") | Fee agreement SHA-256 | Organisation confirmation SHA-256 |
|---|---|---|---|---|---|---|
| — | *operator* (not independent) | `⟨UNASSIGNED⟩` | holds the keys; may hold **no** independent role | n/a | n/a | n/a |
| 1 | `enumerator` (≥ 1 permitted) | `⟨UNASSIGNED⟩` | | | | **required** |
| 2 | `reference-author` | `⟨UNASSIGNED⟩` | | | | **required** |
| 3 | `reference-confirmer` | `⟨UNASSIGNED⟩` | | | | **required** |
| 4 | `reference-adjudicator` | `⟨UNASSIGNED⟩` | | | | **required** |
| 5 | `rater-1` | `⟨UNASSIGNED⟩` | | | | **required** |
| 6 | `rater-2` | `⟨UNASSIGNED⟩` | | | | **required** |
| 7 | `rating-adjudicator` | `⟨UNASSIGNED⟩` | | | | **required** |

**I have not populated any name and will not** until you supply them.

**The seven declaration answers** (every one must be exactly `"no"` — `personnel.mjs:8-12`):

1. `employed_by_developing_organisation`
2. `contract_or_work_for_developing_organisation`
3. `payment_other_than_study_fee`
4. `financial_interest_in_developing_organisation`
5. `close_relationship_with_developer_operator_or_role_holder`
6. `implemented_cpg_protocol_tooling_or_registry`
7. `ran_or_saw_cpg_output`

**"An unknown answer is not 'no'."** (§4A.1) A person who cannot answer confidently is not eligible.

Constraints the instrument enforces, so plan the roster around them:

- every non-enumerator role is held by **exactly one** person;
- **no person holds two independent roles**;
- the **operator holds none**;
- **an enumerator may not be the reference adjudicator** (§4A `:186` — the adjudicator decides contested reference values, and the enumerator authored the class predictions whose mismatches get published);
- enumerators additionally must not have implemented CPG, the protocol, the tooling or the registry, and must not have run CPG or seen any CPG output **before completing the frame** (§4A.2 a–b).

`study_fee_agreement_sha256` may legitimately be `null` for a genuine no-fee arrangement. `organisation_confirmation_sha256` may **never** be null — see HP-4.

**Timing:** the assignment of `rater-1`, `rater-2` and `rating-adjudicator` is recorded and its SHA-256 published **before the held-out commitment transaction is broadcast** (§12.1). §19.3(3) requires each role holder before their stage, so this is a precondition, not paperwork to tidy afterwards.

## HP-4 — Developing-organisation confirmations

| | |
|---|---|
| **Organisation** | The legal entity that is "**the developing organisation**" for §4A.1. The protocol uses the term as settled; **nothing in the repository settles it** |
| **Required confirmations** | **Seven** — one per independent role holder: "the developing organisation's written confirmation that its records show no item 1–4 relationship" (§4A.1 `:143`) |
| **Items 1–4** (verbatim, §4A.1) | 1. is or was **employed** by it, in any capacity; 2. has or had any **contract, engagement or other work** (paid or unpaid) for it, other than the study engagement; 3. received any **payment or benefit** from it, other than the study fee; 4. holds **equity, options or any other financial or organisational interest** in it |
| **Evidence format** | A written confirmation per person, issued **from the organisation's records**. Its **SHA-256** goes into the personnel register as `organisation_confirmation_sha256` (64 lowercase hex). The documents themselves stay outside the repository |
| **Responsible person** | An officer of the organisation able to attest from its records — with your legal advisers as appropriate. Not the role holder, and not me |
| **Current status** | **Unestablished for the study's purposes** |

Note the asymmetry the instrument encodes (`personnel.mjs:39`): the fee agreement may be `null`, but this confirmation is **required and never nullable**. Seven confirmations must exist before the corresponding stages.

What the repository does and does not tell us, stated carefully: there is no `LICENSE`, `AUTHORS` or `NOTICE` file, and `package.json` has neither `author` nor `license`. **That is not evidence that no organisation exists** — a company can exist, employ people and keep records without ever being named in its own source repository, and a repository is not the right place to look. It does mean the repository cannot answer two questions, and only people can: **which entity** it is, and **whether it keeps the records** items 1–4 refer to, well enough to attest that none applies to each of seven people.

**I will not fabricate a confirmation, an organisation, or an attesting officer.**

## HP-5 — Frame of ≥ 210 eligible admissible rows

| | |
|---|---|
| **Minimum** | **E ≥ 126 / 52 / 32** — that is **210** admissible, held-out-eligible rows, by class: fill-expected / abstention-expected / identity-hazard (§5.7.2 `:387`) |
| **Rule** | `E_c ≥ 2 · Qmax_c + Dev_c` for each class c, "Before the development commitment" |
| **Independence** | The frame must be built by an **independent enumerator** (§4A.2). §20.18: an operator-built frame is **not independent**. **I must not build it, and neither should the operator** |
| **Uniqueness** | One row per legal entity; duplicate identifiers or duplicate canonical domains are **refused** (§5.7.1) |
| **Pool minimum** | For each stage and class the eligible admissible pool must hold **at least 2 × the quota**, "so the draw is a genuine selection rather than a hand-picked set". Verified by `pool-check`, with no randomness |
| **Evidence** | The completed frame CSV — start from `research/cpg-u1/tooling/templates/candidate_frame.template.csv`, the only frame artifact that exists today |
| **Freeze procedure** | `frame` → `scan` → `check-frame-sufficiency`; the frame hash and scan hash are then bound into the development commitment payload. If E is unmet, **no development commitment may be made** — enumeration continues first |
| **Current status** | **No frame exists.** Zero frame rows anywhere in the repository |

**Hard warning, from the protocol's own consequence table:** a development commitment against an insufficient frame is **`STAGE_VOID_FRAME_INSUFFICIENT`** — "the slot is consumed and there is no retry". Under-counting here is unrecoverable.

**Do not create synthetic companies to reach 210.** They would be inadmissible, the count would be a fiction, and the study would be void on a basis nobody could later repair. If 210 genuine rows are not reachable, that is a finding to report, not a number to manufacture.

## HP-6 — Two funded P2WPKH outputs and a checkpoint

| | |
|---|---|
| **The two outputs** | `O_dev` (development) and `O_ho` (held-out) — **distinct single-signature P2WPKH outputs**, single-use, on `bitcoin-mainnet`. Output script form `00 14` + 20 bytes. The instrument refuses identical outpoints for the two stages |
| **Funding requirement** | Each funding transaction must have **≥ D = 6 confirmations at the checkpoint**, enforced as `funding_height + 6 − 1 ≤ checkpoint_height` (§5.5.2 `:307`) |
| **Custodian** | HP-2's custodian creates and funds them (§ ordering step 0). **Nobody else, and not me** |
| **Checkpoint** | A block **at or after both funding confirmations**, recorded as `{height: integer, hash: 64 lowercase hex}` |
| **Ordering** | "**Funding confirmed (≥ 6 at the checkpoint) → registration → frame construction → development commitment**" (§5.5.1). Funding comes **before** registration |
| **Format** | Each outpoint is `"<64 lowercase hex txid>:<vout>"` |
| **Where recorded** | `outpoints.development`, `outpoints['held-out']`, `checkpoint.height`, `checkpoint.hash` |
| **Current status** | **UNASSIGNED. No funding has occurred and I make no claim that any has.** |
| **Clears** | 2 blockers; enables `check-funding-prerequisites` and `verify-archive` |

The ≥ 6 confirmations are an **external condition**: they depend on the Bitcoin network and cannot be accelerated, asserted or worked around by anyone.

**Again: no private keys.** The custodian funds the outputs; the study records only the resulting **public** outpoints and the checkpoint. If either outpoint is later spent other than as the stage commitment, or the wrong stage's outpoint is spent, the study is **VOID** (§5.5.3) — which is the point of naming them in advance.

## HP-7 — `as_of`

| | |
|---|---|
| **Required input** | **One frozen ISO-8601 UTC timestamp**, format exactly `YYYY-MM-DDTHH:MM:SSZ` (validated; a date alone is refused) |
| **Why** | §7/§19.1 — every resolver run is pinned to this single `as_of`. Choosing it after results exist would let the as-of date be selected to suit them |
| **Timing** | Chosen and fixed **before registration** |
| **Where recorded** | Registration record: `as_of` |
| **Current status** | **UNASSIGNED** |
| **Clears** | 1 blocker |

Mechanically this is one string, but substantively it is a **study parameter**, so **I have not chosen it and will not choose it for you.**

## HP-8 — Registry-issued fields

| | |
|---|---|
| `registration_id` | **Issued by the OSF registry at registration.** The persistent identifier of the record itself |
| `registration_timestamp` | **Issued by the registry at registration**, ISO-8601 UTC `YYYY-MM-DDTHH:MM:SSZ` |
| **§5.5.1, verbatim** | These are "**never asserted by the operator**" |
| **Current status** | **UNASSIGNED**, correctly |

**Neither may be fabricated or pre-populated.** They cannot exist before registration, so a record carrying values for them would be asserting that registration already happened. Two protocol consequences make this concrete: `registration_id` must not contain `"|"` (it is used in a hashed rank key), and if `registration_timestamp` is **at or after** the scheduled time of the development randomness `R_dev`, the study is **`STUDY_VOID_REGISTRATION`** — registered after the randomness existed.

There is no human action for HP-8. It is listed so that its UNASSIGNED state is understood as **correct and expected**, not as an outstanding task.

---

## Machine-derived — no human input required

```
provider_configuration_sha256 = c9a7e9aa559d8fbd49f0ae0b1ea896af40637000329c35602f81abcd53627561
```

Deterministically derived, per `lib/harness.mjs:20`, as a domain-separated SHA-256 (`cpg-u1-provider-config/v1`) over the hashes of two files, in order, in the frozen resolver clone:

| File | Blob at `f01a7eb4…` |
|---|---|
| `backend/services/companyProfile/grounding/registry/builtins.ts` | `1cc335de317cbd88dcebd6cc1bb5fe2708517713` |
| `backend/services/companyProfile/grounding/registry/coverageInventory.ts` | `ce5a02307b735038bad0eec1233a7269337ae994` |

Both blobs are pinned by the frozen treatment, so **this value cannot drift**. Recompute it at registration with the same command and it will match. It appeared in the `verify-registration` blocker list only because the field is unfilled in the template — it is **not a human prerequisite**.

## What is *not* blocking registration

Once HP-1 … HP-8 are satisfied, **none of the following should delay registration**:

| Item | What it actually gates |
|---|---|
| **F-02** `CERT_AI_MOCK` unimplemented | **U9** preconditions. No U1 check touches it |
| **F-05** full lint fails on `research/**` | Repo-wide **T3** certification. No U1 check touches it |
| **F-06** full 273-mutant suite not yet re-run | Verification **depth** at T3. Anchors verify 273/273 today |
| **D-3** U9 endpoint structure | **U9**. `CPG042_DECISION_REVIEW.md:187`: "Does not block CPG-U1 registration" |
| **D-4** DT-U4 freeze vs refit | **DT-U4**. `CPG042_DECISION_REVIEW.md:197`: "Does not block CPG-U1 registration" |
| **I-1** nine stale `PROTOCOL_003` refs inside the instrument | Cosmetic, inside a hash-pinned artifact; needs its own amendment so the aggregate moves once |

Keeping these two tracks separate matters in both directions: none of them justifies delaying U1, and U1's readiness does not make any of them go away.
