# DB Utility (Supabase)

Minimal utility to inspect tables, columns, and sample rows in the Supabase
database configured in `.env.local`.

## Usage

```
node db-utility/db-inspector.js --list [--schema public] [--limit 200]
node db-utility/db-inspector.js --describe <table> [--schema public]
node db-utility/db-inspector.js --details <table> [--schema public]
node db-utility/db-inspector.js --sample <table> [--schema public] [--limit 5]
```

## Examples

```
node db-utility/db-inspector.js --list
node db-utility/db-inspector.js --describe user_company_roles
node db-utility/db-inspector.js --details user_company_roles
node db-utility/db-inspector.js --sample user_company_roles --limit 10
```
