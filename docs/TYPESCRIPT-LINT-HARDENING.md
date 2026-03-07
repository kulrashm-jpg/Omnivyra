# TypeScript & Lint Hardening

## Summary

This document describes the hardening measures in place to prevent TypeScript and lint errors from recurring.

## Fixes Applied (2024)

### 1. Lucide icon imports (multi-platform-scheduler, scheduling-dashboard)

**Problem:** `Users`, `Hash`, `Image`, `Video`, `Facebook`, `Globe` were used as JSX components without being imported. `Image` also conflicts with the DOM `Image` constructor.

**Fix:** Always import Lucide icons explicitly. Use `Image as ImageIcon` when using the Lucide Image icon to avoid conflict with `next/image` or DOM Image.

```tsx
// ✅ Correct
import { Users, Hash, Image as ImageIcon, Video, Facebook } from 'lucide-react';
<ImageIcon className="h-5 w-5" />

// ❌ Wrong – Image resolves to DOM constructor, not a React component
<Image className="h-5 w-5" />
```

### 2. companyTrendRelevanceEngine array typing

**Problem:** `arr` from `Array.isArray(...) ? value : []` was typed as `unknown`, so `.length` failed.

**Fix:** Assert to `unknown[]` when you know it's an array:

```ts
const arr = (Array.isArray(x) ? x : []) as unknown[];
```

### 3. externalApiService healthMap duplicate

**Problem:** Duplicate `let healthMap` declarations caused build errors.

**Fix:** Extracted `fetchHealthMapForApiIds()` helper. Single `const healthMap = await fetchHealthMapForApiIds(apiIds)` in callers.

## Scripts

| Script | Purpose |
|--------|---------|
| `npm run typecheck` | Run `tsc --noEmit` to catch TypeScript errors |
| `npm run lint` | Run ESLint (`--max-warnings 200`; fix warnings over time) |
| `npm run lint:fix` | ESLint with auto-fix |
| `npm run build` | Full Next.js build (includes TypeScript check) |

## Pre-commit recommendation

Add to `.husky/pre-commit` or equivalent:

```sh
npm run typecheck && npm run lint
```

## tsconfig.json

- `strict: false` – Kept off to avoid large breaking changes; can enable gradually.
- Consider enabling: `noImplicitReturns`, `noFallthroughCasesInSwitch` for stricter checks.

## ESLint configuration

- **Extends:** `next/core-web-vitals`
- **Rules:**
  - `@typescript-eslint/no-unused-vars`: warn (args starting with `_` ignored)
  - `@typescript-eslint/no-explicit-any`: off (codebase uses `any` widely; enable gradually per-directory if desired)
