Governance CI/CD Integration Templates

Inert templates. Every entry point invokes ONLY the canonical enforcement runtime (`enforce:governance`),
never an individual governance runtime — this prevents duplicate/competing enforcement.

- npm: `npm run enforce:governance -- --profile <Profile>`
- Git hooks: install `pre-commit.sh.template` / `pre-push.sh.template` into `.git/hooks/`.
- GitHub Actions: copy `*.workflow.yml.template` into `.github/workflows/`.

These are not activated automatically.
