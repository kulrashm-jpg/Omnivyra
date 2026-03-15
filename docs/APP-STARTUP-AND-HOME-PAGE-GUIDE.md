# App Startup & Home Page Guide

This document explains how the app starts, why the home page loads reliably, and how to run the full intelligence pipeline when needed.

## Quick Start: See the Home Page

```powershell
npm run dev
```

Then open **http://localhost:3000**. The home page should load.

## What Changed (Stable Solution)

### 1. Workers Disabled by Default

The instrumentation hook (`instrumentation.ts`) **no longer auto-starts workers** by default. Previously it imported BullMQ/Redis on every server start, which caused:

- "Module not found: path/os/net" build errors (Node built-ins not resolved by webpack)
- Slow startup
- 500 errors if Redis wasn't running

**Now:** Workers are skipped unless you explicitly set `ENABLE_AUTO_WORKERS=1`. The Next.js app (pages, API routes) starts without BullMQ.

### 2. Comprehensive Node Built-in Externals

`next.config.js` adds all Node.js built-ins that BullMQ and ioredis use to webpack externals:

- `path`, `os`, `fs`, `net`, `tls`, `worker_threads`, `child_process`, `crypto`, `dns`, `http`, `https`, etc.

This allows the build to succeed when workers *are* enabled.

### 3. serverExternalPackages

`bullmq` and `ioredis` are in `serverExternalPackages`, so they are not bundled—Node loads them at runtime.

## Running the Full Pipeline (Workers + Cron)

When you need the intelligence pipeline (polling, clustering, scheduling):

**Option A: One command – auto-start all** (recommended)

```powershell
npm run dev:full
```

This script:
1. Waits for Redis (required – start with `docker run -d -p 6379:6379 redis:7` if needed)
2. Starts workers (BullMQ)
3. Starts cron (scheduler)
4. Starts Next.js dev server

Press **Ctrl+C** to stop all services.

**Option B: Enable auto-workers** (workers inside Next.js process, requires Redis)

```powershell
$env:ENABLE_AUTO_WORKERS="1"; npm run dev
```

**Option C: Run workers separately** (manual, 3 terminals)

Terminal 1 – Next.js app:
```powershell
npm run dev
```

Terminal 2 – Workers:
```powershell
npm run start:workers
```

Terminal 3 – Cron scheduler:
```powershell
npm run start:cron
```

## Build

```powershell
npm run build
```

Uses webpack (`--webpack`). The build compiles the instrumentation chunk (including workers) but workers do not run at build time.

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Home page 500 | Ensure `ENABLE_AUTO_WORKERS` is not set (or is 0). Workers off = app loads. |
| "Module not found: X" | Add the Node built-in to the `nodeBuiltins` array in `next.config.js`. |
| Workers not starting | Set `ENABLE_AUTO_WORKERS=1` and ensure Redis is running (`npm run setup:redis`). |
| Build fails on TypeScript | Run `npm run typecheck` to see errors; fix in the reported file. |

## Summary

- **Default:** `npm run dev` → home page works, no workers
- **Full pipeline:** Set `ENABLE_AUTO_WORKERS=1` or run `start:workers` + `start:cron` in separate terminals
