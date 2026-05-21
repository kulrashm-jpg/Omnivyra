# Production Deploy Governance

Authoritative deployment, builder, and schema-ledger rules for Omnivyra
production. Established during the production-closure phase (2026-05-22).

## 1. Deployment source of truth

| Plane | Authoritative source | Path |
|---|---|---|
| Web / API (Vercel `omnivyra`, www.omnivyra.com) | repo `kulrashm-jpg/Omnivyra` branch `main` | manual `vercel --prod` from a clean checkout of `origin/main` |
| Worker (Railway `authentic-nature` → service `Omnivyra`) | repo `kulrashm-jpg/Omnivyra` branch `main` | Railway auto-deploy on push to `main` |

- Authoritative repo: `kulrashm-jpg/Omnivyra`. Authoritative branch: `main`.
- Deploy ONLY a clean, committed `origin/main` checkout. `scripts/predeploy-check.js`
  blocks dirty-tree / non-`origin/main` / worker-typecheck-failing deploys.
- A dirty working tree must NOT be deployed. When `main` carries in-flight WIP,
  deploy from an isolated `git worktree` of the target commit.

## 2. Builder governance

- The Railway worker MUST build with the **Dockerfile** builder
  (`Dockerfile.worker`), never RAILPACK/NIXPACKS.
- Enforced in-repo by `railway.json` (`build.builder = DOCKERFILE`,
  `dockerfilePath = Dockerfile.worker`). Any deploy that builds from the repo
  honors this.
- Known drift: the Railway **service-default** builder is `railpack`. It only
  affects deploys that bypass `railway.json` (e.g. a bare `railway up` from a
  workspace without the repo). Correct it once in the Railway dashboard:
  service `Omnivyra` → Settings → Build → Builder = Dockerfile.

## 3. Deploy-actor governance

- Exactly ONE authoritative deploy actor per plane (see §1).
- Unauthorized deploy actors are forbidden. Observed and to be removed:
  a "Codex workspace" issuing `railway up` to service `Omnivyra` — these
  bypass `railway.json`, fall back to RAILPACK, and fail. Revoke that
  workspace's Railway access / stop that agent.
- Do not run concurrent deploy agents against the same production service.

## 4. SHA divergence decision (2026-05-22)

- Railway worker SHA: `6ab41677` ("Pendig1" — full billing/editorial WIP merged
  to `main`; worker-typecheck clean; deployed `5b71f0aa` SUCCESS).
- Vercel SHA: `c83ce709` (last verified-good Vercel build).
- **Decision: divergence FROZEN, intentionally.** Vercel is NOT advanced to
  `6ab41677` until: (a) `6ab41677`'s Next.js/Vercel build is verified, (b) the
  concurrent agent is not mid-edit, (c) publishing the billing/editorial WIP to
  the public site is deliberately approved. Advancing Vercel is a deliberate,
  verified action — never a blind redeploy.
- Authoritative production SHA = `6ab41677` (`main` HEAD). Vercel lag is a
  documented, accepted divergence, not an incident.

## 5. Migration ledger governance

- **Rule:** production schema MUST NOT be mutated directly without a
  corresponding migration file in `supabase/migrations/` and ledger alignment.
  Ad-hoc `ALTER`/`CREATE` against production is forbidden except as a
  migration file that is also recorded.
- The production migration ledger is known to be desynced (schema ahead of the
  recorded ledger). Until reconciled, treat the ledger as advisory and never
  bulk `db:push`.
- **Check:** run `npm run check:schema-drift` before any schema-affecting
  deploy; investigate drift before proceeding.
- Migration discipline: one change = one dated migration file; never edit an
  already-applied migration; never hand-run SQL that is not also committed as a
  migration.
