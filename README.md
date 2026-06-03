# Code Reviewer

An AI-powered GitHub code review bot. When a pull request is opened or updated, it fetches the diff, sends it to Gemma for analysis, and posts inline comments on specific lines of code along with an overall summary.

## How it works

```
PR opened / updated
      │
      ▼
GitHub Actions  (code-review.yml)
      │  fetch PR diff from GitHub API
      │  annotate diff with line numbers
      │
      ▼
Gemma (gemma-4-31b-it via Google AI)
      │  analyze diff → structured JSON review
      │
      ▼
GitHub PR
      │  inline comment on each flagged line
      │  summary comment with overall assessment
```

## Stack

| Layer      | Technology                            |
| ---------- | ------------------------------------- |
| CI         | GitHub Actions                        |
| LLM        | `gemma-4-31b-it` via Google AI        |
| LLM client | LangChain (`@langchain/google-genai`) |

## Project structure

```
├── scripts/
│   └── review.ts                 # Core review script
└── .github/workflows/
    └── code-review.yml           # Reusable AI review workflow
```

## Setup

### Add secret to this repo

Go to **Settings → Secrets and variables → Actions → New repository secret**:

| Secret           | Value                                                               |
| ---------------- | ------------------------------------------------------------------- |
| `GOOGLE_API_KEY` | Your [Google AI Studio](https://aistudio.google.com/apikey) API key |

> This repo must be **public** so other repositories can reference its workflow.

## Using in another repository

Create `.github/workflows/code-review.yml` in the other repo:

```yaml
name: AI Code Review

on:
  pull_request:
    types: [opened, synchronize, reopened]

jobs:
  review:
    uses: jia-wei-00/code-reviewer/.github/workflows/code-review.yml@main
    secrets:
      GOOGLE_API_KEY: ${{ secrets.GOOGLE_API_KEY }}
```

Then add `GOOGLE_API_KEY` as a secret in that repo's **Settings → Secrets and variables → Actions**.

That's it — every PR will automatically receive an AI review.

## What the bot posts

**Inline comments** on specific lines flagged by the model:

> **WARNING**
>
> This function mutates its argument directly. Return a new value instead to avoid side effects.

**Summary comment** at the end:

> ## 🤖 Code Review
>
> Overall the changes look clean. One potential bug found in the error handler and a style suggestion on naming.
>
> _2 inline comment(s) · Reviewed by Gemma via code-reviewer_
