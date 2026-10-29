# B0 owner checklist: recover executed SQL text from the Supabase SQL Editor

Who: the project owner, signed in to the Supabase Dashboard for project ref `klkiseupptzbecbxwrky`.
Agents have no dashboard access and do not do this step.
Goal: find the text that was actually **executed** in production. That text can differ from the text **committed** in Git. Export it byte-exact and record its provenance.

## 0. Safety rules (read first)

1. **Never press Run** (or Ctrl/Cmd+Enter) in any tab you open for this task. Each of these texts is a production DDL/ACL change. Running one again is a new production change, not a recovery.
2. **Never type in a recovered snippet or history buffer.** The SQL Editor autosaves snippets, so any keystroke overwrites the evidence. Do not use "Format SQL" / prettify either. Select-all and copy are the only allowed actions.
3. Do not rename, move, share, favourite or delete snippets while you search. Moving a snippet between lists changes its metadata.
4. **If a text is not found, record it as UNRECOVERABLE.** Never write, reconstruct, retype or "fix up" a missing text, least of all the 8-table revoke. A partial text is recorded as partial (see §4). It is never completed by hand.
5. Do not paste any recovered text into chat, tickets or Git. Hand over the exported **file**.

## 1. What to look for (artifact, time windows, search strings)

All times are UTC (IST = UTC+5:30). Search the primary window first, then the extended one.

| Artifact id | Committed text (Git) | How it was executed (evidence) | Primary window | Extended window | Search strings (try each) |
|---|---|---|---|---|---|
| `fix3` | `supabase/migrations/20261212000000_content_quality_collaboration_tenant_consistent.sql`. 179,332 bytes, 2,971 LF lines, no BOM, non-ASCII UTF-8 present. sha256 `581926201d268d5bde34b6a6b7be4ee118bac3ed8d62ef88756e7030b2d445d5` | Applied by the owner on 2026-10-23, as part of "applied EVERY pending migration". The tool used is not recorded. The verifier's "Success. No rows returned" is SQL Editor output, which suggests the SQL Editor. | 2026-10-22 18:30Z → 2026-10-24 18:30Z (IST 23rd–24th) | 2026-10-12 → 2026-10-28 (earliest partial drafts are dated Oct 12) | `content_quality_collaboration_tenant_consistent`, `20261212000000`, `FIX3`, `content_approval_history`, `omnivyra_touch_updated_at`, `set_content_updated_at`, `content_quality_company_idx` |
| `fix3-verifier` (context only, not a gate artifact) | `supabase/migrations/_fix3_tenant_consistent/verification.sql` | Owner ran it; it returned "Success. No rows returned" | same as fix3, up to 2026-10-28 | — | `verification`, `_fix3`, `tenant_consistent` |
| `revoke8` | **None. No committed text exists anywhere.** | The owner reported it in memory on 2026-10-28 (note last modified 16:05Z). The tool used and the exact time are not recorded. | 2026-10-23 00:00Z → 2026-10-28 16:05Z | 2026-10-12 → 2026-10-28 23:59Z | `REVOKE`, `FROM authenticated`, `brand_memory`, `publication_lineage`, `content_originality`, `content_variant`, `content_revision` |
| `close_anon` | `supabase/migrations/20261026000000_close_anon_rls_exposure.sql`. 31,251 bytes, 759 LF lines, no BOM. sha256 `62e2371990ee020d255c9415bf3a76a7063e64f874b42d92364d3d37a589fc82` | Applied 2026-09-13 21:03:48Z with **`psql -1 -f`**, not the SQL Editor, so a hit is unlikely. Search anyway. | 2026-09-13 18:00Z → 2026-09-14 00:00Z | 2026-09-10 → 2026-09-20 | `close_anon`, `20261026000000`, `REVOKE ALL`, `ALTER DEFAULT PRIVILEGES`, `FROM anon` |

## 2. Where to look (record every place searched, including empty ones)

For each location below, write down "searched, hit" or "searched, no hit":

- [ ] SQL Editor → snippet list → **Private** (includes auto-saved "Untitled query" tabs; open each one in the windows above).
- [ ] SQL Editor → **Shared**.
- [ ] SQL Editor → **Favorites**.
- [ ] SQL Editor → **Community / Templates / Quickstarts**, if shown. These are only relevant if a template was edited and run.
- [ ] SQL Editor → **query history** panel or tab, if your dashboard version has one. Note how far back it goes: the oldest entry visible = the retention horizon actually observed.
- [ ] Every **open editor tab** restored in the browser (tabs can persist locally per browser profile). Check each browser and machine you used on those dates.
- [ ] If the dashboard search box searches snippet contents, try each search string. If it only searches titles, open the candidates in the time window and use the browser's find-in-page (Ctrl+F) on the editor. Note that the editor may only render visible lines, so scroll the whole buffer.

## 3. Byte-exact export (per hit)

Preferred, if offered: the snippet's **Download / Export** menu option. Save the file as-is and do not open it in an editor afterwards.

Otherwise, use the clipboard:

1. Click into the editor buffer and press Ctrl+A, then Ctrl+C. Do not press any other key.
2. Write the clipboard straight to a new file, with no editor in between. In Windows PowerShell 5.1:
   ```powershell
   $t = Get-Clipboard -Raw
   [IO.File]::WriteAllText("C:\gate4-recovered\<artifact>-<n>.sql", $t, (New-Object System.Text.UTF8Encoding $false))
   ```
   This writes UTF-8 **without** a BOM and adds no trailing newline. Do not use `Set-Content` or `Out-File`: in PS 5.1 they add a BOM or a newline, or re-encode the text.
3. Do **not** paste into Notepad, VS Code or Word first. These can add a BOM, convert line endings, trim trailing whitespace, or (Word) replace quotes.
4. Repeat for the next hit into a new file. Never overwrite a file.

**Known limitation (record it, do not fix it):** the text passes through the browser and the Windows clipboard. These can convert LF to CRLF, drop or add a final newline, and may turn special characters (non-breaking spaces, typographic quotes) into other characters. The best possible clipboard result is therefore `IDENTICAL_AFTER_EOL_NORMALIZATION`, not `BYTE_IDENTICAL`. A trailing-newline difference shows up as `DIFFERENT` with 0 line entries. Record it as a clipboard artifact; do not hand-edit the file to make it match.

## 4. Metadata to record per exported file

| Field | Example / rule |
|---|---|
| artifact id | `fix3` / `revoke8` / `close_anon` / `fix3-verifier` |
| source list | `history` / `snippet:Private` / `snippet:Shared` / `snippet:Favorites` / `open-tab` |
| snippet name or history entry | exactly as displayed |
| displayed timestamp(s) | as shown, **with the timezone the UI uses**. Note whether it is "last run", "created" or "updated". |
| author / user | if shown, as displayed |
| export method | `download` / `clipboard→WriteAllText` |
| export time | UTC, e.g. `2026-10-29T10:15:00Z` |
| byte count and sha256 | produced by the intake tool (`scripts/release/recovery-intake.js`). Do not compute these by hand. |
| completeness | `complete` / `partial (why)`. Example: the buffer contains only part of the file, or several statements were run piecemeal. |
| other hits | list every other version found, each exported to its own file. Multiple versions are evidence too. |

Then run, once per file:

```
node scripts/release/recovery-intake.js <fix3|close_anon|revoke8> <file> --source "<list> / <name>" --observed-at "<displayed timestamp + tz>" --exported-at "<UTC>" [--author "<as shown>"] --out <file>.intake.json
```

Hand over the `.sql` file and the `.intake.json` file unchanged.

## 5. Outcome per artifact (exactly one)

- **RECOVERED**, with an intake verdict: `BYTE_IDENTICAL`, `IDENTICAL_AFTER_EOL_NORMALIZATION`, `DIFFERENT` or `NO_REFERENCE_TEXT`. For revoke8 the recovered text becomes the record.
- **UNRECOVERABLE**: every location in §2 was searched across the extended window and nothing matched. The record reads: *"Executed SQL text unrecoverable from available evidence; exact equivalence is unprovable."* Then rely on the catalog fingerprint (plan B1/C1). Never reconstruct the text.

Recovered text is evidence of what text was *available in the editor*. It does not prove that this exact text was the one executed, unless the history entry shows that it ran. Byte verdicts are about the text only. Semantic equivalence (the resulting catalog state) is a separate check (B1/C1).
