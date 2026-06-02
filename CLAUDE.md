# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

**Next.js (root)**
```bash
bun dev          # start dev server on http://localhost:3000
bun build        # production build
bun start        # start production server
bun lint         # run ESLint
```

**Cloudflare Worker (`worker/`)**
```bash
cd worker
bun run dev      # local dev via wrangler dev
bun run deploy   # deploy to Cloudflare
```

> Use **bun** as the package manager (`bun add <pkg>`).

## Architecture

Two separate projects in the same repo:

### `/` — Next.js 16 (frontend only)

App Router with TypeScript and Tailwind CSS v4. Path alias `@/*` → `src/*`.

- `src/app/page.tsx` — Rules manager UI (client component, add/list/delete rules)
- `src/app/api/rules/route.ts` — `GET` list rules, `POST` embed + upsert to Supabase
- `src/app/api/rules/[id]/route.ts` — `DELETE` a rule by id
- `src/lib/supabase.ts` — Supabase server client (service role)

When a rule is added, the API embeds it with `gemini-embedding-exp-03-07` (768 dims) and stores the vector in Supabase `rules` table.

### `worker/` — Cloudflare Worker (backend review engine)

Entry point: `worker/src/index.ts`. All secrets are Wrangler secrets (not `.env`).

| File | Responsibility |
|---|---|
| `index.ts` | Route dispatcher, webhook entrypoint |
| `webhook.ts` | HMAC-SHA256 GitHub signature verification |
| `github.ts` | Fetch PR diff, post review comment |
| `supabase.ts` | Embed diff excerpt → pgvector similarity search → matched rules |
| `reviewer.ts` | LangChain chain: prompt + Gemma LLM + LangSmith tracing |
| `types.ts` | `Env` interface for all Worker secrets |

Review pipeline (triggered on PR `opened` / `synchronize`):
1. Verify GitHub webhook signature
2. Fetch PR diff via GitHub API
3. Embed first 2000 chars of diff → similarity search → top-10 matching rules
4. Build prompt with rules + diff (capped at 12 000 chars) → `gemma-4-31b-it`
5. Post review as a PR comment
6. All LangChain calls traced in LangSmith project `code-reviewer`

### Next.js Version Warning

Next.js 16 has breaking changes. Read `node_modules/next/dist/docs/` before writing Next.js-specific code. Route Handler `params` is a `Promise` — always `await params`.

### Styling

Tailwind CSS v4 — no `tailwind.config.*`. Configuration lives in `src/app/globals.css`.

## Environment Variables

**`.env.local`** (Next.js):
```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
GOOGLE_API_KEY
```

**Wrangler secrets** (Worker — set with `wrangler secret put <NAME>`):
```
GOOGLE_API_KEY
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
GITHUB_TOKEN
GITHUB_WEBHOOK_SECRET
LANGSMITH_API_KEY
```

`LANGSMITH_PROJECT` is a plain `[vars]` entry in `wrangler.toml` (not secret).

## Supabase Schema

Run `supabase-setup.sql` once in the Supabase SQL editor before first use.
Key objects: `rules` table, `ivfflat` index on `embedding vector(768)`, `match_rules` RPC function.
