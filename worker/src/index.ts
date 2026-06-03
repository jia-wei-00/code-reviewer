import { Octokit } from "@octokit/rest";
import { verifyGitHubSignature } from "./webhook";
import { reviewCode } from "./reviewer";
import type { Env } from "./types";

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
    console.error("[review] missing head/base/owner");
    return;
  }

  const prNumber = numField(pr, "number");
  const prTitle = strField(pr, "title") ?? "Untitled PR";
  const headSha = strField(head, "sha");
  const owner = strField(repoOwner, "login");
  const repoName = strField(repo, "name");

  if (!prNumber || !headSha || !owner || !repoName) {
    console.error("[review] incomplete payload fields", { prNumber, headSha, owner, repoName });
    return;
  }

  console.log(`[review] PR #${prNumber} — ${owner}/${repoName}`);

  const octokit = new Octokit({ auth: env.GITHUB_TOKEN });

  // Step 1: post "in progress" comment and save its ID so we can delete it later
  let progressCommentId: number | undefined;
  try {
    const progressComment = await octokit.issues.createComment({
      owner,
      repo: repoName,
      issue_number: prNumber,
      body: "🔍 Code review in progress…",
    });
    progressCommentId = progressComment.data.id;
    console.log("[review] posted in-progress comment", progressCommentId);
  } catch (err) {
    console.warn("[review] could not post in-progress comment:", err instanceof Error ? err.message : String(err));
  }

  try {
    // Step 2: fetch the PR diff from GitHub
    console.log("[review] fetching PR diff");
    const diffRes = await fetch(
      `https://api.github.com/repos/${owner}/${repoName}/pulls/${prNumber}`,
      {
        headers: {
          Authorization: `token ${env.GITHUB_TOKEN}`,
          Accept: "application/vnd.github.v3.diff",
          "User-Agent": "code-reviewer-bot/1.0",
        },
      }
    );
    if (!diffRes.ok) throw new Error(`GitHub diff fetch failed: ${diffRes.status}`);
    const diff = await diffRes.text();
    console.log(`[review] diff size: ${diff.length} chars`);

    // Step 3: AI review → structured result
    console.log("[review] running AI review");
    const result = await reviewCode({ prTitle, diff }, env);
    console.log(`[review] got ${result.comments.length} inline comment(s)`);

    // Step 4: post inline review comments (one attempt each; skip bad line refs)
    for (const comment of result.comments) {
      try {
        await octokit.pulls.createReviewComment({
          owner,
          repo: repoName,
          pull_number: prNumber,
          commit_id: headSha,
          path: comment.file,
          line: comment.line,
          body: `**${comment.severity.toUpperCase()}** — ${comment.body}`,
        });
        console.log(`[review] posted comment on ${comment.file}:${comment.line}`);
      } catch (err) {
        console.warn(`[review] inline comment failed (${comment.file}:${comment.line}):`, err instanceof Error ? err.message : String(err));
      }
    }

    // Step 5: post overall summary as a PR comment
    await octokit.issues.createComment({
      owner,
      repo: repoName,
      issue_number: prNumber,
      body: `## 🤖 Code Review Summary\n\n${result.summary}\n\n---\n*Reviewed by Gemma via [code-reviewer](https://github.com/${owner}/code-reviewer)*`,
    });
    console.log("[review] posted summary comment");

    // Step 6: delete the "in progress" comment
    if (progressCommentId) {
      await octokit.issues.deleteComment({ owner, repo: repoName, comment_id: progressCommentId });
      console.log("[review] deleted in-progress comment");
    }

    console.log("[review] done");
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[review] pipeline error:", msg);
    await octokit.issues.createComment({
      owner,
      repo: repoName,
      issue_number: prNumber,
      body: `❌ Review failed: ${msg}`,
    }).catch(() => {});
  }
}
