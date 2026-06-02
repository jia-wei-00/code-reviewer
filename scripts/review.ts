import { GoogleGenerativeAIEmbeddings, ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { createClient } from "@supabase/supabase-js";

// ── env ────────────────────────────────────────────────────────────────────
const required = {
  GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  GH_TOKEN: process.env.GH_TOKEN,
  PR_NUMBER: process.env.PR_NUMBER,
  REPO: process.env.REPO,
  COMMIT_SHA: process.env.COMMIT_SHA,
};

for (const [key, val] of Object.entries(required)) {
  if (!val) throw new Error(`Missing required env var: ${key}`);
}

const {
  GOOGLE_API_KEY,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  GH_TOKEN,
  PR_NUMBER,
  REPO,
  COMMIT_SHA,
} = required as Record<keyof typeof required, string>;

const [owner, repoName] = REPO.split("/");
const prNumber = parseInt(PR_NUMBER, 10);

const GH_HEADERS = {
  Authorization: `token ${GH_TOKEN}`,
  "User-Agent": "code-reviewer-bot/1.0",
};

// ── step 1: fetch diff ─────────────────────────────────────────────────────
console.log("::group::Fetching PR diff");
const diffRes = await fetch(
  `https://api.github.com/repos/${owner}/${repoName}/pulls/${prNumber}`,
  { headers: { ...GH_HEADERS, Accept: "application/vnd.github.v3.diff" } }
);
if (!diffRes.ok) throw new Error(`GitHub diff fetch failed: ${diffRes.status}`);
const diff = await diffRes.text();
console.log(`Diff size: ${diff.length} chars`);
console.log("::endgroup::");

// ── step 2: embed diff → match rules ──────────────────────────────────────
console.log("::group::Matching rules from Supabase");
const embeddings = new GoogleGenerativeAIEmbeddings({
  model: "gemini-embedding-exp-03-07",
  apiKey: GOOGLE_API_KEY,
});

const [queryEmbedding] = await embeddings.embedDocuments([diff.slice(0, 2000)]);

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const { data: rules, error: rulesError } = await supabase.rpc("match_rules", {
  query_embedding: queryEmbedding,
  match_threshold: 0.5,
  match_count: 10,
});
if (rulesError) throw new Error(`Supabase match_rules error: ${rulesError.message}`);

console.log(`Matched ${rules?.length ?? 0} rules`);
if (rules?.length) {
  for (const r of rules as { category: string; content: string }[]) {
    console.log(`  [${r.category}] ${r.content.slice(0, 80)}…`);
  }
}
console.log("::endgroup::");

const rulesText =
  rules?.length
    ? (rules as { category: string; content: string }[])
        .map((r) => `[${r.category}] ${r.content}`)
        .join("\n")
    : "Apply general best practices for code quality, security, and maintainability.";

// ── step 3: AI review ─────────────────────────────────────────────────────
console.log("::group::Running AI review");

const SYSTEM_PROMPT = `You are an expert code reviewer. Analyze the provided pull request diff and give specific, actionable feedback.

Apply the following coding rules:
{rules}

Structure your review exactly as:

## Summary
[2–3 sentence overall assessment of the change]

## Issues
For each issue use this format:
**\`{file}\`** — line {line}
- **Severity:** critical | warning | suggestion
- **Issue:** [what is wrong]
- **Fix:** [concrete recommendation]
- **Rule:** [which rule category applies]

## What looks good
[Briefly note any positive patterns worth keeping]

If there are no issues, say so clearly and keep it short.`;

const model = new ChatGoogleGenerativeAI({
  model: "gemma-4-31b-it",
  apiKey: GOOGLE_API_KEY,
  temperature: 0.2,
});

const prompt = ChatPromptTemplate.fromMessages([
  ["system", SYSTEM_PROMPT],
  ["human", "Review this diff:\n\n```diff\n{diff}\n```"],
]);

const chain = prompt.pipe(model).pipe(new StringOutputParser());

const review = await chain.invoke({
  rules: rulesText,
  diff: diff.slice(0, 12_000),
});

console.log("Review generated successfully");
console.log("::endgroup::");

// ── step 4: post review comment ────────────────────────────────────────────
console.log("::group::Posting review to GitHub");
const postRes = await fetch(
  `https://api.github.com/repos/${owner}/${repoName}/pulls/${prNumber}/reviews`,
  {
    method: "POST",
    headers: { ...GH_HEADERS, Accept: "application/vnd.github.v3+json", "Content-Type": "application/json" },
    body: JSON.stringify({ commit_id: COMMIT_SHA, body: review, event: "COMMENT" }),
  }
);
if (!postRes.ok) {
  const text = await postRes.text();
  throw new Error(`GitHub review post failed: ${postRes.status} — ${text}`);
}
console.log("Review posted successfully");
console.log("::endgroup::");
