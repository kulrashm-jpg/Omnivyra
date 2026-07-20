# Worktree Isolation Standard (GOV-IMPLEMENT-001)

**Status:** canonical engineering workflow standard. Repository governance only — no
product code, runtime, deployment, or CI impact. Built entirely on native `git worktree`;
no wrappers, no new tooling.

> **Why this exists (evidence, not theory).** During the Writer release, a concurrent
> governance-automation workstream sharing the *same checkout and the same branch*
> repeatedly modified `package.json`, `.gitignore`, `predeploy-check.js`, and then
> **committed three governance commits directly onto the Writer release branch**
> (`feat/writer-wave0-stabilization`), touching 545+ files. The certified baseline commit
> survived (immutable), but the branch tip no longer represented the certified release.
> Worktree isolation eliminates this class of contamination structurally.

---

## 1. Principle

One **working directory + index per concurrent workstream**, all sharing one `.git` object
store. A workstream's files, staging, and branch are invisible to every other workstream.
`git worktree` provides this natively — validated in this repo: a file written in a sibling
worktree does not appear in the main checkout's `git status` (isolation confirmed), and
`git worktree remove` restores the prior state with zero effect on the main checkout.

**Hard rules**
1. Every concurrent workstream (human or AI agent) runs in its **own worktree**.
2. Two workstreams **never** share a branch or a checkout.
3. **Never `git add -A` / `git add .`** — stage explicit paths only.
4. Worktrees live **outside** the main repo directory (siblings), so they can never appear
   in the main checkout's status.

## 2. Directory & Naming Convention

Worktrees are **siblings** of the main checkout (parent of `C:/virality`), never nested inside it:

```
<parent>/
  virality/                     ← main checkout (integration; usually `main`)
  omnivyra-wt-<purpose>-<branch>/   ← one per workstream
```

| Purpose | Worktree dir | Branch |
|---|---|---|
| Feature | `omnivyra-wt-feat-<slug>` | `feat/<slug>` |
| Fix | `omnivyra-wt-fix-<slug>` | `fix/<slug>` |
| Chore/repo | `omnivyra-wt-chore-<slug>` | `chore/<slug>` |
| Governance | `omnivyra-wt-gov-<slug>` | `governance/<slug>` |
| Release prep | `omnivyra-wt-release-<ver>` | `release/<ver>` |
| Hotfix | `omnivyra-wt-hotfix-<slug>` | `hotfix/<slug>` |
| Experiment | `omnivyra-wt-exp-<slug>` | `exp/<slug>` (disposable) |

Branch prefixes match the existing convention (`feat/`, `fix/`, `chore/`). Nothing changes
about branch naming — only that each branch gets its own worktree.

## 3. Lifecycle

**Create**
```bash
# from the main checkout
git worktree add ../omnivyra-wt-feat-scheduler -b feat/scheduler   # new branch
git worktree add ../omnivyra-wt-gov-adoption   governance/adoption # existing branch
```

**Work** — `cd ../omnivyra-wt-feat-scheduler`; edit, commit, push as normal. Fully isolated.

**List / inspect**
```bash
git worktree list        # shows every worktree, its branch, and HEAD
```

**Clean up (after merge or abandonment)**
```bash
git worktree remove ../omnivyra-wt-feat-scheduler     # refuses if uncommitted changes
git worktree remove --force ../omnivyra-wt-exp-throwaway   # discard a disposable one
git worktree prune       # tidy stale administrative entries
```

**Archival** — none needed; the branch/commits persist in the shared object store after the
worktree directory is removed. Delete the branch only when its work is merged or abandoned.

## 4. Operational Workflows

| Task | Command flow |
|---|---|
| Start work | `git worktree add ../omnivyra-wt-<type>-<slug> -b <type>/<slug>` → `cd` in |
| Open PR | push the branch; open PR against `main` (unchanged) |
| Rebase | inside the worktree: `git fetch && git rebase origin/main` |
| Merge | merge the PR/branch into `main` from the integration checkout |
| Release prep | dedicated `release/<ver>` worktree; certify there; merge the **certified commit** |
| Production hotfix | `git worktree add ../omnivyra-wt-hotfix-<slug> -b hotfix/<slug>`; fast path; merge; remove |
| Abandon work | `git worktree remove --force …`; delete the branch |
| Clean worktrees | `git worktree remove …` then `git worktree prune` |

The **integration checkout** (`C:/virality`) should stay on `main` (or the branch being
merged) and is not used for concurrent feature work.

## 5. AI-Agent Isolation Design

Every agent role gets a dedicated worktree; none share a checkout or branch:

| Agent role | Worktree | Guarantee |
|---|---|---|
| Implementation agent | `omnivyra-wt-feat-<slug>` | its edits/commits invisible to others |
| Audit / review agent | read-only in its own worktree or the integration checkout | never writes shared files |
| Certification agent | `omnivyra-wt-release-<ver>` | certifies an isolated tree |
| Release agent | integration checkout, merges **certified commits by SHA** | never picks up another stream's tip |
| Hotfix agent | `omnivyra-wt-hotfix-<slug>` | independent of in-flight features |
| Experimental | `omnivyra-wt-exp-<slug>` (`--force` removable) | disposable, no trace |

**Contamination prevention:** because each agent's index and files are private, no agent can
stage, commit, or overwrite another's work — the failure observed during the Writer release
(governance commits landing on the Writer branch) is structurally impossible when the
governance agent runs in `omnivyra-wt-gov-*` on `governance/*`.

## 6. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `fatal: '<branch>' is already checked out at '<path>'` | a branch can be checked out in only one worktree | work on it there, or use a different branch |
| Stale worktree after manual dir delete | administrative entry left behind | `git worktree prune` |
| `worktree remove` refuses | uncommitted changes present | commit/stash, or `--force` to discard |
| Main checkout shows unexpected files | a workstream ran *in* the main checkout | move it to its own worktree; `git checkout -- <files>` |

## 7. Common Mistakes

- **Nesting a worktree inside `C:/virality`** — makes it visible to the main checkout. Always use siblings.
- **Sharing a branch between two agents** — Git blocks the second checkout; use distinct branches.
- **`git add -A`** — sweeps any co-located pollution into a commit. Stage explicit paths.
- **Merging a branch tip that mixes workstreams** — merge the **certified commit by SHA** instead.

## 8. Emergency Procedures

- **Contaminated release branch** (another stream committed onto it): do **not** rewrite/reset the
  shared branch (that destroys the other stream's work). Instead merge the **certified commit SHA**
  into `main` (`git merge --ff-only <certified-sha>`), and have the other stream relocate its
  commits onto its own `governance/*` branch + worktree.
- **Urgent hotfix during heavy concurrency:** spin a fresh `omnivyra-wt-hotfix-*` worktree; it is
  unaffected by any in-flight worktree state.

## 9. Migration (from the current shared-checkout workflow)

1. **Coexistence:** worktrees and the current checkout coexist immediately — no cutover moment.
   Existing worktrees (`C:/tmp/omnivyra-deploy`, etc.) already prove this.
2. **Adopt per new workstream:** the next time a concurrent stream starts, create a worktree for
   it instead of sharing the checkout. No retroactive migration of in-flight work is required.
3. **Move active automation** (the governance workstream) into `omnivyra-wt-gov-*` on a
   `governance/*` branch.
4. **Adoption checklist:** (a) integration checkout on `main`; (b) each active stream in its own
   worktree; (c) `git worktree list` shows one branch per worktree; (d) no `git add -A` in scripts.

Ongoing work is never interrupted — adoption is additive.

## 10. Rollback

Immediate and total, with no product/deploy impact:
```bash
git worktree remove <path>   # or --force
git worktree prune
```
Removing all worktrees returns to a single-checkout workflow exactly as before. Nothing in the
object store, branches, product code, runtime, or deployment is affected.
