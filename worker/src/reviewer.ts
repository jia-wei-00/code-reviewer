import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import type { Env } from "./types";

export interface InlineComment {
  file: string;
  line: number;
  severity: "critical" | "warning" | "suggestion";
  body: string;
}

export interface ReviewResult {
  summary: string;
  comments: InlineComment[];
}

export interface ReviewInput {
  prTitle: string;
  diff: string;
}

/** Annotate a unified diff with new-file line numbers so the AI can reference them. */
function annotateDiff(diff: string): string {
  const lines = diff.split("\n");
  let newLine = 0;
  const result: string[] = [];

  for (const line of lines) {
    if (line.startsWith("@@")) {
      const m = line.match(/@@ -\d+(?:,\d+)? \+(\d+)/);
      if (m) newLine = parseInt(m[1]) - 1;
      result.push(line);
    } else if (line.startsWith("-")) {
      result.push(line);
    } else if (line.startsWith("+")) {
      newLine++;
      result.push(`+[L${newLine}] ${line.slice(1)}`);
    } else if (line.startsWith("\\")) {
      result.push(line);
    } else {
      newLine++;
      result.push(` [L${newLine}]${line.slice(1) ? " " + line.slice(1) : ""}`);
    }
  }

  return result.join("\n");
}

const SYSTEM_PROMPT = `You are an expert code reviewer. Analyze the PR diff and return ONLY a JSON object — no markdown fences, no explanation, no extra text.

The diff lines are annotated with [LN] showing the new-file line number. Use these exact numbers in "line".

JSON format:
{
  "summary": "2-3 sentence overall assessment",
  "comments": [
    {
      "file": "exact/path/from/diff.ts",
      "line": 42,
      "severity": "critical|warning|suggestion",
      "body": "Describe the issue and how to fix it."
    }
  ]
}

Rules:
- "file" must match exactly the path after "+++ b/" in the diff (no leading slash)
- "line" must be an integer from the [LN] annotation of the specific problematic line
- Only raise real issues — security risks, bugs, performance problems, bad practices
- If there are no issues, return an empty "comments" array`;

export async function reviewCode(input: ReviewInput, env: Env): Promise<ReviewResult> {
  const model = new ChatGoogleGenerativeAI({
    model: "gemma-4-31b-it",
    apiKey: env.GOOGLE_API_KEY,
    temperature: 0.2,
  });

  const annotated = annotateDiff(input.diff.slice(0, 12_000));

  const response = await model.invoke([
    ["system", SYSTEM_PROMPT],
    ["human", `PR Title: ${input.prTitle}\n\n\`\`\`diff\n${annotated}\n\`\`\``],
  ]);

  const text = typeof response.content === "string" ? response.content : JSON.stringify(response.content);
  console.log("[reviewer] raw response length:", text.length);

  // Extract JSON — handle responses wrapped in markdown code blocks
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.warn("[reviewer] no JSON found in response, returning summary only");
    return { summary: text.slice(0, 1000), comments: [] };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]) as Partial<ReviewResult>;
    return {
      summary: typeof parsed.summary === "string" ? parsed.summary : "Review complete.",
      comments: Array.isArray(parsed.comments)
        ? parsed.comments.filter(
            (c) =>
              typeof c.file === "string" &&
              typeof c.line === "number" &&
              c.line > 0 &&
              typeof c.body === "string"
          )
        : [],
    };
  } catch (err) {
    console.warn("[reviewer] JSON parse failed:", err instanceof Error ? err.message : String(err));
    return { summary: text.slice(0, 1000), comments: [] };
  }
}
