import { getSandbox, proxyToSandbox } from "@cloudflare/sandbox";
import { Octokit } from "@octokit/rest";
import { verifyGitHubSignature } from "./webhook";
import { reviewCode } from "./reviewer";
import type { Env } from "./types";

export { Sandbox } from "@cloudflare/sandbox";
export type { Env };

function strField(obj: Record<string, unknown>, key: string): string | undefined {
  const v = obj[key];
  return typeof v === "string" ? v : undefined;
}

function numField(obj: Record<string, unknown>, key: string): number | undefined {
  const v = obj[key];
  return typeof v === "number" ? v : undefined;
}

function objField(obj: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const v = obj[key];
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : undefined;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
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
      console.log(`[review] triggered — action=${action}`);
      ctx.waitUntil(reviewPullRequest(payload, env).catch((err) => {
        console.error("[review] unhandled error:", err);
      }));
      return Response.json({ message: "Review started" });
    }

    return Response.json({ message: `Event ignored — event=${event} action=${action}` });
  },
};

async function reviewPullRequest(payload: Record<string, unknown>, env: Env): Promise<void> {
  // ── extract & validate payload fields ──────────────────────────────────
  const pr = objField(payload, "pull_request");
  const repo = objField(payload, "repository");

  if (!pr || !repo) {
    console.error("[review] missing pull_request or repository in payload");
    return;
  }

  const head = objField(pr, "head");
  const base = objField(pr, "base");
  const repoOwner = objField(repo, "owner");

  if (!head || !base || !repoOwner) {
    console.error("[review] missing head/base/owner in payload");
    return;
  }

  const prNumber = numField(pr, "number");
  const prTitle = strField(pr, "title") ?? "Untitled PR";
  const headRef = strField(head, "ref");
  const headSha = strField(head, "sha");
  const baseSha = strField(base, "sha");
  const owner = strField(repoOwner, "login");
  const repoName = strField(repo, "name");

  if (!prNumber || !headRef || !headSha || !baseSha || !owner || !repoName) {
    console.error("[review] incomplete payload fields", { prNumber, headRef, headSha, baseSha, owner, repoName });
    return;
  }

  console.log(`[review] PR #${prNumber} — ${owner}/${repoName} branch=${headRef}`);

  const octokit = new Octokit({ auth: env.GITHUB_TOKEN });
  const sandbox = getSandbox(env.Sandbox, `review-${prNumber}`);

  try {
    console.log("[review] posting in-progress comment");
    await octokit.issues.createComment({
      owner,
      repo: repoName,
      issue_number: prNumber,
      body: "🔍 Code review in progress…",
    });

    console.log("[review] cloning repository into sandbox");
    const cloneUrl = `https://${env.GITHUB_TOKEN}@github.com/${owner}/${repoName}.git`;
    await sandbox.exec(`git clone --depth=1 --branch=${headRef} ${cloneUrl} /workspace/repo`);

    console.log("[review] fetching changed files");
    const comparison = await octokit.repos.compareCommits({
      owner,
      repo: repoName,
      base: baseSha,
      head: headSha,
    });

    const files: { path: string; patch: string; content: string }[] = [];
    for (const file of (comparison.data.files ?? []).slice(0, 5)) {
      if (file.status === "removed") continue;
      console.log(`[review] reading file: ${file.filename}`);
      const result = await sandbox.readFile(`/workspace/repo/${file.filename}`);
      files.push({ path: file.filename, patch: file.patch ?? "", content: result.content });
    }

    console.log(`[review] running AI review on ${files.length} file(s)`);
    const review = await reviewCode({ prTitle, files }, env);

    console.log("[review] posting review comment");
    await octokit.issues.createComment({
      owner,
      repo: repoName,
      issue_number: prNumber,
      body: `## Code Review\n\n${review}\n\n---\n*Reviewed by Gemma · [code-reviewer](https://github.com/${owner}/code-reviewer)*`,
    });

    console.log("[review] done");
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[review] pipeline error:", msg);
    await octokit.issues.createComment({
      owner,
      repo: repoName,
      issue_number: prNumber,
      body: `❌ Review failed: ${msg}`,
    });
  } finally {
    await sandbox.destroy();
  }
}
