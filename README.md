# Virality Engine - Social Media Management Platform

## 🚀 Features
- Content Scheduler with platform-specific formatting
- Live preview for LinkedIn & Twitter
- Modern UI with Tailwind CSS
- Next.js 15 with TypeScript

## 🛠️ Tech Stack
- Next.js 15
- React 18
- TypeScript
- Tailwind CSS
- Supabase
- BullMQ (Redis)

## 📁 Project Structure
- pages/ - Next.js pages
- components/ - Reusable UI components
- lib/ - Platform configurations
- utils/ - Utilities and helpers

## ⏱️ Community-AI Scheduler
See `docs/community-ai-scheduler.md` for how to run the scheduler manually or via cron/Task Scheduler.

## 🚀 Getting Started
```bash
npm install
cp .env.example .env.local
npm run env:validate
npm run dev
```

## Environment Setup
Minimum required variables:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `REDIS_URL`
- `ENCRYPTION_KEY`

Validation and lead-signal tooling:

- `npm run env:validate`
- `npm run lint:lead-signal-boundary`
- `npm run backfill`
- `npm run verify`
- `npm run check`
- `npm run inject:test-signal -- --organization-id <org-id>`
- `npm run test:lead-signals -- --organization-id <org-id>`

## 📝 License
MIT
