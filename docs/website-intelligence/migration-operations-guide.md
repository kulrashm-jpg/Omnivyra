# Migration Operations Guide

Migration order:

1. `20260677_website_intelligence_foundation_phase1.sql`
2. `20260678_website_intelligence_operational_phase2.sql`
3. `20260679_website_intelligence_productization_phase3.sql`
4. `20260680_website_intelligence_phase4_plugin_hardening.sql`
5. `20260681_website_intelligence_phase5_validation_stabilization.sql`

Preflight:

```bash
npm run wi:migrations:validate
```

Rules:
- Migrations are additive.
- Do not assume destructive rollback.
- Prefer feature disabling over dropping tables.
- Tenant scoped data must be backfilled in small batches.

Rollback consideration:
- If application behavior regresses, disable setup-token creation and pause workers.
- Keep schema objects in place unless a DBA approves a rollback script.
