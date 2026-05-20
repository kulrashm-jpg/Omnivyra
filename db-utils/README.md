# Legacy Database Utilities

This folder is not production schema authority.

Production schema changes must be promoted into timestamped files under:

```text
supabase/migrations/
```

Do not apply SQL from this folder directly with `psql`, Supabase SQL Editor, or `exec_sql`.

Current status:

- `*.sql` files here are legacy reference material only.
- Direct runners that previously applied these files are disabled by schema governance.
- Any still-needed statement must be copied into a reviewed Supabase migration before execution.
