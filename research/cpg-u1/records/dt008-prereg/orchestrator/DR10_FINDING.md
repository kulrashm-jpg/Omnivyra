# DR-10 — `cmdScan` duplicate collapse: finding and verdict

**Written by the orchestrator from the audit stream's own evidence.** That stream was killed by a session rate limit
after completing its probes but before writing its report; its 335-line transcript and five probe scripts survived and
are preserved at `C:/tmp/dt008-prereg/B-cmdscan/`. Every figure below is quoted from that transcript, which records real
runs of the **frozen** commands against synthetic fixtures. I read the transcript directly and had independently
verified the underlying defect earlier in this session.

**Classification: ENGINEERING TEST. Not evidence. Synthetic fixtures only — no real company, no network.**

## The defect

`cpg_u1_data.mjs:233`:

```js
const state = new Map(frame.map((r) => [r.candidate_id, { r, tokens: tokensFor(r), hits: [] }]));
```

A `Map` built from pairs keeps only the **last** value for a repeated key. Two frame rows sharing a `candidate_id`
collapse to one scan result and the command exits **0**. It is reachable because line 230 loads the frame with
`loadCsv`, **not** `loadFrame` — and `loadFrame` (`:93-103`) is the only place the duplicate check lives
(`if (seen.has(r.candidate_id)) res.errors.push('duplicate candidate_id')`).

## What the earlier wave missed

A prior wave measured the collapse with a fixture whose two rows had **identical tokens**, so the drop cost nothing and
the defect looked cosmetic. This audit built a **divergent** duplicate — same `candidate_id`, *different* company name,
domain and identifier — and the result is materially worse.

## The six surfaces

| # | Surface | Verdict | Evidence |
|---|---|---|---|
| 1 | **Contamination detection** | **AFFECTED** | see below |
| 2 | Frame eligibility | AFFECTED arithmetically; no registered command reaches it | duplicate frame `SYN-DUP-0001 ineligible=false`; control `=true` |
| 3 | **Evidence provenance** | **AFFECTED** | `scan.frame_hash == hashRecords(full frame): true` — "the hash covers the DUPLICATE rows, the results do not" |
| 4 | Candidate counting | AFFECTED arithmetically | duplicate `{fill 128, abst 53, hazard 34}` vs control `{127, 53, 34}`; `frame` would publish 220 rows against 219 scan results |
| 5 | Frame sufficiency | **PROTECTED** | `check-frame-sufficiency` exit 1; `frame` exit 1 naming the offending `candidate_id` |
| 6 | Held-out validity | **PROTECTED at every gate** | see the refusal table |

### Surface 1 — the collapse hides real contamination

```
duplicate frame : SYN-DUP-0001  repository_hits=0  registry_matches=0  held_out_ineligible_by_scan=false
control frame   : SYN-DUP-0001  repository_hits=2  registry_matches=SYN-DEV-003  held_out_ineligible_by_scan=true
                    hit TEST backend/tests/dup.test.ts:3 (name=SYNTHETIC-CO-DUPCONTAM)
                    hit TEST backend/tests/dup.test.ts:4 (domain=synthetic-dupcontam.example)
control flagged 6; duplicate-frame scan flagged 5
```

The transcript's own words: **"the collapse hid real C1(1)+C1(6) contamination in the scan artefact."** The contaminated
row was dropped and the clean row survived, so the scan reported the candidate as eligible.

## Every downstream gate refuses it

Real exit codes from the frozen commands on the duplicate frame:

| Command | Exit | Message |
|---|---|---|
| `frame` | 1 | `1 malformed frame row(s)` — names the id |
| `check-frame-sufficiency` | 1 | malformed row refusal |
| `harness-pilot` | 1 | |
| `authorize-execution` | 1 | |
| `draw-development` | 1 | `run "frame" and fix before drawing` |
| `verify-commitment` | 1 | |
| `pool-check` | 1 | |
| `draw-held-out` | 1 | |
| `harness-held-out` | 1 | |
| `commitment-payload --stage held-out` | 1 | |

**Both escape routes I asked to be attacked were tried and both are closed:**

- de-duplicate the frame, then reuse the **old** duplicate-frame scan → `check-frame-sufficiency` exit 1,
  `commitment-payload` exit 1, `draw-development` exit 1, all with
  `scan was produced for a different frame (frame_hash mismatch) — re-scan the exact frame`.
- feed a duplicate-frame scan onward to a commitment → refused, as above.

The honest route works as designed: re-scanning the de-duplicated frame exits 0, and the contaminated row is simply
absent from the study. Keeping the contaminated row instead and re-scanning flags it correctly.

## Verdict

**The defect is more serious than "cosmetic" and less serious than "evidence-bearing".**

It **can** corrupt an intermediate artefact — a `scan.json` plus its `scan_sha256` that silently omits a contaminated
company while its `frame_hash` attests to the full frame. But **no registered command will consume that artefact**: the
failure is closed at ten separate gates and at both bypass attempts. Nothing can reach a commitment, a draw, an
execution or a published record through this path.

**So the directive's condition "if there is no evidence-bearing impact: document and leave unchanged" is satisfied — but
only because of downstream guards, not because the scan is sound.** Two consequences follow.

### Residual 1 — a reporting gap, not a mechanism gap

`frame` would publish 220 rows while the scan holds 219 results, and **no artefact states those two numbers side by
side.** An operator who ran `scan` first and never ran `frame` would hold a green-looking scan that omits a contaminated
company, with nothing on the face of either file to reveal it.

### Residual 2 — the safety depends on operator ordering

The guards fire at `frame` and at anything consuming a scan against a frame. The operational rule must therefore be
explicit: **`frame` must exit 0 before `scan` output is used for anything, and `check-frame-sufficiency` is the
acceptance gate, not `frame` alone.**

## DECISION REQUIRED

**Fix `cmdScan` to refuse a duplicate `candidate_id`, or accept the residuals and rely on operator ordering?**

- The minimum fix is small — route line 230 through `loadFrame`, or add a duplicate check before building the Map at
  `:233` — and it converts a silent exit 0 into an explicit refusal.
- **The cost is that it moves `tooling_aggregate_sha256`.** That value is registered and, after the development
  commitment, committed inside an OP_RETURN, and it is in `SAMPLING_FIELDS`, so a later repair would be a
  re-registration and therefore a VOID. **The window closes permanently at registration.**
- Not fixing it is defensible on the evidence, provided the two residuals above are written into the operator
  procedure rather than left to memory.

**Recommendation: fix it**, because it is cheap now and impossible later, and because a command that exits 0 on
malformed input while producing a hash-attested artefact is exactly the kind of thing an outsider verifying under §21
would object to — even though no endpoint depends on it. Group it with DR-1 and DR-2 so the aggregate moves **once**.

## Provenance

Evidence: `C:/tmp/dt008-prereg/B-cmdscan/out/TRANSCRIPT.txt` (335 lines) plus `collapse_probe.mjs`,
`eligibility_probe.mjs`, `guard_closure_probe.mjs`, `make_divergent_fixtures.mjs`,
`make_synthetic_registration.mjs`, `RUN.sh`. Nothing was written to `C:/tmp/dt002` or `research/cpg-u1/**`; the
instrument re-verified at `f7699f05495f72379903b00195bf44271bbdc75c66cac3185ed0dbb04e5cc5dd` over 593 files and the
protocol at `c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719`. No registration, no commitment, no
execution, no network.
