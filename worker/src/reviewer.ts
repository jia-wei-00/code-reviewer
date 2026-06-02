import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { Client as LangSmithClient } from "langsmith";
import { traceable } from "langsmith/traceable";
import { getLangchainCallbacks } from "langsmith/langchain";
import { matchRules } from "./supabase";
import type { Env } from "./types";

export interface ReviewInput {
  prTitle: string;
  files: { path: string; patch: string; content: string }[];
}

const SYSTEM_PROMPT = `You are an expert code reviewer. Analyze the pull request and give specific, actionable feedback.

Apply these coding rules:
{rules}

Structure your review as:

## Summary
[2–3 sentence overall assessment]

## Issues
For each issue:
**\`{file}\`** — line {line}
- **Severity:** critical | warning | suggestion
- **Issue:** [what is wrong]
- **Fix:** [concrete recommendation]
- **Rule:** [which rule category applies]

## What looks good
[Briefly note any positive patterns]

If no issues, say so clearly and keep it short.`;

export async function reviewCode(input: ReviewInput, env: Env): Promise<string> {
  // Use patch content from all files for rule matching
  const diffSample = input.files.map((f) => f.patch).join("\n").slice(0, 2000);
  const rules = await matchRules(diffSample, env);

  const rulesText = rules.length
    ? rules.map((r) => `[${r.category}] ${r.content}`).join("\n")
    : "Apply general best practices for code quality, security, and maintainability.";

  // Build context: diff patch + first 1500 chars of full file content
  const filesContext = input.files
    .map(
      (f) =>
        `### ${f.path}\n\n**Diff:**\n\`\`\`diff\n${f.patch}\n\`\`\`\n\n**Full file:**\n\`\`\`\n${f.content.slice(0, 1500)}\n\`\`\``
    )
    .join("\n\n---\n\n");

  const model = new ChatGoogleGenerativeAI({
    model: "gemma-4-31b-it",
    apiKey: env.GOOGLE_API_KEY,
    temperature: 0.2,
  });

  const prompt = ChatPromptTemplate.fromMessages([
    ["system", SYSTEM_PROMPT],
    ["human", "PR Title: {title}\n\nChanged files:\n\n{files}"],
  ]);

  const chain = prompt.pipe(model).pipe(new StringOutputParser());

  const langsmithClient = new LangSmithClient({ apiKey: env.LANGSMITH_API_KEY });

  const traced = traceable(
    async (inp: { rules: string; title: string; files: string }) => {
      const callbacks = await getLangchainCallbacks();
      return chain.invoke(inp, { callbacks });
    },
    { name: "code-review", client: langsmithClient, project_name: env.LANGSMITH_PROJECT }
  );

  return traced({ rules: rulesText, title: input.prTitle, files: filesContext });
}
