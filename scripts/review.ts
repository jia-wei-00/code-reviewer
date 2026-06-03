import { ChatGoogleGenerativeAI } from "@langchain/google-genai";

// ── env ────────────────────────────────────────────────────────────────────
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const GH_TOKEN = process.env.GH_TOKEN;
const PR_NUMBER = process.env.PR_NUMBER;
const REPO = process.env.REPO;
const COMMIT_SHA = process.env.COMMIT_SHA;

if (!GOOGLE_API_KEY || !GH_TOKEN || !PR_NUMBER || !REPO || !COMMIT_SHA) {
  throw new Error("Missing env vars: GOOGLE_API_KEY, GH_TOKEN, PR_NUMBER, REPO, COMMIT_SHA");
}

const [owner, repoName] = REPO.split("/");
const prNumber = parseInt(PR_NUMBER, 10);

const GH_HEADERS = {
  Authorization: `token ${GH_TOKEN}`,
  Accept: "application/vnd.github+json",
  "User-Agent": "code-reviewer-bot/1.0",
  "X-GitHub-Api-Version": "2022-11-28",
};

// ── step 1: fetch PR title + diff ──────────────────────────────────────────
console.log("::group::Fetching PR diff");

const prMetaRes = await fetch(
  `https://api.github.com/repos/${owner}/${repoName}/pulls/${prNumber}`,
  { headers: GH_HEADERS }
);
if (!prMetaRes.ok) throw new Error(`PR meta fetch failed: ${prMetaRes.status}`);
const prMeta = (await prMetaRes.json()) as { title: string };

const diffRes = await fetch(
  `https://api.github.com/repos/${owner}/${repoName}/pulls/${prNumber}`,
  { headers: { ...GH_HEADERS, Accept: "application/vnd.github.v3.diff" } }
);
if (!diffRes.ok) throw new Error(`Diff fetch failed: ${diffRes.status}`);
const diff = await diffRes.text();

console.log(`PR: "${prMeta.title}"`);
console.log(`Diff: ${diff.length} chars`);
console.log("::endgroup::");

// ── step 2: annotate diff with new-file line numbers ───────────────────────
function annotateDiff(raw: string): string {
  let newLine = 0;
  return raw
    .split("\n")
    .map((line) => {
      if (line.startsWith("@@")) {
        const m = line.match(/@@ -\d+(?:,\d+)? \+(\d+)/);
        if (m) newLine = parseInt(m[1]) - 1;
        return line;
      }
      if (line.startsWith("-") || line.startsWith("\\")) return line;
      newLine++;
      if (line.startsWith("+")) return `+[L${newLine}] ${line.slice(1)}`;
      return ` [L${newLine}]${line.length > 1 ? " " + line.slice(1) : ""}`;
    })
    .join("\n");
}

const annotated = annotateDiff(diff.slice(0, 14_000));

// ── step 3: AI review ─────────────────────────────────────────────────────
console.log("::group::Running AI review");

const model = new ChatGoogleGenerativeAI({
  model: "gemma-4-31b-it",
  apiKey: GOOGLE_API_KEY,
  temperature: 0.2,
});

const SYSTEM = `You are an expert code reviewer. Analyze the PR diff and return ONLY a JSON object — no markdown fences, no explanation, no extra text before or after.

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
- "file" must match exactly the path after "+++ b/" in the diff (no leading "b/", no leading slash)
- "line" must be the integer from the [LN] annotation on the specific problematic line
- Only flag real issues: security vulnerabilities, bugs, performance problems, bad practices
- If no issues found, return an empty "comments" array`;

const response = await model.invoke([
  ["system", SYSTEM],
  ["human", `PR Title: ${prMeta.title}\n\n\`\`\`diff\n${annotated}\n\`\`\``],
]);

const raw = typeof response.content === "string" ? response.content : JSON.stringify(response.content);
console.log(`Response length: ${raw.length}`);

interface ReviewComment { file: string; line: number; severity: string; body: string; }
interface ReviewResult  { summary: string; comments: ReviewComment[]; }

let result: ReviewResult = { summary: raw.slice(0, 800), comments: [] };
const jsonMatch = raw.match(/\{[\s\S]*\}/);
if (jsonMatch) {
  try {
    const parsed = JSON.parse(jsonMatch[0]) as Partial<ReviewResult>;
    result = {
      summary: typeof parsed.summary === "string" ? parsed.summary : raw.slice(0, 800),
      comments: Array.isArray(parsed.comments)
        ? parsed.comments.filter(
            (c) => typeof c.file === "string" && typeof c.line === "number" && c.line > 0 && typeof c.body === "string"
          )
        : [],
    };
  } catch {
    console.warn("JSON parse failed, using raw response as summary");
  }
}

console.log(`Summary: ${result.summary.slice(0, 120)}…`);
console.log(`Inline comments to post: ${result.comments.length}`);
console.log("::endgroup::");

// ── step 4: post inline review comments individually ──────────────────────
console.log("::group::Posting inline comments");

let postedCount = 0;
for (const comment of result.comments) {
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repoName}/pulls/${prNumber}/comments`,
    {
      method: "POST",
      headers: { ...GH_HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify({
        commit_id: COMMIT_SHA,
        path: comment.file,
        line: comment.line,
        body: `**${comment.severity.toUpperCase()}**\n\n${comment.body}`,
      }),
    }
  );
  if (res.ok) {
    postedCount++;
    console.log(`  ✓ ${comment.file}:${comment.line}`);
  } else {
    const errText = await res.text();
    console.warn(`  ✗ ${comment.file}:${comment.line} — ${res.status}: ${errText.slice(0, 200)}`);
  }
}

console.log(`Posted ${postedCount}/${result.comments.length} inline comments`);
console.log("::endgroup::");

// ── step 5: post summary comment ──────────────────────────────────────────
console.log("::group::Posting summary comment");

const summaryBody = [
  "## 🤖 Code Review",
  "",
  result.summary,
  "",
  "---",
  `*${postedCount} inline comment(s) · Reviewed by Gemma via [code-reviewer](https://github.com/${REPO.split("/")[0]}/code-reviewer)*`,
].join("\n");

const summaryRes = await fetch(
  `https://api.github.com/repos/${owner}/${repoName}/issues/${prNumber}/comments`,
  {
    method: "POST",
    headers: { ...GH_HEADERS, "Content-Type": "application/json" },
    body: JSON.stringify({ body: summaryBody }),
  }
);

if (!summaryRes.ok) {
  const t = await summaryRes.text();
  throw new Error(`Summary post failed: ${summaryRes.status} — ${t}`);
}

console.log("Summary posted");
console.log("::endgroup::");
