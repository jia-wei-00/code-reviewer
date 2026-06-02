import { getSandbox, proxyToSandbox } from "@cloudflare/sandbox";
import { Octokit } from "@octokit/rest";
import { verifyGitHubSignature } from "./webhook";
import { reviewCode } from "./reviewer";
import type { Env } from "./types";

// Re-export Sandbox Durable Object class (required by @cloudflare/sandbox)
export { Sandbox } from "@cloudflare/sandbox";
export type { Env };

function field(obj: object, key: string): unknown {
  return (obj as Record<string, unknown>)[key];
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Required by @cloudflare/sandbox — handles internal sandbox proxy traffic
    const proxyResponse = await proxyToSandbox(request, env);
    if (proxyResponse) return proxyResponse;

    const url = new URL(request.url);

    if (url.pathname !== "/webhook" || request.method !== "POST") {
      return new Response("Code Review Bot — configure GitHub webhook to POST /webhook");
    }

    const body = await request.text();
    const signature = request.headers.get("x-hub-signature-256") ?? "";

    if (!signature || !(await verifyGitHubSignature(body, signature, env.GITHUB_WEBHOOK_SECRET))) {
      return Response.json({ error: "Invalid signature" }, { status: 401 });
    }

    // GitHub sends either JSON or form-encoded payload
    let payload: Record<string, unknown>;
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      payload = JSON.parse(body);
    } else {
      const params = new URLSearchParams(body);
      payload = JSON.parse(params.get("payload") ?? "{}");
    }

    const event = request.headers.get("x-github-event");
    const action = payload.action;

    if (
      event === "pull_request" &&
      (action === "opened" || action === "synchronize" || action === "reopened")
    ) {
      ctx.waitUntil(reviewPullRequest(payload, env).catch(console.error));
      return Response.json({ message: "Review started" });
    }

    return Response.json({ message: "Event ignored" });
  },
};

async function reviewPullRequest(payload: Record<string, unknown>, env: Env): Promise<void> {
  const pr = payload.pull_request;
  const repo = payload.repository;

  if (typeof pr !== "object" || pr === null || typeof repo !== "object" || repo === null) return;

  const prNumber = field(pr, "number");
  const prTitle = field(pr, "title");
  const headRef = field(field(pr, "head") as object, "ref");
  const headSha = field(field(pr, "head") as object, "sha");
  const baseSha = field(field(pr, "base") as object, "sha");
  const owner = field(field(repo, "owner") as object, "login");
  const repoName = field(repo, "name");

  if (
    typeof prNumber !== "number" ||
    typeof prTitle !== "string" ||
    typeof headRef !== "string" ||
    typeof headSha !== "string" ||
    typeof baseSha !== "string" ||
    typeof owner !== "string" ||
    typeof repoName !== "string"
  ) return;

  const octokit = new Octokit({ auth: env.GITHUB_TOKEN });
  const sandbox = getSandbox(env.Sandbox, `review-${prNumber}`);

  try {
    // Immediately post a "in progress" comment so the author sees activity
    await octokit.issues.createComment({
      owner,
      repo: repoName,
      issue_number: prNumber,
      body: "🔍 Code review in progress…",
    });

    // Clone the PR branch into an isolated sandbox environment
    const cloneUrl = `https://${env.GITHUB_TOKEN}@github.com/${owner}/${repoName}.git`;
    await sandbox.exec(
      `git clone --depth=1 --branch=${headRef} ${cloneUrl} /workspace/repo`
    );

    // Fetch list of changed files
    const comparison = await octokit.repos.compareCommits({
      owner,
      repo: repoName,
      base: baseSha,
      head: headSha,
    });

    // Read up to 5 changed files — full content + diff patch
    const files: { path: string; patch: string; content: string }[] = [];
    for (const file of (comparison.data.files ?? []).slice(0, 5)) {
      if (file.status === "removed") continue;
      const result = await sandbox.readFile(`/workspace/repo/${file.filename}`);
      files.push({
        path: file.filename,
        patch: file.patch ?? "",
        content: result.content,
      });
    }

    // Run Gemma review with Supabase rules RAG
    const review = await reviewCode({ prTitle, files }, env);

    await octokit.issues.createComment({
      owner,
      repo: repoName,
      issue_number: prNumber,
      body: `## Code Review\n\n${review}\n\n---\n*Reviewed by Gemma · [code-reviewer](https://github.com/${owner}/code-reviewer)*`,
    });
  } catch (error) {
    console.error("Review pipeline failed:", error);
    await octokit.issues.createComment({
      owner,
      repo: repoName,
      issue_number: prNumber,
      body: `❌ Review failed: ${error instanceof Error ? error.message : "Unknown error"}`,
    });
  } finally {
    await sandbox.destroy();
  }
}
