# BG05_AUTHORSHIP_POSITION

**Artefact class: ENGINEERING ARTIFACT (§2–§4, the measured facts) + HUMAN-REQUIRED INPUT (§5–§7,
the position itself).**

> **This document asserts no authorship, no copyright subsistence, no ownership and no legal
> conclusion of any kind.** It establishes what git history at one fixed commit does and does not
> record, states what a defensible written authorship position would have to address, and marks the
> position itself **DECISION REQUIRED — requires counsel**. It is deliberately not a draft of that
> position, and it must not be forwarded as one.

| Field | Value |
|---|---|
| Base SHA | `af2fb6e99ce461894bf16f18c2251f75088eba18` |
| Gap | **BG-05**, `DEEPTECH_BASELINE_001.md:896` |
| Blocks (per baseline) | Q2 personnel, Q3 copyright, **filing integrity** |
| Closable by engineering (per baseline) | **No — requires counsel** |
| Prepared by | Stream Q / Part K, DEEPTECH-PARALLEL-004 |
| Read-only | Yes. No commit, no product code change, no network call |

---

## 1. What BG-05 says, quoted

- `DEEPTECH_BASELINE_001.md:896` — `| **BG-05** | **AI-assisted-development authorship position absent.** .claude/worktrees/agent-* directories present; 528 commits in 2026-07 across 3 identities | CRITICAL | Q2 personnel, Q3 copyright, filing integrity | No — requires counsel |`
- `DEEPTECH_BASELINE_001.md:908` — `BG-04 and BG-05 are the two gaps engineering can never close, and together they gate DPIIT readiness completely.`
- `DEEPTECH_BASELINE_001.md:777` (§13.2, second hard constraint) — `Copyright basis is BLOCKED pending an authorship determination. See §15 / BG-05.`
- `DEEPTECH_BASELINE_001.md:798` (§14 Q3) — `Copyright basis: BLOCKED on authorship (BG-05).`
- `DEEPTECH_BASELINE_001.md:926` (§18) — BG-05 is to be started immediately, in parallel with technical work, as a longest-lead non-engineering item.

The baseline's BG-05 evidence was two observations at SHA `82754497`: the presence of
`.claude/worktrees/agent-*` directories, and 528 commits in 2026-07 across three identities. **Both
are re-verified below at `af2fb6e9`, and the picture is substantially larger than BG-05 recorded**,
because the baseline did not measure the commit-trailer surface at all.

---

## 2. Identities: which appear, over which periods, with what commit counts

**ENGINEERING ARTIFACT.**

```bash
git shortlog -sne HEAD
git log --format='%cn <%ce>' HEAD | sort | uniq -c | sort -rn
git log --format='%ae' HEAD | sort -u
```

**Author identities — 3, over 2 email addresses** (reproduces baseline line 57 exactly):

| Commits | Author identity |
|---|---|
| 1,599 | `kulrashm-jpg <kulrashm@gmail.com>` |
| 174 | `drishiq2-dot <drishiq2@gmail.com>` |
| 22 | `drishiq1 <drishiq2@gmail.com>` |

**Committer identities — 4:**

| Commits | Committer identity |
|---|---|
| 1,342 | `kulrashm-jpg <kulrashm@gmail.com>` |
| 259 | `GitHub <noreply@github.com>` |
| 172 | `drishiq2-dot <drishiq2@gmail.com>` |
| 22 | `drishiq1 <drishiq2@gmail.com>` |

**Period** (`git log --reverse --format='%H %ad %an' --date=iso HEAD | head -1` and
`git log -1 ...`): first commit `1d73f682`, `2026-01-29 03:42:46 +0530`, identity `drishiq1`; HEAD
`af2fb6e9`, `2026-09-24 06:04:59 +0530`, identity `kulrashm-jpg`. **1,795 commits** reachable from
HEAD, across **148 distinct calendar days**.

Two observations that matter to §5 and that a reader must not skip:

1. `drishiq2-dot` and `drishiq1` **share one email address** (`drishiq2@gmail.com`). Three identities
   therefore do not imply three email holders, and certainly not three people.
2. `GitHub <noreply@github.com>` (259 commits) is the committer on merges made through the GitHub
   surface. It is not a fourth contributor.

> **An identity is a configured string in commit metadata. It is not a person, and it is not evidence
> of who wrote anything.** Git records what the committing machine was configured to record. Mapping
> identities to persons is `NOT AVAILABLE IN REPOSITORY — the operator supplies it` (Q2-05 of
> `Q2_EVIDENCE_REQUEST_MATRIX.md`).

---

## 3. Where AI-assistance markers appear

**ENGINEERING ARTIFACT. This is the material fact of BG-05, and it is larger than BG-05 recorded.**

### 3.1 Commit-trailer count

```bash
git log --format='%H' --grep='Co-Authored-By: Claude' -i HEAD | wc -l    # -> 1384
git rev-list --count HEAD                                               # -> 1795
git log --no-merges --format='%H' --grep='Co-Authored-By: Claude' -i HEAD | wc -l   # -> 1370
git log --format='%H' --grep='claude' -i HEAD | wc -l                   # -> 1386
git log --format='%H' --grep='Generated with \[Claude Code\]' -i HEAD | wc -l   # -> 0
```

| Measure | Value at `af2fb6e9` |
|---|---|
| Commits carrying a `Co-Authored-By: Claude ...` trailer | **1,384 of 1,795 = 77.1%** |
| Of those, non-merge commits | **1,370** |
| Commits mentioning "claude" anywhere in the message | **1,386** |
| Commits carrying a `Generated with [Claude Code]` line | **0** |

The 2-commit delta between 1,386 and 1,384 is fully accounted for and is unrelated to authorship:

- `6285a010` (2026-09-02) — `Merge pull request #163 from kulrashm-jpg/fix/p0-untrack-claude-local-settings`; "claude" occurs in a branch name.
- `d9e506be` (2026-07-30) — `feat(grounding): COMPANY-GROUNDING-GUARD-IMPLEMENTATION-001 ...`; "claude" occurs in the body without a trailer.

### 3.2 Trailer variants, verbatim

```bash
git log --format='%B' HEAD | grep -ohiE 'Co-Authored-By: [^<]*<[^>]*>' | sort | uniq -c | sort -rn
git log --format='%B' HEAD | grep -ciE '^Co-Authored-By: Claude'    # -> 1399
```

| Trailer lines | Trailer, verbatim |
|---|---|
| 555 | `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>` |
| 246 | `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` |
| 223 | `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` |
| 136 | `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` |
| 104 | `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>` |
| 89 | `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` |
| 22 | `Co-authored-by: Claude Opus 5 <noreply@anthropic.com>` (lower-case variant) |
| 14 | `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>` |
| 10 | `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>` |
| **1,399** | **total Claude trailer lines** (across 1,384 commits — some commits carry more than one) |
| 1 | `Co-authored-by: Cursor <cursoragent@cursor.com>` — commit `4366d094`, 2026-02-14, identity `drishiq1`, `Freeze Campaign Engine Governance Specification v1.0` |

No other assistant or non-human co-author trailer appears:

```bash
git log --format='%B' HEAD | grep -ohiE 'Co-Authored-By: .*' | grep -viE 'claude|cursor' | sort -u
# -> (no output)
```

### 3.3 Distribution over time

```bash
for m in 2026-01 ... 2026-09; do
  t=$(git log --format='%ad' --date=format:'%Y-%m' HEAD | grep -c "^$m$")
  a=$(git log --format='%ad' --date=format:'%Y-%m' --grep='Co-Authored-By: Claude' -i HEAD | grep -c "^$m$")
  echo "$m: $a / $t"
done
git log --reverse --format='%H %ad %an %s' --date=short --grep='Co-Authored-By: Claude' -i HEAD | head -1
```

| Month | Trailer commits | Total commits | Share |
|---|---|---|---|
| 2026-01 | 0 | 3 | 0.0% |
| 2026-02 | 0 | 10 | 0.0% |
| 2026-03 | 14 | 37 | 37.8% |
| 2026-04 | 0 | 8 | 0.0% |
| 2026-05 | 103 | 117 | 88.0% |
| 2026-06 | 87 | 99 | 87.9% |
| **2026-07** | **476** | **528** | **90.2%** |
| 2026-08 | 311 | 432 | 72.0% |
| 2026-09 | 393 | 561 | 70.1% |

Earliest trailer commit: `fc0f2cd6`, **2026-03-16**, author identity `drishiq1`.

**BG-05's "528 commits in 2026-07" is confirmed, and the relevant figure is that 476 of those 528
(90.2%) carry an AI co-authorship trailer.** The baseline recorded the volume; it did not record
the marker density, which is the fact that actually makes BG-05 critical.

### 3.4 Distribution by author identity

```bash
git log --format='%an' --grep='Co-Authored-By: Claude' -i HEAD | sort | uniq -c | sort -rn
```

| Trailer commits | Author identity | That identity's total | Share |
|---|---|---|---|
| 1,247 | `kulrashm-jpg` | 1,599 | 78.0% |
| 134 | `drishiq2-dot` | 174 | 77.0% |
| 3 | `drishiq1` | 22 | 13.6% |

**The marker is not confined to one identity.** All three human identities have commits carrying it.

### 3.5 The `.claude/worktrees/agent-*` directories

```bash
ls -d /c/virality/.claude/worktrees/*/
ls -d /c/virality/.claude/worktrees/agent-*
git -C /c/virality/.claude/worktrees/agent-a212e37c91b008c96 rev-parse HEAD
git -C /c/virality/.claude/worktrees/agent-a2225e8e92d9ace0b rev-parse HEAD
git ls-tree -r HEAD --name-only | grep '^\.claude'
grep -n 'claude' /c/tmp/dt4-corp/.gitignore
```

**VERIFIED — BG-05's observation still holds.** Two directories matching `agent-*` are present on
disk under the primary working copy:

- `/c/virality/.claude/worktrees/agent-a212e37c91b008c96` — registered git worktree, HEAD `82754497e8f9b64a893319e863941ad2994fd9b7`
- `/c/virality/.claude/worktrees/agent-a2225e8e92d9ace0b` — registered git worktree, HEAD `82754497e8f9b64a893319e863941ad2994fd9b7`

Both sit at exactly the SHA `DEEPTECH_BASELINE_001` was written against (baseline line 16), which is
consistent with BG-05 having been recorded from this same state.

At `af2fb6e9` the commit tracks only two `.claude` paths — `.claude/scheduled_tasks.lock` and
`.claude/settings.json`. `.gitignore` names only `.claude/settings.local.json` (line 148);
`.claude/worktrees/` is **not** listed there. The `agent-*` trees are therefore working-copy state,
not committed content.

---

## 4. What the repository does NOT record — stated so it is never inferred

Each of the following is **`NOT AVAILABLE IN REPOSITORY`**, with the party who would have to supply it:

| Not recorded | Who could supply it |
|---|---|
| Which specific lines, files or functions in any commit were produced with assistance, and which were not | Nobody — this is not recoverable from git at any level of effort. A trailer is commit-scoped; it carries no intra-commit attribution |
| The nature of the assistance in any given commit (generation from a prompt, transformation of existing code, refactoring, review, a mechanical edit, or a commit message only) | Operator (recollection); **not reconstructible from the repository** |
| Whether a human directed, reviewed, modified or accepted each assisted change, and to what degree | Operator declaration |
| Whether the 411 commits **without** the trailer were unassisted, or assisted without the trailer being emitted | Operator declaration. **The absence of a trailer is not evidence of absence of assistance** |
| Whether the trailer was applied consistently by policy across the whole window | Operator. The month-by-month step (0% in Jan/Feb/Apr, 37.8% in Mar, 88–90% May–Jul, 70–72% Aug–Sep) is consistent with tooling and configuration changes, not with a stable policy, and must not be read as a measure of assistance density |
| Which natural person each identity denotes | Operator (Q2-05) |
| Contractual and assignment position for each person | Operator holds the instruments; **counsel** assesses them (Q2-08) |
| The applicable law, and what it provides on authorship and copyright subsistence for AI-assisted works | **Counsel only** |

**The single most important negative finding: the trailer is commit-scoped, so no
line-level, file-level or function-level attribution exists anywhere in this repository, and none
can be manufactured.** Any authorship position that depends on knowing which parts of the codebase
were assisted is unbuildable on this evidence. A position must be constructible without it.

---

## 5. What a defensible written authorship position must state

**Artefact class: HUMAN-REQUIRED INPUT.** This section lists the questions the position must answer.
It does **not** answer them, and no answer may be inferred from the order or wording below.

A written position that would survive adversarial review has to state, at minimum:

1. **The factual record, unvarnished.** The §2–§3 figures as measured, including the 77.1% headline,
   the month-by-month step, the nine trailer variants and the one Cursor trailer. A position that
   omits or rounds down the marker density is worse than no position: the trailers are in the public
   commit history of the repository and are trivially recoverable by any reviewer who clones it.
2. **The limits of the record, explicitly.** Every row of §4, in the position's own words — above all
   that no intra-commit attribution exists and that the absence of a trailer proves nothing.
3. **What the trailer meant operationally**, as an operator declaration: what tool, under whose
   direction, with what human review step, and whether a human accepted each change before it was
   committed. This is H1 and nobody else can supply it.
4. **The identity-to-person mapping** (Q2-05), so that "three identities" is never left to be read
   as "three people" or as "three contributors of R&D personnel cost".
5. **The chain of rights**: for each person, the contract and any assignment instrument (Q2-08), and
   counsel's assessment of whether that chain is complete.
6. **The law relied on**, named, with counsel's reasoning — not a general statement that "the law
   permits it".
7. **The consequences for each dependent claim**, individually: Q2 personnel; Q3 copyright
   subsistence and ownership; and the specific claim-control rows in baseline §15 that depend on
   authorship. Baseline §13.2 (line 777) and §14 Q3 (line 798) both currently record the copyright
   basis as **BLOCKED**. A position that does not move that word to a defensible alternative has not
   done its job.
8. **What must not be said**, in operative language, so that it binds the operator's own future
   drafting. Baseline §15's "NOT SAFE" table (lines 848–867) is the model for this section's form.
9. **A statement of who authored the position and on what authority**, dated, so it is auditable.

Two further requirements that are structural rather than substantive:

- **The position must be written by counsel, not by the operator and not by engineering.** An
  operator-authored authorship opinion has no standing and, if a filing relies on it, creates the
  filing-integrity exposure BG-05 names (line 896).
- **The position must be datable to before any filing that depends on it.** A position produced after
  a challenge is worth far less than the same position produced before the filing.

---

## 6. DECISION REQUIRED — requires counsel

**This is the decision. It is not taken here, and nothing in this document should be read as
preferring one alternative.**

| Alternative | What it would mean | Consequences — stated as consequences, not as recommendations |
|---|---|---|
| **A — Full disclosure with a counsel-reviewed position** | Disclose the §2–§3 record and the §4 limits in the filing, accompanied by counsel's written position on authorship and copyright | Highest preparation cost and the longest lead time. Requires counsel to commit to a position on a question that may be unsettled in the applicable law. Removes the concealment exposure entirely, because there is nothing left to discover. Availability is `NOT AVAILABLE IN REPOSITORY — counsel must confirm they will opine` |
| **B — Disclosure without a position** | Disclose the record; state that the authorship question is under professional review and is not yet resolved | Cheaper and faster. Leaves Q3 copyright at **BLOCKED**, which is where baseline §13.2 and §14 Q3 already put it, so it forecloses any copyright-based claim for as long as it stands. Whether an incomplete answer is acceptable to the assessing body is `NOT AVAILABLE IN REPOSITORY — counsel to advise` |
| **C — Narrow the claim so authorship is not load-bearing** | Confine the filing to claims that do not depend on copyright subsistence or on personnel authorship — for example composition-of-primitives claims (baseline §14 Q1, line 781) rather than IP-ownership claims | Does not require the authorship question to be answered first, so it is the only alternative that can proceed while counsel is still engaged. Costs whatever the dropped claims were worth. Does **not** remove the Q2-05 personnel obligation, which stands independently. Requires counsel to confirm the narrowing is genuinely sufficient — an engineering judgement here would be worthless |
| **D — No position; proceed and say nothing** | File without addressing the authorship question at all | **This is the alternative BG-05 exists to flag.** The trailers are in the commit history and are recoverable by anyone with repository access. Baseline line 896 names the exposure as **filing integrity**. The consequences of a filing later found to have omitted a known material fact are a legal question and are `NOT AVAILABLE IN REPOSITORY — counsel to advise`. Listed here for completeness because a decision record that omits the do-nothing option is not a decision record |

**Decision owner:** operator, **on counsel's written advice**. Not engineering. Not this stream.

**Prerequisites before the decision can be taken:**

- Q2-05 — the identity-to-person mapping (H1, operator)
- Q2-08 — contracts and assignment instruments for every person on that roster (H1 then H2)
- §5.3 — the operator's factual declaration of what the trailer meant operationally (H1)
- Counsel engaged, briefed on this document, and willing to opine (H2)

**Until all four exist, no alternative can be selected and the baseline's `BLOCKED` on the copyright
basis (line 777) stands unchanged.**

---

## 7. Interim instruction to engineering and to the operator

Pending counsel's position, and following baseline §15's discipline of naming what must not be said:

1. **Do not state, imply or draft any position on authorship, copyright subsistence or ownership of
   the codebase**, in any document, filing, pitch, grant application or external communication.
   That includes drafting a "provisional" or "working" position. This document deliberately contains
   none.
2. **Do not remove, rewrite or suppress the commit trailers, and do not rewrite the history that
   contains them.** They are the factual record. Altering them after the question has been
   identified is materially worse than the question itself, for reasons that are self-evident.
3. **Do not delete the `.claude/worktrees/agent-*` directories** as a tidying action while BG-05 is
   open. They are cited evidence in baseline line 896. If they must be removed for an unrelated
   operational reason, record the state first.
4. **Do not offer the §2–§3 figures as personnel evidence.** They are commit metadata. Q2-05 and
   Q2-06 are H1 and remain `NOT AVAILABLE IN REPOSITORY`.
5. **Do not treat the 411 non-trailer commits as an unassisted subset.** §4 records that the absence
   of a trailer proves nothing, and any argument built on that subset would be unsound.

---

## 8. Status

| Item | Status |
|---|---|
| §2 identity inventory | **VERIFIED** at `af2fb6e9` |
| §3 AI-marker inventory | **VERIFIED** at `af2fb6e9` |
| §3.5 `agent-*` directories | **VERIFIED** present on disk; both at SHA `82754497` |
| §4 negative findings | **VERIFIED** — each is not recoverable from the repository |
| §5 requirements for a position | **PREPARATION** — a checklist, not a position |
| §6 the position itself | **DECISION REQUIRED — requires counsel.** **BLOCKED** on Q2-05, Q2-08, the operator declaration, and counsel engagement |
| Q3 copyright basis | **BLOCKED**, unchanged from baseline §13.2 line 777 and §14 Q3 line 798 |

---

*Artefact class: ENGINEERING ARTIFACT (§2–§4) + HUMAN-REQUIRED INPUT (§5–§7). Not DeepTech evidence.
Read-only throughout. No commit, PR, product-code change, network call, database access, credential
or `.env*` read. **No authorship is asserted, no copyright position is taken, no legal conclusion is
drawn, and no professional opinion is offered or simulated anywhere in this document.***
