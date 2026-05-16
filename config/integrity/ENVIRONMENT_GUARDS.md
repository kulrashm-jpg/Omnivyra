# Environment Guards

This directory contains read-only diagnostics for runtime and environment integrity. These checks are visibility tools only; they must not rewrite env files, rotate secrets, block startup, or call remote services.

Approved environment assumptions:

- Local development should use local Supabase targets unless a remote target is explicitly intended.
- `SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_DB_URL`, and `DATABASE_URL` should not silently point at different Supabase project refs.
- CI workflows should reference scripts that exist in the repository.
- Operator tools must require explicit target environment and mutation intent.
- Runtime startup must not invoke operator tools, auth repair tools, migrations, or database push commands.

Forbidden runtime behaviors:

- `npm run dev`, `npm run start`, and startup guards must not mutate auth, billing, schema, or data.
- Frontend bundles must not reference `SUPABASE_SERVICE_ROLE_KEY`.
- Runtime app code must not import `scripts/operator` or `scripts/archive`.
- Environment validators must not write `.env*` files or perform database mutations.

Safe operator expectations:

- Operator scripts live under `scripts/operator`.
- Mutation-capable operator scripts print banners, require `--target-env`, and require explicit mutation intent.
- Remote Supabase detection remains warn-only in this phase.

CI/runtime separation rules:

- CI should use local Supabase for replay/drift checks unless explicitly documented otherwise.
- Auth integrity CI may use configured secrets, but must keep those references explicit.
- CI path references should be checked before relying on workflow results.

Remote mutation expectations:

- This phase does not block remote mutation automatically.
- Remote mutation should only happen through operator scripts with explicit target env and production confirmation when applicable.
- Any hard blocking belongs to a later enforcement phase.
