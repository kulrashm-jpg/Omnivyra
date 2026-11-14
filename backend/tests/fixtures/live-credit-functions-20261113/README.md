# Live prod function bodies (read-only extraction, 2026-11-13, virality-83)

Source: owner-approved read-only catalog query C100 (record closure-r28/C100-EXECUTION-RECORD-2026-11-13T17-48-19-723Z.json).
Each file is the exact `pg_proc.prosrc` (body between the dollar quotes), LF only, no CR.

| File | Function | md5(prosrc) | Note |
|---|---|---|---|
| LIVE-apply_credit_partial_confirm.prosrc.sql | apply_credit_partial_confirm (10 args) | ff208f60617a7a272305a804037bf47d | matches NO repo version (hand-applied/edited); not SECURITY DEFINER; search_path=public, extensions |
| LIVE-apply_credit_reservation.prosrc.sql | apply_credit_reservation (12 args) | ad5383bf6ccf24a2c8ddee70db3b1297 | byte-identical to 20260322_expiry_category_guard (extracted from that file; md5 equals prod) |
| LIVE-expire_org_free_credits.prosrc.sql | expire_org_free_credits(uuid,int,text) | ae410c7ab297eebe2890a7f925d95f04 | = 20260323_remove_balance_credits; 20260625 meant to DROP it |

EXECUTE grantees for all five credit functions: postgres, service_role only (no PUBLIC/anon/authenticated).
Input for migration 20270217000053 credit_settle_guards_reauthor (e1); review 05.
