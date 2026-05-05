# DB Schema Snapshot - 2026-05-05

This snapshot captures the identity-critical schema state before the user/org integrity refactor continues.

## Canonical Identity

- `users.organization_id uuid NOT NULL`
- `users.state user_state NOT NULL`
- `users.state` allowed values: `invited`, `pending`, `active`, `suspended`, `deleted`
- `users.organization_id` references `organizations(id)`
- Real organization table: `organizations`
- Compatibility view: `companies`
- Legacy `users.company_id` remains only as a migration/backward-compatibility field until the remaining API surface is cut over.
- State transitions are enforced by `trg_validate_user_state_transition`.

## Invites

- Invite table: `invitations`
- Required invite fields:
  - `expires_at timestamp with time zone NOT NULL`
  - `status text NOT NULL DEFAULT 'invited'`
- Invite status values: `invited`, `accepted`, `expired`
- Active invite uniqueness: `lower(email), organization_id WHERE status = 'invited'`
- Re-invite behavior must update the existing row and extend `expires_at`.

## Domains

- Domain table: `company_domains`
- Canonical domain key: `final_domain`
- Ownership rule: one `final_domain` maps to one `organization_id`.
- Active unique constraint expected: `UNIQUE(final_domain)`
- Verification proof columns exist: `verification_token`, `verification_method`, `verified_at`, `verification_status`.

## Freeze Rules

- Legacy API routes are frozen/deleted:
  - `pages/api/team/**`
  - `pages/api/company/users.ts`
- New migrations touching `company_domains` or `user_company_roles` must be blocked by `scripts/check-frozen-schemas.ts` unless explicitly approved.
- Quarantined domain migrations `20260609*` through `20260617*` must remain out of the active migration path.
