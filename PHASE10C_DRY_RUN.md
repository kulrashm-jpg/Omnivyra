# PHASE10C_DRY_RUN.md

Real company identity backfill — dry-run (no writes). Generated 2026-06-22T18:29:42.590Z.

- Eligible rows: **0/3** (assertion FAIL)

## Current → target

| company_id | name | current website | current website_domain | target website | target website_domain |
|---|---|---|---|---|---|
| 4dae7f7a-b518-4557-b8cb-5c6123ff9658 | Drishiq | "https://www.drishiq.com" | "drishiq.com" | https://www.drishiq.com | drishiq.com |
| 73e5fa6f-822d-4eb5-8c85-42d79b25f394 | Embrosales | "https://www.embrosales.in" | "embrosales.in" | https://www.embrosales.in | embrosales.in |
| 7a606a40-4d8e-4d23-b967-3df0ca4b0c8a | Unfinished Innovations LLP | "https://www.nothingelsematterz.com" | "nothingelsematterz.com" | https://www.nothingelsematterz.com | nothingelsematterz.com |

## Guard results (all must be true)

| name | idMatch | nameMatch | websiteNull | websiteDomainNull | adminMatch | eligible |
|---|---|---|---|---|---|---|
| Drishiq | true | true | false | false | true | false |
| Embrosales | true | true | false | false | true | false |
| Unfinished Innovations LLP | true | true | false | false | true | false |


❌ Not all eligible — apply would ABORT (no writes).
