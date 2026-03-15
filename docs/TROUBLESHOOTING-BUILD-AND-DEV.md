# Troubleshooting: Build & Dev Errors

This document covers common errors and how to fix them.

## Quick Fix: Clear Cache & Update

When you see multiple cascading errors (node:crypto, runContentOpportunityEngine, webpack cache, etc.), run:

```powershell
npm run clean
npm run update:browserslist
npm run dev
```

Or use the combined command:

```powershell
npm run fresh
```

---

## Error: node:crypto / UnhandledSchemeError

**Symptom:** `Reading from "node:crypto" is not handled by plugins (Unhandled scheme)`

**Cause:** Webpack doesn't resolve `node:`-prefixed imports by default.

**Fix:**
1. `backend/auth/tokenStore.ts` uses `import crypto from 'crypto'` (not `node:crypto`)
2. `next.config.js` has resolve aliases: `node:crypto` → `crypto`, and `node:*` externals
3. If it persists, clear cache: `npm run clean` then `npm run dev`

---

## Error: runContentOpportunityEngine already declared

**Symptom:** `Identifier 'runContentOpportunityEngine' has already been declared`

**Cause:** Often from corrupted webpack cache or stale build artifacts.

**Fix:**
```powershell
npm run clean
npm run dev
```

---

## Error: Browserslist data is 6 months old

**Symptom:** `Browserslist: browsers data (caniuse-lite) is 6 months old`

**Fix:**
```powershell
npm run update:browserslist
```

---

## Error: Webpack cache (incorrect header check / ENOENT)

**Symptom:** `Restoring pack failed... Error: incorrect header check` or `Caching failed... ENOENT`

**Cause:** Corrupted `.next` cache.

**Fix:**
```powershell
npm run clean
npm run dev
```

---

## Error: GET / 500

**Symptom:** Home page returns 500.

**Possible causes:**
1. Workers auto-starting when Redis isn't running → Use `npm run dev` (workers off by default)
2. Corrupted cache → `npm run clean && npm run dev`
3. Missing env vars → Check `.env.local` has `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, etc.

---

## Scripts Reference

| Script | Purpose |
|--------|---------|
| `npm run clean` | Remove `.next` build cache |
| `npm run update:browserslist` | Update caniuse-lite browser data |
| `npm run fresh` | Clean + update browserslist + dev |
| `npm run dev` | App only (no workers) |
| `npm run dev:full` | App + workers + cron (requires Redis) |
