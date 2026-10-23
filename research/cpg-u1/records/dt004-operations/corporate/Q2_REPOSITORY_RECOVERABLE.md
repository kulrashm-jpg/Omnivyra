# Q2_REPOSITORY_RECOVERABLE

**Artefact class: ENGINEERING ARTIFACT.**
Every figure in this document is an **ENGINEERING ARTIFACT**. Not one of them is Q2 evidence.

> **The boundary, stated first because it governs every number below.**
> **Repository activity is evidence of development effort. It is NOT evidence of R&D expenditure
> and it is NOT evidence of capitalisation.** A commit records that a change was written and when it
> was recorded. It records nothing about who was paid, how much, under what contract, against which
> cost centre, or how the cost was treated in the books. **An accountant must map effort to cost**
> (items Q2-01 through Q2-04 and Q2-07 of `Q2_EVIDENCE_REQUEST_MATRIX.md`). Any use of a figure below
> as a spend or capitalisation figure is a misuse, and is exactly the overstatement
> `DEEPTECH_BASELINE_001` exists to prevent.

| Field | Value |
|---|---|
| Base SHA | `af2fb6e99ce461894bf16f18c2251f75088eba18` |
| HEAD commit date | `2026-09-24 06:04:59 +0530` |
| HEAD subject | `Merge pull request #270 from kulrashm-jpg/integrate/pi-t2-001` |
| Worktree | `C:/tmp/dt4-corp` (disposable, detached HEAD) |
| Scope | Items **Q2-14** and **Q2-15** of `Q2_EVIDENCE_REQUEST_MATRIX.md`, plus the vendor list **Q2-09a** |
| Commands | All read-only. Every figure carries the exact command that produced it |

---

## 0. Two method notes a reviewer must read before trusting any figure

### 0.1 The baseline's figures are at a different SHA

`DEEPTECH_BASELINE_001.md` §1 (lines 15–17) fixes itself at SHA
`82754497e8f9b64a893319e863941ad2994fd9b7`. This stream is fixed at
`af2fb6e99ce461894bf16f18c2251f75088eba18`. They are **not** in an ancestor relationship:

```bash
git merge-base --is-ancestor 82754497e8f9b64a893319e863941ad2994fd9b7 HEAD
# -> non-zero: 82754497 is NOT an ancestor of af2fb6e9
git rev-list --count 82754497e8f9b64a893319e863941ad2994fd9b7..HEAD
# -> 894
```

Every figure below is therefore **recomputed at `af2fb6e9`** and **not carried over** from the
baseline. Where a figure differs from the baseline's, both are shown and the difference is stated.
Nothing is silently amended.

### 0.2 The worktree index was empty at the start of this stream, and was populated during it

**Observation 1, at the start of the stream:**

```bash
git ls-files | wc -l            # -> 0
git ls-tree -r HEAD --name-only | wc -l   # -> 12370
git status --short | awk '{print $1}' | sort | uniq -c
# ->   251 ??
#    12370 D
```

The disposable worktree `C:/tmp/dt4-corp` presented with an unpopulated index: the files were
present on disk (260 top-level entries) but the index held zero entries, so git reported all 12,370
tracked paths as staged deletions. **This was a property of the worktree, never of the commit.**

Because of that, every file-inventory figure below is computed from `git ls-tree -r HEAD`, which
reads the commit object directly and is immune to index state.

**Observation 2, at the end of the stream:** the index is populated and the worktree is clean.

```bash
git ls-files | wc -l                      # -> 12370
git ls-tree -r HEAD --name-only | wc -l   # -> 12370
git status --short                         # -> ?? research/deeptech-operations/
git rev-parse HEAD                         # -> af2fb6e99ce461894bf16f18c2251f75088eba18 (unchanged)
```

**This stream did not repair the index** — no `git reset`, `git add`, `git checkout` or any other
index-writing command was issued, because that is a write to git state and this stream is read-only.
The change is recorded as observed and its cause is not attributed. HEAD is unchanged throughout.

**The two methods agree exactly, which is the useful outcome.** The test-file counts of §6 were
recomputed by both routes after the index populated:

```bash
git ls-files '*.test.ts' '*.test.tsx' | wc -l                      # -> 1897
git ls-files 'backend/tests/unit/*.test.ts' ... | wc -l            # -> 1680
git ls-files 'backend/tests/integration/*.test.ts' ... | wc -l     # -> 130
```

These match the `git ls-tree` figures in §6 exactly (1,897 / 1,680 / 130), so the baseline's own
`git ls-files` method (line 57) is reproduced and the inventory figures do not depend on which route
a reviewer takes.

---

## 1. What is recoverable, and what the ratio is

| Q2 item | Recoverable here? |
|---|---|
| Q2-14 — development period, volume, cadence | **YES** (§3, §4, §5) |
| Q2-15 — architecture/design deliberation record | **YES, with a caveat** (§5.3) |
| Q2-09a — the vendor list the invoices must cover | **YES** (§6) |
| Q2-01, Q2-02, Q2-03, Q2-04, Q2-05, Q2-06, Q2-07, Q2-08, Q2-09, Q2-10b, Q2-11, Q2-12, Q2-13 | **NO** — `NOT AVAILABLE IN REPOSITORY`; see `Q2_EVIDENCE_REQUEST_MATRIX.md` for who supplies each |

Three of sixteen. The baseline's "approx. 85% outside the repository" (line 785) holds at
`af2fb6e9`.

---

## 2. Development-activity timeline

**ENGINEERING ARTIFACT.**

| Fact | Value at `af2fb6e9` | Baseline value at `82754497` |
|---|---|---|
| First commit | `1d73f68247d0e8381b3538da4efe2fec5c74166a`, `2026-01-29 03:42:46 +0530`, author identity `drishiq1` | not stated |
| Last commit (HEAD) | `af2fb6e9...`, `2026-09-24 06:04:59 +0530`, author identity `kulrashm-jpg` | `2026-09-04 15:48:02 +0530` (line 25) |
| Window | `2026-01-29` -> `2026-09-24` | `2026-01 -> 2026-09` (line 55) |
| Total commits reachable from HEAD | **1,795** | 931 (line 54) |
| Non-merge commits | **1,510** | not stated |
| Merge commits | **285** | not stated |
| Distinct calendar days carrying at least one commit | **148** | not stated |

```bash
git log --reverse --format='%H %ad %an' --date=iso HEAD | head -1
git log -1 --format='%H %ad %an' --date=iso HEAD
git rev-list --count HEAD                 # -> 1795
git rev-list --count --no-merges HEAD     # -> 1510
git rev-list --count --merges HEAD        # -> 285
git log --format='%ad' --date=format:'%Y-%m-%d' HEAD | sort -u | wc -l   # -> 148
```

### 2.1 Commit distribution and active days by month

```bash
git log --format='%ad' --date=format:'%Y-%m' HEAD | sort | uniq -c | sort -k2
git log --format='%ad' --date=format:'%Y-%m-%d' HEAD | sort -u | cut -c1-7 | uniq -c
```

| Month | Commits at `af2fb6e9` | Baseline at `82754497` (line 56) | Distinct active days |
|---|---|---|---|
| 2026-01 | 3 | 3 | 2 |
| 2026-02 | 10 | 10 | 9 |
| 2026-03 | 37 | 37 | 14 |
| 2026-04 | 8 | 8 | 6 |
| 2026-05 | 117 | 117 | 20 |
| 2026-06 | 99 | 99 | 16 |
| 2026-07 | **528** | **528** | 28 |
| 2026-08 | **432** | 126 | 29 |
| 2026-09 | **561** | 3 | 24 |
| **Total** | **1,795** | 931 | **148** |

**2026-01 through 2026-07 reproduce the baseline exactly.** The divergence is confined to 2026-08 and
2026-09, which is consistent with `af2fb6e9` being 894 commits of later work on a different line of
development from the baseline's SHA.

**The "148 active days" column is the most honest cadence figure available and the one most easily
misread.** It means 148 distinct calendar dates carry at least one commit. It does **not** mean 148
days were worked, nor 148 days were paid, nor anything about hours. Q2-07 is the only instrument that
speaks to time allocation, and it is an operator declaration reviewed by a chartered accountant.

---

## 3. Authorship identity inventory

**ENGINEERING ARTIFACT.** See `BG05_AUTHORSHIP_POSITION.md` for what these identities do and do not
establish.

```bash
git shortlog -sne HEAD
git log --format='%ae' HEAD | sort -u
git log --format='%cn <%ce>' HEAD | sort | uniq -c | sort -rn
```

**Author identities — 3, over 2 email addresses:**

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

The baseline records "3 distinct author identities over 2 email addresses" (line 57). **That
reproduces exactly at `af2fb6e9`.** Two identities (`drishiq2-dot`, `drishiq1`) share one email
address, so the identity count overstates the number of distinct email holders; the 259 `GitHub`
committer entries are merge commits authored through the GitHub web or API surface, not a fourth
person.

> **An identity is a string in commit metadata. It is not a person.** The number of people, their
> engagement type and their qualifications are Q2-05 and Q2-06 and are `NOT AVAILABLE IN REPOSITORY
> — the operator supplies them`.

---

## 4. Commit and change volume by period

**ENGINEERING ARTIFACT.**

### 4.1 Source-only change volume (`.ts` / `.tsx`, non-merge)

This is the defensible variant. It excludes merge commits (which double-count), `node_modules`, and
binary paths.

```bash
git log --no-merges --numstat --format='C %ad' --date=format:'%Y-%m' HEAD | awk '
/^C /{m=$2; next}
NF==3 { f=$3
  if (f !~ /\.(ts|tsx)$/) next
  if (f ~ /node_modules/) next
  if ($1=="-" || $2=="-") next
  ins[m]+=$1; del[m]+=$2; ch[m]++ }
END { for (k in ins) printf "%s: %d ins, %d del, %d ts-file-changes\n", k, ins[k], del[k], ch[k] }' | sort
```

| Month | Insertions | Deletions | `.ts`/`.tsx` file-changes |
|---|---|---|---|
| 2026-01 | 81,648 | 723 | 425 |
| 2026-02 | 131,055 | 13,816 | 1,041 |
| 2026-03 | 252,712 | 35,644 | 2,380 |
| 2026-04 | 360,845 | 122,543 | 2,750 |
| 2026-05 | 572,805 | 70,423 | 4,736 |
| 2026-06 | 128,797 | 6,823 | 1,476 |
| 2026-07 | 331,515 | 149,400 | 4,253 |
| 2026-08 | 159,000 | 7,653 | 1,577 |
| 2026-09 | 166,503 | 6,338 | 1,662 |

### 4.2 All-paths change volume, and the outlier that makes it useless

```bash
git log --no-merges --numstat --format='C %ad' --date=format:'%Y-%m' HEAD | awk '
/^C /{m=$2; next}
NF==3 { f=$3
  if (f ~ /node_modules/) next
  if (f ~ /package-lock\.json$/) next
  if ($1=="-" || $2=="-") next
  ins[m]+=$1; del[m]+=$2; ch[m]++ }
END { for (k in ins) printf "%s: %d ins, %d del, %d file-changes\n", k, ins[k], del[k], ch[k] }' | sort
```

| Month | Insertions | Deletions | File-changes |
|---|---|---|---|
| 2026-01 | 122,946 | 944 | 702 |
| 2026-02 | 145,545 | 21,881 | 1,279 |
| 2026-03 | 343,271 | 35,922 | 3,156 |
| 2026-04 | 395,055 | 126,118 | 3,161 |
| **2026-05** | **36,107,025** | **34,263,876** | 5,886 |
| 2026-06 | 141,589 | 6,947 | 1,713 |
| **2026-07** | 391,115 | **1,440,781** | 5,329 |
| 2026-08 | 235,345 | 8,506 | 1,735 |
| 2026-09 | 202,437 | 7,307 | 2,011 |

**The 2026-05 figure is an artefact of one commit and must not be quoted.** Isolating it:

```bash
git log --no-merges --numstat --format='C %H %ad' --date=format:'%Y-%m' HEAD | awk '
/^C /{h=$2; m=$3; next}
NF==3 { if ($3 ~ /node_modules/) next; if ($1=="-") next; ins[h]+=$1; mo[h]=m }
END { for (k in ins) if (mo[k]=="2026-05") printf "%d %s\n", ins[k], k }' | sort -rn | head -5
git show --numstat --format='' d4335985d4c244cc20895bb9d1103f7b86113a22 | sort -rn | head -8
```

Commit `d4335985d4c244cc20895bb9d1103f7b86113a22` (`Sat May 9 02:28:20 2026 +0530`, identity
`drishiq2-dot`, subject `report wip`) alone accounts for **35,526,627** of the month's insertions.
Its largest paths are machine-generated JSON analysis outputs, each around 3 million lines:
`architecture-migration/reports/*/unsafe-propagation-semantic.json` and
`architecture-migration/reports/*/call-graph.json`. The corresponding 2026-07 deletion spike is
largely the removal of the same generated tree — at `af2fb6e9`, `architecture-migration/` holds only
**108 tracked files / 368,236 bytes** (§5).

**Stated plainly: a line-count spike caused by committing and later deleting generated tool output is
not development effort, and presenting the §4.2 totals as effort would be a material overstatement.**
Use §4.1. This is the same class of methodology error the baseline corrected in itself at D-01
(line 878), where a 215-flag figure was withdrawn because the scan had included
`.claude/worktrees/*/node_modules` and binary files.

---

## 5. Subsystem inventory with sizes

**ENGINEERING ARTIFACT.**

```bash
git ls-tree -r HEAD --name-only | wc -l    # -> 12370 tracked files
git ls-tree -r -l HEAD | awk '{ size=$4; path=$5; n=split(path,p,"/");
  top=(n>1? p[1] : "(root files)"); c[top]++; b[top]+=size }
  END { for (k in c) printf "%-40s %6d files %12d bytes\n", k, c[k], b[k] }' | sort -k2 -rn
```

**12,370 tracked files at `af2fb6e9`.**

| Top-level path | Tracked files | Bytes |
|---|---|---|
| `backend/` | 5,493 | 47,250,315 |
| `pages/` | 1,628 | 10,345,486 |
| `docs/` | 900 | 7,821,038 |
| `components/` | 827 | 9,911,528 |
| `lib/` | 740 | 6,177,792 |
| `research/` | 588 | 4,064,763 |
| `supabase/` | 456 | 4,460,707 |
| `scripts/` | 369 | 2,862,636 |
| `database/` | 329 | 870,505 |
| `public/` | 259 | 14,543,501 |
| `(root files)` | 306 | 4,776,354 |
| `architecture-migration/` | 108 | 368,236 |
| `hooks/` | 72 | 1,230,290 |
| `features/` | 39 | 206,471 |
| `archive/` | 32 | 443,739 |
| `tests/` | 31 | 119,039 |
| `utils/` | 25 | 73,840 |
| `db-utils/` | 23 | 210,723 |
| `modules/` | 20 | 232,158 |
| `config/` | 15 | 134,100 |
| `.github/` | 15 | 99,626 |
| `templates/` | 12 | 118,453 |
| `content/` | 11 | 447,903 |
| `platform/` | 10 | 2,696 |
| `shared/` | 9 | 73,458 |
| `observability/` | 9 | 24,694 |
| `wordpress-plugin/` | 8 | 30,753 |
| `monitoring/` | 7 | 23,738 |
| `assets/` | 6 | 1,672,253 |
| `telemetry/` | 5 | 22,268 |
| `types/` | 2 | 1,929 |
| `styles/` | 2 | 7,979 |
| `staging/` | 2 | 2,472 |
| `db-utility/` | 2 | 5,706 |
| `.claude/` | 2 | 4,476 |
| `variants/`, `store/`, `middleware/`, `generated/`, `eslint-rules/`, `community-ai/`, `analytics/`, `.vscode/` | 1 each | 1,465 / 7,514 / 3,960 / 6,398 / 3,184 / 301 / 218 / 1,294 |

### 5.1 Cross-cutting totals

```bash
git ls-tree -r -l HEAD | awk '$5 ~ /\.(ts|tsx)$/{c++; b+=$4} END{printf "ts/tsx: %d files, %d bytes\n", c, b}'
git ls-tree -r HEAD --name-only | grep -c '^supabase/migrations/.*\.sql$'
git ls-tree -r HEAD --name-only | grep -c '\.md$'
```

| Cross-cut | Value |
|---|---|
| Tracked `.ts` / `.tsx` files | **9,297** (78,068,610 bytes) |
| Tracked SQL migrations under `supabase/migrations/` | **448** |
| Tracked Markdown files | **1,160** |

### 5.2 `research/` is the frozen CPG-U1 tree

```bash
git ls-tree -r HEAD --name-only | grep -c '^research/'          # -> 588
git ls-tree -r HEAD --name-only | grep -c '^research/cpg-u1/'   # -> 588
git ls-tree -r HEAD --name-only | grep '^research/' | cut -d/ -f2 | sort -u   # -> cpg-u1
```

**All 588 tracked files under `research/` are under `research/cpg-u1/`.** At `af2fb6e9` there is no
`research/deeptech-operations/` in the commit; this stream's output is new, untracked, and cannot
collide with the frozen tree.

### 5.3 The Q2-15 caveat

The baseline supports Q2-15 on `docs/pmo/` and `docs/company-intelligence/` (line 790). At
`af2fb6e9`:

```bash
git ls-tree -r -l HEAD | awk '$5 ~ /^docs\/pmo\//{c++; b+=$4} END{printf "%d files, %d bytes\n", c, b}'
git ls-tree -r -l HEAD | awk '$5 ~ /^docs\/company-intelligence\//{c++; b+=$4} END{printf "%d files, %d bytes\n", c, b}'
```

| Path | Tracked files | Bytes |
|---|---|---|
| `docs/pmo/` | 142 | 1,690,360 |
| `docs/company-intelligence/` | 125 | 1,094,276 |

**This is a record of engineering deliberation, authored by the development effort itself.** It is not
a board record, not a minute, not an authorised budget, and not independent. Offering it in place of
Q2-13 would be a substitution a reviewer would catch and would be right to hold against the filing.

---

## 6. Test-suite counts

**ENGINEERING ARTIFACT.**

```bash
git ls-tree -r HEAD --name-only | grep -E '\.test\.(ts|tsx)$' | wc -l
git ls-tree -r HEAD --name-only | grep -E '^backend/tests/unit/.*\.test\.(ts|tsx)$' | wc -l
git ls-tree -r HEAD --name-only | grep -E '^backend/tests/integration/.*\.test\.(ts|tsx)$' | wc -l
git ls-tree -r HEAD --name-only | grep -E '\.test\.(ts|tsx)$' | grep -vE '^backend/tests/(unit|integration)/' | wc -l
git ls-tree -r HEAD --name-only | grep -E '\.spec\.(ts|tsx)$' | wc -l
```

| Bucket | Value at `af2fb6e9` | Baseline at `82754497` (line 58, D-10 line 885) |
|---|---|---|
| Tracked `*.test.ts` / `*.test.tsx` — total | **1,897** | 1,410 |
| `backend/tests/unit/` | **1,680** | 1,147 |
| `backend/tests/integration/` | **130** | 128 |
| Elsewhere | **87** | 135 |
| Tracked `*.spec.ts` / `*.spec.tsx` | **9** | not stated |

The first four rows were independently reproduced via `git ls-files` after the worktree index
populated (see §0.2) and agree exactly.

**These are counts of test *files*, not of test *cases*, and not of passing tests.** No test was
executed in this stream. A file count says nothing about coverage, and the baseline's own D-05
(line 882) records a live capability with **zero** test files referencing it, which is the exact
reason a headline test-file count must never be offered as a quality or effort claim.

---

## 7. Dependency inventory — answers Q2-09a

**ENGINEERING ARTIFACT.**

```bash
git show HEAD:package.json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
  const p=JSON.parse(s);
  console.log("dependencies:",Object.keys(p.dependencies||{}).length);
  console.log("devDependencies:",Object.keys(p.devDependencies||{}).length);
  console.log(Object.keys(p.dependencies||{}).sort().join("\n"));
  console.log(Object.keys(p.devDependencies||{}).sort().join("\n"));})'
```

| Bucket | Value at `af2fb6e9` | Baseline at `82754497` (lines 59–60) |
|---|---|---|
| Production dependencies | **52** | 52 |
| Dev dependencies | **18** | 18 |
| AI/ML dependencies | **`openai` — one, and only one** | same (line 61) |

**Both counts reproduce the baseline exactly.**

**Production dependencies (52):** `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`,
`@simplewebauthn/browser`, `@simplewebauthn/server`, `@sparticuz/chromium`, `@supabase/ssr`,
`@supabase/supabase-js`, `@tailwindcss/typography`, `@tiptap/extension-color`,
`@tiptap/extension-font-family`, `@tiptap/extension-image`, `@tiptap/extension-link`,
`@tiptap/extension-placeholder`, `@tiptap/extension-text-align`, `@tiptap/extension-text-style`,
`@tiptap/extension-underline`, `@tiptap/pm`, `@tiptap/react`, `@tiptap/starter-kit`,
`@types/formidable`, `@types/node`, `@vercel/functions`, `argon2`, `axios`, `bullmq`, `dotenv`,
`express`, `formidable`, `ioredis`, `isomorphic-dompurify`, `lucide-react`, `next`, `openai`,
`otplib`, `pdfkit`, `pg`, `playwright`, `puppeteer-core`, `react`, `react-dom`, `react-markdown`,
`recharts`, `rehype-raw`, `rehype-sanitize`, `sharp`, `swr`, `tailwindcss`, `tus-js-client`,
`undici`, `zod`, `zustand`.

**Dev dependencies (18):** `@babel/core`, `@jest/globals`, `@testing-library/dom`,
`@testing-library/jest-dom`, `@testing-library/react`, `@types/express`, `@types/jest`,
`@types/react`, `autoprefixer`, `eslint`, `eslint-config-next`, `jest`, `jest-environment-jsdom`,
`postcss`, `ts-jest`, `ts-node`, `tsx`, `typescript`.

**No ML framework is present** — no `torch`, `tensorflow`, `onnx`, `transformers`, `langchain`,
`cohere`, `pinecone` or `weaviate` appears in either list, consistent with baseline line 62.

### 7.1 The vendor list Q2-09 invoices must cover

Derived from baseline §14 Q6 (lines 812–817) and corroborated by the manifest above:

| Vendor / service | Repository corroboration at `af2fb6e9` |
|---|---|
| OpenAI (models and embeddings) | `openai` — the sole AI/ML production dependency |
| Supabase (database, auth, storage) | `@supabase/supabase-js`, `@supabase/ssr`; 448 tracked migrations |
| Vercel (application hosting) | `@vercel/functions`, `vercel.json`, `.vercelignore` |
| Railway (worker hosting) | `.railwayignore`; baseline §14 Q6 line 817 |
| Upstash (Redis) | `ioredis`, `bullmq`; baseline §14 Q6 line 817 |

**Amounts are `NOT AVAILABLE IN REPOSITORY — the vendor issues the invoice and the operator downloads
it` (Q2-09, Q2-10b).** The repository proves only which vendors the system depends on. It cannot
prove that any of them was paid, or by whom, or how much. `usageLedgerService` and `pricingService`
are metering code — they are the reason the baseline rates model/API spend `PARTIAL` (line 791), not
a reason to rate it higher.

---

## 8. Summary — and what none of this is

| # | Figure | Value at `af2fb6e9` | Class |
|---|---|---|---|
| 1 | Development window | `2026-01-29` -> `2026-09-24` | ENGINEERING ARTIFACT |
| 2 | Commits reachable from HEAD | 1,795 (1,510 non-merge, 285 merge) | ENGINEERING ARTIFACT |
| 3 | Distinct active calendar days | 148 | ENGINEERING ARTIFACT |
| 4 | Author identities / email addresses | 3 / 2 | ENGINEERING ARTIFACT |
| 5 | Committer identities | 4 (incl. `GitHub <noreply@github.com>`, 259 merges) | ENGINEERING ARTIFACT |
| 6 | Tracked files | 12,370 | ENGINEERING ARTIFACT |
| 7 | Tracked `.ts`/`.tsx` | 9,297 (78,068,610 bytes) | ENGINEERING ARTIFACT |
| 8 | Tracked test files | 1,897 (1,680 unit / 130 integration / 87 other) | ENGINEERING ARTIFACT |
| 9 | Tracked SQL migrations | 448 | ENGINEERING ARTIFACT |
| 10 | Tracked Markdown | 1,160 | ENGINEERING ARTIFACT |
| 11 | Production / dev dependencies | 52 / 18; `openai` the only AI/ML dependency | ENGINEERING ARTIFACT |
| 12 | Source-only monthly change volume | §4.1 table | ENGINEERING ARTIFACT |
| 13 | Subsystem inventory | §5 table | ENGINEERING ARTIFACT |

**None of the thirteen is:**

- an R&D expenditure figure (`NOT AVAILABLE IN REPOSITORY — chartered accountant, Q2-01/Q2-02`);
- a capitalised-vs-expensed split (`NOT AVAILABLE IN REPOSITORY — chartered accountant, Q2-03`);
- a personnel count, roster or qualification record (`NOT AVAILABLE IN REPOSITORY — operator,
  Q2-05/Q2-06`);
- a time-allocation record (`NOT AVAILABLE IN REPOSITORY — operator, reviewed by CA, Q2-07`);
- an invoice, receipt, payroll record or bank statement (`NOT AVAILABLE IN REPOSITORY — vendor /
  operator / bank, Q2-04/Q2-09/Q2-10b/Q2-11`);
- a board or statutory record (`NOT AVAILABLE IN REPOSITORY — company secretary, Q2-12/Q2-13`);
- DPIIT evidence of any kind.

**An accountant must map effort to cost. Until that mapping exists, signed and dated, Q2 remains
ABSENT exactly as `DEEPTECH_BASELINE_001.md:785` records it.**

---

*Artefact class: ENGINEERING ARTIFACT. Read-only throughout. No commit, PR, product-code change,
network call, database access, credential or `.env*` read. No test was executed. No financial figure,
date, identity, professional opinion or legal conclusion is asserted.*
