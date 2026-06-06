# Code Reviewer

An AI-powered GitHub code review bot. When a pull request is opened or updated,
a LangGraph workflow fetches the diff, retrieves the most relevant review rules
from Supabase (pgvector RAG), asks Gemma to analyse the change, and posts inline
comments plus an overall summary on the PR.

## How it works

```
PR opened / updated
      │
      ▼
GitHub Actions  (.github/workflows/code-review.yml)
      │
      ▼
LangGraph state graph
  ├─ fetchPullRequest   (Octokit: PR meta + unified diff)
  ├─ annotateDiff       (tag changed lines with [LN] markers)
  ├─ retrieveRules      (Gemini embeddings → Supabase match_rules RPC)
  ├─ generateReview     (LangChain → gemma-4-31b-it via Google AI)
  ├─ postInlineComments (Octokit: one review comment per finding)
  └─ postSummary        (Octokit: overall assessment as PR comment)
      │
      ▼
LangSmith trace (every step captured if LANGSMITH_API_KEY is set)
```

## Stack

| Layer       | Technology                                          |
| ----------- | --------------------------------------------------- |
| CI          | GitHub Actions                                      |
| Workflow    | LangGraph (`@langchain/langgraph`)                  |
| LLM         | `gemma-4-31b-it` via Google AI                      |
| LLM client  | LangChain (`@langchain/google-genai`)               |
| Embeddings  | `gemini-embedding-2`                                |
| Vector RAG  | Supabase + pgvector                                 |
| Tracing     | LangSmith                                           |
| Validation  | Zod                                                 |
| Rules UI    | Next.js 16 (App Router) + Tailwind v4               |

## Project structure

```
├── scripts/
│   ├── review.ts           # entry — runs the LangGraph workflow
│   ├── seed-rules.ts       # seed default rules into Supabase
│   └── lib/                # env, github, supabase, llm, diff, graph
├── src/                    # Next.js rules manager UI
│   ├── app/                # routes (App Router)
│   └── lib/                # supabase/embeddings/rule-categories helpers
├── .github/workflows/
│   └── code-review.yml     # reusable AI review workflow
├── supabase-setup.sql      # one-time pgvector + match_rules setup
└── .env.example            # template for local env vars
```

## Local setup

```bash
cp .env.example .env.local   # then fill in your keys
bun install
bun run dev                  # rules manager UI on http://localhost:3000
bun run seed:rules           # one-time: seed default rules into Supabase
```

Run the review script locally against a real PR:

```bash
GH_TOKEN=ghp_… PR_NUMBER=42 REPO=owner/name COMMIT_SHA=abc123… bun run review
```

## GitHub Actions setup

Add these secrets in **Settings → Secrets and variables → Actions**:

| Secret                      | Required | Purpose                                  |
| --------------------------- | -------- | ---------------------------------------- |
| `GOOGLE_API_KEY`            | yes      | Google AI Studio key for Gemma + Gemini  |
| `SUPABASE_URL`              | no       | enables RAG rule retrieval               |
| `SUPABASE_SERVICE_ROLE_KEY` | no       | enables RAG rule retrieval               |
| `LANGSMITH_API_KEY`         | no       | enables LangSmith tracing                |

> This repo must be **public** for other repositories to reference its workflow.

## Using in another repository

```yaml
# .github/workflows/code-review.yml
name: AI Code Review

on:
  pull_request:
    types: [opened, synchronize, reopened]

jobs:
  review:
    uses: jia-wei-00/code-reviewer/.github/workflows/code-review.yml@main
    secrets:
      GOOGLE_API_KEY:            ${{ secrets.GOOGLE_API_KEY }}
      SUPABASE_URL:              ${{ secrets.SUPABASE_URL }}
      SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
      LANGSMITH_API_KEY:         ${{ secrets.LANGSMITH_API_KEY }}
```

## Supabase schema

Run [`supabase-setup.sql`](./supabase-setup.sql) once in the Supabase SQL editor.
It creates the `rules` table (with a `vector(3072)` embedding column) and the
`match_rules` RPC the workflow calls.
