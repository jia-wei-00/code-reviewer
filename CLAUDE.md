# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
bun dev              # Next.js dev server on http://localhost:3000
bun build            # Next.js production build
bun start            # Next.js production server
bun lint             # ESLint
bun run review       # run the LangGraph review script (needs env vars)
bun run seed:rules   # seed default rules into Supabase
```

> Use **bun** as the package manager (`bun add <pkg>`).

## Architecture

This is a **GitHub-Action-only** code review bot. The repo contains:

1. A Next.js app (`src/`) — a small UI to manage review rules stored in Supabase.
2. A LangGraph workflow (`scripts/`) — invoked by a reusable GitHub Actions
   workflow (`.github/workflows/code-review.yml`) on every PR.

There is no Cloudflare Worker or other server component.

### Review pipeline (`scripts/`)

`scripts/review.ts` is the entry point. It loads env via Zod, then runs a
compiled LangGraph state graph (`scripts/lib/graph.ts`) with these nodes:

| Node                  | File                          | Responsibility                                       |
| --------------------- | ----------------------------- | ---------------------------------------------------- |
| `fetchPullRequest`    | `scripts/lib/github.ts`       | Octokit: PR meta + unified diff                      |
| `annotateDiff`        | `scripts/lib/diff.ts`         | Tag changed lines with `[LN]` markers                |
| `retrieveRules`       | `scripts/lib/supabase.ts`     | Gemini embed → `match_rules` RPC (pgvector RAG)      |
| `generateReview`      | `scripts/lib/llm.ts`          | LangChain prompt → Gemma → JSON parsed via Zod       |
| `postInlineComments`  | `scripts/lib/github.ts`       | One review comment per finding                       |
| `postSummary`         | `scripts/lib/github.ts`       | Overall assessment as PR issue comment               |

LangSmith tracing is auto-configured when `LANGSMITH_API_KEY` is present
(`scripts/lib/env.ts` sets `LANGCHAIN_TRACING_V2` / `LANGSMITH_*` env vars).
Supabase is optional — when its env vars are absent the workflow runs without
RAG and the LLM falls back to general best practices.

### Next.js rules manager (`src/`)

App Router with TypeScript and Tailwind v4. Path alias `@/*` → `src/*`.

- `src/app/page.tsx` — list / add / delete review rules (client component)
- `src/app/api/rules/route.ts` — `GET` list, `POST` embed + insert
- `src/app/api/rules/[id]/route.ts` — `DELETE` a rule
- `src/lib/supabase.ts` — lazy service-role Supabase client
- `src/lib/embeddings.ts` — lazy Gemini embeddings client
- `src/lib/rule-categories.ts` — shared `RULE_CATEGORIES` constant + guard

### Next.js 16 notes

Next.js 16 has breaking changes. Read `node_modules/next/dist/docs/` before
writing Next.js-specific code. Route Handler `params` is a `Promise` —
always `await params`.

### Styling

Tailwind CSS v4 — no `tailwind.config.*`. Configuration lives in
`src/app/globals.css`.

## Environment variables

See `.env.example` for the full list. Required minimum to run reviews:
`GOOGLE_API_KEY`, `GH_TOKEN`, `PR_NUMBER`, `REPO`, `COMMIT_SHA`.
Supabase + LangSmith vars are optional but recommended.

## Supabase schema

Run `supabase-setup.sql` once in the Supabase SQL editor. Key objects:
`rules` table, `embedding vector(3072)` column, `match_rules` RPC.

## Conventions

- No hard `as T` casts where a Zod schema or type guard works.
- No `any`; prefer `unknown` plus narrowing.
- Env access goes through `scripts/lib/env.ts` (Zod-validated).
- Errors surface with context (`error instanceof Error ? error.message : …`).
- LangChain runnables / LangGraph nodes are named (`withConfig({ runName })`)
  so LangSmith traces are readable.
