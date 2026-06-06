import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { RunnableLambda, type Runnable } from "@langchain/core/runnables";
import type { AIMessageChunk } from "@langchain/core/messages";
import type { MatchedRule } from "./supabase";
import { reviewResultSchema, type ReviewResult } from "./review-schema";

const SYSTEM_PROMPT = `You are an expert code reviewer. Analyze the PR diff and return ONLY a JSON object — no markdown fences, no explanation, no extra text before or after.

Diff lines are annotated with [LN] showing the new-file line number. Use these exact numbers in "line".

Return this exact JSON shape:
{
  "summary": "2-3 sentence overall assessment",
  "comments": [
    {
      "file": "exact/path/from/diff.ts",
      "line": 42,
      "severity": "critical|warning|suggestion",
      "body": "Describe the issue and the concrete fix."
    }
  ]
}

Rules:
- "file" must match exactly the path after "+++ b/" in the diff (no leading "b/", no leading slash).
- "line" must be the integer from the [LN] annotation on the specific problematic line.
- Only flag real issues that violate the listed review rules, or security, correctness, performance, or maintainability concerns.
- If no issues found, return an empty "comments" array.`;

const HUMAN_PROMPT = `PR Title: {prTitle}

Review rules to apply (highest similarity first):
{rules}

Annotated diff:
\`\`\`diff
{diff}
\`\`\``;

export interface BuildChainOptions {
  apiKey: string;
  model: string;
  temperature?: number;
}

export interface ReviewChainInput {
  prTitle: string;
  diff: string;
  rules: MatchedRule[];
}

export function buildReviewChain(
  options: BuildChainOptions,
): Runnable<ReviewChainInput, ReviewResult> {
  const llm = new ChatGoogleGenerativeAI({
    model: options.model,
    apiKey: options.apiKey,
    temperature: options.temperature ?? 0.2,
  });

  const prompt = ChatPromptTemplate.fromMessages([
    ["system", SYSTEM_PROMPT],
    ["human", HUMAN_PROMPT],
  ]);

  const formatInput = RunnableLambda.from((input: ReviewChainInput) => ({
    prTitle: input.prTitle,
    diff: input.diff,
    rules: formatRules(input.rules),
  })).withConfig({ runName: "FormatPromptInput" });

  const parseOutput = RunnableLambda.from(extractReviewResult).withConfig({
    runName: "ParseReviewJSON",
  });

  return formatInput
    .pipe(prompt)
    .pipe(llm)
    .pipe(parseOutput)
    .withConfig({ runName: "ReviewChain" });
}

function formatRules(rules: MatchedRule[]): string {
  if (rules.length === 0) {
    return "(no specific rules matched — fall back to general best practices)";
  }
  return rules
    .map((r, i) => `${i + 1}. [${r.category}] ${r.content}`)
    .join("\n");
}

function extractReviewResult(message: AIMessageChunk): ReviewResult {
  const text = messageText(message);
  const json = extractJsonObject(text);
  if (!json) {
    return { summary: text.slice(0, 800), comments: [] };
  }
  const parsed = reviewResultSchema.safeParse(json);
  if (parsed.success) return parsed.data;

  const fallbackSummary =
    typeof (json as { summary?: unknown }).summary === "string"
      ? (json as { summary: string }).summary
      : text.slice(0, 800);
  return { summary: fallbackSummary, comments: [] };
}

function messageText(message: AIMessageChunk): string {
  const content = message.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const textBlocks: string[] = [];
  for (const block of content) {
    if (
      typeof block === "object" &&
      block !== null &&
      "type" in block &&
      (block as { type: unknown }).type === "text" &&
      "text" in block &&
      typeof (block as { text: unknown }).text === "string"
    ) {
      textBlocks.push((block as { text: string }).text);
    }
  }
  return textBlocks.join("\n").trim();
}

function extractJsonObject(text: string): unknown {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}
