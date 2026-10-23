# EXTERNAL_LEAVES — the eleven external values of the U1 registration record

DEEPTECH-PARALLEL-011, registration-package stream.

**Nothing below is invented.** No identity, no ORCID, no ROR, no wallet key, no OSF id, no timestamp,
no relay URL — not even as a placeholder that could be mistaken for real. Every leaf carries the
literal sentinel the instrument itself writes and refuses to proceed past:

```
UNASSIGNED
```

**Nothing was registered. No OSF action, no Bitcoin broadcast, no network call, no credential.**

## Why eleven

`verify-registration` on the template produced by `registration-fields` reports **ten** BLOCKED lines
(real run R1, exit 4, zero errors). Of those ten:

- one — `provider_configuration_sha256` — is **machine-derivable, not external**. It was derived in
  this stream: `c9a7e9aa559d8fbd49f0ae0b1ea896af40637000329c35602f81abcd53627561`.
- two — `outpoints` and `checkpoint` — are reported as **one blocker each but carry two values each**
  (`development` + `held-out`; `height` + `hash`).

So 10 − 1 + 2 = **eleven external leaves**: **five owner-supplied, two OSF-generated, four
Bitcoin-generated**.

---

## A. Five owner-supplied

| # | Leaf | Record path | Sentinel | Who supplies it | What blocks on it |
|---|---|---|---|---|---|
| **1** | Accountable OSF identity | `accountable_identity.value` | `UNASSIGNED` | **The owner** — the person or entity accountable for the study, bound to the OSF account (§5.5.1, U1 approval; §19.3(1)) | **Registration itself.** The authority rule is defined *relative to this identity* — "the earliest registration under the accountable identity with this `study_id` is authoritative". Without it there is no authority, no duplicate detection and no §21 step 1. `verify-registration` exits 4. |
| **2** | Persistent identifier **type** | `persistent_identifier.type` | `UNASSIGNED` | **The owner** — the kind of persistent identifier (§5.5.1 records type and value separately; §19.3(1)) | **Registration.** *No type is named or implied here.* The instrument performs **no** vocabulary check on this field (verifier property 2, run R28), so the owner must state it exactly. |
| **3** | Persistent identifier **value** | `persistent_identifier.value` | `UNASSIGNED` | **The owner** | **Registration**, and §21 step 1 — outsiders resolve the record through this identifier. There is **no syntax validation**: run R28 showed a bare `0000-0000-0000-0000` accepted with exit 0. It must be the real identifier. |
| **4** | Bitcoin wallet-key custodian | `bitcoin_key_custodian.value` (role pinned to `STUDY_OPERATOR`) | `UNASSIGNED` | **The owner**, naming the study operator as custodian (CPG-040 §3.2; §19.3(2)) | **Funding** — this is the only blocker in the `funding` phase (`check-funding-prerequisites`), so **no key may be created and no output funded until it is assigned**, and funding precedes registration in the §5.5 ordering. The role is pinned: anything other than `STUDY_OPERATOR` is an error, not a blocker. **This stream created no key and no transaction.** |
| **5** | Frozen run timestamp `asOf` | `as_of` | `UNASSIGNED` | **The owner** — one frozen ISO-8601 UTC `YYYY-MM-DDTHH:MM:SSZ` chosen **before** registration (§7, §19.1) | **Registration**, and the whole treatment definition: `asOf` is a §7 treatment input and appears in the harness run metadata and the execution authorisation. One value for the *entire* held-out run. Format is validated, so a variant sentinel here raises an error rather than silently passing (run R18). |

## B. Two OSF-generated

Both are **issued by the registry at registration and never asserted by the operator** (§5.5.1).
They cannot exist before the registration act, so they are the only two leaves that are *necessarily*
absent from any pre-registration package.

| # | Leaf | Record path | Sentinel | Who supplies it | What blocks on it |
|---|---|---|---|---|---|
| **6** | `registration_id` | `registration_id` | `UNASSIGNED` | **OSF Registries**, at registration | Every commitment payload carries `registration_id`; a payload naming another registration is `STAGE_VOID_MALFORMED_COMMITMENT`. Also the key of the authority check over the identity's registration listing. Must not contain `\|`. **Caution:** this is one of the five fields DR-12 can silently un-block, and R28 showed `TBD-REG` accepted with exit 0. |
| **7** | `registration_timestamp` | `registration_timestamp` | `UNASSIGNED` | **OSF Registries**, at registration | The authority ordering (earliest wins) and the §5.10 grind-then-register rule: a registration timestamped at or after the development drand round voids the study. Also the 180-day abandonment clock. Format-validated ISO-8601 UTC. **§20.19: this timestamp is off-chain** — the tooling proves only that registration preceded `R_dev`. |

## C. Four Bitcoin-generated

All four exist only once the key custodian has created and confirmed two single-use P2WPKH funding
outputs on **bitcoin-mainnet** (§5.5 steps 0–1). **No transaction was built or broadcast by this
stream.**

| # | Leaf | Record path | Sentinel | Who supplies it | What blocks on it |
|---|---|---|---|---|---|
| **8** | Development outpoint `O_dev` | `outpoints.development` | `UNASSIGNED` | **Bitcoin**, via the key custodian — a confirmed P2WPKH output, ≥ D = 6 confirmations | The development commitment: `O_dev` is spent **once**, with exactly one OP_RETURN output carrying `CPGU1‖01‖0x44‖digest`. One-time spendability is what makes a second development commitment impossible. Format `<64 lowercase hex txid>:<vout>`; must be **distinct** from `O_ho`. |
| **9** | Held-out outpoint `O_ho` | `outpoints['held-out']` | `UNASSIGNED` | **Bitcoin**, via the key custodian — a second, distinct confirmed P2WPKH output, ≥ D = 6 confirmations | The held-out commitment, spent once with `CPGU1‖01‖0x48‖digest`, after development finality. Identical outpoints are refused with an error. |
| **10** | Checkpoint **height** | `checkpoint.height` | `UNASSIGNED` | **Bitcoin** — a block at or after **both** funding confirmations | The archive anchor: §21 step 3 requires headers from a retarget boundary ≤ checkpoint to the tip, from two independent sources. Must be a non-negative safe integer. |
| **11** | Checkpoint **hash** | `checkpoint.hash` | `UNASSIGNED` | **Bitcoin** — the block hash at that height | Binds funding to a specific chain state, so a reorganisation is detectable (§5.10, §20.16). Must be 64 lowercase hex. |

---

## Not among the eleven — external, but not registration-record fields

Listed so nothing is mistaken for a twelfth leaf, and so that nothing external is silently omitted
from the package.

| External value | Who supplies it | Where it belongs | Due by |
|---|---|---|---|
| Eight personnel identities: 2 × `enumerator` (A and **Enumerator B**), `reference-author`, `reference-confirmer`, `reference-adjudicator`, `rater-1`, `rater-2`, `rating-adjudicator` | the owner | the **restricted personnel register** (§4A, §19.3(3)) | before the respective stage; enumerators before frame construction |
| `operator.person_id` (study operator = key custodian; holds no independent role) | the owner | personnel register | before frame construction |
| Seven §4A.1 independence declarations per person, plus `organisation_confirmation_sha256` and `study_fee_agreement_sha256` per person | each person / the developing organisation | personnel register | with the register |
| The operator's signed **no-preview declaration** | the operator | §6.5 evidence, archived | covering frame completion → run completion |
| **≥ 2 named drand relay endpoints** | the verifier / operator | §19.3, §21 step 5 evidence bundle — the **floor** is enforced in code (`lib/evidenceBundle.mjs`), the endpoints are not pinned anywhere | before sampling verification |
| **Two independent Bitcoin header sources, or an own full node** | the verifier / operator | §19.3, §21 steps 3–4 | before sampling verification |
| **certenv with a fixture tenant**; recording fetcher; recording Wikidata lookup; replay harness | the operator | §13, §19.3 | before held-out execution |
| Published **seal record** on OSF, with its registry-issued timestamp | OSF, after sealing | §6.5 execution authorisation — it opens the execution window | after the seal, long after registration |

## Explicitly NOT external — derived in this stream, do not solicit it

| Value | Derived value |
|---|---|
| `protocol_sha256` | `c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719` |
| `tooling_aggregate_sha256` | `638d68e6085d6894355a6d14ff2628a2e94c657c795a3d795500dbb3fa278fd2` (594 files) — **CANDIDATE, CERTIFICATION PENDING** |
| `registry_sha256` | `a1392952627145d049edf82912f410355bc25ce5b087bfdddc30cc91e2a70814` |
| `provider_configuration_sha256` | `c9a7e9aa559d8fbd49f0ae0b1ea896af40637000329c35602f81abcd53627561` |
| Evaluation tree (commit / tree / aggregate / files) | `f01a7eb4199be4e04d4fee7fc0116303949dc553` / `3b4811fc88e9fbb64ee42c37c4aacca2e76c67af` / `ffe4f6035333e2ec963d02ccfc0cff39bb28b27ebb3600d56b42bb94c601d1c5` / 11552 |
| The 12 pinned sampling parameters | see `REGISTRATION_READINESS_PACKAGE.md` item 7 |
| AD-1 … AD-9 | all **DECIDED**; see item 10 |

## Two warnings that attach to these leaves specifically

1. **DR-12 is still open in the candidate.** `assigned()` compares against the sentinel exactly, so
   `' UNASSIGNED '`, `'unassigned'` and `'Unassigned'` are read as *assigned*. The five leaves that can
   be silently un-blocked this way are leaves **1, 2, 3, 4 and 6** — every one of the five
   format-unvalidated identity leaves. Blocker counts dropped 10 → 8 → 5 in real runs, **exit 4 with
   zero errors** each time. Leaves 5, 7, 8, 9, 10 and 11 are format-validated and raise an error
   instead (run R18, exit 1). Bound: the bypass can never reach exit 0.
2. **No placeholder vocabulary and no identifier syntax check** (run R28). Filling leaves 1–4 and 6
   with `TBD` / `PLACEHOLDER` / `0000-0000-0000-0000` yields **exit 0** outside test mode. Only values
   whose upper-cased form contains `SYNTHETIC` are refused. **These five leaves must be filled with
   the real values or left at the exact sentinel — never with a stand-in.**
