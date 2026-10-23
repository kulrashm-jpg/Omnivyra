# FRAME_DRY_RUN — synthetic rehearsal of the frame pipeline, before registration

**Classification: PREPARATION** (this procedure) + **EXECUTION EVIDENCE of the rehearsal only** (the outputs in
`_rehearsal/`). Nothing here is REGISTERED EVIDENCE.

> **SYNTHETIC REHEARSAL OUTPUT IS PREPARATION. IT MUST NEVER BE PRESENTED AS, RENAMED TO, MERGED WITH, OR
> MIXED INTO THE REGISTERED FRAME. THE REGISTERED FRAME IS BUILT ONLY AFTER OSF REGISTRATION, BY INDEPENDENT
> ENUMERATORS (§5.5 step 3, §4A.2). ENUMERATION IS H3: THE ENUMERATOR'S INDEPENDENCE IS THE EVIDENCE, AND NO
> OPERATOR, IMPLEMENTER OR AGENT MAY SUPPLY A SINGLE ROW OF IT.**

---

## 1. Why a rehearsal is legitimate before registration, and what makes it safe

The frame pipeline (`frame` → `scan` → `check-frame-sufficiency`) is deterministic, needs no registration, no
key, no outpoint and no randomness, and reads nothing but a CSV, a git tree and the frozen registry. Exercising
it on **synthetic** rows therefore proves the machinery works without touching the study.

Three properties of the instrument make the separation mechanical rather than a matter of discipline:

1. **A synthetic row cannot enter a real frame.** `checkFrameRow` refuses any row whose `company_name` starts
   `SYNTHETIC-` or whose `canonical_domain` ends `.example` **unless `--allow-synthetic` is passed** — and the
   refusal is `MALFORMED_ROW`, which stops every downstream command. Every rehearsal row in this directory
   carries **both** markers, so all 222 rows are refused by default (proved in §2, step 1).
2. **A real frame cannot be produced by accident from this directory.** `--allow-synthetic` must be typed
   explicitly on every command, and the sampling commands additionally require a registration record whose
   `network` is `synthetic-test` before they honour it.
3. **Outputs are write-once and there is no `--seed` argument.** A refused command writes nothing; an existing
   output path is refused ("outputs are write-once (no re-roll)").

**Not rehearsed, and not rehearsable here:** `commitment-payload`, `draw-development`, `size`, `pool-check` and
`draw-held-out` all require a registration record, funded outpoints, a checkpoint and chain/drand evidence.
Those are **BLOCKED** on named human prerequisites (§19.3: accountable OSF identity + persistent identifier;
key custodian; independent personnel) and the tooling exits `4` while any is `UNASSIGNED`. That is correct
behaviour, not a gap.

---

## 2. The rehearsal, exactly as run

Environment actually used:

```bash
T="/c/tmp/dt002/research/cpg-u1/tooling"                    # verified instrument, READ-ONLY
                                                            # aggregate <NEW_AGG>
CLONE="<scratch>/clean-clone"                               # clean clone, detached at f01a7eb4…
cd research/deeptech-operations/dataset/_rehearsal
node --version   # v22.17.0
```

The clean clone was made without network access, from the local repository, and checked out detached:

```bash
git clone --shared --no-checkout /c/virality "$CLONE"
git -C "$CLONE" checkout --detach f01a7eb4199be4e04d4fee7fc0116303949dc553
git -C "$CLONE" rev-parse HEAD        # f01a7eb4199be4e04d4fee7fc0116303949dc553
git -C "$CLONE" status --porcelain    # (empty)
```

### Step 0 — generate the synthetic inputs

```bash
node make_synthetic_frame.mjs SYNTHETIC_FRAME_OK.csv SYNTHETIC_FRAME_MALFORMED.csv
```
Exit `0`:
```
wrote SYNTHETIC_FRAME_OK.csv: 222 synthetic rows {"fill-expected":133,"abstention-expected":54,"identity-hazard":34,"unknown":1}
wrote SYNTHETIC_FRAME_MALFORMED.csv: 9 deliberately malformed synthetic rows
```
Identifier check digits are computed by importing the instrument's own `lib/identifiers.mjs` read-only, so the
synthetic CIK/SIREN/CNPJ/LEI values are well-formed under the very code that validates them. Every
`enumerated_by` is `UNASSIGNED`. No real company appears in either file.

### Step 1 — the default refusal: synthetic rows are not a frame

```bash
node $T/cpg_u1_data.mjs frame --frame SYNTHETIC_FRAME_OK.csv
```
**Expected exit `1`. Actual exit `1`:**
```
  MALFORMED SYN-0001: SYNTHETIC row in a real frame — synthetic rows exist only for the self-test
  MALFORMED SYN-0002: SYNTHETIC row in a real frame — synthetic rows exist only for the self-test
  MALFORMED SYN-0003: SYNTHETIC row in a real frame — synthetic rows exist only for the self-test
  MALFORMED SYN-0004: SYNTHETIC row in a real frame — synthetic rows exist only for the self-test
  … (all 222 rows)
```
This is the load-bearing result: **the rehearsal corpus is mechanically incapable of being used as the
registered frame.**

### Step 2 — the rehearsal frame validates under `--allow-synthetic`

```bash
node $T/cpg_u1_data.mjs frame --frame SYNTHETIC_FRAME_OK.csv --allow-synthetic
```
**Expected exit `0`. Actual exit `0`:**
```
frame rows: 222  malformed: 0
  ADMISSIBLE                       217
  A1_NOT_ESTABLISHED               1
  A2_NOT_ESTABLISHED               1
  A3_NOT_ESTABLISHED               1
  A5_NOT_ESTABLISHED               1
  OUTCOME_CLASS_NOT_ESTABLISHED    1
  held-out-ineligible by attestation (before scan/registry): 1
frame_hash: 814f999d1d76e418100e63357bdcacfd26cc30171792b3262e87fed3faa5ec77
```
Six rows were written specifically to exercise the tri-state: `a1 = unknown`;
`canonical_domain = UNKNOWN` with `a2 = unknown`; `identifier_scheme = UNKNOWN` with an empty value;
`jurisdiction_family = UNKNOWN`; `expected_outcome_class = unknown`; and one row with
`c1_4_prior_cpg_execution = unknown`, which stays **admissible** but is counted held-out-ineligible. Each
produced exactly the `*_NOT_ESTABLISHED` outcome the protocol table predicts, and **no `unknown` passed.**

### Step 3 — malformed rows are refused, with the reason named

```bash
node $T/cpg_u1_data.mjs frame --frame SYNTHETIC_FRAME_MALFORMED.csv --allow-synthetic
```
**Expected exit `1`. Actual exit `1`:**
```
  MALFORMED SYN-0223: canonical_domain is blank — write "UNKNOWN" if it is not established
  MALFORMED SYN-0224: a1_operating_legal_entity must be exactly "yes", "no" or "unknown" (blank is not an answer)
  MALFORMED SYN-0225: canonical_domain must be lowercase; canonical_domain must be a bare host (no scheme, port, path or whitespace)
  MALFORMED SYN-0226: enumerated_at must be YYYY-MM-DD
  MALFORMED SYN-0227: enumeration_source_url must be an https URL
  MALFORMED SYN-0228: identity_hazard_note is required for identity-hazard (name the colliding entity)
  MALFORMED SYN-0229: identifier_value must be empty when identifier_scheme is UNKNOWN
  MALFORMED SYN-0230: QID "q123" fails format/checksum validation
  MALFORMED SYN-0224: duplicate candidate_id
frame rows: 9  malformed: 9
  held-out-ineligible by attestation (before scan/registry): 0
frame_hash: 38a0e53cdaf5ba8fdc9f000ac1544eeba3465d97cff939abc5097c01d2dd52f6
```

### Step 4 — the scan refuses a wrong resolver SHA

```bash
node $T/cpg_u1_data.mjs scan --frame SYNTHETIC_FRAME_OK.csv --repo "$CLONE" \
  --expect-sha 0000000000000000000000000000000000000000 \
  --registry $T/rules/development_only_registry.json --out scan_wrong.json
```
**Expected exit `1`, nothing written. Actual exit `1`:**
```
ERROR: repo HEAD f01a7eb4199be4e04d4fee7fc0116303949dc553 != --expect-sha 0000000000000000000000000000000000000000 (contamination is assessed at the FROZEN resolver SHA)
ls: cannot access 'scan_wrong.json': No such file or directory
```

### Step 5 — the scan at the frozen resolver SHA

```bash
node $T/cpg_u1_data.mjs scan --frame SYNTHETIC_FRAME_OK.csv --repo "$CLONE" \
  --expect-sha f01a7eb4199be4e04d4fee7fc0116303949dc553 \
  --registry $T/rules/development_only_registry.json --out SYNTHETIC_SCAN.json
```
**Expected exit `0`. Actual exit `0`:**
```
scanned TEST=1797 CPG_IMPLEMENTATION=116 files at f01a7eb4199be4e04d4fee7fc0116303949dc553
held-out-ineligible by scan/registry: 0 of 222
scan_sha256: e5c1ff11f7d570c504b127ff47e89c0a42880090e9dd8f480779ad4cfb4eb684
```
Both §5.4 scopes resolve to real, non-empty file sets at the frozen SHA. Zero hits is the correct result for
synthetic tokens: no synthetic name, `.example` domain or synthetic identifier occurs in the repository, and
none matches the frozen registry.

### Step 6 — the sufficiency floor passes with margin

```bash
node $T/cpg_u1_data.mjs check-frame-sufficiency --frame SYNTHETIC_FRAME_OK.csv \
  --scan SYNTHETIC_SCAN.json --registry $T/rules/development_only_registry.json --allow-synthetic
```
**Expected exit `0`. Actual exit `0`:**
```
  fill-expected          eligible admissible 128  required 126
  abstention-expected    eligible admissible 54  required 52
  identity-hazard        eligible admissible 34  required 32
frame sufficient for every permitted pilot outcome; frame_hash 814f999d1d76e418100e63357bdcacfd26cc30171792b3262e87fed3faa5ec77
```
The required values `126 / 52 / 32` are **derived**, not typed in: the tooling evaluates the frozen sizing rule
on all 4096 permitted pilot outcomes and takes `2 · Qmax_c + Dev_c`.

### Step 7 — one row short is refused

Three clean `fill-expected` rows were removed (`SYN-0126`, `SYN-0127`, `SYN-0128`), taking the class from 128 to
125, and the frame was re-scanned (a scan is bound to one `frame_hash`, so a changed frame needs a new scan):

```bash
grep -v -E '^SYN-012[678],' SYNTHETIC_FRAME_OK.csv > SYNTHETIC_FRAME_SHORT.csv
node $T/cpg_u1_data.mjs scan --frame SYNTHETIC_FRAME_SHORT.csv --repo "$CLONE" \
  --expect-sha f01a7eb4199be4e04d4fee7fc0116303949dc553 \
  --registry $T/rules/development_only_registry.json --out SYNTHETIC_SCAN_SHORT.json
node $T/cpg_u1_data.mjs check-frame-sufficiency --frame SYNTHETIC_FRAME_SHORT.csv \
  --scan SYNTHETIC_SCAN_SHORT.json --registry $T/rules/development_only_registry.json --allow-synthetic
```
**Expected exit `1`. Actual exit `1`:**
```
scan: held-out-ineligible by scan/registry: 0 of 219
      scan_sha256: 80627c27fefdc75802c0a90ad4407534847e80a25e69fc3851297e4411974027
  fill-expected          eligible admissible 125  required 126
  abstention-expected    eligible admissible 54  required 52
  identity-hazard        eligible admissible 34  required 32
ERROR: FRAME_INSUFFICIENT: fill-expected eligible 125 < required 126
```
The floor is enforced exactly, not approximately — and the refusal happens **before** any commitment can name
the frame, which is what keeps `STAGE_VOID_FRAME_INSUFFICIENT` off the table.

---

## 3. Summary of expected exit codes

| Step | Command | Expected | Actual |
|--:|---|--:|--:|
| 0 | `make_synthetic_frame.mjs` | 0 | **0** |
| 1 | `frame` without `--allow-synthetic` | 1 | **1** |
| 2 | `frame --allow-synthetic` on the clean corpus | 0 | **0** |
| 3 | `frame --allow-synthetic` on the malformed corpus | 1 | **1** |
| 4 | `scan` with a wrong `--expect-sha` | 1 | **1** |
| 5 | `scan` at `f01a7eb4…` | 0 | **0** |
| 6 | `check-frame-sufficiency` (128/54/34) | 0 | **0** |
| 7 | `check-frame-sufficiency` (125/54/34) | 1 | **1** |

Exit-code vocabulary: `0` ok · `1` refused/abort · `2` pool below minimum · `3` HALT · `4` BLOCKED (named human
prerequisite) · `5` WAITING · `6` VOID/ABANDONED.

---

## 4. Rehearsal artefacts, and the line they must never cross

All under `research/deeptech-operations/dataset/_rehearsal/`:

| File | What it is |
|---|---|
| `make_synthetic_frame.mjs` | ENGINEERING ARTIFACT — the generator; imports the instrument read-only |
| `SYNTHETIC_FRAME_OK.csv` | 222 synthetic rows, `frame_hash 814f999d…` |
| `SYNTHETIC_FRAME_MALFORMED.csv` | 9 deliberately malformed synthetic rows, `frame_hash 38a0e53c…` |
| `SYNTHETIC_FRAME_SHORT.csv` | the one-short variant used in step 7 |
| `SYNTHETIC_SCAN.json` | scan of the 222-row corpus, `scan_sha256 e5c1ff11…` |
| `SYNTHETIC_SCAN_SHORT.json` | scan of the short corpus, `scan_sha256 80627c27…` |

Handling rules:

1. **Never** rename, copy or edit any of these into a frame intended for registration. Their `frame_hash` values
   are recorded above precisely so that a rehearsal file appearing anywhere near the study is detectable.
2. **Never** pass `--allow-synthetic` to a real command. Its only legitimate uses are this rehearsal and the
   instrument's own self-test.
3. **Never** publish a rehearsal `scan_sha256` or `frame_hash` as a study value. No commitment payload may
   carry one.
4. The whole `_rehearsal/` directory is **disposable** and may be deleted without loss; this document is the
   record.
5. The registered frame is created **after** OSF registration, by **independent enumerators**, from **public
   sources**, with a real pseudonymous `enumerated_by` — never by the operator, never by an implementer, never
   by an agent, and never from anything in this directory.

> IDENTITY-SWEEP CORRECTION — DEEPTECH-PARALLEL-013 §9 (base af2fb6e9). NOT YET CONSISTENT.
> The superseded instrument identity in this file has been replaced by the PLACEHOLDERS
> `<NEW_AGG>` (tooling aggregate) and `<NEW_N>` (tooling file count). These are placeholders,
> not values. The final aggregate DOES NOT EXIST YET: DR-11 is unresolved and R28/R15/DR-12 are
> being implemented in a new tree. A later SUBSTITUTION PASS must replace both placeholders,
> after the single in-tree README edit session and the one recomputation that follows it.
> Any "verified" / "recomputed" wording on a corrected line attested the SUPERSEDED tree and is
> VOID PENDING RE-ATTESTATION by its original attester — it must not be relabelled.
> Nothing in this file may be relied on for registration until that pass has run.
> Deliberately preserved: references to the known-stale 587-file in-repo tree (aggregate 640510…)
> are TRAP WARNINGS and are correct as written.

