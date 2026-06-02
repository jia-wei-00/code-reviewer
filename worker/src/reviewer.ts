import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { Client as LangSmithClient } from "langsmith";
import { LangChainTracer } from "langsmith/callbacks";
import { matchRules } from "./supabase";
import type { Env } from "./types";

const SYSTEM_PROMPT = `You are an expert code reviewer. Analyze the provided pull request diff and give specific, actionable feedback.

Apply the following coding rules:
{rules}

Structure your review exactly as:

## Summary
[2–3 sentence overall assessment of the change]

## Issues
For each issue use this format:
**\`{{file}}\`** — line {{line}}
- **Severity:** critical | warning | suggestion
- **Issue:** [what is wrong]
- **Fix:** [concrete recommendation]
- **Rule:** [which rule category applies]

## What looks good
[Briefly note any positive patterns worth keeping]

If there are no issues, say so clearly and keep it short.`;

// Truncate diff to stay within the model's context window
const MAX_DIFF_CHARS = 12_000;

export async function reviewCode(diff: string, env: Env): Promise<string> {
  const rules = await matchRules(diff, env);

  const rulesText = rules.length
    ? rules.map((r) => `[${r.category}] ${r.content}`).join("\n")
    : "Apply general best practices for code quality, security, and maintainability.";

  const model = new ChatGoogleGenerativeAI({
    model: "gemma-4-31b-it",
    apiKey: env.GOOGLE_API_KEY,
    temperature: 0.2,
  });

  const prompt = ChatPromptTemplate.fromMessages([
    ["system", SYSTEM_PROMPT],
    ["human", "Review this diff:\n\n```diff\n{diff}\n```"],
  ]);

  const chain = prompt.pipe(model).pipe(new StringOutputParser());

  const langsmithClient = new LangSmithClient({ apiKey: env.LANGSMITH_API_KEY });
  const tracer = new LangChainTracer({
    projectName: env.LANGSMITH_PROJECT,
    client: langsmithClient,
  });

  return chain.invoke(
    { rules: rulesText, diff: diff.slice(0, MAX_DIFF_CHARS) },
    { callbacks: [tracer] }
  );
}
