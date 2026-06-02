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

When a rule is added, the API embeds it with `gemini-embedding-2` (768 dims) and stores the vector in Supabase `rules` table.

### `worker/` — Cloudflare Worker (backend review engine)

Entry point: `worker/src/index.ts`. All secrets are Wrangler secrets (not `.env`).

| File | Responsibility |
|---|---|
| `index.ts` | Webhook entry point, Sandbox orchestration, Octokit PR comments |
| `webhook.ts` | HMAC-SHA256 GitHub signature verification |
| `reviewer.ts` | LangChain chain: Supabase RAG + Gemma LLM + LangSmith tracing |
| `supabase.ts` | Embed diff excerpt → pgvector similarity search → matched rules |
| `types.ts` | `Env` interface (includes `Sandbox` Durable Object binding) |

Review pipeline (triggered on PR `opened` / `synchronize` / `reopened`):
1. Verify GitHub webhook HMAC signature
2. Post "review in progress" comment immediately via Octokit
3. Clone PR branch into Cloudflare Sandbox (`git clone --depth=1`)
4. Fetch up to 5 changed files — full content + diff patch via Sandbox + Octokit
5. Embed patch → Supabase similarity search → top-10 matching rules
6. Build prompt (rules + diff + full file content) → `gemma-4-31b-it`
7. Post final review comment via Octokit
8. Destroy sandbox
9. All LangChain calls traced in LangSmith

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
Key objects: `rules` table, `ivfflat` index on `embedding vector(3072)`, `match_rules` RPC function.
